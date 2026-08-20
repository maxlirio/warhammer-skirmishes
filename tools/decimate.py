# Turn a raw scan into something the game can carry.
#
# A photogrammetry scan arrives as millions of triangles and a 4K texture. The
# game holds ten models on screen at once, all casting shadows, and bakes them
# into one script so the page still opens off a disc — so each one has to come
# down to something like twenty thousand triangles and a 1K texture, without
# losing the silhouette.
#
# This runs inside Blender, which is already on this machine:
#
#   blender --background --python tools/decimate.py -- IN.glb OUT.glb [tris] [tex]
#
# It also:
#   · joins the pieces a scan usually comes in
#   · stands the model on the ground with its origin at the centre of its base,
#     which is where the game puts the base ring
#   · leaves it Y-up, which is what glTF and the game both want
#
# Defaults: 20000 triangles, 1024px textures.

import bpy
import sys
import os
import math
import mathutils


def argv_after_dashes():
    if '--' not in sys.argv:
        return []
    return sys.argv[sys.argv.index('--') + 1:]


def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def triangle_count():
    n = 0
    for o in mesh_objects():
        me = o.data
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
    return n


def join_all():
    meshes = mesh_objects()
    if len(meshes) < 2:
        return meshes[0] if meshes else None
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def decimate_to(obj, target_tris):
    """Collapse edges until the triangle budget is met. A scan has no clean
    topology to preserve, so collapse is the right mode; planar would keep the
    noise and drop the shape."""
    before = triangle_count()
    if before <= target_tris:
        return before, before
    ratio = max(0.005, float(target_tris) / float(before))
    mod = obj.modifiers.new(name='decimate', type='DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_collapse_triangulate = True

    # Bake it off the dependency graph rather than through modifier_apply.
    # The operator needs the right selection, mode and context to be in place,
    # and after the welding pass it quietly did nothing — 133,574 triangles came
    # out as 115,844 instead of the 20,000 that was asked for, with no error.
    # Reading the evaluated mesh cannot fail that way.
    bpy.context.view_layer.update()          # let the graph see the modifier 
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.clear()
    stale = obj.data
    obj.data = baked
    if stale.users == 0:
        bpy.data.meshes.remove(stale)
    bpy.context.view_layer.update()
    return before, triangle_count()


def shrink_textures(max_px):
    """A 4K albedo is most of the file size and none of the readable detail at
    the size these are drawn."""
    touched = []
    for img in bpy.data.images:
        if img.source == 'VIEWER' or img.size[0] == 0:
            continue
        w, h = img.size
        if max(w, h) <= max_px:
            continue
        scale = float(max_px) / float(max(w, h))
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        img.scale(nw, nh)
        touched.append('%s %dx%d -> %dx%d' % (img.name, w, h, nw, nh))
    return touched


def turn_upright(obj, rx, ry, rz):
    """A scan comes out of the scanner in whatever attitude it was scanned in.
    This one arrived on its back — base toward +Y, head toward -Y — and no
    amount of standing it on the ground helps a model that is lying down. So
    the rotation is given explicitly, in degrees, and baked in before anything
    else measures it. Photogrammetry has no idea which way is up and guessing
    from the bounding box is how you end up with a miniature on its face."""
    if not (rx or ry or rz):
        return
    print('  upright     rotating %.0f, %.0f, %.0f degrees' % (rx, ry, rz))
    # Straight onto the mesh data. Going through the object's rotation and
    # transform_apply looked right and did nothing: the glTF importer parents
    # everything under a root empty, and applying a transform to a parented
    # object does not land where you expect. Moving the vertices is not
    # ambiguous.
    m = (mathutils.Matrix.Rotation(math.radians(rx), 4, 'X') @
         mathutils.Matrix.Rotation(math.radians(ry), 4, 'Y') @
         mathutils.Matrix.Rotation(math.radians(rz), 4, 'Z'))
    obj.data.transform(obj.matrix_world.inverted() @ m @ obj.matrix_world)
    obj.data.update()
    bpy.context.view_layer.update()


def colour_from(target, src_path, tex_px, src_rot):
    """Take the geometry from one file and the colour from another.

    A scanner gives you two things and they are good at different jobs. The
    PRINTABLE mesh has been repaired to be watertight — no spikes, no holes,
    no floating scraps, because none of those would print — but it is an STL
    and carries no colour at all. The TEXTURED mesh has the photographs on it
    and a surface full of the reconstruction's mistakes.

    So: keep the printable body, and bake the textured one's skin onto it. They
    are the same object scanned once, so once they are on the same scale and
    centred on each other they line up, and the transfer is a short ray from
    one surface to the other.
    """
    scene = bpy.context.scene
    print('  colour      reading %r' % (src_path,))
    if not src_path or not os.path.exists(src_path):
        print('  colour      no such file')
        return False
    before = set(bpy.context.scene.objects)
    ext = os.path.splitext(src_path)[1].lower()
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=src_path)
    else:
        print('  colour      cannot read ' + ext)
        return False
    fresh = [o for o in bpy.context.scene.objects
             if o not in before and o.type == 'MESH']
    if not fresh:
        print('  colour      no mesh in ' + os.path.basename(src_path))
        return False

    # join the colour source into one object
    bpy.ops.object.select_all(action='DESELECT')
    for o in fresh:
        o.select_set(True)
    bpy.context.view_layer.objects.active = fresh[0]
    if len(fresh) > 1:
        bpy.ops.object.join()
    source = bpy.context.view_layer.objects.active

    if src_rot:
        m = mathutils.Matrix.Rotation(math.radians(src_rot), 4, 'X')
        source.data.transform(source.matrix_world.inverted() @ m @ source.matrix_world)
        source.data.update()

    # put it exactly over the target: same longest side, same centre
    def bounds(o):
        vs = o.data.vertices
        lo = [min(v.co[i] for v in vs) for i in range(3)]
        hi = [max(v.co[i] for v in vs) for i in range(3)]
        return lo, hi

    tlo, thi = bounds(target)
    slo, shi = bounds(source)
    tspan = max(thi[i] - tlo[i] for i in range(3))
    sspan = max(shi[i] - slo[i] for i in range(3))
    k = tspan / sspan if sspan > 1e-9 else 1.0
    m = mathutils.Matrix.Scale(k, 4)
    source.data.transform(m)
    slo, shi = bounds(source)
    shift = mathutils.Matrix.Translation(
        mathutils.Vector([((thi[i] + tlo[i]) - (shi[i] + slo[i])) / 2.0 for i in range(3)]))
    source.data.transform(shift)
    source.data.update()
    slo, shi = bounds(source)
    drift = max(abs((thi[i] + tlo[i]) / 2 - (shi[i] + slo[i]) / 2) for i in range(3))
    print('  colour      source scaled x%.4f, centres within %.4f' % (k, drift))

    # somewhere to put it
    bpy.ops.object.select_all(action='DESELECT')
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')

    img = bpy.data.images.new('baked', tex_px, tex_px)
    mat = bpy.data.materials.new('scan_baked')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = 0.72
    texnode = nt.nodes.new('ShaderNodeTexImage')
    texnode.image = img
    nt.links.new(texnode.outputs['Color'], bsdf.inputs['Base Color'])
    nt.nodes.active = texnode
    target.data.materials.clear()
    target.data.materials.append(mat)

    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.cycles.device = 'CPU'
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = tspan * 0.03
    scene.render.bake.max_ray_distance = tspan * 0.06
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True

    bpy.ops.object.select_all(action='DESELECT')
    source.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    ok = True
    try:
        bpy.ops.object.bake(type='DIFFUSE')
    except RuntimeError as err:
        print('  colour      BAKE FAILED: %s' % err)
        ok = False
    bpy.data.objects.remove(source, do_unlink=True)
    if ok:
        img.pack()
        texnode.image = img
    return ok


VOXELS = 300          # how many voxels across the model's longest side
ADAPT = 0.0           # how hard to simplify flat areas, in voxels


def remesh_and_bake(obj, size, target_tris, tex_px):
    """Rebuild the surface, then paint the old one back onto it.

    The shards are IN THE SCAN. The raw 147,172-triangle mesh straight out of
    the scanner is already covered in them — flakes and spikes standing off the
    shoulder pads and the halberd, floating scraps, surfaces doubled back on
    themselves. No amount of welding, normal recalculation or gentler decimation
    touches that, because there is nothing wrong with how it is being processed;
    the reconstruction produced a bad surface.

    So the surface is thrown away and rebuilt. A voxel remesh takes the shape
    and returns clean, watertight, evenly-spaced topology — which drops the
    spikes and closes the holes, because neither survives being re-sampled on a
    grid.

    That costs the UVs, and with them the texture, so the texture is baked back
    on: the original is kept aside, the rebuilt mesh gets a fresh unwrap, and
    the colour is transferred across from one to the other. What comes out has
    the old skin on a new body.
    """
    scene = bpy.context.scene

    # keep the original aside as the source of colour
    source = obj.copy()
    source.data = obj.data.copy()
    scene.collection.objects.link(source)
    source.name = 'scan_source'

    # --- rebuild the shape -------------------------------------------------
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # fine enough to keep a face and a purity seal, coarse enough to lose the
    # noise: about 300 voxels across the model's longest side
    obj.data.remesh_voxel_size = max(1e-4, size / float(VOXELS))
    # Simplify DURING the remesh, not after it. Collapse decimation on a
    # remeshed scan tears it to pieces — 205,424 triangles down to 20,000 came
    # out shredded every time, with or without the loose scraps removed —
    # because it is collapsing across a surface full of thin resolved noise.
    # Adaptivity does the reduction inside the remesher, on flat ground only,
    # and the surface survives.
    obj.data.remesh_voxel_adaptivity = max(1e-4, size / float(VOXELS)) * ADAPT
    bpy.ops.object.voxel_remesh()

    # KEEP ONLY THE BODY.
    #
    # The scan's floating flakes survive the remesh as their own little closed
    # shells, and collapse decimation eats them alive: it spends its budget
    # collapsing hundreds of scraps to nothing and tears holes through the
    # model doing it. Remeshed and left whole the surface is clean; remeshed
    # and decimated it came out shredded, and the scraps are why. Split the
    # result into loose parts, keep the largest, bin the rest.
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    if len(parts) > 1:
        parts.sort(key=lambda o: len(o.data.vertices), reverse=True)
        body = parts[0]
        for scrap in parts[1:]:
            bpy.data.objects.remove(scrap, do_unlink=True)
        obj = body
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        print('  scraps      %d loose pieces -> kept the body' % len(parts))

    remeshed = triangle_count_of(obj)

    # bring it down to budget — the remesh comes out heavy
    if remeshed > target_tris:
        mod = obj.modifiers.new(name='decimate', type='DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = max(0.005, float(target_tris) / float(remeshed))
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        baked_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        obj.modifiers.clear()
        stale = obj.data
        obj.data = baked_mesh
        if stale.users == 0:
            bpy.data.meshes.remove(stale)

    bpy.ops.object.shade_smooth()

    # --- give it somewhere to put the colour --------------------------------
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')

    img = bpy.data.images.new('baked', tex_px, tex_px)
    mat = bpy.data.materials.new('scan_baked')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Metallic'].default_value = 0.0
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = 0.72
    texnode = nt.nodes.new('ShaderNodeTexImage')
    texnode.image = img
    nt.links.new(texnode.outputs['Color'], bsdf.inputs['Base Color'])
    nt.nodes.active = texnode
    obj.data.materials.clear()
    obj.data.materials.append(mat)

    # --- bake the old skin onto the new body --------------------------------
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.cycles.device = 'CPU'
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = size * 0.02
    scene.render.bake.max_ray_distance = size * 0.04
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True

    bpy.ops.object.select_all(action='DESELECT')
    source.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    try:
        bpy.ops.object.bake(type='DIFFUSE')
        ok = True
    except RuntimeError as err:
        print('  bake        FAILED: %s' % err)
        ok = False

    bpy.data.objects.remove(source, do_unlink=True)

    if ok:
        img.pack()
        texnode.image = img
    return obj, remeshed, triangle_count_of(obj), ok


def model_span(obj):
    """The model's longest side, which every threshold here is relative to."""
    vs = obj.data.vertices
    if not len(vs):
        return 1.0
    return max((max(v.co[i] for v in vs) - min(v.co[i] for v in vs)) for i in range(3))


def triangle_count_of(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def weld_the_scan(obj, size):
    """Sew the surface together before anything else touches it.

    A photogrammetry mesh is not one surface: it is stitched from separate
    captures and arrives full of split vertices, coincident-but-unwelded seams
    and loose scraps. That matters because making normals consistent works by
    walking from face to neighbouring face — and across a split seam there IS no
    neighbour, so the walk stops and every island beyond it keeps whatever
    winding it happened to have. Recalculating normals on an unwelded scan does
    almost nothing, which is exactly what happened here: Drusius came out
    covered in bright shards where individual islands faced the wrong way.

    So: weld the seams, throw away the scraps, and only then decimate.
    """
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    before = len(obj.data.vertices)

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # 0.4% of the model's own size. At 0.06% the seams did not close — the
    # shards survived every recalculation, because across an unclosed seam
    # there is still no neighbour to walk to. On a 32mm miniature this is about
    # a tenth of a millimetre, which welds the stitching without touching
    # anything you would call detail.
    bpy.ops.mesh.remove_doubles(threshold=max(1e-6, size * 0.0015))
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return before, len(obj.data.vertices)


def face_the_right_way(obj):
    """Turn the inside-out triangles back the right way.

    A photogrammetry mesh is stitched from separate captures and its winding is
    not consistent to begin with; collapsing 147,000 triangles down to 20,000
    makes more of a mess of it. The faces do not vanish, because the material is
    double-sided — but a triangle whose normal points into the model is lit as
    though the sun were inside him, and you get dark patches crawling over the
    armour that move when the camera does.

    Two steps, and the order matters. The glTF importer brings CUSTOM SPLIT
    NORMALS along with the mesh, and those override anything recalculated —
    clear them first or the recalculation is thrown away. Then make the winding
    consistent, outward.
    """
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # FLAT, not smooth. Smooth shading interpolates a normal across each face
    # from its neighbours, which on a surface with gaps in it spreads the
    # damage — every hole grows a halo of wrongly-lit triangles around it. Flat
    # shading confines a bad face to itself.
    bpy.ops.object.shade_flat()


def signed_volume(obj):
    """The volume the winding implies, by the divergence theorem.

    Positive means the faces are wound outward, negative means the whole mesh is
    inside out. This is the measurement that means something.

    The obvious check — count faces whose normal points back toward the middle —
    does NOT: a miniature is deeply concave, between the legs, under the arms,
    inside a cloak, and thousands of its faces point inward perfectly correctly.
    That count said 6562 before and 7443 after and neither number described
    anything real.
    """
    me = obj.data
    me.calc_loop_triangles()
    v = me.vertices
    total = 0.0
    for tri in me.loop_triangles:
        a, b, c = (v[i].co for i in tri.vertices)
        total += a.dot(b.cross(c)) / 6.0
    return total


def lift_exposure(target=0.40):
    """Bring an underexposed scan back up.

    Photogrammetry of a dark miniature comes out dark: the first Grey Knight
    scanned here had a baseColour texture with a mean luminance of about 0.06,
    which is very nearly black, and on the table he read as a silhouette. The
    geometry was perfect — it was the photographs.

    So the albedo is levelled: measure the mean, and if it is well under what a
    lit surface should sit at, apply a gamma that lands it there. Gamma rather
    than a straight multiply, because a multiply blows out the few highlights a
    dark scan does have and loses the only shape information in it.
    """
    notes = []
    for img in bpy.data.images:
        if img.source == 'VIEWER' or img.size[0] == 0:
            continue
        px = list(img.pixels)
        n = img.size[0] * img.size[1]
        if n == 0:
            continue
        # mean luminance, sampled — every pixel of a 1K image is four million
        # floats and we only need to know roughly how dark it is
        step = max(1, n // 40000)
        tot, cnt = 0.0, 0
        for i in range(0, n, step):
            j = i * 4
            tot += 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2]
            cnt += 1
        mean = tot / max(1, cnt)
        if mean >= target * 0.82 or mean <= 0.0005:
            notes.append('%s mean %.3f — left alone' % (img.name, mean))
            continue
        gamma = math.log(target) / math.log(mean)
        for i in range(n):
            j = i * 4
            for k in range(3):
                v = px[j + k]
                px[j + k] = v ** gamma if v > 0 else 0.0
        img.pixels[:] = px
        img.update()
        notes.append('%s mean %.3f -> %.2f (gamma %.2f)' % (img.name, mean, target, gamma))
    return notes


def stand_on_the_ground(obj):
    """Put the origin at the middle of the footprint, on the floor. The game
    sets a model down on a base ring at y=0 and expects its feet there, not its
    centre of mass."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    me = obj.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    if not xs:
        return None

    # Move the OBJECT and bake that in, rather than editing vertex coordinates
    # by hand: the exporter reads an evaluated copy of the mesh, and raw edits
    # do not always reach it — which leaves the model hovering over its base.
    # Blender is Z-up; the glTF exporter turns that into Y-up on the way out.
    obj.location = (
        -(min(xs) + max(xs)) / 2.0,
        -(min(ys) + max(ys)) / 2.0,
        -min(zs),
    )
    bpy.context.view_layer.update()
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    bpy.context.view_layer.update()
    return (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def export(obj, dst):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_image_format='JPEG',
        export_cameras=False,
        export_lights=False,
    )


def measure_file(path):
    """Read the finished file back and measure it. What Blender holds in memory
    and what the exporter writes are not always the same thing — modifiers,
    evaluated copies and the Y-up conversion all sit in between — so the only
    measurement worth trusting is one taken off the exported file."""
    scene = bpy.data.scenes.new('probe')
    old = bpy.context.window.scene
    bpy.context.window.scene = scene
    bpy.ops.import_scene.gltf(filepath=path)
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    for o in [x for x in scene.objects if x.type == 'MESH']:
        for corner in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    bpy.context.window.scene = old
    bpy.data.scenes.remove(scene)
    if lo[0] > 1e8:
        return None
    return lo, hi


def sit_it_down(obj, dst, tries=4):
    """Export, measure the file, nudge, repeat — until it really is standing on
    the ground with its footprint centred."""
    for _ in range(tries):
        export(obj, dst)
        m = measure_file(dst)
        if not m:
            return None
        lo, hi = m
        # the probe scene is Blender-space again, so Z is up
        dx = -(lo[0] + hi[0]) / 2.0
        dy = -(lo[1] + hi[1]) / 2.0
        dz = -lo[2]
        if abs(dx) < 0.002 and abs(dy) < 0.002 and abs(dz) < 0.002:
            return (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
        obj.location = (obj.location[0] + dx, obj.location[1] + dy, obj.location[2] + dz)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        bpy.context.view_layer.update()
    return (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])


def main():
    args = argv_after_dashes()
    if len(args) < 2:
        print('usage: blender --background --python tools/decimate.py -- '
              'IN.glb OUT.glb [tris] [tex] [rotX rotY rotZ, degrees]')
        sys.exit(1)

    src, dst = args[0], args[1]
    target_tris = int(args[2]) if len(args) > 2 else 20000
    max_px = int(args[3]) if len(args) > 3 else 1024
    rx = float(args[4]) if len(args) > 4 else 0.0
    ry = float(args[5]) if len(args) > 5 else 0.0
    rz = float(args[6]) if len(args) > 6 else 0.0
    lift = (args[7].lower() not in ('0', 'no', 'off')) if len(args) > 7 else True
    # REBUILD is on by default for scans: the surface a scanner hands you is
    # not one you can clean, only one you can replace.
    rebuild = (args[8].lower() not in ('0', 'no', 'off')) if len(args) > 8 else True
    if len(args) > 9:
        globals()['VOXELS'] = int(args[9])
    if len(args) > 10:
        globals()['ADAPT'] = float(args[10])
    # Geometry from this file, colour from another: set COLOUR_FROM to a
    # textured .glb of the same object, and COLOUR_ROT to whatever rotation
    # that file needs to stand up.
    colour_src = os.environ.get('COLOUR_FROM', '')
    colour_rot = float(os.environ.get('COLOUR_ROT', '0'))

    wipe()
    ext = os.path.splitext(src)[1].lower()
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=src)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=src)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=src)
    elif ext == '.ply':
        bpy.ops.wm.ply_import(filepath=src)
    elif ext == '.stl':
        bpy.ops.wm.stl_import(filepath=src)
    else:
        print('do not know how to read ' + ext)
        sys.exit(1)

    obj = join_all()
    if obj is None:
        print('no mesh in ' + src)
        sys.exit(1)

    turn_upright(obj, rx, ry, rz)

    span = model_span(obj)

    if rebuild:
        raw = triangle_count()
        obj, remeshed, after, baked_ok = remesh_and_bake(obj, span, target_tris, max_px)
        before = raw
        welded_from = welded_to = 0
        vol_before = vol_after = signed_volume(obj)
        print('')
        print('  ' + os.path.basename(src) + '  ->  ' + os.path.basename(dst))
        print('  rebuilt     %d triangles -> voxel surface %d -> %d'
              % (raw, remeshed, after))
        print('  texture     baked onto a fresh unwrap at %dpx%s'
              % (max_px, '' if baked_ok else '  (BAKE FAILED — no colour)'))
        lifted = lift_exposure() if lift else []
        for line in lifted:
            print('  exposure    ' + line)
        stand_on_the_ground(obj)
        size = sit_it_down(obj, dst)
        if size:
            print('  bounds      %.2f wide, %.2f deep, %.2f tall' % size)
        print('  file        %.2f MB -> %.2f MB'
              % (os.path.getsize(src) / 1048576.0, os.path.getsize(dst) / 1048576.0))
        print('')
        return

    # Sew it up BEFORE decimating. The order is the whole point: welding gives
    # the surface neighbours to walk across, decimating a welded mesh keeps them,
    # and normals recalculated at the end therefore actually propagate.
    if obj.data.has_custom_normals:
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    before, after = decimate_to(obj, target_tris)

    if colour_src:
        stand_on_the_ground(obj)
        got = colour_from(obj, colour_src, max_px, colour_rot)
        lifted = lift_exposure() if (lift and got) else []
        print('')
        print('  ' + os.path.basename(src) + '  ->  ' + os.path.basename(dst))
        print('  triangles   %d -> %d' % (before, after))
        print('  colour      from ' + os.path.basename(colour_src) +
              ('' if got else '  (FAILED — no colour)'))
        for line in lifted:
            print('  exposure    ' + line)
        stand_on_the_ground(obj)
        size = sit_it_down(obj, dst)
        if size:
            print('  bounds      %.2f wide, %.2f deep, %.2f tall' % size)
        print('  file        %.2f MB -> %.2f MB'
              % (os.path.getsize(src) / 1048576.0, os.path.getsize(dst) / 1048576.0))
        print('')
        return

    # Weld AFTER decimating, not before. Welding first sews the surface
    # together beautifully and then the collapse decimator will not touch the
    # result — 133,574 triangles came out as 115,844 with no error and no
    # reduction. Decimating first and sewing the 20,000 that survive gives both:
    # the budget is met, and the normals have neighbours to propagate across.
    welded_from, welded_to = weld_the_scan(obj, span)

    vol_before = signed_volume(obj)
    face_the_right_way(obj)
    vol_after = signed_volume(obj)
    if vol_after < 0:
        # consistent, but consistently the wrong way round: turn the lot
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.flip_normals()
        bpy.ops.object.mode_set(mode='OBJECT')
        vol_after = signed_volume(obj)
    shrunk = shrink_textures(max_px)
    lifted = lift_exposure() if lift else []
    stand_on_the_ground(obj)
    size = sit_it_down(obj, dst)

    in_mb = os.path.getsize(src) / 1048576.0
    out_mb = os.path.getsize(dst) / 1048576.0
    print('')
    print('  ' + os.path.basename(src) + '  ->  ' + os.path.basename(dst))
    print('  triangles   %d -> %d' % (before, after))
    print('  normals     signed volume %+.4f -> %+.4f (positive is outward)'
          % (vol_before, vol_after))
    for line in shrunk:
        print('  texture     ' + line)
    for line in lifted:
        print('  exposure    ' + line)
    if size:
        print('  bounds      %.2f wide, %.2f deep, %.2f tall' % (size[0], size[1], size[2]))
    print('  file        %.2f MB -> %.2f MB' % (in_mb, out_mb))
    print('')


main()

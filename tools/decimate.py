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
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
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
    before, after = decimate_to(obj, target_tris)
    shrunk = shrink_textures(max_px)
    lifted = lift_exposure() if lift else []
    stand_on_the_ground(obj)
    size = sit_it_down(obj, dst)

    in_mb = os.path.getsize(src) / 1048576.0
    out_mb = os.path.getsize(dst) / 1048576.0
    print('')
    print('  ' + os.path.basename(src) + '  ->  ' + os.path.basename(dst))
    print('  triangles   %d -> %d' % (before, after))
    for line in shrunk:
        print('  texture     ' + line)
    for line in lifted:
        print('  exposure    ' + line)
    if size:
        print('  bounds      %.2f wide, %.2f deep, %.2f tall' % (size[0], size[1], size[2]))
    print('  file        %.2f MB -> %.2f MB' % (in_mb, out_mb))
    print('')


main()

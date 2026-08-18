/* =========================================================================
   THE SCENERY
   Real models rather than boxes. Everything here is Kenney's Space Kit, which
   is CC0 — see assets/kit/LICENSE-kenney.txt.

   The rules never see any of this. A battlefield is still the boxes in
   maps.js, and those boxes are what gets measured, walked round and climbed;
   this only dresses them. So a piece of scenery can be swapped for a better
   one without a single distance changing.
   ========================================================================= */

const Assets = (function () {

  const THREE = window.THREE;
  const cache = {};          // name -> { scene, size, ready }
  let loader = null;
  let progress = { done: 0, total: 0 };

  /* Everything the battlefield builder can ask for. */
  /* Everything the battlefield builder can ask for. Generated from
     assets/kit/ — add a model there and to this list, then re-run
     tools/buildkit.js. */
  const KIT = [
    'alien', 'astronautA', 'astronautB', 'barrel', 'barrels', 'barrels_rail',
    'box', 'box_large', 'cactus_short', 'cactus_tall', 'chimney',
    'chimney_detailed', 'cliff_block_rock', 'cliff_large_rock',
    'column_large', 'crater', 'crypt_small', 'debris', 'fire_basket',
    'flower_redA', 'gate_simple', 'grass', 'grass_large', 'gravestone_broken',
    'gravestone_cross', 'gravestone_round', 'iron_fence', 'log', 'log_stack',
    'machine_barrel', 'machine_generator', 'machine_wireless', 'metal_panel',
    'meteor', 'meteor_half', 'mushroom_red', 'pillar_obelisk', 'pipe_corner',
    'pipe_end', 'pipe_ring', 'pipe_straight', 'pipe_supportLow', 'plant_bush',
    'plant_bushLarge', 'platform_center', 'platform_corner', 'platform_end',
    'platform_high', 'platform_large', 'platform_long', 'platform_low',
    'platform_side', 'platform_straight', 'rail', 'rail_corner', 'rail_end',
    'rail_middle', 'rock', 'rock_largeA', 'rock_largeB', 'rock_largeC',
    'rock_sandA', 'rock_sandB', 'rock_sandC', 'rock_smallA', 'rock_smallC',
    'rock_tallA', 'rock_tallC', 'rocks_smallA', 'satelliteDish', 'stairs',
    'stairs_short', 'stone_largeB', 'stone_tallB', 'stone_wall',
    'stone_wall_damaged', 'structure', 'structure_closed',
    'structure_detailed', 'structure_diagonal', 'structure_metal_wall',
    'stump_old', 'stump_round', 'supports_high', 'supports_low', 'tent',
    'terrain_ramp', 'terrain_roadCorner', 'terrain_roadStraight',
    'tree_autumn', 'tree_deadlog', 'tree_detailed', 'tree_oak',
    'tree_palmShort', 'tree_palmTall', 'tree_pineGroundA', 'tree_pineRoundC',
    'tree_pineSmallA', 'tree_pineTallA', 'tree_thin', 'tree_trunk',
    'turret_single', 'weapon_rifle'
  ];

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    return buf;
  }

  /* Parsed out of the baked-in data rather than fetched, because fetch will not
     touch a file:// URL and the game has to open off a disc. */
  function load(base, onProgress) {
    loader = new window.GLTFLoader();
    const names = KIT.filter(n => window.KIT_DATA && KIT_DATA[n]);
    progress = { done: 0, total: names.length };
    return Promise.all(names.map(function (name) {
      return new Promise(function (resolve) {
        loader.parse(b64ToBuffer(KIT_DATA[name]), '', function (gltf) {
          const root = gltf.scene;
          root.traverse(function (o) {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            /* the kit ships flat-lit colours; give them something to catch */
            if (o.material) {
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              mats.forEach(function (m) {
                m.roughness = m.roughness === undefined ? 0.82 : Math.min(1, m.roughness + 0.25);
                m.metalness = 0.3;
                grimdark(m);
              });
            }
          });
          const box = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          box.getSize(size);
          cache[name] = { scene: root, size: size, min: box.min.clone() };
          progress.done++;
          if (onProgress) onProgress(progress.done, progress.total, name);
          resolve();
        }, function () {
          /* a bad piece must not take the whole battlefield down with it */
          progress.done++;
          if (onProgress) onProgress(progress.done, progress.total, name);
          resolve();
        });
      });
    }));
  }

  /* The kit is cheerful cream and pastel. This is not a cheerful game: pull the
     saturation down, darken it, and drag everything a little toward rusted
     iron so it sits with the rest of the palette. */
  const IRON = new THREE.Color(0x4a3f33);
  function grimdark(m) {
    if (!m.color) return;
    const hsl = {};
    m.color.getHSL(hsl);
    /* take the cheerfulness off without turning everything to porridge */
    m.color.setHSL(hsl.h, hsl.s * 0.78, Math.max(0.05, hsl.l * 0.72));
    m.color.lerp(IRON, 0.12);
    if (m.emissive) m.emissive.multiplyScalar(0.4);
  }

  const has = name => !!cache[name];
  const size = name => cache[name] ? cache[name].size : new THREE.Vector3(1, 1, 1);

  /* A fresh copy, sitting on the ground with its footprint centred on origin. */
  function get(name) {
    const c = cache[name];
    if (!c) return new THREE.Group();
    const g = c.scene.clone(true);
    g.position.set(-(c.min.x + c.size.x / 2), -c.min.y, -(c.min.z + c.size.z / 2));
    const wrap = new THREE.Group();
    wrap.add(g);
    return wrap;
  }

  /* One piece at its own proportions, standing `height` tall. A tree squashed
     to fill a box is a blob; a tree scaled evenly is a tree. */
  function grown(name, height, maxWide) {
    const g = get(name);
    const s = size(name);
    let k = height / (s.y || 1);
    /* and it must still fit where it is being put — a log is wide and short,
       so growing it to a tree's height makes a twenty-inch trunk */
    if (maxWide) k = Math.min(k, maxWide / Math.max(s.x || 1, s.z || 1));
    g.scale.setScalar(k);
    return g;
  }

  /* One piece, scaled so it stands exactly `height` tall and covers `w × d`. */
  function fitted(name, w, d, height) {
    const g = get(name);
    const s = size(name);
    g.scale.set(w / (s.x || 1), height / (s.y || 1), d / (s.z || 1));
    return g;
  }

  /* Tile a piece across a footprint, so a long wall is many models rather than
     one stretched one. Returns a group placed at the box's centre. */
  /* Cover a footprint with repeats of one piece, kept roughly square so a long
     wall is a row of models rather than one model stretched down it. */
  function tiled(name, box, height, opts) {
    opts = opts || {};
    const cell = Math.min(Math.max(Math.min(box.w, box.h), opts.min || 1.1), opts.max || 3.2);
    const nx = Math.max(1, Math.round(box.w / cell));
    const nz = Math.max(1, Math.round(box.h / cell));
    const cw = box.w / nx, cd = box.h / nz;
    const g = new THREE.Group();
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (opts.ring && i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
        const p = fitted(name, cw * 1.005, cd * 1.005, height);
        p.position.set(-box.w / 2 + cw * (i + 0.5), opts.y || 0, -box.h / 2 + cd * (j + 0.5));
        if (opts.spin) p.rotation.y = Math.floor(seeded(i * 31 + j * 17 + (opts.seed || 0)) * 4) * Math.PI / 2;
        g.add(p);
      }
    }
    return g;
  }

  /* Mass, built by stacking courses rather than stretching one piece to the
     full height — a 4" bunker is layers of slab, not a very tall slab. */
  function stacked(name, box, height, opts) {
    opts = opts || {};
    const course = Math.min(Math.max(height, 0.7), opts.course || 1.5);
    const n = Math.max(1, Math.round(height / course));
    const g = new THREE.Group();
    for (let k = 0; k < n; k++) {
      const inset = (opts.taper || 0) * k;
      g.add(tiled(name, { w: Math.max(0.4, box.w - inset), h: Math.max(0.4, box.h - inset) },
                  height / n, { y: (height / n) * k, spin: true, seed: k * 977,
                                min: opts.min, max: opts.max }));
    }
    return g;
  }

  /* Scenery must look the same for both players in a networked game, so its
     scatter comes off a fixed sequence rather than Math.random. */
  function seeded(n) {
    let t = (n * 2654435761) >>> 0;
    t ^= t >>> 15; t = Math.imul(t, 2246822519);
    t ^= t >>> 13; t = Math.imul(t, 3266489917);
    t ^= t >>> 16;
    return (t >>> 0) / 4294967296;   /* Math.imul is signed; this must not be */
  }

  return { load, get, has, size, fitted, grown, tiled, stacked, seeded, KIT,
           get progress() { return progress; } };
})();

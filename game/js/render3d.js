/* =========================================================================
   THE TABLE, IN THREE DIMENSIONS
   One world unit is one inch, so nothing here has to convert anything: a
   model at (22, 15) on the table stands at (22, ground, 15) in the scene, and
   a 12" range is twelve units long.

   Table x → world X, table y → world Z, height → world Y.
   ========================================================================= */

const THREE = window.THREE;

const Render3D = (function () {

  let renderer, scene, camera, canvas, keyLight;
  let ground, terrainGroup, unitGroup, overlayGroup, fxGroup, markerGroup;
  const unitNodes = {};          // unit id -> THREE.Group
  const art = {};                // unit id -> texture, once scans exist
  let board = null;
  let raf = 0, lastT = 0;
  const fx = [];                 // live effects, ticked each frame
  const dice = [];               // dice on the table
  let seenDice = -1, seenShot = -1;
  let shake = 0;

  const COL = {
    p0: 0x5687b4, p1: 0xa8352a,
    gold: 0xb8912f, goldLit: 0xe8c65c, bone: 0xd9cfbc,
    move: 0x5687b4, sight: 0xb8912f, watch: 0xa8352a
  };

  /* ------------------------------------------------------------ the camera
     Orbit by dragging, zoom on the wheel, pan with the right button — written
     out here rather than pulled in, so the page stays self-contained. */
  const cam = { az: -Math.PI / 2, el: 0.85, dist: 46, target: new THREE.Vector3(0, 0, 0) };
  let want = null;          // {target, dist} the camera is easing toward

  function placeCamera() {
    const r = cam.dist * Math.cos(cam.el);
    camera.position.set(
      cam.target.x + r * Math.cos(cam.az),
      cam.target.y + cam.dist * Math.sin(cam.el),
      cam.target.z + r * Math.sin(cam.az)
    );
    camera.lookAt(cam.target);
  }

  function wireCamera() {
    let drag = null;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button === 0 && !e.shiftKey) return;          /* left click is the game */
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      want = null;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const s = cam.dist * 0.0016;
        const right = new THREE.Vector3(Math.sin(cam.az), 0, -Math.cos(cam.az));
        const fwd = new THREE.Vector3(Math.cos(cam.az), 0, Math.sin(cam.az));
        cam.target.addScaledVector(right, -dx * s).addScaledVector(fwd, -dy * s);
        clampTarget();
      } else {
        cam.az += dx * 0.006;
        cam.el = Math.max(0.18, Math.min(1.45, cam.el + dy * 0.005));
      }
      placeCamera();
    });
    const stop = () => { drag = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      userZoomed = true; want = null;
      cam.dist = Math.max(9, Math.min(120, cam.dist * (1 + Math.sign(e.deltaY) * 0.11)));
      placeCamera();
    }, { passive: false });
  }

  function clampTarget() {
    if (!board) return;
    cam.target.x = Math.max(-6, Math.min(board.w + 6, cam.target.x));
    cam.target.z = Math.max(-6, Math.min(board.h + 6, cam.target.z));
  }

  /* Look at the table from one player's end. */
  function viewFrom(player) {
    userZoomed = false;
    cam.az = player === 0 ? Math.PI : 0;
    cam.el = 0.78;
    cam.dist = fitDistance();
    cam.target.set(board.w / 2, 0, board.h / 2);
    placeCamera();
  }

  /* How far back the whole table fits in the frame. A tilted perspective
     camera does not obey a tidy formula, so this asks the camera itself:
     project the corners of the table and back off until they all land inside. */
  function fitDistance() {
    const corners = [];
    /* Only the table surface — the airspace above the near corners projects
       off the top of the screen and would push the camera pointlessly far. */
    [0, board.w].forEach(x => [0, board.h].forEach(z => {
      corners.push(new THREE.Vector3(x, 0, z));
    }));
    const fits = function (d) {
      const r = d * Math.cos(cam.el);
      const pos = new THREE.Vector3(
        cam.target.x + r * Math.cos(cam.az),
        cam.target.y + d * Math.sin(cam.el),
        cam.target.z + r * Math.sin(cam.az));
      const probe = camera.clone();
      probe.position.copy(pos);
      probe.lookAt(cam.target);
      probe.updateMatrixWorld();
      probe.updateProjectionMatrix();
      return corners.every(function (c) {
        const p = c.clone().project(probe);
        return Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.96 && p.z < 1;
      });
    };
    let lo = 8, hi = 200;
    if (!fits(hi)) return hi;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  /* ------------------------------------------------------------------ setup */

  function attach(cv) {
    canvas = cv;
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0908);
    scene.fog = new THREE.Fog(0x100d0b, 70, 210);

    camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);

    /* Grimdark light: a cold ambient, one warm key throwing long shadows. */
    scene.add(new THREE.HemisphereLight(0x8c9ab5, 0x2a2018, 1.5));
    scene.add(new THREE.AmbientLight(0xfff0d8, 0.5));
    keyLight = new THREE.DirectionalLight(0xffe2b8, 2.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0012;
    keyLight.shadow.normalBias = 0.03;
    scene.add(keyLight);
    scene.add(keyLight.target);
    const rim = new THREE.DirectionalLight(0x88aadd, 0.9);
    rim.position.set(24, 20, 22);
    scene.add(rim);

    terrainGroup = new THREE.Group();
    unitGroup = new THREE.Group();
    overlayGroup = new THREE.Group();
    fxGroup = new THREE.Group();
    markerGroup = new THREE.Group();
    scene.add(terrainGroup, markerGroup, overlayGroup, unitGroup, fxGroup);

    wireCamera();
    lastT = performance.now();
    tick();
  }

  let userZoomed = false;

  function resize(w, h) {
    if (!renderer || !w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    /* Reframe unless the player has taken the camera into their own hands. */
    if (board && !userZoomed) { cam.dist = fitDistance(); placeCamera(); }
  }

  /* -------------------------------------------------------------- the table */

  function buildBoard(b) {
    board = b;
    while (terrainGroup.children.length) terrainGroup.remove(terrainGroup.children[0]);
    while (markerGroup.children.length) markerGroup.remove(markerGroup.children[0]);

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, 1, b.h),
      new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.95, metalness: 0.05 })
    );
    floor.position.set(b.w / 2, -0.5, b.h / 2);
    floor.receiveShadow = true;
    terrainGroup.add(floor);
    ground = floor;

    /* a lip round the edge so the table reads as a table */
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(b.w + 1.6, 1.4, b.h + 1.6),
      new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1 })
    );
    lip.position.set(b.w / 2, -0.75, b.h / 2);
    terrainGroup.add(lip);

    /* deployment zones, painted on the floor */
    b.deploy.forEach(function (z, i) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(z.w, z.h),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? COL.p0 : COL.p1, transparent: true, opacity: 0.11,
          depthWrite: false
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(z.x + z.w / 2, 0.012, z.y + z.h / 2);
      terrainGroup.add(m);
    });

    b.terrain.forEach(function (t) {
      const solid = t.blocks;
      const geo = new THREE.BoxGeometry(t.w, t.top, t.h);
      const mat = new THREE.MeshStandardMaterial({
        color: solid ? 0x35302a : 0x6f5c42,
        roughness: solid ? 0.95 : 0.85,
        metalness: solid ? 0.25 : 0.1
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(t.x + t.w / 2, t.top / 2, t.y + t.h / 2);
      m.castShadow = true; m.receiveShadow = true;
      m.userData.terrain = t;
      terrainGroup.add(m);

      /* a lit strip along the top edge so heights read at a glance */
      const cap = new THREE.Mesh(
        new THREE.PlaneGeometry(t.w, t.h),
        new THREE.MeshStandardMaterial({
          color: solid ? 0x5c5347 : 0x91785a, roughness: 0.8
        })
      );
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(t.x + t.w / 2, t.top + 0.006, t.y + t.h / 2);
      cap.receiveShadow = true;
      cap.userData.terrain = t;
      terrainGroup.add(cap);
    });

    /* Point the key light at the table and stretch its shadow camera to cover
       the whole of it — a 44" table overflows any fixed frustum. */
    const span = Math.max(b.w, b.h) * 0.75;
    keyLight.position.set(b.w / 2 - span * 0.6, span * 1.5, b.h / 2 - span * 0.5);
    keyLight.target.position.set(b.w / 2, 0, b.h / 2);
    keyLight.target.updateMatrixWorld();
    const sc = keyLight.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
    sc.near = 1; sc.far = span * 4;
    sc.updateProjectionMatrix();

    b.objectives.forEach(function (o) {
      const y = Board.heightAt(b, o);
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.09, 8, 40),
        new THREE.MeshStandardMaterial({ color: COL.gold, emissive: 0x3a2d0a, roughness: 0.4, metalness: 0.7 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.add(ring);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.9, 7, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: COL.goldLit, transparent: true, opacity: 0.10,
          side: THREE.DoubleSide, depthWrite: false
        })
      );
      beam.position.y = 3.5;
      g.add(beam);
      g.position.set(o.x, y + 0.02, o.y);
      g.userData.spin = beam;
      markerGroup.add(g);
    });

    viewFrom(0, true);
  }

  /* -------------------------------------------------------------- the models
     Placeholders until the scanner lands: a based figure in the player's
     colour with its initials over it. Give a unit `art` and the base carries a
     scan instead — nothing else changes. */
  function initials(name) {
    const quoted = name.match(/"([^"]+)"/);
    if (quoted) return quoted[1].slice(0, 2).toUpperCase();
    const parts = name.replace(/["']/g, '').split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function labelSprite(text, colour) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(8,7,6,.72)';
    g.fillRect(40, 14, 176, 36);
    g.fillStyle = colour;
    g.fillRect(40, 46, 176, 4);
    g.fillStyle = '#e6dcc8';
    g.font = '700 26px Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(2.9, 0.72, 1);
    s.renderOrder = 20;
    return s;
  }

  function makeUnit(u) {
    const colour = u.owner === 0 ? COL.p0 : COL.p1;
    const g = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(u.radius, u.radius, 0.14, 28),
      new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.9, metalness: 0.3 })
    );
    base.position.y = 0.07;
    base.receiveShadow = true; base.castShadow = true;
    g.add(base);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(u.radius, 0.05, 8, 28),
      new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.35, roughness: 0.5 })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.15;
    g.add(rim);

    /* the figure: torso, head, a weapon held across the body */
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 0.5, 4, 12),
      new THREE.MeshStandardMaterial({ color: colour, roughness: 0.75, metalness: 0.2 })
    );
    body.position.y = 0.72;
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xcfc4ae, roughness: 0.8 })
    );
    head.position.y = 1.19;
    head.castShadow = true;
    g.add(head);

    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.11, 0.11),
      new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.6, metalness: 0.6 })
    );
    gun.position.set(0.34, 0.82, 0.2);
    gun.castShadow = true;
    g.add(gun);
    g.userData.muzzle = new THREE.Vector3(0.72, 0.82, 0.2);

    g.userData.unitId = u.id;
    [base, rim, body, head, gun].forEach(m => { m.userData.unitId = u.id; });

    const label = labelSprite(initials(u.name), u.owner === 0 ? '#5687b4' : '#a8352a');
    label.position.y = 2.15;
    g.add(label);
    g.userData.label = label;

    /* wound pips, a small bar of blocks above the base */
    const pips = new THREE.Group();
    for (let i = 0; i < u.maxWounds; i++) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.13, 0.06, 0.06),
        new THREE.MeshBasicMaterial({ color: COL.bone })
      );
      p.position.set((i - (u.maxWounds - 1) / 2) * 0.18, 1.55, 0);
      pips.add(p);
    }
    g.add(pips);
    g.userData.pips = pips;
    g.userData.body = body;
    g.userData.ring = rim;

    /* the overwatch token, hidden until the unit places one */
    const token = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(2.85, 3, 48),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.75,
                                    side: THREE.DoubleSide, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(3, 48),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.11,
                                    side: THREE.DoubleSide, depthWrite: false })
    );
    fill.rotation.x = -Math.PI / 2;
    const pin = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.7, 10),
      new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.5 })
    );
    pin.position.y = 0.35;
    token.add(disc, fill, pin);
    token.visible = false;
    token.userData.detached = true;
    markerGroup.add(token);
    g.userData.token = token;

    return g;
  }

  function syncUnits(S) {
    S.units.forEach(function (u) {
      let node = unitNodes[u.id];
      if (!node) { node = unitNodes[u.id] = makeUnit(u); unitGroup.add(node); }
      const y = Board.heightAt(S.board, u);
      node.position.set(u.x, y, u.y);
      node.rotation.y = -u.facing + Math.PI / 2;
      node.visible = true;

      if (!u.alive) {
        /* leave a wreck: the model on its face, colour drained */
        node.rotation.x = -Math.PI / 2.1;
        node.position.y = y + 0.1;
        node.userData.label.visible = false;
        node.userData.pips.visible = false;
        node.userData.body.material.color.setHex(0x33291f);
        node.userData.ring.material.color.setHex(0x3a2420);
        node.userData.ring.material.emissiveIntensity = 0;
        node.userData.token.visible = false;
        return;
      }
      node.rotation.x = 0;

      node.userData.pips.children.forEach(function (p, i) {
        p.visible = i < u.wounds;
        p.material.color.setHex(u.wounds === 1 ? 0xa8352a
          : u.wounds <= u.maxWounds / 2 ? 0xc9832a : COL.bone);
      });

      const tok = node.userData.token;
      if (u.overwatch) {
        tok.visible = true;
        tok.position.set(u.overwatch.x, Board.heightAt(S.board, u.overwatch) + 0.03, u.overwatch.y);
      } else {
        tok.visible = false;
      }
    });
  }

  /* ------------------------------------------------------------- the overlays
     The rules measure exactly; these are the shading, built from the sampled
     points the battle layer hands over. */
  function areaMesh(points, colour, opacity, cell, lift) {
    /* Exactly cell-sized, so the samples tile edge to edge. Overlapping them
       would double the alpha along every seam and draw a lattice — which is
       the one thing this game is not supposed to look like. */
    const geo = new THREE.BufferGeometry();
    const half = (cell || 0.4) * 0.5;
    const pos = new Float32Array(points.length * 18);
    let k = 0;
    points.forEach(function (p) {
      const y = (lift || 0.05) + Board.heightAt(board, p);
      const x0 = p.x - half, x1 = p.x + half, z0 = p.y - half, z1 = p.y + half;
      const quad = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1];
      for (let i = 0; i < 18; i++) pos[k++] = quad[i];
    });
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: opacity,
      depthWrite: false, side: THREE.DoubleSide
    }));
  }

  function ringMesh(centre, radius, colour, y) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.09, radius, 64),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85,
                                    side: THREE.DoubleSide, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(centre.x, (y || 0) + 0.07, centre.y);
    return m;
  }

  /* The tape measure: a line with the distance written on it. */
  function tapeMesh(from, to, label, colour) {
    const g = new THREE.Group();
    const a = new THREE.Vector3(from.x, from.y + 0.12, from.z);
    const b = new THREE.Vector3(to.x, to.y + 0.12, to.z);
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    /* a proper drawn line, thick enough to read as a tape */
    const dir = b.clone().sub(a);
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, dir.length(), 6),
      new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.95 })
    );
    tube.position.copy(a).lerp(b, 0.5);
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    tube.renderOrder = 28;
    g.add(tube);
    [a, b].forEach(function (end) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 10, 8),
        new THREE.MeshBasicMaterial({ color: colour, depthTest: false })
      );
      cap.position.copy(end);
      cap.renderOrder = 28;
      g.add(cap);
    });
    const c = document.createElement('canvas');
    c.width = 192; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(8,7,6,.92)';
    x.fillRect(0, 10, 192, 44);
    x.strokeStyle = '#e8c65c'; x.lineWidth = 3;
    x.strokeRect(1.5, 11.5, 189, 41);
    x.fillStyle = '#f3e3ac';
    x.font = '700 34px Impact, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, 96, 33);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), depthTest: false, transparent: true
    }));
    sp.scale.set(4.2, 1.4, 1);
    sp.position.copy(a).lerp(b, 0.5).setY(Math.max(a.y, b.y) + 1.1);
    sp.renderOrder = 30;
    g.add(sp);
    return g;
  }

  function setOverlay(view) {
    while (overlayGroup.children.length) {
      const c = overlayGroup.children[0];
      overlayGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
    }
    if (!view) return;

    if (view.area && view.area.length) {
      overlayGroup.add(areaMesh(view.area, view.areaColour || COL.move,
                                view.areaOpacity || 0.3, view.areaCell, 0.05));
      /* a lit border round a placement area, so a thin crescent of legal
         ground is impossible to miss */
      if (view.areaGlow) {
        const edge = areaMesh(view.area, view.areaColour || COL.goldLit, 0.5,
                              (view.areaCell || 0.22) * 2.6, 0.03);
        edge.material.blending = THREE.AdditiveBlending;
        overlayGroup.add(edge);
      }
    }
    if (view.ring) {
      overlayGroup.add(ringMesh(view.ring, view.ring.r, view.ringColour || COL.watch,
                                Board.heightAt(board, view.ring)));
    }
    if (view.tape) {
      overlayGroup.add(tapeMesh(view.tape.from, view.tape.to, view.tape.label,
                                view.tape.colour || COL.goldLit));
    }
    (view.marks || []).forEach(function (m) {
      const ring = ringMesh(m, m.r || 1.1, m.colour || COL.p1, Board.heightAt(board, m));
      ring.material.opacity = 0.95;
      overlayGroup.add(ring);
    });
  }

  /* --------------------------------------------------------------- the dice
     Thrown where the action is, tumbling, then settling on the face that was
     actually rolled. */
  const DIE_FACE = [null,
    { axis: 'z', a: Math.PI / 2 },    /* 1 is +X: turn +X up */
    { axis: 'x', a: 0 },              /* 2 is +Y: already up */
    { axis: 'x', a: -Math.PI / 2 },   /* 3 is +Z */
    { axis: 'x', a: Math.PI / 2 },    /* 4 is -Z */
    { axis: 'x', a: Math.PI },        /* 5 is -Y */
    { axis: 'z', a: -Math.PI / 2 }    /* 6 is -X */
  ];

  function pipTexture(n) {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#ded3bd'; g.fillRect(0, 0, 96, 96);
    g.strokeStyle = '#b3a68c'; g.lineWidth = 4; g.strokeRect(2, 2, 92, 92);
    g.fillStyle = '#1a1512';
    const P = { 1: [[48, 48]], 2: [[28, 28], [68, 68]], 3: [[26, 26], [48, 48], [70, 70]],
      4: [[28, 28], [68, 28], [28, 68], [68, 68]],
      5: [[28, 28], [68, 28], [48, 48], [28, 68], [68, 68]],
      6: [[28, 24], [68, 24], [28, 48], [68, 48], [28, 72], [68, 72]] };
    P[n].forEach(function (p) {
      g.beginPath(); g.arc(p[0], p[1], 9, 0, Math.PI * 2); g.fill();
    });
    return new THREE.CanvasTexture(c);
  }
  const pipTex = [];
  function dieMaterials() {
    if (!pipTex.length) for (let i = 1; i <= 6; i++) pipTex[i] = pipTexture(i);
    /* BoxGeometry face order: +X −X +Y −Y +Z −Z */
    return [1, 6, 2, 5, 3, 4].map(v => new THREE.MeshStandardMaterial({
      map: pipTex[v], roughness: 0.55, metalness: 0.05
    }));
  }

  function throwDie(value, at, pass) {
    const SIZE = 1.7;
    const m = new THREE.Mesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), dieMaterials());
    m.castShadow = true;
    const drop = new THREE.Vector3(at.x + (Math.random() - 0.5) * 3.4, at.y + 9,
                                   at.z + (Math.random() - 0.5) * 3.4);
    m.position.copy(drop);
    fxGroup.add(m);

    /* a pad under it so a pass or a fail reads from across the table */
    let pad = null;
    if (pass !== null && pass !== undefined) {
      pad = new THREE.Mesh(
        new THREE.CircleGeometry(SIZE * 1.15, 28),
        new THREE.MeshBasicMaterial({
          color: pass ? 0xe8c65c : 0x8d2a20, transparent: true, opacity: 0,
          depthWrite: false, side: THREE.DoubleSide
        })
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(drop.x, at.y + 0.05, drop.z);
      fxGroup.add(pad);
    }
    const rest = DIE_FACE[value];
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      rest.axis === 'x' ? rest.a : 0, Math.random() * Math.PI * 2, rest.axis === 'z' ? rest.a : 0, 'YZX'));
    dice.push({
      mesh: m, t: 0, life: 3.2,
      pad: pad,
      from: drop.clone(), to: new THREE.Vector3(drop.x, at.y + SIZE / 2 + 0.02, drop.z),
      spin: new THREE.Vector3(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7),
      target: target
    });
    if (dice.length > 8) {
      const d = dice.shift();
      fxGroup.remove(d.mesh);
      if (d.pad) fxGroup.remove(d.pad);
    }
  }

  /* ------------------------------------------------------------------- shots */

  function tracer(from, to, melee) {
    const a = new THREE.Vector3(from.x, from.z + 0.85, from.y);
    const b = new THREE.Vector3(to.x, to.z + 0.85, to.y);
    if (melee) {
      fx.push({ kind: 'slash', at: b.clone(), t: 0, life: 0.42,
                node: slashNode(b) });
      shake = Math.max(shake, 0.26);
      return;
    }
    const dir = b.clone().sub(a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(0.035, 0.02, len, 6);
    geo.translate(0, len / 2, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffe9b0, transparent: true, opacity: 0.95, depthWrite: false
    }));
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    fxGroup.add(mesh);
    fx.push({ kind: 'tracer', node: mesh, t: 0, life: 0.3 });

    const flash = new THREE.PointLight(0xffcc77, 9, 9, 2);
    flash.position.copy(a);
    fxGroup.add(flash);
    fx.push({ kind: 'flash', node: flash, t: 0, life: 0.13 });

    fx.push({ kind: 'sparks', node: sparkNode(b), t: 0, life: 0.6 });
    shake = Math.max(shake, 0.16);
  }

  function sparkNode(at) {
    const N = 26;
    const pos = new Float32Array(N * 3);
    const vel = [];
    for (let i = 0; i < N; i++) {
      pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const s = 3 + Math.random() * 7;
      vel.push(new THREE.Vector3(Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2,
                                 Math.sin(a) * Math.cos(e) * s));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffc861, size: 0.16, transparent: true, opacity: 1, depthWrite: false
    }));
    pts.userData.vel = vel;
    fxGroup.add(pts);
    return pts;
  }

  function slashNode(at) {
    const g = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.07, 6, 20, Math.PI * 1.1),
      new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 1, depthWrite: false })
    );
    g.position.copy(at);
    g.rotation.set(Math.random() * 0.8 - 0.4, Math.random() * Math.PI, Math.PI / 2.4);
    fxGroup.add(g);
    return g;
  }

  function damagePop(at) {
    fx.push({ kind: 'sparks', node: sparkNode(new THREE.Vector3(at.x, at.y + 0.9, at.z)),
              t: 0, life: 0.7 });
    shake = Math.max(shake, 0.34);
  }

  /* ------------------------------------------------------------------ frame */

  function tick() {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    markerGroup.children.forEach(function (g) {
      if (g.userData.spin) g.userData.spin.rotation.y += dt * 0.5;
    });

    /* dice: fall, tumble, settle */
    for (let i = dice.length - 1; i >= 0; i--) {
      const d = dice[i];
      d.t += dt;
      const drop = Math.min(1, d.t / 0.55);
      const e = 1 - Math.pow(1 - drop, 3);
      d.mesh.position.lerpVectors(d.from, d.to, e);
      if (d.t < 0.55) {
        d.mesh.rotation.x += d.spin.x * dt;
        d.mesh.rotation.y += d.spin.y * dt;
        d.mesh.rotation.z += d.spin.z * dt;
      } else {
        d.mesh.quaternion.slerp(d.target, Math.min(1, dt * 9));
        if (d.t > 0.6 && d.t < 0.68) {
          d.mesh.position.y = d.to.y + Math.sin((d.t - 0.6) / 0.08 * Math.PI) * 0.28;
        }
      }
      if (d.pad) d.pad.material.opacity = Math.min(0.45, Math.max(0, (d.t - 0.5) * 1.4)) *
                                          (d.t > d.life ? Math.max(0, 1 - (d.t - d.life) / 0.5) : 1);
      if (d.t > d.life) {
        const k = Math.min(1, (d.t - d.life) / 0.5);
        d.mesh.material.forEach(m => { m.transparent = true; m.opacity = 1 - k; });
        if (k >= 1) {
          fxGroup.remove(d.mesh);
          if (d.pad) fxGroup.remove(d.pad);
          dice.splice(i, 1);
        }
      }
    }

    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      e.t += dt;
      const k = e.t / e.life;
      if (e.kind === 'tracer') e.node.material.opacity = Math.max(0, 0.95 * (1 - k));
      if (e.kind === 'flash') e.node.intensity = Math.max(0, 9 * (1 - k * k));
      if (e.kind === 'slash') {
        e.node.material.opacity = Math.max(0, 1 - k);
        e.node.scale.setScalar(1 + k * 0.9);
      }
      if (e.kind === 'sparks') {
        const pos = e.node.geometry.attributes.position;
        e.node.userData.vel.forEach(function (v, j) {
          v.y -= 26 * dt;
          pos.setXYZ(j, pos.getX(j) + v.x * dt, Math.max(0.03, pos.getY(j) + v.y * dt),
                     pos.getZ(j) + v.z * dt);
        });
        pos.needsUpdate = true;
        e.node.material.opacity = Math.max(0, 1 - k);
      }
      if (k >= 1) {
        if (e.node.parent) e.node.parent.remove(e.node);
        fx.splice(i, 1);
      }
    }

    if (want) {
      const k = 1 - Math.pow(0.006, dt);
      cam.target.lerp(want.target, k);
      cam.dist += (want.dist - cam.dist) * k;
      placeCamera();
      if (cam.target.distanceTo(want.target) < 0.05 && Math.abs(cam.dist - want.dist) < 0.2) {
        want = null;
      }
    }

    if (shake > 0.001) {
      shake *= Math.pow(0.0015, dt);
      const s = shake;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
    }

    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  /* -------------------------------------------------------------- the state */

  function draw(S, view) {
    if (!board || board.id !== S.board.id) buildBoard(S.board);
    syncUnits(S);
    setOverlay(view);

    /* new dice since last frame get thrown */
    S.dice.forEach(function (d) {
      if (d.at <= seenDice) return;
      seenDice = d.at;
      const w = d.where || (view && view.focus) || { x: S.board.w / 2, y: S.board.h / 2 };
      throwDie(d.value, new THREE.Vector3(w.x, Board.heightAt(S.board, w), w.y), d.pass);
    });
    S.shots.forEach(function (s) {
      if (s.at <= seenShot) return;
      seenShot = s.at;
      tracer(s.from, s.to, s.melee);
    });
    S.units.forEach(function (u) {
      if (u.hitAt !== undefined && u.hitAt > (u.__shown || -1)) {
        u.__shown = u.hitAt;
        damagePop(new THREE.Vector3(u.x, Board.heightAt(S.board, u), u.y));
      }
    });
  }

  /* --------------------------------------------------------------- picking
     Screen to table, in inches, off whatever surface the ray lands on. */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    if (!board) return null;
    const r = canvas.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(terrainGroup.children, false);
    if (hits.length) {
      const p = hits[0].point;
      return { x: p.x, y: p.z, height: p.y };
    }
    return null;
  }

  /* Hit the model itself first — a model standing on a gantry is nowhere near
     the patch of floor its feet project onto. Fall back to proximity so a
     click just beside a base still selects it. */
  /* The nearest of a set of table positions to where the player clicked,
     measured on screen. Raycasting alone is not enough for placement: a wall
     standing between the camera and the spot swallows the ray, and the player
     is aiming at what they can see, not at what the ray hits first. */
  function pickNearest(clientX, clientY, points, maxPx) {
    if (!points || !points.length) return null;
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let best = null, bestD = (maxPx || 46);
    points.forEach(function (p) {
      v.set(p.x, Board.heightAt(board, p) + 0.3, p.y).project(camera);
      if (v.z > 1) return;
      const sx = r.left + (v.x + 1) / 2 * r.width;
      const sy = r.top + (1 - (v.y + 1) / 2) * r.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) { bestD = d; best = p; }
    });
    return best;
  }

  function pickUnit(clientX, clientY, S) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(unitGroup.children, true);
    for (let i = 0; i < hits.length; i++) {
      const id = hits[i].object.userData.unitId;
      if (!id) continue;
      const u = S.units.find(x => x.id === id);
      if (u && u.alive) return u;
    }
    const p = pick(clientX, clientY);
    if (!p) return null;
    let best = null, bestD = 1.1;
    S.units.forEach(function (u) {
      if (!u.alive) return;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < bestD) { bestD = d; best = u; }
    });
    return best;
  }

  function setArt(unitId, src) {
    const tex = new THREE.TextureLoader().load(src, function () { art[unitId] = tex; });
  }

  function focusOn(p) {
    if (!board) return;
    cam.target.set(p.x, 0, p.y);
    clampTarget();
    placeCamera();
  }

  /* Lean in on something small — a 3" reaction is invisible from table height.
     Eased rather than cut, so the player keeps their bearings. */
  function leanIn(p, dist) {
    if (!board) return;
    want = {
      target: new THREE.Vector3(p.x, Board.heightAt(board, p), p.y),
      dist: dist || 20
    };
  }

  function leanOut() {
    if (!board) return;
    want = { target: new THREE.Vector3(board.w / 2, 0, board.h / 2), dist: fitDistance() };
  }

  return {
    attach, resize, draw, pick, pickUnit, pickNearest, setArt, viewFrom, focusOn,
    leanIn, leanOut,
    get camera() { return camera; },
    get scene() { return scene; },
    COL
  };
})();

window.Render3D = Render3D;
window.dispatchEvent(new Event('render3d-ready'));

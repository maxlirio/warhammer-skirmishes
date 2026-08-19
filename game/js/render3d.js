/* =========================================================================
   THE TABLE, IN THREE DIMENSIONS
   One world unit is one inch, so nothing here has to convert anything: a
   model at (22, 15) on the table stands at (22, ground, 15) in the scene, and
   a 12" range is twelve units long. Table x → world X, table y → world Z.

   No rule is decided in this file. It is handed a board of boxes and a list of
   strikes that have already been resolved, and its whole job is to make
   watching them worth the time. An attack is not a number appearing in a log:
   it is a round leaving a barrel, crossing the table, and either finding him
   or going past him into the rockcrete.
   ========================================================================= */

const Render3D = (function () {

  const THREE = window.THREE;

  let renderer, scene, camera, canvas, keyLight, hemiLight, ambient;
  let biome = null;
  let terrainGroup, unitGroup, overlayGroup, fxGroup, markerGroup;
  let relicNode = null;   /* declared up here: drawBoard clears it, and drawBoard
                             runs long before makeRelic is defined */
  const tokenNodes = {};  /* same reason */
  const unitNodes = {};
  let board = null;
  let lastT = 0;
  const fx = [];
  const cine = [];
  let playing = null;
  let seenStrike = -1;
  let lastState = null;
  const seenClimb = {};
  let shake = 0;

  const COL = {
    p0: 0x5687b4, p1: 0xa8352a,
    gold: 0xb8912f, goldLit: 0xe8c65c, bone: 0xd9cfbc,
    move: 0x5687b4, sight: 0xb8912f, watch: 0xa8352a,
    blood: 0x6d1410, spark: 0xffc861
  };

  const MODEL = { astra: 'astronautA', greyknights: 'astronautB', orks: 'alien' };

  /* ------------------------------------------------------------ the camera */

  const cam = { az: -Math.PI / 2, el: 0.78, dist: 46, target: new THREE.Vector3() };
  let want = null, userZoomed = false;
  const held = {};

  function placeCamera() {
    const r = cam.dist * Math.cos(cam.el);
    camera.position.set(
      cam.target.x + r * Math.cos(cam.az),
      cam.target.y + cam.dist * Math.sin(cam.el),
      cam.target.z + r * Math.sin(cam.az));
    camera.lookAt(cam.target);
  }

  /* Dragging looks around the table. A click is a press and release that did
     not go anywhere — so the left button both orbits and selects, which is what
     everybody expects, rather than reserving it for clicks and hiding the
     camera behind a modifier key. */
  let onTap = null;
  const setTap = fn => { onTap = fn; };

  function wireCamera() {
    let drag = null;
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY,
               pan: e.button === 2 || e.shiftKey, moved: 0, id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.moved < 4) return;              /* still might be a click */
      want = null;
      userZoomed = true;
      if (drag.pan) {
        const s2 = cam.dist * 0.0016;
        const right = new THREE.Vector3(Math.sin(cam.az), 0, -Math.cos(cam.az));
        const fwd = new THREE.Vector3(Math.cos(cam.az), 0, Math.sin(cam.az));
        cam.target.addScaledVector(right, -dx * s2).addScaledVector(fwd, -dy * s2);
        clampTarget();
      } else {
        cam.az += dx * 0.007;
        cam.el = Math.max(0.10, Math.min(1.48, cam.el + dy * 0.006));
      }
      placeCamera();
    });

    const release = function (e) {
      if (!drag) return;
      const wasClick = drag.moved < 5 && !drag.pan;
      const d = drag;
      drag = null;
      if (wasClick && onTap) onTap(d.x0, d.y0);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', function () { drag = null; });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      userZoomed = true; want = null;
      cam.dist = Math.max(5, Math.min(140, cam.dist * (1 + Math.sign(e.deltaY) * 0.11)));
      placeCamera();
    }, { passive: false });

    /* and the keyboard, for people who would rather not drag at all */
    window.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      const pan = function (fx, fz) {
        const step = cam.dist * 0.06;
        const right = new THREE.Vector3(Math.sin(cam.az), 0, -Math.cos(cam.az));
        const fwd = new THREE.Vector3(Math.cos(cam.az), 0, Math.sin(cam.az));
        cam.target.addScaledVector(right, fx * step).addScaledVector(fwd, fz * step);
        clampTarget();
      };
      let used = true;
      /* A tap still nudges; HOLDING now drives, which is what "WASD movement"
         means to anyone who has played anything. The frame loop reads `held`. */
      if ('wasd'.indexOf(k) >= 0 || k.indexOf('arrow') === 0 ||
          k === 'q' || k === 'e' || k === 'r' || k === 'f') held[k] = true;
      if (k === 'a' || k === 'arrowleft') pan(-1, 0);
      else if (k === 'd' || k === 'arrowright') pan(1, 0);
      else if (k === 'w' || k === 'arrowup') pan(0, -1);
      else if (k === 's' || k === 'arrowdown') pan(0, 1);
      else if (k === 'q') cam.az -= 0.12;
      else if (k === 'e') cam.az += 0.12;
      else if (k === 'r') cam.el = Math.min(1.48, cam.el + 0.07);
      else if (k === 'f') cam.el = Math.max(0.10, cam.el - 0.07);
      else if (k === '=' || k === '+') cam.dist = Math.max(5, cam.dist * 0.9);
      else if (k === '-' || k === '_') cam.dist = Math.min(140, cam.dist * 1.1);
      else if (k === ' ') { userZoomed = false; frameTable(); used = true; }
      else used = false;
      if (used) { want = null; if (k !== ' ') userZoomed = true; placeCamera(); e.preventDefault(); }
    });
    window.addEventListener('keyup', function (e) { delete held[e.key.toLowerCase()]; });
    window.addEventListener('blur', function () { for (const k in held) delete held[k]; });
  }

  /* Called every frame: whatever is being held down, keep doing. */
  function flyCamera(dt) {
    let moved = false;
    const step = cam.dist * 1.1 * dt;
    const right = new THREE.Vector3(Math.sin(cam.az), 0, -Math.cos(cam.az));
    const fwd = new THREE.Vector3(Math.cos(cam.az), 0, Math.sin(cam.az));
    const go = function (fx, fz) {
      cam.target.addScaledVector(right, fx * step).addScaledVector(fwd, fz * step);
      moved = true;
    };
    if (held.a || held.arrowleft) go(-1, 0);
    if (held.d || held.arrowright) go(1, 0);
    if (held.w || held.arrowup) go(0, -1);
    if (held.s || held.arrowdown) go(0, 1);
    if (held.q) { cam.az -= 1.6 * dt; moved = true; }
    if (held.e) { cam.az += 1.6 * dt; moved = true; }
    if (held.r) { cam.el = Math.min(1.48, cam.el + 1.0 * dt); moved = true; }
    if (held.f) { cam.el = Math.max(0.10, cam.el - 1.0 * dt); moved = true; }
    if (moved) { clampTarget(); want = null; userZoomed = true; placeCamera(); }
  }

  function clampTarget() {
    if (!board) return;
    cam.target.x = Math.max(-8, Math.min(board.w + 8, cam.target.x));
    cam.target.z = Math.max(-8, Math.min(board.h + 8, cam.target.z));
  }

  function fitDistance() {
    const corners = [];
    [0, board.w].forEach(x => [0, board.h].forEach(z => corners.push(new THREE.Vector3(x, 0, z))));
    const fits = function (d) {
      const r = d * Math.cos(cam.el);
      const probe = camera.clone();
      probe.position.set(cam.target.x + r * Math.cos(cam.az),
                         cam.target.y + d * Math.sin(cam.el),
                         cam.target.z + r * Math.sin(cam.az));
      probe.lookAt(cam.target);
      probe.updateMatrixWorld();
      probe.updateProjectionMatrix();
      return corners.every(function (c) {
        const p = c.clone().project(probe);
        return Math.abs(p.x) < 0.98 && Math.abs(p.y) < 0.96 && p.z < 1;
      });
    };
    let lo = 8, hi = 220;
    if (!fits(hi)) return hi;
    for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    return hi;
  }

  function projectedBox() {
    const v = new THREE.Vector3();
    let minx = 9, maxx = -9, miny = 9, maxy = -9;
    [0, board.w].forEach(x => [0, board.h].forEach(z => {
      v.set(x, 0, z).project(camera);
      minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x);
      miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y);
    }));
    return { minx, maxx, miny, maxy };
  }

  /* Aim at the middle of what actually lands on screen, not the middle of the
     table — looking down from one end, the near edge alone would decide the
     distance and the rest of the frame would be sky. */
  function frameTable() {
    const err = function () {
      cam.dist = fitDistance();
      placeCamera();
      const b = projectedBox();
      return Math.abs((b.miny + b.maxy) / 2) + Math.abs((b.minx + b.maxx) / 2);
    };
    let best = err();
    const ground = new THREE.Vector3(Math.cos(cam.az), 0, Math.sin(cam.az));
    const right = new THREE.Vector3(Math.sin(cam.az), 0, -Math.cos(cam.az));
    let sf = board.h * 0.25, sr = board.w * 0.12;
    for (let pass = 0; pass < 22 && best > 0.004; pass++) {
      let moved = false;
      [[ground, sf], [ground, -sf], [right, sr], [right, -sr]].forEach(function (t) {
        if (moved) return;
        const keep = cam.target.clone();
        cam.target.addScaledVector(t[0], t[1]);
        clampTarget();
        const e = err();
        if (e < best - 1e-4) { best = e; moved = true; } else { cam.target.copy(keep); }
      });
      if (!moved) { sf *= 0.5; sr *= 0.5; if (sf < 0.02) break; }
    }
    cam.dist = fitDistance();
    placeCamera();
  }

  function viewFrom(player) {
    if (!board) return;              /* nothing to frame yet */
    userZoomed = false;
    want = null;
    cam.az = player === 0 ? Math.PI : 0;
    cam.el = 0.78;
    cam.target.set(board.w / 2, 0, board.h / 2);
    frameTable();
  }

  function leanIn(p, dist) {
    if (!board) return;
    userZoomed = true;
    want = { target: new THREE.Vector3(p.x, Board.heightAt(board, p) + 0.6, p.y),
             dist: dist || 20, ease: 0.006 };
  }

  function leanOut() {
    if (!board) return;
    const kt = cam.target.clone(), kd = cam.dist, ka = cam.az, ke = cam.el;
    cam.el = 0.78;
    cam.az = ka;
    frameTable();
    want = { target: cam.target.clone(), dist: cam.dist, el: cam.el, ease: 0.03 };
    cam.target.copy(kt); cam.dist = kd; cam.az = ka; cam.el = ke;
    placeCamera();
    userZoomed = false;
  }

  /* ------------------------------------------------------------------ setup */

  function attach(cv) {
    canvas = cv;
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = skyTexture(null);
    scene.fog = new THREE.FogExp2(0x2f3138, 0.0052);

    camera = new THREE.PerspectiveCamera(42, 1, 0.4, 600);

    hemiLight = new THREE.HemisphereLight(0xbcd0e8, 0x4a3a26, 1.45);
    scene.add(hemiLight);
    ambient = new THREE.AmbientLight(0xfff2dd, 0.16);
    scene.add(ambient);
    keyLight = new THREE.DirectionalLight(0xffe8c4, 3.1);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0011;
    keyLight.shadow.normalBias = 0.035;
    scene.add(keyLight, keyLight.target);
    /* A cold rim off the opposite shoulder, so edges separate from the ground
       instead of everything sinking into one brown.

       It was a strong blue at 1.5 — nearly as bright as the key — with a warm
       back light against it, which is a perfectly good way to light FLAT grey
       and a terrible way to light real concrete: blue fill plus warm ambient
       on a neutral surface comes out lilac, and every building on the table
       was reading pink. Both are dialled back to what a rim light is for,
       which is an edge, not a wash. */
    const rim = new THREE.DirectionalLight(0xa8c0e0, 0.5);
    rim.position.set(34, 16, 30);
    scene.add(rim);
    const back = new THREE.DirectionalLight(0xffb887, 0.32);
    back.position.set(-20, 10, 34);
    scene.add(back);

    terrainGroup = new THREE.Group();
    unitGroup = new THREE.Group();
    overlayGroup = new THREE.Group();
    fxGroup = new THREE.Group();
    markerGroup = new THREE.Group();
    scene.add(terrainGroup, markerGroup, overlayGroup, stains, unitGroup, fxGroup);

    buildTray();
    wireCamera();
    if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(canvas);
    lastT = performance.now();
    tick();
  }

  /* ---------------------------------------------------------- the dice bowl
     The dice are thrown in a bowl beside the table, not onto it. It is hung off
     the camera, so it is always in the corner of the screen and looking at a
     roll never means going anywhere. One die at a time. */
  let tray = null, trayDie = null, trayLabel = null;
  const rolls = [];             // waiting to be thrown
  let rolling = null;

  const DIE_FACE = [null,
    { axis: 'z', a: Math.PI / 2 },    /* 1 is +X */
    { axis: 'x', a: 0 },              /* 2 is +Y */
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
    g.strokeStyle = '#9c8f76'; g.lineWidth = 4; g.strokeRect(2, 2, 92, 92);
    g.fillStyle = '#1a1512';
    ({ 1: [[48, 48]], 2: [[28, 28], [68, 68]], 3: [[26, 26], [48, 48], [70, 70]],
       4: [[28, 28], [68, 28], [28, 68], [68, 68]],
       5: [[28, 28], [68, 28], [48, 48], [28, 68], [68, 68]],
       6: [[28, 24], [68, 24], [28, 48], [68, 48], [28, 72], [68, 72]] })[n]
      .forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 9, 0, 6.28); g.fill(); });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const pipTex = [];
  function dieMaterials() {
    if (!pipTex.length) for (let i = 1; i <= 6; i++) pipTex[i] = pipTexture(i);
    /* BoxGeometry face order is +X −X +Y −Y +Z −Z */
    return [1, 6, 2, 5, 3, 4].map(v => new THREE.MeshStandardMaterial({
      map: pipTex[v], roughness: 0.5, metalness: 0.05 }));
  }

  function trayText(top, bottom) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    g.fillStyle = '#e8c65c';
    g.font = '700 30px Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText(top || '', 128, 32);
    g.fillStyle = '#cfc4ae';
    g.font = '600 22px Impact, sans-serif';
    g.fillText(bottom || '', 128, 66);
    return new THREE.CanvasTexture(c);
  }

  function buildTray() {
    tray = new THREE.Group();
    /* a shallow bowl */
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.15, 0.5, 34, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a251f, roughness: 0.7, metalness: 0.6,
                                       side: THREE.DoubleSide }));
    bowl.position.y = 0.25;
    tray.add(bowl);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 34),
      new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    tray.add(floor);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.075, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0xb8912f, roughness: 0.35, metalness: 0.9 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.5;
    tray.add(rim);

    trayDie = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), dieMaterials());
    trayDie.visible = false;
    tray.add(trayDie);

    trayLabel = new THREE.Sprite(new THREE.SpriteMaterial({
      map: trayText('', ''), depthTest: false, transparent: true }));
    trayLabel.scale.set(2.4, 0.9, 1);
    trayLabel.position.set(0, 1.5, 0);
    tray.add(trayLabel);

    /* its own light, so it reads whatever the table is doing */
    const l = new THREE.PointLight(0xffe0b0, 3.2, 8, 2);
    l.position.set(1, 2.2, 1.4);
    tray.add(l);

    /* tipped toward the viewer so you are looking into the bowl, not at
       the back of it */
    tray.rotation.set(0.62, -0.22, 0);
    tray.visible = false;
    camera.add(tray);
    scene.add(camera);
    layoutTray();
  }

  /* Tucked into the bottom corner whatever shape the window is, and never
     hanging off the edge of it. */
  function layoutTray() {
    if (!tray || !camera) return;
    const d = 7;
    const halfH = d * Math.tan((camera.fov * Math.PI / 180) / 2);
    const halfW = halfH * camera.aspect;
    const scale = Math.min(0.62, halfH / 4.4);
    tray.scale.setScalar(scale);
    const r = 1.75 * scale;
    tray.position.set(halfW - r - 0.3, -halfH + r * 1.55, -d);
  }

  /* Ask for a die. They queue, and are thrown one at a time. */
  function rollDie(value, target, label) {
    rolls.push({ value: value, target: target, label: label || '' });
  }

  const rollingNow = () => !!rolling || rolls.length > 0;

  function stepTray(dt) {
    if (!rolling && rolls.length) {
      rolling = rolls.shift();
      rolling.t = 0;
      tray.visible = true;
      trayDie.visible = true;
      trayDie.position.set((Math.random() - 0.5) * 0.5, 2.6, (Math.random() - 0.5) * 0.5);
      trayDie.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      rolling.spin = new THREE.Vector3(Math.random() * 16 - 8, Math.random() * 16 - 8,
                                       Math.random() * 16 - 8);
      const f = DIE_FACE[rolling.value];
      rolling.rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        f.axis === 'x' ? f.a : 0, Math.random() * Math.PI * 2, f.axis === 'z' ? f.a : 0, 'YZX'));
      rolling.from = trayDie.position.clone();
      trayLabel.material.map = trayText(rolling.label,
        rolling.target ? 'NEEDS ' + rolling.target + '+' : '');
      trayLabel.material.needsUpdate = true;
      Sfx.step(0.5);
    }
    if (!rolling) return;
    rolling.t += dt;
    const drop = Math.min(1, rolling.t / 0.5);
    const e = 1 - Math.pow(1 - drop, 3);
    trayDie.position.lerpVectors(rolling.from, new THREE.Vector3(0, 0.34, 0), e);
    if (rolling.t < 0.5) {
      trayDie.rotation.x += rolling.spin.x * dt;
      trayDie.rotation.y += rolling.spin.y * dt;
      trayDie.rotation.z += rolling.spin.z * dt;
    } else {
      trayDie.quaternion.slerp(rolling.rest, Math.min(1, dt * 10));
      if (rolling.t > 0.52 && rolling.t < 0.62) {
        trayDie.position.y = 0.34 + Math.sin((rolling.t - 0.52) / 0.1 * Math.PI) * 0.18;
        if (!rolling.clacked) { rolling.clacked = true; Sfx.clang(0.28); }
      }
      if (!rolling.said && rolling.t > 0.75) {
        rolling.said = true;
        const ok = rolling.target ? (rolling.value !== 1 && rolling.value >= rolling.target) : null;
        trayLabel.material.map = trayText(rolling.label,
          ok === null ? rolling.value + '"' : (ok ? 'PASSED' : 'FAILED'));
        trayLabel.material.needsUpdate = true;
      }
    }
    if (rolling.t > 1.5) rolling = null;
  }

  function skyTexture(biome) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 256;
    const g = c.getContext('2d');
    const stops = (biome && biome.sky) || ['#070a14', '#25272e', '#4a4038', '#6d5540'];
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, stops[0]);
    grd.addColorStop(0.5, stops[1]);
    grd.addColorStop(0.8, stops[2]);
    grd.addColorStop(1, stops[3]);
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* Sun, bounce and haze, set from whatever ground this is. */
  function applyBiome(b) {
    const bi = MAPS.biomeOf(b);
    scene.background = skyTexture(bi);
    scene.fog = new THREE.FogExp2(bi.fog, bi.fogD);
    /* PROPERLY LIT, not floodlit.

       These numbers were tuned against flat untextured colour, where you have
       to overdrive the key to see any shape at all. With real surfaces the
       shape comes from the normal maps, and the same key washes everything to
       cream — which is why the rockcrete tables looked bleached. Pulled down
       across the board; contrast now comes from the materials. */
    renderer.toneMappingExposure = (bi.expose || 1.2) * 0.82;
    /* Pulled most of the way to white. These light colours were picked when
       every surface was a flat untinted grey and the light was the only thing
       giving a biome its character — so they are strong: the graveyard's key
       is a lilac. Now the surfaces carry their own colour, and a lilac key
       over grey concrete gives you a pink building. The biome still shows in
       the sky, the fog and the ground material; it no longer paints the
       stonework. */
    keyLight.color.setHex(bi.key.colour).lerp(new THREE.Color(0xffffff), 0.6);
    keyLight.intensity = bi.key.power * 0.78;
    hemiLight.color.setHex(bi.hemi.sky).lerp(new THREE.Color(0xdfe4ea), 0.45);
    hemiLight.groundColor.setHex(bi.hemi.gnd);
    hemiLight.intensity = bi.hemi.power * 0.72;
    return bi;
  }

  function resize() {
    if (!renderer) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (Math.abs(camera.aspect - w / h) < 1e-6 &&
        canvas.width === Math.round(w * renderer.getPixelRatio())) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    layoutTray();
    if (board && !userZoomed) frameTable();
  }

  /* -------------------------------------------------------------- the table */

  function groundTexture(w, h, bi) {
    const G = bi.ground;
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = G.base;
    g.fillRect(0, 0, 512, 512);

    /* slabs, but only where the ground is made of slabs */
    if (bi.mass === 'panel' || bi.deck === 'panel') {
      for (let y = 0; y < 512; y += 64) {
        for (let x = 0; x < 512; x += 64) {
          const v = Assets.seeded(x * 7 + y * 13);
          g.fillStyle = 'rgba(0,0,0,' + (0.02 + v * 0.08).toFixed(3) + ')';
          g.fillRect(x + 1, y + 1, 62, 62);
          g.strokeStyle = G.crack;
          g.globalAlpha = 0.5;
          g.lineWidth = 2;
          g.strokeRect(x + 1, y + 1, 62, 62);
          g.globalAlpha = 1;
        }
      }
    }

    /* wind ripples across sand */
    if (G.ripple) {
      g.strokeStyle = 'rgba(255,240,205,.22)';
      g.lineWidth = 3;
      for (let i = 0; i < 46; i++) {
        const y0 = Assets.seeded(i * 31) * 512;
        g.beginPath();
        for (let x = 0; x <= 512; x += 16) {
          g.lineTo(x, y0 + Math.sin((x / 512) * 6.28 * (1 + Assets.seeded(i) * 2) + i) * 14);
        }
        g.stroke();
      }
    }

    /* cracked earth */
    if (G.crackle) {
      g.strokeStyle = G.crack;
      g.lineWidth = 2;
      for (let i = 0; i < 90; i++) {
        let x = Assets.seeded(i * 17) * 512, y = Assets.seeded(i * 41) * 512;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          x += (Assets.seeded(i * 7 + k) - 0.5) * 60;
          y += (Assets.seeded(i * 11 + k) - 0.5) * 60;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }

    /* leaf litter */
    if (G.litter) {
      for (let i = 0; i < 900; i++) {
        const v = Assets.seeded(i * 13);
        g.fillStyle = v < 0.4 ? 'rgba(96,84,40,.5)' : v < 0.75 ? 'rgba(58,70,34,.5)'
                                                               : 'rgba(120,96,48,.4)';
        const x = Assets.seeded(i * 29) * 512, y = Assets.seeded(i * 53) * 512;
        g.save(); g.translate(x, y); g.rotate(v * 6.28);
        g.fillRect(-4, -1.6, 8, 3.2);
        g.restore();
      }
    }

    /* grit everywhere */
    for (let i = 0; i < 1400; i++) {
      const v = Assets.seeded(i * 7 + 3);
      g.fillStyle = G.grit;
      g.globalAlpha = 0.05 + v * 0.28;
      const x = Assets.seeded(i * 19) * 512, y = Assets.seeded(i * 37) * 512;
      g.fillRect(x, y, 1 + v * 3, 1 + v * 3);
    }
    g.globalAlpha = 1;

    /* embers glowing in the ash */
    if (G.ember) {
      for (let i = 0; i < 120; i++) {
        const v = Assets.seeded(i * 61);
        const x = Assets.seeded(i * 23) * 512, y = Assets.seeded(i * 43) * 512;
        const grd = g.createRadialGradient(x, y, 0, x, y, 3 + v * 7);
        grd.addColorStop(0, 'rgba(255,140,40,' + (0.25 + v * 0.5).toFixed(2) + ')');
        grd.addColorStop(1, 'rgba(255,90,20,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, 3 + v * 7, 0, 6.28); g.fill();
      }
    }

    /* damp patches and general filth */
    for (let i = 0; i < 260; i++) {
      const v = Assets.seeded(i * 31 + 11);
      const r = 10 + v * 60;
      const x = Assets.seeded(i * 17) * 512, y = Assets.seeded(i * 53) * 512;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(20,16,12,' + (0.03 + v * G.wet * 2.2).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(20,16,12,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
    }

    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 9, h / 9);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  /* Worn plate: panel lines, rivets, rust streaks, and a hazard band along the
     top edge so the height of a piece reads at a glance. Cached by key, since
     the same biome asks for the same one over and over. */
  const panelCache = {};
  function panelTexture(key, hazard) {
    if (panelCache[key]) return panelCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#8f877a';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      for (let x = 0; x < 256; x += 64) {
        const v = Assets.seeded(x * 3 + y * 7 + key.length);
        g.fillStyle = 'rgba(255,252,244,' + (0.05 + v * 0.13).toFixed(3) + ')';
        g.fillRect(x + 1, y + 1, 62, 30);
        g.strokeStyle = 'rgba(24,20,16,.62)';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, 62, 30);
        g.fillStyle = 'rgba(20,17,13,.6)';
        [[x + 6, y + 6], [x + 58, y + 6], [x + 6, y + 26], [x + 58, y + 26]].forEach(function (r) {
          g.beginPath(); g.arc(r[0], r[1], 1.9, 0, 6.28); g.fill();
        });
      }
    }
    for (let i = 0; i < 60; i++) {
      const v = Assets.seeded(i * 91 + key.length * 13);
      const x = v * 256, y = Assets.seeded(i * 41) * 256;
      const h = 12 + Assets.seeded(i * 7) * 70;
      const grd = g.createLinearGradient(x, y, x, y + h);
      grd.addColorStop(0, 'rgba(120,66,28,' + (0.12 + v * 0.3).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(120,66,28,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, 2 + v * 5, h);
    }
    if (hazard) {
      g.save();
      g.beginPath(); g.rect(0, 0, 256, 26); g.clip();
      g.fillStyle = '#b8912f';
      g.fillRect(0, 0, 256, 26);
      g.fillStyle = '#17140f';
      for (let x = -26; x < 280; x += 26) {
        g.beginPath();
        g.moveTo(x, 0); g.lineTo(x + 13, 0); g.lineTo(x + 13 - 26, 26); g.lineTo(x - 26, 26);
        g.closePath(); g.fill();
      }
      g.fillStyle = 'rgba(20,16,12,.18)';
      g.fillRect(0, 0, 256, 26);
      g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    panelCache[key] = t;
    return t;
  }

  /* Rock, stone, sand and timber — mottled and bedded rather than riveted.
     A snowfield of panelled plate looks like a factory somebody painted white. */
  const natCache = {};
  function naturalTexture(key, _unused, kind) {
    if (natCache[key]) return natCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const base = { rock: '#b9c4cc', stone: '#9d988e', sandstone: '#c9ae80', wood: '#8b6b45' }[kind]
                 || '#a0998e';
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);

    if (kind === 'wood') {
      for (let i = 0; i < 22; i++) {
        const y = (i / 22) * 256;
        g.strokeStyle = 'rgba(60,40,22,' + (0.15 + Assets.seeded(i * 7) * 0.3).toFixed(2) + ')';
        g.lineWidth = 1 + Assets.seeded(i * 3) * 3;
        g.beginPath();
        for (let x = 0; x <= 256; x += 12) {
          g.lineTo(x, y + Math.sin(x / 40 + i) * 3);
        }
        g.stroke();
      }
    } else {
      /* bedding planes */
      for (let i = 0; i < 14; i++) {
        const y = Assets.seeded(i * 31) * 256;
        g.strokeStyle = 'rgba(30,26,22,' + (0.08 + Assets.seeded(i * 5) * 0.16).toFixed(2) + ')';
        g.lineWidth = 2 + Assets.seeded(i * 11) * 5;
        g.beginPath();
        for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x / 55 + i) * 7);
        g.stroke();
      }
    }
    /* mottle */
    for (let i = 0; i < 700; i++) {
      const v = Assets.seeded(i * 13 + key.length);
      const x = Assets.seeded(i * 29) * 256, y = Assets.seeded(i * 47) * 256;
      const r = 2 + v * 16;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = v < 0.5;
      grd.addColorStop(0, (dark ? 'rgba(40,36,30,' : 'rgba(255,252,244,') + (0.05 + v * 0.14).toFixed(3) + ')');
      grd.addColorStop(1, dark ? 'rgba(40,36,30,0)' : 'rgba(255,252,244,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    natCache[key] = t;
    return t;
  }

  function buildBoard(b) {
    board = b;
    biome = applyBiome(b);
    stairsPlaced = [];
    [terrainGroup, markerGroup].forEach(g => { while (g.children.length) g.remove(g.children[0]); });
    relicNode = null;      /* it lived in markerGroup, which was just emptied */
    Object.keys(tokenNodes).forEach(k => { delete tokenNodes[k]; });

    /* The floor of the battlefield, as a real surface rather than a blurred
       painting of one. The old ground texture was smeared noise with scribbly
       cracks drawn on it; this is the same procedural material the buildings
       are made of, with a normal map, so the light rakes across it. */
    const groundName = (PAL[biome.mass] || PAL.panel).ground;
    const floorMat = typeof Mats !== 'undefined'
      /* Toned well down. A floor is horizontal, so it takes the key light
         square on while every wall takes it at a glance — the same material
         that reads as grey concrete on a wall goes to white paper on the
         ground, and the brightest thing on the battlefield ends up being the
         floor. */
      ? Mats.material(groundName, b.w, b.h, { inchesPerTile: 3.6, bump: 1.25,
                                              color: 0x7c7a74 })
      : new THREE.MeshStandardMaterial({ map: groundTexture(b.w, b.h, biome),
                                         roughness: 0.94 - biome.ground.wet, metalness: 0.04 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(b.w, 1, b.h), floorMat);
    floor.position.set(b.w / 2, -0.5, b.h / 2);
    floor.receiveShadow = true;
    terrainGroup.add(floor);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(b.w + 2, 1.4, b.h + 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(biome.ground.crack).multiplyScalar(0.7),
                                       roughness: 1 }));
    lip.position.set(b.w / 2, -0.82, b.h / 2);
    terrainGroup.add(lip);

    b.deploy.forEach(function (z, i) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(z.w, z.h),
        new THREE.MeshBasicMaterial({ color: i === 0 ? COL.p0 : COL.p1, transparent: true,
                                      opacity: 0.09, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(z.x + z.w / 2, 0.015, z.y + z.h / 2);
      terrainGroup.add(m);
    });

    b.terrain.forEach((t, i) => terrainGroup.add(dressTerrain(t, i)));
    groundWorks(b);
    scatterGround(b);

    const span = Math.max(b.w, b.h) * 0.8;
    keyLight.position.set(b.w / 2 - span * 0.55, span * 1.6, b.h / 2 - span * 0.45);
    keyLight.target.position.set(b.w / 2, 0, b.h / 2);
    keyLight.target.updateMatrixWorld();
    const sc = keyLight.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span;
    sc.near = 1; sc.far = span * 4.2;
    sc.updateProjectionMatrix();

    b.objectives.forEach(function (o) {
      const g = new THREE.Group();
      /* An objective is a thing worth dying over, so it is built rather than
         borrowed: an armoured plinth carrying a cogitator stack with its
         status lumen still lit. The kit turret sitting on a gold ring read as
         a toy parked on the carpet. */
      if (typeof Mats !== 'undefined') {
        const plate = Mats.material('steel', 1.6, 1.6, { bump: 1.2 });
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 0.34, 8), plate);
        base.position.y = 0.17; base.castShadow = true; base.receiveShadow = true;
        const stack = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.05, 0.78), plate);
        stack.position.y = 0.86; stack.castShadow = true;
        const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.42, 8), plate);
        cowl.position.y = 1.58;
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 10),
          new THREE.MeshStandardMaterial({ color: COL.goldLit, emissive: 0xffb43c,
                                           emissiveIntensity: 2.6, roughness: 0.35 }));
        lamp.position.y = 1.9;
        const glow = new THREE.PointLight(0xffb43c, 2.2, 6, 2);
        glow.position.y = 1.9;
        g.add(base, stack, cowl, lamp, glow);
        /* a hazard collar, because people work round this thing */
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.2, 8),
                                      Mats.material('hazard', 2.2, 0.4, { bump: 0.7 }));
        collar.position.y = 0.44;
        g.add(collar);
      } else if (Assets.has('turret_single')) {
        g.add(Assets.fitted('turret_single', 1.5, 1.5, 1.2));
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 8, 44),
        new THREE.MeshStandardMaterial({ color: COL.gold, emissive: 0x4a3a10,
                                         roughness: 0.35, metalness: 0.8 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      g.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.0, 9, 18, 1, true),
        new THREE.MeshBasicMaterial({ color: COL.goldLit, transparent: true, opacity: 0.07,
                                      side: THREE.DoubleSide, depthWrite: false }));
      beam.position.y = 4.5;
      g.add(beam);
      g.position.set(o.x, Board.heightAt(b, o) + 0.02, o.y);
      g.userData.spin = beam;
      markerGroup.add(g);
    });

    viewFrom(0);
  }

  /* A rules box, dressed in real scenery. The box is the truth and this is only
     the costume — it never sticks out past the footprint the rules measure, so
     nothing on the table looks like cover that is not. */
  /* What a piece of terrain is made of, by biome. The BOX never changes — this
     is only what stands in it. */
  const MASS = {
    panel:     { side: 0xbdb6a9, cap: 0xa9a397, rough: 0.85, metal: 0.32, hazard: true },
    stone:     { side: 0x9a958c, cap: 0x87837a, rough: 0.95, metal: 0.06 },
    rock:      { side: 0xa8b4bd, cap: 0xc9d6de, rough: 0.92, metal: 0.03 },
    sandstone: { side: 0xc4a878, cap: 0xd8bf90, rough: 0.96, metal: 0.02 },
    wood:      { side: 0x8a6a44, cap: 0x9c7b50, rough: 0.9,  metal: 0.02 }
  };

  /* What a piece of terrain is BUILT OUT OF — models, not a skin.

     A box wearing a concrete texture is a box wearing a concrete texture, and
     it reads as one from any angle: the corners are too sharp, the silhouette
     is too regular, and the eye finds the repeat in the texture immediately.
     So a blocking piece is now courses of real wall with the top course
     knocked about, and a rise in a natural biome is a crag of stacked rock.

     The rules box is still the only truth. Nothing built here reaches past
     t.w × t.h, and the silhouette still FILLS it — a ruin you can see through
     is a ruin the rules will not let you shoot through, and that lie is worse
     than a plain box. Hence the dark core inside: a gap in the wall shows
     shadow, never daylight. */
  /* Everything on this table has to look quarried from the same ground. The
     kit arrives in its own cheerful palettes — a cream wall here, a bright
     orange column there — and dropping the models in raw is exactly why the
     battlefield read as a toy playset. So each piece is pulled hard onto the
     colour of the ground it stands on, with a little per-piece variance so it
     does not go flat. The handrails have always been done this way; now
     everything is. */
  function tintTo(obj, colour, amount, seed) {
    const target = new THREE.Color(colour);
    let i = 0;
    obj.traverse(function (o) {
      if (!o.isMesh || !o.material || o.userData.tinted) return;
      o.userData.tinted = true;
      const many = Array.isArray(o.material);
      const out = (many ? o.material : [o.material]).map(function (m) {
        const c = m.clone();
        if (c.color) {
          const v = 0.84 + Assets.seeded((seed || 0) + (i++) * 71) * 0.3;
          c.color.lerp(target, amount).multiplyScalar(v);
        }
        if (c.emissive) c.emissive.multiplyScalar(0.2);
        c.roughness = Math.min(1, (c.roughness === undefined ? 0.8 : c.roughness) + 0.18);
        c.metalness = Math.min(1, (c.metalness || 0) * 0.6);
        return c;
      });
      o.material = many ? out : out[0];
    });
    return obj;
  }

  /* What each ground is BUILT of, in procedural surfaces rather than kit
     models. `shell` is the mass, `trim` the slabs, copings and lintels. */
  const PAL = {
    panel:     { shell: 'rockcrete', trim: 'rockcrete', ground: 'ash' },
    stone:     { shell: 'stone',     trim: 'stone',     ground: 'loam' },
    rock:      { shell: 'stone',     trim: 'stone',     ground: 'snow' },
    sandstone: { shell: 'stone',     trim: 'stone',     ground: 'sand' },
    wood:      { shell: 'stone',     trim: 'stone',     ground: 'loam' }
  };

  /* HOW BIG A THING ACTUALLY IS.

     Everything that stood on a piece was scaled to the PIECE's height, which
     is fine for a tree and absurd for anything else: a gravestone is about
     chest high, and blowing one up to four inches to fill a blocking piece
     gives you a row of ginormous monoliths shoulder to shoulder. Height is a
     property of the object, not of the rectangle it happens to stand in. */
  const REAL_HEIGHT = {
    tree_pineTallA: 3.8, tree_pineRoundC: 2.9, tree_pineSmallA: 1.7,
    tree_pineGroundA: 1.2, tree_oak: 3.5, tree_detailed: 3.2, tree_thin: 3.1,
    tree_autumn: 3.3, tree_palmTall: 4.0, tree_palmShort: 2.6, tree_trunk: 2.4,
    tree_deadlog: 0.5, cactus_tall: 2.3, cactus_short: 1.1,
    rock_largeA: 1.4, rock_largeB: 1.5, rock_largeC: 1.6, rock_tallA: 1.9,
    rock_tallC: 1.8, rock_sandA: 1.1, rock_sandB: 1.3, rock_sandC: 1.0,
    rock: 0.9, rock_smallA: 0.5, rock_smallC: 0.45, rocks_smallA: 0.4,
    gravestone_cross: 1.0, gravestone_round: 0.85, gravestone_broken: 0.65,
    pillar_obelisk: 2.6, column_large: 2.8, crypt_small: 1.7,
    stone_tallB: 1.6, stone_largeB: 1.2,
    stump_old: 0.7, stump_round: 0.55, log: 0.45, log_stack: 0.8,
    plant_bush: 0.7, plant_bushLarge: 1.1, grass: 0.35, grass_large: 0.5
  };
  const realHeight = name => REAL_HEIGHT[name] || 1.4;

  const RUIN = {
    panel:     { walls: ['structure_closed', 'structure_metal_wall', 'structure_detailed'],
                 post: 'column_large', course: 2.2, debris: 'metal_panel' },
    stone:     { walls: ['stone_wall_damaged', 'stone_wall', 'structure_closed'],
                 post: 'column_large', course: 1.9, debris: 'debris' },
    rock:      { walls: ['cliff_block_rock', 'rock_largeA', 'rock_largeB'],
                 post: 'rock_tallA', course: 2.4, natural: true, debris: 'rock_smallA' },
    sandstone: { walls: ['rock_sandA', 'rock_sandB', 'cliff_block_rock'],
                 post: 'rock_tallC', course: 2.4, natural: true, debris: 'rock_sandC' },
    wood:      { walls: ['log_stack', 'log'],
                 post: 'tree_trunk', course: 1.4, natural: true, debris: 'stump_round' }
  };

  function ruinMass(g, t, style, rnd, top, capMat) {
    const kit = RUIN[t.blocks ? biome.mass : biome.deck];
    const walls = kit ? kit.walls.filter(n => Assets.has(n)) : [];
    if (!walls.length || top < 0.8) return false;      /* no kit: keep the box */

    /* The interior — never seen directly, only through the gaps where the
       walls have come down. It has to reach far enough out to sit BEHIND the
       wall runs with no seam, so it is sized off the same thickness. */
    const wallThick = Math.min(Math.max(0.5, Math.min(t.w, t.h) * 0.17), 1.0);
    const inset = wallThick * 1.7;
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.3, t.w - inset), top, Math.max(0.3, t.h - inset)),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(style.side).multiplyScalar(0.38),
        roughness: 0.98, metalness: 0.03 }));
    core.position.y = top / 2;
    core.castShadow = true; core.receiveShadow = true;
    g.add(core);

    if (kit.natural) {
      /* a crag rather than a wall: courses of rock, each narrower than the one
         below, so the profile leans in the way weathered stone does */
      const name = walls[Math.floor(rnd(2) * walls.length) % walls.length];
      g.add(tintTo(Assets.stacked(name, { w: t.w, h: t.h }, top,
                                  { course: kit.course, taper: Math.min(1.1, top * 0.26),
                                    min: 1.4, max: 3.4 }),
                   style.side, 0.78, t.x * 31 + t.y * 17));
    } else {
      /* WALLS, not cubes.

         Tiling the footprint with square cells and scaling a model to fill
         each one turns every wall in the kit back into the box it was meant
         to replace — the piece ends up as deep as it is long and the eye
         reads a cube. So the perimeter is laid as four runs of wall: each
         segment as long as its share of the side, and only as DEEP as a wall
         is deep. What is left in the middle is the dark core, seen through
         the gaps where the top course has come down. */
      const courses = Math.max(1, Math.round(top / kit.course));
      const each = top / courses;
      const thick = wallThick;

      /* A ruin is not a fort. One wall has usually gone above the ground
         course, and the top of what is left is never a straight line — that
         flat rectangular skyline is the single thing that makes a piece read
         as a solid somebody could not be bothered to dress. */
      const gone = Math.floor(rnd(77) * 6);        /* 0-3 name a fallen side */

      /* A wall reads as a wall because of RELIEF, not because of a texture:
         bays recessed between pilasters, a string course at every floor, a
         window slot where a window would be. Sit the wall flush with the
         footprint and the whole side goes back to being one flat plane the
         moment you look at it from anywhere but straight on — which is what
         made these read as boxes wearing a picture of concrete. */
      const proud = Math.min(0.22, thick * 0.34);   /* how far a pilaster stands out */
      const bay = thick - proud;                    /* the recessed panel behind it */
      const dark = new THREE.MeshStandardMaterial({
        color: new THREE.Color(style.side).multiplyScalar(0.16),
        roughness: 1, metalness: 0 });

      const sides = c => [
        { len: t.w, along: 'x', at: t.h / 2 },
        { len: t.w, along: 'x', at: -t.h / 2 },
        { len: t.h - thick * 2, along: 'z', at: t.w / 2 },
        { len: t.h - thick * 2, along: 'z', at: -t.w / 2 }
      ];

      /* `back` is how far in from the footprint edge this piece sits. A
         pilaster sits at 0 and a bay sits at `proud` — get that wrong and the
         two are flush, which is a flat wall with a pattern drawn on it. */
      const put = function (obj, run, off, y, back) {
        const d = obj.userData.d / 2 + (back || 0);
        if (run.along === 'x') obj.position.set(off, y, run.at - Math.sign(run.at) * d);
        else { obj.rotation.y = Math.PI / 2;
               obj.position.set(run.at - Math.sign(run.at) * d, y, off); }
        g.add(obj);
      };

      for (let c = 0; c < courses; c++) {
        const name = walls[Math.floor(rnd(c * 5 + 1) * walls.length) % walls.length];
        const last = c === courses - 1 && courses > 1;
        let k = 0;
        sides(c).forEach(function (run, side) {
          if (run.len < 0.5) return;
          if (side === gone && c > 0) return;      /* this one came down */
          const n = Math.max(1, Math.round(run.len / 2.4));
          const seg = run.len / n;
          for (let i = 0; i < n; i++) {
            k++;
            if (last && rnd(c * 41 + k * 3) < 0.32) continue;
            const h = last ? each * (0.42 + rnd(c * 61 + k * 7) * 0.72) : each;
            const off = -run.len / 2 + seg * (i + 0.5);

            /* the bay, set back */
            const p = Assets.fitted(name, seg * 1.02, bay, h);
            p.userData.d = bay;
            p.userData.shade = 0.72;
            put(p, run, off, each * c, proud);

            /* a slot where a window was, punched into the set-back bay */
            if (!last && h > 1.1 && seg > 1.2 && rnd(c * 97 + k * 11) < 0.55) {
              const win = new THREE.Mesh(
                new THREE.BoxGeometry(seg * 0.42, h * 0.4, bay * 0.5), dark);
              win.userData.d = bay * 0.5;
              win.userData.keepColour = true;
              put(win, run, off, each * c + h * 0.34 + h * 0.2, proud + 0.02);
            }

            /* the pilaster between this bay and the next, standing proud */
            if (i < n - 1 || side < 2) {
              const col = new THREE.Mesh(
                new THREE.BoxGeometry(Math.min(0.42, seg * 0.22), h, thick),
                new THREE.MeshStandardMaterial({ color: style.side, roughness: 0.9 }));
              col.userData.d = thick;
              col.userData.shade = 1.22;
              col.castShadow = true;
              put(col, run, off + seg / 2, each * c + h / 2);
            }
          }
          /* the string course that caps this floor */
          if (!last) {
            const band = new THREE.Mesh(
              new THREE.BoxGeometry(run.len, 0.14, thick + proud * 0.6),
              new THREE.MeshStandardMaterial({ color: style.cap, roughness: 0.85 }));
            band.userData.d = thick + proud * 0.6;
            band.userData.shade = 1.3;
            band.castShadow = true;
            put(band, run, 0, each * (c + 1) - 0.07);
          }
        });
      }

      /* one corner still carries a storey nobody has knocked down — a stub of
         wall standing above the rest is what stops the top edge reading as a
         ruled line */
      if (courses > 1 && Math.min(t.w, t.h) > 2.2 && rnd(53) < 0.7) {
        const name = walls[Math.floor(rnd(59) * walls.length) % walls.length];
        const cx = rnd(61) < 0.5 ? -1 : 1, cz = rnd(67) < 0.5 ? -1 : 1;
        const run = Math.min(t.w, t.h) * 0.42;
        const tall = top * (0.24 + rnd(71) * 0.3);
        const a = Assets.fitted(name, run, thick, tall);
        a.position.set(cx * (t.w / 2 - run / 2), top, cz * (t.h / 2 - thick / 2));
        g.add(a);
        const b = Assets.fitted(name, run - thick, thick, tall * 0.72);
        b.rotation.y = Math.PI / 2;
        b.position.set(cx * (t.w / 2 - thick / 2), top, cz * (t.h / 2 - run / 2 - thick / 2));
        g.add(b);
      }
      /* a post at each corner, one of them usually down */
      if (Assets.has(kit.post) && Math.min(t.w, t.h) > 1.6) {
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c, i) {
          if (rnd(i * 17 + 5) < 0.28) return;
          const wide = Math.min(0.8, Math.min(t.w, t.h) * 0.28);
          const p = Assets.fitted(kit.post, wide, wide, top * (0.86 + rnd(i * 23) * 0.14));
          p.position.set(c[0] * (t.w / 2 - wide / 2), 0, c[1] * (t.h / 2 - wide / 2));
          g.add(tintTo(p, style.side, 0.85, i * 401 + t.x));
        });
      }
    }

    /* A floor to stand on — the rules let models climb up here, so there has
       to be something up here to stand on. Not on a crag, though: a rock
       outcrop with a flat plank lid on it looks like somebody boarded it
       over, and the stacked courses already close their own top. */
    if (capMat && !kit.natural) {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.98, 0.18, t.h * 0.98), capMat);
      deck.position.y = top - 0.09;
      deck.receiveShadow = true;
      g.add(deck);
    }

    /* what fell off it, piled round the foot */
    if (Assets.has(kit.debris)) {
      const n = Math.max(2, Math.round((t.w + t.h) / 4));
      for (let i = 0; i < n; i++) {
        const v = rnd(i * 29 + 11);
        const d = Assets.grown(kit.debris, 0.3 + v * 0.5, 1.1);
        const side = Math.floor(rnd(i * 13 + 2) * 4);
        const along = (rnd(i * 19 + 4) - 0.5) * 0.86;
        if (side < 2) d.position.set(along * t.w, 0, (side ? 1 : -1) * (t.h / 2 - 0.15));
        else d.position.set((side === 2 ? -1 : 1) * (t.w / 2 - 0.15), 0, along * t.h);
        d.rotation.y = v * 6.28;
        g.add(tintTo(d, style.side, 0.8, i * 137));
      }
    }
    return true;
  }

  /* SIT A THING ON WHATEVER IS ACTUALLY UNDER IT.

     Every prop a piece dresses itself with was placed at local y = 0 — table
     level — no matter what it landed on. Where one piece stands inside or
     beside a taller one (the Pinnacle's sanctum sits in the middle of its own
     nave) that put the crates and the fuel drum INSIDE the wall next to them,
     and left rocks hanging in the air over a terrace they should have been
     resting on. Both of those are the same missing line. */
  function groundUnder(t, wx, wz) {
    let h = 0;
    (board.terrain || []).forEach(function (o) {
      if (o === t) return;
      if (wx > o.x && wx < o.x + o.w && wz > o.y && wz < o.y + o.h) h = Math.max(h, o.top);
    });
    return h;
  }

  function seat(obj, t, lx, lz) {
    const y = groundUnder(t, t.x + t.w / 2 + lx, t.y + t.h / 2 + lz);
    obj.position.set(lx, y, lz);
    /* Anything that is supposed to be STANDING ON something says so, and says
       what. tools/checkfloat.js then has a fact to check rather than a guess:
       a building's upper storey is meant to be in the air, a crate is not. */
    obj.userData.rests = y;
    return obj;
  }

  function dressTerrain(t, idx) {
    const g = new THREE.Group();
    g.position.set(t.x + t.w / 2, 0, t.y + t.h / 2);
    const kind = t.kind || (t.blocks ? 'blockhouse' : 'platform');
    const rnd = i => Assets.seeded(idx * 613 + i * 37);
    const clumps = (biome.clumps || []).slice();
    const style = MASS[t.blocks ? biome.mass : biome.deck] || MASS.panel;

    /* Where the biome grows things, a blocking piece is a stand of them on a
       low bank rather than a wall — the collision box is identical, but a wood
       should look like a wood. */
    /* A piece only gets to BE a stand of trees if the trees really reach the
       height the rules say it blocks to. Otherwise the table shows you a
       waist-high thicket that the game treats as a solid wall — so anything
       that cannot fill its own height gets built instead. */
    const tallest = clumps.reduce((m, n) => Math.max(m, realHeight(n)), 0);
    const grown = t.blocks && clumps.length && kind !== 'rubble' &&
                  tallest >= t.top * 0.78;
    const massTop = grown ? Math.min(t.top * 0.42, 1.5) : t.top;

    if (kind !== 'rubble') {
      const surf = style.hazard ? panelTexture : naturalTexture;
      const side = surf('s_' + biome.mass + (style.hazard && t.top > 2 ? 'H' : ''),
                        !!style.hazard && t.blocks && t.top > 2, biome.mass).clone();
      side.needsUpdate = true;
      side.repeat.set(Math.max(1, t.w / 2.6), Math.max(1, massTop / 2.2));
      const cap = surf('c_' + biome.mass, false, biome.mass).clone();
      cap.needsUpdate = true;
      cap.repeat.set(Math.max(1, t.w / 2.6), Math.max(1, t.h / 2.6));
      const sideMat = new THREE.MeshStandardMaterial({
        map: side, color: style.side, roughness: style.rough, metalness: style.metal });
      const capMat = new THREE.MeshStandardMaterial({
        map: cap, color: style.cap, roughness: style.rough, metalness: style.metal * 0.7 });
      /* Built out of the kit if there is a kit for this ground; the plain
         skinned box is what is left when there is not. A `grown` piece is a
         low bank with a wood standing on it — and a skinned box with four
         trees on it is still a skinned box, so the bank gets built as well:
         a crag on natural ground, a low ruined wall on built ground. */
      /* A WOOD IS TREES IN THE GROUND.

         This piece is a stand of trees; the rules box is its trunks and
         canopy, not a building. Building a mass under it put the wood on a
         plinth — and once that plinth was made of masonry it was pines
         growing out of a stone terrace and oaks standing on a plank floor.
         Nothing is built here at all. The trees start at the earth. */
      /* BUILT, not dressed. A blocking piece is a building with walls,
         openings, floor slabs and piers; a rubble piece is that building
         after it came down. Both are generated off the rules box, so the
         rectangle the game measures and the thing you look at are the same
         object. */
      const pal = PAL[t.blocks ? biome.mass : biome.deck] || PAL.panel;
      /* a top-level `const` in a classic script is NOT on window, so this
         has to be a plain reference guarded by typeof */
      const canBuild = typeof Build3D !== 'undefined' && typeof Mats !== 'undefined';
      const built = grown ? false : (canBuild ? (g.add(Build3D.building(t, pal, rnd)), true)
                                              : false);

      if (grown) {
        /* forest floor: a shallow rise of earth, no edge, nothing to climb */
        const soil = new THREE.Mesh(
          new THREE.CylinderGeometry(Math.min(t.w, t.h) * 0.56, Math.min(t.w, t.h) * 0.62,
                                     0.16, 12),
          new THREE.MeshStandardMaterial({
            /* only a shade darker than the ground it sits on — at 0.85 of the
               grit colour this read as a hole cut in the table */
            color: new THREE.Color(biome.ground.base || biome.ground.grit)
              .multiplyScalar(0.82),
            roughness: 1, metalness: 0 }));
        soil.scale.set(t.w / Math.min(t.w, t.h), 1, t.h / Math.min(t.w, t.h));
        soil.position.y = 0.06;
        soil.receiveShadow = true;
        soil.userData.keepColour = true;
        g.add(soil);
      } else if (!built) {
        const mass = new THREE.Mesh(new THREE.BoxGeometry(t.w, massTop, t.h),
          [sideMat, sideMat, capMat, capMat, sideMat, sideMat]);
        mass.position.y = massTop / 2;
        mass.castShadow = true; mass.receiveShadow = true;
        g.add(mass);
      }

      /* a rim round the top edge, as four bars — a slab here would roof it */
      if (!grown && !built) {
        const rimMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(style.cap).multiplyScalar(0.6),
          roughness: 0.55, metalness: Math.min(0.85, style.metal + 0.4) });
        [[t.w + 0.14, 0.18, 0.18, 0, (t.h + 0.14) / 2],
         [t.w + 0.14, 0.18, 0.18, 0, -(t.h + 0.14) / 2],
         [0.18, 0.18, t.h + 0.14, (t.w + 0.14) / 2, 0],
         [0.18, 0.18, t.h + 0.14, -(t.w + 0.14) / 2, 0]].forEach(function (r) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(r[0], r[1], r[2]), rimMat);
          bar.position.set(r[3], t.top, r[4]);
          bar.castShadow = true;
          g.add(bar);
        });
      }
    }

    /* --- rubble: a building that has COME DOWN ---

       This used to be a handful of rocks dropped on the floor, which is how
       you can tell nobody built anything: the broken wall was lying about as
       "cover" instead of being the thing the piece was made of. So a rubble
       piece is the footprint of a building whose walls are still standing in
       stubs — a metre here, waist height there, one side gone entirely — with
       the heap it collapsed into piled inside it. */
    if (kind === 'rubble') {
      /* A ruined building: the ground plan still standing in stubs of wall,
         right-angled and capped, with the heap it collapsed into inside. */
      if (typeof Build3D !== 'undefined' && typeof Mats !== 'undefined') {
        g.add(Build3D.ruin(t, PAL[biome.mass] || PAL.panel, rnd));
      }

      /* A SURFACE TO STAND ON.

         The rules let a model stand on top of this piece at t.top, and the
         heap was built from loose rock about half that tall — so a model
         "standing on the rubble" hovered half an inch over it with the rocks
         visibly below its feet. If the game says you can stand at 1.1", there
         has to be something at 1.1" to stand on. */
      {
        const mound = new THREE.Mesh(
          new THREE.CylinderGeometry(Math.min(t.w, t.h) * 0.52, Math.min(t.w, t.h) * 0.62,
                                     Math.max(0.2, t.top * 0.92), 9),
          Mats && typeof Mats !== 'undefined'
            ? Mats.material((PAL[biome.mass] || PAL.panel).ground, 4, 2, { bump: 1.3 })
            : new THREE.MeshStandardMaterial({ color: 0x6a655c, roughness: 1 }));
        mound.scale.set(t.w / Math.min(t.w, t.h), 1, t.h / Math.min(t.w, t.h));
        mound.position.y = Math.max(0.2, t.top * 0.92) / 2;
        mound.castShadow = true; mound.receiveShadow = true;
        mound.userData.keepColour = true;
        g.add(mound);
      }

      /* what came off it, heaped along the foot of the walls and inside */
      const kit2 = RUIN[biome.mass] || RUIN.panel;
      const heap = (biome.scatter || []).concat([kit2.debris, 'debris', 'rock_smallA'])
        .filter(n => Assets.has(n));
      const n2 = Math.max(4, Math.round(t.w * t.h / 2.6));
      for (let i = 0; i < n2 && heap.length; i++) {
        const v = rnd(i * 7 + 1);
        const r = Assets.grown(heap[Math.floor(v * heap.length) % heap.length],
                               0.22 + v * 0.4, Math.min(1.2, t.w / 3));
        const sp = 0.3 + rnd(i * 23) * 0.5;
        const lx = (rnd(i * 3) - 0.5) * t.w * sp, lz = (rnd(i * 5) - 0.5) * t.h * sp;
        seat(r, t, lx, lz);
        /* the ones out in the middle sit on top of the mound */
        const onMound = Math.hypot(lx / (t.w / 2), lz / (t.h / 2)) < 0.82;
        if (onMound) {
          r.position.y += Math.max(0.2, t.top * 0.92);
          r.userData.rests = r.position.y;
        }
        r.rotation.set((rnd(i * 9) - 0.5) * 0.3, v * 6.28, (rnd(i * 11) - 0.5) * 0.3);
        g.add(r);
      }
      return finishDress(g, t);
    }

    /* --- what stands on it --- */
    if (grown) {
      /* fill the footprint with whatever this ground grows, up to the height
         the rules already say the piece is */
      const cell = 1.8;
      const nx = Math.max(1, Math.round(t.w / cell));
      const nz = Math.max(1, Math.round(t.h / cell));
      let k = 0;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const v = rnd(k * 13 + 1);
          const name = clumps[Math.floor(v * clumps.length) % clumps.length];
          k++;
          if (!Assets.has(name)) continue;
          /* grown, not squashed — its own proportions, standing as tall as
             the piece the rules say is there */
          /* its own height, give or take, not the terrain's */
          const tall = realHeight(name) * (0.82 + v * 0.36);
          const room = Math.min(t.w / nx, t.h / nz) * 1.5;
          const c = Assets.grown(name, tall, room);
          /* rooted at ground level — the whole point */
          seat(c, t,
               -t.w / 2 + (t.w / nx) * (i + 0.5) + (rnd(k * 3) - 0.5) * 0.4,
               -t.h / 2 + (t.h / nz) * (j + 0.5) + (rnd(k * 5) - 0.5) * 0.4);
          c.position.y += 0.04;
          c.rotation.y = v * 6.28;
          g.add(c);
        }
      }
    } else if (t.blocks) {
      /* Kit at the foot of the wall, built rather than borrowed: drums,
         crates and a cable spool wearing the same steel and concrete as the
         building behind them. A bright yellow machine off a toy kit parked
         against cast concrete is what gives a table away. */
      if (typeof Build3D !== 'undefined' && typeof Mats !== 'undefined') {
        const yard = Build3D.yardKit(t, rnd);
        yard.children.forEach(function (item, i) {
          const edge = Math.floor(rnd(i * 9 + 1) * 4);
          const along = (rnd(i * 11 + 3) - 0.5) * 0.72;
          const lx = edge < 2 ? along * t.w : (edge === 2 ? -1 : 1) * (t.w / 2 + 0.42);
          const lz = edge < 2 ? (edge === 0 ? -1 : 1) * (t.h / 2 + 0.42) : along * t.h;
          seat(item, t, lx, lz);
          item.rotation.y = rnd(i * 7) * 6.28;
          if (item.position.y > 0.05) item.visible = false;   /* it would be in a wall */
        });
        g.add(yard);
      }
    } else {
      /* The deck's parapet and everything standing on it now come out of the
         same generator as the building below, so a raised floor reads as the
         top of the structure rather than as a tray. */
      if (typeof Build3D !== 'undefined' && typeof Mats !== 'undefined') {
        const roof = Build3D.rooftop(t, rnd);
        roof.position.y = t.top;
        roof.userData.rests = t.top;
        /* Nothing is allowed to stand on top of something the players have to
           reach. A water tank came down over the RELIC like a cloche — which
           is what happens when scenery is scattered without asking what is
           already there. */
        const keepOut = (board.objectives || []).map(o => ({ x: o.x, y: o.y, r: 3.2 }));
        keepOut.push({ x: board.w / 2, y: board.h / 2, r: 3.6 });   /* the relic's home */
        roof.children.slice().forEach(function (c) {
          const wx = t.x + t.w / 2 + c.position.x, wz = t.y + t.h / 2 + c.position.z;
          if (keepOut.some(k => Math.hypot(wx - k.x, wz - k.y) < k.r)) roof.remove(c);
        });
        g.add(roof);
      }
      if (Assets.has('stairs') && t.top > 0.9) {
        const nat = Assets.size('stairs');
        const probe = bestApproach(t, (nat.z / nat.y) * t.top);
        const from = probe ? probe.level : 0;
        const rise = Math.max(0.6, t.top - from);
        let run = (nat.z / (nat.y || 1)) * rise;
        if (run > 7.6) run = 7.6;
        const wide = Math.max(1.1, (nat.x / (nat.y || 1)) * rise);
        const side = bestApproach(t, run, wide);
        if (side) {
          const st = Assets.fitted('stairs', wide, run, rise);
          st.rotation.y = side.turn;
          st.position.set(side.x, side.level, side.z);
          st.userData.stairsFor = t;
          stairsPlaced.push(side.rect);
          g.add(st);
        }
      }
    }
    return finishDress(g, t);
  }

  /* Ground clutter. None of it is cover — nothing here stands more than a
     few tenths of an inch — but bare floor between the pieces looks like a
     prototype, and this is not one. */
  function scatterGround(b) {
    const kit = (biome.scatter || []).filter(n => Assets.has(n));
    if (!kit.length) return;
    const group = new THREE.Group();
    /* Fewer and smaller than it was. Two hundred tan stumps at nearly an inch
       each stopped reading as ground cover and started reading as litter
       tipped over the table — and being the warmest thing on it, they were
       what the eye went to first. */
    const n = Math.round(b.w * b.h * 0.07);
    for (let i = 0; i < n; i++) {
      const x = Assets.seeded(i * 37 + 5) * b.w;
      const y = Assets.seeded(i * 61 + 9) * b.h;
      const p = { x: x, y: y };
      if (b.terrain.some(t => Board.inBox(t, p))) continue;
      if (b.objectives.some(o => Board.dist(o, p) < 2)) continue;
      /* leave the deployment zones clear so models can be put down */
      if (b.deploy.some(z => p.x > z.x - 0.5 && p.x < z.x + z.w + 0.5 &&
                             p.y > z.y - 0.5 && p.y < z.y + z.h + 0.5)) continue;
      const v = Assets.seeded(i * 17);
      const name = kit[Math.floor(v * kit.length) % kit.length];
      /* small, and varied — a field of identical pebbles is worse than none */
      /* kept under an inch: ground cover, never cover */
      /* and the colour of the ground it is lying on, not the colour it was
         modelled in — a field of bright orange pebbles on grey rockcrete is
         the single loudest thing on the table */
      const m = tintTo(Assets.grown(name, 0.15 + v * 0.36, 0.7),
                       new THREE.Color(biome.ground.grit).multiplyScalar(0.72),
                       0.88, i * 211);
      const gy = Board.heightAt(b, p);
      m.position.set(x, gy, y);
      m.userData.rests = gy;
      m.rotation.y = Assets.seeded(i * 71) * 6.28;
      m.rotation.z = (Assets.seeded(i * 91) - 0.5) * 0.16;
      group.add(m);
    }
    terrainGroup.add(group);
  }

  /* GROUND WORKS.

     Seen from above, the table was a big flat floor with a handful of
     rectangles on it and a sprinkle of pebbles — which is what "visually sad"
     means: not that the pieces are wrong, but that there is nothing between
     them. A battlefield has things running ACROSS it. A road. A rail spur. A
     pipeline. Craters where something landed. Long wreckage lying where it
     was dropped.

     None of it is cover and none of it is allowed to be: everything here is
     flat or nearly, it goes nowhere near a terrain footprint, an objective or
     a deployment zone, and the rules never see it. It is the difference
     between a board and a place. */
  function groundWorks(b) {
    const group = new THREE.Group();
    const clear = function (p, pad) {
      if (!Board.inside(b, p)) return false;
      if (b.terrain.some(t => p.x > t.x - pad && p.x < t.x + t.w + pad &&
                              p.y > t.y - pad && p.y < t.y + t.h + pad)) return false;
      if (b.objectives.some(o => Board.dist(o, p) < 2.4)) return false;
      if (b.deploy.some(z => p.x > z.x - 0.5 && p.x < z.x + z.w + 0.5 &&
                             p.y > z.y - 0.5 && p.y < z.y + z.h + 0.5)) return false;
      return true;
    };
    const lay = function (obj, x, y, turn, shade) {
      const gy = Board.heightAt(b, { x: x, y: y }) + 0.012;
      obj.position.set(x, gy, y);
      obj.userData.rests = gy;
      obj.rotation.y = turn;
      obj.userData.shade = shade || 1;
      group.add(obj);
    };

    /* a way across: road, or rail where the biome is industrial */
    const rails = biome.mass === 'panel' && Assets.has('rail');
    const road = rails ? 'rail' : (Assets.has('terrain_roadStraight') ? 'terrain_roadStraight' : null);
    if (road) {
      const across = Assets.seeded(3) < 0.5;
      const at = (0.3 + Assets.seeded(11) * 0.4) * (across ? b.h : b.w);
      const len = across ? b.w : b.h;
      const n = Math.round(len / 2.2);
      for (let i = 0; i < n; i++) {
        const d = (i + 0.5) * (len / n);
        const p = across ? { x: d, y: at } : { x: at, y: d };
        if (!clear(p, 0.3)) continue;
        const seg = Assets.fitted(road, 2.24, rails ? 1.5 : 2.2, rails ? 0.16 : 0.05);
        lay(seg, p.x, p.y, across ? 0 : Math.PI / 2, 0.62);
      }
    }

    /* a pipeline, running the other way and jinking round what is in the way */
    if (Assets.has('pipe_straight')) {
      const across = Assets.seeded(17) < 0.5;
      const at = (0.25 + Assets.seeded(23) * 0.5) * (across ? b.h : b.w);
      const len = across ? b.w : b.h;
      const n = Math.round(len / 1.8);
      for (let i = 0; i < n; i++) {
        const d = (i + 0.5) * (len / n);
        const p = across ? { x: d, y: at } : { x: at, y: d };
        if (!clear(p, 0.6)) continue;
        const seg = Assets.grown('pipe_straight', 0.32, 1.7);
        lay(seg, p.x, p.y, across ? 0 : Math.PI / 2, 0.95);
      }
    }

    /* craters, and the wreckage nobody cleared */
    const big = ['crater', 'debris', 'log_stack', 'tree_deadlog', 'rocks_smallA', 'crater']
      .filter(n => Assets.has(n));
    const n = Math.round(b.w * b.h * 0.012);
    for (let i = 0; i < n && big.length; i++) {
      /* kept a good way in from the edge — these are wide, and the sample is
         a centre point, so something dropped on the rim hangs off the table */
      const p = { x: 3 + Assets.seeded(i * 131 + 7) * (b.w - 6),
                  y: 3 + Assets.seeded(i * 173 + 3) * (b.h - 6) };
      if (!clear(p, 1.2)) continue;
      const v = Assets.seeded(i * 29 + 2);
      const name = big[Math.floor(v * big.length) % big.length];
      /* wide and LOW — it has to read from above without ever looking like
         something you could hide behind */
      /* grown, not stretched: a crater squashed to 4" × 3.6" × 0.4" is a flat
         card lying on the floor, which is worse than nothing */
      const m = Assets.grown(name, 0.3 + v * 0.55, 2.2 + v * 1.6);
      lay(m, p.x, p.y, v * 6.28, 0.78);
    }

    /* scorch: flat discs where something burned, using the blood stain path */
    for (let i = 0; i < Math.round(b.w * b.h * 0.006); i++) {
      const p = { x: Assets.seeded(i * 211 + 13) * b.w, y: Assets.seeded(i * 251 + 5) * b.h };
      if (!clear(p, 0.4)) continue;
      const v = Assets.seeded(i * 43);
      /* Soft-edged and faint. A hard black circle at a fifth opacity reads as
         a hole cut in the floor, not as a burn — and there were several of
         them overlapping. */
      if (!scorchTex) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 128;
        const cg = cv.getContext('2d');
        const grad = cg.createRadialGradient(64, 64, 4, 64, 64, 62);
        grad.addColorStop(0, 'rgba(12,10,9,0.85)');
        grad.addColorStop(0.55, 'rgba(16,14,12,0.4)');
        grad.addColorStop(1, 'rgba(20,18,16,0)');
        cg.fillStyle = grad;
        cg.fillRect(0, 0, 128, 128);
        scorchTex = new THREE.CanvasTexture(cv);
      }
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1 + v * 2.2, 20),
        new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true,
                                      opacity: 0.16 + v * 0.14, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(p.x, Board.heightAt(b, p) + 0.008, p.y);
      disc.userData.keepColour = true;
      group.add(disc);
    }

    group.traverse(function (o) {
      if (!o.isMesh || !o.material || o.userData.keepColour) return;
      for (let a = o; a; a = a.parent) if (a.userData && a.userData.keepColour) return;
      const many = Array.isArray(o.material);
      const shade = (o.parent && o.parent.userData.shade) || 1;
      const out = (many ? o.material : [o.material]).map(function (m) {
        const c = m.clone();
        /* The colour of half this kit lives in its texture, not its material,
           so tinting the material alone leaves a rust-red road and scarlet
           wreckage lying across a brown table — louder than anything the
           players are meant to be looking at. Ground dressing is background:
           drop the map and take the flat colour, which can be controlled. */
        c.map = null;
        c.needsUpdate = true;      /* dropping a map recompiles the shader */
        if (c.color) {
          c.color.set(biome.ground.grit);
          c.color.multiplyScalar(shade * (0.72 + Assets.seeded(o.id * 37) * 0.5));
        }
        c.roughness = 1;
        c.metalness = 0;
        return c;
      });
      o.material = many ? out : out[0];
    });
    terrainGroup.add(group);
  }

  /* Which side of a piece you could actually walk up to, scored on how much
     clear table is in front of it, and how high the ground is at the foot of
     the flight. Returns a local offset and a turn, or null if it is boxed in.

     The kit's steps rise toward +Z — measured off the mesh, not guessed — so
     the turn brings their high end round to face the deck. */
  function approaches(t, depth, width) {
    const sides = [
      { nx: 0, nz: -1, turn: 0 },
      { nx: 0, nz: 1, turn: Math.PI },
      { nx: -1, nz: 0, turn: Math.PI / 2 },
      { nx: 1, nz: 0, turn: -Math.PI / 2 }
    ];
    const out = [];
    sides.forEach(function (s2) {
      const half = s2.nx ? t.w / 2 : t.h / 2;
      let clear = 0;
      for (let a = -0.5; a <= 0.5; a += 0.25) {
        for (let d = 0.6; d <= depth + 0.6; d += 0.6) {
          const px = t.x + t.w / 2 + s2.nx * (half + d) + (s2.nx ? 0 : a * t.w * 0.7);
          const pz = t.y + t.h / 2 + s2.nz * (half + d) + (s2.nz ? 0 : a * t.h * 0.7);
          if (px < 0.5 || pz < 0.5 || px > board.w - 0.5 || pz > board.h - 0.5) continue;
          const p = { x: px, y: pz };
          if (board.terrain.some(o => o !== t && Board.inBox(o, p) && o.top >= t.top)) continue;
          clear++;
        }
      }
      /* the bottom step lands at one place, so read the ground there */
      const footX = t.x + t.w / 2 + s2.nx * (half + depth);
      const footZ = t.y + t.h / 2 + s2.nz * (half + depth);
      const level = board.terrain.reduce(function (n, o) {
        return (o !== t && !o.blocks && Board.inBox(o, { x: footX, y: footZ }) && o.top < t.top)
               ? Math.max(n, o.top) : n;
      }, 0);
      /* the patch of table this flight would occupy, in world coordinates */
      const cx = t.x + t.w / 2 + s2.nx * (half + depth / 2);
      const cz = t.y + t.h / 2 + s2.nz * (half + depth / 2);
      /* The reserved rectangle has to be the flight's REAL footprint. It was
         a fixed 1.9" across while the mesh is scaled to `wide`, which for a
         tall deck is far more than that — so two flights could each think the
         other was somewhere else and land on top of one another. */
      const along = Math.max(1.9, width || 1.9);
      out.push({ clear: clear, turn: s2.turn, level: level,
                 x: s2.nx * (t.w / 2 + depth / 2),
                 z: s2.nz * (t.h / 2 + depth / 2),
                 rect: { x: cx - (s2.nx ? depth : along) / 2,
                         y: cz - (s2.nz ? depth : along) / 2,
                         w: s2.nx ? depth : along,
                         h: s2.nz ? depth : along } });
    });
    return out.filter(o => o.clear >= 6).sort((a, b) => b.clear - a.clear);
  }

  /* Every flight already standing, so the next one does not land on top of it.
     Two staircases crossing each other on the same face is what happens when
     each piece chooses its side without looking. */
  let stairsPlaced = [];
  let scorchTex = null;
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x &&
                             a.y < b.y + b.h && a.y + a.h > b.y;

  function bestApproach(t, depth, width) {
    const ranked = approaches(t, depth, width);
    for (let i = 0; i < ranked.length; i++) {
      if (!stairsPlaced.some(r => overlaps(ranked[i].rect, r))) return ranked[i];
    }
    return null;
  }

  function finishDress(g, t) {
    /* One place, at the end, so nothing gets missed.

       Tinting piece by piece as it was added meant the walls came onto the
       biome palette and the crown, the stairs, the rubble and the props did
       not — so a grey ruin still wore a bright yellow gantry and a scatter of
       traffic-cone orange rocks. Terrain is terrain: it all gets pulled onto
       the ground it stands on, here, once.

       What is deliberately NOT pulled: anything flagged `keepColour`. A red
       fuel drum or a lit brazier is a landmark, and a table where every
       single thing is the same grey is as bad as a table where nothing is. */
    const style = MASS[t.blocks ? biome.mass : biome.deck] || MASS.panel;
    /* pulled well down as well as together: these kits are lit for a bright
       cartoon and this table is a warzone at dusk */
    const ground = new THREE.Color(style.side).lerp(new THREE.Color(0x14120f), 0.52);
    let n = 0;
    g.traverse(function (o) {
      if (!o.isMesh) return;
      o.userData.terrain = t;
      /* the flag is set on the wrapper the kit hands back, and the meshes are
         two levels down inside it */
      for (let a = o; a; a = a.parent) if (a.userData && a.userData.keepColour) return;
      if (o.userData.tinted) return;
      o.userData.tinted = true;
      const many = Array.isArray(o.material);
      const out = (many ? o.material : [o.material]).filter(Boolean).map(function (m) {
        const c = m.clone();
        if (c.color) {
          const v = 0.82 + Assets.seeded(Math.round(t.x * 7 + t.y * 13) + (n++) * 71) * 0.34;
          /* `shade` is how a piece of relief was MEANT to sit against its
             neighbours — a pilaster catching the light, a bay set back in
             shadow. Pulling everything onto one palette without it flattens
             the architecture straight back out again. */
          c.color.lerp(ground, 0.8).multiplyScalar(v * (o.userData.shade || 1));
        }
        if (c.emissive) c.emissive.multiplyScalar(0.2);
        c.roughness = Math.min(1, (c.roughness === undefined ? 0.8 : c.roughness) + 0.14);
        c.metalness = Math.min(1, (c.metalness || 0) * 0.7);
        return c;
      });
      if (out.length) o.material = many ? out : out[0];
    });
    return g;
  }

  /* -------------------------------------------------------------- the models */

  function initials(name) {
    const q = name.match(/"([^"]+)"/);
    if (q) return q[1].slice(0, 2).toUpperCase();
    const parts = name.replace(/["']/g, '').split(/\s+/).filter(Boolean);
    return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase()
                              : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    s.scale.set(2.9, 0.72, 1);
    s.renderOrder = 20;
    return s;
  }

  function makeUnit(u, faction) {
    const colour = u.owner === 0 ? COL.p0 : COL.p1;
    const g = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(u.radius, u.radius * 1.05, 0.12, 30),
      new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.85, metalness: 0.35 }));
    base.position.y = 0.06;
    base.receiveShadow = true; base.castShadow = true;
    g.add(base);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(u.radius, 0.045, 8, 30),
      new THREE.MeshStandardMaterial({ color: colour, emissive: colour,
                                       emissiveIntensity: 0.5, roughness: 0.5 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.13;
    g.add(rim);

    const body = new THREE.Group();
    const name = MODEL[faction] || 'astronautA';
    if (Assets.has(name)) {
      const fig = Assets.fitted(name, 0.95, 0.95, 1.6);
      fig.traverse(function (o) {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.lerp(new THREE.Color(colour), 0.4);
        o.castShadow = true;
      });
      body.add(fig);
    }
    body.position.y = 0.12;
    g.add(body);
    g.userData.body = body;

    const label = labelSprite(initials(u.name), u.owner === 0 ? '#5687b4' : '#a8352a');
    label.position.y = 2.3;
    g.add(label);
    g.userData.label = label;

    const pips = new THREE.Group();
    for (let i = 0; i < u.maxWounds; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.06),
        new THREE.MeshBasicMaterial({ color: COL.bone }));
      p.position.set((i - (u.maxWounds - 1) / 2) * 0.18, 1.88, 0);
      pips.add(p);
    }
    g.add(pips);
    g.userData.pips = pips;
    g.userData.ring = rim;
    g.traverse(function (o) { if (o.isMesh) o.userData.unitId = u.id; });
    g.userData.unitId = u.id;

    const token = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.RingGeometry(2.86, 3, 52),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.8,
                                    side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(3, 52),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.1,
                                    side: THREE.DoubleSide, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    token.add(disc, fill);
    /* A crosshair painted on the ground where the arc is watched. It was a
       fuel drum, which says nothing about what an OVERWATCH marker is for and
       reads as a piece of scenery somebody left in the open. */
    const cross = new THREE.Group();
    const arm = new THREE.MeshBasicMaterial({ color: colour, transparent: true,
                                              opacity: 0.9, depthWrite: false });
    [[1.9, 0.1], [0.1, 1.9]].forEach(function (d) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(d[0], d[1]), arm);
      bar.rotation.x = -Math.PI / 2;
      bar.position.y = 0.05;
      cross.add(bar);
    });
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.82, 40), arm);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.05;
    cross.add(inner);
    token.add(cross);
    token.visible = false;
    markerGroup.add(token);
    g.userData.token = token;

    return g;
  }

  /* THE RELIC.

     There was nothing here at all: the mission put a relic in the middle of
     the table and the table never drew it, so the only thing you could see
     where it was meant to be was a cargo crate somebody had left on a deck.
     A whole mission card is built around carrying this thing home — it should
     be the most obviously precious object on the battlefield, and you should
     be able to find it from across the table.

     Built rather than taken from the kit: a black reliquary on a stepped
     plinth, a cage of gold ribs, and a shard turning inside it that lights
     the ground it stands on. */
  function makeRelic() {
    const g = new THREE.Group();
    const black = new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 0.62, metalness: 0.5 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xbb8b32, emissive: 0x2a1c06,
                                                  roughness: 0.28, metalness: 0.95 });

    /* a plinth of two steps */
    [[1.5, 0.16, 0.0], [1.12, 0.2, 0.16]].forEach(function (s) {
      const step = new THREE.Mesh(new THREE.CylinderGeometry(s[0], s[0] * 1.06, s[1], 8), black);
      step.position.y = s[2] + s[1] / 2;
      step.castShadow = true; step.receiveShadow = true;
      g.add(step);
    });
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.13, 0.05, 6, 24), gold);
    band.rotation.x = -Math.PI / 2;
    band.position.y = 0.36;
    g.add(band);

    /* four ribs leaning in to a point, like a censer */
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.09), gold);
      const a = i * Math.PI / 2 + Math.PI / 4;
      rib.position.set(Math.cos(a) * 0.42, 1.1, Math.sin(a) * 0.42);
      rib.rotation.set(Math.sin(a) * 0.26, 0, -Math.cos(a) * 0.26);
      rib.castShadow = true;
      g.add(rib);
    }
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 8), gold);
    cap.position.y = 1.96;
    g.add(cap);

    /* the shard itself, turning */
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0),
      new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xffb43c,
                                       emissiveIntensity: 1.5, roughness: 0.15,
                                       metalness: 0.2 }));
    shard.position.y = 1.05;
    g.add(shard);

    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc25a, transparent: true, opacity: 0.13,
                                    depthWrite: false }));
    halo.position.y = 1.05;
    g.add(halo);

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.1, 11, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc25a, transparent: true, opacity: 0.09,
                                    side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 6;
    g.add(beam);

    const lamp = new THREE.PointLight(0xffb43c, 2.6, 9, 2);
    lamp.position.y = 1.1;
    g.add(lamp);

    g.userData.shard = shard;
    g.userData.halo = halo;
    return g;
  }

  function syncRelic(S) {
    if (!S.relic) { if (relicNode) relicNode.visible = false; return; }
    if (!relicNode) { relicNode = makeRelic(); markerGroup.add(relicNode); }
    relicNode.visible = true;
    /* carried: it rides on whoever has it, at shoulder height */
    const holder = S.relic.carrier ? S.units.find(u => u.id === S.relic.carrier) : null;
    const at = holder && holder.alive ? holder : S.relic;
    const y = Board.heightAt(S.board, { x: at.x, y: at.y });
    relicNode.position.set(at.x, y + (holder ? 1.05 : 0), at.y);
    relicNode.scale.setScalar(holder ? 0.42 : 1);
  }

  /* TOKENS — the things people throw.

     These were never drawn. Not drawn badly: the renderer had no code for
     S.tokens at all. A smoke bomb landed, gave every shot through it -2 to
     hit for the rest of the turn, and showed nothing; a grenade landed, sat
     there for the chain, went off and killed somebody, and showed nothing.
     The rules were doing their job into an empty room, which is why it read
     as "the smoke bomb does not work" and "the bombs never explode". */

  function makeToken(t) {
    const g = new THREE.Group();
    const smoke = t.label === 'SMOKE BOMB';
    const r = t.radius || 3;

    /* the ring on the ground: exactly the area the rules use */
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 48),
      new THREE.MeshBasicMaterial({ color: smoke ? 0xbfc6cc : 0xd07038,
                                    transparent: true, opacity: 0.55, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    g.add(ring);

    if (smoke) {
      /* A DOME, and a thick one — you should not be able to see a model
         clearly through it, because the rules say you cannot shoot through it
         cleanly either. Built from overlapping billows so it churns. */
      const puffs = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x9aa1a6, roughness: 1, metalness: 0,
        transparent: true, opacity: 0.42, depthWrite: false });
      /* a DOME sitting on the ground, not a ball hanging over it: the billows
         are spread wide and squashed down, and the lowest ones touch the
         floor, because that is where the rules say the cover is */
      for (let i = 0; i < 18; i++) {
        const s = Assets.seeded(i * 37 + 11);
        const b = new THREE.Mesh(new THREE.SphereGeometry(r * (0.5 + s * 0.36), 10, 8), mat);
        const a = (i / 18) * Math.PI * 2 * 1.7 + s;
        const rad = r * 0.6 * Math.sqrt(Assets.seeded(i * 53 + 3));
        b.position.set(Math.cos(a) * rad, 0.16 + s * r * 0.5, Math.sin(a) * rad);
        b.scale.set(1, 0.62, 1);
        b.userData.spin = 0.15 + s * 0.4;
        b.userData.bob = s * 6.28;
        puffs.add(b);
      }
      /* and a skirt of it lying along the ground */
      for (let i = 0; i < 8; i++) {
        const s = Assets.seeded(i * 91 + 5);
        const b = new THREE.Mesh(new THREE.SphereGeometry(r * (0.44 + s * 0.3), 9, 7), mat);
        const a = (i / 8) * Math.PI * 2;
        b.position.set(Math.cos(a) * r * 0.72, 0.1, Math.sin(a) * r * 0.72);
        b.scale.set(1, 0.34, 1);
        b.userData.spin = 0.1 + s * 0.25;
        b.userData.bob = s * 6.28;
        puffs.add(b);
      }
      g.add(puffs);
      g.userData.puffs = puffs;
    } else {
      /* a live charge: dark casing, a fuse light that quickens */
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x24261f, roughness: 0.5, metalness: 0.7 }));
      body.position.y = 0.3;
      body.castShadow = true;
      g.add(body);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 10),
        new THREE.MeshStandardMaterial({ color: 0x6a6257, roughness: 0.6, metalness: 0.8 }));
      collar.position.y = 0.58;
      g.add(collar);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff4a2a }));
      lamp.position.y = 0.7;
      g.add(lamp);
      const glow = new THREE.PointLight(0xff4a2a, 2.2, 5, 2);
      glow.position.y = 0.7;
      g.add(glow);
      g.userData.lamp = lamp;
      g.userData.glow = glow;
    }
    g.userData.smoke = smoke;
    return g;
  }

  function syncTokens(S) {
    const live = {};
    (S.tokens || []).forEach(function (t) {
      live[t.id] = true;
      let node = tokenNodes[t.id];
      if (!node) {
        node = tokenNodes[t.id] = makeToken(t);
        markerGroup.add(node);
        /* it arrives — a bang of dust for a charge, a bloom for smoke */
        const at = new THREE.Vector3(t.x, Board.heightAt(S.board, t) + 0.3, t.y);
        if (t.label === 'SMOKE BOMB') { node.userData.grow = 0; if (Sfx) Sfx.smoke(); }
        else sparks(at, 0.5);
      }
      node.position.set(t.x, Board.heightAt(S.board, t) + 0.02, t.y);
      node.userData.token = t;
    });

    /* anything that has gone: if it was armed, it went OFF */
    Object.keys(tokenNodes).forEach(function (id) {
      if (live[id]) return;
      const node = tokenNodes[id];
      const t = node.userData.token;
      delete tokenNodes[id];
      markerGroup.remove(node);
      if (t && t.tokenEffects) {
        const at = new THREE.Vector3(t.x, (lastState ? Board.heightAt(lastState.board, t) : 0) + 0.5, t.y);
        blast(at, (t.radius || 3) / 3);
      }
    });
  }

  /* A charge going off. Big enough that you never have to read the log to
     know it happened. */
  function blast(at, scale) {
    sparks(at, 1.5 * scale);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6 * scale, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 1,
                                    blending: THREE.AdditiveBlending, depthWrite: false }));
    ball.position.copy(at);
    fxGroup.add(ball);
    fx.push({ kind: 'blast', node: ball, t: 0, life: 0.5, scale: scale });

    const smoke = new THREE.Mesh(new THREE.SphereGeometry(1.1 * scale, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a352e, roughness: 1,
                                       transparent: true, opacity: 0.7, depthWrite: false }));
    smoke.position.copy(at);
    fxGroup.add(smoke);
    fx.push({ kind: 'smoke', node: smoke, t: 0, life: 1.4, scale: scale });

    const ringGeo = new THREE.RingGeometry(0.2, 0.5, 30);
    const shock = new THREE.Mesh(ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.85,
                                    side: THREE.DoubleSide, depthWrite: false }));
    shock.rotation.x = -Math.PI / 2;
    shock.position.set(at.x, at.y - 0.4, at.z);
    fxGroup.add(shock);
    fx.push({ kind: 'shock', node: shock, t: 0, life: 0.55, scale: scale * 6 });

    if (Sfx) Sfx.blast();
  }

  function syncUnits(S) {
    S.units.forEach(function (u) {
      let node = unitNodes[u.id];
      if (!node) {
        node = unitNodes[u.id] = makeUnit(u, S.players[u.owner].faction);
        unitGroup.add(node);
        /* deployed rather than dropped in from nowhere */
        node.userData.enter = 0;
      }
      node.visible = !u.reserve;
      if (u.reserve) return;

      /* while a strike involving this model is on screen, the shot owns it */
      if (playing && playing.holds[u.id]) return;


      node.position.set(u.x, Board.heightAt(S.board, u), u.y);
      node.userData.wantRot = -u.facing + Math.PI / 2;
      node.userData.body.rotation.set(0, 0, 0);
      node.userData.body.position.set(0, 0.12, 0);

      if (!u.alive) { fell(node); return; }
      node.userData.label.visible = true;
      node.userData.pips.visible = true;
      node.userData.ring.material.emissiveIntensity = 0.5;
      /* the more it has taken, the more of it is showing */
      const hurt = 1 - u.wounds / Math.max(1, u.maxWounds);
      node.userData.body.traverse(function (o) {
        if (!o.isMesh || !o.material || !o.material.color) return;
        if (!o.userData.clean) o.userData.clean = o.material.color.clone();
        o.material.color.copy(o.userData.clean).lerp(new THREE.Color(0x5a0f0c), hurt * 0.55);
      });
      node.userData.pips.children.forEach(function (p, i) {
        p.visible = i < u.wounds;
        p.material.color.setHex(u.wounds === 1 ? 0xa8352a
          : u.wounds <= u.maxWounds / 2 ? 0xc9832a : COL.bone);
      });
      node.userData.selected = (view0 && view0.selected === u.id);
      const tok = node.userData.token;
      tok.visible = !!u.overwatch;
      if (u.overwatch) {
        tok.position.set(u.overwatch.x, Board.heightAt(S.board, u.overwatch) + 0.03, u.overwatch.y);
      }
    });
  }

  function fell(node) {
    if (!node.userData.bled) {
      node.userData.bled = true;
      stain({ x: node.position.x, y: 0, z: node.position.z }, 2.4,
            Board.heightAt(board, { x: node.position.x, y: node.position.z }));
    }
    node.userData.label.visible = false;
    node.userData.pips.visible = false;
    node.userData.token.visible = false;
    node.userData.body.rotation.set(-Math.PI / 2.05, 0, 0.3);
    node.userData.body.position.y = 0.16;
    node.userData.ring.material.emissiveIntensity = 0;
  }

  /* ----------------------------------------------------------- the overlays */

  /* An area is a shape, not a heap of squares. The samples are painted as
     overlapping discs into one canvas — which unions them cleanly instead of
     stacking alpha — and that canvas is laid on the table as a single plane.
     So a 6" move reads as a 6" curve and the overwatch arc is a real circle. */
  function areaMesh(points, colour, opacity, cell, lift) {
    if (!points.length) return new THREE.Group();
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    points.forEach(function (p) {
      if (p.x < minx) minx = p.x;
      if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.y > maxy) maxy = p.y;
    });
    const r = Math.max(0.28, (cell || 0.4) * 0.92);
    const pad = r + 0.35;
    minx -= pad; maxx += pad; miny -= pad; maxy += pad;
    const w = maxx - minx, h = maxy - miny;
    const PX = Math.min(20, Math.max(6, 900 / Math.max(w, h)));
    const cw = Math.max(8, Math.round(w * PX)), ch = Math.max(8, Math.round(h * PX));

    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    const hex = '#' + ('000000' + colour.toString(16)).slice(-6);

    const blob = function (radius, style, blur) {
      g.save();
      g.fillStyle = style;
      if (blur) { g.shadowColor = style; g.shadowBlur = blur; }
      points.forEach(function (p) {
        g.beginPath();
        g.arc((p.x - minx) * PX, (p.y - miny) * PX, radius * PX, 0, Math.PI * 2);
        g.fill();
      });
      g.restore();
    };
    blob(r, hex);                                   /* the rim */
    g.globalCompositeOperation = 'destination-out';
    blob(Math.max(0.05, r - 0.16), 'rgba(0,0,0,1)'); /* hollow it */
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 0.55;
    blob(Math.max(0.05, r - 0.06), hex);            /* and fill it back, softer */
    g.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: opacity,
                                    depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(minx + w / 2, (lift === undefined ? 0.06 : lift), miny + h / 2);
    return m;
  }

  function ringMesh(c, radius, colour, y) {
    const m = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.02, radius - 0.09), radius, 64),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85,
                                    side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(c.x, (y || 0) + 0.07, c.y);
    return m;
  }

  function tapeMesh(from, to, label, colour) {
    const g = new THREE.Group();
    const a = new THREE.Vector3(from.x, from.y + 0.5, from.z);
    const b = new THREE.Vector3(to.x, to.y + 0.5, to.z);
    const dir = b.clone().sub(a);
    if (dir.length() > 0.01) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, dir.length(), 6),
        new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.95 }));
      tube.position.copy(a).lerp(b, 0.5);
      tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      tube.renderOrder = 28;
      g.add(tube);
    }
    [a, b].forEach(function (e) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8),
        new THREE.MeshBasicMaterial({ color: colour, depthTest: false }));
      cap.position.copy(e); cap.renderOrder = 28;
      g.add(cap);
    });
    const c = document.createElement('canvas');
    c.width = 192; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(8,7,6,.92)'; x.fillRect(0, 10, 192, 44);
    x.strokeStyle = '#e8c65c'; x.lineWidth = 3; x.strokeRect(1.5, 11.5, 189, 41);
    x.fillStyle = '#f3e3ac';
    x.font = '700 34px Impact, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, 96, 33);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    sp.scale.set(4.2, 1.4, 1);
    sp.position.copy(a).lerp(b, 0.5).setY(Math.max(a.y, b.y) + 1.3);
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
      if (view.areaGlow) {
        const e = areaMesh(view.area, view.areaColour || COL.goldLit, 0.45,
                           (view.areaCell || 0.22) * 2.6, 0.03);
        e.material.blending = THREE.AdditiveBlending;
        overlayGroup.add(e);
      }
    }
    /* somewhere you can climb: lit up on top of the piece you would go up */
    /* somewhere you can climb: a disc lit up on top of the piece you go up */
    (view.climbs || []).forEach(function (c) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.85, 40),
        new THREE.MeshBasicMaterial({ color: COL.goldLit, transparent: true, opacity: 0.3,
                                      depthWrite: false, side: THREE.DoubleSide,
                                      blending: THREE.AdditiveBlending }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(c.x, c.top + 0.07, c.y);
      overlayGroup.add(disc);
      overlayGroup.add(ringMesh(c, 0.9, COL.goldLit, c.top));
    });
    if (view.ring) {
      overlayGroup.add(ringMesh(view.ring, view.ring.r, view.ringColour || COL.watch,
                                Board.heightAt(board, view.ring)));
    }
    if (view.tape) overlayGroup.add(tapeMesh(view.tape.from, view.tape.to, view.tape.label,
                                             view.tape.colour || COL.goldLit));
    (view.marks || []).forEach(function (m) {
      overlayGroup.add(ringMesh(m, m.r || 1.1, m.colour || COL.p1, Board.heightAt(board, m)));
    });
  }

  /* ============================================================== THE STRIKE
     One shape for every attack, so it always reads the same way: the weapon
     goes off, something crosses the table, and it either finds him or it does
     not. No dice are ever shown — where the round ends up IS the roll. */

  const T = { AIM: 0.6, FIRE: 0.28, FLIGHT: 0.4, DWELL: 0.9, OUT: 0.5 };

  const worldOf = p => new THREE.Vector3(p.x, p.z, p.y);

  function queueStrike(k) {
    if (!unitNodes[k.attacker] || !unitNodes[k.target]) return;
    const holds = {};
    holds[k.attacker] = true;
    holds[k.target] = true;
    cine.push({ k: k, holds: holds, t: 0, stage: 'aim', fired: false });
  }

  /* Where a round that missed ends up: past him, into whatever is behind. */
  function missPoint(k) {
    const from = worldOf(k.from), to = worldOf(k.to);
    const dir = to.clone().sub(from).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x)
      .multiplyScalar((Assets.seeded(k.at * 13 + 5) - 0.5) * 3);
    const p = to.clone().addScaledVector(dir, 2 + Assets.seeded(k.at * 7) * 2.5).add(side);
    p.x = Math.max(0.5, Math.min(board.w - 0.5, p.x));
    p.z = Math.max(0.5, Math.min(board.h - 0.5, p.z));
    p.y = Board.heightAt(board, { x: p.x, y: p.z }) + 0.3;
    return p;
  }

  function shotCamera(k) {
    const from = worldOf(k.from), to = worldOf(k.to);
    const mid = from.clone().lerp(to, 0.55);
    const d = to.clone().sub(from);
    const len = Math.max(3, d.length());
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
    want = {
      target: mid.setY(mid.y + 1.0),
      dist: Math.max(10, Math.min(24, len * 1.45)),
      az: Math.atan2(side.z, side.x) + (Assets.seeded(k.at * 3) < 0.5 ? 0 : Math.PI),
      el: 0.3 + Assets.seeded(k.at * 11) * 0.18,
      ease: 0.015
    };
  }

  function playStrike(c, dt) {
    const k = c.k;
    const a = unitNodes[k.attacker], t = unitNodes[k.target];
    c.t += dt;

    if (c.stage === 'aim') {
      if (!c.framed) {
        c.framed = true;
        shotCamera(k);
        const from = worldOf(k.from), to = worldOf(k.to);
        a.position.set(k.from.x, k.from.z, k.from.y);
        t.position.set(k.to.x, k.to.z, k.to.y);
        a.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x) + Math.PI / 2;
        a.userData.body.rotation.x = -0.07;
      }
      if (c.t >= T.AIM) {
        /* one die, in the bowl, before the shot goes */
        if (k.rolls && k.rolls.hitTarget) rollDie(k.rolls.hit, k.rolls.hitTarget, 'TO HIT');
        c.stage = 'waitHit'; c.t = 0;
      }
      return;
    }

    if (c.stage === 'waitHit') {
      if (!rollingNow() && c.t > 0.35) { c.stage = 'fire'; c.t = 0; }
      return;
    }

    if (c.stage === 'waitWound') {
      if (!rollingNow() && c.t > 0.3) {
        if (k.wound) {
          if (k.killed) gore(c.impact, 1.8); else blood(c.impact, 1);
          Sfx.wound(k.killed ? 1 : 0.85);
          if (k.killed) window.setTimeout(() => Sfx.down(), 280);
          shake = Math.max(shake, k.killed ? 0.55 : 0.32);
        }
        c.stage = 'dwell'; c.t = 0;
      }
      return;
    }

    if (c.stage === 'fire') {
      if (!c.fired) {
        c.fired = true;
        const from = worldOf(k.from); from.y = k.from.z + 0.95;
        c.impact = k.hit ? (function () { const p = worldOf(k.to); p.y = k.to.z + 0.85; return p; })()
                         : missPoint(k);
        c.muzzlePos = from;
        if (k.melee) {
          Sfx.swing(1);
          a.userData.body.rotation.x = -0.55;
        } else {
          Sfx.shot(1);
          muzzle(from);
          c.bolt = boltNode(from, c.impact);
          a.userData.body.rotation.x = 0.24;
        }
        shake = Math.max(shake, k.melee ? 0.1 : 0.2);
      }
      if (c.t >= T.FIRE) { c.stage = 'flight'; c.t = 0; }
      return;
    }

    if (c.stage === 'flight') {
      const span = k.melee ? 0.16 : T.FLIGHT;
      const p = Math.min(1, c.t / span);
      if (c.bolt) c.bolt.position.copy(c.muzzlePos).lerp(c.impact, p);
      a.userData.body.rotation.x *= 0.85;
      if (p >= 1) {
        if (c.bolt) { fxGroup.remove(c.bolt); c.bolt = null; }
        resolveVisually(c);
        if (k.hit && k.rolls && k.rolls.woundTarget) {
          /* it struck him — now find out whether it got through */
          rollDie(k.rolls.wound, k.rolls.woundTarget, 'TO WOUND');
          c.stage = 'waitWound'; c.t = 0;
        } else {
          c.stage = 'dwell'; c.t = 0;
        }
      }
      return;
    }

    if (c.stage === 'dwell') {
      if (k.killed) {
        const p = Math.min(1, c.t / 0.9);
        const e = p * p * (3 - 2 * p);
        t.userData.body.rotation.x = -e * (Math.PI / 2.05);
        t.userData.body.rotation.z = e * 0.3;
        t.userData.body.position.y = 0.12 + e * 0.04;
        t.userData.label.visible = false;
        t.userData.pips.visible = false;
        t.userData.ring.material.emissiveIntensity = (1 - e) * 0.5;
      } else if (k.wound) {
        t.userData.body.rotation.x = -0.38 * Math.exp(-c.t * 5) * Math.cos(c.t * 20);
      } else if (k.hit) {
        t.userData.body.rotation.z = 0.18 * Math.exp(-c.t * 7) * Math.cos(c.t * 24);
      }
      if (c.t >= T.DWELL) { c.stage = 'out'; c.t = 0; leanOut(); }
      return;
    }

    if (c.t >= T.OUT) c.done = true;
  }

  /* What the round does when it arrives. Armour or rockcrete both ring and
     throw sparks; blood waits on the wound roll and never appears without it. */
  function resolveVisually(c) {
    const k = c.k, at = c.impact;
    sparks(at, k.hit ? 1 : 0.85);
    Sfx.clang(k.hit ? 1 : 0.85);
    if (!k.hit) scorch(at);
    shake = Math.max(shake, 0.17);
    /* a strike with no dice behind it (an ability) resolves its blood here */
    if (k.wound && !(k.rolls && k.rolls.woundTarget)) {
      if (k.killed) gore(at, 1.8); else blood(at, 1);
      Sfx.wound(k.killed ? 1 : 0.85);
      shake = Math.max(shake, 0.4);
    }
  }

  function boltNode(from, to) {
    const g = new THREE.Group();
    const dir = to.clone().sub(from).normalize();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.028, 1.2, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
    core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.add(core);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.55,
                                    blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(glow);
    g.add(new THREE.PointLight(0xffc070, 4, 7, 2));
    g.position.copy(from);
    fxGroup.add(g);
    return g;
  }

  function muzzle(at) {
    const l = new THREE.PointLight(0xffd08a, 18, 13, 2);
    l.position.copy(at);
    fxGroup.add(l);
    fx.push({ kind: 'flash', node: l, t: 0, life: 0.15, peak: 18 });
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9,
                                    blending: THREE.AdditiveBlending, depthWrite: false }));
    f.position.copy(at);
    fxGroup.add(f);
    fx.push({ kind: 'puff', node: f, t: 0, life: 0.17 });
  }

  function particles(at, n, colour, size, speed, gravity, spread) {
    const pos = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
      const ang = Math.random() * Math.PI * 2, el = Math.random() * spread;
      const s = speed * (0.35 + Math.random());
      vel.push(new THREE.Vector3(Math.cos(ang) * Math.cos(el) * s,
                                 Math.sin(el) * s + speed * 0.35,
                                 Math.sin(ang) * Math.cos(el) * s));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: colour, size: size, transparent: true, opacity: 1, depthWrite: false }));
    pts.userData.vel = vel;
    pts.userData.gravity = gravity;
    fxGroup.add(pts);
    return pts;
  }

  function sparks(at, scale) {
    fx.push({ kind: 'parts', node: particles(at, 60, COL.spark, 0.24 * scale, 11, 30, 1.35),
              t: 0, life: 0.85 });
    fx.push({ kind: 'parts', node: particles(at, 22, 0xfff0c0, 0.13 * scale, 16, 34, 1.5),
              t: 0, life: 0.55 });
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.4 * scale, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffdca0, transparent: true, opacity: 0.95,
                                    blending: THREE.AdditiveBlending, depthWrite: false }));
    f.position.copy(at);
    fxGroup.add(f);
    fx.push({ kind: 'puff', node: f, t: 0, life: 0.22 });
    const l = new THREE.PointLight(0xffa040, 16 * scale, 11, 2);
    l.position.copy(at);
    fxGroup.add(l);
    fx.push({ kind: 'flash', node: l, t: 0, life: 0.26, peak: 16 * scale });
  }

  /* ================================================================= GORE
     Blood does not evaporate. Every wound leaves the ground marked for the
     rest of the game, and by the back half of a hard fight the middle of the
     table looks like what has been happening on it. */
  const stains = new THREE.Group();
  const gibs = [];
  const MAX_STAINS = 220;

  function bloodTexture(seed) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    const blobs = 5 + Math.floor(Assets.seeded(seed) * 6);
    for (let i = 0; i < blobs; i++) {
      const v = Assets.seeded(seed * 31 + i * 7);
      const x = 64 + (Assets.seeded(seed + i * 3) - 0.5) * 70;
      const y = 64 + (Assets.seeded(seed + i * 5) - 0.5) * 70;
      const r = 10 + v * 34;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(96,10,8,0.96)');
      grd.addColorStop(0.6, 'rgba(70,7,6,0.8)');
      grd.addColorStop(1, 'rgba(46,4,4,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
    }
    /* flung droplets round the edge */
    for (let i = 0; i < 26; i++) {
      const a = Assets.seeded(seed * 13 + i) * 6.28;
      const d = 28 + Assets.seeded(seed * 17 + i) * 34;
      const r = 1 + Assets.seeded(seed * 19 + i) * 4;
      g.fillStyle = 'rgba(84,8,7,' + (0.5 + Assets.seeded(seed + i) * 0.5).toFixed(2) + ')';
      g.beginPath();
      g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, 6.28);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const bloodTex = [];
  const someBlood = i => {
    const k = i % 6;
    if (!bloodTex[k]) bloodTex[k] = bloodTexture(k * 97 + 11);
    return bloodTex[k];
  };

  let stainSeq = 0;
  function stain(at, size, onTop) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: someBlood(stainSeq++), transparent: true,
                                    opacity: 0.9, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * 6.28;
    const y = onTop === undefined ? Board.heightAt(board, { x: at.x, y: at.z }) : onTop;
    m.position.set(at.x, y + 0.03 + (stainSeq % 7) * 0.001, at.z);
    m.renderOrder = 2;
    stains.add(m);
    while (stains.children.length > MAX_STAINS) stains.remove(stains.children[0]);
  }

  function blood(at, scale) {
    /* the spray */
    fx.push({ kind: 'parts', node: particles(at, Math.round(70 * scale), COL.blood,
                                             0.24 * scale, 7.5, 26, 1.1), t: 0, life: 1.1 });
    fx.push({ kind: 'parts', node: particles(at, Math.round(30 * scale), 0x9a2018,
                                             0.36 * scale, 4.0, 20, 1.5), t: 0, life: 1.35 });
    fx.push({ kind: 'parts', node: particles(at, Math.round(18 * scale), 0x4a0d0a,
                                             0.5 * scale, 2.6, 16, 1.6), t: 0, life: 1.6 });
    /* a mist that hangs a moment */
    const mist = new THREE.Mesh(new THREE.SphereGeometry(0.55 * scale, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x6d1410, transparent: true, opacity: 0.55,
                                    depthWrite: false }));
    mist.position.copy(at);
    fxGroup.add(mist);
    fx.push({ kind: 'puff', node: mist, t: 0, life: 0.5 });

    /* and the mark it leaves, which stays */
    stain({ x: at.x, y: at.y, z: at.z }, 1.7 * scale);
    for (let i = 0; i < Math.round(2 + scale * 3); i++) {
      const a = Assets.seeded(stainSeq * 7 + i) * 6.28;
      const d = 0.6 + Assets.seeded(stainSeq * 11 + i) * 2.4 * scale;
      stain({ x: at.x + Math.cos(a) * d, y: 0, z: at.z + Math.sin(a) * d },
            (0.5 + Assets.seeded(stainSeq * 3 + i) * 1.1) * scale);
    }
  }

  /* What is left of somebody the round went through. */
  function gore(at, scale) {
    blood(at, scale * 1.5);
    const n = Math.round(9 * scale);
    for (let i = 0; i < n; i++) {
      const g = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.09 + Math.random() * 0.13, 0),
        new THREE.MeshStandardMaterial({ color: i % 3 ? 0x6d1410 : 0x8d2a20,
                                         roughness: 0.55, metalness: 0.05 }));
      g.position.copy(at);
      g.castShadow = true;
      fxGroup.add(g);
      const a = Math.random() * 6.28, e = Math.random() * 1.1;
      gibs.push({ mesh: g, t: 0,
                  v: new THREE.Vector3(Math.cos(a) * Math.cos(e) * (3 + Math.random() * 6),
                                       2 + Math.random() * 6,
                                       Math.sin(a) * Math.cos(e) * (3 + Math.random() * 6)),
                  spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
                  floor: Board.heightAt(board, { x: at.x, y: at.z }) + 0.08 });
    }
    while (gibs.length > 90) { const old = gibs.shift(); fxGroup.remove(old.mesh); }
  }

  function scorch(at) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 14),
      new THREE.MeshBasicMaterial({ color: 0x16120d, transparent: true, opacity: 0,
                                    depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(at.x, Board.heightAt(board, { x: at.x, y: at.z }) + 0.025, at.z);
    fxGroup.add(m);
    fx.push({ kind: 'stain', node: m, t: 0, life: 30, peak: 0.55 });
  }

  const busy = () => cine.length > 0 || !!playing || rollingNow();

  /* ------------------------------------------------------------------ frame */

  function tick() {
    requestAnimationFrame(tick);
    resize();
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    flyCamera(dt);
    markerGroup.children.forEach(g => { if (g.userData.spin) g.userData.spin.rotation.y += dt * 0.4; });
    Object.keys(tokenNodes).forEach(function (id) {
      const n = tokenNodes[id];
      if (!n.userData.puffs) {
        /* a fuse light that quickens as the chain runs down */
        if (n.userData.lamp) {
          const b = 0.5 + 0.5 * Math.sin(now * 0.009);
          n.userData.lamp.material.color.setRGB(1, 0.28 * b, 0.16 * b);
          n.userData.glow.intensity = 1.2 + b * 2.4;
        }
        return;
      }
      n.userData.puffs.children.forEach(function (p, i) {
        p.rotation.y += dt * p.userData.spin;
        p.position.y += Math.sin(now * 0.0011 + p.userData.bob) * dt * 0.22;
      });
    });
    if (relicNode && relicNode.visible) {
      relicNode.userData.shard.rotation.y += dt * 0.9;
      relicNode.userData.shard.rotation.x += dt * 0.35;
      const p = 1 + Math.sin(now * 0.0022) * 0.09;
      relicNode.userData.halo.scale.setScalar(p);
    }
    if (tray) stepTray(dt);

    if (!playing && cine.length) { playing = cine.shift(); playing.age = 0; }
    if (playing) {
      /* A WATCHDOG ON THE CINEMATIC.

         busy() gates every click, and it is true while a shot is playing out.
         If that playback ever fails to reach its end — a step that throws, a
         model removed underneath it, a stage waiting on something that never
         arrives — the table stops accepting input and the game is over as far
         as the players are concerned. "It locks up in the middle of combat"
         is exactly that shape. No single shot needs eight seconds; past that,
         it is finished whether it thinks so or not. */
      playing.age += dt;
      try {
        playStrike(playing, dt);
      } catch (err) {
        playing.done = true;
        if (window.console) console.error('strike playback failed, releasing table', err);
      }
      if (playing.age > 8) playing.done = true;
      if (playing.done) playing = null;
    }

    for (let i = gibs.length - 1; i >= 0; i--) {
      const p = gibs[i];
      p.t += dt;
      if (p.mesh.position.y > p.floor) {
        p.v.y -= 30 * dt;
        p.mesh.position.addScaledVector(p.v, dt);
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        if (p.mesh.position.y <= p.floor) {
          p.mesh.position.y = p.floor;
          stain({ x: p.mesh.position.x, y: 0, z: p.mesh.position.z }, 0.5 + Math.random() * 0.6);
        }
      }
    }

    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      e.t += dt;
      const k = e.t / e.life;
      if (e.kind === 'flash') e.node.intensity = Math.max(0, (e.peak || 8) * (1 - k) * (1 - k));
      if (e.kind === 'puff') {
        e.node.material.opacity = Math.max(0, 0.9 * (1 - k));
        e.node.scale.setScalar(1 + k * 2.4);
      }
      if (e.kind === 'parts') {
        const pos = e.node.geometry.attributes.position;
        const g = e.node.userData.gravity;
        e.node.userData.vel.forEach(function (v, j) {
          v.y -= g * dt;
          pos.setXYZ(j, pos.getX(j) + v.x * dt, Math.max(0.02, pos.getY(j) + v.y * dt),
                     pos.getZ(j) + v.z * dt);
        });
        pos.needsUpdate = true;
        e.node.material.opacity = Math.max(0, 1 - k * k);
      }
      if (e.kind === 'blast') {
        e.node.material.opacity = Math.max(0, 1 - k * 1.3);
        e.node.scale.setScalar(1 + k * 4.5 * e.scale);
      }
      if (e.kind === 'smoke') {
        e.node.material.opacity = Math.max(0, 0.7 * (1 - k));
        e.node.scale.setScalar(0.5 + k * 2.2);
        e.node.position.y += dt * 1.1;
      }
      if (e.kind === 'shock') {
        e.node.material.opacity = Math.max(0, 0.85 * (1 - k * k));
        e.node.scale.setScalar(0.4 + k * e.scale);
      }
      if (e.kind === 'stain') {
        const peak = e.peak || 0.7;
        e.node.material.opacity = k < 0.03 ? (k / 0.03) * peak
                                : peak * Math.max(0, 1 - Math.max(0, k - 0.65) / 0.35);
      }
      if (k >= 1) {
        if (e.node.parent) e.node.parent.remove(e.node);
        fx.splice(i, 1);
      }
    }

    animateUnits(dt);

    if (want) {
      const k = 1 - Math.pow(want.ease || 0.006, dt);
      cam.target.lerp(want.target, k);
      cam.dist += (want.dist - cam.dist) * k;
      if (want.az !== undefined) {
        let d = want.az - cam.az;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        cam.az += d * k;
      }
      if (want.el !== undefined) cam.el += (want.el - cam.el) * k;
      placeCamera();
      if (cam.target.distanceTo(want.target) < 0.06 && Math.abs(cam.dist - want.dist) < 0.25) want = null;
    }

    if (shake > 0.001) {
      shake *= Math.pow(0.0015, dt);
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
    }

    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  /* ------------------------------------------------------------ the models,
     moving. The rules finished a while ago; this is the part you watch. */

  function animateUnits(dt) {
    if (!lastState) return;
    lastState.units.forEach(function (u) {
      const node = unitNodes[u.id];
      if (!node || u.reserve) return;
      const body = node.userData.body;

      /* arriving on the table for the first time */
      if (node.userData.enter !== undefined && node.userData.enter < 1) {
        node.userData.enter = Math.min(1, node.userData.enter + dt * 1.6);
        const e = node.userData.enter;
        const s2 = e < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - e, 3)) : 1;
        body.scale.setScalar(s2);
        node.userData.label.material.opacity = e;
      }

      /* standing about: a slow breath, and a lift when selected */
      if (u.alive) {
        const t2 = performance.now() / 1000 + (u.id.charCodeAt(1) || 0);
        body.position.y = 0.12 + Math.sin(t2 * 1.3) * 0.012;
        const sel = node.userData.selected;
        const target = sel ? 1.06 : 1;
        const cur = body.scale.x;
        if (node.userData.enter === undefined || node.userData.enter >= 1) {
          body.scale.setScalar(cur + (target - cur) * Math.min(1, dt * 8));
        }
        node.userData.ring.material.emissiveIntensity =
          sel ? 0.7 + Math.sin(t2 * 4) * 0.3 : 0.5;
      }

      /* turn to face where it means to, rather than snapping */
      if (node.userData.wantRot !== undefined) {
        let d = node.userData.wantRot - node.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        node.rotation.y += d * Math.min(1, dt * 9);
      }
    });
  }

  /* -------------------------------------------------------------- the state */

  let view0 = null;

  function draw(S, view) {
    if (!board || board.id !== S.board.id) buildBoard(S.board);
    view0 = view || {};
    lastState = S;
    syncUnits(S);
    syncRelic(S);
    syncTokens(S);
    setOverlay(view);

    S.strikes.forEach(function (k) {
      if (k.at <= seenStrike) return;
      seenStrike = k.at;
      queueStrike(k);
    });
    (S.dice || []).forEach(function (d) {
      if (d.at <= seenStrike) return;
      seenStrike = d.at;
      rollDie(d.value, d.target, d.label);
    });
    S.units.forEach(function (u) {
      if (!u.climbed || seenClimb[u.id] === u.climbed.at) return;
      seenClimb[u.id] = u.climbed.at;
      Sfx.climb();
    });
  }

  /* --------------------------------------------------------------- picking */

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function setNdc(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((x - r.left) / r.width) * 2 - 1;
    ndc.y = -((y - r.top) / r.height) * 2 + 1;
    return r;
  }

  function pick(x, y) {
    if (!board) return null;
    setNdc(x, y);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(terrainGroup.children, true);
    if (!hits.length) return null;
    const p = hits[0].point;
    return { x: p.x, y: p.z, height: p.y, terrain: hits[0].object.userData.terrain || null };
  }

  function pickNearest(x, y, points, maxPx) {
    if (!points || !points.length) return null;
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let best = null, bestD = maxPx || 46;
    points.forEach(function (p) {
      v.set(p.x, Board.heightAt(board, p) + 0.3, p.y).project(camera);
      if (v.z > 1) return;
      const sx = r.left + (v.x + 1) / 2 * r.width;
      const sy = r.top + (1 - (v.y + 1) / 2) * r.height;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) { bestD = d; best = p; }
    });
    return best;
  }

  /* CHOOSING FROM A LIST THE GAME HAS ALREADY NARROWED DOWN.

     `pickUnit` answers "who is under the cursor". That is the wrong question
     when the game is asking "which of THESE" — the models on a 46" table seen
     from a low angle overlap constantly, and the ray very often passes through
     somebody who is not on the list on its way to somebody who is. The caller
     then found a unit that was not an option and did nothing at all: you click
     the enemy you mean, and the table ignores you. That is what "you can't
     select targets" and "Da Hunta's ability is broken" both were.

     So this asks the right question. The nearest LEGAL model, preferring one
     the ray actually goes through, and otherwise the closest legal one to the
     cursor on screen. */
  function pickUnitFrom(x, y, S, ids) {
    if (!ids || !ids.length) return null;
    const allow = Object.create(null);
    ids.forEach(function (i) { allow[i] = true; });

    const r = setNdc(x, y);

    /* Nearest to where you clicked, ON SCREEN — not front-most along the ray.

       A raycast answers "whose polygons are in front", which is the right
       answer for a first-person game and the wrong one here. These models are
       an inch wide on a 46" table; at any normal camera height half of them
       overlap the model behind, and a strict raycast hands you the neighbour
       whose shoulder happens to cross the one you aimed at. Measured: clicking
       a model's own centre returned a DIFFERENT model six times out of fifteen.

       Screen distance to the model's centre is what the player actually means.
       The ray is kept only to break a tie when two of them land on nearly the
       same pixel, where "the one in front" really is the right answer. */
    const v = new THREE.Vector3();
    const toScreen = function (wx, wy, wz) {
      v.set(wx, wy, wz).project(camera);
      if (v.z > 1) return null;
      return { x: r.left + (v.x + 1) / 2 * r.width,
               y: r.top + (1 - (v.y + 1) / 2) * r.height };
    };
    /* distance to the model's whole standing height on screen, not to one
       point on it — click its boots or its head and it is still that model */
    const near = [];
    S.units.forEach(function (u) {
      if (!u.alive || u.reserve || !allow[u.id]) return;
      const foot = Board.heightAt(board, u);
      const a = toScreen(u.x, foot + 0.05, u.y);
      const b = toScreen(u.x, foot + 1.85, u.y);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
      near.push({ u: u, d: Math.hypot(a.x + dx * t - x, a.y + dy * t - y) });
    });
    if (!near.length) return null;
    near.sort((a, b) => a.d - b.d);
    if (near[0].d > 120) return null;              /* nowhere near anybody */

    /* Genuinely the same pixel: let the ray say which is in front. Kept very
       tight — at ten pixels this was overriding a clean aim at a model six
       pixels behind its neighbour, which is the bug it was meant to help. */
    if (near.length > 1 && near[1].d - near[0].d < 3) {
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(unitGroup.children, true);
      for (let i = 0; i < hits.length; i++) {
        const id = hits[i].object.userData.unitId;
        if (!id || !allow[id]) continue;
        const tie = near.find(k => k.u.id === id && k.d - near[0].d < 3);
        if (tie) return tie.u;
      }
    }
    return near[0].u;
  }

  function pickUnit(x, y, S) {
    setNdc(x, y);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(unitGroup.children, true);
    for (let i = 0; i < hits.length; i++) {
      const id = hits[i].object.userData.unitId;
      if (!id) continue;
      const u = S.units.find(q => q.id === id);
      if (u && u.alive) return u;
    }
    const p = pick(x, y);
    if (!p) return null;
    let best = null, bestD = 1.1;
    S.units.forEach(function (u) {
      if (!u.alive) return;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < bestD) { bestD = d; best = u; }
    });
    return best;
  }

  const focusOn = p => leanIn(p, Math.max(18, cam.dist * 0.6));

  return {
    attach, resize, draw, pick, pickUnit, pickUnitFrom, pickNearest, viewFrom, focusOn, setTap,
    leanIn, leanOut, busy, COL, rollDie, rollingNow,
    get camera() { return camera; },
    get scene() { return scene; }
  };
})();

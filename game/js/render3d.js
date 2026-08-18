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

  let renderer, scene, camera, canvas, keyLight;
  let terrainGroup, unitGroup, overlayGroup, fxGroup, markerGroup;
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
    scene.background = skyTexture();
    scene.fog = new THREE.FogExp2(0x2f3138, 0.0052);

    camera = new THREE.PerspectiveCamera(42, 1, 0.4, 600);

    scene.add(new THREE.HemisphereLight(0xbcd0e8, 0x4a3a26, 1.45));
    scene.add(new THREE.AmbientLight(0xfff2dd, 0.42));
    keyLight = new THREE.DirectionalLight(0xffe8c4, 3.1);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0011;
    keyLight.shadow.normalBias = 0.035;
    scene.add(keyLight, keyLight.target);
    /* a cold rim off the opposite shoulder, so edges separate from the ground
       instead of everything sinking into one brown */
    const rim = new THREE.DirectionalLight(0x86b0ff, 1.5);
    rim.position.set(34, 16, 30);
    scene.add(rim);
    const back = new THREE.DirectionalLight(0xff9d5c, 0.7);
    back.position.set(-20, 10, 34);
    scene.add(back);

    terrainGroup = new THREE.Group();
    unitGroup = new THREE.Group();
    overlayGroup = new THREE.Group();
    fxGroup = new THREE.Group();
    markerGroup = new THREE.Group();
    scene.add(terrainGroup, markerGroup, overlayGroup, unitGroup, fxGroup);

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

  function skyTexture() {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#070a14');
    grd.addColorStop(0.5, '#25272e');
    grd.addColorStop(0.78, '#4a4038');
    grd.addColorStop(1, '#6d5540');
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
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

  function groundTexture(w, h) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#6a6b66';
    g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 64) {
      for (let x = 0; x < 512; x += 64) {
        const v = Assets.seeded(x * 7 + y * 13);
        g.fillStyle = 'rgba(0,0,0,' + (0.03 + v * 0.1).toFixed(3) + ')';
        g.fillRect(x + 1, y + 1, 62, 62);
        g.strokeStyle = 'rgba(20,16,12,.55)';
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, 62, 62);
      }
    }
    for (let i = 0; i < 340; i++) {
      const v = Assets.seeded(i * 31);
      const r = 8 + v * 56;
      const x = Assets.seeded(i * 17) * 512, y = Assets.seeded(i * 53) * 512;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(28,20,12,' + (0.05 + v * 0.17).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(28,20,12,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / 8, h / 8);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  /* Worn plate: panel lines, rivets, rust streaks, and a hazard band along the
     top edge so the height of a piece reads at a glance. */
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
      grd.addColorStop(1, 'rgba(92,52,24,0)');
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

  function buildBoard(b) {
    board = b;
    [terrainGroup, markerGroup].forEach(g => { while (g.children.length) g.remove(g.children[0]); });

    const floor = new THREE.Mesh(new THREE.BoxGeometry(b.w, 1, b.h),
      new THREE.MeshStandardMaterial({ map: groundTexture(b.w, b.h), roughness: 0.96, metalness: 0.04 }));
    floor.position.set(b.w / 2, -0.5, b.h / 2);
    floor.receiveShadow = true;
    terrainGroup.add(floor);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(b.w + 2, 1.4, b.h + 2),
      new THREE.MeshStandardMaterial({ color: 0x18140f, roughness: 1 }));
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
      if (Assets.has('turret_single')) g.add(Assets.fitted('turret_single', 1.5, 1.5, 1.2));
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
  function dressTerrain(t, idx) {
    const g = new THREE.Group();
    g.position.set(t.x + t.w / 2, 0, t.y + t.h / 2);
    const kind = t.kind || (t.blocks ? 'blockhouse' : 'platform');
    const rnd = i => Assets.seeded(idx * 613 + i * 37);

    /* The mass is the rules box, exactly — nothing on the table is cover that
       the rules do not know about, and nothing the rules know about is
       invisible. The kit is what makes it worth looking at. */
    if (kind !== 'rubble') {
      /* cloned per piece: the cache holds the image, but the repeat belongs to
         this box and must not be shared with every other one on the table */
      const side = panelTexture('side' + (t.blocks ? 'B' : 'P'), t.blocks && t.top > 2).clone();
      side.needsUpdate = true;
      side.repeat.set(Math.max(1, t.w / 2.6), Math.max(1, t.top / 2.2));
      const cap = panelTexture('cap', false).clone();
      cap.needsUpdate = true;
      cap.repeat.set(Math.max(1, t.w / 2.6), Math.max(1, t.h / 2.6));
      const sideMat = new THREE.MeshStandardMaterial({
        map: side, color: t.blocks ? 0xbdb6a9 : 0xd2c6b0, roughness: 0.85, metalness: 0.32 });
      const capMat = new THREE.MeshStandardMaterial({
        map: cap, color: t.blocks ? 0xa9a397 : 0xe0d3ba, roughness: 0.9, metalness: 0.22 });
      const mass = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.top, t.h),
        [sideMat, sideMat, capMat, capMat, sideMat, sideMat]);
      mass.position.y = t.top / 2;
      mass.castShadow = true; mass.receiveShadow = true;
      g.add(mass);

      /* A rim round the top edge, as four bars — a slab here would roof the
         piece over and you would be looking at its dark underside instead of
         the deck. */
      const rimMat = new THREE.MeshStandardMaterial({
        color: 0x6b6154, roughness: 0.5, metalness: 0.8 });
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

    if (kind === 'rubble') {
      const n = Math.max(3, Math.round(t.w * t.h / 2));
      for (let i = 0; i < n; i++) {
        const v = rnd(i * 7);
        const r = Assets.fitted(v < 0.4 ? 'rock' : v < 0.75 ? 'rocks_smallA' : 'rock_largeB',
                                0.8 + v * 0.9, 0.8 + v * 0.9, t.top * (0.85 + v * 0.5));
        r.position.set((rnd(i * 3) - 0.5) * t.w * 0.8, 0, (rnd(i * 5) - 0.5) * t.h * 0.8);
        r.rotation.y = v * 6.28;
        g.add(r);
      }
      return finishDress(g, t);
    }

    /* --- what stands on it and against it, from the kit --- */
    const edgeProp = function (name, w, d, h, inset) {
      const p = Assets.fitted(name, w, d, h);
      const edge = Math.floor(rnd(inset * 3 + 1) * 4);
      const along = (rnd(inset * 5 + 2) - 0.5) * 0.72;
      if (edge < 2) p.position.set(along * t.w, 0, (edge === 0 ? -1 : 1) * (t.h / 2 + d * 0.55));
      else p.position.set((edge === 2 ? -1 : 1) * (t.w / 2 + w * 0.55), 0, along * t.h);
      p.rotation.y = rnd(inset * 7) * 6.28;
      return p;
    };

    if (t.blocks) {
      const props = ['barrels', 'machine_generator', 'barrel', 'machine_barrel', 'pipe_supportLow'];
      const n = Math.min(4, Math.max(2, Math.round((t.w + t.h) / 5)));
      for (let i = 0; i < n; i++) {
        g.add(edgeProp(props[Math.floor(rnd(i * 5) * props.length)], 0.85, 0.85, 0.8, i));
      }
      if (t.w > 2.4 && t.h > 2.4 && t.top > 2.5) {
        const f = Assets.fitted(rnd(1) < 0.5 ? 'structure_diagonal' : 'supports_high',
                                t.w * 0.7, t.h * 0.7, 1.7);
        f.position.y = t.top;
        f.rotation.y = Math.floor(rnd(2) * 4) * Math.PI / 2;
        g.add(f);
      }
      if (t.w > 3.5 && t.h > 2 && Assets.has('pipe_straight')) {
        const pipe = Assets.fitted('pipe_straight', t.w * 0.8, 0.5, 0.5);
        pipe.position.set(0, t.top * 0.55, -t.h / 2 - 0.18);
        g.add(pipe);
      }
    } else {
      /* a deck: rails round the lip, steps up one side, kit on top */
      if (Assets.has('rail') && t.w > 2.2 && t.h > 2.2) {
        const run = function (len, across, axis) {
          const n = Math.max(1, Math.round(len / 1.9));
          for (let i = 0; i < n; i++) {
            [-1, 1].forEach(function (sgn) {
              const r = Assets.fitted('rail', len / n, 0.14, 0.6);
              if (axis === 'x') r.position.set(-len / 2 + (i + 0.5) * (len / n), t.top, sgn * (across / 2 - 0.1));
              else { r.rotation.y = Math.PI / 2;
                     r.position.set(sgn * (across / 2 - 0.1), t.top, -len / 2 + (i + 0.5) * (len / n)); }
              g.add(r);
            });
          }
        };
        run(t.w, t.h, 'x');
        run(t.h, t.w, 'z');
      }
      /* Steps go on whichever side has open ground to come up from, facing
         out, with their top against the deck — not on a fixed edge where they
         end up backwards, or buried in the next piece of terrain along. */
      if (Assets.has('stairs') && t.top > 1) {
        const depth = Math.min(2.6, Math.max(1.4, t.top * 1.5));
        const side = bestApproach(t, depth);
        if (side) {
          const st = Assets.fitted('stairs', 1.7, depth, t.top);
          st.rotation.y = side.turn;
          st.position.set(side.x, 0, side.z);
          st.userData.stairsFor = t;
          g.add(st);
        }
      }
      if (t.w > 4 && t.h > 4) {
        const dish = Assets.fitted(rnd(3) < 0.5 ? 'satelliteDish' : 'machine_wireless', 1.9, 1.9, 1.6);
        dish.position.set(t.w * 0.24, t.top, -t.h * 0.24);
        g.add(dish);
        const crate = Assets.fitted('barrels_rail', 1.2, 1.2, 0.85);
        crate.position.set(-t.w * 0.24, t.top, t.h * 0.2);
        crate.rotation.y = rnd(4) * 6.28;
        g.add(crate);
      } else if (t.w > 1.8 && t.h > 1.8) {
        const bar = Assets.fitted('barrel', 0.6, 0.6, 0.75);
        bar.position.set(t.w * 0.2, t.top, t.h * 0.2);
        g.add(bar);
      }
    }
    return finishDress(g, t);
  }

  /* Which side of a piece you could actually walk up to, scored on how much
     clear table is in front of it. Returns a local offset and a turn, or null
     if the piece is boxed in on every side. */
  function bestApproach(t, depth) {
    /* The kit's stairs rise toward +Z — measured off the mesh, not guessed —
       so the turn has to bring their HIGH end round to face the deck. Sitting
       on the north face the model is already right way round; on the south it
       needs turning about. Every one of these was reversed, which is why they
       all ran the wrong way. */
    const sides = [
      { nx: 0, nz: -1, turn: 0 },               /* north face: rise is +Z, into the deck */
      { nx: 0, nz: 1, turn: Math.PI },          /* south face */
      { nx: -1, nz: 0, turn: Math.PI / 2 },     /* west face: +Z round to +X */
      { nx: 1, nz: 0, turn: -Math.PI / 2 }      /* east face */
    ];
    let best = null;
    sides.forEach(function (s2) {
      const half = s2.nx ? t.w / 2 : t.h / 2;
      let clear = 0;
      for (let a = -0.5; a <= 0.5; a += 0.25) {
        for (let d = 0.6; d <= depth + 0.6; d += 0.6) {
          const px = t.x + t.w / 2 + s2.nx * (half + d) + (s2.nx ? 0 : a * t.w * 0.7);
          const pz = t.y + t.h / 2 + s2.nz * (half + d) + (s2.nz ? 0 : a * t.h * 0.7);
          if (px < 0.5 || pz < 0.5 || px > board.w - 0.5 || pz > board.h - 0.5) continue;
          const p = { x: px, y: pz };
          if (board.terrain.some(o => o !== t && Board.inBox(o, p))) continue;
          clear++;
        }
      }
      if (!best || clear > best.clear) {
        best = { clear: clear, turn: s2.turn,
                 x: s2.nx * (t.w / 2 + depth / 2 - 0.05),
                 z: s2.nz * (t.h / 2 + depth / 2 - 0.05) };
      }
    });
    return best && best.clear >= 6 ? best : null;
  }

  function finishDress(g, t) {
    g.traverse(function (o) { if (o.isMesh) o.userData.terrain = t; });
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
    if (Assets.has('barrel')) token.add(Assets.fitted('barrel', 0.55, 0.55, 0.85));
    token.visible = false;
    markerGroup.add(token);
    g.userData.token = token;

    return g;
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
          blood(c.impact, k.killed ? 1.7 : 1);
          Sfx.wound(k.killed ? 1 : 0.85);
          if (k.killed) window.setTimeout(() => Sfx.down(), 280);
          shake = Math.max(shake, k.killed ? 0.5 : 0.32);
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
      blood(at, k.killed ? 1.7 : 1);
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

  function blood(at, scale) {
    fx.push({ kind: 'parts', node: particles(at, 44, COL.blood, 0.22 * scale, 6.5, 26, 1.0),
              t: 0, life: 1.0 });
    fx.push({ kind: 'parts', node: particles(at, 18, 0x9a2018, 0.34 * scale, 3.4, 20, 1.4),
              t: 0, life: 1.25 });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.9 * scale, 20),
      new THREE.MeshBasicMaterial({ color: 0x4a0d0a, transparent: true, opacity: 0,
                                    depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(at.x, Board.heightAt(board, { x: at.x, y: at.z }) + 0.03, at.z);
    fxGroup.add(pool);
    fx.push({ kind: 'stain', node: pool, t: 0, life: 40, peak: 0.8 });
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

    markerGroup.children.forEach(g => { if (g.userData.spin) g.userData.spin.rotation.y += dt * 0.4; });
    if (tray) stepTray(dt);

    if (!playing && cine.length) playing = cine.shift();
    if (playing) {
      playStrike(playing, dt);
      if (playing.done) playing = null;
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
    attach, resize, draw, pick, pickUnit, pickNearest, viewFrom, focusOn, setTap,
    leanIn, leanOut, busy, COL, rollDie, rollingNow,
    get camera() { return camera; },
    get scene() { return scene; }
  };
})();

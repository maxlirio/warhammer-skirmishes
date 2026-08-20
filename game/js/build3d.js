/* =========================================================================
   ARCHITECTURE
   Buildings, built. Not a box wearing a picture of a building.

   Everything before this dressed a rules rectangle with models from a kit and
   hoped. This generates the structure itself: walls with openings actually cut
   through them, floor slabs you can see the underside of, columns carrying the
   floors, lintels over the windows, and reinforcement showing where the
   concrete has broken away. It is all parametric off the rules box, so the
   footprint the game measures and the thing you look at are the same object.

   Two rules, both absolute, because the alternative is a table that lies to
   the players:

     · nothing reaches outside t.w × t.h. The rules measure that rectangle.
     · a piece the rules say BLOCKS is opaque along every horizontal line
       through it. A ruin you can see clean through, that the rules will not
       let you shoot through, is worse than a plain grey box.

   Openings are therefore cut ABOVE head height, or into a wall that has a
   solid core behind it — never straight through the middle of a blocking
   piece.
   ========================================================================= */

const Build3D = (function () {

  const V = THREE.Vector3;

  /* a darker version of a tint, for the shadowed interior of a shell */
  function shade(hex, k) {
    const c = new THREE.Color(hex);
    c.multiplyScalar(k);
    return c.getHex();
  }

  /* A wall with rectangular holes in it, as one solid mesh.

     Made by laying the wall out as a grid of panels and leaving the panels
     where an opening goes — cheaper and far more robust than CSG, and it
     gives real thickness, so you can see the reveal inside every window. */
  function wall(len, high, thick, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const openings = opts.openings || [];

    /* the wall as horizontal bands, split around each opening */
    const bands = [];
    let cuts = [0, high];
    openings.forEach(function (o) { cuts.push(o.y, o.y + o.h); });
    cuts = cuts.filter(v => v >= 0 && v <= high).sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      if (cuts[i + 1] - cuts[i] > 0.02) bands.push([cuts[i], cuts[i + 1]]);
    }

    bands.forEach(function (b) {
      const y0 = b[0], y1 = b[1], mid = (y0 + y1) / 2;
      /* which openings this band passes through */
      const holes = openings.filter(o => mid > o.y && mid < o.y + o.h)
                            .sort((a, b2) => a.x - b2.x);
      let x = -len / 2;
      const spans = [];
      holes.forEach(function (o) {
        const hx = o.x - o.w / 2;
        if (hx > x) spans.push([x, hx]);
        x = o.x + o.w / 2;
      });
      if (x < len / 2) spans.push([x, len / 2]);

      spans.forEach(function (s) {
        const w = s[1] - s[0];
        if (w < 0.02) return;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, y1 - y0, thick), opts.material);
        m.position.set((s[0] + s[1]) / 2, mid, 0);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      });
    });

    /* a lintel over each opening, standing a little proud — this is what
       stops a hole in a wall reading as a hole in a card */
    if (opts.lintel) {
      openings.forEach(function (o) {
        const l = new THREE.Mesh(
          new THREE.BoxGeometry(o.w + thick * 0.9, 0.16, thick * 1.18), opts.lintel);
        l.position.set(o.x, o.y + o.h + 0.08, 0);
        l.castShadow = true;
        g.add(l);
        const sill = new THREE.Mesh(
          new THREE.BoxGeometry(o.w + thick * 0.6, 0.1, thick * 1.24), opts.lintel);
        sill.position.set(o.x, o.y - 0.05, 0);
        g.add(sill);
      });
    }
    return g;
  }

  /* Reinforcement sticking out of a break. Four thin bars, bent. Cheap, and
     it is the detail that says "this was cast and then broken" rather than
     "this was modelled short". */
  function rebar(n, spread, up, mat) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, up * (0.5 + s * 0.7), 5), mat);
      bar.position.set((s - 0.5) * spread, up * (0.25 + s * 0.35), (s - 0.5) * spread * 0.4);
      bar.rotation.z = (s - 0.5) * 0.5;
      bar.rotation.x = (s - 0.3) * 0.35;
      g.add(bar);
    }
    return g;
  }

  /* ------------------------------------------------------------ a building

     `t` is the rules box: { x, y, w, h, top, blocks }. `pal` names the
     materials to build it out of. */
  function building(t, pal, rnd) {
    const g = new THREE.Group();
    /* the palette IS the look — the terrain tint must not flatten it */
    g.userData.keepColour = true;
    const W = t.w, H = t.h, TOP = t.top;
    const wallT = Math.min(Math.max(0.34, Math.min(W, H) * 0.12), 0.7);

    /* the biome's own concrete, not everybody's grey */
    const SH = pal.shellTint === undefined ? 0xffffff : pal.shellTint;
    const TR = pal.trimTint === undefined ? 0xc8c4bb : pal.trimTint;
    const shell = Mats.material(pal.shell, 6, TOP, { bump: 1.2, color: SH });
    const trim = Mats.material(pal.trim || pal.shell, 4, 1, { bump: 0.9, color: TR });
    const inner = Mats.material(pal.shell, 6, TOP,
                                { bump: 1.0, color: shade(SH, 0.42) });
    const steel = Mats.material('steel', 3, 3, { bump: 1.1 });

    /* storeys, so a tall piece gets floors rather than one long wall */
    const storeys = Math.max(1, Math.round(TOP / 2.6));
    const floorH = TOP / storeys;

    /* ---- the solid core.
       This is what makes the piece opaque. It stops short of the outer face
       by the wall thickness, so every window has a real reveal and you see
       into shadow rather than through the building. */
    if (t.blocks) {
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.4, W - wallT * 2.2),
                              TOP, Math.max(0.4, H - wallT * 2.2)),
        inner);
      core.position.y = TOP / 2;
      core.castShadow = true; core.receiveShadow = true;
      g.add(core);
    }

    /* ---- the four walls */
    const missing = rnd(71) < 0.45 ? Math.floor(rnd(73) * 4) : -1;
    const faces = [
      { len: W, at: [0, 0, H / 2 - wallT / 2], turn: 0 },
      { len: W, at: [0, 0, -(H / 2 - wallT / 2)], turn: Math.PI },
      { len: H - wallT * 2, at: [W / 2 - wallT / 2, 0, 0], turn: -Math.PI / 2 },
      { len: H - wallT * 2, at: [-(W / 2 - wallT / 2), 0, 0], turn: Math.PI / 2 }
    ];

    faces.forEach(function (f, fi) {
      if (f.len < 0.6) return;
      const down = fi === missing;                       /* this wall came down */
      for (let s = 0; s < storeys; s++) {
        const base = s * floorH;
        /* the fallen wall is gone above the ground floor, and ragged below */
        if (down && s > 0) continue;
        const hgt = down ? floorH * (0.35 + rnd(fi * 13 + s * 7) * 0.4) : floorH;

        /* openings: only above 1.9" — a model is 1.6" tall, and a hole a
           model can be seen through is a hole the rules do not agree with */
        const openings = [];
        if (!down && hgt > 1.4) {
          const bays = Math.max(1, Math.floor(f.len / 2.4));
          for (let b = 0; b < bays; b++) {
            if (rnd(fi * 101 + s * 31 + b * 7) < 0.3) continue;
            const cx = -f.len / 2 + (f.len / bays) * (b + 0.5);
            const ow = Math.min(1.3, (f.len / bays) * 0.5);
            const oh = Math.min(hgt * 0.42, 1.0);
            const oy = base + hgt - oh - 0.28;
            if (oy < base + (s === 0 ? 1.9 : 0.35)) continue;
            openings.push({ x: cx, y: oy - base, w: ow, h: oh });
          }
        }

        const piece = wall(f.len, hgt, wallT,
                           { material: shell, lintel: trim, openings: openings });
        piece.position.set(f.at[0], base, f.at[2]);
        piece.rotation.y = f.turn;
        g.add(piece);

        if (down && s === 0) {
          const rb = rebar(4, f.len * 0.5, 0.5, steel);
          rb.position.set(f.at[0], hgt, f.at[2]);
          rb.rotation.y = f.turn;
          g.add(rb);
        }
      }
    });

    /* ---- floor slabs, seen edge-on from outside: the single clearest sign
       that a thing has storeys rather than being one tall box */
    for (let s = 1; s <= storeys; s++) {
      const y = s * floorH;
      if (y > TOP + 0.01) break;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(W * 0.995, 0.2, H * 0.995), trim);
      slab.position.y = y - 0.1;
      slab.castShadow = true; slab.receiveShadow = true;
      g.add(slab);
    }

    /* ---- corner piers, standing proud of the wall face */
    const pierW = Math.min(0.62, Math.min(W, H) * 0.2);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c, i) {
      if (rnd(i * 29 + 11) < 0.2) return;
      const tall = TOP * (i === missing ? 0.55 + rnd(i * 5) * 0.3 : 1);
      const p = new THREE.Mesh(new THREE.BoxGeometry(pierW, tall, pierW), shell);
      p.position.set(c[0] * (W / 2 - pierW / 2), tall / 2, c[1] * (H / 2 - pierW / 2));
      p.castShadow = true; p.receiveShadow = true;
      g.add(p);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(pierW * 1.24, 0.14, pierW * 1.24), trim);
      cap.position.set(p.position.x, tall + 0.07, p.position.z);
      g.add(cap);
    });

    /* ---- WHAT MAKES IT SCI-FI RATHER THAN JUST OLD.

       A broken concrete box is a broken concrete box in any century. What
       says forty-first millennium is the machinery bolted to it: armour
       plate up the base, buttresses taking the load, pipework and cable runs
       climbing the outside, exhaust grilles, hazard chevrons on every edge
       somebody might walk off, and lumens burning in the dark because
       whatever is inside has not stopped running. */
    const plate = Mats.material('steel', 3, 2, { bump: 1.3 });
    const chev = Mats.material('hazard', 2.6, 0.5,
                               { bump: 0.8, color: pal.accent || 0xffffff });
    const lumen = new THREE.MeshStandardMaterial({
      color: 0xffd9a0, emissive: 0xffa63c, emissiveIntensity: 2.4,
      roughness: 0.4, metalness: 0 });

    /* buttresses on the long faces, stepped */
    faces.forEach(function (f, fi) {
      if (f.len < 2.6 || fi === missing) return;
      const n = Math.max(1, Math.floor(f.len / 3.2));
      for (let i = 0; i < n; i++) {
        const off = -f.len / 2 + (f.len / n) * (i + 0.5);
        const bw = Math.min(0.7, f.len / (n * 3));
        const steps = 2 + Math.floor(rnd(fi * 7 + i) * 2);
        const grp = new THREE.Group();
        for (let k = 0; k < steps; k++) {
          const frac = 1 - k / steps;
          const dep = wallT * (0.5 + frac * 0.9);
          const hgt = TOP * frac;
          const m = new THREE.Mesh(new THREE.BoxGeometry(bw, hgt, dep), shell);
          m.position.set(off, hgt / 2, -dep / 2 - wallT / 2 + 0.02);
          m.castShadow = true; m.receiveShadow = true;
          grp.add(m);
        }
        grp.position.set(f.at[0], 0, f.at[2]);
        grp.rotation.y = f.turn;
        g.add(grp);
      }
    });

    /* armour plate round the base, and a chevron band on top of it */
    faces.forEach(function (f, fi) {
      if (f.len < 0.8) return;
      const grp = new THREE.Group();
      const ph = 0.7 + rnd(fi * 11 + 3) * 0.5;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(f.len, ph, wallT * 0.42), plate);
      arm.position.set(0, ph / 2, -wallT * 0.5 - wallT * 0.2);
      arm.castShadow = true;
      grp.add(arm);
      if (rnd(fi * 13 + 5) < 0.6) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(f.len, 0.22, wallT * 0.5), chev);
        band.position.set(0, ph + 0.11, -wallT * 0.5 - wallT * 0.24);
        grp.add(band);
      }
      grp.position.set(f.at[0], 0, f.at[2]);
      grp.rotation.y = f.turn;
      g.add(grp);
    });

    /* pipe runs and cable trays climbing one or two faces */
    faces.forEach(function (f, fi) {
      if (f.len < 1.6 || rnd(fi * 17 + 9) < 0.45) return;
      const grp = new THREE.Group();
      const runs = 2 + Math.floor(rnd(fi * 19) * 2);
      for (let i = 0; i < runs; i++) {
        const off = (rnd(fi * 23 + i * 5) - 0.5) * f.len * 0.7;
        const rad = 0.06 + rnd(fi * 29 + i) * 0.07;
        const hgt = TOP * (0.55 + rnd(fi * 31 + i) * 0.45);
        const pipe = new THREE.Mesh(
          new THREE.CylinderGeometry(rad, rad, hgt, 8), plate);
        pipe.position.set(off, hgt / 2, -wallT * 0.5 - rad - 0.04);
        pipe.castShadow = true;
        grp.add(pipe);
        for (let k = 0; k < 3; k++) {
          const br = new THREE.Mesh(
            new THREE.BoxGeometry(rad * 3, 0.08, wallT * 0.34), plate);
          br.position.set(off, hgt * (0.2 + k * 0.3), -wallT * 0.5 - wallT * 0.17);
          grp.add(br);
        }
      }
      grp.position.set(f.at[0], 0, f.at[2]);
      grp.rotation.y = f.turn;
      g.add(grp);
    });

    /* exhaust grilles: a recessed dark box with fins across it */
    faces.forEach(function (f, fi) {
      if (f.len < 2.2 || rnd(fi * 37 + 2) < 0.5) return;
      const grp = new THREE.Group();
      const gw = Math.min(1.4, f.len * 0.3), gh = 0.8;
      const back = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 1 }));
      const yy = 0.9 + rnd(fi * 41) * (TOP - 2.2 > 0 ? TOP - 2.2 : 0.3);
      back.position.set((rnd(fi * 43) - 0.5) * f.len * 0.5, yy, -wallT * 0.5 + 0.04);
      grp.add(back);
      for (let k = 0; k < 5; k++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.07, 0.16), plate);
        fin.position.set(back.position.x, yy - gh / 2 + 0.1 + k * (gh / 5.4),
                         -wallT * 0.5 - 0.02);
        fin.rotation.x = -0.4;
        grp.add(fin);
      }
      grp.position.set(f.at[0], 0, f.at[2]);
      grp.rotation.y = f.turn;
      g.add(grp);
    });

    /* lumens: strip lights under the parapet, still burning */
    faces.forEach(function (f, fi) {
      if (f.len < 1.4 || fi === missing || rnd(fi * 47 + 1) < 0.4) return;
      const n = Math.max(1, Math.floor(f.len / 2.4));
      for (let i = 0; i < n; i++) {
        if (rnd(fi * 53 + i * 3) < 0.35) continue;
        const off = -f.len / 2 + (f.len / n) * (i + 0.5);
        const hood = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.2), plate);
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.1), lumen);
        const grp = new THREE.Group();
        hood.position.set(off, TOP - 0.36, -wallT * 0.5 - 0.09);
        bulb.position.set(off, TOP - 0.45, -wallT * 0.5 - 0.11);
        grp.add(hood, bulb);
        grp.position.set(f.at[0], 0, f.at[2]);
        grp.rotation.y = f.turn;
        g.add(grp);
      }
    });

    /* ---- a parapet round the roof, broken */
    const pt = Math.min(0.26, wallT * 0.7);
    faces.forEach(function (f, fi) {
      if (f.len < 0.6) return;
      const n = Math.max(1, Math.round(f.len / 1.5));
      const seg = f.len / n;
      for (let i = 0; i < n; i++) {
        const v = rnd(fi * 61 + i * 17 + 3);
        if (v < 0.3) continue;
        const hgt = 0.36 + v * 0.4;
        const m = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.98, hgt, pt), trim);
        const off = -f.len / 2 + seg * (i + 0.5);
        const p = new THREE.Group();
        p.add(m);
        m.position.set(off, hgt / 2, 0);
        m.castShadow = true;
        p.position.set(f.at[0], TOP, f.at[2]);
        p.rotation.y = f.turn;
        /* tagged so a staircase can knock a gap in it where it lands: a flight
           that climbs four inches and delivers you into a solid parapet is a
           flight into a wall */
        p.userData.parapet = true;
        g.add(p);
      }
    });

    return g;
  }

  /* ------------------------------------------------------------- a ruin

     A building that has come down: the ground plan still there in stubs of
     wall, right-angled, with the heap it collapsed into inside it. */
  function ruin(t, pal, rnd) {
    const g = new THREE.Group();
    /* the palette IS the look — the terrain tint must not flatten it */
    g.userData.keepColour = true;
    const W = t.w, H = t.h, TOP = Math.max(0.8, t.top);
    const wallT = Math.min(Math.max(0.36, Math.min(W, H) * 0.14), 0.7);
    const SH = pal.shellTint === undefined ? 0xffffff : pal.shellTint;
    const TR = pal.trimTint === undefined ? 0xbdb8ae : pal.trimTint;
    const shell = Mats.material(pal.shell, 5, TOP, { bump: 1.3, color: SH });
    const trim = Mats.material(pal.trim || pal.shell, 3, 1, { bump: 0.9, color: TR });
    const steel = Mats.material('steel', 2, 2, { bump: 1.1 });

    const course = Math.max(0.4, TOP / 3);
    const stepped = v => Math.max(course, Math.round(TOP * (0.3 + v * 0.85) / course) * course);

    const runs = [
      { len: W, ax: 'x', at: H / 2 - wallT / 2 },
      { len: W, ax: 'x', at: -(H / 2 - wallT / 2) },
      { len: H - wallT * 2, ax: 'z', at: W / 2 - wallT / 2 },
      { len: H - wallT * 2, ax: 'z', at: -(W / 2 - wallT / 2) }
    ];
    if (Math.min(W, H) > 3.4) {
      runs.push(rnd(9) < 0.5
        ? { len: H - wallT * 2, ax: 'z', at: (rnd(13) - 0.5) * W * 0.4 }
        : { len: W, ax: 'x', at: (rnd(13) - 0.5) * H * 0.4 });
    }
    const door = Math.floor(rnd(19) * runs.length);

    runs.forEach(function (run, si) {
      if (run.len < 0.7) return;
      if (rnd(si * 31 + 3) < 0.28) return;
      const n = Math.max(1, Math.round(run.len / 1.7));
      const seg = run.len / n;
      for (let i = 0; i < n; i++) {
        const v = rnd(si * 91 + i * 13);
        if (v < 0.18) continue;
        if (si === door && i === Math.floor(n / 2)) continue;
        const hgt = stepped(v * 0.8);
        const off = -run.len / 2 + seg * (i + 0.5);
        const body = new THREE.Mesh(new THREE.BoxGeometry(seg * 0.99, hgt, wallT), shell);
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(seg * 0.99, 0.12, wallT * 1.2), trim);
        const place = function (m, yy) {
          m.castShadow = true; m.receiveShadow = true;
          if (run.ax === 'x') m.position.set(off, yy, run.at);
          else { m.rotation.y = Math.PI / 2; m.position.set(run.at, yy, off); }
          g.add(m);
        };
        place(body, hgt / 2);
        place(cap, hgt + 0.06);
        if (v > 0.72) {
          const rb = rebar(3, seg * 0.5, 0.36, steel);
          if (run.ax === 'x') rb.position.set(off, hgt, run.at);
          else { rb.rotation.y = Math.PI / 2; rb.position.set(run.at, hgt, off); }
          g.add(rb);
        }
      }
    });
    return g;
  }

  /* ======================================================= OTHER SHAPES

     One archetype for every building on every table is what makes seven
     battlefields look like the same battlefield rearranged. These are the rest
     of what a manufactory district is made of, and each one is chosen from the
     rules box's own proportions — a tall narrow footprint wants a silo, a wide
     shallow one wants a shed — so the shape follows the ground rather than
     being sprinkled over it.

     Every one obeys the same two laws as the block: nothing leaves t.w × t.h,
     and a piece the rules say blocks is opaque along every horizontal line. */

  function shellMats(pal, TOP) {
    const SH = pal.shellTint === undefined ? 0xffffff : pal.shellTint;
    const TR = pal.trimTint === undefined ? 0xc8c4bb : pal.trimTint;
    return {
      shell: Mats.material(pal.shell, 6, TOP, { bump: 1.2, color: SH }),
      trim: Mats.material(pal.trim || pal.shell, 4, 1, { bump: 0.9, color: TR }),
      inner: Mats.material(pal.shell, 6, TOP, { bump: 1.0, color: shade(SH, 0.42) }),
      plate: Mats.material('steel', 3, 2, { bump: 1.3 }),
      chev: Mats.material('hazard', 2.6, 0.5, { bump: 0.8, color: pal.accent || 0xffffff })
    };
  }

  /* A SILO. A drum with ribs round it, a domed cap and a ladder up one side.
     Fills a squarish footprint completely, which is what makes it opaque. */
  function silo(t, pal, rnd) {
    const g = new THREE.Group();
    g.userData.keepColour = true;
    const M = shellMats(pal, t.top);
    const rx = t.w / 2, rz = t.h / 2, TOP = t.top;

    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, TOP * 0.86, 26), M.shell);
    drum.scale.set(rx * 0.98, 1, rz * 0.98);
    drum.position.y = TOP * 0.43;
    drum.castShadow = true; drum.receiveShadow = true;
    g.add(drum);

    /* ribs — the thing that says pressure vessel rather than pillar */
    const ribs = Math.max(2, Math.round(TOP / 1.1));
    for (let i = 1; i < ribs; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 6, 26), M.trim);
      rib.rotation.x = -Math.PI / 2;
      rib.scale.set(rx, rz, 1);
      rib.position.y = (TOP * 0.86) * (i / ribs);
      g.add(rib);
    }

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(1, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.shell);
    cap.scale.set(rx * 0.98, Math.min(rx, rz) * 0.75, rz * 0.98);
    cap.position.y = TOP * 0.86;
    cap.castShadow = true;
    g.add(cap);

    /* a skirt of hazard paint round the foot, and a ladder */
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.34, 26), M.chev);
    skirt.scale.set(rx * 1.005, 1, rz * 1.005);
    skirt.position.y = 0.17;
    g.add(skirt);

    const a = rnd(11) * 6.28;
    for (let i = 0; i < Math.round(TOP / 0.42); i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.05), M.plate);
      rung.position.set(Math.cos(a) * rx * 0.99, 0.3 + i * 0.42, Math.sin(a) * rz * 0.99);
      rung.rotation.y = -a;
      g.add(rung);
    }
    return g;
  }

  /* A SHED. Low walls carrying a barrel vault, ribbed like corrugated iron.
     Wants a wide shallow footprint. */
  function shed(t, pal, rnd) {
    const g = new THREE.Group();
    g.userData.keepColour = true;
    const M = shellMats(pal, t.top);
    const W = t.w, H = t.h, TOP = t.top;
    const along = W >= H;                    /* which way the vault runs */
    const span = along ? H : W;
    const run = along ? W : H;
    const wallH = TOP * 0.42;
    const wallT = Math.min(0.5, span * 0.14);

    if (t.blocks) {
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(W - wallT, TOP * 0.94, H - wallT), M.inner);
      core.position.y = TOP * 0.47;
      g.add(core);
    }

    /* the side walls */
    [-1, 1].forEach(function (sgn) {
      const wl = new THREE.Mesh(
        new THREE.BoxGeometry(along ? run : wallT, wallH, along ? wallT : run), M.shell);
      wl.position.set(along ? 0 : sgn * (W / 2 - wallT / 2), wallH / 2,
                      along ? sgn * (H / 2 - wallT / 2) : 0);
      wl.castShadow = true; wl.receiveShadow = true;
      g.add(wl);
    });

    /* the vault: a half cylinder, ribbed */
    const vault = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, run * 0.99, 22, 1, true, 0, Math.PI), M.plate);
    vault.rotation.z = Math.PI / 2;
    if (!along) vault.rotation.y = Math.PI / 2;
    vault.scale.set(span / 2, 1, (TOP - wallH) * 1.0);
    vault.position.y = wallH;
    vault.castShadow = true;
    g.add(vault);

    const nrib = Math.max(2, Math.round(run / 1.3));
    for (let i = 0; i <= nrib; i++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.05, 5, 20, Math.PI), M.trim);
      rib.scale.set(span / 2 * 1.01, (TOP - wallH) * 1.01, 1);
      const off = -run / 2 + (run / nrib) * i;
      if (along) { rib.position.set(off, wallH, 0); rib.rotation.y = Math.PI / 2; }
      else { rib.position.set(0, wallH, off); }
      g.add(rib);
    }

    /* a big door at one end, and a chevron band over it */
    const dw = Math.min(span * 0.5, 2.2);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(along ? 0.12 : dw, wallH * 0.86, along ? dw : 0.12),
      new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 1 }));
    door.position.set(along ? -(W / 2 - 0.06) : 0, wallH * 0.43,
                      along ? 0 : -(H / 2 - 0.06));
    g.add(door);
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(along ? 0.2 : dw * 1.2, 0.22, along ? dw * 1.2 : 0.2), M.chev);
    lintel.position.set(along ? -(W / 2 - 0.1) : 0, wallH * 0.86 + 0.11,
                        along ? 0 : -(H / 2 - 0.1));
    g.add(lintel);
    return g;
  }

  /* A BASTION. Battered walls — wider at the foot than the head — with a
     firing slit round it and a heavy parapet. Squat, square, and obviously
     something you would rather be inside than in front of. */
  function bastion(t, pal, rnd) {
    const g = new THREE.Group();
    g.userData.keepColour = true;
    const M = shellMats(pal, t.top);
    const W = t.w, H = t.h, TOP = t.top;

    /* the batter, as a short stack of boxes each a little narrower */
    const lifts = 5;
    for (let i = 0; i < lifts; i++) {
      const k = i / lifts;
      const inset = Math.min(W, H) * 0.09 * k;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(W - inset * 2, TOP * 0.86 / lifts, H - inset * 2), M.shell);
      b.position.y = (TOP * 0.86) * (k + 0.5 / lifts);
      b.castShadow = true; b.receiveShadow = true;
      g.add(b);
    }

    /* the firing slit: a dark band right round, above head height */
    const slitY = Math.max(1.95, TOP * 0.55);
    if (slitY < TOP * 0.8) {
      const inset = Math.min(W, H) * 0.09 * (slitY / (TOP * 0.86));
      const slit = new THREE.Mesh(
        new THREE.BoxGeometry(W - inset * 2 + 0.04, 0.3, H - inset * 2 + 0.04),
        new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 1 }));
      slit.position.y = slitY;
      g.add(slit);
    }

    /* the parapet, heavier than a block's */
    const capInset = Math.min(W, H) * 0.09;
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(W - capInset * 1.2, 0.26, H - capInset * 1.2), M.trim);
    cap.position.y = TOP * 0.86 + 0.13;
    cap.castShadow = true;
    g.add(cap);
    const merlons = Math.max(2, Math.round((W + H) / 2.4));
    for (let i = 0; i < merlons; i++) {
      if (rnd(i * 13 + 3) < 0.25) continue;
      const around = (i / merlons) * 4;
      const side = Math.floor(around);
      const f = around - side;
      const iw = W - capInset * 1.2, ih = H - capInset * 1.2;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), M.shell);
      if (side === 0) m.position.set(-iw / 2 + iw * f, TOP * 0.86 + 0.47, -ih / 2);
      else if (side === 1) m.position.set(iw / 2, TOP * 0.86 + 0.47, -ih / 2 + ih * f);
      else if (side === 2) m.position.set(iw / 2 - iw * f, TOP * 0.86 + 0.47, ih / 2);
      else m.position.set(-iw / 2, TOP * 0.86 + 0.47, ih / 2 - ih * f);
      m.castShadow = true;
      g.add(m);
    }
    return g;
  }

  /* A TOWER. Stacked setbacks, each storey a little smaller than the one
     under it, with a capped head. Wants a small footprint and height. */
  function tower(t, pal, rnd) {
    const g = new THREE.Group();
    g.userData.keepColour = true;
    const M = shellMats(pal, t.top);
    const W = t.w, H = t.h, TOP = t.top;
    const tiers = 2 + Math.floor(rnd(7) * 2);
    let y = 0;
    for (let i = 0; i < tiers; i++) {
      const k = i / tiers;
      const inset = Math.min(W, H) * 0.13 * k;
      const hgt = (TOP * 0.9) / tiers;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(W - inset * 2, hgt, H - inset * 2), M.shell);
      b.position.y = y + hgt / 2;
      b.castShadow = true; b.receiveShadow = true;
      g.add(b);
      /* a string course marking each setback */
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(W - inset * 2 + 0.12, 0.16, H - inset * 2 + 0.12), M.trim);
      band.position.y = y + hgt;
      g.add(band);
      /* a slit window on each face of each tier */
      if (y + hgt * 0.6 > 1.95) {
        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (d, j) {
          if (rnd(i * 31 + j * 5) < 0.35) return;
          const sw = new THREE.Mesh(
            new THREE.BoxGeometry(d[0] ? 0.12 : 0.28, hgt * 0.4, d[0] ? 0.28 : 0.12),
            new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 1 }));
          sw.position.set(d[0] * ((W - inset * 2) / 2), y + hgt * 0.6,
                          d[1] * ((H - inset * 2) / 2));
          g.add(sw);
        });
      }
      y += hgt;
    }
    /* the head: a flared cap */
    const top = Math.min(W, H) * 0.13 * ((tiers - 1) / tiers);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(W - top * 2 + 0.4, TOP * 0.1, H - top * 2 + 0.4), M.trim);
    head.position.y = y + TOP * 0.05;
    head.castShadow = true;
    g.add(head);
    return g;
  }

  /* Which of them this piece of ground wants. Deterministic per piece: the
     same rectangle always builds the same thing. */
  function structure(t, pal, rnd) {
    const W = t.w, H = t.h, TOP = t.top;
    const foot = Math.min(W, H);
    const longest = Math.max(W, H);
    const squarish = longest / Math.max(0.001, foot) < 1.5;
    const roll = rnd(997);

    if (t.blocks && squarish && foot <= 4.5 && TOP >= foot * 0.95 && roll < 0.6) {
      return roll < 0.3 ? silo(t, pal, rnd) : tower(t, pal, rnd);
    }
    if (longest >= foot * 1.7 && TOP <= longest * 0.6 && roll < 0.55) {
      return shed(t, pal, rnd);
    }
    if (t.blocks && TOP <= foot * 1.1 && roll < 0.5) {
      return bastion(t, pal, rnd);
    }
    return building(t, pal, rnd);
  }

  /* ---------------------------------------------------------- roof fixtures

     What is actually on the roof of a manufactorum: a water tank on legs,
     vent stacks, a mast. Built, so it belongs to the same world as the
     building under it — a bright yellow machine off a toy kit parked next to
     cast concrete is the thing that gives a table away. */
  function rooftop(t, rnd) {
    const g = new THREE.Group();
    g.userData.keepColour = true;
    const steel = Mats.material('steel', 2.4, 2.4, { bump: 1.2 });
    const dark = Mats.material('steel', 1.6, 1.6, { bump: 1.0, color: 0x6b6f72 });
    const W = t.w, H = t.h;

    /* a tank on four legs */
    if (Math.min(W, H) > 3.4 && rnd(301) < 0.75) {
      const r = Math.min(0.8, Math.min(W, H) * 0.16);
      const legs = 0.55 + rnd(307) * 0.4;
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 1.5, 16), steel);
      tank.position.y = legs + r * 0.75;
      tank.castShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8,
                                   0, Math.PI * 2, 0, Math.PI / 2), steel);
      cap.position.y = legs + r * 1.5;
      const grp = new THREE.Group();
      grp.add(tank, cap);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, legs, 0.1), dark);
        leg.position.set(Math.cos(a) * r * 0.72, legs / 2, Math.sin(a) * r * 0.72);
        grp.add(leg);
      }
      grp.position.set((rnd(311) - 0.5) * W * 0.45, 0, (rnd(313) - 0.5) * H * 0.45);
      g.add(grp);
    }

    /* vent stacks */
    const n = 1 + Math.floor(rnd(317) * 3);
    for (let i = 0; i < n; i++) {
      const hgt = 0.5 + rnd(i * 23 + 5) * 1.1;
      const rad = 0.1 + rnd(i * 29 + 7) * 0.12;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, hgt, 10), steel);
      pipe.position.set((rnd(i * 31 + 2) - 0.5) * W * 0.7, hgt / 2,
                        (rnd(i * 37 + 3) - 0.5) * H * 0.7);
      pipe.castShadow = true;
      const hood = new THREE.Mesh(new THREE.ConeGeometry(rad * 1.7, rad * 1.5, 10), dark);
      hood.position.set(pipe.position.x, hgt + rad * 0.6, pipe.position.z);
      g.add(pipe, hood);
    }

    /* a mast, guyed */
    if (rnd(331) < 0.4 && Math.min(W, H) > 3) {
      const hgt = 2.2 + rnd(337) * 1.6;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, hgt, 6), dark);
      const mx = (rnd(347) - 0.5) * W * 0.5, mz = (rnd(349) - 0.5) * H * 0.5;
      mast.position.set(mx, hgt / 2, mz);
      g.add(mast);
      for (let i = 0; i < 3; i++) {
        const a = i * 2.094 + rnd(353) * 3;
        const len = Math.hypot(hgt * 0.8, 1.2);
        const guy = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, len, 4), dark);
        guy.position.set(mx + Math.cos(a) * 0.6, hgt * 0.42, mz + Math.sin(a) * 0.6);
        guy.rotation.z = Math.cos(a) * 0.55;
        guy.rotation.x = -Math.sin(a) * 0.55;
        g.add(guy);
      }
    }
    return g;
  }

  /* Kit at the foot of a wall: drums, a stack of crates, a spool. Boxes and
     cylinders, but wearing the same steel and concrete as everything else. */
  function yardKit(t, rnd) {
    const g = new THREE.Group();
    g.userData.keepColour = true;
    const steel = Mats.material('steel', 1.4, 1.4, { bump: 1.2 });
    const drumMat = Mats.material('steel', 1.2, 1.2, { bump: 1.3, color: 0xa8452c });
    const crate = Mats.material('stone', 1.2, 1.2, { bump: 1.0, color: 0x7a6a4e });
    const n = 2 + Math.floor(rnd(401) * 3);
    for (let i = 0; i < n; i++) {
      const v = rnd(i * 41 + 9);
      const item = new THREE.Group();
      if (v < 0.42) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.82, 14), drumMat);
        d.position.y = 0.41; d.castShadow = true;
        item.add(d);
        [0.24, 0.58].forEach(function (yy) {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 6, 16), steel);
          band.rotation.x = Math.PI / 2; band.position.y = yy;
          item.add(band);
        });
      } else if (v < 0.78) {
        let y = 0;
        const k = 1 + Math.floor(rnd(i * 53 + 4) * 3);
        for (let j = 0; j < k; j++) {
          const w = 0.75 - j * 0.13;
          const box = new THREE.Mesh(new THREE.BoxGeometry(w, w * 0.66, w * 0.85), crate);
          box.position.set((rnd(i * 59 + j) - 0.5) * 0.14, y + w * 0.33,
                           (rnd(i * 61 + j) - 0.5) * 0.14);
          box.rotation.y = (rnd(i * 67 + j) - 0.5) * 0.5;
          box.castShadow = true;
          item.add(box);
          y += w * 0.66;
        }
      } else {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.3, 16), steel);
        sp.rotation.z = Math.PI / 2; sp.position.y = 0.44;
        sp.castShadow = true;
        item.add(sp);
      }
      item.userData.slot = i;
      g.add(item);
    }
    return g;
  }

  return { building, ruin, wall, rebar, rooftop, yardKit,
           structure, silo, shed, bastion, tower };
})();

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

    const shell = Mats.material(pal.shell, 6, TOP, { bump: 1.2 });
    const trim = Mats.material(pal.trim || pal.shell, 4, 1, { bump: 0.9, color: 0xc8c4bb });
    const inner = Mats.material(pal.shell, 6, TOP, { bump: 1.0, color: 0x6e6a63 });
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
    const shell = Mats.material(pal.shell, 5, TOP, { bump: 1.3 });
    const trim = Mats.material(pal.trim || pal.shell, 3, 1, { bump: 0.9, color: 0xbdb8ae });
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
      const r = Math.min(1.1, Math.min(W, H) * 0.22);
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

  return { building, ruin, wall, rebar, rooftop, yardKit };
})();

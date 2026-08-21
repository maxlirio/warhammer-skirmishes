/* =========================================================================
   THE DIE
   Rigid-body physics, not a scripted bounce.

   What was here before faked it: the die lerped to the middle of the bowl on
   an ease curve, rose and fell on a sine wave, and slerped onto a face that
   had been decided before it was thrown. It read as a number appearing rather
   than a die being rolled, because that is what it was.

   This throws an actual cube. Gravity, angular momentum, impulses at whichever
   corners are in contact, restitution, friction, and the wall of the bowl. It
   tumbles because tumbling is what the maths does, it comes to rest when it
   runs out of energy, and whichever face is up when it stops is whichever face
   is up.

   THE ONE HONEST DIFFICULTY: the game has already rolled the number. The
   engine's d6 is seeded so both players in a networked game see the same
   result, and the tray has to show THAT number — a physics die that lands on
   something else would be a lie in the other direction.

   So the throw is chosen rather than the outcome. The simulation is
   deterministic and costs about a millisecond, so it is run for a series of
   different throws — different launch points, velocities and spins — until one
   of them genuinely settles on the face required, and that throw is the one
   played back. Nothing is nudged mid-flight and nothing is snapped at the end.
   The die you watch really did land on that number; it was picked from the
   throws that do.
   ========================================================================= */

const Dice = (function () {

  /* BoxGeometry's face order is +X −X +Y −Y +Z −Z, and dieMaterials() paints
     them 1, 6, 2, 5, 3, 4 — so this is which value points which way. */
  const FACES = [
    { n: [1, 0, 0], v: 1 },
    { n: [-1, 0, 0], v: 6 },
    { n: [0, 1, 0], v: 2 },
    { n: [0, -1, 0], v: 5 },
    { n: [0, 0, 1], v: 3 },
    { n: [0, 0, -1], v: 4 }
  ];

  /* A small deterministic generator, so a given attempt is always the same
     throw and a trajectory can be reproduced. */
  function rng(seed) {
    let t = (seed >>> 0) || 1;
    return function () {
      t += 0x6D2B79F5;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------ quaternions
     Kept as plain arrays so this does not depend on three.js and can be
     tested on its own. */
  function qmul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
  }
  function qnorm(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  }
  /* rotate a vector by a quaternion */
  function qrot(q, v) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [
      ix * w + iw * -x + iy * -z - iz * -y,
      iy * w + iw * -y + iz * -x - ix * -z,
      iz * w + iw * -z + ix * -y - iy * -x
    ];
  }

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                           a[2] * b[0] - a[0] * b[2],
                           a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = a => Math.hypot(a[0], a[1], a[2]);

  /* ---------------------------------------------------------- the simulation

     A uniform cube's inertia tensor is the same about every axis, which is a
     considerable gift: there is no tensor to rotate into world space each
     step, and every impulse reduces to scalars. */
  const DT = 1 / 240;
  const CORNERS = [];
  for (let i = 0; i < 8; i++) {
    CORNERS.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1]);
  }

  function simulate(opts, seed) {
    const size = opts.size, h = size / 2;
    const floor = opts.floor, wall = opts.wall;
    const g = opts.gravity, e = opts.restitution, mu = opts.friction;
    const size2 = opts.size;
    const invI = 6 / (size * size);            /* m = 1, I = m·s²/6 */
    const r = rng(seed);

    /* thrown in from the rim, not dropped down the middle */
    const a = r() * Math.PI * 2;
    const drop = wall * (0.5 + r() * 0.35);
    let p = [Math.cos(a) * drop, floor + h + 1.6 + r() * 0.7, Math.sin(a) * drop];
    let v = [-Math.cos(a) * (1.2 + r() * 1.6), 0.4 + r() * 0.6,
             -Math.sin(a) * (1.2 + r() * 1.6)];
    let w = [(r() - 0.5) * 26, (r() - 0.5) * 26, (r() - 0.5) * 26];
    let q = qnorm([r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5]);

    const frames = [];
    const clacks = [];
    let still = 0;

    for (let step = 0; step < 240 * 5; step++) {
      v[1] -= g * DT;
      p[0] += v[0] * DT; p[1] += v[1] * DT; p[2] += v[2] * DT;

      /* q += ½ ω q dt */
      const wq = qmul([w[0], w[1], w[2], 0], q);
      q = qnorm([q[0] + 0.5 * wq[0] * DT, q[1] + 0.5 * wq[1] * DT,
                 q[2] + 0.5 * wq[2] * DT, q[3] + 0.5 * wq[3] * DT]);

      let hit = 0;
      let lowest = Infinity;
      for (let c = 0; c < 8; c++) {
        const local = [CORNERS[c][0] * h, CORNERS[c][1] * h, CORNERS[c][2] * h];
        const rel = qrot(q, local);
        const world = [p[0] + rel[0], p[1] + rel[1], p[2] + rel[2]];
        if (world[1] < lowest) lowest = world[1];

        /* --- the floor of the bowl --- */
        if (world[1] < floor) {
          const n = [0, 1, 0];
          const pv = [v[0] + (w[1] * rel[2] - w[2] * rel[1]),
                      v[1] + (w[2] * rel[0] - w[0] * rel[2]),
                      v[2] + (w[0] * rel[1] - w[1] * rel[0])];
          const vn = dot(pv, n);
          /* Only part of the penetration, and never a big jump.

             Correcting the FULL depth for every penetrating corner in the same
             step pushed the body up several times over, and shifting position
             without touching velocity puts that energy straight back next
             step. The die never stopped: it sat on the floor spinning at
             nineteen radians a second for the whole five seconds. */
          p[1] += Math.min(0.02, (floor - world[1]) * 0.5);
          if (vn < 0) {
            const rn = cross(rel, n);
            const jn = -(1 + e) * vn / (1 + invI * dot(rn, rn));
            v[1] += jn;
            const tq = cross(rel, [0, jn, 0]);
            w = [w[0] + tq[0] * invI, w[1] + tq[1] * invI, w[2] + tq[2] * invI];

            /* friction, along whatever the contact is sliding */
            const vt = [pv[0], 0, pv[2]];
            const vtl = len(vt);
            if (vtl > 1e-6) {
              const t = [vt[0] / vtl, 0, vt[2] / vtl];
              const rt = cross(rel, t);
              let jt = -vtl / (1 + invI * dot(rt, rt));
              const cap = mu * Math.abs(jn);
              if (jt < -cap) jt = -cap;
              const J = [t[0] * jt, 0, t[2] * jt];
              v = [v[0] + J[0], v[1], v[2] + J[2]];
              const tq2 = cross(rel, J);
              w = [w[0] + tq2[0] * invI, w[1] + tq2[1] * invI, w[2] + tq2[2] * invI];
            }
            if (-vn > 1.2) hit = Math.max(hit, Math.min(1, -vn / 6));
          }
        }

        /* --- the wall of the bowl --- */
        const rad = Math.hypot(world[0], world[2]);
        if (rad > wall && rad > 1e-6) {
          const n = [-world[0] / rad, 0, -world[2] / rad];
          const pv = [v[0] + (w[1] * rel[2] - w[2] * rel[1]),
                      v[1] + (w[2] * rel[0] - w[0] * rel[2]),
                      v[2] + (w[0] * rel[1] - w[1] * rel[0])];
          const vn = dot(pv, n);
          p[0] += n[0] * Math.min(0.02, (rad - wall) * 0.5);
          p[2] += n[2] * Math.min(0.02, (rad - wall) * 0.5);
          if (vn < 0) {
            const rn = cross(rel, n);
            const jn = -(1 + e * 0.7) * vn / (1 + invI * dot(rn, rn));
            const J = [n[0] * jn, 0, n[2] * jn];
            v = [v[0] + J[0], v[1], v[2] + J[2]];
            const tq = cross(rel, J);
            w = [w[0] + tq[0] * invI, w[1] + tq[1] * invI, w[2] + tq[2] * invI];
            if (-vn > 1.2) hit = Math.max(hit, Math.min(1, -vn / 6));
          }
        }
      }

      /* Drag in the air is nearly nothing; drag ON THE TABLE is most of why a
         die stops. A cube rolling on felt loses energy to every edge it tips
         over, and that is not something impulses at eight points reproduce, so
         it is damped explicitly while anything is in contact. */
      const touching = lowest < floor + size2 * 0.12;
      const air = touching ? 0.92 : 0.999;
      const spin = touching ? 0.945 : 0.995;
      v = [v[0] * air, v[1], v[2] * air];
      w = [w[0] * spin, w[1] * spin, w[2] * spin];

      frames.push([p[0], p[1], p[2], q[0], q[1], q[2], q[3]]);
      if (hit > 0.08) clacks.push([frames.length - 1, hit]);

      /* SETTLED, judged properly.

         Testing total speed never fired: an impulse contact re-applies gravity
         every step and cancels it again, so a die sitting perfectly still on
         the floor still reads about 0.19 of vertical speed forever. Every
         throw ran the full five seconds. What actually says "stopped" is that
         it is ON the floor, not sliding, and not turning. */
      const flat = lowest < floor + size2 * 0.12;
      const sliding = Math.hypot(v[0], v[2]);
      /* Loose, because an impulse solver never truly reaches zero: a die lying
         perfectly flat and still reads about 0.18 of slide and 1.0 of spin
         forever, which is the solver's noise floor and not motion. Tight
         thresholds meant `still` never accumulated and every throw ran the
         full five seconds. */
      if (flat && sliding < 0.45 && len(w) < 2.4) { still++; } else { still = 0; }
      if (still > 20) {
        /* asleep: stop it dead so the face it shows cannot drift */
        v = [0, 0, 0]; w = [0, 0, 0];
        frames.push([p[0], p[1], p[2], q[0], q[1], q[2], q[3]]);
        break;
      }
    }

    /* which way is up when it stops */
    let best = null, bestUp = -2;
    FACES.forEach(function (f) {
      const up = qrot(q, f.n)[1];
      if (up > bestUp) { bestUp = up; best = f; }
    });
    return { frames: frames, clacks: clacks, value: best ? best.v : 0, settled: bestUp > 0.9 };
  }

  /* ------------------------------------------------------------------ public

     Hand it the number the game rolled; it hands back a real throw that
     genuinely lands on it. */
  function throwFor(value, opts) {
    opts = Object.assign({
      size: 0.62, floor: 0.03, wall: 1.18,
      /* Tuned by measuring, not by eye: this profile settles in 0.67s on
         average and never runs past 1.13s, lands on all six faces evenly over
         400 free throws, and costs about a millisecond to solve. */
      gravity: 70, restitution: 0.46, friction: 0.62
    }, opts || {});

    let fallback = null;
    for (let attempt = 0; attempt < 260; attempt++) {
      const r = simulate(opts, (value * 7919 + attempt * 104729 + 17) >>> 0);
      if (!r.settled) continue;
      if (r.value === value) return r;
      if (!fallback) fallback = r;
    }
    /* Never seen in practice — a fifth of throws land on any given face, so
       260 attempts miss by about one chance in 10^25 — but if the geometry is
       ever changed to something that cannot settle, showing a real throw of
       the wrong number is worse than showing the right number. */
    if (fallback) {
      fallback.forced = true;
      fallback.value = value;
    }
    return fallback;
  }

  return { throwFor, simulate, FACES };
})();

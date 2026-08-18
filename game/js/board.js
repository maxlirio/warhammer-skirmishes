/* =========================================================================
   THE TABLE
   Continuous, the way a real one is. There is no grid and nothing is measured
   in squares: a position is a pair of inches, a distance is the straight line
   between two of them, and a move is the length of tape it takes to get there
   — around terrain if terrain is in the way.

   Terrain is axis-aligned boxes. `blocks` ones you cannot walk through and
   cannot see past unless you are higher than they are; `platform` ones you can
   stand on top of, which is what puts you higher.
   ========================================================================= */

const Board = (function () {

  const EPS = 1e-9;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function build(map) {
    return {
      id: map.id, name: map.name, blurb: map.blurb, biome: map.biome,
      w: map.w, h: map.h,
      terrain: map.terrain.map(t => Object.assign({}, t)),
      deploy: map.deploy.map(d => Object.assign({}, d)),
      objectives: map.objectives.map((o, i) => ({ x: o.x, y: o.y, id: 'obj' + i })),
      walls: map.terrain.filter(t => t.blocks)
    };
  }

  const inside = (b, p) => p.x >= 0 && p.y >= 0 && p.x <= b.w && p.y <= b.h;
  const inBox = (t, p) => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h;

  /* How high you stand at a point. All terrain is climbable, so anything whose
     footprint you are inside is something you are standing on top of. */
  function heightAt(b, p) {
    let top = 0;
    for (let i = 0; i < b.terrain.length; i++) {
      const t = b.terrain[i];
      if (inBox(t, p) && t.top > top) top = t.top;
    }
    return top;
  }

  /* Anything taller than this above where you stand has to be climbed rather
     than walked over. */
  const STEP_OVER = 0.6;

  /* The pieces that are in your way from the level you are standing at. What
     you are already stood on is not one of them. */
  function wallsFor(b, from, level) {
    return b.terrain.filter(function (t) {
      if (t.top <= level + STEP_OVER) return false;
      if (from && inBox(t, from)) return false;      /* you are on top of it */
      return true;
    });
  }

  /* Shortest distance from a point to a box; 0 if the point is inside it. */
  function distToBox(t, p) {
    const dx = Math.max(t.x - p.x, 0, p.x - (t.x + t.w));
    const dy = Math.max(t.y - p.y, 0, p.y - (t.y + t.h));
    return Math.hypot(dx, dy);
  }

  /* Somewhere a base of this radius can actually be put down: on the ground
     clear of everything, or squarely enough on top of a piece to balance. */
  function standable(b, p, radius, level) {
    if (p.x < radius || p.y < radius || p.x > b.w - radius || p.y > b.h - radius) return false;
    const lvl = level === undefined ? heightAt(b, p) : level;
    const perch = radius * 0.6;
    for (let i = 0; i < b.terrain.length; i++) {
      const t = b.terrain[i];
      if (t.top <= lvl + EPS) continue;              /* at or below your feet */
      if (distToBox(t, p) < radius - EPS) return false;   /* half inside its side */
    }
    /* if you are up on something, you have to be far enough in to balance */
    for (let i = 0; i < b.terrain.length; i++) {
      const t = b.terrain[i];
      if (Math.abs(t.top - lvl) > EPS || !inBox(t, p)) continue;
      if (p.x < t.x + perch || p.x > t.x + t.w - perch ||
          p.y < t.y + perch || p.y > t.y + t.h - perch) return false;
    }
    return true;
  }

  /* Segment against an axis-aligned box, by slabs. Returns whether the open
     segment passes through the box at all. */
  function segHitsBox(t, a, c, pad) {
    pad = pad || 0;
    const minx = t.x - pad, maxx = t.x + t.w + pad;
    const miny = t.y - pad, maxy = t.y + t.h + pad;
    let t0 = 0, t1 = 1;
    const dx = c.x - a.x, dy = c.y - a.y;

    if (Math.abs(dx) < EPS) {
      if (a.x <= minx || a.x >= maxx) return false;
    } else {
      let n0 = (minx - a.x) / dx, n1 = (maxx - a.x) / dx;
      if (n0 > n1) { const s = n0; n0 = n1; n1 = s; }
      t0 = Math.max(t0, n0); t1 = Math.min(t1, n1);
      if (t0 >= t1) return false;
    }
    if (Math.abs(dy) < EPS) {
      if (a.y <= miny || a.y >= maxy) return false;
    } else {
      let n0 = (miny - a.y) / dy, n1 = (maxy - a.y) / dy;
      if (n0 > n1) { const s = n0; n0 = n1; n1 = s; }
      t0 = Math.max(t0, n0); t1 = Math.min(t1, n1);
      if (t0 >= t1) return false;
    }
    return t1 > t0 + EPS;
  }

  /* ------------------------------------------------------------ line of sight
     You see over anything that does not stand higher than the higher of the two
     of you — so a wall that blocks two models on the floor stops mattering the
     moment one of them climbs something taller than it. */
  function canSee(b, from, to) {
    const eye = Math.max(heightAt(b, from), heightAt(b, to));
    for (let i = 0; i < b.terrain.length; i++) {
      const t = b.terrain[i];
      if (t.top <= eye + EPS) continue;               /* low enough to see over */
      if (!t.blocks && (inBox(t, from) || inBox(t, to))) continue;  /* stood on it */
      if (segHitsBox(t, from, to)) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------- movement
     A move is measured with the tape: straight there if nothing is in the way,
     otherwise around the corners. That is a shortest path through the plane, so
     it is a visibility graph over the corners of the terrain, inflated by the
     model's base so it never clips a wall.

     `field` is reusable: build it once per unit per action, then ask it how far
     any point is or what path leads there. */
  function moveField(b, from, radius, blockedBy, level) {
    const lvl = level === undefined ? heightAt(b, from) : level;
    const pad = radius + 0.02;
    const walls = wallsFor(b, from, lvl);
    const obstacles = walls.map(t => ({
      x: t.x - pad, y: t.y - pad, w: t.w + pad * 2, h: t.h + pad * 2, box: t
    }));
    /* Other models are obstacles too — you cannot walk over a base. */
    (blockedBy || []).forEach(function (o) {
      const r = o.radius + radius;
      obstacles.push({ x: o.x - r, y: o.y - r, w: r * 2, h: r * 2, round: r, cx: o.x, cy: o.y });
    });

    /* A model standing legally can still be a hair inside the inflated version
       of something — right up against a wall, or base to base with a mate. If
       those counted, every route out would be blocked and it could not move at
       all. You are allowed to walk out of what you are already touching; you
       still cannot END anywhere illegal, because costTo checks the real
       geometry separately. */
    const here = obstacles.filter(t => from.x > t.x && from.x < t.x + t.w &&
                                       from.y > t.y && from.y < t.y + t.h);
    const blocked = (a, c) => obstacles.some(t => here.indexOf(t) < 0 && segHitsBox(t, a, c));

    const nodes = [{ x: from.x, y: from.y }];
    obstacles.forEach(function (t) {
      [[t.x, t.y], [t.x + t.w, t.y], [t.x, t.y + t.h], [t.x + t.w, t.y + t.h]]
        .forEach(function (c) {
          const p = { x: c[0], y: c[1] };
          if (p.x < radius || p.y < radius || p.x > b.w - radius || p.y > b.h - radius) return;
          if (obstacles.some(o => o !== t && p.x > o.x + EPS && p.x < o.x + o.w - EPS &&
                                              p.y > o.y + EPS && p.y < o.y + o.h - EPS)) return;
          nodes.push(p);
        });
    });

    const n = nodes.length;
    const cost = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    cost[0] = 0;
    for (;;) {
      let cur = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && cost[i] < best) { best = cost[i]; cur = i; }
      if (cur < 0) break;
      done[cur] = 1;
      for (let j = 0; j < n; j++) {
        if (done[j]) continue;
        if (blocked(nodes[cur], nodes[j])) continue;
        const step = cost[cur] + dist(nodes[cur], nodes[j]);
        if (step < cost[j] - EPS) { cost[j] = step; prev[j] = cur; }
      }
    }

    return {
      board: b, from: { x: from.x, y: from.y }, radius: radius, level: lvl,
      walls: walls, nodes: nodes, cost: cost, prev: prev, obstacles: obstacles,
      blockedSeg: blocked
    };
  }

  /* How far is it, really, to walk to this point? Infinity if it cannot be
     reached at all. */
  function costTo(field, p) {
    if (!standable(field.board, p, field.radius, field.level)) return Infinity;
    if (field.obstacles.some(o => o.round !== undefined &&
        Math.hypot(p.x - o.cx, p.y - o.cy) < o.round - EPS)) return Infinity;
    let best = Infinity;
    for (let i = 0; i < field.nodes.length; i++) {
      if (field.cost[i] === Infinity) continue;
      if (field.blockedSeg(field.nodes[i], p)) continue;
      const d = field.cost[i] + dist(field.nodes[i], p);
      if (d < best) best = d;
    }
    return best;
  }

  const canReach = (field, p, inches) => costTo(field, p) <= inches + 1e-6;

  function pathTo(field, p) {
    let bestI = -1, best = Infinity;
    for (let i = 0; i < field.nodes.length; i++) {
      if (field.cost[i] === Infinity) continue;
      if (field.blockedSeg(field.nodes[i], p)) continue;
      const d = field.cost[i] + dist(field.nodes[i], p);
      if (d < best) { best = d; bestI = i; }
    }
    if (bestI < 0) return null;
    const back = [];
    for (let i = bestI; i >= 0; i = field.prev[i]) back.push(field.nodes[i]);
    back.reverse();
    back.push({ x: p.x, y: p.y });
    return { points: back, length: best };
  }

  /* ---------------------------------------------------------------- climbing
     All terrain is climbable. Walk your base into a piece and you go up it: you
     end on the lowest part of it you can balance on, nearest to where you
     touched, and that is the end of your move.

     So for every piece in your way, find the cheapest place you can touch it
     from, and where on top that puts you. */
  function climbSpots(field, inches) {
    const b = field.board, r = field.radius;
    const out = [];
    field.walls.forEach(function (t) {
      const perch = r * 0.6 + 0.02;
      if (t.w < perch * 2 || t.h < perch * 2) return;    /* too narrow to stand on */

      let bestCost = Infinity, bestTouch = null;
      const step = 0.35, ring = [];
      for (let x = t.x - r - 0.05; x <= t.x + t.w + r + 0.05; x += step) {
        ring.push({ x: x, y: t.y - r - 0.05 }, { x: x, y: t.y + t.h + r + 0.05 });
      }
      for (let y = t.y - r - 0.05; y <= t.y + t.h + r + 0.05; y += step) {
        ring.push({ x: t.x - r - 0.05, y: y }, { x: t.x + t.w + r + 0.05, y: y });
      }
      ring.forEach(function (p) {
        if (p.x < r || p.y < r || p.x > b.w - r || p.y > b.h - r) return;
        const c = costTo(field, p);
        if (c < bestCost && c <= inches + 1e-6) { bestCost = c; bestTouch = p; }
      });
      if (!bestTouch) return;

      const land = {
        x: Math.min(Math.max(bestTouch.x, t.x + perch), t.x + t.w - perch),
        y: Math.min(Math.max(bestTouch.y, t.y + perch), t.y + t.h - perch)
      };
      if (!standable(b, land, r, t.top)) return;
      out.push({ x: land.x, y: land.y, top: t.top, cost: bestCost, from: bestTouch, box: t });
    });
    return out;
  }

  /* Where a click on a piece of terrain actually puts you. */
  function climbFor(field, inches, p) {
    let best = null, bestD = Infinity;
    climbSpots(field, inches).forEach(function (s) {
      if (!inBox(s.box, p)) return;
      const d = dist(s, p);
      if (d < bestD) { bestD = d; best = s; }
    });
    return best;
  }

  /* ------------------------------------------------------- drawing the areas
     The rules use the exact measurements above. These sample them, because a
     shaded area on the table has to be drawn out of something. */
  function sampleReach(field, inches, step) {
    step = step || 0.5;
    const b = field.board;
    const out = [];
    const x0 = Math.max(0, field.from.x - inches - step);
    const x1 = Math.min(b.w, field.from.x + inches + step);
    const y0 = Math.max(0, field.from.y - inches - step);
    const y1 = Math.min(b.h, field.from.y + inches + step);
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const p = { x: x, y: y };
        if (dist(field.from, p) > inches + 1e-6) continue;   /* cheap reject */
        if (canReach(field, p, inches)) out.push(p);
      }
    }
    return out;
  }

  function sampleSight(b, from, radius, step) {
    step = step || 0.5;
    const out = [];
    const x0 = Math.max(0, from.x - radius), x1 = Math.min(b.w, from.x + radius);
    const y0 = Math.max(0, from.y - radius), y1 = Math.min(b.h, from.y + radius);
    for (let y = y0; y <= y1; y += step) {
      for (let x = x0; x <= x1; x += step) {
        const p = { x: x, y: y };
        if (dist(from, p) > radius) continue;
        if (canSee(b, from, p)) out.push(p);
      }
    }
    return out;
  }

  /* Somewhere legal to put a model, as close to where you asked as possible. */
  function nudgeToLegal(b, p, radius, blockedBy) {
    const clash = q => !standable(b, q, radius) ||
      (blockedBy || []).some(o => Math.hypot(q.x - o.x, q.y - o.y) < o.radius + radius - EPS);
    if (!clash(p)) return { x: p.x, y: p.y };
    for (let r = 0.25; r <= 6; r += 0.25) {
      for (let a = 0; a < 360; a += 15) {
        const q = { x: p.x + Math.cos(a * Math.PI / 180) * r,
                    y: p.y + Math.sin(a * Math.PI / 180) * r };
        if (!clash(q)) return q;
      }
    }
    return { x: p.x, y: p.y };
  }

  return {
    build, inside, inBox, dist, heightAt, distToBox, standable, wallsFor, STEP_OVER,
    canSee, segHitsBox, moveField, costTo, canReach, pathTo, climbSpots, climbFor,
    sampleReach, sampleSight, nudgeToLegal
  };
})();

/* =========================================================================
   THE BOARD
   Geometry only: what is where, how far it is, what can be seen, and where a
   unit can walk to. One grid cell is one inch, measured centre to centre —
   the same way you would measure between two bases on the table.
   ========================================================================= */

const Board = (function () {

  const OPEN = 0, RAISED = 1, SOLID = 2;

  function build(map) {
    const w = Math.max.apply(null, map.rows.map(r => r.length));
    const h = map.rows.length;
    const height = new Uint8Array(w * h);
    const deploy = new Int8Array(w * h).fill(-1);
    const objectives = [];

    for (let y = 0; y < h; y++) {
      const row = map.rows[y];
      for (let x = 0; x < w; x++) {
        const c = row[x] || '.';
        const i = y * w + x;
        if (c === '#') height[i] = SOLID;
        else if (c === '^' || c === 'O') height[i] = RAISED;
        else height[i] = OPEN;
        if (c === '1') deploy[i] = 0;
        if (c === '2') deploy[i] = 1;
        if (c === 'o' || c === 'O') {
          objectives.push({ x: x, y: y, id: 'obj' + objectives.length });
        }
      }
    }
    return {
      id: map.id, name: map.name, blurb: map.blurb,
      w: w, h: h, height: height, deploy: deploy, objectives: objectives
    };
  }

  const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h;
  const heightAt = (b, x, y) => inside(b, x, y) ? b.height[y * b.w + x] : SOLID;
  const passable = (b, x, y) => inside(b, x, y) && b.height[y * b.w + x] !== SOLID;

  /* Inches between two cells, centre to centre. */
  const dist = (a, c) => Math.hypot(a.x - c.x, a.y - c.y);

  /* ------------------------------------------------------------ sight
     A cell blocks the view if it stands higher than BOTH ends of the look.
     So a wall stops everything, a gantry hides the floor from the floor, and
     a unit standing on a gantry sees straight over it. */
  function canSee(b, from, to) {
    const hFrom = heightAt(b, from.x, from.y);
    const hTo = heightAt(b, to.x, to.y);
    const eye = Math.max(hFrom, hTo);
    let x0 = from.x, y0 = from.y;
    const x1 = to.x, y1 = to.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (let guard = 0; guard < 4096; guard++) {
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx)  { err += dx; y0 += sy; }
      if (x0 === x1 && y0 === y1) return true;
      if (heightAt(b, x0, y0) > eye) return false;
    }
    return false;
  }

  /* Every cell this unit could see into, out to a radius. Drawn as the
     "where can I actually shoot" overlay. */
  function visibleCells(b, from, radius) {
    const out = [];
    const r = Math.ceil(radius);
    for (let y = from.y - r; y <= from.y + r; y++) {
      for (let x = from.x - r; x <= from.x + r; x++) {
        if (!inside(b, x, y)) continue;
        if (b.height[y * b.w + x] === SOLID) continue;
        const c = { x: x, y: y };
        if (dist(from, c) > radius) continue;
        if (canSee(b, from, c)) out.push(c);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------- movement
     Dijkstra out to `inches`, in eighths so diagonals cost their real
     distance. Occupied cells are walls you cannot end on or pass through. */
  function reachable(b, from, inches, blocked) {
    const key = (x, y) => y * b.w + x;
    /* Float64, not Float32: the frontier carries exact doubles, so a rounded
       stored cost reads back as *smaller* than the entry that wrote it, every
       such entry is thrown away as stale, and the search dies early — cutting
       the movement arc short with no wall in sight. */
    const cost = new Float64Array(b.w * b.h).fill(Infinity);
    const prev = new Int32Array(b.w * b.h).fill(-1);
    const start = key(from.x, from.y);
    cost[start] = 0;
    /* Small boards, so a simple sorted frontier is quick enough. */
    let frontier = [{ x: from.x, y: from.y, c: 0 }];
    const D = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],
               [1,1,1.4142],[1,-1,1.4142],[-1,1,1.4142],[-1,-1,1.4142]];
    while (frontier.length) {
      frontier.sort((p, q) => p.c - q.c);
      const cur = frontier.shift();
      if (cur.c > cost[key(cur.x, cur.y)]) continue;
      for (let i = 0; i < D.length; i++) {
        const nx = cur.x + D[i][0], ny = cur.y + D[i][1];
        if (!passable(b, nx, ny)) continue;
        if (blocked && blocked(nx, ny)) continue;
        /* No cutting a diagonal past the corner of a wall. */
        if (D[i][2] > 1 && (!passable(b, cur.x + D[i][0], cur.y) ||
                            !passable(b, cur.x, cur.y + D[i][1]))) continue;
        const step = cur.c + D[i][2];
        if (step > inches + 1e-6) continue;
        const k = key(nx, ny);
        if (step < cost[k] - 1e-6) {
          cost[k] = step;
          prev[k] = key(cur.x, cur.y);
          frontier.push({ x: nx, y: ny, c: step });
        }
      }
    }
    const cells = [];
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const k = key(x, y);
        if (k !== start && cost[k] !== Infinity) cells.push({ x: x, y: y, cost: cost[k] });
      }
    }
    return { cells: cells, cost: cost, prev: prev };
  }

  /* Walk the Dijkstra tree back so the unit takes a sensible route. */
  function pathTo(b, field, from, to) {
    const key = (x, y) => y * b.w + x;
    const path = [];
    let k = key(to.x, to.y);
    if (field.cost[k] === Infinity) return null;
    while (k !== -1 && k !== key(from.x, from.y)) {
      path.unshift({ x: k % b.w, y: Math.floor(k / b.w) });
      k = field.prev[k];
    }
    return path;
  }

  /* Cells within a radius, for an overwatch trigger or a placement ring. */
  function within(b, from, radius, needSight) {
    const out = [];
    const r = Math.ceil(radius);
    for (let y = from.y - r; y <= from.y + r; y++) {
      for (let x = from.x - r; x <= from.x + r; x++) {
        if (!inside(b, x, y)) continue;
        if (b.height[y * b.w + x] === SOLID) continue;
        const c = { x: x, y: y };
        if (dist(from, c) > radius) continue;
        if (needSight && !canSee(b, from, c)) continue;
        out.push(c);
      }
    }
    return out;
  }

  return { OPEN, RAISED, SOLID, build, inside, heightAt, passable,
           dist, canSee, visibleCells, reachable, pathTo, within };
})();

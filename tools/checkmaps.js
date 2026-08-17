/* Headless check on the battlefields themselves. The rules can be right and
   the game still be dull, so this asserts the properties that make a map worth
   playing on rather than anything about the engine:

     · every objective can actually be walked to, from both ends of the table
     · objectives can see one another, so contesting the board means exposure
     · no side gets more than one objective it can hold without being shot at
     · the maps are left-right symmetric, so neither player starts ahead

   Run:  node tools/checkmaps.js                                           */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console: console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['maps.js', 'board.js'].forEach(function (f) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'game', 'js', f), 'utf8');
  vm.runInContext(src, sandbox, { filename: f });
});
vm.runInContext('globalThis.__mods = { MAPS: MAPS, Board: Board };', sandbox);
const { MAPS, Board } = sandbox.__mods;

const MAX_GUN = 18;      // the longest ranged weapon in any preset faction
let checks = 0, failed = 0;

function ok(cond, label) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label);
}

function zoneOf(b, p) {
  const z = [];
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (b.deploy[y * b.w + x] === p && b.height[y * b.w + x] !== Board.SOLID) z.push({ x: x, y: y });
    }
  }
  return z;
}

const nearest = (zone, o) => Math.min.apply(null, zone.map(c => Board.dist(c, o)));

MAPS.list.forEach(function (m) {
  const b = Board.build(m);
  const O = b.objectives;
  console.log('\n== ' + m.name + '  ' + b.w + '×' + b.h + '"  ' + O.length + ' objectives');

  /* Every row the same width, and the same read backwards as forwards. */
  const w = Math.max.apply(null, m.rows.map(r => r.length));
  ok(m.rows.every(r => r.length === w), 'every row is ' + w + ' wide');
  ok(m.rows.every(function (r) {
    /* mirrored, with the two deployment zones swapping places */
    const flip = r.split('').reverse()
      .map(c => c === '1' ? '2' : c === '2' ? '1' : c).join('');
    return flip === r;
  }), 'left-right symmetric, deployment zones included');

  ok(O.length >= 4, 'at least four objectives (' + O.length + ')');

  /* Walkable to, from both sides. */
  [0, 1].forEach(function (p) {
    const zone = zoneOf(b, p);
    const start = zone[Math.floor(zone.length / 2)];
    const field = Board.reachable(b, start, 1e4, null);
    const unreachable = O.filter(o => field.cost[o.y * b.w + o.x] === Infinity);
    ok(unreachable.length === 0,
       'P' + (p + 1) + ' can walk to every objective' +
       (unreachable.length ? ' (stranded: ' + unreachable.map(o => o.x + ',' + o.y).join(' ') + ')' : ''));
  });

  /* Sight between objectives — the reason holding ground costs you something. */
  const pairs = [];
  for (let i = 0; i < O.length; i++) {
    for (let j = i + 1; j < O.length; j++) {
      if (Board.canSee(b, O[i], O[j])) pairs.push(i + '↔' + j);
    }
  }
  ok(pairs.length >= 3, 'objectives in sight of one another: ' + pairs.length + ' pairs');
  ok(O.every(function (o, i) {
    return pairs.some(s => s.split('↔').indexOf(String(i)) >= 0);
  }), 'no objective is out of sight of every other one');

  /* A home objective is fine. Two is a free two points a turn. */
  [0, 1].forEach(function (p) {
    const mine = zoneOf(b, p), theirs = zoneOf(b, 1 - p);
    const free = O.filter(o => nearest(mine, o) < 10 && nearest(theirs, o) > MAX_GUN);
    ok(free.length <= 1, 'P' + (p + 1) + ' has ' + free.length + ' objective(s) it can hold uncontested');
  });

  O.forEach(function (o, i) {
    console.log('    obj' + i + ' (' + o.x + ',' + o.y + ')  h' + Board.heightAt(b, o.x, o.y) +
                '   P1 ' + nearest(zoneOf(b, 0), o).toFixed(0) + '"' +
                '   P2 ' + nearest(zoneOf(b, 1), o).toFixed(0) + '"');
  });
});

/* The shrine's whole promise: blind across the nave from the floor, and from
   the top of it you see the lot. */
console.log('\n== the shrine specifically');
const sh = Board.build(MAPS.byId('shrine'));
ok(!Board.canSee(sh, { x: 6, y: 10 }, { x: 30, y: 10 }),
   'the floor cannot see across the nave');
ok(Board.canSee(sh, { x: 18, y: 10 }, { x: 6, y: 10 }) &&
   Board.canSee(sh, { x: 18, y: 10 }, { x: 30, y: 10 }),
   'standing on the nave sees both home objectives');

/* Movement must not be clipped by anything other than terrain — a Float32 cost
   array used to end the search early and cut the arc short with no wall in it. */
console.log('\n== movement');
const tl = Board.build(MAPS.byId('trenchline'));
const open = Board.reachable(tl, { x: 0, y: 11 }, 1e4, null);
let passable = 0;
for (let i = 0; i < tl.w * tl.h; i++) if (tl.height[i] !== Board.SOLID) passable++;
ok(open.cells.length === passable - 1,
   'an unlimited move reaches every passable cell (' + (open.cells.length + 1) + '/' + passable + ')');

console.log('\n== summary\n' + (checks - failed) + '/' + checks + ' checks passed');
process.exit(failed ? 1 : 0);

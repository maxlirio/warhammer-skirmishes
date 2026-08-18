/* Headless check on the battlefields themselves. The rules can be right and
   the game still be dull, so this asserts the properties that make a table
   worth playing on, and the geometry that measures it:

     · nothing is walled off — every marker can be walked to from both ends
     · markers can see one another, so contesting the table means exposure
     · neither side gets more than one marker it can hold without being shot at
     · the tables are symmetric left to right, so neither player starts ahead

   Everything here is in inches. There is no grid.
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

const BASE = 0.5;        // a 25mm base is just under an inch across
const MAX_GUN = 18;      // the longest ranged weapon in any preset faction
let checks = 0, failed = 0;

function ok(cond, label) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label);
}

/* Nearest point of a deployment rectangle to a spot on the table. */
function nearZone(z, p) {
  const cx = Math.min(Math.max(p.x, z.x), z.x + z.w);
  const cy = Math.min(Math.max(p.y, z.y), z.y + z.h);
  return Math.hypot(p.x - cx, p.y - cy);
}
const zoneMid = z => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 });

MAPS.list.forEach(function (m) {
  const b = Board.build(m);
  const O = b.objectives;
  console.log('\n== ' + m.name + '  ' + b.w + '" × ' + b.h + '"  ' +
              O.length + ' objectives, ' + b.terrain.length + ' pieces of terrain');

  /* Mirror symmetry, in the geometry rather than in a string. */
  const flip = t => ({ x: b.w - t.x - t.w, y: t.y, w: t.w, h: t.h, top: t.top, blocks: t.blocks });
  const same = (a, c) => ['x', 'y', 'w', 'h', 'top'].every(k => Math.abs(a[k] - c[k]) < 1e-6) &&
                         a.blocks === c.blocks;
  ok(b.terrain.every(t => b.terrain.some(o => same(flip(t), o))),
     'every piece of terrain has its mirror image');
  ok(O.every(o => O.some(p => Math.abs(p.x - (b.w - o.x)) < 1e-6 && Math.abs(p.y - o.y) < 1e-6)),
     'every objective has its mirror image');
  ok(Math.abs(b.deploy[0].w - b.deploy[1].w) < 1e-6 &&
     Math.abs(b.deploy[0].x - (b.w - b.deploy[1].x - b.deploy[1].w)) < 1e-6,
     'the two deployment zones are mirror images');

  ok(O.length >= 4, 'at least four objectives (' + O.length + ')');
  ok(O.every(o => Board.standable(b, o, BASE)),
     'a model can actually stand on every objective');

  /* Nothing walled off. All terrain is climbable, but a climb ends your move,
     so getting somewhere high takes more than one — expand a few moves out. */
  [0, 1].forEach(function (p) {
    const start = Board.nudgeToLegal(b, zoneMid(b.deploy[p]), BASE, []);
    let frontier = [start];
    const seen = [];
    const got = o => frontier.concat(seen).some(function (f) {
      const fld = Board.moveField(b, f, BASE, [], Board.heightAt(b, f));
      return isFinite(Board.costTo(fld, o));
    });
    for (let round = 0; round < 5 && frontier.length; round++) {
      const next = [];
      frontier.forEach(function (f) {
        const fld = Board.moveField(b, f, BASE, [], Board.heightAt(b, f));
        Board.climbSpots(fld, 1e4).forEach(function (c) {
          if (seen.concat(next).some(q => Board.dist(q, c) < 0.5)) return;
          next.push({ x: c.x, y: c.y });
        });
      });
      seen.push.apply(seen, frontier);
      frontier = next;
    }
    const stranded = O.filter(o => !got(o));
    ok(stranded.length === 0,
       'P' + (p + 1) + ' can reach every objective, climbing where it has to' +
       (stranded.length ? ' (stranded: ' + stranded.map(o => o.x + ',' + o.y).join(' ') + ')' : ''));
  });

  /* Sight between markers — the reason holding ground costs you something. */
  const pairs = [];
  for (let i = 0; i < O.length; i++) {
    for (let j = i + 1; j < O.length; j++) {
      if (Board.canSee(b, O[i], O[j])) pairs.push(i + '↔' + j);
    }
  }
  ok(pairs.length >= 3, 'objectives in sight of one another: ' + pairs.length + ' pairs');
  ok(O.every((o, i) => pairs.some(s => s.split('↔').indexOf(String(i)) >= 0)),
     'no objective is out of sight of every other one');

  /* One home marker is fine. Two is a free two points a turn. */
  [0, 1].forEach(function (p) {
    const free = O.filter(o => nearZone(b.deploy[p], o) < 10 &&
                               nearZone(b.deploy[1 - p], o) > MAX_GUN);
    ok(free.length <= 1, 'P' + (p + 1) + ' has ' + free.length + ' objective(s) it can hold uncontested');
  });

  O.forEach(function (o, i) {
    console.log('    obj' + i + ' (' + o.x + ', ' + o.y + ')  ' +
                Board.heightAt(b, o).toFixed(1) + '" up' +
                '   P1 ' + nearZone(b.deploy[0], o).toFixed(1) + '"' +
                '   P2 ' + nearZone(b.deploy[1], o).toFixed(1) + '"');
  });
});

/* ------------------------------------------------------------------ geometry */

console.log('\n== measuring');
const tl = Board.build(MAPS.byId('trenchline'));
ok(Math.abs(Board.dist({ x: 0, y: 0 }, { x: 3, y: 4 }) - 5) < 1e-9,
   'distance is the straight line, not a count of squares (3,4 → 5")');

/* A move goes round a wall, so it must cost more than the straight line does. */
const wall = tl.terrain.find(t => t.blocks && t.kind === 'trench');
const a = { x: wall.x + wall.w / 2, y: wall.y - 2 };
const c = { x: wall.x + wall.w / 2, y: wall.y + wall.h + 2 };
const f = Board.moveField(tl, a, BASE, []);
const straight = Board.dist(a, c);
const walked = Board.costTo(f, c);
ok(walked > straight + 0.5,
   'walking round a wall costs more than the straight line (' +
   walked.toFixed(2) + '" vs ' + straight.toFixed(2) + '")');
ok(isFinite(walked), 'and it is still reachable');

/* In the open, the two are the same thing. */
const openA = { x: 20, y: 2 }, openB = { x: 26, y: 2 };
const fo = Board.moveField(tl, openA, BASE, []);
ok(Math.abs(Board.costTo(fo, openB) - Board.dist(openA, openB)) < 1e-6,
   'in the open, a move measures exactly the straight line');

/* All terrain is climbable, so the top of a wall is somewhere you can stand —
   but its side is not, and you cannot hang half off the edge. */
ok(Board.standable(tl, { x: wall.x + wall.w / 2, y: wall.y + wall.h / 2 }, BASE),
   'you can stand on top of a wall');
ok(Math.abs(Board.heightAt(tl, { x: wall.x + wall.w / 2, y: wall.y + wall.h / 2 }) - wall.top) < 1e-9,
   'and standing on it puts you at its height');
ok(!Board.standable(tl, { x: wall.x + 1, y: wall.y - 0.25 }, BASE),
   'you cannot stand with your base cutting into its side');
ok(Board.standable(tl, { x: wall.x + 1, y: wall.y - 0.75 }, BASE),
   'but you can stand right up against it');
ok(!Board.standable(tl, { x: wall.x + 0.1, y: wall.y + wall.h / 2 }, BASE, wall.top),
   'nor hang off the edge of the top');

/* Walking into it takes you up it, and that is the end of the move. */
const below = { x: wall.x + wall.w / 2, y: wall.y - 2 };
const cf = Board.moveField(tl, below, BASE, [], 0);
const climbs = Board.climbSpots(cf, 6);
const onWall = climbs.find(c => c.box === wall);
ok(!!onWall, 'walking into a wall offers a way up it');
if (onWall) {
  ok(Math.abs(onWall.top - wall.top) < 1e-9, 'and it puts you on top of it');
  ok(onWall.cost < 2.1, 'costing only the walk up to it (' + onWall.cost.toFixed(2) + '")');
  ok(Board.inBox(wall, onWall), 'landing squarely on the piece you climbed');
}

/* Standing right up against something must not stop you moving. */
const hug = { x: wall.x + 1, y: wall.y - 0.5 };
ok(Board.standable(tl, hug, BASE), 'you can stand right up against a wall');
const hugField = Board.moveField(tl, hug, BASE, [], 0);
const outs = Board.sampleReach(hugField, 4, 0.5);
ok(outs.length > 10, 'and can still walk away from it', outs.length + ' places to go');

console.log('\n== the shrine specifically');
const sh = Board.build(MAPS.byId('shrine'));
ok(!Board.canSee(sh, { x: 8, y: 14 }, { x: 32, y: 14 }),
   'the floor cannot see across the nave');
ok(Board.canSee(sh, { x: 20, y: 14 }, { x: 8, y: 14 }) &&
   Board.canSee(sh, { x: 20, y: 14 }, { x: 32, y: 14 }),
   'standing on the nave sees both home objectives');
ok(Board.heightAt(sh, { x: 20, y: 14 }) > Board.heightAt(sh, { x: 8, y: 14 }),
   'and the nave really is the high ground');

console.log('\n== summary\n' + (checks - failed) + '/' + checks + ' checks passed');
process.exit(failed ? 1 : 0);

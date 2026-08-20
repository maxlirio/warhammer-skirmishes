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

/* What each card needs on the ground, beyond the things every table needs. */
const WANTS = {
  null:            { markers: 5, note: 'objectives everywhere, since holding them is all there is' },
  sabotage:        { markers: 0, note: 'the targets are units in the deployment zones' },
  hill:            { markers: 0, note: 'one obviously tallest piece near the middle' },
  ambush:          { markers: 0, note: 'cover at both ends, open ground between' },
  assassination:   { markers: 1, note: 'one marker, in the middle' },
  secure:          { markers: 3, note: 'three markers, one to each flank and one central' },
  relic:           { markers: 0, note: 'the relic starts in the middle' }
};

MAPS.list.forEach(function (m) {
  const b = Board.build(m);
  const O = b.objectives;
  const mid = { x: b.w / 2, y: b.h / 2 };
  const want = WANTS[String(m.missionId)];
  console.log('\n== ' + m.name + '  (' + (m.missionId || 'no card') + ')  ' +
              b.w + '" × ' + b.h + '"  ' + b.terrain.length + ' pieces');

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

  ok(!!want, 'the card this table is for is one of the seven');
  if (want) {
    ok(O.length === want.markers,
       'it carries the ' + want.markers + ' marker(s) its card calls for — ' + want.note,
       'found ' + O.length);
  }
  ok(O.every(o => Board.standable(b, o, BASE)),
     'a model can stand on every marker it does carry');

  /* Nothing walled off, and the middle reachable from both ends. */
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
    const targets = O.concat([Board.nudgeToLegal(b, mid, BASE, [])]);
    const stranded = targets.filter(o => !got(o));
    ok(stranded.length === 0,
       'P' + (p + 1) + ' can reach the middle and every marker, climbing where it has to',
       stranded.length ? 'stranded: ' + stranded.map(o => o.x + ',' + o.y).join(' ') : '');
  });

  /* Markers, where there are any, have to be worth contesting. */
  if (O.length > 1) {
    const pairs = [];
    for (let i = 0; i < O.length; i++) {
      for (let j = i + 1; j < O.length; j++) {
        if (Board.canSee(b, O[i], O[j])) pairs.push(i + '↔' + j);
      }
    }
    ok(pairs.length >= 1, 'markers can see one another', pairs.length + ' pairs');
    [0, 1].forEach(function (p) {
      const free = O.filter(o => nearZone(b.deploy[p], o) < 10 &&
                                 nearZone(b.deploy[1 - p], o) > MAX_GUN);
      ok(free.length <= 1, 'P' + (p + 1) + ' has ' + free.length + ' it can hold uncontested');
    });
  }

  /* And what this particular card needs of the ground. */
  if (m.missionId === 'hill') {
    const tallest = b.terrain.slice().sort((x, y) => y.top - x.top)[0];
    const second = b.terrain.filter(t => t !== tallest).sort((x, y) => y.top - x.top)[0];
    ok(tallest.top >= second.top + 1.2,
       'the HIGH GROUND stands clear of everything else',
       tallest.top + '" against ' + second.top + '"');
    const c = { x: tallest.x + tallest.w / 2, y: tallest.y + tallest.h / 2 };
    ok(Board.dist(c, mid) < 4, 'and it is near the middle', Board.dist(c, mid).toFixed(1) + '" off');
  }
  if (m.missionId === 'ambush') {
    const half = b.w / 2;
    const middle = b.terrain.filter(t => Math.abs(t.x + t.w / 2 - half) < 7 && t.blocks);
    const ends = b.terrain.filter(t => Math.abs(t.x + t.w / 2 - half) > 12 && t.blocks);
    ok(ends.length > middle.length,
       'there is more cover at the ends than in the crossing',
       ends.length + ' against ' + middle.length);
  }
  if (m.missionId === 'secure') {
    const spread = Math.max.apply(null, O.map(o => o.x)) - Math.min.apply(null, O.map(o => o.x));
    ok(spread > b.w * 0.4, 'the three stations are spread across the table',
       spread.toFixed(0) + '" apart');
    ok(O.every(o => Board.heightAt(b, o) > 0.5), 'and every one of them is worth standing on');
  }
  if (m.missionId === 'relic') {
    ok(Board.heightAt(b, mid) > 0.5, 'the relic starts somewhere worth fighting over');
  }
  if (m.missionId === 'sabotage') {
    [0, 1].forEach(function (p) {
      const z = b.deploy[p];
      const near = b.terrain.filter(t => t.blocks &&
        Math.min(Math.abs(t.x - (z.x + z.w)), Math.abs(t.x + t.w - z.x)) < 6);
      ok(near.length > 0, 'P' + (p + 1) + ' has something to put its objective behind');
    });
  }
});

/* ------------------------------------------------------------------ geometry */

console.log('\n== measuring');
/* These test the GEOMETRY, not any particular battlefield — they were just
   borrowing a real table as a convenient surface, with hard-coded coordinates
   that assumed a given patch of it was bare. The moment the tables were built
   out properly, a building stood on that patch and three of these failed for
   reasons that had nothing to do with what they were checking. So they get
   their own board: one wall, in the middle of nothing. */
const tl = Board.build({
  id: 'testbench', name: 'TEST BENCH', biome: 'rockcrete', w: 40, h: 30,
  deploy: [{ x: 0, y: 0, w: 6, h: 30 }, { x: 34, y: 0, w: 6, h: 30 }],
  terrain: [{ x: 17, y: 13, w: 6, h: 2, top: 3.6, blocks: true, kind: 'wall' }],
  objectives: []
});
ok(Math.abs(Board.dist({ x: 0, y: 0 }, { x: 3, y: 4 }) - 5) < 1e-9,
   'distance is the straight line, not a count of squares (3,4 → 5")');

/* A move goes round a wall, so it must cost more than the straight line does.
   Both ends have to be on open floor, or the test is measuring something else. */
const wall = tl.terrain.find(t => t.blocks && t.kind === 'wall');
/* really clear: a full inch off anything, so the test measures the detour
   round the wall and not some other piece it is brushing */
const clearOf = p => Board.inside(tl, p) &&
                     tl.terrain.every(t => t === wall || Board.distToBox(t, p) > 1) &&
                     Board.standable(tl, p, BASE);
function clearNear(x, y, dy) {
  for (let d = 1.5; d <= 12; d += 0.25) {
    const p = { x: x, y: y + dy * d };
    if (clearOf(p)) return p;
  }
  return null;
}
const a = clearNear(wall.x + wall.w / 2, wall.y, -1);
const c = clearNear(wall.x + wall.w / 2, wall.y + wall.h, 1);
const f = Board.moveField(tl, a, BASE, []);
const straight = Board.dist(a, c);
const walked = Board.costTo(f, c);
ok(a && c, 'found open ground on both sides of a wall to measure between');
ok(isFinite(walked), 'the far side is reachable at all', walked.toFixed(2) + '"');
ok(walked > straight + 0.5,
   'and walking round it costs more than the straight line (' +
   walked.toFixed(2) + '" against ' + straight.toFixed(2) + '")');

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

console.log('\n== high ground');
const hill = Board.build(MAPS.byId('pinnacle'));
const peak = { x: hill.w / 2, y: hill.h / 2 };
/* open floor either side, not the top of a pillar */
function openFloor(b, fromX, dir) {
  for (let x = fromX; x > 1 && x < b.w - 1; x += dir) {
    const p = { x: x, y: b.h / 2 };
    if (Board.heightAt(b, p) < 0.01 && Board.standable(b, p, BASE)) return p;
  }
  return { x: fromX, y: b.h / 2 };
}
const westFloor = openFloor(hill, 8, -1), eastFloor = openFloor(hill, hill.w - 8, 1);
ok(!Board.canSee(hill, westFloor, eastFloor),
   'the floor cannot see across the massif');
ok(Board.canSee(hill, peak, westFloor) && Board.canSee(hill, peak, eastFloor),
   'but the top of it sees both ends of the table');
ok(Board.heightAt(hill, peak) > Board.heightAt(hill, westFloor) + 3,
   'and it really is the high ground',
   Board.heightAt(hill, peak) + '" against ' + Board.heightAt(hill, westFloor) + '"');

console.log('\n== summary\n' + (checks - failed) + '/' + checks + ' checks passed');
process.exit(failed ? 1 : 0);

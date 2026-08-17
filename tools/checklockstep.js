/* Two people playing over a wire each replay the other's DECISIONS, not the
   board: "Fred shoots Snitcherz with the Modded Lasgun", never "Snitcherz is
   now on 1 wound". That is a fraction of the traffic and it means a desync is
   a bug in the rules rather than something the network papers over — but it
   only holds if the same decisions in the same order always produce the same
   table, right down to the dice.

   So: run two independent games, feed them identical decisions, and compare
   the whole table after every single one.

   Run:  node tools/checklockstep.js                                        */

const fs = require('fs'), path = require('path'), vm = require('vm');

function makeGame() {
  const sandbox = { console: console, window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['../js/rules.js', '../js/state.js', 'js/maps.js', 'js/board.js', 'js/battle.js']
    .forEach(function (f) {
      const p = path.join(__dirname, '..', 'game', f);
      vm.runInContext(fs.readFileSync(path.resolve(p), 'utf8'), sandbox, { filename: f });
    });
  vm.runInContext('globalThis.__m = { Battle: Battle, Board: Board, MAPS: MAPS, PRESETS: PRESETS };', sandbox);
  return sandbox.__m;
}

/* A compact, order-sensitive picture of the whole table. */
function fingerprint(B) {
  const S = B.get();
  return JSON.stringify({
    turn: S.turn, ctrl: S.control, chain: S.chain, winner: S.winner,
    players: S.players.map(p => [p.ap, p.vp, p.rp]),
    units: S.units.map(u => [u.id, +u.x.toFixed(6), +u.y.toFixed(6), u.wounds, u.alive,
                             u.kills, u.overwatch ? [+u.overwatch.x.toFixed(4), +u.overwatch.y.toFixed(4)] : 0]),
    log: S.log.length,
    strikes: S.strikes.map(k => [k.attacker, k.target, k.hit, k.wound, k.damage, k.killed])
  });
}

const A = makeGame(), Bm = makeGame();
const cfg = { mapId: 'trenchline', factions: ['astra', 'orks'],
              names: ['P1', 'P2'], seed: 987654321 };
A.Battle.start(cfg);
Bm.Battle.start(cfg);

let steps = 0, diverged = null;
const both = fn => { fn(A.Battle, A.Board); fn(Bm.Battle, Bm.Board); };

/* Drive from A's point of view, feed the identical decision to B. */
const rnd = (function (s) { return function () {
  s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(42);
const pick = a => a[Math.floor(rnd() * a.length)];

while (A.Battle.get().winner === null && steps < 900 && !diverged) {
  steps++;
  const S = A.Battle.get();
  if (S.pending && S.pending.kind === 'reaction') {
    const ok = S.pending.options.filter(o => o.ok);
    const id = (rnd() < 0.55 && ok.length) ? pick(ok).id : 'none';
    both(B => B.chooseReaction(id));
  } else if (S.pending && S.pending.kind === 'move') {
    const i = Math.floor(rnd() * S.pending.spots.length);
    const spot = S.pending.spots[i];
    both(B => B.placeMove({ x: spot.x, y: spot.y }));
  } else if (S.pending && S.pending.kind === 'overwatch') {
    const w = S.pending.watchers.slice();
    w.forEach(function (id) { if (rnd() < 0.7) both(B => B.toggleWatcher(id)); });
    both(B => B.fireOverwatch());
  } else {
    const p = S.control.player;
    const choices = [];
    A.Battle.mine(p).forEach(u => A.Battle.actionsFor(u.id).forEach(a => {
      if (a.ok) choices.push({ u: u.id, a: a.id });
    }));
    if (!choices.length) { both(B => B.doPass(p === B.get().turn.player)); }
    else {
      const c = pick(choices);
      if (c.a === 'move') {
        const mf = A.Battle.moveField(c.u);
        const spots = A.Board.sampleReach(mf.field, mf.inches, 0.6);
        if (!spots.length) { both(B => B.doPass(false)); }
        else { const s = pick(spots); both(B => B.doMove(c.u, { x: s.x, y: s.y })); }
      } else if (c.a === 'shoot') {
        const t = pick(A.Battle.rangedTargets(c.u));
        both(B => B.doShoot(c.u, t, null));
      } else if (c.a === 'fight') {
        const t = pick(A.Battle.meleeTargets(c.u));
        both(B => B.doFight(c.u, t, null));
      } else if (c.a === 'charge') {
        const t = pick(A.Battle.chargeTargets(c.u));
        both(B => B.doCharge(c.u, t));
      } else if (c.a === 'overwatch') {
        const u = A.Battle.unit(c.u);
        const at = { x: u.x + (rnd() - 0.5) * 16, y: u.y + (rnd() - 0.5) * 16 };
        both(B => B.doOverwatch(c.u, at));
      }
    }
  }
  const fa = fingerprint(A.Battle), fb = fingerprint(Bm.Battle);
  if (fa !== fb) diverged = { step: steps, a: fa.slice(0, 400), b: fb.slice(0, 400) };
}

console.log('steps replayed in lockstep:', steps);
console.log('turn reached:', A.Battle.get().turn.number,
            '| winner:', A.Battle.get().winner,
            '| dead:', A.Battle.get().units.filter(u => !u.alive).length);
if (diverged) {
  console.log('DESYNC at step ' + diverged.step);
  console.log('  A ' + diverged.a);
  console.log('  B ' + diverged.b);
  process.exit(1);
}
console.log('the two games are identical at every single step');

/* And a different seed must actually give different dice. Force a fight so
   there is something to roll, rather than hoping random play finds one. */
function rollSeries(seed) {
  const G = makeGame();
  G.Battle.start(Object.assign({}, cfg, { seed: seed }));
  const S = G.Battle.get();
  const a = G.Battle.unit('u0_0'), t = G.Battle.unit('u1_0');
  a.x = 20; a.y = 6; t.x = 20.9; t.y = 6;
  S.players[0].ap = 40; S.players[1].ap = 40;
  const out = [];
  for (let i = 0; i < 12 && G.Battle.get().winner === null; i++) {
    const p = G.Battle.get().pending;
    if (p && p.kind === 'reaction') { G.Battle.chooseReaction('none'); continue; }
    if (p && p.kind === 'move') { G.Battle.placeMove(p.spots[0]); continue; }
    if (p) break;
    if (!t.alive || !a.alive) break;
    if (!G.Battle.meleeTargets('u0_0').length) break;
    G.Battle.doFight('u0_0', 'u1_0', null);
  }
  return G.Battle.get().strikes.map(k => (k.rolls ? k.rolls.hit : 0) + ':' + (k.rolls && k.rolls.wound || 0));
}
const s1 = rollSeries(987654321), s2 = rollSeries(5), s1again = rollSeries(987654321);
console.log('seed 987654321 -> rolls', JSON.stringify(s1));
console.log('seed 5         -> rolls', JSON.stringify(s2));
console.log('same seed twice is the same series:', JSON.stringify(s1) === JSON.stringify(s1again) ? 'yes' : 'NO');
console.log('a different seed is a different series:', JSON.stringify(s1) !== JSON.stringify(s2) ? 'yes' : 'NO — seed ignored');

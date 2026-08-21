/* Does each Tactic Card do what its card says?
 *
 * Nine cards, and every one of them is a TRIGGER — the whole design is that
 * you bet on a moment happening. So the only test worth writing puts the card
 * face down, makes that moment happen, and checks it flipped and did the thing.
 * A card that fires at roughly the right time is a card that does roughly the
 * wrong thing.
 *
 *   node tools/checktactics.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let checks = 0, failed = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + (detail ? '  — ' + detail : ''));
}

function scene(seed, factions) {
  const sb = { console: console, window: {} };
  sb.globalThis = sb;
  vm.createContext(sb);
  ['../js/rules.js', '../js/state.js', 'js/maps.js', 'js/board.js', 'js/battle.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'game', f), 'utf8'),
                                  sb, { filename: f }));
  vm.runInContext('globalThis.__x = { Battle: Battle, RULES: RULES };', sb);
  const B = sb.__x.Battle;
  B.start({ factions: factions || ['astra', 'orks'], names: ['A', 'B'],
            seed: seed, missionId: null });
  const S = B.get();
  let n = 0;
  while (S.pending && n++ < 90) {
    const p = S.pending;
    if (p.kind === 'deploy') B.placeDeploy(p.spots[0]);
    else if (p.kind === 'pick') B.choosePick(p.options[0]);
    else if (p.kind === 'tactic') B.chooseTactic(null);
    else break;
  }
  S.board.terrain.length = 0;            /* the cards are the subject, not the map */
  return { B: B, S: S, R: sb.__x.RULES };
}

/* The table at the moment of the deal, before a turn has begun. */
function deal(seed) {
  const sb = { console: console, window: {} };
  sb.globalThis = sb;
  vm.createContext(sb);
  ['../js/rules.js', '../js/state.js', 'js/maps.js', 'js/board.js', 'js/battle.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'game', f), 'utf8'),
                                  sb, { filename: f }));
  vm.runInContext('globalThis.__x = { Battle: Battle };', sb);
  const B = sb.__x.Battle;
  B.start({ factions: ['astra', 'orks'], names: ['A', 'B'], seed: seed, missionId: null });
  return B.get();
}

const find = (S, re) => S.units.find(u => new RegExp(re).test(u.name));

/* Stand a shooter and a target in the open, with the target unkillable so the
   sequence always runs to the end. */
function faceOff(S, shooter, target, opts) {
  opts = opts || {};
  const a = find(S, shooter), t = find(S, target);
  t.maxWounds = 99; t.wounds = 99;
  a.x = 10; a.y = 15; t.x = opts.gap === undefined ? 16 : 10 + opts.gap; t.y = 15;
  if (opts.sure) a.weapons.forEach(w => { if (w.type === 'ranged') { w.hit = 2; w.strength = 9; } });
  S.control = { player: a.owner, forcedUnitId: null };
  S.players[a.owner].ap = 9;
  S.turn.player = a.owner;
  return { a: a, t: t };
}

/* Put a named card face down for a player and hand back a log reader. */
function lay(S, player, id) {
  S.tactics[player].placed = id;
  const from = S.log.length;
  return () => S.log.slice(from).map(l => l.text);
}

console.log('\n== the deck');
{
  const g = scene(5);
  const R = g.R;
  ok(R.tactics.length === 9, 'nine generic cards', R.tactics.length + '');
  ok(R.tacticDeck().length === 18, 'eighteen in a deck, two of each',
     R.tacticDeck().length + '');
  ok(R.tactics.every(t => t.when && t.kind && t.text),
     'every one has a trigger, a kind and its text');
  /* Measured at the deal, before the first Start Phase — the active player
     draws again at the top of their own turn, so by the time anybody is
     looking at the table they hold four. */
  const fresh = deal(5);
  ok(fresh.tactics[0].hand.length === 3 && fresh.tactics[1].hand.length === 3,
     'both sides open holding three',
     fresh.tactics.map(t => t.hand.length).join('/'));
  ok(fresh.tactics[0].deck.length === 15, 'and fifteen left in the deck',
     fresh.tactics[0].deck.length + '');
  ok(g.S.tactics[0].hand.length === 4,
     'and the first player has drawn a fourth by their Start Phase',
     g.S.tactics[0].hand.length + '');
}

console.log('\n== laying one face down');
{
  const g = scene(7);
  const S = g.S;
  const before = S.tactics[0].hand.length;
  g.B.placeTactic(0, 0);
  ok(!!S.tactics[0].placed, 'it goes face down');
  ok(S.tactics[0].hand.length === before - 1, 'and leaves your hand');
  const ap = S.players[0].ap;
  /* end the turn without it ever firing */
  S.pending = null;
  g.B.endTurn();
  ok(!S.tactics[0].placed, 'unflipped, it is discarded at the end of the turn');
  ok(S.players[0].ap === ap + 1, 'and pays 1 AP for the bluff',
     'ap ' + ap + ' -> ' + S.players[0].ap);
}

console.log('\n== RETRIBUTION — a friendly is damaged, gain 2 AP');
{
  let fired = false;
  for (let s = 1; s <= 60 && !fired; s++) {
    const g = scene(s * 17);
    const { a, t } = faceOff(g.S, 'Nick', 'Blikker', { sure: true });
    const ap = g.S.players[1].ap;
    const read = lay(g.S, 1, 'retribution');
    g.B.doShoot(a.id, t.id);
    if (g.S.pending && g.S.pending.kind === 'reaction') g.B.chooseReaction('none');
    const txt = read();
    if (txt.some(x => /flips RETRIBUTION/.test(x))) {
      fired = true;
      ok(g.S.players[1].ap >= ap + 2, 'the damaged side gains 2 AP',
         'ap ' + ap + ' -> ' + g.S.players[1].ap);
    }
  }
  ok(fired, 'it flips when a friendly unit takes damage');
}

console.log('\n== TAKE AIM — an unmoved shooter gets +1 to hit');
{
  const g = scene(11);
  const { a, t } = faceOff(g.S, 'Nick', 'Blikker');
  a.movedTurn = -1;
  const read = lay(g.S, 0, 'takeaim');
  g.B.doShoot(a.id, t.id);
  const txt = read();
  ok(txt.some(x => /flips TAKE AIM/.test(x)), 'it flips on the declaration');
  ok(txt.some(x => /\+1 to hit/.test(x)), 'and grants +1 to hit');
}

console.log('\n== TAKE AIM does not fire for a unit that has moved');
{
  const g = scene(11);
  const { a, t } = faceOff(g.S, 'Nick', 'Blikker');
  a.movedTurn = g.S.turn.number;                 /* it moved this turn */
  const read = lay(g.S, 0, 'takeaim');
  g.B.doShoot(a.id, t.id);
  ok(!read().some(x => /flips TAKE AIM/.test(x)),
     'the card stays face down, as its text says');
}

console.log('\n== FEINT — the enemy may not PARRY or EVADE');
{
  const g = scene(11);
  const { a, t } = faceOff(g.S, 'Fred', 'Blikker', { gap: 0.9 });
  const read = lay(g.S, 0, 'feint');
  g.B.doFight(a.id, t.id);
  ok(read().some(x => /flips FEINT/.test(x)), 'it flips on the FIGHT declaration');
  const pend = g.S.pending;
  ok(pend && pend.kind === 'reaction', 'the defender is still offered reactions');
  if (pend && pend.options) {
    const parry = pend.options.find(o => o.id === 'parry');
    const evade = pend.options.find(o => o.id === 'evade');
    ok(parry && !parry.ok, 'but PARRY is closed off', parry ? parry.why : 'missing');
    ok(evade && !evade.ok, 'and so is EVADE', evade ? evade.why : 'missing');
    const focus = pend.options.find(o => o.id === 'focus');
    ok(focus && focus.ok, 'while FOCUS, which it does not name, is untouched');
  }
}

console.log('\n== HEADSHOT — a successful ranged wound may gain a damage');
{
  let fired = false;
  for (let s = 1; s <= 60 && !fired; s++) {
    const g = scene(s * 17);
    const { a, t } = faceOff(g.S, 'Nick', 'Blikker', { sure: true });
    const read = lay(g.S, 0, 'headshot');
    g.B.doShoot(a.id, t.id);
    if (g.S.pending && g.S.pending.kind === 'reaction') g.B.chooseReaction('none');
    const txt = read();
    if (txt.some(x => /flips HEADSHOT/.test(x))) {
      fired = true;
      ok(txt.some(x => /HEADSHOT: \+1 damage|HEADSHOT: no improvement/.test(x)),
         'it rolls for the improvement rather than simply granting it');
    }
  }
  ok(fired, 'it flips on a successful wound roll');
}

console.log('\n== TAKE COVER — a reaction bought with RP');
{
  const g = scene(11);
  const { a, t } = faceOff(g.S, 'Nick', 'Blikker');
  const read = lay(g.S, 1, 'takecover');
  g.B.doShoot(a.id, t.id);
  const pend = g.S.pending;
  ok(pend && pend.kind === 'reaction', 'the shot offers the defender their reactions');
  const opt = pend && (pend.options || []).find(o => o.tactic === 'takecover');
  ok(!!opt, 'and TAKE COVER is among them, because it is face down');
  ok(!read().some(x => /flips TAKE COVER/.test(x)),
     'it has NOT flipped yet — it waits to be bought');
  if (opt) {
    g.B.chooseReaction(opt.id);
    const txt = read();
    ok(txt.some(x => /flips TAKE COVER/.test(x)), 'taking it flips it');
    ok(txt.some(x => /-2 to hit/.test(x)), 'and the shot is at -2 to hit');
  }
}

console.log('\n== SHIFT — move the unit that opened the chain');
{
  const g = scene(11);
  const { a, t } = faceOff(g.S, 'Nick', 'Blikker');
  const read = lay(g.S, 0, 'shift');
  g.B.doShoot(a.id, t.id);
  ok(read().some(x => /flips SHIFT/.test(x)), 'it flips as the chain opens');
}

console.log('\n== LOCKED AND LOADED — the guns come back');
{
  const g = scene(11);
  const { a, t } = faceOff(g.S, 'Nick', 'Blikker');
  /* Nick fires everything first, so he has spent guns to reload */
  g.B.doShoot(a.id, t.id);
  if (g.S.pending && g.S.pending.kind === 'reaction') g.B.chooseReaction('none');
  g.S.control = { player: 0, forcedUnitId: null }; g.S.players[0].ap = 9;
  g.B.doShoot(a.id, t.id);
  if (g.S.pending && g.S.pending.kind === 'reaction') g.B.chooseReaction('none');
  ok(g.B.rangedTargets(a.id).length === 0,
     'with every gun fired, this unit has no ranged targets left this chain');

  /* now the enemy shoots him, with the card face down */
  const read = lay(g.S, 0, 'lockedloaded');
  g.S.control = { player: 1, forcedUnitId: null }; g.S.players[1].ap = 9; g.S.turn.player = 1;
  g.B.doShoot(t.id, a.id);
  const txt = read();
  ok(txt.some(x => /flips LOCKED AND LOADED/.test(x)),
     'being shot at flips it', txt.slice(-3).join(' | '));
  if (g.S.pending && g.S.pending.kind === 'reaction') g.B.chooseReaction('none');
  ok(g.B.rangedTargets(a.id).length > 0, 'and the guns may be chosen again');
}

console.log('\n== the unused ranged weapon rule it depends on');
{
  const g = scene(11);
  const { a, t } = faceOff(g.S, 'Nick', 'Blikker');
  const guns = a.weapons.filter(w => w.type === 'ranged').length;
  ok(guns >= 2, 'this unit carries more than one gun', guns + '');
  let fired = 0;
  for (let i = 0; i < guns + 1; i++) {
    if (!g.B.rangedTargets(a.id).length) break;
    g.B.doShoot(a.id, t.id);
    fired++;
    if (g.S.pending && g.S.pending.kind === 'reaction') g.B.chooseReaction('none');
    g.S.control = { player: 0, forcedUnitId: null }; g.S.players[0].ap = 9;
  }
  ok(fired === guns, 'each gun fires once per chain and no more',
     'fired ' + fired + ' of ' + guns);
}

console.log('\n== summary\n' + (checks - failed) + '/' + checks + ' checks passed');
process.exit(failed ? 1 : 0);

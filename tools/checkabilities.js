/* Every ability on every unit, used for real, with an assertion that something
   actually happened. Wiring an effect up is not the same as it working, and the
   only way to tell the difference is to fire it and look at the table
   afterwards.

   Run:  node tools/checkabilities.js                                       */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeGame() {
  const sandbox = { console: console, window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['../js/rules.js', '../js/state.js', 'js/maps.js', 'js/board.js', 'js/battle.js']
    .forEach(function (f) {
      const p = path.join(__dirname, '..', 'game', f);
      vm.runInContext(fs.readFileSync(path.resolve(p), 'utf8'), sandbox, { filename: f });
    });
  vm.runInContext('globalThis.__m = { Battle: Battle, Board: Board, PRESETS: PRESETS, RULES: RULES };',
                  sandbox);
  return sandbox.__m;
}

let checks = 0, failed = 0;
const fails = [];
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); return; }
  failed++;
  fails.push(label + (detail ? '  — ' + detail : ''));
  console.log('  ✗ ' + label + (detail ? '  — ' + detail : ''));
}

/* A game with both sides in reach of each other and plenty of AP. */
function scene(f0, f1, opts) {
  opts = opts || {};
  const G = makeGame();
  G.Battle.start({ mapId: opts.map || 'trenchline', factions: [f0, f1],
                   names: ['P1', 'P2'], seed: opts.seed || 12345,
                   missionId: opts.missionId || null });
  const S = G.Battle.get();
  S.players[0].ap = 40; S.players[1].ap = 40;
  return G;
}

const find = (G, name) => G.Battle.get().units.find(u => u.name.indexOf(name) >= 0);
const abilIndex = (u, name) => (u.abilities || []).findIndex(a => a.name === name);

/* Put two units a set distance apart, in the open, both able to see. */
function face(G, a, b, apart) {
  a.x = 14; a.y = 3; a.reserve = false;
  b.x = 14 + (apart || 4); b.y = 3; b.reserve = false;
  G.Battle.emit();
}

function useAbility(G, u, name, arg) {
  const i = abilIndex(u, name);
  if (i < 0) { ok(false, name + ' exists on ' + u.name); return false; }
  G.Battle.get().control.player = u.owner;
  G.Battle.useAbility(u.id, i, arg);
  return true;
}

/* ------------------------------------------------------------------ ASTRA */

console.log('\n== Astra Militarum');
{
  const G = scene('astra', 'orks');
  const alfred = find(G, 'Alfred'), snitch = find(G, 'Snitcherz');

  /* GRAPPLING HOOK — "Use only if terrain is within 3". Move up to 5" in the
     direction of the terrain, ignoring height. Your opponent gains 1 AP." */
  const wall = G.Battle.get().board.terrain.find(t => t.blocks);
  alfred.x = wall.x + wall.w / 2;
  alfred.y = wall.y - 2.2;                     /* 2.2" from it, so it is legal */
  const beforeAp = G.Battle.get().players[1].ap;
  const beforeY = alfred.y, beforeLvl = G.Board.heightAt(G.Battle.get().board, alfred);
  useAbility(G, alfred, 'Grappling Hook');
  ok(Math.hypot(alfred.x - (wall.x + wall.w / 2), alfred.y - beforeY) > 0.5,
     'Grappling Hook actually moves Alfred',
     'moved ' + Math.abs(alfred.y - beforeY).toFixed(2) + '"');
  ok(G.Board.heightAt(G.Battle.get().board, alfred) > beforeLvl,
     'Grappling Hook ignores height and puts him up the terrain',
     'level ' + beforeLvl + ' → ' + G.Board.heightAt(G.Battle.get().board, alfred));
  ok(G.Battle.get().players[1].ap === beforeAp + 1,
     'Grappling Hook gives the opponent 1 AP');
}
{
  const G = scene('astra', 'orks');
  const alfred = find(G, 'Alfred'), fred = find(G, 'Fred'), snitch = find(G, 'Snitcherz');

  /* GRAPPLING HOOK with nothing near it must be refused, not silently wasted */
  alfred.x = 20; alfred.y = 2;
  let far = true;
  G.Battle.get().board.terrain.forEach(t => { if (G.Board.distToBox(t, alfred) <= 3) far = false; });
  if (far) {
    const acts = G.Battle.actionsFor(alfred.id);
    const hook = acts.find(a => a.name === 'Grappling Hook');
    ok(hook && !hook.ok, 'Grappling Hook is refused when no terrain is within 3"',
       hook ? 'offered as ok=' + hook.ok : 'not offered at all');
  }

  /* SMOKE BOMB — a token that costs 2 to hit through */
  const S = G.Battle.get();
  face(G, fred, snitch, 8);
  alfred.x = 18; alfred.y = 3;
  S.control.player = 0;
  const tokensBefore = S.tokens.length;
  useAbility(G, alfred, 'Smoke Bomb');
  ok(S.tokens.length === tokensBefore + 1, 'Smoke Bomb puts a token on the table');
  const tok = S.tokens[S.tokens.length - 1];
  if (tok) {
    /* drag it onto the line of fire and check the shot is harder */
    tok.x = (fred.x + snitch.x) / 2; tok.y = fred.y;
    const gun = fred.weapons[0];
    const mods = G.Battle.attackMods(fred, snitch, gun, 'ranged', {});
    ok(mods.hit <= -2, 'a shot through the smoke is 2 harder to hit',
       'hit modifier ' + mods.hit);
    const away = G.Battle.attackMods(fred, snitch, gun, 'ranged', {});
    tok.x = 2; tok.y = 25;
    const clear = G.Battle.attackMods(fred, snitch, gun, 'ranged', {});
    ok(clear.hit > mods.hit, 'and a shot nowhere near it is not');
  }
}
{
  const G = scene('astra', 'orks');
  const al = find(G, '"Al"'), snitch = find(G, 'Snitcherz');
  face(G, al, snitch, 1.6);

  /* KILL COUNT — +1 OC for a Bayonet kill, and nothing for anything else */
  const oc0 = al.oc;
  /* swing until it lands — one die is not a test of what happens after it */
  for (let n = 0; n < 40 && snitch.alive; n++) {
    snitch.wounds = 1;
    G.Battle.get().control.player = 0;
    G.Battle.doFight(al.id, snitch.id, 'Bayonet');
    if (G.Battle.get().pending) G.Battle.chooseReaction('none');
  }
  ok(!snitch.alive, 'Al can kill Snitcherz with the Bayonet');
  ok(al.oc === oc0 + 1, 'Kill Count raises his OC by exactly one',
     'OC ' + oc0 + ' → ' + al.oc);

  /* and not for a kill with anything else */
  const G2 = scene('astra', 'orks');
  const al2 = find(G2, '"Al"'), rik = find(G2, 'Riksnik');
  face(G2, al2, rik, 8);
  const oc2 = al2.oc;
  for (let n = 0; n < 40 && rik.alive; n++) {
    rik.wounds = 1;
    G2.Battle.get().control.player = 0;
    G2.Battle.doShoot(al2.id, rik.id, 'Lasgun');
    if (G2.Battle.get().pending) G2.Battle.chooseReaction('none');
  }
  ok(!rik.alive && al2.oc === oc2, 'and not for a kill with the Lasgun',
     'OC ' + oc2 + ' → ' + al2.oc);
}
{
  const G = scene('astra', 'orks');
  const al = find(G, '"Al"'), snitch = find(G, 'Snitcherz');
  face(G, al, snitch, 1.6);
  /* BAYONET CHARGE — +1 damage when he charges home with it */
  const bay = al.weapons.find(w => w.name === 'Bayonet');
  const plain = G.Battle.attackMods(al, snitch, bay, 'melee', {});
  const charged = G.Battle.attackMods(al, snitch, bay, 'melee', { fromCharge: true });
  ok(charged.damage === plain.damage + 1, 'Bayonet Charge is +1 damage on a charge',
     plain.damage + ' → ' + charged.damage);
}
{
  const G = scene('astra', 'orks');
  const alfred = find(G, 'Alfred'), snitch = find(G, 'Snitcherz');
  /* CLOAKED — enemies further than 6" have -1 to hit him */
  face(G, snitch, alfred, 9);
  const farMod = G.Battle.attackMods(snitch, alfred, snitch.weapons[0], 'ranged', {});
  face(G, snitch, alfred, 3);
  const nearMod = G.Battle.attackMods(snitch, alfred, snitch.weapons[0], 'ranged', {});
  ok(farMod.hit < nearMod.hit, 'Cloaked makes Alfred harder to hit from beyond 6"',
     'far ' + farMod.hit + ' vs near ' + nearMod.hit);
}
{
  const G = scene('astra', 'orks');
  const briant = find(G, 'Briant'), fred = find(G, 'Fred'), snitch = find(G, 'Snitcherz');
  /* IT'S MY JOB — +1 hit for the squad within 6", and no WITHDRAW */
  face(G, fred, snitch, 8);
  briant.x = fred.x + 1; briant.y = fred.y;
  const withBriant = G.Battle.attackMods(fred, snitch, fred.weapons[0], 'ranged', {});
  briant.x = 38; briant.y = 25;
  const without = G.Battle.attackMods(fred, snitch, fred.weapons[0], 'ranged', {});
  ok(withBriant.hit > without.hit, "It's My Job gives the squad +1 to hit within 6\"",
     'with ' + withBriant.hit + ' vs without ' + without.hit);
  briant.x = fred.x + 1; briant.y = fred.y;
  const blocked = G.Battle.blockedReactions(snitch, fred, snitch.weapons[0]);
  ok(!!blocked.withdraw, "It's My Job takes WITHDRAW off Fred's list");
}
{
  const G = scene('astra', 'orks');
  const nick = find(G, 'Nick'), snitch = find(G, 'Snitcherz');
  /* GRENADE — an RP reaction that leaves something behind to go off */
  face(G, snitch, nick, 6);
  const S = G.Battle.get();
  S.control.player = 1;
  G.Battle.doShoot(snitch.id, nick.id, null);
  const pend = S.pending;
  const gren = pend && pend.options.find(o => o.name === 'Grenade');
  ok(!!gren, 'Grenade is offered as a reaction when Nick is shot at');
  if (gren) {
    const before = S.tokens.length;
    G.Battle.chooseReaction(gren.id);
    ok(S.tokens.length > before, 'and taking it puts a grenade on the table');
  }
}

/* ------------------------------------------------------------ GREY KNIGHTS */

console.log('\n== Grey Knights');
{
  const G = scene('greyknights', 'orks');
  const S = G.Battle.get();
  const drusius = find(G, 'Drusius');
  ok(drusius.reserve === true, 'Drusius starts off the battlefield');
  const spots = G.Battle.arrivalSpots(drusius.id, abilIndex(drusius, 'Deep Strike'));
  ok(spots.length > 0, 'Deep Strike offers somewhere to arrive', spots.length + ' spots');
  const foe = S.units.find(u => u.owner === 1 && u.alive);
  ok(spots.every(p => G.Board.dist(p, foe) > 6),
     'and every one of them is more than 6" from an enemy');
  S.control.player = 0;
  useAbility(G, drusius, 'Deep Strike', spots[0]);
  ok(drusius.reserve === false, 'using it puts him on the table');
}
{
  const G = scene('greyknights', 'orks');
  const lucius = find(G, 'Lucius'), snitch = find(G, 'Snitcherz');
  face(G, lucius, snitch, 8);
  /* HEAVY GATLING — four dice if he has not moved */
  const psil = lucius.weapons.find(w => w.name === 'Psilencer');
  const still = G.Battle.diceFor(lucius, psil);
  ok(still.n === 4, 'Heavy Gatling rolls 4 dice while Lucius has not moved', 'n=' + still.n);
  lucius.movedTurn = G.Battle.get().turn.number;
  const moved = G.Battle.diceFor(lucius, psil);
  ok(moved.n === 1, 'and 1 once he has moved', 'n=' + moved.n);
}
{
  const G = scene('greyknights', 'orks');
  const S = G.Battle.get();
  const aurelius = find(G, 'Aurelius');
  /* PSYCHIC MASTERY, and the pool it pays into */
  /* WARP CHARGE first: the card says Start Phase, and any action opens a chain */
  const ap0 = S.players[0].ap, psy1 = S.cards[0].value;
  const powers = G.Battle.cardPowers(0);
  const wc = powers.find(p => p.name === 'Warp Charge');
  ok(!!wc && wc.ok, 'Warp Charge is buyable', wc ? wc.why || '' : 'missing');
  G.Battle.useCardPower(0, wc.index);
  ok(S.players[0].ap === ap0 + 2, 'Warp Charge gives 2 AP', ap0 + ' → ' + S.players[0].ap);
  ok(S.cards[0].value === psy1 - 3, 'and costs 3 PSY');

  const psy0 = S.cards[0].value;
  S.control.player = 0;
  useAbility(G, aurelius, 'Psychic Mastery');
  ok(S.cards[0].value === psy0 + 1, 'Psychic Mastery adds 1 PSY',
     psy0 + ' → ' + S.cards[0].value);
  ok(!G.Battle.cardPowers(0).some(p => p.ok),
     'and once the chain is open the card is shut');
}
{
  const G = scene('greyknights', 'orks');
  const drusius = find(G, 'Drusius'), snitch = find(G, 'Snitcherz');
  drusius.reserve = false;
  face(G, drusius, snitch, 8);
  /* UNESCAPABLE WRATH — no DIVE against the Purifying Flame */
  const flame = drusius.weapons.find(w => w.name === 'Purifying Flame');
  const bolter = drusius.weapons.find(w => w.name === 'Storm Bolter');
  ok(!!G.Battle.blockedReactions(drusius, snitch, flame).dive,
     'Unescapable Wrath takes DIVE away against the Purifying Flame');
  ok(!G.Battle.blockedReactions(drusius, snitch, bolter).dive,
     'but not against the Storm Bolter');
}

/* ------------------------------------------------------------------- ORKS */

console.log('\n== Orks');
{
  const G = scene('orks', 'astra');
  const snitch = find(G, 'Snitcherz'), fred = find(G, 'Fred');
  face(G, fred, snitch, 8);
  /* SMALL — always -1 to hit him */
  const mods = G.Battle.attackMods(fred, snitch, fred.weapons[0], 'ranged', {});
  const other = G.Battle.attackMods(fred, find(G, 'Blikker'), fred.weapons[0], 'ranged', {});
  ok(mods.hit < other.hit, 'Small makes Snitcherz harder to hit',
     'snitcherz ' + mods.hit + ' vs nob ' + other.hit);
}
{
  const G = scene('orks', 'astra');
  const snitch = find(G, 'Snitcherz');
  snitch.x = 20; snitch.y = 3;
  const was = { x: snitch.x, y: snitch.y };
  G.Battle.get().control.player = 0;
  useAbility(G, snitch, 'Unpredictable');
  ok(G.Board.dist(snitch, was) > 0.5, 'Unpredictable actually moves him',
     'moved ' + G.Board.dist(snitch, was).toFixed(2) + '"');
}
{
  const G = scene('orks', 'astra');
  const blikker = find(G, 'Blikker');
  const before = G.Battle.mine(0).map(u => ({ id: u.id, x: u.x, y: u.y }));
  G.Battle.get().control.player = 0;
  useAbility(G, blikker, 'WAAAAAGH');
  const movedCount = before.filter(function (b) {
    const u = G.Battle.unit(b.id);
    return G.Board.dist(u, b) > 0.4;
  }).length;
  ok(movedCount >= 2, 'WAAAAAGH moves the whole mob', movedCount + ' of ' + before.length + ' moved');
}
{
  const G = scene('orks', 'astra');
  const blikker = find(G, 'Blikker'), hunta = find(G, 'Da Hunta'), fred = find(G, 'Fred');
  face(G, hunta, fred, 8);
  blikker.x = hunta.x + 2; blikker.y = hunta.y;
  /* INTIMIDATING PRESENCE — +1 to wound for the mob within 6" */
  const near = G.Battle.attackMods(hunta, fred, hunta.weapons[0], 'ranged', {});
  blikker.x = 38; blikker.y = 25;
  const far = G.Battle.attackMods(hunta, fred, hunta.weapons[0], 'ranged', {});
  ok(near.wound > far.wound, 'Intimidating Presence is +1 to wound within 6"',
     'near ' + near.wound + ' vs far ' + far.wound);
}
{
  const G = scene('orks', 'astra');
  const hunta = find(G, 'Da Hunta');
  const marked = G.Battle.get().units.filter(u => (u.marks || []).length);
  ok(marked.length === 1 && marked[0].owner === 1,
     'Da Hunta marks an enemy before the first turn',
     marked.length ? marked[0].name : 'nobody');
  /* GUD AT HIS JOB — the Shoota hurts a MARKED unit more */
  if (marked.length) {
    face(G, hunta, marked[0], 8);
    const shoota = hunta.weapons.find(w => w.name === 'Shoota');
    const vsMarked = G.Battle.attackMods(hunta, marked[0], shoota, 'ranged', {});
    const other = G.Battle.mine(1).find(u => !(u.marks || []).length);
    face(G, hunta, other, 8);
    const vsOther = G.Battle.attackMods(hunta, other, shoota, 'ranged', {});
    ok(vsMarked.damage > vsOther.damage, 'Gud at His Job is +1 damage against the MARKED unit',
       'marked ' + vsMarked.damage + ' vs other ' + vsOther.damage);
  }
}
{
  const G = scene('orks', 'astra');
  const S = G.Battle.get();
  const hunta = find(G, 'Da Hunta'), fred = find(G, 'Fred');
  face(G, fred, hunta, 6);
  S.control.player = 1;
  G.Battle.doShoot(fred.id, hunta.id, null);
  const dont = S.pending && S.pending.options.find(o => o.name === "Don't ya Dare");
  ok(!!dont, "Don't ya Dare is offered when Da Hunta is shot at");
  if (dont) {
    G.Battle.chooseReaction(dont.id);
    ok((fred.marks || []).length > 0, 'and it marks whoever took the shot');
  }
}
{
  const G = scene('orks', 'astra');
  const S = G.Battle.get();
  const riksnik = find(G, 'Riksnik');
  riksnik.x = 20; riksnik.y = 3;
  G.Battle.mine(1).slice(0, 2).forEach(function (u, i) { u.x = 21 + i; u.y = 3; });
  const woundsBefore = S.units.filter(u => u.alive).reduce((n, u) => n + u.wounds, 0);
  S.control.player = 0;
  useAbility(G, riksnik, "Spin an' spray");
  const woundsAfter = S.units.filter(u => u.alive).reduce((n, u) => n + u.wounds, 0);
  ok(woundsAfter < woundsBefore, "Spin an' spray actually hurts what is nearby",
     woundsBefore + ' → ' + woundsAfter + ' wounds on the table');
}
{
  const G = scene('orks', 'astra');
  const S = G.Battle.get();
  const mika = find(G, 'Mikaaaaghhh'), fred = find(G, 'Fred');
  face(G, fred, mika, 8);
  S.control.player = 1;
  G.Battle.doShoot(fred.id, mika.id, null);
  const kd = S.pending && S.pending.options.find(o => o.name === 'Kwik Dakka');
  ok(!!kd, 'Kwik Dakka is offered when Mikaaaaghhh is shot at');
  const gif = S.pending && S.pending.options.find(o => o.name === 'Get In Front of Me');
  ok(!!gif, 'and so is Get In Front of Me');
  if (gif) {
    const mates = G.Battle.mine(0).filter(u => u.id !== mika.id);
    mates.forEach(function (u, i) { u.x = fred.x + 4 + i * 0.1; u.y = fred.y; });
    G.Battle.chooseReaction(gif.id);
    ok(S.pending && S.pending.kind === 'redirect',
       'taking it asks which of the mob steps into the shot',
       S.pending ? S.pending.kind : 'nothing pending');
  }
}

/* --------------------------------------------------------------- the score */

console.log('\n== summary\n' + (checks - failed) + '/' + checks + ' checks passed');
if (fails.length) {
  console.log('\nnot working:');
  fails.forEach(f => console.log('  · ' + f));
}
process.exit(failed ? 1 : 0);

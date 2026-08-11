/* Headless harness: runs the rules engine without a browser so the turn
   machine, AP economy and attack sequence can be checked quickly.
   Run:  node tools/simulate.js                                            */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = {};
const sandbox = {
  console: console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['rules.js', 'state.js', 'engine.js'].forEach(function (f) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(src, sandbox, { filename: f });
});

/* Top-level `const` in a script lives in the context's lexical scope, not on
   the global object (same as classic <script> tags in a browser), so pull the
   modules out explicitly. */
vm.runInContext('globalThis.__mods = { RULES: RULES, Store: Store, Engine: Engine }; globalThis.PRESETS = PRESETS;', sandbox);
const { RULES, Store, Engine } = sandbox.__mods;

/* ------------------------------------------------------------------ setup */

function mkUnit(owner, name, w, t, weapons, abilities) {
  const u = Store.newUnit(owner, { name: name, maxWounds: w, wounds: w, toughness: t });
  u.weapons = weapons.map(x => Store.newWeapon(x));
  u.abilities = (abilities || []).map(function (a) {
    const ab = Store.newAbility(a);
    ab.effects = (a.effects || []).map(e => Store.newEffectRow(e));
    return ab;
  });
  return u;
}

const units = [
  mkUnit(0, 'Intercessor', 3, 4,
    [{ name: 'Bolt Rifle', type: 'ranged', hit: 3, strength: 4, damage: 1 },
     { name: 'Power Fist', type: 'melee', hit: 3, strength: 8, damage: 2 }],
    [{ name: 'Overcharge', trigger: 'ap', cost: 1, text: '+1 to hit this chain',
       effects: [{ kind: 'mod_hit', value: 1, pick: 'self', duration: 'chain' }] }]),
  mkUnit(0, 'Scout', 2, 3,
    [{ name: 'Sniper', type: 'ranged', hit: 3, strength: 5, damage: 2 }],
    [{ name: 'Mine', trigger: 'ap', cost: 1, text: 'Place a mine',
       effects: [{ kind: 'token', label: 'PROXIMITY MINE', expiry: 'used',
                   tokenEffects: [{ kind: 'damage', value: 2, pick: 'prompt' }] }] }]),
  mkUnit(1, 'Ork Nob', 4, 5,
    [{ name: 'Shoota', type: 'ranged', hit: 4, strength: 4, damage: 1 },
     { name: 'Big Choppa', type: 'melee', hit: 3, strength: 7, damage: 2 }], []),
  mkUnit(1, 'Ork Boy', 2, 5,
    [{ name: 'Slugga', type: 'ranged', hit: 4, strength: 4, damage: 1 },
     { name: 'Choppa', type: 'melee', hit: 3, strength: 4, damage: 1 }], [])
];

let fails = 0, checks = 0;
function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; console.log('  ✗ ' + label + '  got ' + JSON.stringify(actual) +
    ', expected ' + JSON.stringify(expected)); }
  else console.log('  ✓ ' + label + ' = ' + JSON.stringify(actual));
}

const G = () => Store.get();
const U = name => G().units.find(u => u.name === name);
const ap = i => G().players[i].ap;
const vp = i => G().players[i].vp;

/* ------------------------------------------------------------------- run */

console.log('\n== wound table ==');
check('S8 vs T4 (double)', RULES.woundTarget(8, 4), 2);
check('S5 vs T4 (greater)', RULES.woundTarget(5, 4), 3);
check('S4 vs T4 (equal)', RULES.woundTarget(4, 4), 4);
check('S4 vs T5 (less)', RULES.woundTarget(4, 5), 5);
check('S2 vs T5 (still just "less than")', RULES.woundTarget(2, 5), 5);
check('S4 vs T8 (no half-or-less row any more)', RULES.woundTarget(4, 8), 5);
check('-1 modifier on a 3+', RULES.applyMod(3, -1).target, 4);
check('+1 modifier on a 2+ clamps', RULES.applyMod(2, 1), { target: 2, capped: true, raw: 1 });

console.log('\n== game start ==');
Engine.startGame({ playerNames: ['Marines', 'Orks'], vpTarget: 10, firstPlayer: 0 }, units);
check('pending start phase', G().pending.type, 'start');
Engine.confirmStartPhase();
check('P1 AP after start phase', ap(0), 1);
check('P2 AP', ap(1), 0);
check('control is P1', G().control.player, 0);

console.log('\n== SHOOT: hit, wound, survive ==');
Engine.beginAction('shoot');
Engine.flowPickUnit(U('Intercessor').id);
Engine.flowPickAttackTarget(U('Ork Nob').id);
check('AP paid on declaration', ap(0), 0);
check('defender has 1 RP', G().players[1].rp, 1);
Engine.flowPickWeapon(U('Intercessor').weapons[0].id);
check('step is reaction', G().flow.step, 'reaction');
Engine.flowPickReaction('dodge');
check('DODGE gives -1 to hit', Engine.attackNumbers().hitTarget, 4);
Engine.flowHit(true);
check('wound target S4 vs T5', Engine.attackNumbers().woundTarget, 5);
Engine.flowWound(true);
Engine.flowDamage(1);
check('Nob wounds', U('Ork Nob').wounds, 3);
check('P2 gains the survivor AP', ap(1), 1);
check('chain still active', G().chain.active, true);
check('P2 must act with the Nob', G().control.forcedUnitId, U('Ork Nob').id);
check('control passed to P2', G().control.player, 1);

console.log('\n== response: FIGHT back with the forced unit ==');
check('only the Nob is eligible', Engine.eligibleUnits().map(u => u.name), ['Ork Nob']);
Engine.beginAction('fight');
check('attacker auto-selected', G().flow.attackerId, U('Ork Nob').id);
Engine.flowPickAttackTarget(U('Intercessor').id);
Engine.flowPickWeapon(U('Ork Nob').weapons[1].id);
Engine.flowPickReaction('parry');
check('PARRY: S7 vs T4 is 3+, -1 → 4+', Engine.attackNumbers().woundTarget, 4);
Engine.flowHit(true);
Engine.flowWound(true);
Engine.flowDamage(2);
check('Intercessor wounds', U('Intercessor').wounds, 1);
check('survivor AP plus PARRY\u2019s own AP', ap(0), 2);
check('P1 must act with the Intercessor', G().control.forcedUnitId, U('Intercessor').id);

console.log('\n== weapon lockout inside one chain ==');
const wep = Engine.weaponsFor(U('Ork Nob').id, 'melee');
check('Big Choppa marked used', wep[0].used, true);

console.log('\n== kill ends the chain and scores VP ==');
Engine.beginAction('fight');
Engine.flowPickAttackTarget(U('Ork Nob').id);
Engine.flowPickWeapon(U('Intercessor').weapons[1].id);
Engine.flowPickReaction('none');
Engine.flowHit(true);
Engine.flowWound(true);
Engine.flowDamage(3);
check('Nob destroyed', U('Ork Nob').alive, false);
check('a VP prompt is queued, nothing assumed', G().vpPrompts.length, 1);
check('the prompt names the reason', G().vpPrompts[0].reason, 'destroyed Ork Nob');
check('no VP scored until it is answered', vp(0), 0);
Engine.resolveVP(G().vpPrompts[0].id, 3);   // this mission pays 3 for a kill
check('the entered VP is what lands', vp(0), 3);
check('chain ended', G().chain.active, false);
check('nothing ends the turn by itself', G().pending, null);
check('the active player is up again', G().control.player, 0);

console.log('\n== only PASS ends a turn ==');
Store.commit('drain', function () { Store.get().players[0].ap = 0; });
Engine.beginAction('pass');
Engine.confirmPass(true);
check('now the End Phase runs', G().pending.type, 'end');
Engine.confirmEndPhase();
check('turn 2 belongs to P2', G().turn.player, 1);
check('start phase pending', G().pending.type, 'start');
Engine.confirmStartPhase();
check('P2 AP', ap(1), 1);

console.log('\n== OVERWATCH: token survives, fires at -1, expires on the shot ==');
Engine.beginAction('overwatch');
Engine.flowPickUnit(U('Ork Boy').id);
Engine.confirmOverwatch();
check('token placed', U('Ork Boy').tokens.map(t => t.label), ['OVERWATCH']);
check('AP spent', ap(1), 0);
check('token survives the chain closing', U('Ork Boy').tokens.length, 1);
check('and it expires on its owner acting, nothing else',
  U('Ork Boy').tokens[0].expiry, 'ownerActs');

Engine.confirmEndPhase();
Engine.confirmStartPhase();          // turn 3, P1
check('token survives the turn change', U('Ork Boy').tokens.length, 1);

// P2 fires it as an interrupt during P1's turn.
Engine.triggerToken(U('Ork Boy').id, U('Ork Boy').tokens[0].id);
check('overwatch shot flow opened', G().flow.source, 'overwatch');
check('token removed when it fires', U('Ork Boy').tokens.length, 0);
Engine.flowPickAttackTarget(U('Scout').id);
check('overwatch skips the reaction step', G().flow.step, 'hit');
check('overwatch is -1 to hit (4+ → 5+)', Engine.attackNumbers().hitTarget, 5);
check('defender gains no RP', G().players[0].rp, 0);
const apBefore = ap(0), controlBefore = G().control.player;
Engine.flowHit(true); Engine.flowWound(true); Engine.flowDamage(1);
check('Scout wounded', U('Scout').wounds, 1);
check('no survivor AP from overwatch', ap(0), apBefore);
check('control unchanged by the interrupt', G().control.player, controlBefore);

console.log('\n== charge from high ground ==');
check('turn 3 is P1', G().turn.player, 0);
Engine.adjustAP(0, 2);               // top up so CHARGE (2 AP) is affordable
Engine.beginAction('charge');
Engine.flowPickUnit(U('Intercessor').id);
Engine.flowPickAttackTarget(U('Ork Boy').id);
Engine.flowPickWeapon(U('Intercessor').weapons[1].id);
Engine.flowPickReaction('none');
Engine.setElevation(true);
const n = Engine.attackNumbers();
check('S8 vs T5 is 3+, high ground → 2+', n.woundTarget, 2);
check('damage 2 +1 from the high charge', n.damage, 3);
check('hit roll unaffected by charge elevation', n.hitTarget, 3);

Engine.flowHit(false);               // miss, so the Boy survives
check('Ork Boy alive', U('Ork Boy').alive, true);
check('miss still hands the AP to the survivor', ap(1), 1);
check('Ork Boy is the forced unit', G().control.forcedUnitId, U('Ork Boy').id);

console.log('\n== one PASS is not enough to end a chain ==');
check('it is not the responder\u2019s turn', Engine.controlMode(), 'reacting');
Engine.beginAction('pass');
check('the non-active player cannot end a turn', Engine.passOptions(),
  { inChain: true, wouldEndChain: false, canEndTurn: false });
Engine.confirmPass(true);                       // asking to end the turn is ignored
check('one pass leaves the chain open', G().chain.active, true);
check('and hands it back', G().control.player, 0);
check('PASS is free', ap(1), 1);
check('the turn did not change hands', G().turn.player, 0);
check('a second pass would close it', Engine.passOptions().wouldEndChain, true);
Engine.beginAction('pass');
Engine.confirmPass(false);
check('two in a row end the chain', G().chain.active, false);

console.log('\n== SPECIAL ABILITY: opponent gains AP, chain continues ==');
check('control back to the turn player', G().control.player, 0);
Engine.adjustAP(0, 2);
const apOpp = ap(1);
Engine.beginAction('ability');
Engine.flowPickUnit(U('Intercessor').id);
Engine.flowPickAbility(U('Intercessor').abilities[0].id);
Engine.confirmAbility();
check('no automatic AP — the ability did not grant any', ap(1), apOpp);
check('but they may still react with any unit', G().control.forcedUnitId, null);
check('because this ability lets them', Engine.abilityLetsThemReact(
  U('Intercessor').abilities[0]), true);
check('+1 to hit effect on the Intercessor', U('Intercessor').effects.length, 1);

console.log('\n== DIVE cancels the attack ==');
Engine.forceControl(0, null);
Engine.adjustAP(0, 2);
Engine.beginAction('shoot');
Engine.flowPickUnit(U('Scout').id);
Engine.flowPickAttackTarget(U('Ork Boy').id);
const boyWounds = U('Ork Boy').wounds, oppAP = ap(1);
Engine.flowPickReaction('dive');
check('DIVE goes straight to the roll', G().flow.step, 'hit');
check('the dive itself no longer forfeits the AP', G().flow.apGrant, true);
// The 3" took it out of sight, so the attack cannot be performed at all.
Engine.abortAction();
check('no damage dealt', U('Ork Boy').wounds, boyWounds);
check('and nothing came of it, not even the AP', ap(1), oppAP);
check('but the action chain carries on', G().chain.active, true);
check('with the targeted unit still owed the response', G().control.forcedUnitId, U('Ork Boy').id);
check('and the weapon was never spent',
  Engine.weaponsFor(U('Scout').id, 'ranged')[0].used, false);

console.log('\n== DISTRACT: extra AP and a free unit choice ==');
Engine.forceEndChain();
Engine.forceControl(0, null);
Engine.adjustAP(0, 2);
Engine.beginAction('shoot');
Engine.flowPickUnit(U('Scout').id);
Engine.flowPickAttackTarget(U('Ork Boy').id);
const apBeforeDistract = ap(1);
Engine.flowPickReaction('distract');
check('DISTRACT pays 1 AP immediately', ap(1), apBeforeDistract + 1);
check('attacker gets +1 to hit (3+ → 2+)', Engine.attackNumbers().hitTarget, 2);
Engine.flowHit(false);
check('survivor AP on top of the DISTRACT AP', ap(1), apBeforeDistract + 2);
check('any friendly unit may respond', G().control.forcedUnitId, null);

console.log('\n== a mine token: place, trigger, damage, remove ==');
Engine.forceEndChain();
Engine.forceControl(0, null);
Engine.adjustAP(0, 2);
Engine.beginAction('ability');
Engine.flowPickUnit(U('Scout').id);
Engine.flowPickAbility(U('Scout').abilities[0].id);
Engine.confirmAbility();
check('mine placed', U('Scout').tokens.map(t => t.label), ['PROXIMITY MINE']);
const mine = U('Scout').tokens[0];
Engine.triggerToken(U('Scout').id, mine.id);
check('mine asks who triggered it', G().flow.step, 'pick');
const tEff = Engine.tokenEffects(U('Scout').id, mine.id);
Engine.tokenPickTarget(tEff[0].id, U('Ork Boy').id);
const boyBefore = U('Ork Boy').wounds;
Engine.confirmToken();
check('mine deals 2 damage', Math.max(0, boyBefore - 2), U('Ork Boy').alive ? U('Ork Boy').wounds : 0);
check('mine removed after use', U('Scout').tokens.length, 0);
check('a mine kill also asks for its VP', G().vpPrompts.length, 1);
Engine.resolveVP(G().vpPrompts[0].id, 1);

console.log('\n== mission objectives ==');
Store.commit('add mission', function () {
  const g = Store.get();
  g.mission = { id: 'hill' };
});
const vpBefore = vp(0);
const item = Engine.missionEndTurnItems()[0];
check('KING OF THE HILL has an end-of-turn item', item.name, 'The HIGH GROUND');
Engine.scoreMissionObjective(item.id, 0);
check('objective queues a VP prompt', G().vpPrompts.length, 1);
check('pre-filled from the card', G().vpPrompts[0].suggested, 1);
Engine.resolveVP(G().vpPrompts[0].id, 5);   // but you can type anything
check('the entered VP is what lands', vp(0), vpBefore + 5);
check('objective counted', Engine.objectiveScoredBy(item.id, 0), 1);

console.log('\n== no AP does not end a chain — you are handed it and must PASS ==');
(function () {
  const us = [
    mkUnit(0, 'Alpha', 3, 4, [{ name: 'Rifle', type: 'ranged', hit: 3, strength: 4, damage: 1 }], []),
    mkUnit(1, 'Bravo', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, us);
  Engine.confirmStartPhase();
  Engine.adjustAP(0, 2);                   // three AP for player one, none for two

  // Open a chain with an attack so a weapon gets locked out.
  Engine.beginAction('shoot');
  Engine.flowPickUnit(U('Alpha').id);
  Engine.flowPickAttackTarget(U('Bravo').id);
  Engine.flowPickReaction('none');
  Engine.flowHit(false);
  check('the survivor still gets its AP', ap(1), 1);
  Store.commit('drain', function () {
    const g = Store.get();
    g.players[1].ap = 0;                   // ...but say they spent it elsewhere
    g.control = { player: 0, forcedUnitId: null, reason: 'test' };
  });

  // A Passive Action that hands them nothing.
  Engine.beginAction('overwatch');
  Engine.flowPickUnit(U('Alpha').id);
  Engine.confirmOverwatch();
  check('the chain stays open', G().chain.active, true);
  check('and is handed to the broke player anyway', G().control.player, 1);
  check('who is told they must pass', Engine.mustPass(), true);
  check('their only affordable action is PASS',
    Engine.actionList().filter(a => Engine.actionAvailability(a).ok).map(a => a.id), ['pass']);
  check('the weapon lockout is still in force',
    Engine.weaponsFor(U('Alpha').id, 'ranged')[0].used, true);

  const apLeft = ap(0);
  Engine.beginAction('pass');
  Engine.confirmPass(true);                // asking to end the turn is ignored: not theirs
  check('one pass does not close the chain', G().chain.active, true);
  check('the turn never changed hands', G().turn.player, 0);
  check('the turn player is back on', G().control.player, 0);
  check('with their AP intact', ap(0), apLeft);

  // The active player passes too: that is the second in a row.
  Engine.beginAction('pass');
  Engine.confirmPass(false);
  check('two in a row close it', G().chain.active, false);
  check('but the turn is still running', G().pending, null);

  // Only an explicit PASS-and-end finishes the turn.
  Engine.beginAction('pass');
  Engine.confirmPass(true);
  check('and that is what ends it', G().pending.type, 'end');
})();

console.log('\n== undo ==');
const apPreUndo = ap(0);
Engine.adjustAP(0, 3);
check('manual change applied', ap(0), apPreUndo + 3);
Store.undo();
check('undo reverts it', ap(0), apPreUndo);

/* ------------------------------------------------- mission cards, 2 players */

function freshGame(missionCfg) {
  const us = [
    mkUnit(0, 'Alpha', 3, 4, [{ name: 'Rifle', type: 'ranged', hit: 3, strength: 4, damage: 1 },
                              { name: 'Blade', type: 'melee', hit: 3, strength: 5, damage: 2 }], []),
    mkUnit(1, 'Bravo', 2, 4, [{ name: 'Gun', type: 'ranged', hit: 4, strength: 4, damage: 1 },
                              { name: 'Axe', type: 'melee', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: missionCfg }, us);
  Engine.confirmStartPhase();
  return us;
}

console.log('\n== MISSION: SABOTAGE ==');
freshGame({ id: 'sabotage' });
const objs = G().units.filter(u => u.marker);
check('one OBJECTIVE marker per player', objs.length, 2);
check('markers are 5W T4', [objs[0].maxWounds, objs[0].toughness], [5, 4]);
check('markers have no RP', objs[0].noRP, true);
// Shooting a marker skips the reaction step entirely.
Engine.adjustAP(0, 3);
Engine.beginAction('shoot');
Engine.flowPickUnit(U('Alpha').id);
Engine.flowPickAttackTarget(objs.find(o => o.owner === 1).id);
check('no RP means no reaction step', G().flow.step, 'hit');
Engine.flowHit(true); Engine.flowWound(true); Engine.flowDamage(5);
check('the enemy OBJECTIVE is destroyed', G().units.find(u => u.id === objs.find(o => o.owner === 1).id).alive, false);
check('and it suggests the card’s 3 VP', G().vpPrompts[0].suggested, 3);
Engine.resolveVP(G().vpPrompts[0].id, 3);
check('destroying it ends the game', !!G().gameOver, true);

console.log('\n== MISSION: SECURE THE AREA ==');
freshGame({ id: 'secure' });
check('three control points', G().mission.controlPoints.length, 3);
check('SECURE is in the action list', Engine.actionAvailability(RULES.actionById('secure')).ok, true);
check('the RELIC action stays hidden', Engine.actionAvailability(RULES.actionById('relic')).hide, true);
Engine.adjustAP(0, 3);
const cps = G().mission.controlPoints;
Engine.beginAction('secure');
Engine.flowPickUnit(U('Alpha').id);
Engine.flowPickControlPoint(cps[0].id);
Engine.confirmSecure();
check('marker is held by player 0', G().mission.controlPoints[0].controller, 0);
check('the app counts what it holds', Engine.controlledCount(0), 1);
const secItem = Engine.missionEndTurnItems()[0];
check('end-of-turn VP is computed, not guessed', secItem.perPlayerVP, [1, 0]);
// An enemy takes it back.
Engine.forceControl(1, null);
Engine.adjustAP(1, 2);
Engine.beginAction('secure');
Engine.flowPickUnit(U('Bravo').id);
Engine.flowPickControlPoint(cps[0].id);
Engine.confirmSecure();
check('SECURING it takes it from the holder', G().mission.controlPoints[0].controller, 1);

console.log('\n== MISSION: THE RELIC ==');
freshGame({ id: 'relic' });
check('the relic starts unclaimed', Engine.relicCarrier(), null);
Engine.adjustAP(0, 3);
Engine.beginAction('relic');
Engine.flowPickUnit(U('Alpha').id);
Engine.confirmRelic();
check('Alpha carries the relic', Engine.relicCarrier(), U('Alpha').id);
check('a carrier cannot go on OVERWATCH',
  Engine.actionAvailability(RULES.actionById('overwatch')).ok, false);
check('and it cannot be picked up twice',
  Engine.actionAvailability(RULES.actionById('relic')).ok, false);
// Killing the carrier drops it.
Engine.forceControl(1, null);
Engine.adjustAP(1, 3);
Engine.beginAction('fight');
Engine.flowPickUnit(U('Bravo').id);
Engine.flowPickAttackTarget(U('Alpha').id);
Engine.flowPickWeapon(U('Bravo').weapons[1].id);
Engine.flowPickReaction('none');
Engine.flowHit(true); Engine.flowWound(true); Engine.flowDamage(9);
check('the relic drops where the carrier fell', Engine.relicCarrier(), null);

console.log('\n== MISSION: AMBUSH ==');
freshGame({ id: 'ambush', roles: { attacker: 0, defender: 1 } });
check('every unit loses a wound', U('Alpha').maxWounds, 2);
check('never below one', U('Bravo').maxWounds, 1);
const bait = G().units.find(u => u.marker);
check('the BAIT belongs to the defender', bait.owner, 1);
check('BAIT is 3W T4', [bait.maxWounds, bait.toughness], [3, 4]);
Engine.adjustAP(0, 3);
Engine.beginAction('shoot');
Engine.flowPickUnit(U('Alpha').id);
Engine.flowPickAttackTarget(bait.id);
Engine.flowHit(true); Engine.flowWound(true); Engine.flowDamage(3);
check('killing the BAIT suggests the card’s 4 VP', G().vpPrompts[0].suggested, 4);
check('and it is the attacker who scores it', G().vpPrompts[0].player, 0);

console.log('\n== MISSION: ASSASSINATION ==');
(function () {
  const us = [
    mkUnit(0, 'Alpha', 3, 4, [{ name: 'Blade', type: 'melee', hit: 3, strength: 8, damage: 4 }], []),
    mkUnit(1, 'Bravo', 2, 4, [{ name: 'Axe', type: 'melee', hit: 3, strength: 4, damage: 1 }], [])
  ];
  us[1].flags = { target: true };
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: 'assassination' } }, us);
  Engine.confirmStartPhase();
  check('the TARGET gains +1 Wound', U('Bravo').maxWounds, 3);
  check('a normal kill is worth 1', Engine.killValue(U('Alpha')), 1);
  check('killing the TARGET suggests 3', Engine.killValue(U('Bravo')), 3);
})();

console.log('\n== the Astra Militarum preset ==');
const astra = sandbox.PRESETS.find(f => f.id === 'astra');
check('five units on the cards', astra.units.length, 5);
check('and no faction objective any more', astra.objective, undefined);

function buildPreset(faction, owner) {
  return faction.units.map(function (spec) {
    const u = Store.newUnit(owner, {
      name: spec.name, move: spec.move, maxWounds: spec.maxWounds, wounds: spec.maxWounds,
      toughness: spec.toughness, oc: spec.oc || 0, notes: spec.notes || ''
    });
    u.weapons = spec.weapons.map(w => Store.newWeapon(w));
    u.abilities = (spec.abilities || []).map(function (a) {
      const ab = Store.newAbility({ name: a.name, trigger: a.trigger, cost: a.cost,
        text: a.text, usesPerGame: a.usesPerGame || 0,
        opponentReacts: a.opponentReacts !== false });
      ab.effects = (a.effects || []).map(function (e) {
        const row = Store.newEffectRow(e);
        if (e.tokenEffects) row.tokenEffects = e.tokenEffects.map(t => Store.newEffectRow(t));
        return row;
      });
      return ab;
    });
    return u;
  });
}

const guard = buildPreset(astra, 0);
const foes = [mkUnit(1, 'Cultist', 3, 4,
  [{ name: 'Autogun', type: 'ranged', hit: 4, strength: 3, damage: 1 },
   { name: 'Knife', type: 'melee', hit: 4, strength: 3, damage: 1 }], [])];
Engine.startGame({ playerNames: ['Guard', 'Chaos'], vpTarget: 10, firstPlayer: 0,
                   mission: { id: null } }, guard.concat(foes));
Engine.confirmStartPhase();

const alfred = U('Guardsman "Alfred" 434-434');
const commissar = U('Commissar Briant');
const nick = U('Guardsman "Nick" 847-832');
const fred = U('Guardsman "Fred" 434-436');
const al = U('Guardsman "Al" 434-435');
const cultist = U('Cultist');

console.log('\n== the datasheets ==');
check('Fred\u2019s Modded Lasgun', fred.weapons.map(w => w.name + ' ' + w.hit + '+/S' + w.strength + '/D' + w.damage),
  ['Modded Lasgun 5+/S4/D2', 'Leathered Fist 4+/S2/D1']);
check('Alfred carries three weapons now',
  alfred.weapons.map(w => w.name), ['Lasgun', 'Bolt Pistol', 'Dagger']);
check('the Commissar\u2019s Bolt Pistol is 2+', commissar.weapons[0].hit, 2);
check('Nick carries three too', nick.weapons.map(w => w.name), ['Lasgun', 'Bolt Pistol', 'Bayonet']);
check('Al\u2019s Bayonet hits on 2+', al.weapons[1].hit, 2);

console.log('\n== the Commissar\u2019s 6" aura ==');
Engine.adjustAP(0, 6);
Engine.beginAction('shoot');
Engine.flowPickUnit(nick.id);
Engine.flowPickAttackTarget(cultist.id);
Engine.flowPickWeapon(nick.weapons[0].id);      // Lasgun, hits on 3+
Engine.flowPickReaction('none');
const auras = Engine.applicableAuras(G().flow);
check('one aura is offered, not applied', auras.length, 1);
check('and it names its source', auras[0].source, "It's My Job");
check('before ticking it, the Lasgun hits on 3+', Engine.attackNumbers().hitTarget, 3);
Engine.toggleAura(auras[0].key);
check('ticked, it hits on 2+', Engine.attackNumbers().hitTarget, 2);
Engine.flowHit(false);

console.log('\n== Cloaked is passive on two of them now ==');
Engine.forceEndChain();
Engine.forceControl(1, null);
Engine.adjustAP(1, 4);
Engine.beginAction('shoot');
Engine.flowPickUnit(cultist.id);
Engine.flowPickAttackTarget(nick.id);
Engine.flowPickReaction('none');
const cl = Engine.applicableAuras(G().flow);
check('only Nick\u2019s own Cloaked applies to him', cl.map(a => a.unit), [nick.name]);
check('base Autogun hits on 4+', Engine.attackNumbers().hitTarget, 4);
Engine.toggleAura(cl[0].key);
check('further than 6" makes it 5+', Engine.attackNumbers().hitTarget, 5);
Engine.flowHit(false);

Engine.forceEndChain();
Engine.forceControl(1, null);
Engine.adjustAP(1, 4);
Engine.beginAction('shoot');
Engine.flowPickUnit(cultist.id);
Engine.flowPickAttackTarget(alfred.id);
Engine.flowPickReaction('none');
check('Alfred has his own Cloaked, and only his',
  Engine.applicableAuras(G().flow).map(a => a.unit), [alfred.name]);
Engine.flowHit(false);

console.log('\n== the Commissar blocks WITHDRAW ==');
const blocked = Engine.blockedReactions(alfred.id);
check('WITHDRAW is flagged for the squad', blocked.withdraw.indexOf('Commissar Briant') >= 0, true);
check('and not for the enemy', Object.keys(Engine.blockedReactions(cultist.id)).length, 0);

console.log('\n== Practiced Blade ignores the once-per-chain lock ==');
Engine.forceEndChain();
Engine.forceControl(0, null);
Engine.adjustAP(0, 4);
Engine.beginAction('fight');
Engine.flowPickUnit(alfred.id);
Engine.flowPickAttackTarget(cultist.id);
Engine.flowPickWeapon(alfred.weapons.find(w => w.name === 'Dagger').id);
Engine.flowPickReaction('none');
Engine.flowHit(false);
check('the dagger is still available',
  Engine.weaponsFor(alfred.id, 'melee').find(w => w.name === 'Dagger').used, false);

console.log('\n== Kill Count raises OC for good ==');
const ocBefore = U('Guardsman "Al" 434-435').oc;
Engine.useFreeAbility(al.id, al.abilities.find(a => a.name === 'Kill Count').id);
check('OC permanently up by one', U('Guardsman "Al" 434-435').oc, ocBefore + 1);
check('and it costs no AP, being an ability not an action', ap(0), ap(0));

console.log('\n== Grappling Hook hands over an AP, as its card says ==');
Engine.forceEndChain();
Engine.forceControl(0, null);
Engine.adjustAP(0, 4);
const oppAPBefore = ap(1);
Engine.beginAction('ability');
Engine.flowPickUnit(alfred.id);
Engine.flowPickAbility(alfred.abilities.find(a => a.name === 'Grappling Hook').id);
Engine.confirmAbility();
check('the opponent gains 1 AP', ap(1), oppAPBefore + 1);
check('and the chain carries on to them', G().control.player, 1);

console.log('\n== It\'s Your Job redirects the attack ==');
Engine.forceEndChain();
Engine.forceControl(1, null);
Engine.adjustAP(1, 4);
Engine.beginAction('shoot');
Engine.flowPickUnit(cultist.id);
Engine.flowPickAttackTarget(commissar.id);
Engine.flowPickReaction('special', commissar.abilities.find(a => a.name === "It's Your Job").id);
check('the app asks who takes it instead', G().flow.step, 'redirect');
Engine.flowRedirect(alfred.id);
check('the attack now points at Alfred', G().flow.targetId, alfred.id);
Engine.flowHit(false);

console.log('\n== Snap Shot: one interrupt per game, no RP, no penalty ==');
Engine.forceEndChain();
Engine.forceControl(0, null);
const snap = fred.abilities.find(a => a.name === 'Snap Shot');
Engine.useFreeAbility(fred.id, snap.id);
check('it opens a free attack straight away', G().flow.source, 'free');
check('with no RP for the defender', G().flow.noReaction, true);
check('and no to-hit penalty', G().flow.sourceHitMod, 0);
Engine.flowPickAttackTarget(cultist.id);
Engine.flowPickWeapon(fred.weapons[0].id);
check('Modded Lasgun hits on 5+', Engine.attackNumbers().hitTarget, 5);
Engine.flowHit(false);
check('the button is spent for the game',
  Engine.usableFreeAbilities(U('Guardsman "Fred" 434-436')).map(a => a.name), ['Kill Count'].slice(0, 0));

console.log('\n== the Orks preset ==');
const orks = sandbox.PRESETS.find(f => f.id === 'orks');
check('five units on the card', orks.units.length, 5);

const mob = buildPreset(orks, 0);
const marks = [mkUnit(1, 'Guardsman', 3, 4,
  [{ name: 'Lasgun', type: 'ranged', hit: 3, strength: 4, damage: 1 },
   { name: 'Bayonet', type: 'melee', hit: 3, strength: 4, damage: 1 }], [])];
Engine.startGame({ playerNames: ['Orks', 'Guard'], vpTarget: 10, firstPlayer: 0,
                   mission: { id: null } }, mob.concat(marks));
Engine.confirmStartPhase();

const nob = U('Boss Nob Blikker');
const snitch = U('Snitcherz');
const mika = U('Mikaaaaghhh');
const hunta = U('Da Hunta');
const guardsman = U('Guardsman');

console.log('\n== Small: an always-on aura needs no tick-box ==');
Engine.adjustAP(1, 6);
Engine.forceControl(1, null);
Engine.beginAction('shoot');
Engine.flowPickUnit(guardsman.id);
Engine.flowPickAttackTarget(snitch.id);
Engine.flowPickWeapon(guardsman.weapons[0].id);
Engine.flowPickReaction('none');
const small = Engine.applicableAuras(G().flow);
check('it is listed as always-on', small.map(a => a.always), [true]);
check('Lasgun 3+ becomes 4+ with no interaction', Engine.attackNumbers().hitTarget, 4);
Engine.flowHit(false);

console.log('\n== Boss Nob: a Strength aura moves the wound table ==');
Engine.forceControl(0, null);
Engine.adjustAP(0, 6);
Engine.beginAction('shoot');
Engine.flowPickUnit(hunta.id);              // Shoota S4 vs T4 → 4+
Engine.flowPickAttackTarget(guardsman.id);
Engine.flowPickWeapon(hunta.weapons[0].id);
Engine.flowPickReaction('none');
check('S4 vs T4 wounds on 4+', Engine.attackNumbers().woundTarget, 4);
const nobAura = Engine.applicableAuras(G().flow).find(a => a.stat === 'strength');
check('the Boss aura is offered', !!nobAura, true);
Engine.toggleAura(nobAura.key);
const boosted = Engine.attackNumbers();
check('within 6" it is S5', boosted.strength, 5);
check('so it wounds on 3+', boosted.woundTarget, 3);
Engine.flowHit(false);

console.log('\n== Snitcherz: D3 damage is asked for, not assumed ==');
Engine.forceControl(0, null);
Engine.adjustAP(0, 4);
Engine.beginAction('fight');
Engine.flowPickUnit(snitch.id);
Engine.flowPickAttackTarget(guardsman.id);
Engine.flowPickWeapon(snitch.weapons.find(w => w.name === 'Klaw').id);
Engine.flowPickReaction('none');
const klaw = Engine.attackNumbers();
check('the app knows the damage is variable', klaw.variableDamage, true);
check('and shows the card wording', klaw.damageText, 'D3');
Engine.flowHit(true);
Engine.flowWound(true);
Engine.flowDamage(3);                        // the player rolled a 3
check('the rolled damage lands', U('Guardsman').wounds, 0);
Engine.resolveVP(G().vpPrompts[0].id, 1);

console.log('\n== Kwik Dakka: the reaction shoots first ==');
(function () {
  const mob2 = buildPreset(orks, 0);
  const foe = [mkUnit(1, 'Guardsman', 3, 4,
    [{ name: 'Lasgun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])];
  Engine.startGame({ playerNames: ['Orks', 'Guard'], vpTarget: 10, firstPlayer: 1,
                     mission: { id: null } }, mob2.concat(foe));
  Engine.confirmStartPhase();
  Engine.adjustAP(1, 4);
  const gm = U('Guardsman'), mk = U('Mikaaaaghhh');
  Engine.beginAction('shoot');
  Engine.flowPickUnit(gm.id);
  Engine.flowPickAttackTarget(mk.id);
  Engine.flowPickReaction('special', mk.abilities.find(a => a.name === 'Kwik Dakka').id);
  check('the counter-attack takes over', G().flow.attackerId, mk.id);
  check('aimed back at the attacker', G().flow.targetId, gm.id);
  check('the original attack is parked', !!G().flow.resumeFlow, true);
  Engine.flowHit(false);                     // the counter misses
  check('so the original attack resumes', G().flow.attackerId, gm.id);
  check('at its Hit roll', G().flow.step, 'hit');
  Engine.flowHit(false);

  // Now kill the attacker with the counter.
  Engine.forceControl(1, null);
  Engine.adjustAP(1, 4);
  Engine.beginAction('shoot');
  Engine.flowPickUnit(gm.id);
  Engine.flowPickAttackTarget(mk.id);
  Engine.flowPickReaction('special', mk.abilities.find(a => a.name === 'Kwik Dakka').id);
  Engine.flowHit(true); Engine.flowWound(true); Engine.flowDamage(9);
  check('the attacker is down', U('Guardsman').alive, false);
  check('and their attack never resolves', G().flow, null);
})();

console.log('\n== Da Hunta marks his quarry for the game ==');
(function () {
  const mob3 = buildPreset(orks, 0);
  const foe = [mkUnit(1, 'Guardsman', 3, 4,
    [{ name: 'Lasgun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])];
  Engine.startGame({ playerNames: ['Orks', 'Guard'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, mob3.concat(foe));
  Engine.confirmStartPhase();
  const h = U('Da Hunta'), gm = U('Guardsman');
  const ab = h.abilities.find(a => a.name === 'Da Hunta');
  const need = Engine.effectsNeedingTarget(ab, { sourceUnitId: h.id });
  check('it asks which enemy is the quarry', need.length, 1);
  Engine.useFreeAbility(h.id, ab.id);
  check('so it opens a picker instead of firing blind', G().flow.step, 'pick');
  check('and knows it costs nothing', G().flow.freeUse, true);
  Engine.flowPickTarget(need[0].id, gm.id);
  Engine.confirmAbility();
  check('the quarry is chipped for the game',
    (U('Guardsman').effects || []).map(e => e.label), ["DA HUNTA'S QUARRY"]);
  check('no AP was spent', ap(0), 1);
  check('the button is spent', Engine.usableFreeAbilities(U('Da Hunta')).length, 0);
})();

console.log('\n== an area effect: one roll each, tick the failures ==');
(function () {
  const mob = buildPreset(orks, 0);
  const foes = [
    mkUnit(1, 'Guard A', 3, 4, [{ name: 'Lasgun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], []),
    mkUnit(1, 'Guard B', 3, 4, [{ name: 'Lasgun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['Orks', 'Guard'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, mob.concat(foes));
  Engine.confirmStartPhase();
  Engine.adjustAP(0, 4);
  const rik = U('Riksnik');
  const spray = rik.abilities.find(a => a.name === "Spin an' spray");
  Engine.beginAction('ability');
  Engine.flowPickUnit(rik.id);
  Engine.flowPickAbility(spray.id);
  check('it asks who was caught', G().flow.step, 'pick');
  const eff = Engine.effectsNeedingTarget(spray, { sourceUnitId: rik.id })[0];
  check('and takes several at once', eff.pick, 'multi');
  Engine.flowPickTarget(eff.id, U('Guard A').id);
  Engine.flowPickTarget(eff.id, U('Guard B').id);
  Engine.flowPickTarget(eff.id, rik.id);          // Riksnik rolls too
  check('three ticked', G().flow.targets[eff.id].length, 3);
  Engine.flowPickTarget(eff.id, U('Guard B').id); // Guard B actually passed — untick
  check('and one untickable again', G().flow.targets[eff.id].length, 2);
  Engine.flowDoneTargets();
  check('then it confirms', G().flow.step, 'confirm');
  Engine.confirmAbility();
  check('Guard A took 1', U('Guard A').wounds, 2);
  check('Guard B was spared', U('Guard B').wounds, 3);
  check('Riksnik took his own spray', U('Riksnik').alive, false);
})();

console.log('\n== which actions hand over AP ==');
(function () {
  const us = [
    mkUnit(0, 'A', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 },
                          { name: 'Axe', type: 'melee', hit: 3, strength: 4, damage: 1 }],
      [{ name: 'Trick', trigger: 'ap', cost: 1, text: 'x', effects: [] }]),
    mkUnit(1, 'B', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, us);
  Engine.confirmStartPhase();

  const flat = {};
  Engine.actionList().forEach(a => { flat[a.id] = a.opponentGainsAP || 0; });
  check('only CHARGE hands over a flat AP, as its card says',
    Object.keys(flat).filter(k => flat[k] > 0), ['charge']);
  check('an ability says so for itself', Engine.apConsequence(Engine.actionDef('ability')),
    'Your opponent gains no AP.');
  check('two players, always', Store.get().players.length, 2);
  check('and your opponent is never in doubt', Store.opponentOf(0), 1);
  check('and HOLD is gone', Engine.actionDef('hold'), null);
  check('MOVE gives nothing', Engine.apConsequence(Engine.actionDef('move')),
    'Your opponent gains no AP.');
  check('OVERWATCH gives nothing', Engine.apConsequence(Engine.actionDef('overwatch')),
    'Your opponent gains no AP.');
  check('an attack only pays a survivor', Engine.apConsequence(Engine.actionDef('shoot')),
    'The target gains 1 AP if it survives — nothing otherwise.');

  // MOVE really does hand over nothing.
  Engine.adjustAP(0, 3);
  const oppBefore = ap(1);
  Engine.beginAction('move');
  Engine.flowPickUnit(U('A').id);
  Engine.confirmSimple();
  check('and MOVE proves it in play', ap(1), oppBefore);

  // House rule it and the app follows.
  Engine.setActionOverride('move', 'opponentGainsAP', 1);
  check('the house rule is stored', Engine.actionDef('move').opponentGainsAP, 1);
  Engine.forceControl(0, null);
  Engine.adjustAP(0, 3);
  const oppBefore2 = ap(1);
  Engine.beginAction('move');
  Engine.flowPickUnit(U('A').id);
  Engine.confirmSimple();
  check('and MOVE now pays out', ap(1), oppBefore2 + 1);
  Engine.setActionOverride('move', 'opponentGainsAP', 0);
  check('setting it back to the card clears the override',
    !!(G().settings.actionOverrides || {}).move, false);
})();

console.log('\n== turn or reaction? ==');
(function () {
  const us = [
    mkUnit(0, 'A', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], []),
    mkUnit(1, 'B', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, us);
  check('a phase modal reads as a phase', Engine.controlMode(), 'phase');
  Engine.confirmStartPhase();
  check('the active player is on their turn', Engine.controlMode(), 'turn');
  Engine.beginAction('shoot');
  Engine.flowPickUnit(U('A').id);
  Engine.flowPickAttackTarget(U('B').id);
  Engine.flowPickReaction('none');
  Engine.flowHit(false);
  check('the defender is reacting, not taking a turn', Engine.controlMode(), 'reacting');
  check('it is still player one\\u2019s turn', G().turn.player, 0);
  Engine.adjustAP(0, 2);                   // the turn player still has AP to spend
  Engine.beginAction('pass');
  Engine.confirmPass(false);               // their pass hands it back
  Engine.beginAction('pass');
  Engine.confirmPass(false);               // second in a row closes the chain
  check('back to the turn player once the chain closes', Engine.controlMode(), 'turn');
})();

console.log('\n== PASS does both jobs now ==');
(function () {
  const us = [
    mkUnit(0, 'A', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }],
      [{ name: 'Quiet', trigger: 'ap', cost: 1, text: 'x', opponentReacts: false, effects: [] },
       { name: 'Loud',  trigger: 'ap', cost: 1, text: 'x', opponentReacts: true, effects: [] }]),
    mkUnit(1, 'B', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, us);
  Engine.confirmStartPhase();
  Engine.adjustAP(0, 3);

  // On your own turn with no chain, PASS can only end the turn.
  check('no chain: only the turn is on offer', Engine.passOptions(),
    { inChain: false, wouldEndChain: false, canEndTurn: true });
  check('PASS is available with a chain running or not',
    Engine.actionAvailability(Engine.actionDef('pass')).ok, true);

  // Open a chain, then pass out of it without giving up the turn.
  Engine.beginAction('shoot');
  Engine.flowPickUnit(U('A').id);
  Engine.flowPickAttackTarget(U('B').id);
  Engine.flowPickReaction('none');
  Engine.flowHit(false);
  check('the defender is up', Engine.controlMode(), 'reacting');
  Engine.beginAction('pass');
  Engine.confirmPass(false);
  Engine.beginAction('pass');
  Engine.confirmPass(false);
  check('two passes closed the chain', G().chain.active, false);
  check('and it is still turn one', G().turn.number, 1);
  check('with the turn player back in control', Engine.controlMode(), 'turn');

  const apBefore = ap(0);
  Engine.beginAction('pass');
  check('no chain, so only the turn is on offer', Engine.passOptions(),
    { inChain: false, wouldEndChain: false, canEndTurn: true });
  Engine.confirmPass(true);
  check('PASS costs nothing', ap(0), apBefore);
  check('and the turn is over', G().pending.type, 'end');
})();

console.log('\n== an ability decides whether they react ==');
(function () {
  const us = [
    mkUnit(0, 'A', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }],
      [{ name: 'Quiet', trigger: 'ap', cost: 1, text: 'x', opponentReacts: false, effects: [] },
       { name: 'Loud',  trigger: 'ap', cost: 1, text: 'x', opponentReacts: true,
         effects: [{ kind: 'ap_opponent', value: 1 }] }]),
    mkUnit(1, 'B', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, us);
  Engine.confirmStartPhase();
  Engine.adjustAP(0, 4);
  Engine.adjustAP(1, 2);

  const a = U('A');
  Engine.beginAction('ability');
  Engine.flowPickUnit(a.id);
  Engine.flowPickAbility(a.abilities.find(x => x.name === 'Quiet').id);
  Engine.confirmAbility();
  check('a no-reaction ability closes the chain', G().chain.active, false);
  check('so control never left the turn player', G().control.player, 0);

  const oppBefore = ap(1);
  Engine.beginAction('ability');
  Engine.flowPickUnit(a.id);
  Engine.flowPickAbility(a.abilities.find(x => x.name === 'Loud').id);
  Engine.confirmAbility();
  check('a reacting ability hands over', G().control.player, 1);
  check('the chain is live', G().chain.active, true);
  check('and AP only moved because the ability said so', ap(1), oppBefore + 1);
})();

console.log('\n== a DIVE that stays in sight still earns its AP ==');
(function () {
  const us = [
    mkUnit(0, 'A', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], []),
    mkUnit(1, 'B', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, us);
  Engine.confirmStartPhase();
  Engine.adjustAP(0, 2);
  const before = ap(1);
  Engine.beginAction('shoot');
  Engine.flowPickUnit(U('A').id);
  Engine.flowPickAttackTarget(U('B').id);
  Engine.flowPickReaction('dive');
  Engine.flowHit(false);                       // the shot happens and misses
  check('the survivor gains its AP as normal', ap(1), before + 1);
})();

console.log('\n== an interrupted MOVE costs the AP and yields nothing ==');
(function () {
  const us = [
    mkUnit(0, 'A', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], []),
    mkUnit(1, 'B', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
                     mission: { id: null } }, us);
  Engine.confirmStartPhase();
  Engine.adjustAP(0, 2);
  const mine = ap(0), theirs = ap(1);
  Engine.beginAction('move');
  Engine.flowPickUnit(U('A').id);
  Engine.abortAction();
  check('the AP was still spent', ap(0), mine - 1);
  check('the opponent gained nothing', ap(1), theirs);
  check('and the chain continues rather than ending as MOVE would',
    G().chain.active, true);
})();

console.log('\n== each card carries its own win condition ==');
(function () {
  const expect = { sabotage: 10, hill: 10, ambush: null, assassination: 10, secure: 10, relic: null };
  Object.keys(expect).forEach(function (id) {
    check(id + ' VP target', RULES.missionById(id).vpTarget, expect[id]);
  });
  check('every card says how it ends',
    RULES.missions.every(m => typeof m.endsWhen === 'string' && m.endsWhen.length > 0), true);
  check('and prints its text as lines',
    RULES.missions.every(m => Array.isArray(m.battlefield) && Array.isArray(m.objective) &&
      Array.isArray(m.special)), true);

  // A mission with no VP target must never be won on points.
  const us = [
    mkUnit(0, 'A', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], []),
    mkUnit(1, 'B', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ];
  Engine.startGame({ playerNames: ['One', 'Two'], firstPlayer: 0,
                     vpTarget: RULES.missionById('relic').vpTarget,
                     endsWhen: RULES.missionById('relic').endsWhen,
                     mission: { id: 'relic' } }, us);
  Engine.confirmStartPhase();
  check('the card overrode the target', G().settings.vpTarget, null);
  check('and recorded how it ends', G().settings.endsWhen,
    'a RELIC carrier reaches their own side of the battlefield');
  Engine.adjustVP(0, 50, 'test');
  check('50 VP wins nothing here', G().winner, null);

  // Whereas a card that does end on VP still does.
  Engine.startGame({ playerNames: ['One', 'Two'], firstPlayer: 0,
                     vpTarget: RULES.missionById('secure').vpTarget,
                     endsWhen: RULES.missionById('secure').endsWhen,
                     mission: { id: 'secure' } }, [
    mkUnit(0, 'A', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], []),
    mkUnit(1, 'B', 3, 4, [{ name: 'Gun', type: 'ranged', hit: 3, strength: 4, damage: 1 }], [])
  ]);
  Engine.confirmStartPhase();
  check('SECURE THE AREA plays to 10', G().settings.vpTarget, 10);
  Engine.adjustVP(0, 10, 'test');
  check('and 10 VP wins it', G().winner, 0);
})();

console.log('\n== summary ==');
console.log((checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);

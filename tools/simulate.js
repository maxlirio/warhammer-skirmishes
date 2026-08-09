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
vm.runInContext('globalThis.__mods = { RULES: RULES, Store: Store, Engine: Engine };', sandbox);
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
check('S2 vs T5 (half or less)', RULES.woundTarget(2, 5), 6);
check('S4 vs T8 (half)', RULES.woundTarget(4, 8), 6);
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
check('P1 gains the survivor AP', ap(0), 1);
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
check('both AP pools empty → End Phase', G().pending.type, 'end');

console.log('\n== end phase hands the turn over ==');
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

console.log('\n== HOLD ends the chain ==');
Engine.beginAction('hold');
Engine.confirmSimple();
check('chain closed by HOLD', G().chain.active, false);
check('HOLD is free', ap(1), 1);

console.log('\n== SPECIAL ABILITY: opponent gains AP, chain continues ==');
check('control back to the turn player', G().control.player, 0);
Engine.adjustAP(0, 2);
const apOpp = ap(1);
Engine.beginAction('ability');
Engine.flowPickUnit(U('Intercessor').id);
Engine.flowPickAbility(U('Intercessor').abilities[0].id);
Engine.confirmAbility();
check('opponent gains 1 AP from the Passive Action', ap(1), apOpp + 1);
check('opponent may pick any unit', G().control.forcedUnitId, null);
check('+1 to hit effect on the Intercessor', U('Intercessor').effects.length, 1);

console.log('\n== DIVE cancels the attack ==');
Engine.forceControl(0, null);
Engine.adjustAP(0, 2);
Engine.beginAction('shoot');
Engine.flowPickUnit(U('Scout').id);
Engine.flowPickAttackTarget(U('Ork Boy').id);
Engine.flowPickReaction('dive');
check('DIVE asks about eligibility', G().flow.step, 'eligible');
const boyWounds = U('Ork Boy').wounds, oppAP = ap(1);
Engine.flowEligibility(false);
check('no damage dealt', U('Ork Boy').wounds, boyWounds);
check('no AP for the diving unit', ap(1), oppAP);
check('flow closed', G().flow, null);

console.log('\n== DISTRACT: extra AP and a free unit choice ==');
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

console.log('\n== mission objectives & special objectives ==');
Store.commit('add mission', function () {
  const g = Store.get();
  g.mission = { id: 'hill' };
  g.players[0].objective = { id: 'so1', name: 'No Mercy', text: 'Kill in melee.', vp: 2,
    repeat: false, completed: 0,
    effects: [{ id: 'e1', kind: 'vp_self', value: 2 }, { id: 'e2', kind: 'ap_self', value: 1 }] };
});
const vpBefore = vp(0);
const item = Engine.missionEndTurnItems()[0];
check('KING OF THE HILL has an end-of-turn item', item.name, 'Holding the HIGH GROUND');
Engine.scoreMissionObjective(item.id, 0);
check('objective queues a VP prompt', G().vpPrompts.length, 1);
check('pre-filled from the card', G().vpPrompts[0].suggested, 1);
Engine.resolveVP(G().vpPrompts[0].id, 5);   // but you can type anything
check('the entered VP is what lands', vp(0), vpBefore + 5);
check('objective counted', Engine.objectiveScoredBy(item.id, 0), 1);

const vpBefore2 = vp(0), apBefore2 = ap(0);
Engine.claimSpecialObjective(0);
check('stored non-VP rewards apply immediately', ap(0), apBefore2 + 1);
check('and its VP is asked for', G().vpPrompts.length, 1);
Engine.resolveVP(G().vpPrompts[0].id, 2);
check('special objective VP', vp(0), vpBefore2 + 2 + 2);   // +2 stored effect, +2 entered
check('marked completed', Store.get().players[0].objective.completed, 1);

console.log('\n== either empty pool ends the chain; the turn keeps going ==');
// Turn player holds AP, opponent has none: the chain must stay open and the
// weapon lockout must survive.
Store.commit('setup', function () {
  const g = Store.get();
  g.turn.player = 0;
  g.players[0].ap = 3;
  g.players[1].ap = 0;
  g.control = { player: 0, forcedUnitId: null, reason: 'test' };
});
// Open the chain with an attack so a weapon is locked out, then act again with
// a Passive Action that hands the opponent nothing.
Engine.beginAction('shoot');
Engine.flowPickUnit(U('Intercessor').id);
Engine.flowPickAttackTarget(U('Ork Nob').id);
Engine.flowPickWeapon(U('Intercessor').weapons[0].id);
Engine.flowPickReaction('none');
Engine.flowHit(false);
check('the miss still gives the defender its AP', ap(1), 1);
Store.commit('drain opponent', function () {
  const g = Store.get();
  g.players[1].ap = 0;
  g.control = { player: 0, forcedUnitId: null, reason: 'test' };
});
Engine.beginAction('overwatch');           // Passive, grants the opponent no AP
Engine.flowPickUnit(U('Intercessor').id);
Engine.confirmOverwatch();
check('opponent at 0 AP closes the chain', G().chain.active, false);
check('but the turn continues with the current player', G().control.player, 0);
check('no forced unit', G().control.forcedUnitId, null);
check('a new chain starts clean — weapon lockout cleared',
  Engine.weaponsFor(U('Intercessor').id, 'ranged')[0].used, false);
check('turn player still holds AP', ap(0), 1);

// Spend the last AP: now the turn itself passes.
Engine.beginAction('overwatch');
Engine.flowPickUnit(U('Scout').id);
Engine.confirmOverwatch();
check('current player at 0 AP ends the turn', G().chain.active, false);
check('and rolls into the End Phase', G().pending.type, 'end');

console.log('\n== undo ==');
const apPreUndo = ap(0);
Engine.adjustAP(0, 3);
check('manual change applied', ap(0), apPreUndo + 3);
Store.undo();
check('undo reverts it', ap(0), apPreUndo);

/* ------------------------------------------------- mission cards, 2 players */

function freshGame(missionCfg, playerNames) {
  const us = [
    mkUnit(0, 'Alpha', 3, 4, [{ name: 'Rifle', type: 'ranged', hit: 3, strength: 4, damage: 1 },
                              { name: 'Blade', type: 'melee', hit: 3, strength: 5, damage: 2 }], []),
    mkUnit(1, 'Bravo', 2, 4, [{ name: 'Gun', type: 'ranged', hit: 4, strength: 4, damage: 1 },
                              { name: 'Axe', type: 'melee', hit: 3, strength: 4, damage: 1 }], [])
  ];
  if (playerNames && playerNames.length > 2) {
    us.push(mkUnit(2, 'Charlie', 2, 4, [{ name: 'Gun', type: 'ranged', hit: 4, strength: 4, damage: 1 }], []));
  }
  Engine.startGame({
    playerNames: playerNames || ['One', 'Two'], vpTarget: 10, firstPlayer: 0,
    mission: missionCfg, objectives: []
  }, us);
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
                     mission: { id: 'assassination' }, objectives: [] }, us);
  Engine.confirmStartPhase();
  check('the TARGET gains +1 Wound', U('Bravo').maxWounds, 3);
  check('a normal kill is worth 1', Engine.killValue(U('Alpha')), 1);
  check('killing the TARGET suggests 3', Engine.killValue(U('Bravo')), 3);
})();

console.log('\n== three players ==');
freshGame({ id: null }, ['One', 'Two', 'Three']);
check('three seats', G().players.length, 3);
check('turn order wraps', Store.nextPlayer(2), 0);
check('SPECIAL ABILITY must ask who the opponent is',
  Engine.needsResponderChoice('ability'), true);
check('an attack never needs asking', Engine.needsResponderChoice('shoot'), false);
Engine.adjustAP(0, 2);
Engine.beginAction('shoot');
Engine.flowPickUnit(U('Alpha').id);
Engine.flowPickAttackTarget(U('Charlie').id);        // the third player, not the next in order
Engine.flowPickReaction('none');
Engine.flowHit(true); Engine.flowWound(true); Engine.flowDamage(1);
check('the target’s owner is the one who responds', G().control.player, 2);
check('and their unit is the forced one', G().control.forcedUnitId, U('Charlie').id);
check('they gained the survivor AP', ap(2), 1);

console.log('\n== summary ==');
console.log((checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);

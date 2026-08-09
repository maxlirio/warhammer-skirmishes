/* =========================================================================
   STATE — the game's memory.
   Holds the whole game in one plain object, persists it to localStorage,
   and keeps an undo stack so a misclick during a real game is cheap.
   ========================================================================= */

const Store = (function () {

  const KEY_GAME    = 'whsk.game.v1';
  const KEY_ROSTERS = 'whsk.rosters.v1';
  const UNDO_DEPTH  = 40;

  let uid = 1;
  function nextId(prefix) { return prefix + '_' + (uid++).toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------------------------------------------------------------- model */

  function newWeapon(patch) {
    return Object.assign({
      id: nextId('w'), name: 'Weapon', type: 'ranged',
      hit: 3, strength: 4, damage: 1, notes: ''
    }, patch || {});
  }

  function newAbility(patch) {
    return Object.assign({
      id: nextId('ab'), name: 'Ability', trigger: 'ap', cost: 1,
      text: '', effects: [], endsChain: 'default', opponentGainsAP: 'default',
      usesPerGame: 0, used: 0
    }, patch || {});
  }

  function newEffectRow(patch) {
    return Object.assign({
      id: nextId('ef'), kind: 'ap_self', value: 1, pick: 'prompt',
      duration: 'chain', label: '', expiry: 'chain', tokenAttack: false, text: ''
    }, patch || {});
  }

  function newMissionObjective(patch) {
    return Object.assign({
      id: nextId('mo'), name: 'Objective', text: '', vp: 1, repeat: true
    }, patch || {});
  }

  function newSpecialObjective(patch) {
    return Object.assign({
      id: nextId('so'), name: '', text: '', effects: [], repeat: false, completed: 0
    }, patch || {});
  }

  function newUnit(owner, patch) {
    return Object.assign({
      id: nextId('u'), owner: owner, name: 'Unit',
      maxWounds: 2, wounds: 2, toughness: 4, save: 3, move: 6, hit: 3,
      weapons: [], abilities: [], notes: '',
      alive: true, effects: [], tokens: []
    }, patch || {});
  }

  function newGame(config) {
    const g = {
      version: 1,
      createdAt: new Date().toISOString(),
      screen: 'play',
      settings: {
        vpTarget: (config && config.vpTarget) || RULES.defaultVPTarget,
        /* The card says "until the end of this action chain", but a chain
           usually closes the moment the opponent runs out of AP, which would
           delete the token before anyone could walk into it. Default to the
           practical reading — the token lives until its unit moves or attacks
           — and let the menu switch it back to the strict wording. */
        overwatchEndsWithChain: false,
        overwatchGrantsAP: false
      },
      players: [
        { id: 0, name: (config && config.p1) || 'Player 1', ap: 0, vp: 0, rp: 0,
          objective: (config && config.objectives && config.objectives[0]) || null },
        { id: 1, name: (config && config.p2) || 'Player 2', ap: 0, vp: 0, rp: 0,
          objective: (config && config.objectives && config.objectives[1]) || null }
      ],
      mission: (config && config.mission) || { name: '', text: '', objectives: [] },
      objectiveScores: {},
      units: [],
      turn: { number: 0, player: (config && config.firstPlayer) || 0, phase: 'start' },
      control: { player: 0, forcedUnitId: null, reason: '' },
      chain: { active: false, id: 0, initiator: null, entries: [], weaponsUsed: [] },
      flow: null,
      pending: null,          // start/end phase modal
      log: [],
      winner: null
    };
    return g;
  }

  /* --------------------------------------------------------------- runtime */

  const listeners = [];
  let state = null;
  let undoStack = [];

  function subscribe(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(fn => fn(state)); }

  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  /* Wrap every mutation so undo + persistence + render happen automatically. */
  function commit(label, fn) {
    if (!state) return;
    undoStack.push({ label: label, data: snapshot() });
    if (undoStack.length > UNDO_DEPTH) undoStack.shift();
    try {
      fn();
    } catch (err) {
      console.error('commit failed:', label, err);
      undoStack.pop();
      throw err;
    }
    save();
    emit();
  }

  /* A mutation that should not be undoable on its own (UI-only bookkeeping). */
  function quiet(fn) {
    fn();
    save();
    emit();
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return false;
    state = prev.data;
    save();
    emit();
    return prev.label || true;
  }

  function canUndo() { return undoStack.length > 0; }
  function undoLabel() { return undoStack.length ? undoStack[undoStack.length - 1].label : ''; }

  /* ----------------------------------------------------------- persistence */

  function save() {
    try {
      localStorage.setItem(KEY_GAME, JSON.stringify({ state: state, uid: uid }));
    } catch (e) { /* private browsing / quota — the game still runs in memory */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY_GAME);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.state) return false;
      state = parsed.state;
      uid = parsed.uid || 1;
      undoStack = [];
      return true;
    } catch (e) { return false; }
  }

  function clear() {
    try { localStorage.removeItem(KEY_GAME); } catch (e) {}
    state = null;
    undoStack = [];
  }

  /* ---------------------------------------------------------------- rosters */

  function rosters() {
    try { return JSON.parse(localStorage.getItem(KEY_ROSTERS) || '[]'); }
    catch (e) { return []; }
  }

  function saveRoster(name, units) {
    const all = rosters().filter(r => r.name !== name);
    all.push({ name: name, savedAt: new Date().toISOString(), units: JSON.parse(JSON.stringify(units)) });
    try { localStorage.setItem(KEY_ROSTERS, JSON.stringify(all)); } catch (e) {}
    return all;
  }

  function deleteRoster(name) {
    const all = rosters().filter(r => r.name !== name);
    try { localStorage.setItem(KEY_ROSTERS, JSON.stringify(all)); } catch (e) {}
    return all;
  }

  /* Re-key a roster's units so the same roster can be loaded twice safely. */
  function rekey(units, owner) {
    return units.map(u => {
      const nu = JSON.parse(JSON.stringify(u));
      nu.id = nextId('u');
      nu.owner = owner;
      nu.alive = true;
      nu.wounds = nu.maxWounds;
      nu.effects = [];
      nu.tokens = [];
      (nu.weapons || []).forEach(w => { w.id = nextId('w'); });
      (nu.abilities || []).forEach(a => {
        a.id = nextId('ab');
        a.used = 0;
        (a.effects || []).forEach(e => { e.id = nextId('ef'); });
      });
      return nu;
    });
  }

  /* --------------------------------------------------------------- lookups */

  const get   = () => state;
  const unit  = id => state && state.units.find(u => u.id === id) || null;
  const owner = id => { const u = unit(id); return u ? u.owner : null; };
  const player = i => state.players[i];
  const opponentOf = i => 1 - i;
  const unitsOf = (i, aliveOnly) =>
    state.units.filter(u => u.owner === i && (!aliveOnly || u.alive));
  const allTokens = () =>
    state.units.reduce((acc, u) => acc.concat((u.tokens || []).map(t =>
      Object.assign({}, t, { unitId: u.id, unitName: u.name, owner: u.owner }))), []);

  function setState(s) { state = s; save(); emit(); }

  return {
    // model factories
    newGame, newUnit, newWeapon, newAbility, newEffectRow, nextId,
    newMissionObjective, newSpecialObjective,
    // runtime
    get, setState, commit, quiet, undo, canUndo, undoLabel, subscribe, emit,
    save, load, clear,
    // rosters
    rosters, saveRoster, deleteRoster, rekey,
    // lookups
    unit, owner, player, opponentOf, unitsOf, allTokens
  };
})();


/* =========================================================================
   SAMPLE ROSTERS — used by the "load an example" button on the setup screen.
   ========================================================================= */
const SAMPLES = {
  imperial: [
    {
      name: 'Intercessor Sergeant', maxWounds: 3, wounds: 3, toughness: 4, save: 3, move: 6, hit: 3,
      weapons: [
        { name: 'Bolt Rifle', type: 'ranged', hit: 3, strength: 4, damage: 1, notes: '' },
        { name: 'Power Fist', type: 'melee', hit: 3, strength: 8, damage: 2, notes: '' }
      ],
      abilities: [
        { name: 'Rapid Fire', trigger: 'ap', cost: 1,
          text: 'Take an extra shot with a ranged weapon already used this chain.',
          effects: [{ kind: 'note', text: 'The chosen weapon may be used again this action chain.' }] },
        { name: 'Squad Discipline', trigger: 'rp', cost: 1,
          text: 'Subtract 1 from the attacker\'s Wound roll and gain 1 AP.',
          effects: [{ kind: 'mod_wound', value: -1, pick: 'attacker', duration: 'attack' },
                    { kind: 'ap_self', value: 1 }] }
      ]
    },
    {
      name: 'Scout with Sniper', maxWounds: 2, wounds: 2, toughness: 3, save: 4, move: 6, hit: 3,
      weapons: [
        { name: 'Sniper Rifle', type: 'ranged', hit: 3, strength: 5, damage: 2, notes: '' },
        { name: 'Combat Knife', type: 'melee', hit: 4, strength: 3, damage: 1, notes: '' }
      ],
      abilities: [
        { name: 'Proximity Mine', trigger: 'ap', cost: 1,
          text: 'Place a mine. When an enemy triggers it, it suffers 2 damage.',
          effects: [{ kind: 'token', label: 'PROXIMITY MINE', expiry: 'used', tokenAttack: false,
                      text: 'Deals 2 damage to the unit that triggered it.' }] },
        { name: 'Camo Cloak', trigger: 'passive', cost: 0,
          text: 'Enemies shooting this unit are at -1 to hit.', effects: [] }
      ]
    }
  ],
  ork: [
    {
      name: 'Ork Nob', maxWounds: 4, wounds: 4, toughness: 5, save: 4, move: 6, hit: 3,
      weapons: [
        { name: 'Kombi-Shoota', type: 'ranged', hit: 4, strength: 4, damage: 1, notes: '' },
        { name: 'Big Choppa', type: 'melee', hit: 3, strength: 7, damage: 2, notes: '' }
      ],
      abilities: [
        { name: 'WAAAGH!', trigger: 'ap', cost: 1,
          text: 'This unit gets +1 to hit until the end of the action chain.',
          effects: [{ kind: 'mod_hit', value: 1, pick: 'self', duration: 'chain' }] },
        { name: 'Ard as Nails', trigger: 'rp', cost: 1,
          text: 'Subtract 1 from the attacker\'s Wound roll.',
          effects: [{ kind: 'mod_wound', value: -1, pick: 'attacker', duration: 'attack' }] }
      ]
    },
    {
      name: 'Ork Boy', maxWounds: 2, wounds: 2, toughness: 5, save: 5, move: 6, hit: 4,
      weapons: [
        { name: 'Shoota', type: 'ranged', hit: 4, strength: 4, damage: 1, notes: '' },
        { name: 'Choppa', type: 'melee', hit: 3, strength: 4, damage: 1, notes: '' }
      ],
      abilities: [
        { name: 'Mob Rule', trigger: 'start', cost: 0,
          text: 'Gain 1 AP if a friendly unit was destroyed last turn.',
          effects: [{ kind: 'ap_self', value: 1 }] }
      ]
    }
  ]
};

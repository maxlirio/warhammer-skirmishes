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

  /* Datasheet weapon line: RANGE / HIT / STRENGTH / DAMAGE.
     Range is a reminder only — the app never checks it. */
  function newWeapon(patch) {
    return Object.assign({
      id: nextId('w'), name: 'Weapon', type: 'ranged',
      range: 12, hit: 3, strength: 4, damage: 1, notes: ''
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
      id: nextId('so'), name: '', text: '', vp: 1, effects: [], repeat: false, completed: 0
    }, patch || {});
  }

  /* Datasheet: MOV / W / T / OC. There is no saving throw in this game. */
  function newUnit(owner, patch) {
    return Object.assign({
      id: nextId('u'), owner: owner, name: 'Unit',
      move: 6, maxWounds: 1, wounds: 1, toughness: 4, oc: 0,
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
      players: ((config && config.playerNames) || ['Player 1', 'Player 2']).map(function (nm, i) {
        return {
          id: i, name: nm || ('Player ' + (i + 1)), ap: 0, vp: 0, rp: 0,
          objective: (config && config.objectives && config.objectives[i]) || null
        };
      }),
      /* { id, roles?, controlPoints?, relic? } — the engine fills the rest in. */
      mission: (config && config.mission) || { id: null },
      objectiveScores: {},
      units: [],
      vpPrompts: [],
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

  /* ---------------------------------------------------------------- library
     Everything you type in once — units, missions, special objectives — is kept
     in this browser so the next game is a few taps instead of a rebuild.
     Entries are keyed by name, so re-saving an edited unit replaces it.        */

  const KEY_LIB = 'whsk.library.v1';
  const LIB_KINDS = ['units', 'missions', 'objectives'];

  function library() {
    let lib;
    try { lib = JSON.parse(localStorage.getItem(KEY_LIB) || '{}'); }
    catch (e) { lib = {}; }
    LIB_KINDS.forEach(k => { if (!Array.isArray(lib[k])) lib[k] = []; });
    return lib;
  }

  function writeLibrary(lib) {
    try { localStorage.setItem(KEY_LIB, JSON.stringify(lib)); } catch (e) {}
    return lib;
  }

  function libSave(kind, entry) {
    if (!entry || !entry.name || !String(entry.name).trim()) return null;
    const lib = library();
    const copy = JSON.parse(JSON.stringify(entry));
    copy.savedAt = new Date().toISOString();
    const key = String(copy.name).trim().toLowerCase();
    lib[kind] = lib[kind].filter(x => String(x.name).trim().toLowerCase() !== key);
    lib[kind].push(copy);
    lib[kind].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    writeLibrary(lib);
    return copy;
  }

  function libDelete(kind, name) {
    const lib = library();
    const key = String(name).trim().toLowerCase();
    lib[kind] = lib[kind].filter(x => String(x.name).trim().toLowerCase() !== key);
    return writeLibrary(lib);
  }

  function libGet(kind, name) {
    const key = String(name).trim().toLowerCase();
    return library()[kind].find(x => String(x.name).trim().toLowerCase() === key) || null;
  }

  /* Fresh ids for anything pulled back out of the library. */
  function rekeyOne(entry) {
    const c = JSON.parse(JSON.stringify(entry));
    delete c.savedAt;
    if (c.effects) c.effects.forEach(e => {
      e.id = nextId('ef');
      if (e.tokenEffects) e.tokenEffects.forEach(t => { t.id = nextId('ef'); });
    });
    if (c.objectives) c.objectives.forEach(o => { o.id = nextId('mo'); });
    if (c.completed !== undefined) c.completed = 0;
    c.id = nextId('lib');
    return c;
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
  const playerCount = () => state.players.length;
  const unitsOf = (i, aliveOnly) =>
    state.units.filter(u => u.owner === i && (!aliveOnly || u.alive));

  /* Seating order — the turn passes around the table. */
  const nextPlayer = i => (i + 1) % state.players.length;
  const opponentsOf = i => state.players.map(p => p.id).filter(id => id !== i);

  /* Only meaningful in a two-player game; anywhere it could be ambiguous the
     engine asks instead of guessing. */
  const opponentOf = i => (state.players.length === 2 ? 1 - i : nextPlayer(i));
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
    // rosters + library
    rosters, saveRoster, deleteRoster, rekey,
    library, libSave, libDelete, libGet, rekeyOne,
    // lookups
    unit, owner, player, playerCount, nextPlayer, opponentsOf, opponentOf,
    unitsOf, allTokens
  };
})();


/* =========================================================================
   SAMPLE ROSTERS — used by the "load an example" button on the setup screen.
   ========================================================================= */
const SAMPLES = {
  imperial: [
    {
      name: 'Intercessor Sergeant', move: 6, maxWounds: 3, wounds: 3, toughness: 4, oc: 2,
      weapons: [
        { name: 'Bolt Rifle', type: 'ranged', range: 24, hit: 3, strength: 4, damage: 1, notes: '' },
        { name: 'Power Fist', type: 'melee', range: 1, hit: 3, strength: 8, damage: 2, notes: '' }
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
      name: 'Scout with Sniper', move: 6, maxWounds: 2, wounds: 2, toughness: 3, oc: 1,
      weapons: [
        { name: 'Sniper Rifle', type: 'ranged', range: 36, hit: 3, strength: 5, damage: 2, notes: '' },
        { name: 'Combat Knife', type: 'melee', range: 1, hit: 4, strength: 3, damage: 1, notes: '' }
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
      name: 'Ork Nob', move: 6, maxWounds: 4, wounds: 4, toughness: 5, oc: 2,
      weapons: [
        { name: 'Kombi-Shoota', type: 'ranged', range: 18, hit: 4, strength: 4, damage: 1, notes: '' },
        { name: 'Big Choppa', type: 'melee', range: 1, hit: 3, strength: 7, damage: 2, notes: '' }
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
      name: 'Ork Boy', move: 6, maxWounds: 2, wounds: 2, toughness: 5, oc: 1,
      weapons: [
        { name: 'Shoota', type: 'ranged', range: 18, hit: 4, strength: 4, damage: 1, notes: '' },
        { name: 'Choppa', type: 'melee', range: 1, hit: 3, strength: 4, damage: 1, notes: '' }
      ],
      abilities: [
        { name: 'Mob Rule', trigger: 'start', cost: 0,
          text: 'Gain 1 AP if a friendly unit was destroyed last turn.',
          effects: [{ kind: 'ap_self', value: 1 }] }
      ]
    }
  ]
};

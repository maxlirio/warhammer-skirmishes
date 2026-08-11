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
      text: '', effects: [], opponentReacts: true, moves: false,
      usesPerGame: 0, used: 0, usesPerTurn: 0, usedTurn: 0
    }, patch || {});
  }

  function newEffectRow(patch) {
    return Object.assign({
      id: nextId('ef'), kind: 'ap_self', value: 1, pick: 'prompt', side: 'any',
      duration: 'chain', label: '', expiry: 'chain', tokenAttack: false, text: ''
    }, patch || {});
  }

  /* Datasheet: MOV / W / T / OC. There is no saving throw in this game. */
  function newUnit(owner, patch) {
    return Object.assign({
      id: nextId('u'), owner: owner, name: 'Unit',
      move: 6, maxWounds: 1, wounds: 1, toughness: 4, oc: 0,
      weapons: [], abilities: [], notes: '',
      alive: true, effects: [], tokens: [],
      /* Deep Strike: the unit exists but is not on the battlefield yet, so it
         cannot be shot at, cannot act, and cannot be picked as a target. */
      reserve: false, movedThisTurn: false, noMoveTurn: false
    }, patch || {});
  }

  function newGame(config) {
    const g = {
      version: 1,
      createdAt: new Date().toISOString(),
      screen: 'play',
      settings: {
        /* Each Mission Card carries its own win condition; only a card-less
           game asks the players to pick one. */
        vpTarget: (config && config.vpTarget !== undefined)
          ? config.vpTarget : RULES.defaultVPTarget,
        endsWhen: (config && config.endsWhen) || null,
        endsShort: (config && config.endsShort) || null,
        /* An overwatch shot is an interrupt: no RP for the defender, and no
           survivor AP either. */
        overwatchGrantsAP: false,
        /* Per-action house rules: { move: { cost: 1, opponentGainsAP: 0 }, ... } */
        actionOverrides: {},
        /* false = experienced: labels, costs and flavour, no teaching. */
        verbose: (config && config.verbose) !== false,
        /* 'table' turns each player's half to face them. */
        layout: (config && config.layout) || 'normal'
      },
      players: [0, 1].map(function (i) {
        const nm = (config && config.playerNames && config.playerNames[i]);
        /* card: a faction card with its own resource (the Grey Knights' PSY).
           buffs: one-shot purchases waiting for the attack they modify. */
        return { id: i, name: nm || ('Player ' + (i + 1)), ap: 0, vp: 0, rp: 0,
                 card: null, buffs: [] };
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
  const LIB_KINDS = ['units'];

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
  const unitsOf = (i, aliveOnly) =>
    state.units.filter(u => u.owner === i && (!aliveOnly || u.alive));

  /* Two players: your opponent and the next turn are the same person. */
  const opponentOf = i => 1 - i;
  const nextPlayer = i => 1 - i;
  const allTokens = () =>
    state.units.reduce((acc, u) => acc.concat((u.tokens || []).map(t =>
      Object.assign({}, t, { unitId: u.id, unitName: u.name, owner: u.owner }))), []);

  function setState(s) { state = s; save(); emit(); }

  return {
    // model factories
    newGame, newUnit, newWeapon, newAbility, newEffectRow, nextId,
    // runtime
    get, setState, commit, quiet, undo, canUndo, undoLabel, subscribe, emit,
    save, load, clear,
    // rosters + library
    rosters, saveRoster, deleteRoster, rekey,
    library, libSave, libDelete, libGet,
    // lookups
    unit, owner, player, nextPlayer, opponentOf,
    unitsOf, allTokens
  };
})();


/* =========================================================================
   PRESET FACTIONS — offered on the army slide.
   ========================================================================= */
const PRESETS = [
{
  id: 'astra',
  name: 'Astra Militarum',
  note: 'The official line-up.',
  units: [
    {
      name: 'Guardsman "Fred" 434-436', move: 4, maxWounds: 2, toughness: 4, oc: 1,
      notes: '434-434 almost removed him from his squad after an unpleasant incident involving ' +
             'his quick trigger.',
      weapons: [
        { name: 'Modded Lasgun', type: 'ranged', range: 12, hit: 5, strength: 4, damage: 2 },
        { name: 'Leathered Fist', type: 'melee', range: 1, hit: 4, strength: 2, damage: 1 }
      ],
      abilities: [
        { name: 'Snap Shot', trigger: 'free', cost: 0, usesPerGame: 1,
          text: 'Once per game, when an enemy unit moves within 6" of this unit, if it is an ' +
                'eligible ranged target, this unit may interrupt their action. Resolve a shoot ' +
                'sequence against that unit. Skip steps 2 and 3.',
          effects: [{ kind: 'attack', weapon: 'ranged', noRP: true, hitMod: 0, skipWound: false }] }
      ]
    },
    {
      name: 'Guardsman "Al" 434-435', move: 4, maxWounds: 2, toughness: 3, oc: 1,
      notes: 'He was chosen as one of 434-434\'s trio for his unnatural skill with the bayonet.',
      weapons: [
        { name: 'Lasgun', type: 'ranged', range: 18, hit: 4, strength: 4, damage: 1 },
        { name: 'Bayonet', type: 'melee', range: 2, hit: 2, strength: 4, damage: 1 }
      ],
      abilities: [
        { name: 'Bayonet Charge', trigger: 'passive', cost: 0,
          text: 'When this unit charges, his Bayonet has +1 damage for the attack.',
          effects: [] },
        { name: 'Kill Count', trigger: 'onkill', cost: 0, weaponName: 'Bayonet',
          text: 'Whenever this unit defeats an enemy unit using its Bayonet, permanently ' +
                'increase his OC by one.',
          effects: [{ kind: 'stat', stat: 'oc', value: 1, pick: 'self' }] }
      ]
    },
    {
      name: 'Guardsman "Alfred" 434-434', move: 4, maxWounds: 2, toughness: 4, oc: 1,
      notes: 'Many have found themselves with a bullet or dagger hole in their chest when they ' +
             'thought they were alone.',
      weapons: [
        { name: 'Lasgun', type: 'ranged', range: 18, hit: 2, strength: 4, damage: 1 },
        { name: 'Bolt Pistol', type: 'ranged', range: 12, hit: 3, strength: 3, damage: 1 },
        { name: 'Dagger', type: 'melee', range: 1, hit: 3, strength: 3, damage: 1, unlimited: true }
      ],
      abilities: [
        { name: 'Practiced Blade', trigger: 'passive', cost: 0,
          text: 'This unit\'s dagger can be used any number of times in the same action chain.',
          effects: [] },
        { name: 'Cloaked', trigger: 'passive', cost: 0,
          text: 'Enemy units greater than 6" away have -1 to hit this unit.',
          effects: [{ kind: 'aura', stat: 'hit', value: -1, side: 'enemy', onlyVsOwner: true,
                      weapon: 'any', range: 6, mode: 'beyond',
                      text: 'Cloaked: enemy units further than 6" away have -1 to hit this unit.' }] },
        { name: 'Grappling Hook', trigger: 'ap', cost: 1, moves: true,
          text: 'Use only if terrain is within 3". Move this unit up to 5" in the direction of ' +
                'the terrain, ignoring height. Your opponent gains 1 AP.',
          effects: [{ kind: 'ap_opponent', value: 1 },
                    { kind: 'note',
                      text: 'Move up to 5" toward the terrain, ignoring height.' }] }
      ]
    },
    {
      name: 'Commissar Briant', move: 4, maxWounds: 2, toughness: 4, oc: 2,
      notes: '"I don\'t even want to hear it." BLAM.',
      weapons: [
        { name: 'Bolt Pistol', type: 'ranged', range: 12, hit: 2, strength: 3, damage: 1 },
        { name: 'Uppercut', type: 'melee', range: 1, hit: 3, strength: 2, damage: 1 }
      ],
      abilities: [
        { name: "It's My Job", trigger: 'passive', cost: 0,
          text: 'Units in your squad cannot WITHDRAW. Units in your squad within 6" have +1 to ' +
                'hit for ranged attacks.',
          effects: [
            { kind: 'blockreact', reaction: 'withdraw' },
            { kind: 'aura', stat: 'hit', value: 1, side: 'friendly', onlyVsOwner: false,
              weapon: 'ranged', range: 6, mode: 'within',
              text: 'Units in your squad within 6" of Commissar Briant have +1 to hit for ranged attacks.' }
          ] },
        { name: "It's Your Job", trigger: 'rp', cost: 1,
          text: 'Choose one of your units that would be an eligible target for the enemy unit\'s ' +
                'attack. It targets that unit instead.',
          effects: [{ kind: 'redirect' }] }
      ]
    },
    {
      name: 'Guardsman "Nick" 847-832', move: 4, maxWounds: 2, toughness: 3, oc: 1,
      notes: 'Legend has it he once made a nick in a Chaos Lord\'s armor. ' +
             '847-832 has neither confirmed nor denied.',
      weapons: [
        { name: 'Lasgun', type: 'ranged', range: 18, hit: 3, strength: 4, damage: 1 },
        { name: 'Bolt Pistol', type: 'ranged', range: 12, hit: 3, strength: 3, damage: 1 },
        { name: 'Bayonet', type: 'melee', range: 2, hit: 4, strength: 4, damage: 1 }
      ],
      abilities: [
        { name: 'Cloaked', trigger: 'passive', cost: 0,
          text: 'Enemy units greater than 6" away have -1 to hit this unit.',
          effects: [{ kind: 'aura', stat: 'hit', value: -1, side: 'enemy', onlyVsOwner: true,
                      weapon: 'any', range: 6, mode: 'beyond',
                      text: 'Cloaked: enemy units further than 6" away have -1 to hit this unit.' }] },
        { name: 'Grenade', trigger: 'rp', cost: 1,
          text: 'Place a grenade token up to D6" away from this unit\'s position. It deals 1 ' +
                'damage to each unit within 3" of it at the end of this action chain.',
          effects: [{ kind: 'token', label: 'GRENADE', expiry: 'chain',
                      text: 'At the end of this action chain, tick every unit within 3" of the ' +
                            'token — each takes 1 damage.',
                      tokenEffects: [{ kind: 'damage', value: 1, pick: 'multi' }] }] }
      ]
    }
  ]
},
{
  id: 'greyknights',
  name: 'Grey Knights',
  note: 'The official line-up. Carries a faction card with its own resource.',
  /* A faction card: a pool the player spends in their Start Phase. */
  card: {
    id: 'gk_psychic',
    name: 'GREY KNIGHTS PSYCHIC',
    tagline: 'GAIN 1 PSY EVERY TURN',
    resource: { name: 'PSY', start: 4, perTurn: 1 },
    lines: [
      'The Grey Knights begin the game with 4 PSY points.',
      'START: You may spend PSY points on an ability on this card.'
    ],
    abilities: [
      { id: 'gk_barrage', name: 'Sanctifying Barrage', cost: 1,
        text: 'Your next attack with a Storm Bolter rolls 2 dice rather than 1.',
        effects: [{ kind: 'dice', value: 2, weaponName: 'Storm Bolter', scope: 'player',
                    text: 'Your next attack with a Storm Bolter rolls 2 dice rather than 1.' }] },
      { id: 'gk_warpstride', name: 'Warpstride', cost: 1,
        text: 'Add 3" to a friendly unit\'s move characteristic until the end of this action chain.',
        effects: [{ kind: 'mod_move', value: 3, pick: 'prompt', side: 'friendly', duration: 'chain',
                    text: '+3" MOV until the end of this action chain.' }] },
      { id: 'gk_gate', name: 'Gate of Infinity', cost: 2, moves: true,
        text: 'Choose a friendly unit. Place that unit anywhere on the battlefield. This ' +
              'triggers overwatch. That unit may not MOVE this turn.',
        effects: [{ kind: 'place', pick: 'prompt', side: 'friendly', noMoveThisTurn: true,
                    text: 'Place that unit anywhere on the battlefield.' }] }
    ]
  },
  units: [
    {
      name: 'Brother Drusius', move: 5, maxWounds: 2, toughness: 5, oc: 1,
      reserve: true,
      notes: '"The fires of purity thirst for your blood!"',
      weapons: [
        { name: 'Storm Bolter', type: 'ranged', range: 12, hit: 2, strength: 3, damage: 1 },
        { name: 'Purifying Flame', type: 'ranged', range: 18, hit: null, strength: null, damage: null,
          notes: 'The card gives this weapon a range of 18" and no Hit, Strength or Damage — ' +
                 'fill them in before you use it.' },
        { name: 'Nemesis Halberd', type: 'melee', range: 2, hit: 3, strength: 4, damage: 1 }
      ],
      abilities: [
        { name: 'Deep Strike', trigger: 'ap', cost: 1, moves: true, opponentReacts: true,
          text: 'This unit does not start on the battlefield. Instead, on one of your turns, ' +
                'you may spend 1 AP to place this unit anywhere on the battlefield more than ' +
                '6" away from an enemy unit. This ability triggers overwatch.',
          effects: [{ kind: 'place', pick: 'self', fromReserve: true,
                      text: 'Place this unit anywhere more than 6" away from an enemy unit.' }] },
        { name: 'Unescapable Wrath', trigger: 'passive', cost: 0,
          text: 'Enemy unit\'s cannot DIVE when this unit uses its Purifying Flame.',
          effects: [{ kind: 'blockreact', reaction: 'dive', scope: 'enemy',
                      weaponName: 'Purifying Flame' }] }
      ]
    },
    {
      name: 'Brother Lucius', move: 5, maxWounds: 2, toughness: 4, oc: 1,
      notes: 'Death from above.',
      weapons: [
        { name: 'Psilencer', type: 'ranged', range: 18, hit: 4, strength: 3, damage: 1 },
        { name: 'Gauntleted Fist', type: 'melee', range: 1, hit: 3, strength: 3, damage: 1 }
      ],
      abilities: [
        { name: 'Heavy Gatling', trigger: 'passive', cost: 0,
          text: 'This unit\'s Psilencer rolls 4 dice instead of one if this unit has not ' +
                'moved this turn.',
          effects: [{ kind: 'dice', value: 4, weaponName: 'Psilencer', condition: 'notmoved',
                      text: 'Heavy Gatling: the Psilencer rolls 4 dice if this unit has not ' +
                            'moved this turn.' }] },
        { name: 'Warp Shift', trigger: 'ap', cost: 2, moves: true, opponentReacts: true,
          text: 'Place this unit anywhere on any elevated part of the battlefield. This ' +
                'ability triggers overwatch.',
          effects: [{ kind: 'place', pick: 'self',
                      text: 'Place this unit anywhere on any elevated part of the battlefield.' }] }
      ]
    },
    {
      name: 'Justicar Aurelius', move: 5, maxWounds: 3, toughness: 5, oc: 2,
      notes: '"Your blasphemous acts shall reach no further."',
      weapons: [
        { name: 'Storm Bolter', type: 'ranged', range: 12, hit: 2, strength: 3, damage: 1 },
        { name: 'Smite', type: 'ranged', range: 18, hit: 3, strength: 4, damage: 1 },
        { name: 'Nemesis Sword', type: 'melee', range: 1, hit: 2, strength: 5, damage: 2 }
      ],
      abilities: [
        { name: 'Gate of Infinity', trigger: 'end', cost: 0, usesPerGame: 1, moves: true,
          text: 'Usable once per game. Place up to two friendly units anywhere on the ' +
                'battlefield greater than 6" away from an enemy unit. This ability triggers ' +
                'overwatch.',
          effects: [{ kind: 'place', pick: 'multi', side: 'friendly', max: 2,
                      text: 'Place up to two friendly units anywhere greater than 6" away ' +
                            'from an enemy unit.' }] },
        { name: 'Into the Warp', trigger: 'ap', cost: 1, usesPerTurn: 1, opponentReacts: false,
          text: 'Usable once per turn. Roll 1 D6 for each enemy unit within 6". For each 5+, ' +
                'deal 1 damage to that enemy unit. Your opponent gains 1 AP for each unit ' +
                'damaged in this way, to a maximum of 2. End the action chain.',
          effects: [{ kind: 'damage', value: 1, pick: 'multi', side: 'enemy',
                      text: 'Roll 1 D6 for each enemy unit within 6" — tick each one that ' +
                            'rolled 5+.' },
                    { kind: 'ap_opponent', perDamaged: true, max: 2, value: 1 }] }
      ]
    }
  ]
},
{
  id: 'marines',
  name: 'Space Marines',
  note: 'An example roster, not an official card.',
  units: [
    {
      name: 'Intercessor Sergeant', move: 6, maxWounds: 3, toughness: 4, oc: 2,
      weapons: [
        { name: 'Bolt Rifle', type: 'ranged', range: 24, hit: 3, strength: 4, damage: 1 },
        { name: 'Power Fist', type: 'melee', range: 1, hit: 3, strength: 8, damage: 2 }
      ],
      abilities: [
        { name: 'Squad Discipline', trigger: 'rp', cost: 1,
          text: 'Subtract 1 from the attacker\'s Wound roll and gain 1 AP.',
          effects: [{ kind: 'mod_wound', value: -1, pick: 'attacker', duration: 'attack' },
                    { kind: 'ap_self', value: 1 }] }
      ]
    },
    {
      name: 'Scout with Sniper', move: 6, maxWounds: 2, toughness: 3, oc: 1,
      weapons: [
        { name: 'Sniper Rifle', type: 'ranged', range: 36, hit: 3, strength: 5, damage: 2 },
        { name: 'Combat Knife', type: 'melee', range: 1, hit: 4, strength: 3, damage: 1 }
      ],
      abilities: [
        { name: 'Proximity Mine', trigger: 'ap', cost: 1,
          text: 'Place a mine. When an enemy triggers it, it suffers 2 damage.',
          effects: [{ kind: 'token', label: 'PROXIMITY MINE', expiry: 'used',
                      text: 'Deals 2 damage to the unit that triggered it.',
                      tokenEffects: [{ kind: 'damage', value: 2, pick: 'prompt' }] }] },
        { name: 'Camo Cloak', trigger: 'passive', cost: 0,
          text: 'Enemies shooting this unit from further than 12" are at -1 to hit.',
          effects: [{ kind: 'aura', stat: 'hit', value: -1, side: 'enemy', onlyVsOwner: true,
                      weapon: 'ranged', range: 12, mode: 'beyond',
                      text: 'Camo Cloak: shots from further than 12" are at -1 to hit.' }] }
      ]
    }
  ]
},
{
  id: 'orks',
  name: 'Orks',
  note: 'The official line-up.',
  units: [
    {
      name: 'Snitcherz', move: 2, maxWounds: 1, toughness: 3, oc: 1,
      notes: '"GIMME DAT!"',
      weapons: [
        { name: 'Blasta', type: 'ranged', range: 12, hit: 5, strength: 3, damage: 1 },
        { name: 'Klaw', type: 'melee', range: 1, hit: 4, strength: 4, damage: 'D3' }
      ],
      abilities: [
        { name: 'Small', trigger: 'passive', cost: 0,
          text: 'Enemy units have -1 to hit this unit.',
          effects: [{ kind: 'aura', stat: 'hit', value: -1, side: 'enemy', onlyVsOwner: true,
                      weapon: 'any', mode: 'always',
                      text: 'Small: enemy units have -1 to hit this unit.' }] },
        { name: 'Unpredictable', trigger: 'ap', cost: 1, opponentReacts: false, moves: true,
          text: 'Use only on your turn. Move this unit D6". End the action chain.',
          effects: [{ kind: 'note', text: 'Roll a D6 and move this unit that far.' }] }
      ]
    },
    {
      name: 'Boss Nob Blikker', move: 4, maxWounds: 3, toughness: 5, oc: 2,
      notes: '"You think dat is imprezzive? You ain\'t seen ME go dakka."',
      weapons: [
        { name: 'Slugga', type: 'ranged', range: 12, hit: 4, strength: 3, damage: 1 },
        { name: 'Power Klaw', type: 'melee', range: 1, hit: 3, strength: 5, damage: 2 }
      ],
      abilities: [
        { name: 'Intimidating Presence', trigger: 'passive', cost: 0,
          text: 'Each friendly unit within 6" has +1 to wound.',
          effects: [{ kind: 'aura', stat: 'wound', value: 1, side: 'friendly',
                      onlyVsOwner: false, weapon: 'any', range: 6, mode: 'within',
                      text: 'Intimidating Presence: friendly units within 6" of Boss Nob Blikker ' +
                            'have +1 to wound.' }] },
        { name: 'WAAAAAGH', trigger: 'ap', cost: 1, usesPerGame: 1, opponentReacts: false, moves: true,
          text: 'Usable only once per game. Move each of your units up to D6". End the action chain.',
          effects: [{ kind: 'note', text: 'Roll a D6 and move each of your units up to that far.' }] }
      ]
    },
    {
      name: 'Da Hunta', move: 4, maxWounds: 2, toughness: 4, oc: 1,
      notes: '"I smell you..."',
      weapons: [
        { name: 'Shoota', type: 'ranged', range: 18, hit: 3, strength: 4, damage: 1 },
        { name: 'Choppa', type: 'melee', range: 1, hit: 3, strength: 4, damage: 1 }
      ],
      abilities: [
        { name: 'Da Hunta', trigger: 'gamestart', cost: 0,
          text: 'At the beginning of the game choose one enemy unit. That unit becomes MARKED.',
          effects: [{ kind: 'mark', label: 'MARKED', pick: 'prompt', side: 'enemy',
                      duration: 'manual', text: 'MARKED by Da Hunta.' }] },
        { name: 'Gud at His Job', trigger: 'passive', cost: 0,
          text: 'This unit\'s Shoota has +1 damage against a MARKED unit.',
          effects: [{ kind: 'markbonus', label: 'MARKED', value: 1, weaponName: 'Shoota' }] },
        { name: "Don't ya Dare", trigger: 'rp', cost: 1,
          text: 'Remove any MARKED tokens on enemy units. The enemy unit that targeted this unit ' +
                'becomes MARKED.',
          effects: [{ kind: 'unmark', label: 'MARKED' },
                    { kind: 'mark', label: 'MARKED', pick: 'attacker', duration: 'manual',
                      text: 'MARKED by Da Hunta.' }] }
      ]
    },
    {
      name: 'Riksnik', move: 3, maxWounds: 1, toughness: 3, oc: 1,
      notes: '"RRRREEEEEEEEEEEETTTTTTT!!!!!!!!!!!!"',
      weapons: [
        { name: 'Blasta', type: 'ranged', range: 12, hit: 5, strength: 3, damage: 1 },
        { name: 'Fast Fists', type: 'melee', range: 1, hit: 4, strength: 3, damage: 1 }
      ],
      abilities: [
        { name: 'Small', trigger: 'passive', cost: 0,
          text: 'Enemy units have -1 to hit this unit.',
          effects: [{ kind: 'aura', stat: 'hit', value: -1, side: 'enemy', onlyVsOwner: true,
                      weapon: 'any', mode: 'always',
                      text: 'Small: enemy units have -1 to hit this unit.' }] },
        { name: "Spin an' spray", trigger: 'ap', cost: 1,
          text: 'Each unit within 6", including this one, make a save 3+ or takes 1 damage. If ' +
                'this unit dies, nobody gets VP. Your opponent gains 1 AP.',
          effects: [{ kind: 'damage', value: 1, pick: 'multi' },
                    { kind: 'ap_opponent', value: 1 },
                    { kind: 'note',
                      text: 'Every unit within 6" — Riksnik included — rolls a D6. On 1-2 it ' +
                            'takes 1 damage. If Riksnik dies to this, nobody scores VP.' }] }
      ]
    },
    {
      name: 'Mikaaaaghhh', move: 4, maxWounds: 2, toughness: 4, oc: 1,
      notes: '"MIKAAAAGHHH wut did you do dat for?!"',
      weapons: [
        { name: 'Slugga', type: 'ranged', range: 12, hit: 5, strength: 3, damage: 1 },
        { name: 'Choppa', type: 'melee', range: 1, hit: 3, strength: 5, damage: 1 }
      ],
      abilities: [
        { name: 'Get In Front of Me', trigger: 'rp', cost: 1, moves: true,
          text: 'Move a friendly unit within 3" up to 3". If that unit now is in the line of ' +
                'fire, that unit is targeted by the attack instead.',
          effects: [{ kind: 'redirect' }] },
        { name: 'Kwik Dakka', trigger: 'rp', cost: 1,
          text: 'This unit makes an attack against the attacking enemy unit before their attack ' +
                'resolves. The enemy unit gets no RP. If the enemy unit is defeated, they do not ' +
                'get to resolve their attack.',
          effects: [{ kind: 'attack', weapon: 'ranged', noRP: true, hitMod: 0, skipWound: false }] }
      ]
    }
  ]
}
];

/* =========================================================================
   RULES — Warhammer Skirmishes
   Pure data + pure functions. No state, no DOM.
   Everything the engine needs to know about Standard Actions, Reactions and
   the wound table lives here, so house-ruling the game means editing this
   file only.
   ========================================================================= */

const RULES = (function () {

  /* --------------------------------------------------------------------
     STANDARD ACTIONS
     cost            : AP cost (null = variable, taken from the ability)
     kind            : 'aggressive' | 'passive'   (rules keyword)
     flow            : which guided flow the app runs
     endsChain       : does resolving this action end the action chain
     opponentGainsAP : AP handed to the opponent purely for using the action
                       (attacks grant their AP through the attack sequence
                       instead, so those are 0 here)
     onlyOnYourTurn  : may only be used by the player whose turn it is
     onlyInChain     : may only be used while an action chain is running
     notInChain      : may not be used while an action chain is running
     expiresOverwatch: using it removes this unit's own overwatch token
     -------------------------------------------------------------------- */
  const actions = [
    {
      id: 'move', name: 'MOVE', cost: 1, kind: 'passive', flow: 'simple',
      short: 'Move up to the unit\'s Move characteristic. The chain ends.',
      flavour: '“Positioning is everything.”',
      text: 'Move a friendly unit up to its Move characteristic. The action chain ends.',
      prompt: 'Move the unit up to its Move characteristic on the tabletop.',
      endsChain: true, opponentGainsAP: 0, onlyOnYourTurn: true,
      movesUnit: true, expiresOverwatch: true
    },
    {
      id: 'shoot', name: 'SHOOT', cost: 1, kind: 'aggressive', flow: 'attack',
      attackRange: 'ranged',
      short: 'Ranged attack. The defender gains 1 RP and picks a Ranged Reaction.',
      flavour: '“I think I got ‘em!”',
      text: 'Resolve the shoot sequence: declare an unused weapon and an eligible ranged target, ' +
            'the defender gains 1 RP and may spend it on a Ranged Reaction, then Hit, Wound and ' +
            'damage. A survivor gains 1 AP; a kill scores 1 VP and ends the action chain. ' +
            'Shooting from higher elevation gives +1 to Hit.',
      endsChain: false, opponentGainsAP: 0,
      elevation: 'shoot',
      expiresOverwatch: true
    },
    {
      id: 'charge', name: 'CHARGE', cost: 2, kind: 'aggressive', flow: 'attack',
      attackRange: 'melee', isCharge: true,
      short: 'Move 1D6" then fight. Opponent gains 1 AP. From high ground: +1 Wound, +1 Damage.',
      flavour: '“Close the distance.”',
      text: 'Move up to 1D6" toward an enemy unit. You must end within range of at least one of ' +
            'your melee weapons, or not make the move at all. Resolve the fight sequence against ' +
            'that unit. Your opponent gains 1 AP. Charging from higher elevation gives +1 to ' +
            'Wound and +1 Damage.',
      prompt: 'Roll 1D6 and move that far toward the target. You must end in melee range or not move at all.',
      elevation: 'charge',
      endsChain: false, opponentGainsAP: 1,
      movesUnit: true, expiresOverwatch: true
    },
    {
      id: 'fight', name: 'FIGHT', cost: 1, kind: 'aggressive', flow: 'attack',
      attackRange: 'melee',
      short: 'Melee attack. The defender gains 1 RP and picks a Melee Reaction.',
      flavour: '“Finish the job.”',
      text: 'Resolve the fight sequence: declare an unused weapon and an eligible melee target, ' +
            'the defender gains 1 RP and may spend it on a Melee Reaction, then Hit, Wound and ' +
            'damage. A survivor gains 1 AP; a kill scores 1 VP and ends the action chain.',
      endsChain: false, opponentGainsAP: 0,
      expiresOverwatch: true
    },
    {
      id: 'overwatch', name: 'OVERWATCH', cost: 1, kind: 'passive', flow: 'overwatch',
      short: 'Place a token within 12". Interrupt later with a shoot sequence at -1 to hit, and no RP for them.',
      flavour: '“Come into my sights.”',
      text: 'Place an overwatch token within 12" of this unit. If an enemy unit moves within 3" ' +
            'of that token and is eligible to be targeted by at least one of this unit\'s ranged ' +
            'weapons, you may interrupt your opponent\'s action and immediately resolve the shoot ' +
            'sequence against it at -1 to hit, skipping steps 2 and 3 — the defender gains no RP. ' +
            'If the unit that used this action moves or attacks, immediately remove the token.',
      prompt: 'Place an overwatch token within 12" of this unit.',
      endsChain: false, opponentGainsAP: 0
    },
    {
      id: 'ability', name: 'SPECIAL ABILITY', cost: null, kind: 'passive', flow: 'ability',
      short: 'Use one of this unit\'s “[X] AP —” actions.',
      flavour: '“Watch this.”',
      text: 'Use one of your units\' actions that begins with “[X] AP —”.',
      endsChain: false, opponentGainsAP: 0
    },
    /* --- unlocked by a mission card, hidden otherwise --- */
    {
      id: 'secure', name: 'SECURE', cost: 1, kind: 'passive', flow: 'secure',
      mission: 'secure',
      short: 'Take control of an objective marker. It stays yours until an enemy SECURES it.',
      flavour: '“Ours now.”',
      text: 'A unit may spend 1 AP to SECURE an objective. A SECURED objective remains controlled ' +
            'by the player that SECURED it until an enemy SECURES it.',
      endsChain: false, opponentGainsAP: 0
    },
    {
      id: 'relic', name: 'PICK UP THE RELIC', cost: 1, kind: 'passive', flow: 'relic',
      mission: 'relic',
      short: 'Take the RELIC. Its carrier cannot use OVERWATCH.',
      flavour: '“Mine.”',
      text: 'A unit can spend 1 AP to pick up the RELIC if they are within 3" of it. Units with ' +
            'the RELIC cannot use OVERWATCH. If the carrier is destroyed, place the RELIC within ' +
            '1" of where it was destroyed.',
      endsChain: false, opponentGainsAP: 0
    },
    {
      id: 'pass', name: 'PASS', cost: 0, kind: 'passive', flow: 'pass',
      short: 'Decline to act. On your own turn you may end the turn. Two passes in a row end the chain.',
      flavour: '“Let’s see what they do.”',
      text: 'If it is your turn, you may end your turn. Nothing else happens — but if both ' +
            'players pass consecutively, the action chain ends.',
      endsChain: false, opponentGainsAP: 0, noUnit: true, isPass: true
    }
  ];

  /* --------------------------------------------------------------------
     REACTIONS
     hitMod / woundMod : modifier applied to the ATTACKER's roll
     grantAP           : AP the reacting player gains immediately
     grantAPOnSurvive  : extra AP if the defender survives (on top of the
                         standard 1 AP the rules already give)
     noAPGrant         : suppresses the standard "survivor gains 1 AP"
     freeChoice        : the AP is no longer locked to the defending unit
     chainLivesOnDeath : the chain does not end even if the defender dies
     endsChain         : force the chain to end after this attack
     -------------------------------------------------------------------- */
  const rangedReactions = [
    { id: 'dodge', name: 'DODGE', cost: 1, hitMod: -1, moves: true,
      flavour: '“Thought you had me, didn’t ya?”',
      text: 'Subtract 1 from the attacker\'s Hit roll. Move 1".',
      tabletop: 'Move the defender 1".' },

    { id: 'duck', name: 'DUCK', cost: 1, woundMod: -1,
      flavour: '“GET DOWN YOU IDIOT!”',
      text: 'Subtract 1 from the attacker\'s Wound roll. This unit cannot move for your next AP.',
      selfEffect: { label: 'Cannot move', duration: 'nextAP',
                    detail: 'This unit cannot move for your next AP (DUCK).' } },

    { id: 'dive', name: 'DIVE', cost: 1, moves: true,
      flavour: '“Who cares if your knees get dirty?!”',
      text: 'Move 3".',
      tabletop: 'Move the defender 3". If that takes it out of sight, the attack cannot be ' +
                'performed — use “COULD NOT BE PERFORMED”.' },

    { id: 'distract', name: 'DISTRACT', cost: 1, hitMod: +1, grantAP: 1,
      freeChoice: true, chainLivesOnDeath: true,
      flavour: '“Sometimes the best defense is to hit them from where they\'re not looking.”',
      text: 'The enemy unit gets +1 to hit. Gain 1 AP. Do not end the action chain if this unit ' +
            'is defeated. Your next AP may be spent on any friendly unit, as if the attack had ' +
            'been a Passive Action.' },

    { id: 'special', name: 'SPECIAL RP', cost: null, isSpecial: true,
      flavour: '“This one’s just for you.”',
      text: 'Use one of your unit\'s abilities that begins with “[X] RP —”.' }
  ];

  const meleeReactions = [
    { id: 'parry', name: 'PARRY', cost: 1, woundMod: -1, grantAPOnSurvive: 1,
      flavour: '“I can do this all day.”',
      text: 'Subtract 1 from the attacker\'s Wound roll. If your unit is not defeated after the ' +
            'attack, gain 1 AP.' },

    { id: 'evade', name: 'EVADE', cost: 1, hitMod: -1,
      flavour: '“Slip past the blow.”',
      text: 'Subtract 1 from the attacker\'s Hit roll. This unit gains +1 to hit until the end of ' +
            'this action chain.',
      selfEffect: { label: '+1 to hit', duration: 'chain', hitBonus: 1,
                    detail: 'This unit has +1 to hit until the end of this action chain (EVADE).' } },

    { id: 'withdraw', name: 'WITHDRAW', cost: 1, endsChain: true, moves: true,
      flavour: '“Courage isn’t always wise.”',
      text: 'If your unit survives this attack, it moves 3". End the action chain.',
      onSurviveTabletop: 'Move the defender 3".' },

    { id: 'focus', name: 'FOCUS', cost: 1,
      flavour: '“Not all fights are won with strength.”',
      text: 'This unit gains +2 to wound until the end of this action chain.',
      selfEffect: { label: '+2 to wound', duration: 'chain', woundBonus: 2,
                    detail: 'This unit has +2 to wound until the end of this action chain (FOCUS).' } },

    { id: 'special', name: 'SPECIAL RP', cost: null, isSpecial: true,
      flavour: '“This one’s just for you.”',
      text: 'Use one of your unit\'s abilities that begins with “[X] RP —”.' }
  ];

  /* --------------------------------------------------------------------
     MISSION CARDS — the six printed cards.

     markers       : objects placed on the table that the app tracks as units
                     (they can be attacked, they have no RP)
     unitFlag      : a status the players assign to one of their own units
     controlPoints : objective markers whose controller the app remembers
     extraActions  : Standard Actions this mission unlocks
     endTurn       : what the End Phase should read back and offer to score
     -------------------------------------------------------------------- */
  const missions = [
    {
      id: 'sabotage', name: 'SABOTAGE',
      flavour: '“You don’t have to kill everything. Just the right thing.”',
      battlefield: ['Each player places one OBJECTIVE in their deployment area.'],
      objective: ['Score 3 VP when the enemy OBJECTIVE is destroyed and end the game.',
                  'The game ends when a player reaches 10 VP.'],
      special: ['An OBJECTIVE has 5 Wounds, Toughness 4, and you may attack it as if it were an ' +
                'enemy unit. It has no RP.'],
      vpTarget: 10,
      endsWhen: 'a player reaches 10 VP, or an OBJECTIVE is destroyed',
      endsShort: 'FIRST TO 10 VP',
      markersPerPlayer: [{ label: 'OBJECTIVE', wounds: 5, toughness: 4, killVP: 3, endsGame: true }],
      endTurn: []
    },
    {
      id: 'hill', name: 'KING OF THE HILL',
      flavour: '“The high ground belongs to whoever can hold it.”',
      battlefield: ['Place the tallest terrain near the center of the battlefield. It’s highest ' +
                    'point is called the HIGH GROUND.'],
      objective: ['At the end of each turn, the player with a unit on the HIGH GROUND gains 1 VP.',
                  'The unit on the HIGH GROUND is worth 2 VP instead of 1 VP when destroyed.',
                  'The game ends when a player reaches 10 VP.'],
      special: ['None.'],
      vpTarget: 10,
      endsWhen: 'a player reaches 10 VP',
      endsShort: 'FIRST TO 10 VP',
      unitFlag: {
        id: 'highground', label: 'HIGH GROUND', scope: 'any', killVP: 2,
        hint: 'Tap a unit’s DETAILS to mark it as standing on the HIGH GROUND. The app will then ' +
              'suggest 2 VP if it is destroyed.'
      },
      endTurn: [{ id: 'hill-vp', name: 'The HIGH GROUND',
                  text: 'At the end of each turn, the player with a unit on the HIGH GROUND gains 1 VP.',
                  vp: 1 }]
    },
    {
      id: 'ambush', name: 'AMBUSH',
      flavour: '“The first shot is yours. The last one might not be.”',
      battlefield: ['The defending player sets up first, and they also set up a BAIT token in ' +
                    'their deploy zone. The attacking player sets up their units second.'],
      objective: ['The attacking player scores 4 VP for destroying the enemy’s BAIT.',
                  'The defending player scores 2 VP instead of 1 VP for every enemy unit they ' +
                  'defeat in their deployment zone.',
                  'When all of a player’s units are dead the game ends.'],
      special: ['The BAIT has 3 Wounds and 4 Toughness. It can be attacked like an enemy unit but ' +
                'has no RP.',
                'All units have -1 Wounds to a minimum of 1.'],
      vpTarget: null,
      endsWhen: 'all of a player’s units are dead',
      endsShort: 'LAST ONE STANDING',
      roles: { defender: 'DEFENDER — sets up first, with the BAIT',
               attacker: 'ATTACKER — sets up second' },
      markersForRole: { role: 'defender',
        markers: [{ label: 'BAIT', wounds: 3, toughness: 4, killVP: 4, killVPFor: 'attacker' }] },
      rosterMod: { woundsDelta: -1, woundsMin: 1 },
      endsWhenAPlayerIsWipedOut: true,
      killNote: 'The defending player scores 2 VP instead of 1 for a kill in their own deployment zone.',
      endTurn: []
    },
    {
      id: 'assassination', name: 'ASSASSINATION',
      flavour: '“Men, we have received a special target.”',
      battlefield: ['Before the game, each player chooses one of their units as their TARGET. ' +
                    'Place one objective marker in the center of the battlefield.'],
      objective: ['Standard scoring of objectives.',
                  'If the enemy TARGET is destroyed, score 3 VP.',
                  'Game ends when a player reaches 10 VP'],
      special: ['The TARGET has +1 Wounds.'],
      vpTarget: 10,
      endsWhen: 'a player reaches 10 VP',
      endsShort: 'FIRST TO 10 VP',
      unitFlag: {
        id: 'target', label: 'TARGET', scope: 'onePerPlayer', killVP: 3, boostWounds: 1,
        pickAtSetup: true,
        hint: 'Each player names one of their units as the TARGET. It gains +1 Wound, and killing ' +
              'an enemy TARGET is worth 3 VP.'
      },
      endTurn: [{ id: 'assn-obj', name: 'Standard scoring of objectives',
                  text: 'The objective marker in the center of the battlefield.', vp: 1 }]
    },
    {
      id: 'secure', name: 'SECURE THE AREA',
      flavour: '“Hold the ground.”',
      battlefield: ['Place three objective markers: one in the center and one on each side of the ' +
                    'battlefield.'],
      objective: ['At the end of each turn, a player gains 1 VP for each objective they control.',
                  'The game ends when a player reaches 10 VP.'],
      special: ['A unit may spend 1 AP to SECURE an objective.',
                'A SECURED objective remains controlled by the player that SECURED it until an ' +
                'enemy SECURES it.'],
      vpTarget: 10,
      endsWhen: 'a player reaches 10 VP',
      endsShort: 'FIRST TO 10 VP',
      controlPoints: ['LEFT', 'CENTER', 'RIGHT'],
      extraActions: ['secure'],
      endTurn: [{ id: 'secure-vp', name: 'Objectives controlled', autoVP: 'controlPoints',
                  text: 'At the end of each turn, a player gains 1 VP for each objective they ' +
                        'control. The app counts the ones it has seen SECURED.' }]
    },
    {
      id: 'relic', name: 'THE RELIC',
      flavour: '“Dat’s MY shiny, ya hear me?”',
      battlefield: ['Place one RELIC marker in the center of the battlefield.'],
      objective: ['If a carrier of the RELIC reaches their side of the battlefield, that player ' +
                  'scores 3 VP and the game ends.'],
      special: ['Units with the RELIC cannot use OVERWATCH.',
                'A unit can spend 1 AP to pick up the RELIC if they are within 3" of it.',
                'If the carrier is destroyed, place the RELIC within 1" where it was destroyed.'],
      vpTarget: null,
      endsWhen: 'a RELIC carrier reaches their own side of the battlefield',
      endsShort: 'RELIC CARRIED HOME',
      relic: true,
      extraActions: ['relic'],
      endTurn: [{ id: 'relic-home', name: 'Relic carried home', vp: 3, endsGame: true,
                  text: 'If a carrier of the RELIC reaches their side of the battlefield, that ' +
                        'player scores 3 VP and the game ends.' }]
    }
  ];

  const missionById = id => missions.find(m => m.id === id) || null;

  /* The standard game mode, used when no Mission Card is chosen. */
  const standardScoring = {
    id: 'standard-oc',
    name: 'Objective control',
    text: '1 VP for each objective where you have the most OC, at the end of your turn.',
    vp: 1
  };

  /* --------------------------------------------------------------------
     WOUND TABLE
     DOUBLE OR MORE = 2+   GREATER = 3+   EQUAL = 4+
     LESS THAN      = 5+   HALF OR LESS = 6+
     -------------------------------------------------------------------- */
  function woundTarget(strength, toughness) {
    const s = Number(strength), t = Number(toughness);
    if (!isFinite(s) || !isFinite(t) || s <= 0 || t <= 0) return null;
    if (s >= t * 2) return 2;
    if (s > t) return 3;
    if (s === t) return 4;
    return 5;
  }

  function woundLabel(strength, toughness) {
    const s = Number(strength), t = Number(toughness);
    if (s >= t * 2) return 'S is double or more T';
    if (s > t) return 'S is greater than T';
    if (s === t) return 'S is equal to T';
    return 'S is less than T';
  }

  /* Modified target number, clamped to the 2..6 range dice can express.
     Returns { target, capped } — capped means the modifier pushed it past
     the edge of the die. */
  function applyMod(target, mod) {
    if (target === null) return { target: null, capped: false };
    const raw = target - mod;            // -1 to the roll == +1 to the target
    const clamped = Math.max(2, Math.min(6, raw));
    return { target: clamped, capped: clamped !== raw, raw };
  }

  const actionById = id => actions.find(a => a.id === id) || null;
  const reactionById = (id, range) =>
    (range === 'melee' ? meleeReactions : rangedReactions).find(r => r.id === id) || null;

  return {
    version: '1.0',
    defaultVPTarget: 10,
    actions, rangedReactions, meleeReactions, missions, standardScoring,
    woundTarget, woundLabel, applyMod, actionById, reactionById, missionById,

    /* Ability trigger slots offered by the unit editor. */
    abilityTriggers: [
      { id: 'ap',      label: '[X] AP — Special Action',  hint: 'Used with the SPECIAL ABILITY action on your activation.' },
      { id: 'rp',      label: '[X] RP — Special Reaction', hint: 'Offered in the reaction list when this unit is attacked.' },
      { id: 'start',   label: 'START: —',                  hint: 'Offered in the Start Phase of its owner\'s turn.' },
      { id: 'end',     label: 'END: —',                    hint: 'Offered in the End Phase of its owner\'s turn.' },
      { id: 'passive', label: 'PASSIVE',                   hint: 'Always on. Shown on the card as a chip; hover or tap it for the text.' },
      { id: 'gamestart', label: 'AT THE START OF THE GAME', hint: 'Resolves itself before the first turn. The app asks for any choice it needs.' },
      { id: 'onkill',  label: 'WHEN THIS UNIT KILLS',       hint: 'Fires by itself the moment this unit destroys an enemy — optionally only with one named weapon.' },
      { id: 'free',    label: 'FREE / manual',             hint: 'A button on the unit card you may press at any time.' }
    ],

    /* Mechanical effect rows available in the ability builder. */
    effectKinds: [
      { id: 'ap_self',      label: 'Gain AP (you)',            num: true,  unit: 'AP' },
      { id: 'ap_opponent',  label: 'Opponent gains AP',        num: true,  unit: 'AP' },
      { id: 'ap_drain',     label: 'Opponent loses AP',        num: true,  unit: 'AP' },
      { id: 'rp_self',      label: 'Gain RP (you)',            num: true,  unit: 'RP' },
      { id: 'vp_self',      label: 'Score VP (you)',           num: true,  unit: 'VP' },
      { id: 'vp_opponent',  label: 'Opponent scores VP',       num: true,  unit: 'VP' },
      { id: 'damage',       label: 'Deal damage',              num: true,  unit: 'W', pick: 'any' },
      { id: 'heal',         label: 'Restore wounds',           num: true,  unit: 'W', pick: 'friendly' },
      { id: 'mod_hit',      label: 'Modify Hit rolls',         num: true,  unit: '', signed: true, pick: 'any', dur: true },
      { id: 'mod_wound',    label: 'Modify Wound rolls',       num: true,  unit: '', signed: true, pick: 'any', dur: true },
      { id: 'aura',         label: 'Aura — a radius that modifies rolls', aura: true },
      { id: 'mod_strength', label: 'Modify weapon Strength',    num: true, unit: '', signed: true, pick: 'any', dur: true },
      { id: 'mark',         label: 'Mark a unit (a chip that sticks)', mark: true },
      { id: 'unmark',       label: 'Clear a mark from enemy units', unmark: true },
      { id: 'markbonus',    label: 'Bonus damage against a marked unit', markbonus: true },
      { id: 'attack',       label: 'Make a free attack',       attack: true },
      { id: 'place',        label: 'Place a unit anywhere (teleport)', place: true },
      { id: 'dice',         label: 'Roll extra dice with one weapon', dice: true },
      { id: 'mod_move',     label: 'Modify MOV"',              num: true, unit: '"', signed: true, pick: 'any', dur: true },
      { id: 'stat',         label: 'Change a stat permanently', stat: true },
      { id: 'redirect',     label: 'Redirect the attack to another unit', redirect: true },
      { id: 'blockreact',   label: 'Stop friends using a Reaction', block: true },
      { id: 'token',        label: 'Place a token / button',   token: true },
      { id: 'note',         label: 'Reminder text only',       note: true }
    ],

    /* An aura is a radius the app cannot measure, so it is offered as a toggle
       on the roll it would change and the player says whether it applies. */
    auraSides: [
      { id: 'friendly', label: 'Friendly units attacking' },
      { id: 'enemy',    label: 'Enemy units attacking' }
    ],
    auraModes: [
      { id: 'within', label: 'within' },
      { id: 'beyond', label: 'further than' },
      { id: 'always', label: 'always — no radius to check' }
    ],
    auraStats: [
      { id: 'hit',      label: 'Hit rolls' },
      { id: 'wound',    label: 'Wound rolls' },
      { id: 'strength', label: 'the attacking weapon’s Strength' }
    ],
    weaponScopes: [
      { id: 'any',    label: 'any attack' },
      { id: 'ranged', label: 'ranged attacks only' },
      { id: 'melee',  label: 'melee attacks only' }
    ],
    statKinds: [
      { id: 'oc',        label: 'OC' },
      { id: 'move',      label: 'MOV"' },
      { id: 'toughness', label: 'Toughness' },
      { id: 'maxWounds', label: 'Max Wounds' }
    ],

    durations: [
      { id: 'attack',  label: 'This attack only' },
      { id: 'nextAP',  label: 'Until after your next AP' },
      { id: 'chain',   label: 'Until this action chain ends' },
      { id: 'turn',    label: 'Until the end of this turn' },
      { id: 'round',   label: 'Until your next turn' },
      { id: 'manual',  label: 'Until removed by hand' }
    ],

    tokenExpiries: [
      { id: 'chain',   label: 'End of this action chain' },
      { id: 'turn',    label: 'End of this turn' },
      { id: 'round',   label: 'Start of your next turn' },
      { id: 'used',    label: 'When it is triggered' },
      { id: 'manual',  label: 'Never — remove by hand' },
      { id: 'ownerActs', label: 'When its unit moves or attacks' }
    ]
  };
})();

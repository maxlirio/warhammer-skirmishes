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
      expiresOverwatch: true
    },
    {
      id: 'shoot', name: 'SHOOT', cost: 1, kind: 'aggressive', flow: 'attack',
      attackRange: 'ranged',
      short: 'Ranged attack. The defender gains 1 RP and picks a Ranged Reaction.',
      flavour: '“I think I got ‘em!”',
      text: 'Choose an eligible target within range of one of your ranged weapons. ' +
            'Your opponent gains 1 RP and spends it on a Ranged Reaction. Resolve the attack. ' +
            'If the target survives it gains 1 AP. If it is destroyed, score 1 VP and end the chain. ' +
            'Shooting from higher elevation gives +1 to Hit.',
      endsChain: false, opponentGainsAP: 0,
      elevation: 'shoot',
      expiresOverwatch: true
    },
    {
      id: 'charge', name: 'CHARGE', cost: 2, kind: 'aggressive', flow: 'attack',
      attackRange: 'melee', isCharge: true,
      short: 'Move 1D6" then FIGHT for free. From high ground: +1 Wound, +1 Damage.',
      flavour: '“Close the distance.”',
      text: 'Move up to 1D6" toward an enemy unit — you must end within range of one of your ' +
            'melee weapons or not move at all. Then take a FIGHT action against that unit for free. ' +
            'Charging from higher elevation gives +1 to Wound and +1 Damage.',
      prompt: 'Roll 1D6 and move that far toward the target. You must end in melee range or not move at all.',
      elevation: 'charge',
      endsChain: false, opponentGainsAP: 0,
      expiresOverwatch: true
    },
    {
      id: 'fight', name: 'FIGHT', cost: 1, kind: 'aggressive', flow: 'attack',
      attackRange: 'melee',
      short: 'Melee attack. The defender gains 1 RP and picks a Melee Reaction.',
      flavour: '“Finish the job.”',
      text: 'Choose an eligible target within range of one of your melee weapons. ' +
            'Your opponent gains 1 RP and spends it on a Melee Reaction. Resolve the attack. ' +
            'If the target survives it gains 1 AP. If it is destroyed, score 1 VP and end the chain.',
      endsChain: false, opponentGainsAP: 0,
      expiresOverwatch: true
    },
    {
      id: 'overwatch', name: 'OVERWATCH', cost: 1, kind: 'passive', flow: 'overwatch',
      short: 'Place a token. You fire it yourself, at -1 to hit, and the defender gains no RP.',
      flavour: '“Come into my sights.”',
      text: 'Place an overwatch token within 12" of this unit. Until the end of this action chain, ' +
            'if an enemy moves within 3" of the token and is a legal target for this unit\'s primary ' +
            'ranged weapon, you may immediately attack it at -1 to hit. The opponent gains no RP. ' +
            'If this unit moves or attacks, remove the token.',
      prompt: 'Place the overwatch token within 12" of this unit.',
      endsChain: false, opponentGainsAP: 0
    },
    {
      id: 'ability', name: 'SPECIAL ABILITY', cost: null, kind: 'passive', flow: 'ability',
      short: 'Use one of this unit\'s [X] AP abilities. Your opponent gains 1 AP.',
      flavour: '“Watch this.”',
      text: 'Use one of your unit\'s abilities that begins with “[X] AP —”. Your opponent gains 1 AP.',
      endsChain: false, opponentGainsAP: 1
    },
    {
      id: 'hold', name: 'HOLD', cost: 0, kind: 'passive', flow: 'simple',
      short: 'Move up to 1". The chain ends. Only during an action chain.',
      flavour: '“Let them come.”',
      text: 'Move a friendly unit up to 1". The action chain ends. Use only during an action chain.',
      prompt: 'Move the unit up to 1" on the tabletop.',
      endsChain: true, opponentGainsAP: 0, onlyInChain: true
    },
    {
      id: 'pass', name: 'PASS', cost: 0, kind: 'passive', flow: 'pass',
      short: 'End your turn. Only on your turn, never during a chain.',
      flavour: '“Let’s see what they do.”',
      text: 'Only on your own turn, and never during an action chain. Your turn ends.',
      endsChain: true, opponentGainsAP: 0, onlyOnYourTurn: true, notInChain: true,
      endsTurn: true, noUnit: true
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
     askEligible       : ask the player whether the attack still happens
     -------------------------------------------------------------------- */
  const rangedReactions = [
    { id: 'dodge', name: 'DODGE', cost: 1, hitMod: -1,
      flavour: '“Thought you had me, didn’t ya?”',
      text: 'Subtract 1 from the attacker\'s Hit roll. Move 1".',
      tabletop: 'Move the defender 1".' },

    { id: 'duck', name: 'DUCK', cost: 1, woundMod: -1,
      flavour: '“GET DOWN YOU IDIOT!”',
      text: 'Subtract 1 from the attacker\'s Wound roll. This unit cannot move for your next AP.',
      selfEffect: { label: 'Cannot move', duration: 'nextAP',
                    detail: 'This unit cannot move for your next AP (DUCK).' } },

    { id: 'dive', name: 'DIVE', cost: 1, askEligible: true, noAPGrant: true,
      flavour: '“Who cares if your knees get dirty?!”',
      text: 'Move 2". If you are no longer an eligible target, the attack does not happen. ' +
            'You do not get an AP after this attack.',
      tabletop: 'Move the defender 2".' },

    { id: 'distract', name: 'DISTRACT', cost: 1, hitMod: +1, grantAP: 1,
      freeChoice: true, chainLivesOnDeath: true,
      flavour: '“Sometimes the best defense is to hit them from where they\'re not looking.”',
      text: 'The attacker gets +1 to hit. Gain 1 AP. The action chain does not end if this unit ' +
            'is defeated. Your next AP may be spent on any friendly unit, as if the attack had ' +
            'been a Passive Action.' },

    { id: 'special', name: 'SPECIAL RP', cost: null, isSpecial: true,
      flavour: '“This one’s just for you.”',
      text: 'Use one of your unit\'s abilities that begins with “[X] RP —”.' }
  ];

  const meleeReactions = [
    { id: 'parry', name: 'PARRY', cost: 1, woundMod: -1,
      flavour: '“I can do this all day.”',
      text: 'Subtract 1 from the attacker\'s Wound roll. If your unit survives the attack, ' +
            'move the attacker 1".',
      onSurviveTabletop: 'Move the attacker 1".' },

    { id: 'evade', name: 'EVADE', cost: 1, hitMod: -1,
      flavour: '“Slip past the blow.”',
      text: 'Subtract 1 from the attacker\'s Hit roll. This unit gets +1 to hit for your next AP.',
      selfEffect: { label: '+1 to hit', duration: 'nextAP', hitBonus: 1,
                    detail: 'This unit has +1 to hit for your next AP (EVADE).' } },

    { id: 'withdraw', name: 'WITHDRAW', cost: 1, endsChain: true,
      flavour: '“Courage isn’t always wise.”',
      text: 'If your unit survives this attack, it moves 3". End the action chain.',
      onSurviveTabletop: 'Move the defender 3".' },

    { id: 'focus', name: 'FOCUS', cost: 1, grantAPOnSurvive: 1,
      flavour: '“Not all fights are won with strength.”',
      text: 'Gain an extra AP if your unit survives this attack.' },

    { id: 'special', name: 'SPECIAL RP', cost: null, isSpecial: true,
      flavour: '“This one’s just for you.”',
      text: 'Use one of your unit\'s abilities that begins with “[X] RP —”.' }
  ];

  /* --------------------------------------------------------------------
     WOUND TABLE
     DOUBLE OR MORE = 2+   GREATER = 3+   EQUAL = 4+
     LESS THAN      = 5+   HALF OR LESS = 6+
     -------------------------------------------------------------------- */
  function woundTarget(strength, toughness) {
    const s = Number(strength), t = Number(toughness);
    if (!isFinite(s) || !isFinite(t) || s <= 0 || t <= 0) return null;
    if (s >= t * 2) return 2;
    if (s * 2 <= t) return 6;
    if (s > t) return 3;
    if (s === t) return 4;
    return 5;
  }

  function woundLabel(strength, toughness) {
    const s = Number(strength), t = Number(toughness);
    if (s >= t * 2) return 'S is double or more T';
    if (s * 2 <= t) return 'S is half or less of T';
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
    actions, rangedReactions, meleeReactions,
    woundTarget, woundLabel, applyMod, actionById, reactionById,

    /* Ability trigger slots offered by the unit editor. */
    abilityTriggers: [
      { id: 'ap',      label: '[X] AP — Special Action',  hint: 'Used with the SPECIAL ABILITY action on your activation.' },
      { id: 'rp',      label: '[X] RP — Special Reaction', hint: 'Offered in the reaction list when this unit is attacked.' },
      { id: 'start',   label: 'START: —',                  hint: 'Offered in the Start Phase of its owner\'s turn.' },
      { id: 'end',     label: 'END: —',                    hint: 'Offered in the End Phase of its owner\'s turn.' },
      { id: 'passive', label: 'PASSIVE',                   hint: 'Always on. Shown on the card as a reminder; no button.' },
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
      { id: 'token',        label: 'Place a token / button',   token: true },
      { id: 'note',         label: 'Reminder text only',       note: true }
    ],

    durations: [
      { id: 'attack',  label: 'This attack only' },
      { id: 'nextAP',  label: 'Until after your next AP' },
      { id: 'chain',   label: 'Until this action chain ends' },
      { id: 'turn',    label: 'Until the end of this turn' },
      { id: 'round',   label: 'Until your next turn' },
      { id: 'manual',  label: 'Until removed by hand' }
    ],

    /* Special Objectives resolve without a unit on the table, so only the
       effect rows that need no target are offered there. */
    objectiveEffectKinds: ['ap_self', 'ap_opponent', 'ap_drain', 'rp_self',
                           'vp_self', 'vp_opponent', 'note'],

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

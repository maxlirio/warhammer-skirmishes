/* =========================================================================
   ENGINE — turn structure, action chains, attacks, effects, tokens.

   The engine never asks about the tabletop. It takes the player's word for
   what happened (hit / miss / damage / trigger) and keeps the consequences
   straight: AP, RP, VP, wounds, whose unit must act next, what is still on
   the board.
   ========================================================================= */

const Engine = (function () {

  const S = () => Store.get();

  /* --------------------------------------------------------- action rules

     Cost and "does your opponent gain AP" are house-rulable, so every lookup
     goes through here rather than straight at the card. */
  function actionDef(id) {
    const base = RULES.actionById(id);
    if (!base) return null;
    const g = S();
    const ov = g && g.settings && g.settings.actionOverrides && g.settings.actionOverrides[id];
    return ov ? Object.assign({}, base, ov) : base;
  }

  function actionList() { return RULES.actions.map(a => actionDef(a.id)); }

  function setActionOverride(id, key, value) {
    Store.commit('house rule', function () {
      const g = S();
      if (!g.settings.actionOverrides) g.settings.actionOverrides = {};
      if (!g.settings.actionOverrides[id]) g.settings.actionOverrides[id] = {};
      const base = RULES.actionById(id);
      if (base && base[key] === value) delete g.settings.actionOverrides[id][key];
      else g.settings.actionOverrides[id][key] = value;
      if (!Object.keys(g.settings.actionOverrides[id]).length) delete g.settings.actionOverrides[id];
      log('House rule: ' + base.name + ' — ' + key + ' is now ' + value + '.', 'manual');
    });
  }

  /* Where does the AP for acting actually come from? Used by the UI so the
     answer is on screen instead of in the rules text. */
  function apConsequence(a) {
    if (a.kind === 'aggressive') {
      return 'The target gains 1 AP if it survives — nothing otherwise.';
    }
    if (a.opponentGainsAP > 0) {
      return 'Your opponent gains ' + a.opponentGainsAP + ' AP.';
    }
    return 'Your opponent gains no AP.';
  }

  /* No AP means exactly one legal action. */
  function mustPass() {
    const g = S();
    if (!g || g.pending || g.flow) return false;
    return g.players[g.control.player].ap <= 0;
  }

  /* Are you acting on your own turn, or answering inside someone else's? */
  function controlMode() {
    const g = S();
    if (!g) return 'turn';
    if (g.pending) return 'phase';
    if (g.control.player !== g.turn.player) return 'reacting';
    return g.chain.active ? 'continuing' : 'turn';
  }

  /* --------------------------------------------------------------- effects
     The engine announces outcomes; whoever is listening decides what to draw.
     Deliberately not state — an effect that lived in the game object would
     replay on every re-render and every undo. */
  let fxHandler = null;
  function onFx(fn) { fxHandler = fn; }
  function fx(kind, data) {
    if (fxHandler) { try { fxHandler(kind, data || {}); } catch (e) { /* never break a turn */ } }
  }

  /* ------------------------------------------------------------------ log */

  function log(text, cls) {
    const g = S();
    g.log.push({
      t: g.log.length,
      turn: g.turn.number,
      chain: g.chain.id,
      text: text,
      cls: cls || ''
    });
    if (g.log.length > 400) g.log.shift();
  }

  function chainEntry(text, cls) {
    S().chain.entries.push({ text: text, cls: cls || '' });
    log(text, cls);
  }

  const pname = i => S().players[i].name;
  const uname = id => { const u = Store.unit(id); return u ? u.name : '—'; };

  /* ------------------------------------------------------------ new game */

  function startGame(config, units) {
    const g = Store.newGame(config);
    g.units = units;
    /* A faction card rides on the player, not on a unit — it has its own pool
       (the Grey Knights' PSY) that the player spends in their Start Phase. */
    [0, 1].forEach(function (i) {
      const c = config && config.cards && config.cards[i];
      if (!c) return;
      g.players[i].card = JSON.parse(JSON.stringify(c));
      const r = g.players[i].card.resource;
      if (r) r.value = Number(r.start) || 0;
    });
    Store.setState(g);
    Store.commit('start game', function () {
      log('— GAME START —', 'big');
      g.players.forEach(function (p) {
        if (!p.card) return;
        log(p.name + ' brings ' + p.card.name +
          (p.card.resource ? ' — ' + p.card.resource.value + ' ' + p.card.resource.name +
                             ' to start' : '') + '.', 'action');
      });
      g.units.filter(u => u.reserve).forEach(function (u) {
        log(u.name + ' does not start on the battlefield — it is in RESERVE.', 'note');
      });
      applyMission();
      g.setupQueue = [];
      g.units.forEach(function (u) {
        (u.abilities || []).filter(a => a.trigger === 'gamestart').forEach(function (a) {
          g.setupQueue.push({ unitId: u.id, abilityId: a.id });
        });
      });
      advanceSetupQueue();
    });
  }

  /* "At the beginning of the game…" — resolved before anyone takes a turn,
     asking for whatever choice the ability needs. */
  function advanceSetupQueue() {
    const g = S();
    const next = (g.setupQueue || []).shift();
    if (!next) {
      g.flow = null;
      beginTurn(g.turn.player, true);
      return;
    }
    const ab = findAbility(next.unitId, next.abilityId);
    if (!ab) { advanceSetupQueue(); return; }
    const needs = effectsNeedingTarget(ab, { sourceUnitId: next.unitId });
    if (!needs.length) {
      resolveFreeAbility(next.unitId, next.abilityId, {});
      advanceSetupQueue();
      return;
    }
    g.flow = { kind: 'ability', freeUse: true, setupStep: true, actionId: 'ability',
               unitId: next.unitId, abilityId: next.abilityId,
               targets: {}, pickIndex: 0, step: 'pick' };
  }

  /* ------------------------------------------------------------- missions */

  const missionCard = () => {
    const g = S();
    return (g && g.mission && g.mission.id) ? RULES.missionById(g.mission.id) : null;
  };

  /* Put the mission's furniture on the table: wound modifiers, markers that can
     be shot at, objective markers whose controller we remember, the relic. */
  function applyMission() {
    const g = S();
    const m = missionCard();
    if (!m) return;
    log('Mission: ' + m.name + '.', 'phase');

    /* The card's win condition replaces whatever was configured. */
    g.settings.vpTarget = (m.vpTarget === undefined) ? g.settings.vpTarget : m.vpTarget;
    g.settings.endsWhen = m.endsWhen || null;
    g.settings.endsShort = m.endsShort || null;
    log('This mission ends when ' + (m.endsWhen || 'a player reaches ' +
      g.settings.vpTarget + ' VP') + '.', 'note');

    if (m.rosterMod && m.rosterMod.woundsDelta) {
      const min = m.rosterMod.woundsMin || 1;
      g.units.forEach(function (u) {
        u.maxWounds = Math.max(min, u.maxWounds + m.rosterMod.woundsDelta);
        u.wounds = u.maxWounds;
      });
      log('All units take ' + m.rosterMod.woundsDelta + ' Wound (minimum ' + min + ').', 'note');
    }

    /* A unit named as the TARGET gets its bonus wound. */
    const flag = m.unitFlag;
    if (flag && flag.boostWounds) {
      g.units.filter(u => u.flags && u.flags[flag.id]).forEach(function (u) {
        u.maxWounds += flag.boostWounds;
        u.wounds = u.maxWounds;
        log(u.name + ' is the ' + flag.label + ' — +' + flag.boostWounds + ' Wound.', 'note');
      });
    }

    if (m.markersPerPlayer) {
      g.players.forEach(function (p) {
        m.markersPerPlayer.forEach(spec => addMarkerUnit(spec, p.id, m));
      });
    }
    if (m.markersForRole && g.mission.roles) {
      const owner = g.mission.roles[m.markersForRole.role];
      if (owner !== undefined && owner !== null) {
        m.markersForRole.markers.forEach(spec => addMarkerUnit(spec, owner, m));
      }
    }
    if (m.controlPoints) {
      g.mission.controlPoints = m.controlPoints.map(function (label) {
        return { id: Store.nextId('cp'), label: label, controller: null };
      });
      log('Three objective markers placed. The app remembers who SECURED each one.', 'note');
    }
    if (m.relic) {
      g.mission.relic = { carrier: null };
      log('The RELIC is in the centre of the battlefield, unclaimed.', 'note');
    }
  }

  function addMarkerUnit(spec, owner, m) {
    const g = S();
    const u = Store.newUnit(owner, {
      name: spec.label, move: 0, maxWounds: spec.wounds, wounds: spec.wounds,
      toughness: spec.toughness, oc: 0, marker: true, noRP: true,
      killVP: spec.killVP || 1,
      endsGameOnDeath: !!spec.endsGame,
      killVPFor: spec.killVPFor || null,
      notes: 'Mission marker — it can be attacked like a unit, but it has no RP.'
    });
    g.units.push(u);
    log('[' + spec.label + '] placed for ' + pname(owner) + ' (' + spec.wounds + 'W, T' +
      spec.toughness + ', no RP).', 'token');
  }

  /* What a kill is worth, before the player overrides it. */
  function killValue(u) {
    const m = missionCard();
    if (u.killVP) return u.killVP;
    if (m && m.unitFlag && m.unitFlag.killVP && u.flags && u.flags[m.unitFlag.id]) {
      return m.unitFlag.killVP;
    }
    return 1;
  }

  function toggleUnitFlag(unitId, flagId) {
    Store.commit('mission flag', function () {
      const g = S();
      const m = missionCard();
      const u = Store.unit(unitId);
      if (!u || !m || !m.unitFlag || m.unitFlag.id !== flagId) return;
      if (!u.flags) u.flags = {};
      const on = !u.flags[flagId];
      if (on && m.unitFlag.scope === 'onePerPlayer') {
        Store.unitsOf(u.owner, false).forEach(x => { if (x.flags) x.flags[flagId] = false; });
      }
      if (on && m.unitFlag.scope === 'oneTotal') {
        g.units.forEach(x => { if (x.flags) x.flags[flagId] = false; });
      }
      u.flags[flagId] = on;
      log(u.name + (on ? ' is now marked ' : ' is no longer marked ') + m.unitFlag.label + '.', 'note');
    });
  }

  function secureControlPoint(cpId, playerId, unitId) {
    const g = S();
    const cp = ((g.mission && g.mission.controlPoints) || []).find(c => c.id === cpId);
    if (!cp) return;
    const before = cp.controller;
    cp.controller = playerId;
    chainEntry('[' + cp.label + '] SECURED by ' + uname(unitId) + ' — ' + pname(playerId) +
      ' controls it' + (before !== null && before !== undefined && before !== playerId
        ? ', taken from ' + pname(before) : '') + '.', 'token');
  }

  function controlledCount(playerId) {
    const g = S();
    return ((g.mission && g.mission.controlPoints) || []).filter(c => c.controller === playerId).length;
  }

  function setRelicCarrier(unitId) {
    const g = S();
    if (!g.mission || !g.mission.relic) return;
    g.mission.relic.carrier = unitId;
    chainEntry(unitId ? uname(unitId) + ' picks up the RELIC.'
                      : 'The RELIC is on the ground, unclaimed.', 'token');
  }

  function relicCarrier() {
    const g = S();
    return (g.mission && g.mission.relic) ? g.mission.relic.carrier : null;
  }

  /* Missions that finish on something other than the VP target. */
  function checkMissionEnd() {
    const g = S();
    const m = missionCard();
    if (!m || g.winner !== null && g.winner !== undefined) return;
    if (m.endsWhenAPlayerIsWipedOut) {
      const wiped = g.players.find(p => Store.unitsOf(p.id, true).filter(u => !u.marker).length === 0);
      if (wiped) {
        log('★ All of ' + wiped.name + '’s units are dead — the game ends.', 'win');
        declareWinnerOnVP('all of ' + wiped.name + '’s units are dead');
      }
    }
  }

  function declareWinnerOnVP(why) {
    const g = S();
    let best = g.players[0];
    g.players.forEach(p => { if (p.vp > best.vp) best = p; });
    const tied = g.players.filter(p => p.vp === best.vp).length > 1;
    g.winner = tied ? null : best.id;
    g.gameOver = { why: why, tied: tied };
    log(tied ? 'The game ends level on VP — ' + why + '.'
             : '★ ' + best.name + ' wins on VP — ' + why + '.', 'win');
  }

  function endGameNow(why) {
    Store.commit('end game', function () { declareWinnerOnVP(why); });
  }

  /* -------------------------------------------------------- turn structure */

  function beginTurn(playerId, firstTurn) {
    const g = S();
    g.turn.number += 1;
    g.turn.player = playerId;
    g.turn.phase = 'start';
    g.control = { player: playerId, forcedUnitId: null, reason: 'start phase' };
    g.chain = { active: false, id: g.chain.id, initiator: null, entries: [] };
    expireEffects('round', playerId);
    expireTokens('round', playerId);
    /* "…if this unit has not moved this turn" and "may not MOVE this turn" both
       reset here, as do once-per-turn abilities. */
    g.units.forEach(function (u) {
      u.movedThisTurn = false;
      u.noMoveTurn = false;
      (u.abilities || []).forEach(function (a) { a.usedTurn = 0; });
    });
    log('— TURN ' + g.turn.number + ': ' + pname(playerId) + ' —', 'big');
    /* "GAIN 1 PSY EVERY TURN" — including your first, so the Grey Knights
       start their opening turn on 5. */
    const card = g.players[playerId].card;
    if (card && card.resource && card.resource.perTurn) {
      card.resource.value += Number(card.resource.perTurn) || 0;
      log(pname(playerId) + ' gains ' + card.resource.perTurn + ' ' + card.resource.name +
        ' (now ' + card.resource.value + ').', 'ap');
    }
    g.pending = {
      type: 'start',
      player: playerId,
      firstTurn: !!firstTurn
    };
  }

  /* Confirm the Start Phase modal: grant the turn's 1 AP and open the action phase. */
  function confirmStartPhase() {
    Store.commit('start phase', function () {
      const g = S();
      const p = g.pending && g.pending.player;
      if (p === null || p === undefined) return;
      g.players[p].ap += 1;
      log(pname(p) + ' gains 1 AP for the Start Phase (now ' + g.players[p].ap + ' AP).', 'ap');
      g.turn.phase = 'action';
      g.pending = null;
      g.control = { player: p, forcedUnitId: null, reason: 'spend an AP, or PASS to end your turn' };
    });
  }

  function beginEndPhase(note) {
    const g = S();
    g.turn.phase = 'end';
    closeChain(note || 'both AP pools empty');
    g.pending = { type: 'end', player: g.turn.player, answers: {} };
    log('End Phase — ' + pname(g.turn.player) + '.', 'phase');
  }

  function confirmEndPhase() {
    Store.commit('end phase', function () {
      const g = S();
      const p = g.pending ? g.pending.player : g.turn.player;
      /* "…checked in the End Phase after END: abilities are resolved." */
      scoreEndOfTurn();
      if (g.winner !== null && g.winner !== undefined) { g.pending = null; return; }
      expireEffects('turn', null);
      expireTokens('turn', null);
      g.pending = null;
      beginTurn(Store.nextPlayer(p));   // play passes around the table
    });
  }

  /* --------------------------------------------------------- action chain */

  function openChain(initiator) {
    const g = S();
    if (g.chain.active) return;
    g.chain = { active: true, id: g.chain.id + 1, initiator: initiator, entries: [],
                passes: 0 };
    log('Action chain #' + g.chain.id + ' begins (' + pname(initiator) + ').', 'chain');
  }

  function closeChain(reason) {
    const g = S();
    if (!g.chain.active) return;
    g.chain.active = false;
    g.chain.passes = 0;
    expireEffects('chain', null);
    expireTokens('chain', null);
    chainEntry('Action chain ends' + (reason ? ' — ' + reason : '') + '.', 'chain-end');
  }

  /* The heart of the turn machine: who gets to act after an action resolves.

     Being broke does not end a chain. Whoever is owed a response is handed the
     chain either way — they MUST choose an action, and with no AP the only one
     they can afford is PASS, which is what actually closes it. That matters:
     before passing they can still fire an overwatch token or a free ability. */
  function afterAction(opts) {
    const g = S();
    const actor = opts.actor;
    expireEffects('nextAP', actor);
    if (!opts.isPass) g.chain.passes = 0;   // only consecutive passes count

    if (opts.endsChain) {
      closeChain(opts.reason || null);
      handOffToTurnPlayer();
      checkVictory();
      return;
    }

    const opp = Store.opponentOf(actor);
    g.chain.active = true;
    const forced = opts.forcedUnitId || null;
    const broke = g.players[opp].ap <= 0;
    g.control = {
      player: opp,
      forcedUnitId: forced,
      reason: broke
        ? 'no AP left — they must PASS'
        : (forced ? uname(forced) + ' must act (Aggressive Action)'
                  : 'may respond with any unit')
    };
    chainEntry('→ ' + pname(opp) + ' must act' +
      (forced ? ' with ' + uname(forced) : '') +
      (broke ? ' — no AP, so they must PASS.' : ' — ' + g.players[opp].ap + ' AP available.'),
      'control');
    checkVictory();
  }

  /* The chain is over: "The Active Player spends an AP or takes a PASS action."
     Nothing ends the turn except the active player choosing to. */
  function handOffToTurnPlayer() {
    const g = S();
    const tp = g.turn.player;
    g.control = {
      player: tp,
      forcedUnitId: null,
      reason: g.players[tp].ap > 0
        ? 'spend an AP to start a new chain, or PASS'
        : 'no AP — PASS, and end the turn if you are done'
    };
    chainEntry(pname(tp) + ' is up with ' + g.players[tp].ap + ' AP.', 'control');
  }

  /* ------------------------------------------------------- effects/tokens */

  function addEffect(unitId, eff) {
    const u = Store.unit(unitId);
    if (!u) return;
    u.effects.push(Object.assign({
      id: Store.nextId('ue'), label: 'Effect', detail: '',
      hitMod: 0, woundMod: 0, duration: 'chain', ownerPlayer: u.owner
    }, eff));
  }

  function expireEffects(duration, playerFilter) {
    const g = S();
    g.units.forEach(function (u) {
      const keep = [];
      (u.effects || []).forEach(function (e) {
        const match = e.duration === duration &&
          (playerFilter === null || playerFilter === undefined || e.ownerPlayer === playerFilter);
        if (match) log('Effect expired on ' + u.name + ': ' + e.label + '.', 'muted');
        else keep.push(e);
      });
      u.effects = keep;
    });
  }

  function expireTokens(expiry, playerFilter) {
    const g = S();
    g.units.forEach(function (u) {
      const keep = [];
      (u.tokens || []).forEach(function (t) {
        const match = t.expiry === expiry &&
          (playerFilter === null || playerFilter === undefined || u.owner === playerFilter);
        if (match) log('Token removed: [' + t.label + '] (' + u.name + ').', 'muted');
        else keep.push(t);
      });
      u.tokens = keep;
    });
  }

  /* Overwatch (and any "ownerActs" token) dies when its unit moves or attacks. */
  function expireOnOwnerAction(unitId) {
    const u = Store.unit(unitId);
    if (!u || !u.tokens || !u.tokens.length) return;
    const keep = [];
    u.tokens.forEach(function (t) {
      if (t.kind === 'overwatch' || t.expiry === 'ownerActs') {
        chainEntry('[' + t.label + '] removed — ' + u.name + ' moved or attacked.', 'token');
      } else keep.push(t);
    });
    u.tokens = keep;
  }

  function removeToken(unitId, tokenId) {
    const u = Store.unit(unitId);
    if (!u) return;
    const t = (u.tokens || []).find(x => x.id === tokenId);
    u.tokens = (u.tokens || []).filter(x => x.id !== tokenId);
    if (t) log('Token removed by hand: [' + t.label + '] (' + u.name + ').', 'muted');
  }

  /* A unit in RESERVE is not on the table: it cannot be shot at, chosen as a
     target, counted or fired from until something places it. */
  const onTable = u => !!u && u.alive && !u.reserve;

  /* Remembered so "if this unit has not moved this turn" can answer itself. */
  function noteMoved(unitId) {
    const u = Store.unit(unitId);
    if (u) u.movedThisTurn = true;
  }

  function unitMoveMod(unitId) {
    const u = Store.unit(unitId);
    if (!u) return 0;
    return (u.effects || []).reduce((n, e) => n + (Number(e.moveMod) || 0), 0);
  }

  /* "+1 damage against a MARKED unit": a passive on the attacker that only
     pays off when the target is carrying the named chip. */
  function markDamageBonus(attackerId, targetId, weapon) {
    const atk = Store.unit(attackerId);
    const tgt = Store.unit(targetId);
    if (!atk || !tgt || !weapon) return 0;
    let bonus = 0;
    (atk.abilities || []).filter(a => a.trigger === 'passive').forEach(function (a) {
      (a.effects || []).forEach(function (e) {
        if (e.kind !== 'markbonus') return;
        const want = (e.label || 'MARKED').toUpperCase();
        const has = (tgt.effects || []).some(ue => String(ue.label).toUpperCase() === want);
        if (!has) return;
        if (e.weaponName && String(e.weaponName).toLowerCase() !== String(weapon.name).toLowerCase()) return;
        bonus += Number(e.value) || 0;
      });
    });
    return bonus;
  }

  /* ---------------------------------------------------------------- auras

     The app cannot measure 6". So every aura that *could* apply to the attack
     being resolved is offered as a toggle on the roll it would change, and the
     player — who can see the table — says whether it does. */

  function unitAuras(u) {
    const out = [];
    (u.abilities || []).forEach(function (a) {
      if (a.trigger !== 'passive') return;
      (a.effects || []).forEach(function (e) {
        if (e.kind === 'aura') out.push({ src: a.name, e: e, id: a.id + ':' + e.id });
      });
    });
    (u.effects || []).forEach(function (ue) {
      if (ue.aura) out.push({ src: ue.label, e: ue.aura, id: ue.id });
    });
    return out;
  }

  function auraLabel(e) {
    const what = e.stat === 'wound' ? 'Wound' : e.stat === 'strength' ? 'Strength' : 'Hit';
    const scope = e.weapon === 'ranged' ? ' (ranged only)'
                : e.weapon === 'melee' ? ' (melee only)' : '';
    const where = e.mode === 'always' ? 'always'
                : e.mode === 'los' ? 'through the line of sight'
                : (e.mode === 'beyond' ? 'further than ' : 'within ') + (e.range || 6) + '"';
    return (e.value > 0 ? '+' : '') + (Number(e.value) || 0) + ' to ' + what +
      ' · ' + where + scope;
  }

  /* Auras that could bear on the attack currently in the flow. */
  function applicableAuras(f) {
    const g = S();
    if (!f || f.kind !== 'attack' || !f.attackerId || !f.targetId) return [];
    const action = actionDef(f.actionId);
    const weaponType = action ? action.attackRange : 'ranged';
    const attacker = Store.unit(f.attackerId);
    if (!attacker) return [];
    const out = [];
    /* A token can carry an aura of its own — a smoke bomb belongs to the patch
       of table it landed on, not to a unit. */
    g.units.forEach(function (u) {
      (u.tokens || []).forEach(function (t) {
        if (!t.aura) return;
        const e = t.aura;
        if (e.weapon && e.weapon !== 'any' && e.weapon !== weaponType) return;
        out.push({
          key: 'tok:' + t.id,
          unit: '[' + t.label + ']',
          source: t.sourceAbility || t.label,
          stat: e.stat === 'wound' ? 'wound' : e.stat === 'strength' ? 'strength' : 'hit',
          value: Number(e.value) || 0,
          always: e.mode === 'always',
          label: auraLabel(e),
          text: e.text || t.text || ''
        });
      });
    });

    g.units.filter(u => u.alive).forEach(function (u) {
      unitAuras(u).forEach(function (a) {
        const e = a.e;
        if (e.weapon && e.weapon !== 'any' && e.weapon !== weaponType) return;
        const friendlyToAura = u.owner === attacker.owner;
        if (e.side === 'friendly' && !friendlyToAura) return;
        if (e.side === 'enemy' && friendlyToAura) return;
        if (e.onlyVsOwner && f.targetId !== u.id) return;
        out.push({
          key: u.id + '|' + a.id,
          unit: u.name,
          source: a.src,
          stat: e.stat === 'wound' ? 'wound' : e.stat === 'strength' ? 'strength' : 'hit',
          value: Number(e.value) || 0,
          always: e.mode === 'always',   // no radius to judge, so it just applies
          label: auraLabel(e),
          text: e.text || ''
        });
      });
    });
    return out;
  }

  function toggleAura(key) {
    Store.commit('aura', function () {
      const f = S().flow;
      if (!f) return;
      if (!f.auras) f.auras = {};
      f.auras[key] = !f.auras[key];
    });
  }

  function auraMods(f) {
    let hit = 0, wound = 0, strength = 0;
    if (!f) return { hit: hit, wound: wound, strength: strength };
    applicableAuras(f).forEach(function (a) {
      if (!a.always && !(f.auras && f.auras[a.key])) return;
      if (a.stat === 'wound') wound += a.value;
      else if (a.stat === 'strength') strength += a.value;
      else hit += a.value;
    });
    return { hit: hit, wound: wound, strength: strength };
  }

  /* Reactions something forbids — shown struck through, with the source.
     Two directions: a friendly passive that bans a reaction for its own squad
     (the Commissar's WITHDRAW ban), and an attacker's passive that bans one for
     whoever it is attacking, optionally only with one named weapon
     ("Enemy units cannot DIVE when this unit uses its Purifying Flame"). */
  function blockedReactions(defenderId, attackerId, weapon) {
    const g = S();
    const def = Store.unit(defenderId);
    if (!def) return {};
    const out = {};
    const scan = (u, wantScope, why) =>
      (u.abilities || []).filter(a => a.trigger === 'passive').forEach(function (a) {
        (a.effects || []).forEach(function (e) {
          if (e.kind !== 'blockreact' || !e.reaction) return;
          if ((e.scope || 'friendly') !== wantScope) return;
          if (e.weaponName && (!weapon ||
              String(e.weaponName).toLowerCase() !== String(weapon.name).toLowerCase())) return;
          out[e.reaction] = why(u) + ': ' + a.name;
        });
      });

    g.units.filter(u => u.alive && u.owner === def.owner)
      .forEach(u => scan(u, 'friendly', x => x.name));
    const atk = Store.unit(attackerId);
    if (atk && atk.alive) scan(atk, 'enemy', x => x.name);
    return out;
  }

  function unitHitMod(unitId) {
    const u = Store.unit(unitId);
    if (!u) return 0;
    return (u.effects || []).reduce((n, e) => n + (Number(e.hitMod) || 0), 0);
  }

  function unitStrengthMod(unitId) {
    const u = Store.unit(unitId);
    if (!u) return 0;
    return (u.effects || []).reduce((n, e) => n + (Number(e.strengthMod) || 0), 0);
  }

  function unitWoundMod(unitId) {
    const u = Store.unit(unitId);
    if (!u) return 0;
    return (u.effects || []).reduce((n, e) => n + (Number(e.woundMod) || 0), 0);
  }

  /* ------------------------------------------------------------- wounds */

  /* Returns true if the unit was destroyed. */
  function dealDamage(unitId, amount, sourcePlayer, describe, sourceUnitId) {
    const g = S();
    const u = Store.unit(unitId);
    if (!u || !u.alive) return false;
    const dmg = Math.max(0, Number(amount) || 0);
    u.wounds = Math.max(0, u.wounds - dmg);
    if (dmg > 0) fx('damage', { unitId: unitId, amount: dmg, fatal: u.wounds <= 0 });
    chainEntry((describe || '') + u.name + ' takes ' + dmg + ' damage — ' +
      u.wounds + '/' + u.maxWounds + ' W remaining.', 'damage');
    if (u.wounds <= 0) {
      u.alive = false;
      u.tokens = [];
      u.effects = [];
      fx('kill', { unitId: unitId, name: u.name });
      const slayer = sourceUnitId ? Store.unit(sourceUnitId) : null;
      if (slayer && slayer.id !== u.id) slayer.kills = (slayer.kills || 0) + 1;
      chainEntry(u.name + ' is DESTROYED and removed from the battlefield.', 'kill');

      // A destroyed relic carrier drops it where it fell.
      if (relicCarrier() === u.id) {
        setRelicCarrier(null);
        chainEntry('Tabletop: place the RELIC within 1" of where ' + u.name + ' was destroyed.', 'note');
      }

      if (sourcePlayer !== null && sourcePlayer !== undefined) {
        const m = missionCard();
        let scorer = sourcePlayer;
        if (u.killVPFor && g && g.mission && g.mission.roles &&
            g.mission.roles[u.killVPFor] !== undefined) {
          scorer = g.mission.roles[u.killVPFor];
        }
        /* The card says what a kill is worth, so the app scores it. The only
           thing it cannot see is WHERE it happened, so that is all it asks. */
        const zb = m && m.killZoneBonus;
        const zoneOwner = (zb && g.mission && g.mission.roles)
          ? g.mission.roles[zb.role] : null;
        if (zb && !u.marker && zoneOwner !== null && zoneOwner !== undefined &&
            scorer === zoneOwner) {
          ask({ kind: 'killzone', player: scorer, victim: u.name,
                zone: zb.zone, yes: zb.vp, no: killValue(u) });
        } else {
          scoreVP(scorer, killValue(u), 'destroyed ' + u.name);
        }
      }
      if (u.endsGameOnDeath) {
        chainEntry('The mission ends: ' + u.name + ' has been destroyed.', 'win');
        declareWinnerOnVP(u.name + ' destroyed');
      }
      checkMissionEnd();
      return true;
    }
    return false;
  }

  /* VP is never assumed. Anything that could score queues a prompt and the
     player types the number their mission actually gives them. */
  /* The app never asks how many VP something is worth — the card says. It only
     ever asks about what it cannot see from here, then works the VP out. */
  function ask(q) {
    const g = S();
    if (!g.asks) g.asks = [];
    g.asks.push(Object.assign({ id: Store.nextId('ask') }, q));
  }

  function answerAsk(askId, yes) {
    Store.commit('answer', function () {
      const g = S();
      const q = (g.asks || []).find(x => x.id === askId);
      g.asks = (g.asks || []).filter(x => x.id !== askId);
      if (!q) return;
      if (q.kind === 'killzone') {
        scoreVP(q.player, yes ? q.yes : q.no,
          'destroyed ' + q.victim + (yes ? ' in ' + q.zone : ''));
      }
    });
  }

  function scoreVP(playerId, amount, why) {
    const g = S();
    g.players[playerId].vp += Number(amount) || 0;
    chainEntry(pname(playerId) + ' scores ' + amount + ' VP' + (why ? ' (' + why + ')' : '') +
      ' — now ' + g.players[playerId].vp + ' VP.', 'vp');
    checkVictory();
  }

  /* Everything the closing screen needs to say something true about the game.
     Read from the board, never guessed. */
  function victoryReport() {
    const g = S();
    const w = g.winner;
    if (w === null || w === undefined) return null;
    const l = Store.opponentOf(w);
    const real = p => Store.unitsOf(p, false).filter(u => !u.marker);
    const alive = p => real(p).filter(u => u.alive && !u.reserve || (u.alive && u.reserve));
    const lostBy = p => real(p).filter(u => !u.alive).length;

    const deadliest = real(w).slice().sort((a, b) => (b.kills || 0) - (a.kills || 0))[0];
    const m = missionCard();
    return {
      winner: g.players[w].name,
      loser: g.players[l].name,
      winnerVP: g.players[w].vp,
      loserVP: g.players[l].vp,
      turns: g.turn.number,
      mission: m ? m.name : null,
      missionId: m ? m.id : null,
      why: (g.gameOver && g.gameOver.why) || null,
      wipedOut: alive(l).length === 0,
      losses: lostBy(w),
      enemyLosses: lostBy(l),
      force: real(w).length,
      enemyForce: real(l).length,
      deadliest: (deadliest && (deadliest.kills || 0) > 0)
        ? { name: deadliest.name, kills: deadliest.kills } : null
    };
  }

  function checkVictory() {
    const g = S();
    if (g.winner !== null && g.winner !== undefined) return;
    if (!g.settings.vpTarget) return;      // this mission does not end on VP
    g.players.forEach(function (p) {
      if (p.vp >= g.settings.vpTarget) {
        g.winner = p.id;
        log('★ ' + p.name + ' reaches ' + p.vp + ' VP and wins the skirmish!', 'win');
      }
    });
  }

  function spendAP(playerId, amount) {
    const g = S();
    g.players[playerId].ap = Math.max(0, g.players[playerId].ap - amount);
    if (amount > 0) log(pname(playerId) + ' spends ' + amount + ' AP (' + g.players[playerId].ap + ' left).', 'ap');
  }

  function grantAP(playerId, amount, why) {
    const g = S();
    g.players[playerId].ap += amount;
    chainEntry(pname(playerId) + ' gains ' + amount + ' AP' + (why ? ' — ' + why : '') +
      ' (now ' + g.players[playerId].ap + ').', 'ap');
  }

  /* ------------------------------------------------ ability effect engine */

  /* Which effect rows need the player to pick a unit before they resolve. */
  function effectsNeedingTarget(ability, ctx) {
    return (ability.effects || []).filter(function (e) {
      if (['damage', 'heal', 'mod_hit', 'mod_wound', 'mod_strength', 'mark',
           'place', 'mod_move'].indexOf(e.kind) < 0) return false;
      const pick = e.pick || 'prompt';
      if (pick === 'self') return false;
      if ((pick === 'attacker' || pick === 'defender') && ctx && ctx.attack) return false;
      return true;
    });
  }

  /* May return a single unit id or, for a 'multi' pick, an array of them. */
  function resolveEffectTarget(e, ctx) {
    const pick = e.pick || 'prompt';
    if (pick === 'self') return ctx.sourceUnitId;
    if (pick === 'attacker' && ctx.attack) return ctx.attack.attackerId;
    if (pick === 'defender' && ctx.attack) return ctx.attack.targetId;
    return (ctx.targets && ctx.targets[e.id]) || null;
  }

  const asList = t => (t === null || t === undefined) ? [] : (Array.isArray(t) ? t : [t]);

  /* ctx: { sourceUnitId, sourcePlayer, targets:{effectId:unitId}, attack, label } */
  function applyEffects(effects, ctx) {
    const g = S();
    const me = ctx.sourcePlayer;
    const opp = (ctx.opponent === null || ctx.opponent === undefined)
      ? Store.opponentOf(me) : ctx.opponent;
    (effects || []).forEach(function (e) {
      const v = Number(e.value) || 0;
      switch (e.kind) {
        case 'ap_self':     grantAP(me, v, ctx.label); break;
        case 'ap_opponent': {
          /* "…gains 1 AP for each unit damaged in this way, to a maximum of 2." */
          if (e.perDamaged) {
            const n = Math.min(ctx.damaged || 0, Number(e.max) || Infinity) * (v || 1);
            if (n > 0) grantAP(opp, n, ctx.label);
            else chainEntry(ctx.label + ': nothing was damaged, so ' + pname(opp) +
              ' gains no AP.', 'note');
            break;
          }
          grantAP(opp, v, ctx.label);
          break;
        }
        case 'ap_drain':
          g.players[opp].ap = Math.max(0, g.players[opp].ap - v);
          chainEntry(pname(opp) + ' loses ' + v + ' AP (' + ctx.label + ') — now ' + g.players[opp].ap + '.', 'ap');
          break;
        case 'rp_self':
          if (ctx.attack) { ctx.attack.rp = (ctx.attack.rp || 0) + v; }
          g.players[me].rp += v;
          chainEntry(pname(me) + ' gains ' + v + ' RP (' + ctx.label + ').', 'rp');
          break;
        case 'vp_self':     scoreVP(me, v, ctx.label); break;
        case 'vp_opponent': scoreVP(opp, v, ctx.label); break;
        case 'damage': {
          const hit = asList(resolveEffectTarget(e, ctx));
          hit.forEach(tid => dealDamage(tid, v, me, ctx.label + ': ', ctx.sourceUnitId));
          ctx.damaged = (ctx.damaged || 0) + hit.length;
          break;
        }
        case 'heal':
          asList(resolveEffectTarget(e, ctx)).forEach(tid => heal(tid, v));
          break;
        case 'mod_hit':
        case 'mod_wound': {
          const tid = resolveEffectTarget(e, ctx);
          if (!tid) break;
          const isHit = e.kind === 'mod_hit';
          const dur = e.duration || 'chain';
          if (dur === 'attack' && ctx.attack) {
            // Applies to the attack being resolved right now.
            if (tid === ctx.attack.attackerId) {
              if (isHit) ctx.attack.hitMod += v; else ctx.attack.woundMod += v;
              ctx.attack.notes.push(ctx.label + ': ' + (v > 0 ? '+' : '') + v +
                ' to the attacker\'s ' + (isHit ? 'Hit' : 'Wound') + ' roll.');
            } else {
              ctx.attack.notes.push(ctx.label + ': ' + (v > 0 ? '+' : '') + v +
                ' to ' + uname(tid) + '\'s ' + (isHit ? 'Hit' : 'Wound') + ' roll (not this attack).');
            }
          } else {
            addEffect(tid, {
              label: ctx.label + ' (' + (v > 0 ? '+' : '') + v + ' ' + (isHit ? 'hit' : 'wound') + ')',
              detail: e.text || '',
              hitMod: isHit ? v : 0,
              woundMod: isHit ? 0 : v,
              duration: dur,
              ownerPlayer: Store.owner(tid)
            });
            chainEntry(uname(tid) + ' gains ' + (v > 0 ? '+' : '') + v + ' to ' +
              (isHit ? 'Hit' : 'Wound') + ' rolls (' + ctx.label + ').', 'effect');
          }
          break;
        }
        case 'token': {
          const u = Store.unit(ctx.sourceUnitId);
          if (!u) break;
          u.tokens.push({
            id: Store.nextId('tk'),
            label: (e.label || 'TOKEN').toUpperCase(),
            kind: 'custom',
            expiry: e.expiry || 'chain',
            text: e.text || '',
            /* A marker that changes rolls rather than one you press. */
            aura: e.aura ? JSON.parse(JSON.stringify(e.aura)) : null,
            noPress: !!e.noPress,
            isAttack: !!e.tokenAttack,
            attackOpts: e.tokenAttack
              ? { weapon: e.tokenWeapon || 'ranged', noRP: e.tokenNoRP !== false,
                  hitMod: Number(e.tokenHitMod) || 0 }
              : null,
            effects: JSON.parse(JSON.stringify(e.tokenEffects || [])),
            sourceAbility: ctx.label
          });
          chainEntry('[' + (e.label || 'TOKEN').toUpperCase() + '] placed by ' + u.name + '.', 'token');
          break;
        }
        case 'stat': {
          const tid = resolveEffectTarget(e, ctx) || ctx.sourceUnitId;
          const tu = Store.unit(tid);
          if (!tu) break;
          const key = e.stat || 'oc';
          tu[key] = Math.max(0, (Number(tu[key]) || 0) + v);
          if (key === 'maxWounds') tu.wounds = Math.min(tu.wounds + v, tu.maxWounds);
          chainEntry(tu.name + ': ' + key.toUpperCase() + ' is permanently now ' + tu[key] +
            ' (' + ctx.label + ').', 'effect');
          break;
        }
        case 'aura': {
          // A granted aura rides on the unit as an effect until it expires.
          const tid = resolveEffectTarget(e, ctx) || ctx.sourceUnitId;
          if (!tid) break;
          addEffect(tid, {
            label: ctx.label, detail: e.text || auraLabel(e),
            duration: e.duration || 'manual', ownerPlayer: Store.owner(tid),
            aura: JSON.parse(JSON.stringify(e))
          });
          chainEntry(uname(tid) + ' gains the aura “' + ctx.label + '” — ' + auraLabel(e) + '.', 'effect');
          break;
        }
        case 'redirect':
          if (ctx.attack) {
            ctx.attack.redirect = true;
            chainEntry(ctx.label + ': the attack will be redirected to another unit.', 'reaction');
          }
          break;
        case 'attack':
          // Queued: the attack flow opens once this ability has finished.
          ctx.freeAttack = {
            unitId: ctx.sourceUnitId,
            weapon: e.weapon || 'any',
            noRP: e.noRP !== false,
            hitMod: Number(e.hitMod) || 0,
            skipWound: !!e.skipWound,
            endsChain: !!e.endsChainAfter,
            label: ctx.label
          };
          break;
        case 'mod_strength': {
          const tid = resolveEffectTarget(e, ctx) || ctx.sourceUnitId;
          if (!tid) break;
          const dur = e.duration || 'chain';
          if (dur === 'attack' && ctx.attack && tid === ctx.attack.attackerId) {
            ctx.attack.strengthMod = (ctx.attack.strengthMod || 0) + v;
            ctx.attack.notes.push(ctx.label + ': ' + (v > 0 ? '+' : '') + v + ' Strength.');
          } else {
            addEffect(tid, {
              label: ctx.label + ' (' + (v > 0 ? '+' : '') + v + ' S)',
              detail: e.text || '', strengthMod: v, duration: dur,
              ownerPlayer: Store.owner(tid)
            });
            chainEntry(uname(tid) + ': ' + (v > 0 ? '+' : '') + v +
              ' Strength (' + ctx.label + ').', 'effect');
          }
          break;
        }
        case 'mark': {
          const tid = resolveEffectTarget(e, ctx) || (ctx.targets && ctx.targets[e.id]);
          if (!tid) break;
          addEffect(tid, {
            label: (e.label || ctx.label).toUpperCase(), detail: e.text || '',
            duration: e.duration || 'manual', ownerPlayer: Store.owner(tid)
          });
          chainEntry(uname(tid) + ' is marked: ' + (e.label || ctx.label) + '.', 'effect');
          break;
        }
        case 'unmark': {
          const want = (e.label || 'MARKED').toUpperCase();
          let cleared = 0;
          g.units.forEach(function (x) {
            if (x.owner === me) return;                 // only the enemy's marks
            const keep = (x.effects || []).filter(function (ue) {
              if (String(ue.label).toUpperCase() !== want) return true;
              cleared++;
              return false;
            });
            x.effects = keep;
          });
          chainEntry(ctx.label + ': ' + (cleared
            ? cleared + ' ' + want + ' token' + (cleared === 1 ? '' : 's') + ' removed.'
            : 'no ' + want + ' tokens to remove.'), 'effect');
          break;
        }
        /* Teleports. WHERE it lands is the players' business — the app only
           records that it is on the table now, prints the card's restriction,
           and remembers that it counts as having moved. */
        case 'place': {
          const ids = (e.pick === 'self')
            ? [ctx.sourceUnitId]
            : asList(resolveEffectTarget(e, ctx));
          ids.filter(Boolean).forEach(function (tid) {
            const tu = Store.unit(tid);
            if (!tu) return;
            const arrived = tu.reserve;
            tu.reserve = false;
            noteMoved(tid);
            if (e.noMoveThisTurn) tu.noMoveTurn = true;
            chainEntry(tu.name + (arrived ? ' arrives from RESERVE' : ' is placed') +
              ' (' + ctx.label + ').', 'action');
            if (e.noMoveThisTurn) {
              chainEntry(tu.name + ' may not MOVE for the rest of this turn.', 'effect');
            }
          });
          if (e.text) chainEntry('Tabletop: ' + e.text, 'note');
          ctx.placed = (ctx.placed || []).concat(ids.filter(Boolean));
          break;
        }
        case 'mod_move': {
          const tid = resolveEffectTarget(e, ctx) || ctx.sourceUnitId;
          if (!tid) break;
          addEffect(tid, {
            label: ctx.label + ' (' + (v > 0 ? '+' : '') + v + '" MOV)',
            detail: e.text || '', moveMod: v, duration: e.duration || 'chain',
            ownerPlayer: Store.owner(tid)
          });
          chainEntry(uname(tid) + ': MOV is ' + ((Store.unit(tid).move || 0) + unitMoveMod(tid)) +
            '" ' + (e.duration === 'chain' ? 'until this action chain ends' : '') +
            ' (' + ctx.label + ').', 'effect');
          break;
        }
        /* "Your next attack with a Storm Bolter rolls 2 dice rather than 1" —
           bought now, spent by whichever attack uses that weapon next. */
        case 'dice': {
          if ((e.scope || 'player') !== 'player') break;
          g.players[me].buffs = (g.players[me].buffs || []).concat([{
            id: Store.nextId('bf'), kind: 'dice', value: Number(e.value) || 2,
            weaponName: e.weaponName || '', label: ctx.label, text: e.text || ''
          }]);
          chainEntry(pname(me) + ': ' + ctx.label + ' is ready — ' +
            (e.weaponName ? 'the next ' + e.weaponName + ' attack' : 'the next attack') +
            ' rolls ' + (Number(e.value) || 2) + ' dice.', 'effect');
          break;
        }
        /* "Gain 1 PSY" — straight into the faction card's pool. */
        case 'resource': {
          const c = cardOf(me);
          if (!c || !c.resource) {
            chainEntry(ctx.label + ': ' + pname(me) + ' has no faction card to gain on.', 'muted');
            break;
          }
          c.resource.value = Math.max(0, (Number(c.resource.value) || 0) + v);
          chainEntry(pname(me) + ' gains ' + v + ' ' + c.resource.name + ' (' + ctx.label +
            ') — now ' + c.resource.value + '.', 'effect');
          break;
        }
        case 'note':
          chainEntry(ctx.label + ': ' + (e.text || 'see ability text'), 'note');
          break;
      }
    });
  }

  /* ================================================================ FLOWS */

  function cancelFlow() {
    Store.commit('cancel', function () { S().flow = null; });
  }

  function actionAvailability(action) {
    const g = S();
    const cp = g.control.player;
    if (g.pending) return { ok: false, why: 'resolve the current phase first' };
    if (action.mission) {
      const m = missionCard();
      if (!m || (m.extraActions || []).indexOf(action.id) < 0) return { ok: false, hide: true };
      if (action.id === 'relic' && relicCarrier()) {
        return { ok: false, why: uname(relicCarrier()) + ' is already carrying it' };
      }
    }
    // A unit hauling the RELIC cannot go on overwatch.
    if (action.id === 'overwatch' && relicCarrier()) {
      const carrier = Store.unit(relicCarrier());
      if (carrier && carrier.owner === cp && eligibleUnits().every(u => u.id === carrier.id)) {
        return { ok: false, why: carrier.name + ' is carrying the RELIC' };
      }
    }
    if (action.onlyOnYourTurn && cp !== g.turn.player) return { ok: false, why: 'only on your own turn' };
    if (action.onlyInChain && !g.chain.active) return { ok: false, why: 'only during an action chain' };
    if (action.notInChain && g.chain.active) return { ok: false, why: 'not during an action chain' };
    if (action.cost !== null && g.players[cp].ap < action.cost) return { ok: false, why: 'not enough AP' };
    if (action.cost === null && g.players[cp].ap < 1) return { ok: false, why: 'not enough AP' };
    if (action.id === 'ability') {
      const pool = eligibleUnits().filter(u => usableAPAbilities(u).length);
      if (!pool.length) return { ok: false, why: 'no affordable ability' };
    }
    return { ok: true };
  }

  /* Units the controlling player may act with right now. */
  function eligibleUnits() {
    const g = S();
    const cp = g.control.player;
    let list = Store.unitsOf(cp, true);
    if (g.chain.active && g.control.forcedUnitId) {
      list = list.filter(u => u.id === g.control.forcedUnitId);
    }
    return list;
  }

  /* The action list is per unit now, so it only offers what that unit can do. */
  function unitActions(unitId) {
    const g = S();
    const u = Store.unit(unitId);
    if (!u || !u.alive) return [];
    if (!eligibleUnits().some(x => x.id === unitId)) return [];
    return actionList().filter(function (a) {
      if (a.noUnit) return false;                       // PASS has its own button
      if (u.reserve) return false;    // off the battlefield: only its arrival ability
      // "That unit may not MOVE this turn."
      if (a.id === 'move' && u.noMoveTurn) return false;
      const av = actionAvailability(a);
      if (av.hide) return false;
      if (a.flow === 'attack') {
        if (!weaponsFor(unitId, a.attackRange).length) return false;
      }
      if (a.id === 'overwatch') {
        if (!(u.weapons || []).some(w => w.type === 'ranged')) return false;
        if (relicCarrier() === unitId) return false;
      }
      if (a.flow === 'ability') return false;   // listed one by one, below
      return true;
    }).map(a => Object.assign({}, a, { available: actionAvailability(a) }))
      /* You already chose the unit, so its Special Abilities belong in the same
         list as its Standard Actions rather than behind a button. */
      .concat(abilityActions(u));
  }

  /* A unit's "[X] AP —" abilities, dressed as entries in its action list. */
  function abilityActions(u) {
    const g = S();
    if (g.pending) return [];
    return (u.abilities || []).filter(a => a.trigger === 'ap' &&
        (!u.reserve || isArrival(a)) &&
        (!a.usesPerGame || (a.used || 0) < a.usesPerGame) &&
        (!a.usesPerTurn || (a.usedTurn || 0) < a.usesPerTurn))
      .map(function (a) {
        const cost = Number(a.cost) || 0;
        const poor = g.players[u.owner].ap < cost;
        return {
          id: 'ability:' + a.id, abilityId: a.id, isAbility: true,
          name: a.name, kind: 'passive', flow: 'ability', cost: cost,
          short: a.text, text: a.text, flavour: '',
          opponentGainsAP: 0, effects: a.effects || [],
          opponentReacts: abilityLetsThemReact(a),
          available: poor ? { ok: false, why: 'not enough AP' } : { ok: true }
        };
      });
  }

  function usableFreeAbilities(u) {
    if (u.reserve) return [];
    return (u.abilities || []).filter(a => a.trigger === 'free' &&
      (!a.usesPerGame || (a.used || 0) < a.usesPerGame));
  }

  /* Whatever brings a unit in from RESERVE — the only thing it may do there. */
  const isArrival = a =>
    (a.effects || []).some(e => e.kind === 'place' && e.fromReserve);

  function usableAPAbilities(u) {
    const g = S();
    return (u.abilities || []).filter(a =>
      a.trigger === 'ap' &&
      (!u.reserve || isArrival(a)) &&
      (Number(a.cost) || 0) <= g.players[u.owner].ap &&
      (!a.usesPerGame || (a.used || 0) < a.usesPerGame) &&
      (!a.usesPerTurn || (a.usedTurn || 0) < a.usesPerTurn));
  }

  function weaponsFor(unitId, range) {
    const g = S();
    const u = Store.unit(unitId);
    if (!u) return [];
    return (u.weapons || [])
      .filter(w => (range === 'melee' ? w.type === 'melee' : w.type === 'ranged'))
      .map((w, i) => Object.assign({}, w, { primary: i === 0 }));
  }

  /* ------------------------------------------------------- start an action */

  function beginAction(actionId, presetUnitId) {
    const action = actionDef(actionId);
    if (!action) return;
    const avail = actionAvailability(action);
    if (!avail.ok) return;

    Store.commit('begin ' + action.name, function () {
      const g = S();
      if (action.id === 'pass') {
        g.flow = { kind: 'pass', actionId: 'pass', step: 'confirm' };
        return;
      }
      const pool = eligibleUnits();
      const chosen = presetUnitId && pool.some(u => u.id === presetUnitId)
        ? presetUnitId : (pool.length === 1 ? pool[0].id : null);
      const base = {
        actionId: action.id,
        unitId: chosen,
        step: chosen ? nextStepAfterUnit(action) : 'unit'
      };
      if (action.flow === 'attack') {
        g.flow = Object.assign({
          kind: 'attack', attackerId: base.unitId, targetId: null, weaponId: null,
          source: 'action', free: false, noReaction: false,
          hitMod: 0, woundMod: 0, elevation: false, notes: [],
          reaction: null, rp: 1, cancelled: false,
          apGrant: true, freeChoice: false, chainLivesOnDeath: false, endsChainOverride: null,
          step: base.unitId ? 'target' : 'attacker'
        }, { actionId: action.id });
      } else if (action.flow === 'ability') {
        g.flow = { kind: 'ability', actionId: 'ability', unitId: base.unitId, abilityId: null,
                   targets: {}, pickIndex: 0,                   step: base.unitId ? 'ability' : 'unit' };
      } else if (action.flow === 'secure') {
        g.flow = { kind: 'secure', actionId: 'secure', unitId: base.unitId, cpId: null,
                   step: base.unitId ? 'point' : 'unit' };
      } else if (action.flow === 'relic') {
        g.flow = { kind: 'relic', actionId: 'relic', unitId: base.unitId,
                   step: base.unitId ? 'confirm' : 'unit' };
      } else if (action.flow === 'overwatch') {
        g.flow = { kind: 'overwatch', actionId: 'overwatch', unitId: base.unitId,
                   step: base.unitId ? 'confirm' : 'unit' };
      } else {
        g.flow = { kind: 'simple', actionId: action.id, unitId: base.unitId,
                   step: base.unitId ? 'confirm' : 'unit' };
      }
    });
  }

  /* Straight into one named ability: the unit and the ability are both known. */
  function beginAbility(unitId, abilityId) {
    const g = S();
    const u = Store.unit(unitId);
    const entry = u && abilityActions(u).find(a => a.abilityId === abilityId);
    if (!entry || !entry.available.ok) return;
    if (!eligibleUnits().some(x => x.id === unitId)) return;
    Store.commit('begin ' + entry.name, function () {
      const st = S();
      st.flow = { kind: 'ability', actionId: 'ability', unitId: unitId,
                  abilityId: abilityId, targets: {}, pickIndex: 0, step: 'confirm' };
      const ab = findAbility(unitId, abilityId);
      if (effectsNeedingTarget(ab, { sourceUnitId: unitId }).length) st.flow.step = 'pick';
      /* "Move this unit D6"." — the app stops and asks for the die first. */
      if (ab.roll) {
        const m = String(ab.roll).toUpperCase().match(/^(\d*)D(\d+)$/);
        st.flow.nextStep = st.flow.step;
        st.flow.step = 'roll';
        st.flow.rollCount = m ? (Number(m[1]) || 1) : 1;
        st.flow.rollDie = m ? Number(m[2]) : 6;
        st.flow.rollWhat = ab.rollWhat || ab.name;
        st.flow.rollNote = ab.rollNote || ab.text;
      }
    });
  }

  function nextStepAfterUnit(action) {
    if (action.flow === 'attack') return 'target';
    if (action.flow === 'ability') return 'ability';
    return 'confirm';
  }

  function flowPickUnit(unitId) {
    Store.commit('select unit', function () {
      const f = S().flow;
      if (!f) return;
      if (f.kind === 'attack') { f.attackerId = unitId; f.step = 'target'; }
      else if (f.kind === 'ability') { f.unitId = unitId; f.step = 'ability'; }
      else if (f.kind === 'secure') { f.unitId = unitId; f.step = 'point'; }
      else { f.unitId = unitId; f.step = 'confirm'; }
    });
  }

  function flowBack() {
    Store.commit('back', function () {
      const f = S().flow;
      if (!f) return;
      const order = {
        attack: ['attacker', 'target', 'weapon', 'reaction', 'redirect', 'hit', 'wound', 'damage'],
        ability: ['unit', 'ability', 'pick', 'confirm'],
        overwatch: ['unit', 'confirm'],
        secure: ['unit', 'point', 'confirm'],
        relic: ['unit', 'confirm'],
        simple: ['unit', 'confirm']
      }[f.kind] || [];
      /* The unit is chosen before the action now, so "which unit?" is not a
         step anyone can go back to — nor is "which ability?" once the ability
         itself was the thing tapped. */
      const skip = { unit: true, attacker: true };
      if (f.abilityId && f.kind === 'ability') skip.ability = true;
      let i = order.indexOf(f.step) - 1;
      while (i >= 0 && skip[order[i]]) i--;
      if (i >= 0) f.step = order[i];
      else S().flow = null;
    });
  }

  /* ------------------------------------------------------ simple actions */

  function confirmSimple() {
    Store.commit('resolve action', function () {
      const g = S();
      const f = g.flow;
      if (!f) return;
      const action = actionDef(f.actionId);
      if (!action) return;
      const actor = g.control.player;
      const responder = Store.opponentOf(actor);
      openChain(actor);
      spendAP(actor, action.cost || 0);
      if (action.expiresOverwatch) expireOnOwnerAction(f.unitId);
      chainEntry(pname(actor) + ': ' + uname(f.unitId) + ' → ' + action.name + '.', 'action');
      if (action.opponentGainsAP) {
        grantAP(responder, action.opponentGainsAP, action.name);
      }
      const movedUnit = f.unitId;
      if (action.movesUnit) noteMoved(movedUnit);
      g.flow = null;
      if (action.movesUnit && openOverwatchCheck(movedUnit, {
            type: 'simple', actor: actor, endsChain: action.endsChain, reason: action.name })) {
        return;
      }
      afterAction({ actor: actor, endsChain: action.endsChain, forcedUnitId: null,
                    reason: action.name });
    });
  }

  function flowPickControlPoint(cpId) {
    Store.commit('choose objective', function () {
      const f = S().flow;
      if (!f) return;
      f.cpId = cpId;
      f.step = 'confirm';
    });
  }

  function confirmSecure() {
    Store.commit('secure', function () {
      const g = S();
      const f = g.flow;
      if (!f || !f.unitId) return;
      const actor = g.control.player;
      const action = actionDef('secure');
      openChain(actor);
      spendAP(actor, action.cost);
      chainEntry(pname(actor) + ': ' + uname(f.unitId) + ' → SECURE.', 'action');
      secureControlPoint(f.cpId, actor, f.unitId);
      g.flow = null;
      afterAction({ actor: actor, endsChain: false, forcedUnitId: null });
    });
  }

  function confirmRelic() {
    Store.commit('pick up relic', function () {
      const g = S();
      const f = g.flow;
      if (!f || !f.unitId) return;
      const actor = g.control.player;
      const action = actionDef('relic');
      openChain(actor);
      spendAP(actor, action.cost);
      chainEntry(pname(actor) + ': ' + uname(f.unitId) + ' → PICK UP THE RELIC.', 'action');
      setRelicCarrier(f.unitId);
      // Carrying it puts out any overwatch this unit had set.
      expireOnOwnerAction(f.unitId);
      g.flow = null;
      afterAction({ actor: actor, endsChain: false, forcedUnitId: null });
    });
  }

  /* PASS on its own does nothing except let the active player end their turn.
     Two passes in a row — one from each player — end the action chain. */
  /* Straight from the board button, with no window in the way. */
  function confirmPassDirect(endTurn) {
    Store.commit('pass', function () {
      const g = S();
      g.flow = { kind: 'pass' };
      doPass(endTurn);
    });
  }

  function confirmPass(endTurn) {
    Store.commit('pass', function () {
      const g = S();
      if (!g.flow) return;
      doPass(endTurn);
    });
  }

  function doPass(endTurn) {
      const g = S();
      const who = g.control.player;
      const isTurnPlayer = who === g.turn.player;
      g.flow = null;

      if (endTurn && isTurnPlayer) {
        chainEntry(pname(who) + ' PASSES and ends their turn.', 'action');
        beginEndPhase('the active player ended their turn');
        return;
      }

      if (!g.chain.active) {
        chainEntry(pname(who) + ' PASSES — no chain is running, so nothing changes.', 'note');
        checkVictory();
        return;
      }

      g.chain.passes = (g.chain.passes || 0) + 1;
      chainEntry(pname(who) + ' PASSES.', 'action');
      if (g.chain.passes >= 2) {
        closeChain('both players passed');
        handOffToTurnPlayer();
        checkVictory();
        return;
      }
      // A pass is a Passive Action: the other player answers with any unit.
      afterAction({ actor: who, endsChain: false, forcedUnitId: null, isPass: true });
  }

  /* What PASS can do from here. */
  function passOptions() {
    const g = S();
    return {
      inChain: g.chain.active,
      wouldEndChain: g.chain.active && (g.chain.passes || 0) >= 1,
      canEndTurn: g.control.player === g.turn.player
    };
  }

  function confirmOverwatch() {
    Store.commit('overwatch', function () {
      const g = S();
      const f = g.flow;
      if (!f || !f.unitId) return;
      const actor = g.control.player;
      const action = actionDef('overwatch');
      openChain(actor);
      spendAP(actor, action.cost);
      const u = Store.unit(f.unitId);
      u.tokens = (u.tokens || []).filter(t => t.kind !== 'overwatch');
      u.tokens.push({
        id: Store.nextId('tk'), label: 'OVERWATCH', kind: 'overwatch',
        expiry: 'ownerActs', isAttack: true,
        text: 'Attack an enemy that moves within 3" of the token, at -1 to hit. No RP for the defender.'
      });
      chainEntry(pname(actor) + ': ' + u.name + ' → OVERWATCH. Token placed.', 'action');
      g.flow = null;
      afterAction({ actor: actor, endsChain: false, forcedUnitId: null });
    });
  }

  /* ------------------------------------------------------------ abilities */

  function flowPickAbility(abilityId) {
    Store.commit('select ability', function () {
      const g = S();
      const f = g.flow;
      const u = Store.unit(f.unitId);
      const ab = (u.abilities || []).find(a => a.id === abilityId);
      if (!ab) return;
      f.abilityId = abilityId;
      f.targets = {};
      f.pickIndex = 0;
      const needs = effectsNeedingTarget(ab, { sourceUnitId: f.unitId });
      f.step = needs.length ? 'pick' : 'confirm';
    });
  }

  /* Abilities, tokens and faction-card powers all pick targets the same way. */
  function flowSource(f) {
    if (!f) return { effects: [], sourceUnitId: null };
    if (f.kind === 'token') {
      return { effects: tokenEffects(f.unitId, f.tokenId), sourceUnitId: f.unitId };
    }
    if (f.kind === 'card') {
      const ab = cardAbility(f.playerId, f.abilityId);
      return { effects: ab ? ab.effects : [], sourceUnitId: null };
    }
    const ab = findAbility(f.unitId, f.abilityId);
    return { effects: ab ? ab.effects : [], sourceUnitId: f.unitId };
  }

  function flowNeeds(f) {
    const src = flowSource(f);
    return effectsNeedingTarget({ effects: src.effects }, { sourceUnitId: src.sourceUnitId });
  }

  function flowPickTarget(effectId, unitId) {
    Store.commit('select target', function () {
      const f = S().flow;
      const needs = flowNeeds(f);
      const e = needs.find(x => x.id === effectId);
      if (e && e.pick === 'multi') { toggleMulti(f, e, unitId); return; }
      f.targets[effectId] = unitId;
      const done = needs.every(x => filled(f.targets[x.id]));
      if (!done) { f.pickIndex = needs.findIndex(x => !filled(f.targets[x.id])); return; }
      /* Nothing left to decide and nothing to pay: an ability that resolves
         itself at the start of the game just gets on with it. */
      if (f.setupStep) { resolveFreeFlow(f); return; }
      f.step = 'confirm';
    });
  }

  const filled = t => Array.isArray(t) ? t.length > 0 : !!t;

  function toggleMulti(f, e, unitId) {
    const cur = Array.isArray(f.targets[e.id]) ? f.targets[e.id] : [];
    const on = cur.indexOf(unitId) >= 0;
    // "…up to two friendly units": the app holds you to the number on the card.
    if (!on && e.max && cur.length >= Number(e.max)) return;
    f.targets[e.id] = on ? cur.filter(x => x !== unitId) : cur.concat([unitId]);
  }

  /* "That's everyone" on a multi-unit pick. */
  function flowDoneTargets() {
    Store.commit('targets chosen', function () {
      const f = S().flow;
      if (!f) return;
      const next = flowNeeds(f).findIndex(x => !filled(f.targets[x.id]));
      if (next >= 0) { f.pickIndex = next; return; }
      if (f.setupStep) { resolveFreeFlow(f); return; }
      f.step = 'confirm';
    });
  }

  /* ------------------------------------------------------- faction cards */

  const cardOf = playerId => (S().players[playerId] || {}).card || null;

  function cardAbility(playerId, abilityId) {
    const c = cardOf(playerId);
    return (c && (c.abilities || []).find(a => a.id === abilityId)) || null;
  }

  /* The card says START:, so the powers are only buyable in that phase. */
  function cardAbilities(playerId) {
    const g = S();
    const c = cardOf(playerId);
    if (!c) return [];
    const res = c.resource ? Number(c.resource.value) || 0 : 0;
    const inStart = !!(g.pending && g.pending.type === 'start' && g.pending.player === playerId);
    return (c.abilities || []).map(function (a) {
      const cost = Number(a.cost) || 0;
      let why = '';
      if (!inStart) why = 'only in ' + pname(playerId) + '’s Start Phase';
      else if (c.resource && cost > res) why = 'not enough ' + c.resource.name;
      return Object.assign({}, a, { available: { ok: !why, why: why } });
    });
  }

  function useCardAbility(playerId, abilityId) {
    Store.commit('card power', function () {
      const g = S();
      const av = cardAbilities(playerId).find(a => a.id === abilityId);
      if (!av || !av.available.ok) return;
      const ab = cardAbility(playerId, abilityId);
      if (effectsNeedingTarget(ab, { sourceUnitId: null }).length) {
        g.flow = { kind: 'card', playerId: playerId, abilityId: abilityId,
                   targets: {}, pickIndex: 0, step: 'pick' };
        return;
      }
      resolveCardAbility(playerId, abilityId, {});
    });
  }

  function confirmCard() {
    Store.commit('card power', function () {
      const g = S();
      const f = g.flow;
      if (!f || f.kind !== 'card') return;
      const pid = f.playerId, aid = f.abilityId, tg = f.targets;
      g.flow = null;
      resolveCardAbility(pid, aid, tg);
    });
  }

  function resolveCardAbility(playerId, abilityId, targets) {
    const c = cardOf(playerId);
    const ab = cardAbility(playerId, abilityId);
    if (!c || !ab) return;
    const cost = Number(ab.cost) || 0;
    if (c.resource) {
      c.resource.value = Math.max(0, (Number(c.resource.value) || 0) - cost);
      log(pname(playerId) + ' spends ' + cost + ' ' + c.resource.name + ' on “' + ab.name +
        '” — ' + c.resource.value + ' left.', 'action');
    } else {
      log(pname(playerId) + ' uses “' + ab.name + '”.', 'action');
    }
    const ctx = { sourceUnitId: null, sourcePlayer: playerId,
                  targets: targets || {}, label: ab.name };
    applyEffects(ab.effects, ctx);
    checkVictory();
    openOverwatchFor(ctx.placed || [], { type: 'none' });
  }

  function adjustCardResource(playerId, delta) {
    Store.commit('adjust resource', function () {
      const c = cardOf(playerId);
      if (!c || !c.resource) return;
      c.resource.value = Math.max(0, (Number(c.resource.value) || 0) + delta);
    });
  }

  /* Each ability states whether the opponent gets to react. Older abilities
     stored the answer as endsChain, so fall back to that. */
  function abilityLetsThemReact(ab) {
    if (!ab) return true;
    if (ab.opponentReacts !== undefined && ab.opponentReacts !== null) return !!ab.opponentReacts;
    if (ab.endsChain === 'yes') return false;
    return true;
  }

  function findAbility(unitId, abilityId) {
    const u = Store.unit(unitId);
    if (!u) return null;
    return (u.abilities || []).find(a => a.id === abilityId) || null;
  }

  /* Resolve a free-use ability flow. Callers are already inside a commit. */
  function resolveFreeFlow(f) {
    const g = S();
    const uid = f.unitId, aid = f.abilityId, tg = f.targets;
    const setup = f.setupStep, phase = f.phaseStep;
    g.flow = null;
    if (phase) resolvePhaseAbility(uid, aid, tg);
    else resolveFreeAbility(uid, aid, tg);
    if (setup) advanceSetupQueue();
  }

  function confirmAbility() {
    Store.commit('use ability', function () {
      const g = S();
      const f = g.flow;
      if (!f) return;
      /* A card button, not a Standard Action: no AP, no effect on the chain. */
      if (f.freeUse) { resolveFreeFlow(f); return; }
      const actor = g.control.player;
      const ab = findAbility(f.unitId, f.abilityId);
      if (!ab) { g.flow = null; return; }
      const action = actionDef('ability');
      const responder = Store.opponentOf(actor);
      openChain(actor);
      spendAP(actor, Number(ab.cost) || 0);
      ab.used = (ab.used || 0) + 1;
      ab.usedTurn = (ab.usedTurn || 0) + 1;
      chainEntry(pname(actor) + ': ' + uname(f.unitId) + ' → SPECIAL ABILITY “' + ab.name + '”.', 'action');
      /* The die was rolled before the chain opened, so it is recorded here. */
      if (f.rolled !== undefined && f.rolled !== true) {
        chainEntry(uname(f.unitId) + ' rolled ' + f.rolled + ' for ' +
          (ab.rollWhat || ab.name) + '.', 'note');
      }
      const ctx = {
        sourceUnitId: f.unitId, sourcePlayer: actor, targets: f.targets,
        label: ab.name, opponent: responder
      };
      applyEffects(ab.effects, ctx);
      const ends = !abilityLetsThemReact(ab);
      if (ends) chainEntry('“' + ab.name + '” does not let the opponent react — the chain ends.', 'note');
      const unitId = f.unitId;
      /* Whatever the ability moved: the unit itself, or the units it placed. */
      const movers = (ctx.placed && ctx.placed.length)
        ? ctx.placed : (ab.moves ? [unitId] : []);
      g.flow = null;

      /* The ability says "make an attack" — hand straight over to the attack
         flow and settle the chain once it resolves. */
      if (ctx.freeAttack) {
        openFreeAttack(unitId, ctx.freeAttack);
        if (S().flow) {
          S().flow.pendingAfter = {
            actor: actor, endsChain: ends || ctx.freeAttack.endsChain, reason: ab.name
          };
        }
        return;
      }
      if (openOverwatchFor(movers, {
            type: 'simple', actor: actor, endsChain: ends, reason: ab.name,
            ignoreDown: movers.length > 1 })) {
        return;
      }
      afterAction({ actor: actor, endsChain: ends, forcedUnitId: null, reason: ab.name });
    });
  }

  /* "Whenever this unit defeats an enemy unit using its Bayonet…" — the app
     watched the kill happen, so it fires the ability itself. */
  function runOnKillAbilities(attackerId, weapon, victimName) {
    const u = Store.unit(attackerId);
    if (!u) return;
    (u.abilities || []).filter(a => a.trigger === 'onkill').forEach(function (ab) {
      if (ab.weaponName && weapon &&
          String(ab.weaponName).toLowerCase() !== String(weapon.name).toLowerCase()) return;
      if (ab.usesPerGame && (ab.used || 0) >= ab.usesPerGame) return;
      ab.used = (ab.used || 0) + 1;
      chainEntry(u.name + ': “' + ab.name + '” triggers — ' + victimName + ' is down.', 'action');
      applyEffects(ab.effects, {
        sourceUnitId: attackerId, sourcePlayer: u.owner, targets: {}, label: ab.name
      });
    });
  }

  /* Free/manual ability button on a unit card — no action, no AP economy.
     If any of its effects needs a unit chosen, ask first. */
  function useFreeAbility(unitId, abilityId) {
    Store.commit('free ability', function () {
      const g = S();
      const ab = findAbility(unitId, abilityId);
      if (!ab) return;
      const needs = effectsNeedingTarget(ab, { sourceUnitId: unitId });
      if (needs.length) {
        g.flow = { kind: 'ability', freeUse: true, actionId: 'ability', unitId: unitId,
                   abilityId: abilityId, targets: {}, pickIndex: 0, step: 'pick' };
        return;
      }
      resolveFreeAbility(unitId, abilityId, {});
    });
  }

  function resolveFreeAbility(unitId, abilityId, targets) {
    const u = Store.unit(unitId);
    const ab = findAbility(unitId, abilityId);
    if (!ab || !u) return;
    ab.used = (ab.used || 0) + 1;
    ab.usedTurn = (ab.usedTurn || 0) + 1;
    chainEntry(u.name + ' uses “' + ab.name + '”.', 'action');
    const ctx = { sourceUnitId: unitId, sourcePlayer: u.owner, targets: targets || {}, label: ab.name };
    applyEffects(ab.effects, ctx);
    checkVictory();
    if (ctx.freeAttack) { openFreeAttack(unitId, ctx.freeAttack); return; }
    const movers = (ctx.placed && ctx.placed.length) ? ctx.placed : (ab.moves ? [unitId] : []);
    openOverwatchFor(movers, { type: 'none' });
  }

  /* START:/END: abilities fired from the phase modal. Some of them need a unit
     chosen first ("place up to two friendly units"), so they open a picker over
     the phase modal and come back to it. */
  function usePhaseAbility(unitId, abilityId) {
    Store.commit('phase ability', function () {
      const g = S();
      const ab = findAbility(unitId, abilityId);
      if (!ab) return;
      if (effectsNeedingTarget(ab, { sourceUnitId: unitId }).length) {
        g.flow = { kind: 'ability', freeUse: true, phaseStep: true, actionId: 'ability',
                   unitId: unitId, abilityId: abilityId,
                   targets: {}, pickIndex: 0, step: 'pick' };
        return;
      }
      resolvePhaseAbility(unitId, abilityId, {});
    });
  }

  function resolvePhaseAbility(unitId, abilityId, targets) {
    const g = S();
    const u = Store.unit(unitId);
    const ab = findAbility(unitId, abilityId);
    if (!u || !ab) return;
    ab.used = (ab.used || 0) + 1;
    ab.usedTurn = (ab.usedTurn || 0) + 1;
    log(u.name + ' — ' + ab.trigger.toUpperCase() + ': “' + ab.name + '”.', 'action');
    const ctx = { sourceUnitId: unitId, sourcePlayer: u.owner,
                  targets: targets || {}, label: ab.name };
    applyEffects(ab.effects, ctx);
    if (g.pending) {
      if (!g.pending.fired) g.pending.fired = [];
      g.pending.fired.push(abilityId);
    }
    checkVictory();
    const movers = (ctx.placed && ctx.placed.length) ? ctx.placed : (ab.moves ? [unitId] : []);
    openOverwatchFor(movers, { type: 'none' });
  }

  /* ================================================================ ATTACK */

  function flowPickAttackTarget(unitId) {
    Store.commit('select target', function () {
      const f = S().flow;
      f.targetId = unitId;
      const action = actionDef(f.actionId);
      const list = weaponsFor(f.attackerId, action ? action.attackRange : 'ranged');
      if (list.length === 1) { f.weaponId = list[0].id; declareAttack(); }
      else f.step = 'weapon';
    });
  }

  /* The number rolled on a step the app paused for. `n` may be null when the
     roll only mattered on the table. */
  function flowRoll(n) {
    Store.commit('roll', function () {
      const g = S();
      const f = g.flow;
      if (!f) return;
      const rolled = Number(n);
      if (f.kind === 'attack') {
        f.rolled = true;
        chainEntry(uname(f.attackerId) + ' rolls ' + (isFinite(rolled) ? rolled : '?') +
          '" for ' + (f.rollWhat || 'the roll') + '.', 'note');
        declareAttack();
        return;
      }
      /* An ability that told you to roll: note it and carry on to the confirm. */
      f.rolled = isFinite(rolled) ? rolled : true;
      f.step = f.nextStep || 'confirm';
    });
  }

  /* A charge that could not reach: nothing comes of it, per the rules on an
     action that cannot be performed. */
  function flowChargeFailed() {
    Store.commit('charge failed', function () {
      const g = S();
      const f = g.flow;
      if (!f || f.kind !== 'attack') return;
      const actor = g.control.player;
      chainEntry(uname(f.attackerId) + ' cannot reach ' + uname(f.targetId) +
        ' — the charge is not made, and nothing comes of it.', 'note');
      g.flow = null;
      afterAction({ actor: actor, endsChain: false, forcedUnitId: null, reason: 'CHARGE' });
    });
  }

  function flowPickWeapon(weaponId) {
    Store.commit('select weapon', function () {
      const f = S().flow;
      f.weaponId = weaponId;
      declareAttack();
    });
  }

  /* The attack is fully declared: pay for it, open the chain, hand the
     defender their RP, then move to the reaction (or straight to the roll). */
  function declareAttack() {
    const g = S();
    const f = g.flow;
    if (!f || f.kind !== 'attack') return;
    if (!f.paid) {
      const action = actionDef(f.actionId);
      const actor = g.control.player;
      openChain(actor);
      spendAP(actor, action.cost || 0);
      if (action.expiresOverwatch) expireOnOwnerAction(f.attackerId);
      chainEntry(pname(actor) + ': ' + uname(f.attackerId) + ' → ' + action.name +
        ' → ' + uname(f.targetId) + '.', 'action');
      f.paid = true;
    }
    /* A charge is a dice roll before it is an attack: stop and ask for it
       rather than assuming the distance was made. Outside the paid block, so
       re-entering the declaration does not skip past it. */
    if (actionDef(f.actionId).isCharge && !f.rolled) {
      f.step = 'roll';
      f.rollDie = 6;
      f.rollWhat = 'the charge distance';
      f.rollNote = 'Move up to that many inches toward the target. You must end in ' +
                   'range of a melee weapon, or not move at all.';
      return;
    }
    primeAttackMods();
    const defender = Store.unit(f.targetId);
    if (defender && defender.noRP) {
      f.noReaction = true;
      chainEntry(defender.name + ' has no RP — no reaction.', 'rp');
    }
    if (f.noReaction) {
      f.step = 'hit';
    } else {
      g.players[defender.owner].rp = 1 + (f.rpBonus || 0);
      chainEntry(defender.name + ' gains 1 RP.', 'rp');
      f.step = 'reaction';
    }

    /* A charge moves the attacker first, which may walk into a waiting trigger. */
    const action2 = actionDef(f.actionId);
    if (action2 && action2.movesUnit) {
      noteMoved(f.attackerId);
      const parked = JSON.parse(JSON.stringify(f));
      if (openOverwatchCheck(f.attackerId, { type: 'attack', flow: parked })) return;
    }
  }

  /* Fold standing unit effects into the attack's running modifiers. */
  function primeAttackMods() {
    const f = S().flow;
    if (f.primed) return;
    f.primed = true;
    const ah = unitHitMod(f.attackerId);
    const aw = unitWoundMod(f.attackerId);
    if (ah) { f.hitMod += ah; f.notes.push('Attacker\'s standing effects: ' + (ah > 0 ? '+' : '') + ah + ' to hit.'); }
    if (aw) { f.woundMod += aw; f.notes.push('Attacker\'s standing effects: ' + (aw > 0 ? '+' : '') + aw + ' to wound.'); }
    f.diceOn = {};
    diceOptions(f).forEach(function (o) {
      if (o.auto || o.suggested) f.diceOn[o.key] = true;
    });
  }

  /* "Rolls 4 dice instead of one." A weapon can throw more than one shot, from
     a passive on the attacker (which may carry a condition the app can answer
     for itself) or from a one-shot power bought off a faction card. */
  function diceOptions(f) {
    if (!f || f.kind !== 'attack' || !f.weaponId) return [];
    const g = S();
    const atk = Store.unit(f.attackerId);
    const weapon = atk && (atk.weapons || []).find(w => w.id === f.weaponId);
    if (!atk || !weapon) return [];
    const same = n => String(n || '').toLowerCase() === String(weapon.name).toLowerCase();
    const out = [];
    (atk.abilities || []).filter(a => a.trigger === 'passive').forEach(function (a) {
      (a.effects || []).forEach(function (e, i) {
        if (e.kind !== 'dice') return;
        if (e.weaponName && !same(e.weaponName)) return;
        const notMoved = e.condition === 'notmoved';
        out.push({
          key: 'ab:' + a.id + ':' + (e.id || i),
          value: Number(e.value) || 2,
          label: a.name,
          text: e.text || a.text || '',
          condition: notMoved ? 'this unit has not moved this turn' : (e.condition || ''),
          suggested: notMoved ? !atk.movedThisTurn : true,
          auto: false
        });
      });
    });
    (g.players[atk.owner].buffs || []).forEach(function (b) {
      if (b.kind !== 'dice') return;
      if (b.weaponName && !same(b.weaponName)) return;
      out.push({ key: 'buff:' + b.id, value: Number(b.value) || 2, label: b.label,
                 text: b.text || '', condition: '', suggested: true, auto: true });
    });
    return out;
  }

  function attackDice(f) {
    let n = 1;
    const applied = [];
    diceOptions(f).forEach(function (o) {
      if (!o.auto && !((f.diceOn || {})[o.key])) return;
      applied.push(o);
      n = Math.max(n, o.value);          // "rolls N dice rather than 1" — a set, not a sum
    });
    return { count: n, applied: applied };
  }

  function toggleDice(key) {
    Store.commit('dice', function () {
      const f = S().flow;
      if (!f) return;
      f.diceOn = f.diceOn || {};
      f.diceOn[key] = !f.diceOn[key];
    });
  }

  /* A card power that buffed "your next attack with a Storm Bolter" is spent by
     the attack that used it, hit or miss. */
  function spendDiceBuffs(f) {
    const g = S();
    const atk = Store.unit(f.attackerId);
    if (!atk) return;
    const used = attackDice(f).applied.filter(o => o.key.indexOf('buff:') === 0)
      .map(o => o.key.slice(5));
    if (!used.length) return;
    const p = g.players[atk.owner];
    p.buffs = (p.buffs || []).filter(function (b) {
      if (used.indexOf(b.id) < 0) return true;
      chainEntry(b.label + ' is spent.', 'note');
      return false;
    });
  }

  function setElevation(on) {
    Store.commit('elevation', function () {
      const f = S().flow;
      f.elevation = !!on;
    });
  }

  function flowPickReaction(reactionId, abilityId) {
    Store.commit('reaction', function () {
      const g = S();
      const f = g.flow;
      const action = actionDef(f.actionId);
      const range = action.attackRange;
      const defender = Store.unit(f.targetId);
      const defPlayer = defender.owner;

      if (reactionId === 'none') {
        f.reaction = { id: 'none', name: 'NO REACTION' };
        chainEntry(defender.name + ' does not react (1 RP wasted).', 'reaction');
        primeAttackMods();
        f.step = 'hit';
        return;
      }

      if (reactionId === 'special') {
        const ab = findAbility(f.targetId, abilityId);
        if (!ab) return;
        f.reaction = { id: 'special', name: ab.name, abilityId: abilityId };
        ab.used = (ab.used || 0) + 1;
        chainEntry(defender.name + ' reacts: SPECIAL RP “' + ab.name + '”.', 'reaction');
        const ctxSpecial = {
          sourceUnitId: f.targetId, sourcePlayer: defPlayer, targets: {},
          label: ab.name, attack: f
        };
        applyEffects(ab.effects, ctxSpecial);
        primeAttackMods();

        /* "Kwik Dakka": the reaction attacks first. Park the original attack,
           run the counter, and resume — or drop it if the attacker dies. */
        if (ctxSpecial.freeAttack) {
          const parked = JSON.parse(JSON.stringify(f));
          parked.step = 'hit';
          const counterOn = f.attackerId;
          openFreeAttack(f.targetId, Object.assign({}, ctxSpecial.freeAttack, { label: ab.name }));
          if (S().flow) {
            S().flow.targetId = counterOn;
            S().flow.step = S().flow.weaponId ? 'hit' : 'weapon';
            S().flow.resumeFlow = parked;
          }
          return;
        }

        f.step = f.redirect ? 'redirect' : 'hit';
        if (ab.moves) f.reactionMoves = true;

        /* A reaction that moves this unit gets its overwatch look now. One that
           moves whoever it redirects to waits until that unit is chosen. */
        if (ab.moves && !f.redirect) {
          noteMoved(f.targetId);
          const parkedA = JSON.parse(JSON.stringify(f));
          if (openOverwatchCheck(f.targetId, { type: 'attack', flow: parkedA })) return;
        }
        return;
      }

      const r = RULES.reactionById(reactionId, range);
      if (!r) return;
      f.reaction = { id: r.id, name: r.name };
      chainEntry(defender.name + ' reacts: ' + r.name + '.', 'reaction');

      if (r.hitMod)   { f.hitMod += r.hitMod;   f.notes.push(r.name + ': ' + (r.hitMod > 0 ? '+' : '') + r.hitMod + ' to the attacker\'s Hit roll.'); }
      if (r.woundMod) { f.woundMod += r.woundMod; f.notes.push(r.name + ': ' + (r.woundMod > 0 ? '+' : '') + r.woundMod + ' to the attacker\'s Wound roll.'); }
      if (r.tabletop) f.notes.push('Tabletop: ' + r.tabletop);
      if (r.grantAP) grantAP(defPlayer, r.grantAP, r.name);
      if (r.selfEffect) {
        addEffect(f.targetId, {
          label: r.name + ' — ' + r.selfEffect.label,
          detail: r.selfEffect.detail || '',
          hitMod: r.selfEffect.hitBonus || 0,
          woundMod: r.selfEffect.woundBonus || 0,
          duration: r.selfEffect.duration || 'chain',
          ownerPlayer: defPlayer
        });
        chainEntry(defender.name + ': ' + r.selfEffect.detail, 'effect');
      }
      if (r.noAPGrant) f.apGrant = false;
      if (r.grantAPOnSurvive) f.bonusSurviveAP = (f.bonusSurviveAP || 0) + r.grantAPOnSurvive;
      if (r.freeChoice) f.freeChoice = true;
      if (r.chainLivesOnDeath) f.chainLivesOnDeath = true;
      if (r.endsChain) f.endsChainOverride = true;
      if (r.onSurviveTabletop) f.onSurviveTabletop = r.onSurviveTabletop;

      primeAttackMods();
      f.step = 'hit';

      /* A reaction that moves the defender can walk them into a waiting
         trigger — DODGE 1", DIVE 3", WITHDRAW 3". */
      if (r.moves) {
        noteMoved(f.targetId);
        const parkedR = JSON.parse(JSON.stringify(f));
        if (openOverwatchCheck(f.targetId, { type: 'attack', flow: parkedR })) return;
      }
    });
  }

  /* "It's Your Job": the defender points the attack at one of their other units. */
  function flowRedirect(newTargetId) {
    Store.commit('redirect', function () {
      const f = S().flow;
      if (!f) return;
      const from = uname(f.targetId);
      const moved = f.reactionMoves && newTargetId !== f.targetId;
      f.targetId = newTargetId;
      f.redirect = false;
      chainEntry('The attack is redirected from ' + from + ' to ' + uname(newTargetId) + '.', 'reaction');
      f.step = 'hit';
      if (moved) {
        const parkedR = JSON.parse(JSON.stringify(f));
        openOverwatchCheck(newTargetId, { type: 'attack', flow: parkedR });
      }
    });
  }

  /* Roll target numbers, for display only — the player still rolls the dice. */
  function attackNumbers() {
    const f = S().flow;
    if (!f || f.kind !== 'attack') return null;
    const attacker = Store.unit(f.attackerId);
    const target = Store.unit(f.targetId);
    const weapon = attacker && (attacker.weapons || []).find(w => w.id === f.weaponId);
    if (!attacker || !target || !weapon) return null;
    /* High ground: +1 to Hit when shooting, +1 to Wound and +1 Damage when
       charging down onto the target. */
    const elevKind = actionDef(f.actionId).elevation;
    const high = !!f.elevation;
    const elevHit    = (high && elevKind === 'shoot') ? 1 : 0;
    const elevWound  = (high && elevKind === 'charge') ? 1 : 0;
    const elevDamage = (high && elevKind === 'charge') ? 1 : 0;

    const au = auraMods(f);
    const dice = attackDice(f);
    const markBonus = markDamageBonus(f.attackerId, f.targetId, weapon);
    const hitMod = f.hitMod + elevHit + (f.sourceHitMod || 0) + au.hit;
    const woundMod = f.woundMod + elevWound + au.wound;
    const strMod = au.strength + unitStrengthMod(f.attackerId) + (f.strengthMod || 0);
    const baseStrength = Number(weapon.strength) || 0;
    const strength = Math.max(1, baseStrength + strMod);
    const baseHit = Number(weapon.hit) || Number(attacker.hit) || 4;
    const hit = RULES.applyMod(baseHit, hitMod);
    const baseWound = RULES.woundTarget(strength, target.toughness);
    const wound = RULES.applyMod(baseWound, woundMod);
    return {
      weapon: weapon, attacker: attacker, target: target,
      baseHit: baseHit, hitMod: hitMod, hitTarget: hit.target, hitCapped: hit.capped,
      baseWound: baseWound, woundMod: woundMod, woundTarget: wound.target, woundCapped: wound.capped,
      woundReason: RULES.woundLabel(strength, target.toughness),
      strength: strength, baseStrength: baseStrength, strMod: strMod,
      elevKind: elevKind, elevHit: elevHit, elevWound: elevWound, elevDamage: elevDamage,
      /* Damage may be written as D3 or D6 — the app shows it and takes your roll. */
      damageText: String(weapon.damage),
      variableDamage: !isFinite(Number(weapon.damage)),
      markDamage: markBonus,
      baseDamage: Number(weapon.damage) || 0,
      /* Damage per wound. With several dice the app multiplies by how many
         actually wounded and lets you correct the total. */
      damage: (Number(weapon.damage) || 0) + elevDamage + markBonus,
      dice: dice.count, diceSources: dice.applied,
      hits: f.hits || 0, wounds: f.woundCount || 0
    };
  }

  function flowHit(didHit) {
    Store.commit(didHit ? 'hit' : 'miss', function () {
      const f = S().flow;
      if (!didHit) {
        fx('miss', { unitId: f.targetId });
        chainEntry(uname(f.attackerId) + ' MISSES ' + uname(f.targetId) + '.', 'miss');
        finishAttack({ hit: false });
      } else if (f.skipWound) {
        fx('hit', { unitId: f.targetId });
        // e.g. Choke Hold: a hit resolves without a Wound roll.
        chainEntry(uname(f.attackerId) + ' HITS ' + uname(f.targetId) +
          ' — no Wound roll for this attack.', 'hitline');
        finishAttack({ hit: true, wound: false });
      } else {
        fx('hit', { unitId: f.targetId });
        chainEntry(uname(f.attackerId) + ' HITS ' + uname(f.targetId) + '.', 'hitline');
        f.step = 'wound';
      }
    });
  }

  /* Several dice at once: you tell the app how many of them landed. */
  function flowHits(count) {
    Store.commit('hits', function () {
      const f = S().flow;
      const total = attackDice(f).count;
      const n = Math.max(0, Math.min(total, Number(count) || 0));
      f.hits = n;
      if (!n) {
        fx('miss', { unitId: f.targetId });
        chainEntry(uname(f.attackerId) + ' rolls ' + total + ' dice at ' + uname(f.targetId) +
          ' — none of them hit.', 'miss');
        finishAttack({ hit: false });
        return;
      }
      fx('hit', { unitId: f.targetId, count: n });
      chainEntry(uname(f.attackerId) + ': ' + n + ' of ' + total + ' shots hit ' +
        uname(f.targetId) + '.', 'hitline');
      if (f.skipWound) { finishAttack({ hit: true, wound: false }); return; }
      f.step = 'wound';
    });
  }

  function flowWounds(count) {
    Store.commit('wounds', function () {
      const f = S().flow;
      const n = Math.max(0, Math.min(f.hits || 1, Number(count) || 0));
      f.woundCount = n;
      if (!n) {
        fx('nowound', { unitId: f.targetId });
        chainEntry('None of the hits wound ' + uname(f.targetId) + '.', 'miss');
        finishAttack({ hit: true, wound: false });
        return;
      }
      const a = attackNumbers();
      f.damage = (a ? a.damage : 1) * n;
      chainEntry(n + ' of ' + (f.hits || 1) + ' hits WOUND ' + uname(f.targetId) + '.', 'hitline');
      if (a && !a.variableDamage) {
        finishAttack({ hit: true, wound: true, damage: f.damage });
        return;
      }
      f.step = 'damage';
    });
  }

  function flowWound(didWound) {
    Store.commit(didWound ? 'wound' : 'no wound', function () {
      const f = S().flow;
      if (!didWound) {
        fx('nowound', { unitId: f.targetId });
        chainEntry('The attack fails to wound ' + uname(f.targetId) + '.', 'miss');
        finishAttack({ hit: true, wound: false });
      } else {
        const n = attackNumbers();
        chainEntry('The attack WOUNDS ' + uname(f.targetId) + '.', 'hitline');
        if (n && n.elevWound) {
          chainEntry('High ground: +1 to Wound and +1 Damage from the charge.', 'note');
        }
        /* The weapon's damage is on the card, so the app applies it. It only
           asks when the card itself says to roll (D3, D6). */
        if (n && !n.variableDamage) {
          f.damage = n.damage;
          finishAttack({ hit: true, wound: true, damage: f.damage });
          return;
        }
        f.damage = n ? n.damage : 1;
        f.step = 'damage';
      }
    });
  }

  function flowDamage(amount) {
    Store.commit('damage', function () {
      const f = S().flow;
      f.damage = Math.max(0, Number(amount) || 0);
      finishAttack({ hit: true, wound: true, damage: f.damage });
    });
  }


  function finishAttack(result) {
    const g = S();
    const f = g.flow;
    spendDiceBuffs(f);
    const attackerPlayer = Store.owner(f.attackerId);
    const defenderPlayer = Store.owner(f.targetId);
    let killed = false;

    if (result.damage) {
      const victim = uname(f.targetId);
      const wpn = (Store.unit(f.attackerId) || { weapons: [] }).weapons
        .find(w => w.id === f.weaponId);
      killed = dealDamage(f.targetId, result.damage, attackerPlayer, '', f.attackerId);
      if (killed) runOnKillAbilities(f.attackerId, wpn, victim);
    }

    // RP never carries between attacks.
    g.players[defenderPlayer].rp = 0;

    // Standing "this attack" modifiers are done.
    expireEffects('attack', null);

    if (!killed && f.onSurviveTabletop) chainEntry('Tabletop: ' + f.onSurviveTabletop, 'note');

    const isOverwatch = f.source === 'overwatch';
    let endsChain = false;
    let forcedUnitId = null;

    if (killed) {
      endsChain = !f.chainLivesOnDeath;
      if (f.chainLivesOnDeath) chainEntry('DISTRACT: the action chain continues despite the loss.', 'reaction');
      forcedUnitId = null;
    } else {
      // Survivor's AP, per the SHOOT/FIGHT sequence.
      let grant = 0;
      if (f.apGrant && !result.cancelled && !isOverwatch) grant += 1;
      if (f.bonusSurviveAP) grant += f.bonusSurviveAP;
      if (isOverwatch && g.settings.overwatchGrantsAP && !result.cancelled) grant += 1;
      if (grant > 0) grantAP(defenderPlayer, grant, 'survived the attack');
      else if (!isOverwatch) chainEntry(uname(f.targetId) + ' gains no AP from this attack.', 'muted');

      if (!f.freeChoice) forcedUnitId = f.targetId;
      endsChain = !!f.endsChainOverride;
    }

    g.flow = null;

    /* Something interrupted an attack — a counter-attack, an overwatch fired
       into a DIVE. If either party is down, the parked action cannot be
       performed and nothing comes of it. */
    if (f.resumeFlow && f.resumeFlow.kind === 'owcheck') {
      g.flow = f.resumeFlow;
      runOverwatchQueue();
      checkVictory();
      return;
    }

    if (f.resumeFlow) {
      const parked = f.resumeFlow;
      const atk = Store.unit(parked.attackerId);
      const def = Store.unit(parked.targetId);
      const atkDown = !atk || !atk.alive;
      const defDown = !def || !def.alive;
      if (atkDown || defDown) {
        chainEntry((atkDown ? uname(parked.attackerId) + ' is down'
                            : uname(parked.targetId) + ' is down') +
          ' — the interrupted attack never resolves, and nothing comes of it.', 'reaction');
        g.flow = null;
        closeChain('a unit was destroyed mid-action');
        handOffToTurnPlayer();
        checkVictory();
        return;
      }
      chainEntry('The interrupt is done — ' + atk.name + '\u2019s attack resumes.', 'reaction');
      g.flow = parked;
      checkVictory();
      return;
    }

    /* An ability that spawned this attack told us what to do afterwards. */
    if (f.pendingAfter) {
      const after = f.pendingAfter;
      afterAction({
        actor: after.actor,
        endsChain: after.endsChain || !!f.endsChainOverride || killed,
        forcedUnitId: killed ? null : forcedUnitId,
        reason: after.reason
      });
      return;
    }

    if (isOverwatch || f.source === 'free') {
      // An interrupt: it does not hand control over unless the target died.
      const what = isOverwatch ? 'Overwatch attack' : (f.freeLabel || 'Free attack');
      if (killed) {
        closeChain(what.toLowerCase() + ' kill');
        handOffToTurnPlayer();
      } else {
        chainEntry(what + ' resolved — play continues with ' +
          pname(g.control.player) + '.', 'control');
      }
      checkVictory();
      return;
    }

    afterAction({
      actor: attackerPlayer,
      endsChain: endsChain,
      forcedUnitId: forcedUnitId,
      reason: killed ? 'target destroyed' : (f.endsChainOverride ? 'WITHDRAW' : null)
    });
  }

  /* A free attack: no AP, no RP for the defender, optional roll modifier, and
     optionally no wound roll at all. Used by reaction shots and by abilities
     that say "make an attack with this unit's <weapon>". */
  function openFreeAttack(unitId, opts) {
    const g = S();
    const o = opts || {};
    const u = Store.unit(unitId);
    if (!u) return;
    const range = (o.weapon === 'melee') ? 'melee' : 'ranged';
    const list = (u.weapons || []).filter(w => w.type === range);
    g.flow = {
      kind: 'attack',
      actionId: range === 'melee' ? 'fight' : 'shoot',
      attackerId: unitId, targetId: null,
      weaponId: list.length === 1 ? list[0].id : null,
      source: 'free', freeLabel: o.label || 'Free attack',
      noReaction: o.noRP !== false, free: true, paid: true,
      hitMod: 0, woundMod: 0, sourceHitMod: Number(o.hitMod) || 0,
      skipWound: !!o.skipWound, elevation: false,
      notes: [(o.label || 'Free attack') + ': no AP' +
              (o.noRP !== false ? ', the defender gains no RP' : '') +
              (o.hitMod ? ', ' + (o.hitMod > 0 ? '+' : '') + o.hitMod + ' to hit' : '') +
              (o.skipWound ? ', no Wound roll' : '') + '.'],
      reaction: null, cancelled: false, apGrant: false, auras: {},
      freeChoice: false, chainLivesOnDeath: false,
      endsChainOverride: o.endsChain ? true : null,
      step: 'target'
    };
  }


  /* ------------------------------------------------------ token triggers */

  /* Overwatch triggers on MOVEMENT, so it is offered when something moves —
     never as a free-floating interrupt. Several may be waiting; the moving
     player's opponent fires them in whatever order they choose. */
  function overwatchCandidates(moverId) {
    const g = S();
    const mover = Store.unit(moverId);
    if (!g || !mover) return [];
    const out = [];
    g.units.filter(u => onTable(u) && u.owner !== mover.owner).forEach(function (u) {
      (u.tokens || []).forEach(function (t) {
        if (t.kind === 'overwatch' || t.attackOpts) {
          out.push({ unitId: u.id, tokenId: t.id, label: t.label,
                     unitName: u.name, owner: u.owner });
        }
      });
      /* An ability that waits for movement is offered here too — Snap Shot is
         an overwatch in everything but name. */
      (u.abilities || []).filter(a => a.trigger === 'overwatch').forEach(function (a) {
        if (a.usesPerGame && (a.used || 0) >= a.usesPerGame) return;
        out.push({ unitId: u.id, abilityId: a.id, label: a.name,
                   unitName: u.name, owner: u.owner, text: a.text });
      });
    });
    return out;
  }

  /* Something moved. Park what comes next and ask which triggers fire. */
  function openOverwatchCheck(moverId, after) {
    const g = S();
    if (!overwatchCandidates(moverId).length) return false;
    g.flow = { kind: 'owcheck', moverId: moverId, queue: [], after: after };
    chainEntry(uname(moverId) + ' moved — checking for waiting triggers.', 'note');
    return true;
  }

  /* Several units moved at once ("place up to two friendly units"): check them
     one after another, skipping any nobody is watching. */
  function openOverwatchFor(movers, after) {
    const rest = (movers || []).slice();
    while (rest.length) {
      const m = rest.shift();
      if (openOverwatchCheck(m, Object.assign({}, after, { more: rest.slice() }))) return true;
    }
    return false;
  }

  /* `key` is a token id or, for an ability that waits on movement, its id. */
  function flowToggleOverwatch(unitId, key, isAbility) {
    Store.commit('queue overwatch', function () {
      const f = S().flow;
      if (!f || f.kind !== 'owcheck') return;
      const same = q => (isAbility ? q.abilityId === key : q.tokenId === key);
      const i = f.queue.findIndex(same);
      if (i >= 0) f.queue.splice(i, 1);
      else if (isAbility) f.queue.push({ unitId: unitId, abilityId: key });
      else f.queue.push({ unitId: unitId, tokenId: key });
    });
  }

  /* Fire the next queued trigger, or carry on if the queue is empty. */
  function flowFireOverwatch() {
    Store.commit('overwatch', function () { runOverwatchQueue(); });
  }

  function runOverwatchQueue() {
    const g = S();
    const f = g.flow;
    if (!f || f.kind !== 'owcheck') return;

    const mover = Store.unit(f.moverId);
    if (!mover || !mover.alive) {
      /* You chose which triggers were firing and took the risk: the ones still
         queued are spent whether or not there was anything left to shoot at. */
      f.queue.forEach(function (q) {
        const owner = Store.unit(q.unitId);
        if (!owner) return;
        if (q.abilityId) {
          const ab = findAbility(q.unitId, q.abilityId);
          if (!ab) return;
          ab.used = (ab.used || 0) + 1;
          chainEntry(owner.name + '\u2019s ' + ab.name + ' is wasted — ' + uname(f.moverId) +
            ' was already down.', 'muted');
          return;
        }
        const tok = (owner.tokens || []).find(x => x.id === q.tokenId);
        if (!tok) return;
        owner.tokens = owner.tokens.filter(x => x.id !== q.tokenId);
        chainEntry(owner.name + '\u2019s [' + tok.label + '] is wasted — ' + uname(f.moverId) +
          ' was already down.', 'muted');
      });
      f.queue = [];
      chainEntry(uname(f.moverId) + ' was destroyed mid-move — nothing comes of the action ' +
        'that was interrupted.', 'note');
      finishOverwatchCheck(true);
      return;
    }
    if (!f.queue.length) { finishOverwatchCheck(false); return; }

    const next = f.queue.shift();
    const parked = JSON.parse(JSON.stringify(f));
    const u = Store.unit(next.unitId);

    /* An overwatch-triggered ability: resolve its free attack against whoever
       moved, and spend the use. */
    if (next.abilityId) {
      const ab = u && findAbility(next.unitId, next.abilityId);
      if (!ab) { runOverwatchQueue(); return; }
      ab.used = (ab.used || 0) + 1;
      chainEntry(u.name + ' interrupts with “' + ab.name + '” against ' + mover.name + '.', 'token');
      const ctx = { sourceUnitId: next.unitId, sourcePlayer: u.owner, targets: {}, label: ab.name };
      applyEffects(ab.effects, ctx);
      openFreeAttack(next.unitId, ctx.freeAttack ||
        { weapon: 'ranged', noRP: true, hitMod: 0, label: ab.name });
      if (S().flow) {
        S().flow.targetId = f.moverId;
        S().flow.step = S().flow.weaponId ? 'hit' : 'weapon';
        S().flow.resumeFlow = parked;
      } else {
        runOverwatchQueue();
      }
      return;
    }

    const t = u && (u.tokens || []).find(x => x.id === next.tokenId);
    if (!t) { runOverwatchQueue(); return; }

    chainEntry(u.name + ' fires [' + t.label + '] at ' + mover.name + '.', 'token');
    if (t.kind === 'overwatch') {
      const ranged = (u.weapons || []).filter(w => w.type === 'ranged');
      g.flow = {
        kind: 'attack', actionId: 'shoot', attackerId: next.unitId, targetId: f.moverId,
        weaponId: ranged.length === 1 ? ranged[0].id : null,
        source: 'overwatch', noReaction: true, free: true, paid: true,
        hitMod: 0, woundMod: 0, sourceHitMod: -1, elevation: false,
        notes: ['OVERWATCH interrupt: -1 to hit, and the shoot sequence skips steps 2 and 3, so ' +
                'the defender gains no RP.'],
        reaction: null, cancelled: false, apGrant: false, auras: {},
        freeChoice: false, chainLivesOnDeath: false, endsChainOverride: null,
        step: ranged.length === 1 ? 'hit' : 'weapon'
      };
    } else {
      openFreeAttack(next.unitId, Object.assign({ label: t.label }, t.attackOpts));
      if (S().flow) { S().flow.targetId = f.moverId; S().flow.step = S().flow.weaponId ? 'hit' : 'weapon'; }
    }
    if (S().flow) S().flow.resumeFlow = parked;
    u.tokens = (u.tokens || []).filter(x => x.id !== next.tokenId);
  }

  /* Every trigger has fired. Either the moving unit is down and the action it
     was part of produces nothing, or that action carries on. */
  function finishOverwatchCheck(moverDown) {
    const g = S();
    const f = g.flow;
    if (!f || f.kind !== 'owcheck') return;
    const after = f.after;
    g.flow = null;

    /* More units were placed by the same ability — each gets its own check, and
       one of them being shot down does not undo the others. */
    if ((after.more || []).length) {
      if (openOverwatchFor(after.more, Object.assign({}, after, { more: [] }))) return;
      moverDown = false;
    }

    if (moverDown && !after.ignoreDown) {
      if (after.type === 'none') { checkVictory(); return; }
      if (after.type === 'attack') {
        closeChain('a unit was destroyed mid-action');
        handOffToTurnPlayer();
      } else {
        afterAction({ actor: after.actor, endsChain: false, forcedUnitId: null });
      }
      checkVictory();
      return;
    }

    if (after.type === 'none') { checkVictory(); return; }
    if (after.type === 'attack') {
      g.flow = after.flow;
      checkVictory();
      return;
    }
    afterAction({ actor: after.actor, endsChain: after.endsChain,
                  forcedUnitId: null, reason: after.reason });
    checkVictory();
  }

  function triggerToken(unitId, tokenId) {
    const g = S();
    const u = Store.unit(unitId);
    const t = (u.tokens || []).find(x => x.id === tokenId);
    if (!t) return;

    if (t.kind === 'overwatch') {
      Store.commit('overwatch shot', function () {
        const g2 = S();
        const ranged = (u.weapons || []).filter(w => w.type === 'ranged');
        chainEntry(u.name + ' triggers OVERWATCH.', 'token');
        g2.flow = {
          kind: 'attack', actionId: 'shoot', attackerId: unitId, targetId: null,
          weaponId: ranged.length === 1 ? ranged[0].id : null,
          source: 'overwatch', noReaction: true, free: true, paid: true,
          hitMod: 0, woundMod: 0, sourceHitMod: -1, elevation: false,
          notes: ['OVERWATCH: -1 to hit. The defender gains no RP.'],
          reaction: null, cancelled: false, apGrant: false,
          freeChoice: false, chainLivesOnDeath: false, endsChainOverride: null,
          step: 'target'
        };
        // Overwatch fires, so the token comes off the table.
        u.tokens = (u.tokens || []).filter(x => x.id !== tokenId);
      });
      return;
    }

    // A button that fires a free attack (a reaction shot, a trap that shoots).
    if (t.attackOpts) {
      Store.commit('trigger ' + t.label, function () {
        const u2 = Store.unit(unitId);
        chainEntry(u2.name + ' triggers [' + t.label + '].', 'token');
        openFreeAttack(unitId, Object.assign({ label: t.label }, t.attackOpts));
        if (t.expiry === 'used') u2.tokens = (u2.tokens || []).filter(x => x.id !== tokenId);
      });
      return;
    }

    // Custom token: resolve its stored effects.
    Store.commit('trigger ' + t.label, function () {
      const g2 = S();
      chainEntry('[' + t.label + '] triggered by ' + u.name + '.', 'token');
      g2.flow = {
        kind: 'token', unitId: unitId, tokenId: tokenId,
        targets: {}, step: 'pick'
      };
      const fake = { effects: t.effects && t.effects.length ? t.effects : defaultTokenEffects(t) };
      const needs = effectsNeedingTarget(fake, { sourceUnitId: unitId });
      if (!needs.length) g2.flow.step = 'confirm';
    });
  }

  function defaultTokenEffects(t) {
    // A token created without explicit effects still needs something to do.
    return t.damage ? [{ id: 'tkdmg', kind: 'damage', value: t.damage, pick: 'prompt' }] : [];
  }

  function tokenEffects(unitId, tokenId) {
    const u = Store.unit(unitId);
    const t = u && (u.tokens || []).find(x => x.id === tokenId);
    if (!t) return [];
    return (t.effects && t.effects.length) ? t.effects : defaultTokenEffects(t);
  }

  function confirmToken() {
    Store.commit('resolve token', function () {
      const g = S();
      const f = g.flow;
      if (!f) return;
      const u = Store.unit(f.unitId);
      const t = u && (u.tokens || []).find(x => x.id === f.tokenId);
      if (!t) { g.flow = null; return; }
      applyEffects(tokenEffects(f.unitId, f.tokenId), {
        sourceUnitId: f.unitId, sourcePlayer: u.owner, targets: f.targets, label: t.label
      });
      if (t.text) chainEntry('[' + t.label + '] ' + t.text, 'note');
      if (t.expiry === 'used') {
        u.tokens = (u.tokens || []).filter(x => x.id !== f.tokenId);
        chainEntry('[' + t.label + '] removed after being triggered.', 'token');
      }
      g.flow = null;
      checkVictory();
    });
  }

  function tokenPickTarget(effectId, unitId) {
    Store.commit('token target', function () {
      const f = S().flow;
      const list = tokenEffects(f.unitId, f.tokenId);
      const needs = effectsNeedingTarget({ effects: list }, { sourceUnitId: f.unitId });
      const e = needs.find(x => x.id === effectId);
      if (e && e.pick === 'multi') { toggleMulti(f, effectId, unitId); return; }
      f.targets[effectId] = unitId;
      if (needs.every(x => filled(f.targets[x.id]))) f.step = 'confirm';
    });
  }

  /* ------------------------------------------- missions & special objectives */

  /* What this mission scores at the end of a turn. `mode: 'auto'` means the app
     worked it out from what it watched; `mode: 'ask'` means one tabletop fact
     stands in the way — and the VP that follows from the answer is still the
     card's number, never the player's choice. */
  function missionEndTurnItems() {
    const m = missionCard();
    if (!m) return [];
    return (m.endTurn || []).filter(function (o) {
      return o.onlyIfCarried ? !!relicCarrier() : true;
    }).map(function (o) {
      const item = Object.assign({}, o);
      if (o.mode === 'auto') item.award = autoAward(o);
      if (o.mode === 'ask') item.answer = missionAnswer(o.id);
      return item;
    });
  }

  /* VP each player has earned from an automatic objective, as things stand. */
  function autoAward(o) {
    const g = S();
    const vp = Number(o.vp) || 1;
    if (o.score === 'controlPoints') return g.players.map(p => controlledCount(p.id) * vp);
    if (o.score === 'unitFlag') {
      return g.players.map(p => Store.unitsOf(p.id, true)
        .some(u => u.flags && u.flags[o.flag]) ? vp : 0);
    }
    return g.players.map(() => 0);
  }

  const missionAnswer = id => {
    const g = S();
    const a = g.pending && g.pending.answers;
    return (a && a[id] !== undefined) ? a[id] : null;
  };

  /* The answer to the one fact the app cannot see. 'none' is a real answer:
     nobody scored it this turn. */
  function answerMissionAsk(objId, value) {
    Store.commit('objective', function () {
      const g = S();
      if (!g.pending) return;
      if (!g.pending.answers) g.pending.answers = {};
      g.pending.answers[objId] = value;
    });
  }

  /* Applied when the End Phase is confirmed, so END: abilities land first. */
  function scoreEndOfTurn() {
    const g = S();
    let ended = null;
    missionEndTurnItems().forEach(function (o) {
      if (o.mode === 'auto') {
        let any = false;
        (o.award || []).forEach(function (n, i) {
          if (n > 0) { scoreVP(i, n, o.name); any = true; }
        });
        if (!any) log('No VP from ' + o.name + ' this turn.', 'muted');
        return;
      }
      const a = missionAnswer(o.id);
      if (a === null || a === 'none' || a === false) {
        log('No VP from ' + o.name + ' this turn.', 'muted');
        return;
      }
      const who = o.scorer === 'relicCarrier' ? Store.owner(relicCarrier()) : Number(a);
      if (who === null || who === undefined || isNaN(who)) return;
      scoreVP(who, Number(o.vp) || 1, o.name);
      if (o.endsGame) ended = o.name;
    });
    if (ended) {
      log('\u2605 The mission ends: ' + ended + '.', 'win');
      declareWinnerOnVP(ended);
    }
  }

  /* -------------------------------------------------- manual adjustments */

  function adjustAP(playerId, delta) {
    Store.commit('adjust AP', function () {
      const g = S();
      g.players[playerId].ap = Math.max(0, g.players[playerId].ap + delta);
      log('Manual: ' + pname(playerId) + ' AP → ' + g.players[playerId].ap + '.', 'manual');
    });
  }

  function adjustVP(playerId, delta, why) {
    Store.commit('adjust VP', function () {
      const g = S();
      g.players[playerId].vp = Math.max(0, g.players[playerId].vp + delta);
      log('Manual: ' + pname(playerId) + ' VP → ' + g.players[playerId].vp +
        (why ? ' (' + why + ')' : '') + '.', 'vp');
      checkVictory();
    });
  }

  function adjustWounds(unitId, delta) {
    Store.commit('adjust wounds', function () {
      const u = Store.unit(unitId);
      if (!u) return;
      u.wounds = Math.max(0, Math.min(u.maxWounds, u.wounds + delta));
      if (u.wounds === 0 && u.alive) {
        u.alive = false; u.tokens = []; u.effects = [];
        log('Manual: ' + u.name + ' reduced to 0 W and removed (no VP awarded).', 'kill');
      } else if (u.wounds > 0 && !u.alive) {
        u.alive = true;
        log('Manual: ' + u.name + ' returned to the battlefield.', 'manual');
      } else {
        log('Manual: ' + u.name + ' → ' + u.wounds + '/' + u.maxWounds + ' W.', 'manual');
      }
    });
  }

  function removeUnit(unitId, awardVP) {
    Store.commit('remove unit', function () {
      const u = Store.unit(unitId);
      if (!u) return;
      u.wounds = 0; u.alive = false; u.tokens = []; u.effects = [];
      log('Manual: ' + u.name + ' removed from the battlefield.', 'kill');
      if (awardVP) scoreVP(Store.opponentOf(u.owner), killValue(u), 'destroyed ' + u.name);
    });
  }

  function removeEffect(unitId, effectId) {
    Store.commit('remove effect', function () {
      const u = Store.unit(unitId);
      if (!u) return;
      const e = (u.effects || []).find(x => x.id === effectId);
      u.effects = (u.effects || []).filter(x => x.id !== effectId);
      if (e) log('Effect removed by hand: ' + e.label + ' (' + u.name + ').', 'manual');
    });
  }

  function addManualEffect(unitId, label, hitMod, woundMod, duration) {
    Store.commit('add effect', function () {
      addEffect(unitId, {
        label: label || 'Custom effect', detail: 'Added by hand.',
        hitMod: Number(hitMod) || 0, woundMod: Number(woundMod) || 0,
        duration: duration || 'manual'
      });
      log('Effect added by hand to ' + uname(unitId) + ': ' + label + '.', 'manual');
    });
  }

  function addManualToken(unitId, label, expiry, text) {
    Store.commit('add token', function () {
      const u = Store.unit(unitId);
      if (!u) return;
      u.tokens.push({
        id: Store.nextId('tk'), label: (label || 'TOKEN').toUpperCase(), kind: 'custom',
        expiry: expiry || 'manual', text: text || '', effects: []
      });
      log('Token added by hand: [' + label + '] (' + u.name + ').', 'manual');
    });
  }

  function forceControl(playerId, unitId) {
    Store.commit('override control', function () {
      const g = S();
      g.control = { player: playerId, forcedUnitId: unitId || null, reason: 'set by hand' };
      log('Manual: control given to ' + pname(playerId) +
        (unitId ? ' (' + uname(unitId) + ' must act)' : '') + '.', 'manual');
    });
  }

  function forceEndChain() {
    Store.commit('end chain', function () {
      closeChain('ended by hand');
      handOffToTurnPlayer();
    });
  }

  function forceEndTurn() {
    Store.commit('end turn', function () {
      beginEndPhase('ended by hand');
    });
  }

  return {
    startGame, beginTurn, confirmStartPhase, confirmEndPhase, beginEndPhase,
    actionDef, actionList, setActionOverride, apConsequence, controlMode, mustPass,
    actionAvailability, eligibleUnits, usableAPAbilities, usableFreeAbilities,
    weaponsFor, findAbility,
    beginAction, beginAbility, unitActions, abilityActions, cancelFlow, flowBack, flowPickUnit,
    flowPickControlPoint, confirmSecure, confirmRelic,
    missionCard, missionEndTurnItems, toggleUnitFlag, controlledCount,
    relicCarrier, setRelicCarrier, killValue, endGameNow, victoryReport,
    confirmSimple, confirmPass, confirmPassDirect, passOptions, confirmOverwatch,
    abilityLetsThemReact,
    flowPickAbility, flowPickTarget, flowDoneTargets, confirmAbility,
    useFreeAbility, usePhaseAbility,
    flowPickAttackTarget, flowPickWeapon, flowPickReaction, flowRoll, flowChargeFailed,
    flowHit, flowWound, flowDamage, attackNumbers, setElevation,
    flowHits, flowWounds, diceOptions, toggleDice, unitMoveMod,
    cardAbilities, cardAbility, useCardAbility, confirmCard, adjustCardResource,
    applicableAuras, toggleAura, blockedReactions, flowRedirect, openFreeAttack,
    effectsNeedingTarget,
    triggerToken, confirmToken, tokenPickTarget, tokenEffects, removeToken,
    overwatchCandidates, flowToggleOverwatch, flowFireOverwatch,
    adjustAP, adjustVP, adjustWounds, removeUnit, removeEffect,
    addManualEffect, addManualToken, forceControl, forceEndChain, forceEndTurn,
    scoreVP, log, onFx, ask, answerAsk, answerMissionAsk, scoreEndOfTurn
  };
})();

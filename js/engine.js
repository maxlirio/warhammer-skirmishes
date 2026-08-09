/* =========================================================================
   ENGINE — turn structure, action chains, attacks, effects, tokens.

   The engine never asks about the tabletop. It takes the player's word for
   what happened (hit / miss / damage / trigger) and keeps the consequences
   straight: AP, RP, VP, wounds, whose unit must act next, what is still on
   the board.
   ========================================================================= */

const Engine = (function () {

  const S = () => Store.get();

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
    Store.setState(g);
    Store.commit('start game', function () {
      log('— GAME START —', 'big');
      applyMission();
      beginTurn(g.turn.player, true);
    });
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
    g.chain = { active: false, id: g.chain.id, initiator: null, entries: [], weaponsUsed: [] };
    expireEffects('round', playerId);
    expireTokens('round', playerId);
    log('— TURN ' + g.turn.number + ': ' + pname(playerId) + ' —', 'big');
    g.pending = {
      type: 'start',
      player: playerId,
      manualVP: 0,
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
      g.control = { player: p, forcedUnitId: null, reason: 'your turn — spend AP or PASS' };
      checkStall();
    });
  }

  function beginEndPhase(note) {
    const g = S();
    g.turn.phase = 'end';
    closeChain(note || 'both AP pools empty');
    g.pending = { type: 'end', player: g.turn.player, manualVP: 0 };
    log('End Phase — ' + pname(g.turn.player) + '.', 'phase');
  }

  function confirmEndPhase() {
    Store.commit('end phase', function () {
      const g = S();
      const p = g.pending ? g.pending.player : g.turn.player;
      expireEffects('turn', null);
      expireTokens('turn', null);
      g.pending = null;
      beginTurn(Store.nextPlayer(p));   // play passes around the table
    });
  }

  /* If nobody can do anything, roll straight into the End Phase. */
  function checkStall() {
    const g = S();
    if (g.pending || g.flow) return;
    const cp = g.control.player;
    if (g.players[cp].ap <= 0 && !g.chain.active) {
      // HOLD is 0 AP but chain-only; with no chain and no AP, only PASS remains.
      if (cp === g.turn.player) {
        log(pname(cp) + ' has no AP left.', 'muted');
        beginEndPhase('no AP remaining');
      }
    }
  }

  /* --------------------------------------------------------- action chain */

  function openChain(initiator) {
    const g = S();
    if (g.chain.active) return;
    g.chain = { active: true, id: g.chain.id + 1, initiator: initiator, entries: [], weaponsUsed: [] };
    log('Action chain #' + g.chain.id + ' begins (' + pname(initiator) + ').', 'chain');
  }

  function closeChain(reason) {
    const g = S();
    if (!g.chain.active) return;
    g.chain.active = false;
    g.chain.weaponsUsed = [];
    expireEffects('chain', null);
    expireTokens('chain', null);
    chainEntry('Action chain ends' + (reason ? ' — ' + reason : '') + '.', 'chain-end');
  }

  /* The heart of the turn machine: who gets to act after an action resolves.

     A chain ends when the action says so, or when the player who is now owed a
     response has an empty AP pool — either player running dry closes it. The
     TURN is a separate question: it keeps going as long as the current player
     still has AP to open a new chain with, and only passes when they hit 0. */
  function afterAction(opts) {
    const g = S();
    const actor = opts.actor;
    expireEffects('nextAP', actor);

    if (opts.endsChain) {
      closeChain(opts.reason || null);
      handOffToTurnPlayer();
      checkVictory();
      return;
    }

    /* Who is owed the response? For an Aggressive Action it is the owner of the
       target — never ambiguous. For anything else the caller says, because with
       three or four players the app asks rather than picking for you. */
    const opp = (opts.responder === null || opts.responder === undefined)
      ? Store.opponentOf(actor) : opts.responder;
    if (opp === null || opp === undefined || opp === actor) {
      closeChain('no one is owed a response');
      handOffToTurnPlayer();
      checkVictory();
      return;
    }
    if (g.players[opp].ap > 0) {
      g.chain.active = true;
      const forced = opts.forcedUnitId || null;
      g.control = {
        player: opp,
        forcedUnitId: forced,
        reason: forced
          ? uname(forced) + ' must act (Aggressive Action)'
          : 'may respond with any unit'
      };
      chainEntry('→ ' + pname(opp) + ' responds' +
        (forced ? ' with ' + uname(forced) : ' (any unit)') +
        ' — ' + g.players[opp].ap + ' AP available.', 'control');
    } else {
      closeChain(pname(opp) + ' has no AP to respond');
      handOffToTurnPlayer();
    }
    checkVictory();
  }

  /* The chain is over — the turn only passes if the current player is dry. */
  function handOffToTurnPlayer() {
    const g = S();
    const tp = g.turn.player;
    if (g.players[tp].ap > 0) {
      g.control = { player: tp, forcedUnitId: null, reason: 'may start a new action chain' };
      chainEntry(pname(tp) + ' still has ' + g.players[tp].ap +
        ' AP — the turn continues with a new chain.', 'control');
    } else {
      Store.opponentsOf(tp).forEach(function (o) {
        if (g.players[o].ap > 0) {
          log(pname(o) + ' keeps ' + g.players[o].ap + ' AP — it carries into their turn.', 'muted');
        }
      });
      beginEndPhase('the current player has no AP left');
    }
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
    const owEndsWithChain = g.settings.overwatchEndsWithChain;
    g.units.forEach(function (u) {
      const keep = [];
      (u.tokens || []).forEach(function (t) {
        let match = t.expiry === expiry &&
          (playerFilter === null || playerFilter === undefined || u.owner === playerFilter);
        if (t.kind === 'overwatch' && expiry === 'chain' && !owEndsWithChain) match = false;
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
    const mode = e.mode === 'beyond' ? 'further than' : 'within';
    const scope = e.weapon === 'ranged' ? ' (ranged only)'
                : e.weapon === 'melee' ? ' (melee only)' : '';
    return (e.value > 0 ? '+' : '') + (Number(e.value) || 0) + ' to ' +
      (e.stat === 'wound' ? 'Wound' : 'Hit') + ' · ' + mode + ' ' + (e.range || 6) + '"' + scope;
  }

  /* Auras that could bear on the attack currently in the flow. */
  function applicableAuras(f) {
    const g = S();
    if (!f || f.kind !== 'attack' || !f.attackerId || !f.targetId) return [];
    const action = RULES.actionById(f.actionId);
    const weaponType = action ? action.attackRange : 'ranged';
    const attacker = Store.unit(f.attackerId);
    if (!attacker) return [];
    const out = [];
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
          stat: e.stat === 'wound' ? 'wound' : 'hit',
          value: Number(e.value) || 0,
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
    let hit = 0, wound = 0;
    if (!f || !f.auras) return { hit: hit, wound: wound };
    applicableAuras(f).forEach(function (a) {
      if (!f.auras[a.key]) return;
      if (a.stat === 'wound') wound += a.value; else hit += a.value;
    });
    return { hit: hit, wound: wound };
  }

  /* Reactions a friendly aura forbids — shown struck through, with the source. */
  function blockedReactions(defenderId) {
    const g = S();
    const def = Store.unit(defenderId);
    if (!def) return {};
    const out = {};
    g.units.filter(u => u.alive && u.owner === def.owner).forEach(function (u) {
      (u.abilities || []).filter(a => a.trigger === 'passive').forEach(function (a) {
        (a.effects || []).forEach(function (e) {
          if (e.kind === 'blockreact' && e.reaction) {
            out[e.reaction] = u.name + ': ' + a.name;
          }
        });
      });
    });
    return out;
  }

  function unitHitMod(unitId) {
    const u = Store.unit(unitId);
    if (!u) return 0;
    return (u.effects || []).reduce((n, e) => n + (Number(e.hitMod) || 0), 0);
  }

  function unitWoundMod(unitId) {
    const u = Store.unit(unitId);
    if (!u) return 0;
    return (u.effects || []).reduce((n, e) => n + (Number(e.woundMod) || 0), 0);
  }

  /* ------------------------------------------------------------- wounds */

  /* Returns true if the unit was destroyed. */
  function dealDamage(unitId, amount, sourcePlayer, describe) {
    const g = S();
    const u = Store.unit(unitId);
    if (!u || !u.alive) return false;
    const dmg = Math.max(0, Number(amount) || 0);
    u.wounds = Math.max(0, u.wounds - dmg);
    chainEntry((describe || '') + u.name + ' takes ' + dmg + ' damage — ' +
      u.wounds + '/' + u.maxWounds + ' W remaining.', 'damage');
    if (u.wounds <= 0) {
      u.alive = false;
      u.tokens = [];
      u.effects = [];
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
        askVP(scorer, 'destroyed ' + u.name, killValue(u));
        if (m && m.killNote) chainEntry(m.killNote, 'note');
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
  function askVP(playerId, reason, suggested) {
    const g = S();
    if (!g.vpPrompts) g.vpPrompts = [];
    g.vpPrompts.push({
      id: Store.nextId('vp'),
      player: playerId,
      reason: reason,
      suggested: suggested === undefined ? 1 : suggested
    });
  }

  function promptVP(playerId, reason, suggested) {
    Store.commit('score VP', function () { askVP(playerId, reason, suggested); });
  }

  function resolveVP(promptId, amount) {
    Store.commit('enter VP', function () {
      const g = S();
      const p = (g.vpPrompts || []).find(x => x.id === promptId);
      g.vpPrompts = (g.vpPrompts || []).filter(x => x.id !== promptId);
      if (!p) return;
      const n = Math.max(0, Number(amount) || 0);
      if (n > 0) scoreVP(p.player, n, p.reason);
      else log(pname(p.player) + ' scores no VP for ' + p.reason + '.', 'muted');
    });
  }

  /* The prompt guessed the wrong player (three- and four-player games). */
  function reassignVP(promptId, playerId) {
    Store.quiet(function () {
      const p = (S().vpPrompts || []).find(x => x.id === promptId);
      if (p) p.player = Number(playerId);
    });
  }

  function heal(unitId, amount) {
    const u = Store.unit(unitId);
    if (!u || !u.alive) return;
    const before = u.wounds;
    u.wounds = Math.min(u.maxWounds, u.wounds + (Number(amount) || 0));
    chainEntry(u.name + ' restores ' + (u.wounds - before) + ' W — now ' +
      u.wounds + '/' + u.maxWounds + '.', 'heal');
  }

  function scoreVP(playerId, amount, why) {
    const g = S();
    g.players[playerId].vp += Number(amount) || 0;
    chainEntry(pname(playerId) + ' scores ' + amount + ' VP' + (why ? ' (' + why + ')' : '') +
      ' — now ' + g.players[playerId].vp + ' VP.', 'vp');
    checkVictory();
  }

  function checkVictory() {
    const g = S();
    if (g.winner !== null && g.winner !== undefined) return;
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
      if (e.kind !== 'damage' && e.kind !== 'heal' && e.kind !== 'mod_hit' && e.kind !== 'mod_wound') return false;
      const pick = e.pick || 'prompt';
      if (pick === 'self') return false;
      if ((pick === 'attacker' || pick === 'defender') && ctx && ctx.attack) return false;
      return true;
    });
  }

  function resolveEffectTarget(e, ctx) {
    const pick = e.pick || 'prompt';
    if (pick === 'self') return ctx.sourceUnitId;
    if (pick === 'attacker' && ctx.attack) return ctx.attack.attackerId;
    if (pick === 'defender' && ctx.attack) return ctx.attack.targetId;
    return (ctx.targets && ctx.targets[e.id]) || null;
  }

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
        case 'ap_opponent': grantAP(opp, v, ctx.label); break;
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
          const tid = resolveEffectTarget(e, ctx);
          if (tid) dealDamage(tid, v, me, ctx.label + ': ');
          break;
        }
        case 'heal': {
          const tid = resolveEffectTarget(e, ctx);
          if (tid) heal(tid, v);
          break;
        }
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

  function usableAPAbilities(u) {
    const g = S();
    return (u.abilities || []).filter(a =>
      a.trigger === 'ap' &&
      (Number(a.cost) || 0) <= g.players[u.owner].ap &&
      (!a.usesPerGame || (a.used || 0) < a.usesPerGame));
  }

  function weaponsFor(unitId, range) {
    const g = S();
    const u = Store.unit(unitId);
    if (!u) return [];
    return (u.weapons || [])
      .filter(w => (range === 'melee' ? w.type === 'melee' : w.type === 'ranged'))
      .map(function (w, i) {
        const key = unitId + '|' + w.id;
        return Object.assign({}, w, {
          used: !w.unlimited && g.chain.weaponsUsed.indexOf(key) >= 0,
          primary: i === 0
        });
      });
  }

  /* ------------------------------------------------------- start an action */

  function beginAction(actionId) {
    const action = RULES.actionById(actionId);
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
      const base = {
        actionId: action.id,
        unitId: pool.length === 1 ? pool[0].id : null,
        step: pool.length === 1 ? nextStepAfterUnit(action) : 'unit'
      };
      const askOpp = needsResponderChoice(action.id);
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
                   targets: {}, pickIndex: 0, askOpponent: askOpp, responder: null,
                   step: base.unitId ? 'ability' : 'unit' };
      } else if (action.flow === 'secure') {
        g.flow = { kind: 'secure', actionId: 'secure', unitId: base.unitId, cpId: null,
                   askOpponent: askOpp, responder: null,
                   step: base.unitId ? 'point' : 'unit' };
      } else if (action.flow === 'relic') {
        g.flow = { kind: 'relic', actionId: 'relic', unitId: base.unitId,
                   askOpponent: askOpp, responder: null,
                   step: base.unitId ? (askOpp ? 'opponent' : 'confirm') : 'unit' };
      } else if (action.flow === 'overwatch') {
        g.flow = { kind: 'overwatch', actionId: 'overwatch', unitId: base.unitId,
                   askOpponent: askOpp, responder: null,
                   step: base.unitId ? (askOpp ? 'opponent' : 'confirm') : 'unit' };
      } else {
        g.flow = { kind: 'simple', actionId: action.id, unitId: base.unitId,
                   askOpponent: askOpp, responder: null,
                   step: base.unitId ? (askOpp ? 'opponent' : 'confirm') : 'unit' };
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
      else { f.unitId = unitId; f.step = f.askOpponent ? 'opponent' : 'confirm'; }
    });
  }

  /* Three- and four-player games: the acting player names which opponent the
     rules' "your opponent" means this time. */
  function flowPickResponder(playerId) {
    Store.commit('select opponent', function () {
      const f = S().flow;
      if (!f) return;
      f.responder = (playerId === null || playerId === 'none') ? null : Number(playerId);
      f.step = 'confirm';
    });
  }

  function flowBack() {
    Store.commit('back', function () {
      const f = S().flow;
      if (!f) return;
      const order = {
        attack: ['attacker', 'target', 'weapon', 'reaction', 'redirect', 'eligible', 'hit', 'wound', 'damage'],
        ability: ['unit', 'ability', 'pick', 'opponent', 'confirm'],
        overwatch: ['unit', 'opponent', 'confirm'],
        secure: ['unit', 'point', 'opponent', 'confirm'],
        relic: ['unit', 'opponent', 'confirm'],
        simple: ['unit', 'opponent', 'confirm']
      }[f.kind] || [];
      const i = order.indexOf(f.step);
      if (i > 0) f.step = order[i - 1];
      else S().flow = null;
    });
  }

  /* ------------------------------------------------------ simple actions */

  function confirmSimple() {
    Store.commit('resolve action', function () {
      const g = S();
      const f = g.flow;
      const action = RULES.actionById(f.actionId);
      if (!f || !action) return;
      const actor = g.control.player;
      const responder = pickResponder(f, actor);
      openChain(actor);
      spendAP(actor, action.cost || 0);
      if (action.expiresOverwatch) expireOnOwnerAction(f.unitId);
      chainEntry(pname(actor) + ': ' + uname(f.unitId) + ' → ' + action.name + '.', 'action');
      if (action.opponentGainsAP && responder !== null) {
        grantAP(responder, action.opponentGainsAP, action.name);
      }
      g.flow = null;
      afterAction({ actor: actor, endsChain: action.endsChain, forcedUnitId: null,
                    responder: responder, reason: action.name });
    });
  }

  /* With two players "your opponent" is obvious. With three or four the flow
     has already asked, and the answer is on the flow object. */
  function pickResponder(f, actor) {
    if (f && f.responder !== null && f.responder !== undefined) return f.responder;
    return Store.playerCount() === 2 ? Store.opponentOf(actor) : null;
  }

  /* Does this flow need to ask who the opponent is before it can resolve? */
  function needsResponderChoice(actionId) {
    if (Store.playerCount() === 2) return false;
    const a = RULES.actionById(actionId);
    if (!a) return false;
    if (a.kind === 'aggressive') return false;      // the target's owner answers it
    if (a.endsChain && !a.opponentGainsAP) return false;
    return a.opponentGainsAP > 0 || !a.endsChain;
  }

  function flowPickControlPoint(cpId) {
    Store.commit('choose objective', function () {
      const f = S().flow;
      if (!f) return;
      f.cpId = cpId;
      f.step = f.askOpponent ? 'opponent' : 'confirm';
    });
  }

  function confirmSecure() {
    Store.commit('secure', function () {
      const g = S();
      const f = g.flow;
      const actor = g.control.player;
      const responder = pickResponder(f, actor);
      const action = RULES.actionById('secure');
      openChain(actor);
      spendAP(actor, action.cost);
      chainEntry(pname(actor) + ': ' + uname(f.unitId) + ' → SECURE.', 'action');
      secureControlPoint(f.cpId, actor, f.unitId);
      g.flow = null;
      afterAction({ actor: actor, endsChain: false, forcedUnitId: null, responder: responder });
    });
  }

  function confirmRelic() {
    Store.commit('pick up relic', function () {
      const g = S();
      const f = g.flow;
      const actor = g.control.player;
      const responder = pickResponder(f, actor);
      const action = RULES.actionById('relic');
      openChain(actor);
      spendAP(actor, action.cost);
      chainEntry(pname(actor) + ': ' + uname(f.unitId) + ' → PICK UP THE RELIC.', 'action');
      setRelicCarrier(f.unitId);
      // Carrying it puts out any overwatch this unit had set.
      expireOnOwnerAction(f.unitId);
      g.flow = null;
      afterAction({ actor: actor, endsChain: false, forcedUnitId: null, responder: responder });
    });
  }

  function confirmPass() {
    Store.commit('pass', function () {
      const g = S();
      g.flow = null;
      chainEntry(pname(g.control.player) + ' PASSES — turn ends.', 'action');
      beginEndPhase('passed');
    });
  }

  function confirmOverwatch() {
    Store.commit('overwatch', function () {
      const g = S();
      const f = g.flow;
      const actor = g.control.player;
      const responder = pickResponder(f, actor);
      const action = RULES.actionById('overwatch');
      openChain(actor);
      spendAP(actor, action.cost);
      const u = Store.unit(f.unitId);
      u.tokens = (u.tokens || []).filter(t => t.kind !== 'overwatch');
      u.tokens.push({
        id: Store.nextId('tk'), label: 'OVERWATCH', kind: 'overwatch',
        expiry: 'chain', isAttack: true,
        text: 'Attack an enemy that moves within 3" of the token, at -1 to hit. No RP for the defender.'
      });
      chainEntry(pname(actor) + ': ' + u.name + ' → OVERWATCH. Token placed.', 'action');
      g.flow = null;
      afterAction({ actor: actor, endsChain: false, forcedUnitId: null, responder: responder });
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
      f.step = needs.length ? 'pick' : (f.askOpponent ? 'opponent' : 'confirm');
    });
  }

  function flowPickTarget(effectId, unitId) {
    Store.commit('select target', function () {
      const g = S();
      const f = g.flow;
      f.targets[effectId] = unitId;
      const ab = findAbility(f.unitId, f.abilityId);
      const needs = effectsNeedingTarget(ab, { sourceUnitId: f.unitId });
      const done = needs.every(e => f.targets[e.id]);
      if (done) f.step = f.askOpponent ? 'opponent' : 'confirm';
      else f.pickIndex = needs.findIndex(e => !f.targets[e.id]);
    });
  }

  function findAbility(unitId, abilityId) {
    const u = Store.unit(unitId);
    if (!u) return null;
    return (u.abilities || []).find(a => a.id === abilityId) || null;
  }

  function confirmAbility() {
    Store.commit('use ability', function () {
      const g = S();
      const f = g.flow;
      const actor = g.control.player;
      const ab = findAbility(f.unitId, f.abilityId);
      if (!ab) { g.flow = null; return; }
      const action = RULES.actionById('ability');
      const responder = pickResponder(f, actor);
      openChain(actor);
      spendAP(actor, Number(ab.cost) || 0);
      ab.used = (ab.used || 0) + 1;
      chainEntry(pname(actor) + ': ' + uname(f.unitId) + ' → SPECIAL ABILITY “' + ab.name + '”.', 'action');
      const ctx = {
        sourceUnitId: f.unitId, sourcePlayer: actor, targets: f.targets,
        label: ab.name, opponent: responder
      };
      applyEffects(ab.effects, ctx);
      const oppAP = ab.opponentGainsAP === 'default' ? action.opponentGainsAP : Number(ab.opponentGainsAP) || 0;
      if (oppAP && responder !== null) grantAP(responder, oppAP, 'SPECIAL ABILITY');
      const ends = ab.endsChain === 'default' ? action.endsChain : ab.endsChain === 'yes';
      const unitId = f.unitId;
      g.flow = null;

      /* The ability says "make an attack" — hand straight over to the attack
         flow and settle the chain once it resolves. */
      if (ctx.freeAttack) {
        openFreeAttack(unitId, ctx.freeAttack);
        if (S().flow) {
          S().flow.pendingAfter = {
            actor: actor, endsChain: ends || ctx.freeAttack.endsChain,
            responder: responder, reason: ab.name
          };
        }
        return;
      }
      afterAction({ actor: actor, endsChain: ends, forcedUnitId: null,
                    responder: responder, reason: ab.name });
    });
  }

  /* Free/manual ability button on a unit card — no action, no AP economy. */
  function useFreeAbility(unitId, abilityId) {
    Store.commit('free ability', function () {
      const g = S();
      const u = Store.unit(unitId);
      const ab = findAbility(unitId, abilityId);
      if (!ab) return;
      ab.used = (ab.used || 0) + 1;
      chainEntry(u.name + ' uses “' + ab.name + '”.', 'action');
      applyEffects(ab.effects, {
        sourceUnitId: unitId, sourcePlayer: u.owner, targets: {}, label: ab.name
      });
      checkVictory();
    });
  }

  /* START:/END: abilities fired from the phase modal. */
  function usePhaseAbility(unitId, abilityId) {
    Store.commit('phase ability', function () {
      const u = Store.unit(unitId);
      const ab = findAbility(unitId, abilityId);
      if (!ab) return;
      ab.used = (ab.used || 0) + 1;
      log(u.name + ' — ' + ab.trigger.toUpperCase() + ': “' + ab.name + '”.', 'action');
      applyEffects(ab.effects, {
        sourceUnitId: unitId, sourcePlayer: u.owner, targets: {}, label: ab.name
      });
      const g = S();
      if (!g.pending.fired) g.pending.fired = [];
      g.pending.fired.push(abilityId);
    });
  }

  /* ================================================================ ATTACK */

  function flowPickAttackTarget(unitId) {
    Store.commit('select target', function () {
      const f = S().flow;
      f.targetId = unitId;
      const action = RULES.actionById(f.actionId);
      const list = weaponsFor(f.attackerId, action ? action.attackRange : 'ranged');
      const free = list.filter(w => !w.used);
      if (free.length === 1) { f.weaponId = free[0].id; declareAttack(); }
      else f.step = 'weapon';
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
      const action = RULES.actionById(f.actionId);
      const actor = g.control.player;
      openChain(actor);
      spendAP(actor, action.cost || 0);
      if (action.expiresOverwatch) expireOnOwnerAction(f.attackerId);
      chainEntry(pname(actor) + ': ' + uname(f.attackerId) + ' → ' + action.name +
        ' → ' + uname(f.targetId) + '.', 'action');
      if (action.isCharge) {
        chainEntry('Tabletop: roll 1D6 and move that far — you must end in melee range or not move at all.', 'note');
      }
      f.paid = true;
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
      const action = RULES.actionById(f.actionId);
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
        applyEffects(ab.effects, {
          sourceUnitId: f.targetId, sourcePlayer: defPlayer, targets: {},
          label: ab.name, attack: f
        });
        primeAttackMods();
        f.step = f.redirect ? 'redirect' : 'hit';
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
          woundMod: 0,
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
      f.step = r.askEligible ? 'eligible' : 'hit';
    });
  }

  /* "It's Your Job": the defender points the attack at one of their other units. */
  function flowRedirect(newTargetId) {
    Store.commit('redirect', function () {
      const f = S().flow;
      if (!f) return;
      const from = uname(f.targetId);
      f.targetId = newTargetId;
      f.redirect = false;
      chainEntry('The attack is redirected from ' + from + ' to ' + uname(newTargetId) + '.', 'reaction');
      f.step = 'hit';
    });
  }

  function flowEligibility(stillEligible) {
    Store.commit('eligibility', function () {
      const g = S();
      const f = g.flow;
      if (stillEligible) { f.step = 'hit'; return; }
      f.cancelled = true;
      chainEntry(uname(f.targetId) + ' is no longer an eligible target — the attack does not happen.', 'reaction');
      finishAttack({ hit: false, cancelled: true });
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
    const elevKind = RULES.actionById(f.actionId).elevation;
    const high = !!f.elevation;
    const elevHit    = (high && elevKind === 'shoot') ? 1 : 0;
    const elevWound  = (high && elevKind === 'charge') ? 1 : 0;
    const elevDamage = (high && elevKind === 'charge') ? 1 : 0;

    const au = auraMods(f);
    const hitMod = f.hitMod + elevHit + (f.sourceHitMod || 0) + au.hit;
    const woundMod = f.woundMod + elevWound + au.wound;
    const baseHit = Number(weapon.hit) || Number(attacker.hit) || 4;
    const hit = RULES.applyMod(baseHit, hitMod);
    const baseWound = RULES.woundTarget(weapon.strength, target.toughness);
    const wound = RULES.applyMod(baseWound, woundMod);
    return {
      weapon: weapon, attacker: attacker, target: target,
      baseHit: baseHit, hitMod: hitMod, hitTarget: hit.target, hitCapped: hit.capped,
      baseWound: baseWound, woundMod: woundMod, woundTarget: wound.target, woundCapped: wound.capped,
      woundReason: RULES.woundLabel(weapon.strength, target.toughness),
      elevKind: elevKind, elevHit: elevHit, elevWound: elevWound, elevDamage: elevDamage,
      baseDamage: Number(weapon.damage) || 0,
      damage: (Number(weapon.damage) || 0) + elevDamage
    };
  }

  function flowHit(didHit) {
    Store.commit(didHit ? 'hit' : 'miss', function () {
      const f = S().flow;
      markWeaponUsed(f);
      if (!didHit) {
        chainEntry(uname(f.attackerId) + ' MISSES ' + uname(f.targetId) + '.', 'miss');
        finishAttack({ hit: false });
      } else if (f.skipWound) {
        // e.g. Choke Hold: a hit resolves without a Wound roll.
        chainEntry(uname(f.attackerId) + ' HITS ' + uname(f.targetId) +
          ' — no Wound roll for this attack.', 'hitline');
        finishAttack({ hit: true, wound: false });
      } else {
        chainEntry(uname(f.attackerId) + ' HITS ' + uname(f.targetId) + '.', 'hitline');
        f.step = 'wound';
      }
    });
  }

  function flowWound(didWound) {
    Store.commit(didWound ? 'wound' : 'no wound', function () {
      const f = S().flow;
      if (!didWound) {
        chainEntry('The attack fails to wound ' + uname(f.targetId) + '.', 'miss');
        finishAttack({ hit: true, wound: false });
      } else {
        const n = attackNumbers();
        f.damage = n ? n.damage : 1;
        chainEntry('The attack WOUNDS ' + uname(f.targetId) + '.', 'hitline');
        if (n && n.elevWound) {
          chainEntry('High ground: +1 to Wound and +1 Damage from the charge.', 'note');
        }
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

  function markWeaponUsed(f) {
    const g = S();
    const key = f.attackerId + '|' + f.weaponId;
    if (g.chain.weaponsUsed.indexOf(key) < 0) g.chain.weaponsUsed.push(key);
  }

  function finishAttack(result) {
    const g = S();
    const f = g.flow;
    const attackerPlayer = Store.owner(f.attackerId);
    const defenderPlayer = Store.owner(f.targetId);
    let killed = false;

    if (result.damage) {
      killed = dealDamage(f.targetId, result.damage, attackerPlayer);
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

    /* An ability that spawned this attack told us what to do afterwards. */
    if (f.pendingAfter) {
      const after = f.pendingAfter;
      afterAction({
        actor: after.actor,
        endsChain: after.endsChain || !!f.endsChainOverride || killed,
        forcedUnitId: killed ? null : forcedUnitId,
        responder: killed ? after.responder : Store.owner(f.targetId),
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
      responder: defenderPlayer,     // an Aggressive Action always names its opponent
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
      const u = Store.unit(f.unitId);
      const t = (u.tokens || []).find(x => x.id === f.tokenId);
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
      f.targets[effectId] = unitId;
      const list = tokenEffects(f.unitId, f.tokenId);
      const needs = effectsNeedingTarget({ effects: list }, { sourceUnitId: f.unitId });
      if (needs.every(e => f.targets[e.id])) f.step = 'confirm';
    });
  }

  /* ------------------------------------------- missions & special objectives */

  function objectiveScoredBy(objId, playerId) {
    const g = S();
    const rec = g.objectiveScores[objId];
    return rec ? (rec[playerId] || 0) : 0;
  }

  /* The app never works out whether an objective was met — it reads the card's
     text back at the end of the turn and takes your number. The one exception
     is SECURE THE AREA, where it has watched every SECURE action and can count
     the markers for you. */
  function missionEndTurnItems() {
    const m = missionCard();
    if (!m) return [];
    return (m.endTurn || []).map(function (o) {
      const item = Object.assign({}, o);
      if (o.autoVP === 'controlPoints') {
        item.perPlayerVP = S().players.map(p => controlledCount(p.id));
      }
      return item;
    });
  }

  function scoreMissionObjective(objId, playerId) {
    Store.commit('score objective', function () {
      const g = S();
      const item = missionEndTurnItems().find(x => x.id === objId);
      if (!item) return;
      if (!g.objectiveScores[objId]) g.objectiveScores[objId] = {};
      g.objectiveScores[objId][playerId] = (g.objectiveScores[objId][playerId] || 0) + 1;
      const suggested = item.perPlayerVP ? item.perPlayerVP[playerId] : (Number(item.vp) || 1);
      askVP(playerId, item.name, suggested);
      if (item.endsGame) {
        chainEntry('The mission ends: ' + item.name + '.', 'win');
        declareWinnerOnVP(item.name);
      }
    });
  }

  function claimSpecialObjective(playerId) {
    Store.commit('special objective', function () {
      const g = S();
      const o = g.players[playerId].objective;
      if (!o) return;
      o.completed = (o.completed || 0) + 1;
      log('★ ' + pname(playerId) + ' completes their Special Objective: “' + o.name + '”.', 'vp');
      applyEffects(o.effects, {
        sourceUnitId: null, sourcePlayer: playerId, targets: {}, label: o.name
      });
      askVP(playerId, 'Special Objective: ' + o.name, Number(o.vp) || 1);
      checkVictory();
    });
  }

  /* -------------------------------------------------- manual adjustments */

  function adjustAP(playerId, delta) {
    Store.commit('adjust AP', function () {
      const g = S();
      g.players[playerId].ap = Math.max(0, g.players[playerId].ap + delta);
      log('Manual: ' + pname(playerId) + ' AP → ' + g.players[playerId].ap + '.', 'manual');
      checkStall();
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
      if (awardVP) askVP(Store.opponentOf(u.owner), 'destroyed ' + u.name, 1);
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

  function setPendingVP(v) {
    Store.quiet(function () {
      const g = S();
      if (g.pending) g.pending.manualVP = v;
    });
  }

  return {
    startGame, beginTurn, confirmStartPhase, confirmEndPhase, beginEndPhase,
    actionAvailability, eligibleUnits, usableAPAbilities, weaponsFor, findAbility,
    beginAction, cancelFlow, flowBack, flowPickUnit, flowPickResponder,
    flowPickControlPoint, confirmSecure, confirmRelic,
    missionCard, missionEndTurnItems, toggleUnitFlag, controlledCount,
    relicCarrier, setRelicCarrier, killValue, endGameNow,
    confirmSimple, confirmPass, confirmOverwatch,
    flowPickAbility, flowPickTarget, confirmAbility, useFreeAbility, usePhaseAbility,
    flowPickAttackTarget, flowPickWeapon, flowPickReaction, flowEligibility,
    flowHit, flowWound, flowDamage, attackNumbers, setElevation,
    applicableAuras, toggleAura, blockedReactions, flowRedirect, openFreeAttack,
    effectsNeedingTarget,
    triggerToken, confirmToken, tokenPickTarget, tokenEffects, removeToken,
    adjustAP, adjustVP, adjustWounds, removeUnit, removeEffect,
    addManualEffect, addManualToken, forceControl, forceEndChain, forceEndTurn,
    setPendingVP, scoreVP, promptVP, resolveVP, reassignVP, log,
    needsResponderChoice,
    scoreMissionObjective, claimSpecialObjective, objectiveScoredBy
  };
})();

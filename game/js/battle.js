/* =========================================================================
   THE BATTLE
   The rules, applied. Costs, the wound table and the reaction lists all come
   from ../js/rules.js, so the game and the tabletop companion can never drift
   apart on what an action costs or what wounds what.

   Unlike the companion app, this one rolls the dice — and because it can see
   the board, it can answer the questions the app has to ask a player: whether
   a DUCK broke line of sight, whether a DIVE has anywhere to go.
   ========================================================================= */

const Battle = (function () {

  let S = null;
  const listeners = [];
  const get = () => S;
  const on = fn => listeners.push(fn);
  const emit = () => listeners.forEach(fn => fn(S));

  const d6 = () => 1 + Math.floor(Math.random() * 6);
  const unit = id => S.units.find(u => u.id === id) || null;
  const alive = () => S.units.filter(u => u.alive);
  const mine = p => alive().filter(u => u.owner === p);
  const other = p => 1 - p;
  const occupied = (x, y, exceptId) =>
    alive().some(u => u.x === x && u.y === y && u.id !== exceptId);

  function log(text, cls) {
    S.log.push({ text: text, cls: cls || '' });
    if (S.log.length > 200) S.log.shift();
  }

  /* ------------------------------------------------------------- setting up */

  function start(cfg) {
    const map = MAPS.byId(cfg.mapId);
    const board = Board.build(map);
    S = {
      map: map, board: board,
      players: [0, 1].map(i => ({
        id: i, name: cfg.names[i], faction: cfg.factions[i], ap: 0, vp: 0, rp: 0
      })),
      units: [],
      turn: { number: 0, player: 0 },
      chain: { active: false, initiator: null, passes: 0 },
      control: { player: 0, forcedUnitId: null },
      pending: null,
      log: [],
      winner: null,
      vpTarget: cfg.vpTarget || 10
    };

    [0, 1].forEach(function (p) {
      const faction = PRESETS.find(f => f.id === cfg.factions[p]);
      const spots = deploySpots(board, p, faction.units.length);
      faction.units.forEach(function (spec, i) {
        const at = spots[i] || spots[spots.length - 1];
        S.units.push({
          id: 'u' + p + '_' + i, owner: p, name: spec.name,
          x: at.x, y: at.y,
          move: spec.move, maxWounds: spec.maxWounds, wounds: spec.maxWounds,
          toughness: spec.toughness, oc: spec.oc || 0,
          killVP: spec.killVP || 1,
          weapons: spec.weapons.map(w => Object.assign({}, w)),
          abilities: (spec.abilities || []).map(a => Object.assign({}, a)),
          notes: spec.notes || '',
          alive: true, kills: 0, overwatch: null, effects: []
        });
      });
    });

    log('— ' + map.name + ' —', 'big');
    beginTurn(0, true);
    emit();
  }

  /* Spread a squad through its deployment zone, keeping them a little apart. */
  function deploySpots(board, player, count) {
    const zone = [];
    for (let y = 0; y < board.h; y++) {
      for (let x = 0; x < board.w; x++) {
        if (board.deploy[y * board.w + x] === player &&
            board.height[y * board.w + x] !== Board.SOLID) zone.push({ x: x, y: y });
      }
    }
    zone.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const out = [];
    const step = Math.max(1, Math.floor(zone.length / Math.max(1, count)));
    for (let i = 0; i < count && zone.length; i++) {
      let pick = zone[Math.min(zone.length - 1, i * step)];
      /* Nudge off anybody already standing there. */
      let guard = 0;
      while (out.some(o => o.x === pick.x && o.y === pick.y) && guard++ < zone.length) {
        pick = zone[(i * step + guard) % zone.length];
      }
      out.push(pick);
    }
    return out;
  }

  /* --------------------------------------------------------------- the turn */

  function beginTurn(player, first) {
    S.turn.number += 1;
    S.turn.player = player;
    S.chain = { active: false, initiator: null, passes: 0 };
    S.control = { player: player, forcedUnitId: null };
    S.units.forEach(u => { u.effects = u.effects.filter(e => e.until !== 'chain'); });
    log('— TURN ' + S.turn.number + ': ' + S.players[player].name + ' —', 'big');
    S.players[player].ap += 1;
    log(S.players[player].name + ' gains 1 AP for the Start Phase (now ' +
        S.players[player].ap + ').', 'ap');
  }

  function endTurn() {
    if (S.winner !== null) return;
    const p = S.turn.player;
    if (S.chain.active) closeChain('the turn ended');
    scoreObjectives(p);
    checkVictory();
    if (S.winner === null) beginTurn(other(p));
    emit();
  }

  /* Only the player whose turn is ending scores from objectives, and only
     for the ones their side has the most OC within 3" of. */
  function scoreObjectives(player) {
    let scored = 0;
    S.board.objectives.forEach(function (o) {
      const oc = [0, 0];
      alive().forEach(function (u) {
        if (Board.dist(u, o) <= 3) oc[u.owner] += (u.oc || 0);
      });
      if (oc[player] > 0 && oc[player] > oc[other(player)]) scored += 1;
    });
    if (scored > 0) {
      S.players[player].vp += scored;
      log(S.players[player].name + ' holds ' + scored + ' objective' +
          (scored === 1 ? '' : 's') + ' — ' + scored + ' VP (now ' +
          S.players[player].vp + ').', 'vp');
    } else {
      log(S.players[player].name + ' holds no objectives this turn.', 'muted');
    }
  }

  function checkVictory() {
    if (S.winner !== null) return;
    S.players.forEach(function (p) {
      if (p.vp >= S.vpTarget) {
        S.winner = p.id;
        log('★ ' + p.name + ' reaches ' + p.vp + ' VP and takes the field.', 'win');
      }
    });
    [0, 1].forEach(function (p) {
      if (S.winner === null && mine(p).length === 0) {
        S.winner = other(p);
        log('★ Nothing of ' + S.players[p].name + '’s is left standing.', 'win');
      }
    });
  }

  /* ------------------------------------------------------------- the chain */

  function openChain(actor) {
    if (!S.chain.active) {
      S.chain = { active: true, initiator: actor, passes: 0 };
      log('— action chain opens —', 'chain');
    }
  }

  function closeChain(why) {
    if (!S.chain.active) return;
    S.chain.active = false;
    S.chain.passes = 0;
    S.control = { player: S.turn.player, forcedUnitId: null };
    S.units.forEach(u => { u.effects = u.effects.filter(e => e.until !== 'chain'); });
    log('Action chain ends — ' + why + '.', 'chain');
  }

  /* Hand the chain across. `forced` is the unit the answer must come from. */
  function afterAction(actor, opts) {
    opts = opts || {};
    if (!opts.isPass) S.chain.passes = 0;
    if (opts.endsChain) {
      closeChain(opts.reason || 'the action says so');
      emit();
      return;
    }
    S.control = { player: other(actor), forcedUnitId: opts.forcedUnitId || null };
    emit();
  }

  const spend = (player, n) => { S.players[player].ap = Math.max(0, S.players[player].ap - n); };

  /* --------------------------------------------------------- what can I do */

  function actionsFor(unitId) {
    const u = unit(unitId);
    if (!u || !u.alive || S.winner !== null || S.pending) return [];
    const p = S.control.player;
    if (u.owner !== p) return [];
    if (S.control.forcedUnitId && S.control.forcedUnitId !== unitId) return [];
    const ap = S.players[p].ap;
    const out = [];
    const add = (id, cost, why) => out.push({ id: id, cost: cost, ok: ap >= cost && !why, why: why });

    add('move', 1, null);
    add('shoot', 1, rangedTargets(unitId).length ? null : 'nothing in sight');
    add('charge', 2, chargeTargets(unitId).length ? null : 'nothing to charge');
    add('fight', 1, meleeTargets(unitId).length ? null : 'nothing in reach');
    add('overwatch', 1, u.weapons.some(w => w.type === 'ranged') ? null : 'no ranged weapon');
    return out;
  }

  const weaponsOf = (u, type) => u.weapons.filter(w => w.type === type && w.hit != null);

  /* An eligible ranged target: seen, in range of a ranged weapon, and NOT
     within reach of the defender's melee weapons. */
  function rangedTargets(unitId) {
    const u = unit(unitId);
    if (!u) return [];
    const guns = weaponsOf(u, 'ranged');
    if (!guns.length) return [];
    return alive().filter(function (t) {
      if (t.owner === u.owner) return false;
      const d = Board.dist(u, t);
      if (!guns.some(w => d <= (w.range || 0))) return false;
      if (!Board.canSee(S.board, u, t)) return false;
      /* "not within reach of the defender's melee weapons" */
      const reach = Math.max(0, ...weaponsOf(t, 'melee').map(w => w.range || 1));
      if (d <= reach) return false;
      return true;
    }).map(t => t.id);
  }

  function meleeTargets(unitId) {
    const u = unit(unitId);
    if (!u) return [];
    const blades = weaponsOf(u, 'melee');
    if (!blades.length) return [];
    return alive().filter(function (t) {
      if (t.owner === u.owner) return false;
      const d = Board.dist(u, t);
      return blades.some(w => d <= (w.range || 1));
    }).map(t => t.id);
  }

  /* You can charge anything you could reach with a 6" move and still end in
     range of a blade — the game rolls the actual distance when you commit. */
  function chargeTargets(unitId) {
    const u = unit(unitId);
    if (!u || !weaponsOf(u, 'melee').length) return [];
    const reach = Math.max(1, ...weaponsOf(u, 'melee').map(w => w.range || 1));
    return alive().filter(function (t) {
      if (t.owner === u.owner) return false;
      const d = Board.dist(u, t);
      return d > reach && d <= 6 + reach && Board.canSee(S.board, u, t);
    }).map(t => t.id);
  }

  function moveField(unitId, inches) {
    const u = unit(unitId);
    return Board.reachable(S.board, u, inches === undefined ? u.move : inches,
      (x, y) => occupied(x, y, unitId));
  }

  /* --------------------------------------------------------------- moving */

  function doMove(unitId, cell) {
    const u = unit(unitId);
    const p = S.control.player;
    if (!u || u.owner !== p || S.players[p].ap < 1) return;
    const field = moveField(unitId);
    const path = Board.pathTo(S.board, field, u, cell);
    if (!path || !path.length) return;

    openChain(p);
    spend(p, 1);
    log(S.players[p].name + ': ' + u.name + ' → MOVE.', 'action');
    walk(u, path, function () {
      afterAction(p, { endsChain: true, reason: 'MOVE' });
    });
  }

  /* Step along a path, stopping to let overwatch fire. Anything watching gets
     its shot the moment the mover comes within 3" of a token. */
  function walk(u, path, done) {
    let i = 0;
    (function step() {
      if (i >= path.length || !u.alive) { done(); return; }
      const c = path[i++];
      u.x = c.x; u.y = c.y;
      if (u.overwatch) { u.overwatch = null; log(u.name + ' gives up its overwatch by moving.', 'muted'); }
      const watchers = triggeredWatchers(u);
      if (watchers.length) { openOverwatch(u, watchers, step); return; }
      step();
    })();
  }

  function triggeredWatchers(mover) {
    return alive().filter(function (w) {
      if (w.owner === mover.owner || !w.overwatch) return false;
      if (Board.dist(mover, w.overwatch) > 3) return false;
      if (!Board.canSee(S.board, w, mover)) return false;
      const d = Board.dist(w, mover);
      return weaponsOf(w, 'ranged').some(g => d <= (g.range || 0));
    });
  }

  function openOverwatch(mover, watchers, resume) {
    S.pending = {
      kind: 'overwatch', moverId: mover.id,
      watchers: watchers.map(w => w.id), queue: [], resume: resume
    };
    log(mover.name + ' moves into a watched arc.', 'note');
    emit();
  }

  function toggleWatcher(id) {
    const q = S.pending.queue;
    const i = q.indexOf(id);
    if (i >= 0) q.splice(i, 1); else q.push(id);
    emit();
  }

  function fireOverwatch() {
    const pend = S.pending;
    const mover = unit(pend.moverId);
    const queue = pend.queue.slice();
    const resume = pend.resume;
    S.pending = null;
    (function next() {
      if (!queue.length) { resume(); emit(); return; }
      const w = unit(queue.shift());
      if (!w || !w.overwatch) { next(); return; }
      w.overwatch = null;
      if (!mover.alive) {
        log(w.name + '’s overwatch is wasted — ' + mover.name + ' is already down.', 'muted');
        next();
        return;
      }
      const gun = weaponsOf(w, 'ranged')
        .filter(g => Board.dist(w, mover) <= (g.range || 0))
        .sort((a, b) => a.hit - b.hit)[0];
      if (!gun) { next(); return; }
      log(w.name + ' fires overwatch at ' + mover.name + '.', 'token');
      resolveAttack({
        attacker: w, target: mover, weapon: gun, hitMod: -1,
        overwatch: true, noReaction: true
      }, next);
    })();
  }

  /* ------------------------------------------------------------- attacking */

  function elevation(a, t) {
    return Board.heightAt(S.board, a.x, a.y) - Board.heightAt(S.board, t.x, t.y);
  }

  function doShoot(attackerId, targetId, weaponName) {
    const a = unit(attackerId), t = unit(targetId), p = S.control.player;
    if (!a || !t || a.owner !== p || S.players[p].ap < 1) return;
    const gun = a.weapons.find(w => w.name === weaponName) ||
                weaponsOf(a, 'ranged').sort((x, y) => x.hit - y.hit)[0];
    openChain(p);
    spend(p, 1);
    log(S.players[p].name + ': ' + a.name + ' → SHOOT → ' + t.name +
        ' (' + gun.name + ').', 'action');
    offerReaction({ attacker: a, target: t, weapon: gun, range: 'ranged',
                    hitMod: elevation(a, t) > 0 ? 1 : 0, actor: p });
  }

  function doFight(attackerId, targetId, weaponName, fromCharge, chargeHigh) {
    const a = unit(attackerId), t = unit(targetId), p = S.control.player;
    if (!a || !t) return;
    const blade = a.weapons.find(w => w.name === weaponName) ||
                  weaponsOf(a, 'melee').sort((x, y) => x.hit - y.hit)[0];
    if (!fromCharge) {
      if (a.owner !== p || S.players[p].ap < 1) return;
      openChain(p);
      spend(p, 1);
      log(S.players[p].name + ': ' + a.name + ' → FIGHT → ' + t.name +
          ' (' + blade.name + ').', 'action');
    }
    offerReaction({ attacker: a, target: t, weapon: blade, range: 'melee',
                    hitMod: 0, woundMod: chargeHigh ? 1 : 0,
                    damageMod: chargeHigh ? 1 : 0, actor: p });
  }

  function doCharge(attackerId, targetId) {
    const a = unit(attackerId), t = unit(targetId), p = S.control.player;
    if (!a || !t || a.owner !== p || S.players[p].ap < 2) return;
    openChain(p);
    spend(p, 2);
    const roll = d6();
    const fromHeight = Board.heightAt(S.board, a.x, a.y);
    log(S.players[p].name + ': ' + a.name + ' → CHARGE → ' + t.name +
        ' — rolls ' + roll + '".', 'action');

    const reach = Math.max(1, ...weaponsOf(a, 'melee').map(w => w.range || 1));
    const field = moveField(attackerId, roll);
    const landing = field.cells
      .filter(c => Board.dist(c, t) <= reach)
      .sort((c1, c2) => Board.dist(c1, t) - Board.dist(c2, t))[0];

    if (!landing) {
      log(a.name + ' cannot reach — the charge is not made, and nothing comes of it.', 'note');
      afterAction(p, {});
      return;
    }
    const path = Board.pathTo(S.board, field, a, landing);
    walk(a, path || [], function () {
      if (!a.alive) { afterAction(p, {}); return; }
      const high = fromHeight > Board.heightAt(S.board, t.x, t.y);
      if (high) log('Charging down from the high ground: +1 to Wound and +1 Damage.', 'note');
      doFight(attackerId, targetId, null, true, high);
    });
  }

  /* The defender gets 1 RP and a choice. */
  function offerReaction(atk) {
    const t = atk.target;
    S.players[t.owner].rp = 1;
    const list = (atk.range === 'melee' ? RULES.meleeReactions : RULES.rangedReactions)
      .filter(r => !r.isSpecial)
      .map(function (r) {
        let why = null;
        if (r.id === 'dive' && !diveEscape(atk)) why = 'nowhere to dive that ends the attack';
        return { id: r.id, name: r.name, text: r.text, cost: r.cost, ok: !why, why: why };
      });
    S.pending = { kind: 'reaction', atk: atk, options: list };
    emit();
  }

  /* DIVE may only be taken if the 3" actually ends the attack. The game can
     check that, so it does — and remembers where to land. */
  function diveEscape(atk) {
    if (atk.range !== 'ranged') return null;
    const t = atk.target;
    const field = Board.reachable(S.board, t, 3, (x, y) => occupied(x, y, t.id));
    const safe = field.cells.filter(function (c) {
      if (Board.canSee(S.board, atk.attacker, c) &&
          Board.dist(atk.attacker, c) <= (atk.weapon.range || 0)) return false;
      return true;
    });
    if (!safe.length) return null;
    return safe.sort((a, b) => a.cost - b.cost)[0];
  }

  function chooseReaction(id) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'reaction') return;
    const atk = pend.atk;
    const t = atk.target;
    S.pending = null;

    if (id && id !== 'none') {
      const r = RULES.reactionById(id, atk.range);
      S.players[t.owner].rp = 0;
      log(t.name + ' reacts: ' + r.name + '.', 'reaction');
      if (r.hitMod) atk.hitMod = (atk.hitMod || 0) + r.hitMod;
      if (r.woundMod) atk.woundMod = (atk.woundMod || 0) + r.woundMod;
      if (r.grantAP) { S.players[t.owner].ap += r.grantAP; log(t.name + '’s side gains 1 AP (' + r.name + ').', 'ap'); }
      if (r.grantAPOnSurvive) atk.bonusSurviveAP = r.grantAPOnSurvive;
      if (r.freeChoice) atk.freeChoice = true;
      if (r.chainLivesOnDeath) atk.chainLives = true;
      if (r.endsChain) atk.endsChainAfter = true;
      if (r.selfEffect) t.effects.push({ label: r.name, until: 'chain' });
      if (id === 'evade') t.effects.push({ label: 'EVADE: +1 to hit', hit: 1, until: 'chain' });
      if (id === 'focus') t.effects.push({ label: 'FOCUS: +2 to wound', wound: 2, until: 'chain' });

      if (id === 'dodge') {
        const step = Board.reachable(S.board, t, 1, (x, y) => occupied(x, y, t.id))
          .cells.sort((a, b) => b.cost - a.cost)[0];
        if (step) { t.x = step.x; t.y = step.y; }
        if (!stillResolvable(atk)) { cancelAttack(atk, t.name + ' slips out of it'); return; }
      }
      if (id === 'duck') {
        if (!Board.canSee(S.board, atk.attacker, t)) {
          cancelAttack(atk, atk.attacker.name + ' has lost sight of ' + t.name);
          return;
        }
      }
      if (id === 'dive') {
        const to = diveEscape(atk);
        if (to) { t.x = to.x; t.y = to.y; }
        cancelAttack(atk, t.name + ' dives clear');
        return;
      }
      if (id === 'withdraw') atk.withdrawAfter = true;
    } else {
      S.players[t.owner].rp = 0;
      log(t.name + ' does not react.', 'muted');
    }
    resolveAttack(atk);
  }

  function stillResolvable(atk) {
    const d = Board.dist(atk.attacker, atk.target);
    if (atk.range === 'ranged') {
      return Board.canSee(S.board, atk.attacker, atk.target) && d <= (atk.weapon.range || 0);
    }
    return d <= (atk.weapon.range || 1);
  }

  /* Nothing comes of an attack that cannot be resolved — not the damage, not
     the VP, not even the AP the target would have gained. */
  function cancelAttack(atk, why) {
    log(why + ' — the attack cannot be resolved, and nothing comes of it.', 'reaction');
    afterAction(atk.actor === undefined ? S.turn.player : atk.actor, {});
  }

  function effectMod(u, key) {
    return (u.effects || []).reduce((n, e) => n + (Number(e[key]) || 0), 0);
  }

  function resolveAttack(atk, done) {
    const a = atk.attacker, t = atk.target, w = atk.weapon;
    const hitMod = (atk.hitMod || 0) + effectMod(a, 'hit');
    const woundMod = (atk.woundMod || 0) + effectMod(a, 'wound');
    const hitTarget = RULES.applyMod(Number(w.hit), hitMod).target;
    const roll = d6();
    atk.rolls = { hit: roll, hitTarget: hitTarget };

    /* A one always fails, whatever the modifiers say. */
    if (roll === 1 || roll < hitTarget) {
      log(a.name + ' rolls ' + roll + ' against ' + hitTarget + '+ — misses.', 'miss');
      finish(atk, { hit: false }, done);
      return;
    }
    log(a.name + ' rolls ' + roll + ' against ' + hitTarget + '+ — hits.', 'hitline');

    const wTarget = RULES.applyMod(
      RULES.woundTarget(Number(w.strength), t.toughness), woundMod).target;
    const wRoll = d6();
    atk.rolls.wound = wRoll; atk.rolls.woundTarget = wTarget;
    if (wRoll === 1 || wRoll < wTarget) {
      log('Wound roll ' + wRoll + ' against ' + wTarget + '+ — no wound.', 'miss');
      finish(atk, { hit: true }, done);
      return;
    }
    const dmg = (Number(w.damage) || 1) + (atk.damageMod || 0);
    log('Wound roll ' + wRoll + ' against ' + wTarget + '+ — ' + dmg + ' damage.', 'damage');
    finish(atk, { hit: true, wound: true, damage: dmg }, done);
  }

  function finish(atk, result, done) {
    const a = atk.attacker, t = atk.target;
    let killed = false;

    if (result.damage) {
      t.wounds = Math.max(0, t.wounds - result.damage);
      log(t.name + ' takes ' + result.damage + ' — ' + t.wounds + '/' + t.maxWounds + ' W.', 'damage');
      if (t.wounds <= 0) {
        t.alive = false;
        killed = true;
        a.kills += 1;
        S.players[a.owner].vp += (t.killVP || 1);
        log(t.name + ' is DESTROYED. ' + S.players[a.owner].name + ' scores ' +
            (t.killVP || 1) + ' VP (now ' + S.players[a.owner].vp + ').', 'kill');
      }
    }
    S.players[t.owner].rp = 0;

    if (atk.overwatch) { checkVictory(); if (done) done(); else emit(); return; }

    if (!killed) {
      let gain = 1 + (atk.bonusSurviveAP || 0);
      S.players[t.owner].ap += gain;
      log(t.name + ' survives — ' + S.players[t.owner].name + ' gains ' + gain + ' AP.', 'ap');
      if (atk.withdrawAfter) {
        const to = Board.reachable(S.board, t, 3, (x, y) => occupied(x, y, t.id))
          .cells.sort((c1, c2) => Board.dist(c2, a) - Board.dist(c1, a))[0];
        if (to) { t.x = to.x; t.y = to.y; log(t.name + ' pulls back 3".', 'reaction'); }
      }
    }

    checkVictory();
    if (S.winner !== null) { emit(); return; }

    const endsChain = (killed && !atk.chainLives) || atk.endsChainAfter;
    afterAction(atk.actor === undefined ? S.turn.player : atk.actor, {
      endsChain: endsChain,
      reason: killed ? 'a unit was destroyed' : 'WITHDRAW',
      forcedUnitId: (!killed && !atk.freeChoice) ? t.id : null
    });
    if (done) done();
  }

  /* ------------------------------------------------------------- overwatch */

  function doOverwatch(unitId, cell) {
    const u = unit(unitId), p = S.control.player;
    if (!u || u.owner !== p || S.players[p].ap < 1) return;
    if (Board.dist(u, cell) > 12) return;
    openChain(p);
    spend(p, 1);
    u.overwatch = { x: cell.x, y: cell.y };
    log(S.players[p].name + ': ' + u.name + ' → OVERWATCH.', 'action');
    afterAction(p, {});
  }

  /* ------------------------------------------------------------------ pass */

  function doPass(alsoEndTurn) {
    const p = S.control.player;
    if (alsoEndTurn && p === S.turn.player) {
      log(S.players[p].name + ' passes and ends their turn.', 'action');
      endTurn();
      return;
    }
    if (!S.chain.active) {
      log(S.players[p].name + ' passes — no chain is running.', 'muted');
      emit();
      return;
    }
    S.chain.passes += 1;
    log(S.players[p].name + ' PASSES.', 'action');
    if (S.chain.passes >= 2) { closeChain('both players passed'); emit(); return; }
    afterAction(p, { isPass: true });
  }

  const mustPass = () => S.players[S.control.player].ap < 1;

  return {
    start, get, on, emit, log,
    unit, alive, mine, other, occupied,
    actionsFor, rangedTargets, meleeTargets, chargeTargets, moveField, weaponsOf,
    doMove, doShoot, doFight, doCharge, doOverwatch, doPass,
    chooseReaction, toggleWatcher, fireOverwatch, endTurn,
    mustPass, elevation, diveEscape
  };
})();

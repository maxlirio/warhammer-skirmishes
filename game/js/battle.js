/* =========================================================================
   THE BATTLE
   The rules, applied. Costs, the wound table and the reaction lists all come
   from ../js/rules.js, so the game and the tabletop companion can never drift
   apart on what an action costs or what wounds what.

   Everything here is in inches and nothing is in squares. A model stands at a
   pair of floats on a base of `radius`; a range is the straight line between
   two of them; a move is the length of tape it takes to walk there.

   Unlike the companion app, this one rolls the dice — and because it can see
   the table, it can answer the questions the app has to ask a player: whether
   a DUCK broke line of sight, whether a DIVE has anywhere to go.
   ========================================================================= */

const Battle = (function () {

  let S = null;
  const listeners = [];
  const get = () => S;
  const on = fn => listeners.push(fn);
  const emit = () => listeners.forEach(fn => fn(S));

  const BASE = 0.5;                 /* a 25mm base, near enough */

  /* The dice are seeded, not free. Two people playing over a wire each run the
     same actions in the same order, so they must each get the same rolls —
     otherwise one of them watches a hit that the other one saw miss. */
  let rng = mulberry32(1);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const d6 = () => 1 + Math.floor(rng() * 6);
  const unit = id => S.units.find(u => u.id === id) || null;
  const alive = () => S.units.filter(u => u.alive && !u.reserve);
  const mine = p => alive().filter(u => u.owner === p);
  const other = p => 1 - p;
  const others = exceptId => alive().filter(u => u.id !== exceptId);
  const rangeTo = (a, b) => Board.dist(a, b);

  function log(text, cls) {
    S.log.push({ text: text, cls: cls || '' });
    if (S.log.length > 300) S.log.shift();
  }

  const roll = () => d6();

  /* A roll the bowl should show on its own, rather than as part of a shot. */
  function announce(value, target, label) {
    S.dice.push({ value: value, target: target || null, label: label, at: S.seq++ });
    if (S.dice.length > 8) S.dice.shift();
  }

  /* ------------------------------------------------------------- setting up */

  function start(cfg) {
    const map = MAPS.byId(cfg.mapId);
    const board = Board.build(map);
    rng = mulberry32(cfg.seed || 1);
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
      log: [], strikes: [], dice: [], seq: 0,
      winner: null,
      mission: null, flags: {}, control: { player: 0, forcedUnitId: null },
      secured: {}, relic: null, highGround: null,
      vpTarget: cfg.vpTarget || 10
    };
    S.control = { player: 0, forcedUnitId: null };

    /* The card being played, and everything it puts on the table. */
    const mission = cfg.missionId ? RULES.missionById(cfg.missionId) : null;
    S.mission = mission;
    if (mission) {
      S.vpTarget = mission.vpTarget;
      S.roles = mission.roles ? { defender: 0, attacker: 1 } : null;
    }

    [0, 1].forEach(function (p) {
      const faction = PRESETS.find(f => f.id === cfg.factions[p]);
      const onTable = faction.units.filter(u => !u.reserve);
      const spots = deploySpots(board, p, onTable.length);
      let k = 0;
      faction.units.forEach(function (spec, i) {
        /* A unit held in reserve is alive but nowhere — it arrives by its own
           ability rather than being deployed. */
        const at = spec.reserve ? { x: -50, y: -50 } : (spots[k++] || spots[spots.length - 1]);
        const mod = (S.mission && S.mission.rosterMod) || null;
        let w = spec.maxWounds;
        if (mod && mod.woundsDelta) w = Math.max(mod.woundsMin || 1, w + mod.woundsDelta);
        S.units.push({
          id: 'u' + p + '_' + i, owner: p, name: spec.name,
          x: at.x, y: at.y, facing: p === 0 ? 0 : Math.PI, radius: BASE,
          move: spec.move, maxWounds: w, wounds: w,
          toughness: spec.toughness, oc: spec.oc || 0,
          killVP: spec.killVP || 1,
          weapons: spec.weapons.map(x => Object.assign({}, x)),
          abilities: (spec.abilities || []).map(a => Object.assign({}, a,
            { effects: (a.effects || []).map(e => Object.assign({}, e)) })),
          notes: spec.notes || '',
          reserve: !!spec.reserve,
          alive: true, kills: 0, overwatch: null, effects: [], marks: []
        });
      });
      if (S.mission && S.mission.rosterMod) {
        log(S.mission.name + ': every unit has ' + S.mission.rosterMod.woundsDelta +
            ' Wound.', 'note');
      }
    });

    placeMissionPieces(board);

    log('— ' + map.name + ' —', 'big');
    beginTurn(0, true);
    emit();
  }

  /* Whatever the card puts on the table besides the two forces: markers you
     can shoot, a relic you can carry, a piece of high ground to hold. */
  function placeMissionPieces(board) {
    const m = S.mission;
    if (!m) return;

    const marker = function (owner, spec, at) {
      S.units.push({
        id: 'm' + owner + '_' + S.units.length, owner: owner, name: spec.label,
        x: at.x, y: at.y, facing: 0, radius: BASE,
        move: 0, maxWounds: spec.wounds, wounds: spec.wounds,
        toughness: spec.toughness, oc: 0,
        killVP: spec.killVP || 1, killVPFor: spec.killVPFor || null,
        endsGame: !!spec.endsGame,
        weapons: [], abilities: [], notes: '',
        marker: true, noRP: true,
        alive: true, kills: 0, overwatch: null, effects: [], marks: []
      });
      log(spec.label + ' is placed in ' + S.players[owner].name + '’s deployment area.', 'note');
    };

    (m.markersPerPlayer || []).forEach(function (spec) {
      [0, 1].forEach(function (p) {
        const z = board.deploy[p];
        marker(p, spec, Board.nudgeToLegal(board,
          { x: z.x + z.w * (p === 0 ? 0.3 : 0.7), y: z.y + z.h * 0.5 }, BASE,
          S.units.map(u => ({ x: u.x, y: u.y, radius: BASE + 0.5 }))));
      });
    });

    if (m.markersForRole) {
      const p = m.markersForRole.role === 'defender' ? 0 : 1;
      m.markersForRole.markers.forEach(function (spec) {
        const z = board.deploy[p];
        marker(p, spec, Board.nudgeToLegal(board,
          { x: z.x + z.w * 0.5, y: z.y + z.h * 0.35 }, BASE,
          S.units.map(u => ({ x: u.x, y: u.y, radius: BASE + 0.5 }))));
      });
      log(S.players[0].name + ' is the DEFENDER; ' + S.players[1].name + ' is the ATTACKER.', 'note');
    }

    if (m.relic) {
      S.relic = { x: board.w / 2, y: board.h / 2, carrier: null, home: { x: board.w / 2, y: board.h / 2 } };
      log('The RELIC is placed in the centre of the battlefield.', 'note');
    }

    /* KING OF THE HILL: the card says the tallest terrain near the middle. The
       game can see the table, so it works it out rather than asking. */
    if (m.id === 'hill') {
      let best = null;
      board.terrain.forEach(function (t) {
        const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
        const fromMid = Math.hypot(cx - board.w / 2, cy - board.h / 2);
        const score = t.top * 3 - fromMid;
        if (!best || score > best.score) best = { t: t, score: score, cx: cx, cy: cy };
      });
      if (best) {
        S.highGround = best.t;
        log('The HIGH GROUND is the ' + (best.t.kind || 'terrain') + ' at the centre, ' +
            best.t.top.toFixed(1) + '" up.', 'note');
      }
    }

    if (m.controlPoints) {
      board.objectives.forEach(o => { S.secured[o.id] = null; });
    }
  }

  const onTable = u => u.alive && !u.reserve;
  const isMarker = u => !!u.marker;

  /* Spread a squad down its deployment zone, a couple of inches apart. */
  function deploySpots(board, player, count) {
    const z = board.deploy[player];
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const want = { x: z.x + z.w * (player === 0 ? 0.55 : 0.45), y: z.y + z.h * t };
      out.push(Board.nudgeToLegal(board, want, BASE,
        out.map(o => ({ x: o.x, y: o.y, radius: BASE + 0.4 }))));
    }
    return out;
  }

  /* --------------------------------------------------------------- the turn */

  function beginTurn(player) {
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
    if (S.winner !== null || S.pending) return;
    const p = S.turn.player;
    if (S.chain.active) closeChain('the turn ended');
    scoreEndOfTurn(p);
    checkVictory();
    if (S.winner === null) beginTurn(other(p));
    emit();
  }

  /* Who has the most OC within 3" of a spot. */
  function holderOf(o) {
    const oc = [0, 0];
    alive().forEach(function (u) {
      if (!isMarker(u) && rangeTo(u, o) <= 3) oc[u.owner] += (u.oc || 0);
    });
    if (oc[0] === oc[1]) return null;
    return oc[0] > oc[1] ? 0 : 1;
  }

  const inZone = (p, z) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

  /* Only the player whose turn is ending scores, and what they score is
     whatever the card says. The game can see the table, so none of this has to
     be asked — it is read off the board. */
  function scoreEndOfTurn(player) {
    const m = S.mission;
    const me = S.players[player];
    let scored = 0;
    const say = (n, why) => { scored += n; log(me.name + ' scores ' + n + ' VP — ' + why + '.', 'vp'); };

    if (m && m.id === 'hill') {
      const up = mine(player).filter(u => !isMarker(u) && S.highGround &&
                                          Board.inBox(S.highGround, u));
      if (up.length) say(1, up[0].name + ' holds the HIGH GROUND');

    } else if (m && m.id === 'secure') {
      const held = S.board.objectives.filter(o => S.secured[o.id] === player).length;
      if (held) say(held, 'holding ' + held + ' SECURED objective' + (held === 1 ? '' : 's'));

    } else if (m && m.id === 'relic') {
      const carrier = S.relic && S.relic.carrier ? unit(S.relic.carrier) : null;
      if (carrier && carrier.owner === player && carrier.alive) {
        say(1, carrier.name + ' is carrying the RELIC');
        if (inZone(carrier, S.board.deploy[player])) {
          say(3, carrier.name + ' brought the RELIC home');
          S.relic.carrier = null;
          S.relic.x = S.relic.home.x; S.relic.y = S.relic.home.y;
          carrier.carryingRelic = false;
          log('The RELIC is returned to the centre of the battlefield.', 'note');
        }
      }

    } else {
      /* assassination scores the centre marker; a card-less game scores them all */
      const mid = { x: S.board.w / 2, y: S.board.h / 2 };
      const list = (m && m.id === 'assassination')
        ? [S.board.objectives.reduce((a, o) =>
            Board.dist(o, mid) < Board.dist(a, mid) ? o : a, S.board.objectives[0])]
        : S.board.objectives;
      const held = list.filter(o => holderOf(o) === player).length;
      if (held) say(held, 'holding ' + held + ' objective' + (held === 1 ? '' : 's'));
    }

    if (!scored) log(me.name + ' scores nothing this turn.', 'muted');
    me.vp += scored;
  }

  function checkVictory() {
    if (S.winner !== null) return;
    if (S.vpTarget) {
      S.players.forEach(function (p) {
        if (p.vp >= S.vpTarget) {
          S.winner = p.id;
          log('★ ' + p.name + ' reaches ' + p.vp + ' VP and takes the field.', 'win');
        }
      });
    }
    /* A force is wiped out when nothing of theirs that can fight is left — a
       marker sitting in a deployment zone is not a fighting unit. */
    [0, 1].forEach(function (p) {
      if (S.winner === null &&
          S.units.filter(u => u.owner === p && u.alive && !isMarker(u)).length === 0) {
        S.winner = other(p);
        log('★ Nothing of ' + S.players[p].name + '’s is left standing.', 'win');
      }
    });
    /* Some cards end the moment a thing is destroyed, whatever the score. */
    if (S.winner === null && S.endNow) {
      S.winner = S.players[0].vp >= S.players[1].vp ? 0 : 1;
      log('★ ' + S.endNow + ' — ' + S.players[S.winner].name + ' takes the field.', 'win');
    }
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

    if (u.marker) return [];             /* a crate does not take actions */

    const carrying = !!u.carryingRelic;
    add('move', 1, null);
    add('shoot', 1, rangedTargets(unitId).length ? null : 'nothing in sight');
    add('charge', 2, carrying ? 'carrying the RELIC'
                    : chargeTargets(unitId).length ? null : 'nothing to charge');
    add('fight', 1, meleeTargets(unitId).length ? null : 'nothing in reach');
    add('overwatch', 1, carrying ? 'carrying the RELIC'
                       : u.weapons.some(w => w.type === 'ranged') ? null : 'no ranged weapon');

    /* SECURE THE AREA and THE RELIC each add an action of their own. */
    const m = S.mission;
    if (m && (m.extraActions || []).indexOf('secure') >= 0) {
      const o = nearestObjective(u);
      const why = !o ? 'no objective within 3"'
                : holderOf(o) !== u.owner ? 'you do not have the most OC there'
                : S.secured[o.id] === u.owner ? 'already yours'
                : null;
      add('secure', 1, why);
    }
    if (m && (m.extraActions || []).indexOf('relic') >= 0 && S.relic) {
      const why = S.relic.carrier ? (S.relic.carrier === u.id ? 'you have it' : 'somebody has it')
                : rangeTo(u, S.relic) > 3 ? 'the RELIC is not within 3"'
                : null;
      add('relic', 1, why);
    }

    /* Everything the unit's own card lets it do for AP. */
    abilityActions(u).forEach(function (a) {
      out.push({ id: 'ability:' + a.index, cost: a.cost, ok: ap >= a.cost && !a.why,
                 why: a.why, name: a.name, ability: a.index, text: a.text });
    });
    return out;
  }

  const nearestObjective = u => S.board.objectives
    .filter(o => rangeTo(u, o) <= 3)
    .sort((a, b) => rangeTo(u, a) - rangeTo(u, b))[0] || null;

  function doSecure(unitId) {
    const u = unit(unitId), p = S.control.player;
    if (!u || u.owner !== p || S.players[p].ap < 1) return;
    const o = nearestObjective(u);
    if (!o || holderOf(o) !== p) return;
    openChain(p);
    spend(p, 1);
    S.secured[o.id] = p;
    log(S.players[p].name + ': ' + u.name + ' SECURES the objective — it stays theirs until ' +
        'somebody takes it off them.', 'action');
    afterAction(p, {});
  }

  function doRelic(unitId) {
    const u = unit(unitId), p = S.control.player;
    if (!u || u.owner !== p || S.players[p].ap < 1 || !S.relic || S.relic.carrier) return;
    if (rangeTo(u, S.relic) > 3) return;
    openChain(p);
    spend(p, 1);
    S.relic.carrier = u.id;
    u.carryingRelic = true;
    log(S.players[p].name + ': ' + u.name + ' takes up the RELIC. −2" Move, and no ' +
        'OVERWATCH or CHARGE while carrying it.', 'action');
    afterAction(p, {});
  }

  const weaponsOf = (u, type) => u.weapons.filter(w => w.type === type && w.hit != null);
  const reachOf = u => {
    const blades = weaponsOf(u, 'melee');
    return blades.length ? Math.max.apply(null, blades.map(w => w.range || 1)) : 0;
  };

  /* Seen, in range of a gun, and not already within reach of the defender's
     own blades. Ranges are measured base to base, the way you would. */
  function rangedTargets(unitId) {
    const u = unit(unitId);
    if (!u) return [];
    const guns = weaponsOf(u, 'ranged');
    if (!guns.length) return [];
    return alive().filter(function (t) {
      if (t.owner === u.owner) return false;
      const d = rangeTo(u, t) - u.radius - t.radius;
      if (!guns.some(w => d <= (w.range || 0))) return false;
      if (!Board.canSee(S.board, u, t)) return false;
      if (d <= reachOf(t)) return false;
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
      const d = rangeTo(u, t) - u.radius - t.radius;
      return blades.some(w => d <= (w.range || 1));
    }).map(t => t.id);
  }

  /* Anything a 6" charge could plausibly reach — the dice decide on commit. */
  function chargeTargets(unitId) {
    const u = unit(unitId);
    if (!u || !weaponsOf(u, 'melee').length) return [];
    const reach = Math.max(1, reachOf(u));
    return alive().filter(function (t) {
      if (t.owner === u.owner) return false;
      const d = rangeTo(u, t) - u.radius - t.radius;
      return d > reach && d <= 6 + reach && Board.canSee(S.board, u, t);
    }).map(t => t.id);
  }

  const levelOf = u => Board.heightAt(S.board, u);

  const fieldFor = (u, blockers) =>
    Board.moveField(S.board, u, u.radius,
      (blockers || others(u.id)).map(o => ({ x: o.x, y: o.y, radius: o.radius })),
      levelOf(u));

  const moveOf = u => Math.max(1, u.move + (u.carryingRelic ? -2 : 0) + effectMod(u, 'move'));

  function moveField(unitId) {
    const u = unit(unitId);
    const field = fieldFor(u);
    const inches = moveOf(u);
    return { field: field, inches: inches, climbs: Board.climbSpots(field, inches) };
  }

  /* ============================================================= ABILITIES
     A unit's own card. Anything that costs AP is offered in its action list by
     name; anything that costs RP is offered when it is attacked. */

  function abilityActions(u) {
    const out = [];
    (u.abilities || []).forEach(function (a, i) {
      if (a.trigger !== 'ap') return;
      const cost = a.cost === undefined ? 1 : a.cost;
      let why = null;
      if (a.usesPerTurn && a.usedTurn === S.turn.number) why = 'already used this turn';
      if (a.effects && a.effects.some(e => e.kind === 'place' && e.fromReserve) && !u.reserve) {
        why = u.name + ' is already on the battlefield';
      }
      if (u.reserve && !(a.effects || []).some(e => e.kind === 'place')) {
        why = 'in reserve';
      }
      out.push({ index: i, name: a.name, cost: cost, why: why, text: a.text || '' });
    });
    return out;
  }

  const abilityOf = (u, i) => (u.abilities || [])[i] || null;

  /* Does this ability need somewhere or something pointed at before it runs? */
  function abilityNeeds(u, a) {
    const e = (a.effects || []);
    if (e.some(x => x.kind === 'place')) return 'spot';
    if (e.some(x => x.kind === 'damage' || x.kind === 'mark' || x.kind === 'heal' ||
                    x.kind === 'attack')) {
      return e.some(x => x.side === 'friendly') ? 'friend' : 'enemy';
    }
    return null;
  }

  function useAbility(unitId, index, arg) {
    const u = unit(unitId), p = S.control.player;
    const a = abilityOf(u, index);
    if (!u || !a || u.owner !== p) return;
    const cost = a.cost === undefined ? 1 : a.cost;
    if (S.players[p].ap < cost) return;

    const need = abilityNeeds(u, a);
    if (need && arg === undefined) {
      S.pending = { kind: 'ability', unitId: unitId, index: index, need: need,
                    name: a.name, text: a.text || '' };
      emit();
      return;
    }

    openChain(p);
    spend(p, cost);
    if (a.usesPerTurn) a.usedTurn = S.turn.number;
    log(S.players[p].name + ': ' + u.name + ' → ' + a.name + '.', 'action');
    if (a.text) log(a.text, 'note');
    runEffects(u, a, arg, p);
  }

  function runEffects(u, a, arg, p) {
    let endsChain = a.opponentReacts === false;
    let attacked = false;

    (a.effects || []).forEach(function (e) {
      const target = (typeof arg === 'string') ? unit(arg) : null;
      switch (e.kind) {
        case 'ap_self':
          S.players[p].ap += Number(e.value) || 1;
          log(S.players[p].name + ' gains ' + (e.value || 1) + ' AP.', 'ap');
          break;
        case 'ap_opponent':
          S.players[other(p)].ap += Number(e.value) || 1;
          log(S.players[other(p)].name + ' gains ' + (e.value || 1) + ' AP.', 'ap');
          break;
        case 'vp_self':
          S.players[p].vp += Number(e.value) || 1;
          log(S.players[p].name + ' scores ' + (e.value || 1) + ' VP.', 'vp');
          break;
        case 'heal': {
          const who = target || u;
          who.wounds = Math.min(who.maxWounds, who.wounds + (Number(e.value) || 1));
          log(who.name + ' recovers to ' + who.wounds + '/' + who.maxWounds + ' W.', 'damage');
          break;
        }
        case 'damage': {
          if (!target) break;
          target.wounds = Math.max(0, target.wounds - (Number(e.value) || 1));
          log(target.name + ' takes ' + (e.value || 1) + ' — ' + target.wounds + '/' +
              target.maxWounds + ' W.', 'damage');
          S.strikes.push({ at: S.seq++, attacker: u.id, target: target.id, melee: false,
                           weapon: a.name,
                           from: { x: u.x, y: u.y, z: Board.heightAt(S.board, u) },
                           to: { x: target.x, y: target.y, z: Board.heightAt(S.board, target) },
                           hit: true, wound: true, damage: Number(e.value) || 1,
                           killed: target.wounds <= 0, rolls: null });
          if (target.wounds <= 0) {
            target.alive = false;
            u.kills += 1;
            const worth = killValue(target, u);
            S.players[p].vp += worth.vp;
            log(target.name + ' is DESTROYED.', 'kill');
            if (target.endsGame) S.endNow = target.name + ' is destroyed';
            dropRelicFrom(target, true);
          }
          break;
        }
        case 'mark':
          if (target) {
            target.marks.push(e.label || 'MARKED');
            log(target.name + ' is ' + (e.label || 'MARKED') + '.', 'note');
          }
          break;
        case 'unmark':
          alive().filter(x => x.owner !== p).forEach(x => { x.marks = []; });
          break;
        case 'mod_hit':
        case 'mod_wound':
        case 'mod_strength':
        case 'mod_move': {
          const key = { mod_hit: 'hit', mod_wound: 'wound', mod_strength: 'strength',
                        mod_move: 'move' }[e.kind];
          const who = target || u;
          const row = { label: a.name, until: e.until || 'chain' };
          row[key] = Number(e.value) || 1;
          who.effects.push(row);
          log(who.name + ': ' + a.name + ' (' + (e.value > 0 ? '+' : '') + e.value + ' ' +
              key + ').', 'note');
          break;
        }
        case 'place': {
          const spot = arg && arg.x !== undefined ? arg : null;
          if (!spot) break;
          if (u.reserve) { u.reserve = false; log(u.name + ' arrives on the battlefield.', 'note'); }
          u.x = spot.x; u.y = spot.y;
          if (e.noMoveTurn) u.noMoveTurn = S.turn.number;
          break;
        }
        case 'attack': {
          const t2 = target;
          if (!t2) break;
          attacked = true;
          const w = weaponsOf(u, e.weapon === 'melee' ? 'melee' : 'ranged')
            .sort((x, y) => x.hit - y.hit)[0];
          if (!w) break;
          resolveAttack({ attacker: u, target: t2, weapon: w,
                          range: e.weapon === 'melee' ? 'melee' : 'ranged',
                          hitMod: Number(e.hitMod) || 0, actor: p, noReaction: true,
                          overwatch: true });
          break;
        }
        case 'note':
          log(e.text || a.text || '', 'note');
          break;
        default:
          if (e.text) log(e.text, 'note');
      }
    });

    if (!attacked) afterAction(p, { endsChain: endsChain, reason: a.name });
  }

  /* Placing something: the ability is waiting for a spot or a unit. */
  function confirmAbility(arg) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'ability') return;
    S.pending = null;
    useAbility(pend.unitId, pend.index, arg);
  }

  /* Where a reserve unit is allowed to arrive. */
  function arrivalSpots(unitId) {
    const u = unit(unitId);
    const out = [];
    for (let y = 1; y < S.board.h; y += 0.7) {
      for (let x = 1; x < S.board.w; x += 0.7) {
        const p = { x: x, y: y };
        if (!Board.standable(S.board, p, u.radius)) continue;
        if (alive().some(o => Board.dist(o, p) < o.radius + u.radius + 0.15)) continue;
        out.push(p);
      }
    }
    return out;
  }

  /* --------------------------------------------------------------- moving */

  function doMove(unitId, to) {
    const u = unit(unitId);
    const p = S.control.player;
    if (!u || u.owner !== p || S.players[p].ap < 1) return;
    const field = fieldFor(u);

    /* Either walk to it, or walk into a piece of terrain and go up it. */
    let path = null, climb = null;
    if (Board.canReach(field, to, moveOf(u))) {
      path = Board.pathTo(field, to);
    } else {
      climb = Board.climbFor(field, u.move, to);
      if (climb) path = Board.pathTo(field, climb.from);
    }
    if (!path) return;

    openChain(p);
    spend(p, 1);
    log(S.players[p].name + ': ' + u.name + ' → MOVE (' +
        (climb ? climb.cost : path.length).toFixed(1) + '").', 'action');
    if (climb) {
      log(u.name + ' climbs the ' + (climb.box.kind || 'terrain') + ' — ' +
          climb.top.toFixed(1) + '" up, and that is the end of the move.', 'note');
    }
    walk(u, path.points, climb, function () {
      afterAction(p, { endsChain: true, reason: 'MOVE' });
    });
  }

  /* Walk the line, in short steps, so anything watching gets its shot at the
     moment the model crosses into the arc rather than at the end of it. */
  function walk(u, points, climb, done) {
    if (typeof climb === 'function') { done = climb; climb = null; }
    if (u.overwatch) { u.overwatch = null; log(u.name + ' gives up its overwatch by moving.', 'muted'); }
    const STEP = 0.5;
    const legs = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const len = Board.dist(a, b);
      const n = Math.max(1, Math.ceil(len / STEP));
      for (let k = 1; k <= n; k++) {
        legs.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
      }
    }
    u.walking = { points: points.slice(), at: 0 };
    let i = 0, mounted = false;
    (function step() {
      if (!u.alive) { u.walking = null; done(); return; }
      if (i >= legs.length) {
        /* touched it, so go up it — and being up there is a move too, so
           anything watching gets one more look */
        if (climb && !mounted) {
          mounted = true;
          u.climbed = { from: { x: u.x, y: u.y }, to: { x: climb.x, y: climb.y }, top: climb.top, at: S.seq++ };
          u.x = climb.x; u.y = climb.y;
          const w2 = triggeredWatchers(u);
          if (w2.length) { openOverwatch(u, w2, step); return; }
        }
        u.walking = null; done(); return;
      }
      const c = legs[i++];
      if (i > 1) u.facing = Math.atan2(c.y - u.y, c.x - u.x);
      u.x = c.x; u.y = c.y;
      if (S.relic && S.relic.carrier === u.id) { S.relic.x = u.x; S.relic.y = u.y; }
      const watchers = triggeredWatchers(u);
      if (watchers.length) { openOverwatch(u, watchers, step); return; }
      step();
    })();
  }

  function triggeredWatchers(mover) {
    return alive().filter(function (w) {
      if (w.owner === mover.owner || !w.overwatch) return false;
      if (rangeTo(mover, w.overwatch) > 3) return false;
      if (!Board.canSee(S.board, w, mover)) return false;
      const d = rangeTo(w, mover) - w.radius - mover.radius;
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
      const d = rangeTo(w, mover) - w.radius - mover.radius;
      const gun = weaponsOf(w, 'ranged')
        .filter(g => d <= (g.range || 0))
        .sort((a, b) => a.hit - b.hit)[0];
      if (!gun) { next(); return; }
      log(w.name + ' fires overwatch at ' + mover.name + '.', 'token');
      resolveAttack({
        attacker: w, target: mover, weapon: gun, hitMod: -1, range: 'ranged',
        overwatch: true, noReaction: true
      }, next);
    })();
  }

  /* ------------------------------------------------------------- attacking */

  const elevation = (a, t) => Board.heightAt(S.board, a) - Board.heightAt(S.board, t);

  function faceTo(a, t) { a.facing = Math.atan2(t.y - a.y, t.x - a.x); }

  function doShoot(attackerId, targetId, weaponName) {
    const a = unit(attackerId), t = unit(targetId), p = S.control.player;
    if (!a || !t || a.owner !== p || S.players[p].ap < 1) return;
    const gun = a.weapons.find(w => w.name === weaponName) ||
                weaponsOf(a, 'ranged').sort((x, y) => x.hit - y.hit)[0];
    openChain(p);
    spend(p, 1);
    faceTo(a, t);
    const high = elevation(a, t) > 0;
    log(S.players[p].name + ': ' + a.name + ' → SHOOT → ' + t.name +
        ' (' + gun.name + ', ' + rangeTo(a, t).toFixed(1) + '").', 'action');
    if (high) log('Firing down from the high ground: +1 to hit.', 'note');
    offerReaction({ attacker: a, target: t, weapon: gun, range: 'ranged',
                    hitMod: high ? 1 : 0, actor: p });
  }

  function doFight(attackerId, targetId, weaponName, fromCharge, chargeHigh) {
    const a = unit(attackerId), t = unit(targetId), p = S.control.player;
    if (!a || !t) return;
    const blade = a.weapons.find(w => w.name === weaponName) ||
                  weaponsOf(a, 'melee').sort((x, y) => x.hit - y.hit)[0];
    faceTo(a, t);
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
    const rolled = roll();
    announce(rolled, null, 'CHARGE');
    const fromHigh = Board.heightAt(S.board, a);
    log(S.players[p].name + ': ' + a.name + ' → CHARGE → ' + t.name +
        ' — rolls ' + rolled + '".', 'action');

    const reach = Math.max(1, reachOf(a));
    const field = fieldFor(a);
    const landing = chargeLanding(field, a, t, reach, rolled);

    if (!landing) {
      log(a.name + ' cannot reach — the charge is not made, and nothing comes of it.', 'note');
      afterAction(p, {});
      return;
    }
    const path = Board.pathTo(field, landing);
    walk(a, path ? path.points : [a, landing], null, function () {
      if (!a.alive) { afterAction(p, {}); return; }
      const high = fromHigh > Board.heightAt(S.board, t);
      if (high) log('Charging down from the high ground: +1 to Wound and +1 Damage.', 'note');
      doFight(attackerId, targetId, null, true, high);
    });
  }

  /* The closest legal spot within the roll that puts a blade on the target. */
  function chargeLanding(field, a, t, reach, rolled) {
    const want = reach + a.radius + t.radius - 0.05;
    let best = null, bestCost = Infinity;
    for (let ring = want; ring > a.radius + t.radius; ring -= 0.25) {
      for (let k = 0; k < 48; k++) {
        const ang = (k / 48) * Math.PI * 2;
        const p = { x: t.x + Math.cos(ang) * ring, y: t.y + Math.sin(ang) * ring };
        const c = Board.costTo(field, p);
        if (c > rolled + 1e-6) continue;
        if (c < bestCost) { bestCost = c; best = p; }
      }
      if (best) return best;
    }
    return best;
  }

  /* The defender gets 1 RP and a choice. */
  function offerReaction(atk) {
    const t = atk.target;
    /* A marker is a thing, not a soldier: it gets no reaction points. */
    if (t.noRP) {
      log(t.name + ' cannot react.', 'muted');
      resolveAttack(atk);
      return;
    }
    S.players[t.owner].rp = 1;
    const list = (atk.range === 'melee' ? RULES.meleeReactions : RULES.rangedReactions)
      .filter(r => !r.isSpecial)
      .map(function (r) {
        let why = null;
        if (r.id === 'dive' && !diveEscapes(atk).length) why = 'nowhere to dive that ends the attack';
        if (r.id === 'dodge' && !dodgeSpots(atk).length) why = 'nowhere to step';
        return { id: r.id, name: r.name, text: r.text, cost: r.cost, ok: !why, why: why };
      });
    /* and whatever the defender's own card lets them do for RP */
    (t.abilities || []).forEach(function (ab, i) {
      if (ab.trigger !== 'rp') return;
      if (ab.reactRange && ab.reactRange !== 'any' && ab.reactRange !== atk.range) return;
      list.push({ id: 'ability:' + i, name: ab.name, text: ab.text || '',
                  cost: ab.cost === undefined ? 1 : ab.cost, ok: true, ability: i });
    });
    S.pending = { kind: 'reaction', atk: atk, options: list };
    emit();
  }

  /* Somewhere to put a model, sampled finely enough to be worth offering. The
     rules test below is exact; this is only what gets shaded on the table. */
  function spotsWithin(u, inches, keep, step) {
    const field = fieldFor(u);
    const out = [];
    const climbs = Board.climbSpots(field, inches).filter(c => !keep || keep(c));
    climbs.forEach(c => out.push({ x: c.x, y: c.y, climb: c }));
    const STEP = step || 0.4;
    for (let dy = -inches; dy <= inches + 1e-9; dy += STEP) {
      for (let dx = -inches; dx <= inches + 1e-9; dx += STEP) {
        if (dx * dx + dy * dy > inches * inches) continue;
        const p = { x: u.x + dx, y: u.y + dy };
        if (!Board.canReach(field, p, inches)) continue;
        if (keep && !keep(p)) continue;
        out.push(p);
      }
    }
    return { field: field, inches: inches, spots: out, climbs: climbs, keep: keep || null };
  }

  const dodgeSpots = atk => spotsWithin(atk.target, 1).spots;

  /* DIVE may only be taken if the 3" actually ends the attack — the game can
     check that, so it does, and offers every landing spot that qualifies. */
  function diveEscapes(atk) {
    if (atk.range !== 'ranged') return [];
    const a = atk.attacker, t = atk.target;
    return spotsWithin(t, 3, function (p) {
      const d = Board.dist(a, p) - a.radius - t.radius;
      return !(Board.canSee(S.board, a, p) && d <= (atk.weapon.range || 0));
    }).spots;
  }

  /* Hand the table back to a player to choose where a reaction moves them.
     `inches` and `keep` are the exact rule; `spots` is only the shading. */
  function askMove(u, inches, keep, label, hint, then) {
    /* Sampled finely: a reaction's legal ground is often a thin crescent and a
       coarse sample makes it look like three dots. */
    const sampled = spotsWithin(u, inches, keep, 0.22);
    S.pending = {
      kind: 'move', unitId: u.id, inches: inches, step: 0.22,
      field: sampled.field, keep: keep || null, spots: sampled.spots,
      climbs: sampled.climbs,
      label: label, hint: hint, then: then
    };
    emit();
  }

  /* Where a click actually puts the model. The exact spot if it is legal;
     otherwise the nearest legal one within a base's width, because a player
     aiming at a 3" patch of table should not have to hit it to the pixel. */
  function snapMove(pend, to) {
    const legal = p => (Board.canReach(pend.field, p, pend.inches) ||
                        (pend.climbs || []).some(c => Board.dist(c, p) < 1e-6)) &&
                       (!pend.keep || pend.keep(p));
    if (legal(to)) return { x: to.x, y: to.y };
    let best = null, bestD = 1.4;
    pend.spots.forEach(function (s) {
      const d = Board.dist(s, to);
      if (d < bestD) { bestD = d; best = s; }
    });
    return best ? { x: best.x, y: best.y } : null;
  }

  /* A reaction that moves you is still a move: it is walked, not teleported,
     so an overwatch token you cross on the way still gets its shot. */
  function placeMove(where) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'move') return;
    const to = snapMove(pend, where);
    if (!to) return;
    const u = unit(pend.unitId);
    const then = pend.then;
    const climb = pend.climbs && pend.climbs.find(c => Board.dist(c, to) < 1e-6);
    S.pending = null;
    const path = climb ? Board.pathTo(pend.field, climb.from) : Board.pathTo(pend.field, to);
    walk(u, path ? path.points : [{ x: u.x, y: u.y }, to], climb || null, then);
  }

  function chooseReaction(id) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'reaction') return;
    /* Only what was actually on offer — the screen greys the rest out, but the
       engine should not take one on trust either. */
    if (id && id !== 'none') {
      const offered = pend.options.find(o => o.id === id);
      if (!offered || !offered.ok) return;
      if (offered.cost > S.players[pend.atk.target.owner].rp) return;
      /* the defender's own card, spent as a reaction */
      if (offered.ability !== undefined) {
        const t2 = pend.atk.target, ab = abilityOf(t2, offered.ability);
        S.pending = null;
        S.players[t2.owner].rp = 0;
        log(t2.name + ' reacts: ' + ab.name + '.', 'reaction');
        if (ab.text) log(ab.text, 'note');
        const keepActor = pend.atk.actor;
        runEffects(t2, ab, undefined, t2.owner);
        resolveAttack(pend.atk);
        return;
      }
    }
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
        askMove(t, 1, null, 'DODGE — move 1"',
                'Anywhere within 1". If it takes you out of sight or out of range, ' +
                'the attack cannot be resolved at all.',
                function () {
                  if (!stillResolvable(atk)) { cancelAttack(atk, t.name + ' slips out of it'); return; }
                  resolveAttack(atk);
                });
        return;
      }
      if (id === 'duck') {
        if (!Board.canSee(S.board, atk.attacker, t)) {
          cancelAttack(atk, atk.attacker.name + ' has lost sight of ' + t.name);
          return;
        }
      }
      if (id === 'dive') {
        const a = atk.attacker;
        askMove(t, 3, function (p) {
          const d = Board.dist(a, p) - a.radius - t.radius;
          return !(Board.canSee(S.board, a, p) && d <= (atk.weapon.range || 0));
        }, 'DIVE — move 3"',
           'Only the ground that actually ends the attack is offered — out of ' +
           'sight of ' + a.name + ', or out of the ' + atk.weapon.name + '’s reach.',
           function () { cancelAttack(atk, t.name + ' dives clear'); });
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
    const a = atk.attacker, t = atk.target;
    const d = rangeTo(a, t) - a.radius - t.radius;
    if (atk.range === 'ranged') {
      return Board.canSee(S.board, a, t) && d <= (atk.weapon.range || 0);
    }
    return d <= (atk.weapon.range || 1);
  }

  /* Nothing comes of an attack that cannot be resolved — not the damage, not
     the VP, not even the AP the target would have gained. */
  function cancelAttack(atk, why) {
    log(why + ' — the attack cannot be resolved, and nothing comes of it.', 'reaction');
    afterAction(atk.actor === undefined ? S.turn.player : atk.actor, {});
  }

  /* What this kill is worth, by the card being played. */
  function killValue(t, a) {
    const m = S.mission;
    let vp = t.killVP || 1, why = '';
    if (t.marker) why = t.name;
    if (m && m.unitFlag && S.flags[t.id] === m.unitFlag.id) {
      vp = m.unitFlag.killVP || vp;
      why = m.unitFlag.label;
    }
    if (m && m.id === 'hill' && S.highGround && Board.inBox(S.highGround, t)) {
      vp = Math.max(vp, m.unitFlag.killVP || 2);
      why = 'on the HIGH GROUND';
    }
    /* AMBUSH: the defender is worth more for killing in their own ground. */
    if (m && m.killZoneBonus) {
      const defender = 0;
      if (a.owner === defender && !t.marker && inZone(t, S.board.deploy[defender])) {
        vp = m.killZoneBonus.vp;
        why = 'killed in ' + m.killZoneBonus.zone;
      }
    }
    if (t.killVPFor) {
      const want = t.killVPFor === 'attacker' ? 1 : 0;
      if (a.owner !== want) vp = 1;
    }
    return { vp: vp, why: why };
  }

  /* The RELIC falls where its carrier does. */
  function dropRelicFrom(u, destroyed) {
    if (!S.relic || S.relic.carrier !== u.id) return;
    S.relic.carrier = null;
    u.carryingRelic = false;
    const spot = Board.nudgeToLegal(S.board, { x: u.x + (destroyed ? 0.8 : 0), y: u.y },
                                    BASE, alive().map(o => ({ x: o.x, y: o.y, radius: BASE })));
    S.relic.x = spot.x; S.relic.y = spot.y;
    log(u.name + ' drops the RELIC.', 'note');
  }

  function effectMod(u, key) {
    return (u.effects || []).reduce((n, e) => n + (Number(e[key]) || 0), 0);
  }

  function resolveAttack(atk, done) {
    const a = atk.attacker, t = atk.target, w = atk.weapon;
    faceTo(a, t);
    const hitMod = (atk.hitMod || 0) + effectMod(a, 'hit');
    const woundMod = (atk.woundMod || 0) + effectMod(a, 'wound');
    const hitTarget = RULES.applyMod(Number(w.hit), hitMod).target;

    const r = roll();
    atk.rolls = { hit: r, hitTarget: hitTarget };

    /* A one always fails, whatever the modifiers say. */
    if (r === 1 || r < hitTarget) {
      log(a.name + ' rolls ' + r + ' against ' + hitTarget + '+ — misses.', 'miss');
      finish(atk, { hit: false }, done);
      return;
    }
    log(a.name + ' rolls ' + r + ' against ' + hitTarget + '+ — hits.', 'hitline');

    const wTarget = RULES.applyMod(
      RULES.woundTarget(Number(w.strength), t.toughness), woundMod).target;
    const wRoll = roll();
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

    /* One record of the whole exchange, which the table plays out: the round
       leaving the muzzle, whether it found him, and what it did. */
    const strike = {
      at: S.seq++,
      attacker: a.id, target: t.id,
      melee: atk.range === 'melee',
      weapon: atk.weapon.name,
      from: { x: a.x, y: a.y, z: Board.heightAt(S.board, a) },
      to: { x: t.x, y: t.y, z: Board.heightAt(S.board, t) },
      hit: !!result.hit, wound: !!result.wound, damage: result.damage || 0,
      rolls: atk.rolls || null, overwatch: !!atk.overwatch,
      killed: false
    };

    if (result.damage) {
      t.wounds = Math.max(0, t.wounds - result.damage);
      if (t.wounds > 0) dropRelicFrom(t, false);
      log(t.name + ' takes ' + result.damage + ' — ' + t.wounds + '/' + t.maxWounds + ' W.', 'damage');
      if (t.wounds <= 0) {
        t.alive = false;
        killed = true;
        strike.killed = true;
        a.kills += 1;
        const worth = killValue(t, a);
        S.players[a.owner].vp += worth.vp;
        log(t.name + ' is DESTROYED. ' + S.players[a.owner].name + ' scores ' +
            worth.vp + ' VP' + (worth.why ? ' (' + worth.why + ')' : '') +
            ' (now ' + S.players[a.owner].vp + ').', 'kill');
        if (t.endsGame) S.endNow = t.name + ' is destroyed';
        dropRelicFrom(t, true);
      }
    }
    S.strikes.push(strike);
    if (S.strikes.length > 12) S.strikes.shift();
    S.players[t.owner].rp = 0;

    if (atk.overwatch) { checkVictory(); if (done) done(); else emit(); return; }

    /* Everything after the survivor's AP, parked so a WITHDRAW can interrupt
       it while the player picks where they are pulling back to. */
    function wrapUp() {
      checkVictory();
      if (S.winner !== null) { emit(); return; }
      afterAction(atk.actor === undefined ? S.turn.player : atk.actor, {
        endsChain: (killed && !atk.chainLives) || atk.endsChainAfter,
        reason: killed ? 'a unit was destroyed' : 'WITHDRAW',
        forcedUnitId: (!killed && !atk.freeChoice) ? t.id : null
      });
      if (done) done();
    }

    if (!killed) {
      const gain = 1 + (atk.bonusSurviveAP || 0);
      S.players[t.owner].ap += gain;
      log(t.name + ' survives — ' + S.players[t.owner].name + ' gains ' + gain + ' AP.', 'ap');
      if (atk.withdrawAfter && spotsWithin(t, 3).spots.length) {
        askMove(t, 3, null, 'WITHDRAW — move 3"',
                t.name + ' lived through it. Pull back anywhere within 3".',
                function () { log(t.name + ' pulls back.', 'reaction'); wrapUp(); });
        return;
      }
    }
    wrapUp();
  }

  /* ------------------------------------------------------------- overwatch */

  function doOverwatch(unitId, at) {
    const u = unit(unitId), p = S.control.player;
    if (!u || u.owner !== p || S.players[p].ap < 1) return;
    if (rangeTo(u, at) > 12) return;
    if (!Board.inside(S.board, at)) return;
    openChain(p);
    spend(p, 1);
    u.overwatch = { x: at.x, y: at.y };
    u.facing = Math.atan2(at.y - u.y, at.x - u.x);
    log(S.players[p].name + ': ' + u.name + ' → OVERWATCH, ' +
        rangeTo(u, at).toFixed(1) + '" out.', 'action');
    afterAction(p, {});
  }

  /* ------------------------------------------------------------------ pass */

  function doPass(alsoEndTurn) {
    const p = S.control.player;
    if (S.pending) return;
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
    start, get, on, emit, log, BASE,
    unit, alive, mine, other, rangeTo,
    actionsFor, rangedTargets, meleeTargets, chargeTargets, moveField, weaponsOf, reachOf,
    doMove, doShoot, doFight, doCharge, doOverwatch, doPass, doSecure, doRelic,
    abilityActions, useAbility, confirmAbility, arrivalSpots, abilityOf, moveOf,
    chooseReaction, toggleWatcher, fireOverwatch, endTurn, placeMove,
    mustPass, elevation, diveEscapes, spotsWithin, fieldFor, snapMove
  };
})();

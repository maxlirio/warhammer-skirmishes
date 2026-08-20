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
  const alive = () => S.units.filter(u => u.alive && !u.reserve && u.deployed !== false);
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
    /* The card decides the ground. A table that suits KING OF THE HILL is the
       wrong shape for SABOTAGE, so they are not chosen separately. */
    const map = MAPS.forMission(cfg.missionId || null);
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
      log: [], strikes: [], dice: [], tokens: [], buffs: [[], []], cards: [null, null],
      setupAsks: [], seq: 0,
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
      faction.units.forEach(function (spec, i) {
        /* A unit held in reserve is alive but nowhere — it arrives by its own
           ability rather than being deployed. */
        const at = { x: -60, y: -60 };          /* placed during deployment */
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
          deployed: !!spec.reserve,       /* a reserve unit has nowhere to be put */
          alive: true, kills: 0, overwatch: null, effects: [], marks: []
        });
      });
      if (S.mission && S.mission.rosterMod) {
        log(S.mission.name + ': every unit has ' + S.mission.rosterMod.woundsDelta +
            ' Wound.', 'note');
      }
    });

    fitObjectivesToCard(board);
    placeMissionPieces(board);

    /* the faction cards, and their pools */
    [0, 1].forEach(function (p) {
      const f = PRESETS.find(x => x.id === cfg.factions[p]);
      if (!f || !f.card) return;
      S.cards[p] = Object.assign({}, f.card, { value: f.card.resource.start });
      log(S.players[p].name + ' begins with ' + S.cards[p].value + ' ' +
          f.card.resource.name + '.', 'note');
    });

    log('— ' + map.name + ' —', 'big');
    S.setupAsks = [];
    beginDeployment();
    emit();
  }

  /* Each table is authored for its own card, so the markers on it are already
     the ones that card calls for. This only says so in the log. */
  function fitObjectivesToCard(board) {
    const m = S.mission;
    if (!m) return;
    const n = board.objectives.length;
    log(m.name + ' — ' + (n ? n + ' objective marker' + (n === 1 ? '' : 's')
                            : 'no objective markers') + ' on ' + board.name + '.', 'note');
  }

  /* Whatever the card puts on the table besides the two forces: markers you
     can shoot, a relic you can carry, a piece of high ground to hold. */
  function placeMissionPieces(board) {
    const m = S.mission;
    if (!m) return;

    const marker = function (owner, spec, at) {
      S.units.push({
        id: 'm' + owner + '_' + S.units.length, owner: owner, name: spec.label,
        x: -60, y: -60, facing: 0, radius: BASE, deployed: false,
        move: 0, maxWounds: spec.wounds, wounds: spec.wounds,
        toughness: spec.toughness, oc: 0,
        killVP: spec.killVP || 1, killVPFor: spec.killVPFor || null,
        endsGame: !!spec.endsGame,
        weapons: [], abilities: [], notes: '',
        marker: true, noRP: true,
        alive: true, kills: 0, overwatch: null, effects: [], marks: []
      });
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

  /* ------------------------------------------------------------ DEPLOYMENT
     Nobody is put down for you. The two of you take it in turns to choose
     where each model stands, inside your own zone — which is the first real
     decision of the game and used to be made by a loop. */
  function beginDeployment() {
    const waiting = [[], []];
    S.units.forEach(function (u) {
      if (!u.deployed) waiting[u.owner].push(u.id);
    });
    /* a marker goes down before the models that are meant to guard it */
    [0, 1].forEach(function (p) {
      waiting[p].sort(function (a, b) {
        return (unit(b).marker ? 1 : 0) - (unit(a).marker ? 1 : 0);
      });
    });

    const order = [];
    if (S.mission && S.mission.roles) {
      /* AMBUSH says the defender sets up first, and all of them */
      order.push.apply(order, waiting[0]);
      order.push.apply(order, waiting[1]);
      log(S.mission.name + ': the DEFENDER sets up first, the ATTACKER second.', 'note');
    } else {
      let i = 0;
      while (waiting[0].length || waiting[1].length) {
        const p = i % 2;
        if (waiting[p].length) order.push(waiting[p].shift());
        else if (waiting[1 - p].length) order.push(waiting[1 - p].shift());
        i++;
      }
      log('Deployment: take it in turns to put a model down.', 'note');
    }

    S.deploy = { order: order, at: 0 };
    askDeploy();
  }

  /* Everywhere inside your zone a model of this size could stand. */
  function deployField(u) {
    const z = S.board.deploy[u.owner];
    const out = [];
    for (let y = z.y + 0.6; y <= z.y + z.h - 0.6; y += 0.6) {
      for (let x = z.x + 0.6; x <= z.x + z.w - 0.6; x += 0.6) {
        const p = { x: x, y: y };
        if (!Board.standable(S.board, p, u.radius, Board.heightAt(S.board, p))) continue;
        if (S.units.some(o => o.deployed && o.alive && !o.reserve &&
                              Board.dist(o, p) < o.radius + u.radius + 0.1)) continue;
        out.push(p);
      }
    }
    return out;
  }

  function askDeploy() {
    const d = S.deploy;
    if (!d || d.at >= d.order.length) {
      S.deploy = null;
      S.pending = null;
      log('Both forces are on the table.', 'note');
      runGameStart();
      beginTurn(0, true);
      nextSetupAsk();
      emit();
      return;
    }
    const u = unit(d.order[d.at]);
    const spots = deployField(u);
    if (!spots.length) { d.at++; askDeploy(); return; }
    S.control = { player: u.owner, forcedUnitId: null };
    S.pending = {
      kind: 'deploy', unitId: u.id, owner: u.owner, spots: spots,
      label: 'DEPLOY — ' + u.name,
      hint: S.players[u.owner].name + ', put ' + u.name + ' anywhere in your zone.' +
            (u.marker ? ' This is the thing you have to keep alive.' : ''),
      left: d.order.length - d.at
    };
    emit();
  }

  function placeDeploy(at) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'deploy') return;
    const u = unit(pend.unitId);
    let to = at;
    if (!pend.spots.some(sp => Board.dist(sp, at) < 0.35)) {
      let best = null, bestD = 2.5;
      pend.spots.forEach(function (sp) {
        const dd = Board.dist(sp, at);
        if (dd < bestD) { bestD = dd; best = sp; }
      });
      if (!best) return;
      to = best;
    }
    u.x = to.x; u.y = to.y;
    u.deployed = true;
    u.facing = u.owner === 0 ? 0 : Math.PI;
    log(S.players[u.owner].name + ' deploys ' + u.name + '.', 'action');
    S.deploy.at++;
    S.pending = null;
    askDeploy();
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
    detonate('turn');
    /* a card's pool fills at the top of its owner's turn */
    if (S.cards[player]) {
      S.cards[player].value += S.cards[player].resource.perTurn || 0;
      log(S.players[player].name + ' gains ' + (S.cards[player].resource.perTurn || 0) + ' ' +
          S.cards[player].resource.name + ' (now ' + S.cards[player].value + ').', 'ap');
    }
    log('— TURN ' + S.turn.number + ': ' + S.players[player].name + ' —', 'big');
    const draw = RULES.startPhaseAP === undefined ? 1 : RULES.startPhaseAP;
    S.players[player].ap += draw;
    log(S.players[player].name + ' gains ' + draw + ' AP for the Start Phase (now ' +
        S.players[player].ap + ').', 'ap');
  }

  function endTurn() {
    if (S.winner !== null || S.pending) return;
    const p = S.turn.player;
    if (S.chain.active) closeChain('the turn ended');
    /* END: whatever the cards do before the turn is scored */
    runEndPhase(p, function () {
      scoreEndOfTurn(p);
      checkVictory();
      if (S.winner === null) beginTurn(other(p));
      emit();
    });
  }

  /* Cards that trigger in the End Phase get offered here, one at a time, and
     the turn does not finish until they have been answered. */
  function runEndPhase(p, done) {
    const ready = mine(p).filter(u => !isMarker(u) &&
      abilitiesOf(u).some(a => a.trigger === 'end' && !a.usedGame));
    if (!ready.length) { done(); return; }
    (function step() {
      const u = ready.shift();
      if (!u) { done(); return; }
      const ab = abilitiesOf(u).find(a => a.trigger === 'end' && !a.usedGame);
      if (!ab) { step(); return; }
      S.pending = { kind: 'endability', unitId: u.id, name: ab.name,
                    text: ab.text || '', owner: p,
                    then: function (use) {
                      if (!use) { step(); return; }
                      ab.usedGame = true;
                      log(S.players[p].name + ': ' + u.name + ' → ' + ab.name + '.', 'action');
                      if (ab.text) log(ab.text, 'note');
                      runPlaceMany(u, ab, p, step);
                    } };
      emit();
    })();
  }

  function answerEndAbility(use) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'endability') return;
    const then = pend.then;
    S.pending = null;
    then(use);
  }

  /* "Place up to two friendly units anywhere..." — pick one, place it, repeat. */
  function runPlaceMany(u, ab, p, done) {
    const e = (ab.effects || []).find(x => x.kind === 'place') || {};
    const max = Number(e.max) || 1;
    let left = max;
    (function round() {
      if (left <= 0) { done(); return; }
      const choices = mine(p).filter(x => !isMarker(x) && !x.placedByGate);
      if (!choices.length) { done(); return; }
      askPick(choices, ab.name + ' — ' + left + ' left',
              'Choose a friendly unit to place, or pass to stop.',
              function (who) {
                if (!who) { done(); return; }
                who.placedByGate = true;
                const spots = arrivalSpots(who.id, ab);
                if (!spots.length) { done(); return; }
                S.pending = { kind: 'put', unitId: who.id, radius: 1e4, spots: spots,
                              label: 'PLACE ' + who.name.toUpperCase(),
                              hint: 'Anywhere more than 6" from an enemy.',
                              then: function (at) {
                                if (at) {
                                  who.x = at.x; who.y = at.y;
                                  who.movedTurn = S.turn.number;
                                  who.climbed = { top: Board.heightAt(S.board, who), at: S.seq++ };
                                  log(who.name + ' is placed.', 'note');
                                  const watchers = triggeredWatchers(who);
                                  if (watchers.length) {
                                    openOverwatch(who, watchers, function () { left--; round(); });
                                    return;
                                  }
                                }
                                left--;
                                round();
                              } };
                emit();
              });
    })();
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

  /* Called the moment anything dies, as well as at the end of a turn.

     It used to run only in the End Phase — and endTurn() bails out whenever
     something is pending, so a force could be wiped out and the game would
     carry on regardless: the dead player kept taking turns, kept drawing
     resource, and could be asked to "choose a friendly unit" when they had
     none left. A game is over the moment the last model falls, not whenever
     the turn structure next gets round to noticing. */
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

  /* Anything a card does before the first turn — Da Hunta picking somebody. */
  function runGameStart() {
    S.units.forEach(function (u) {
      abilitiesOf(u).forEach(function (ab) {
        if (ab.trigger !== 'gamestart') return;
        (ab.effects || []).forEach(function (e) {
          if (e.kind !== 'mark') return;
          /* the card says CHOOSE one, so its owner chooses */
          S.setupAsks.push({ owner: u.owner, src: u, ab: ab, e: e });
        });
      });
    });
  }

  /* Anything a card asks its owner before the first turn. */
  function nextSetupAsk() {
    if (!S.setupAsks || !S.setupAsks.length) return;
    const q = S.setupAsks.shift();
    const foes = alive().filter(x => x.owner !== q.owner && !x.marker);
    askPick(foes, q.src.name + ' — ' + q.ab.name,
            q.ab.text || 'Choose one enemy unit.',
            function (pick) {
              if (pick) {
                pick.marks.push(q.e.label || 'MARKED');
                log(q.src.name + ' — ' + q.ab.name + ': ' + pick.name + ' is ' +
                    (q.e.label || 'MARKED') + '.', 'note');
              }
              nextSetupAsk();
              emit();
            });
  }

  function closeChain(why) {
    if (!S.chain.active) return;
    S.chain.active = false;
    S.chain.passes = 0;
    S.control = { player: S.turn.player, forcedUnitId: null };
    S.units.forEach(u => { u.effects = u.effects.filter(e => e.until !== 'chain'); });
    detonate('chain');
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

  /* Tokens that go off, or go away, when their moment comes. */
  function detonate(when) {
    const going = S.tokens.filter(t => t.expiry === when);
    going.forEach(function (tok) {
      (tok.tokenEffects || []).forEach(function (e) {
        if (e.kind !== 'damage') return;
        alive().filter(x => rangeTo(x, tok) <= (tok.radius || 3)).forEach(function (x) {
          x.wounds = Math.max(0, x.wounds - (Number(e.value) || 1));
          log(tok.label + ': ' + x.name + ' takes ' + (e.value || 1) + ' — ' +
              x.wounds + '/' + x.maxWounds + ' W.', 'damage');
          S.strikes.push({ at: S.seq++, attacker: x.id, target: x.id, melee: true,
                           weapon: tok.label,
                           from: { x: tok.x, y: tok.y, z: Board.heightAt(S.board, tok) },
                           to: { x: x.x, y: x.y, z: Board.heightAt(S.board, x) },
                           hit: true, wound: true, damage: Number(e.value) || 1,
                           killed: x.wounds <= 0, rolls: null });
          if (x.wounds <= 0) {
            x.alive = false;
            log(x.name + ' is DESTROYED.', 'kill');
            checkVictory();
          }
        });
      });
      if (tok.label) log(tok.label + ' is removed.', 'token');
    });
    S.tokens = S.tokens.filter(t => t.expiry !== when);
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
    add('move', 1, u.noMoveTurn === S.turn.number ? 'placed this turn — may not MOVE' : null);
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

  /* ====================================================== WHAT THE CARDS DO
     Every passive, aura and token on the table, gathered into the numbers an
     attack actually uses. The companion app has to offer these as tick-boxes
     because it cannot measure; this one measures, so they simply apply. */

  const abilitiesOf = u => (u.abilities || []);
  const hasPassive = (u, name) => abilitiesOf(u).some(a => a.name === name);

  /* Everything with an aura effect that is currently on the table. */
  function auras() {
    const out = [];
    alive().forEach(function (u) {
      abilitiesOf(u).forEach(function (a) {
        (a.effects || []).forEach(function (e) {
          if (e.kind === 'aura') out.push({ src: u, ab: a, e: e });
        });
      });
    });
    return out;
  }

  /* Does this aura reach? There are two shapes of them and they read in
     opposite directions, which is what makes this fiddly:

       onlyVsOwner   the aura is about its OWN source being attacked — Cloaked,
                     Small. `side: enemy` means it hinders enemies shooting at
                     it, so the range is measured from the shooter to the source.
       otherwise     the aura buffs whoever is near the source — It's My Job,
                     Intimidating Presence — so the range is source to subject. */
  function auraApplies(au, subject, attacker, weapon, range) {
    const e = au.e;
    if (e.weapon && e.weapon !== 'any' && e.weapon !== range) return false;

    if (e.onlyVsOwner) {
      if (subject.id !== au.src.id) return false;
      const byEnemy = attacker.owner !== au.src.owner;
      if (e.side === 'enemy' && !byEnemy) return false;
      if (e.side === 'friendly' && byEnemy) return false;
      const d = rangeTo(attacker, au.src);
      if (e.mode === 'within' && d > (e.range || 6)) return false;
      if (e.mode === 'beyond' && d <= (e.range || 6)) return false;
      return true;
    }

    const friendly = au.src.owner === subject.owner;
    if (e.side === 'friendly' && !friendly) return false;
    if (e.side === 'enemy' && friendly) return false;
    const d = rangeTo(au.src, subject);
    if (e.mode === 'within' && d > (e.range || 6)) return false;
    if (e.mode === 'beyond' && d <= (e.range || 6)) return false;
    return true;
  }

  /* Any token whose line of sight rule bites on this shot. */
  function tokenHitMod(a, t, range) {
    let mod = 0;
    (S.tokens || []).forEach(function (tok) {
      const au = tok.aura;
      if (!au || au.mode !== 'los') return;
      if (au.weapon && au.weapon !== 'any' && au.weapon !== range) return;
      /* does the line from shooter to target pass within the token's cloud? */
      const d = distPointToSegment(tok, a, t);
      if (d <= (tok.radius || 1.5)) mod += Number(au.value) || 0;
    });
    return mod;
  }

  function distPointToSegment(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const len = vx * vx + vy * vy;
    let t = len ? (wx * vx + wy * vy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
  }

  /* The whole modifier stack for one attack, with a note for the log. */
  function attackMods(a, t, weapon, range, opts) {
    opts = opts || {};
    const notes = [];
    let hit = 0, wound = 0, damage = 0;

    if (elevation(a, t) > 0 && range === 'ranged') { hit += 1; notes.push('high ground +1 hit'); }
    if (opts.chargeHigh) { wound += 1; damage += 1; notes.push('charging downhill +1 wound, +1 damage'); }
    if (opts.overwatch) { hit -= 1; notes.push('overwatch −1 hit'); }

    auras().forEach(function (au) {
      const e = au.e;
      /* an aura on the shooter helps them; one on the target hinders them */
      if (e.stat === 'hit' || e.stat === 'wound') {
        /* one that guards its own source is about the target being shot at;
           anything else is about the shooter it is standing near */
        const subject = e.onlyVsOwner ? t : a;
        if (!auraApplies(au, subject, a, weapon, range)) return;
        const v = Number(e.value) || 0;
        if (e.stat === 'hit') hit += v; else wound += v;
        notes.push(au.ab.name + ' ' + (v > 0 ? '+' : '') + v + ' ' + e.stat);
      }
    });

    const tm = tokenHitMod(a, t, range);
    if (tm) { hit += tm; notes.push('smoke ' + tm + ' hit'); }

    /* Al's Bayonet is worth more when he charges home with it. */
    if (opts.fromCharge && hasPassive(a, 'Bayonet Charge') && /bayonet/i.test(weapon.name)) {
      damage += 1;
      notes.push('Bayonet Charge +1 damage');
    }
    /* Da Hunta's Shoota hurts more once he has picked somebody out. */
    abilitiesOf(a).forEach(function (ab) {
      (ab.effects || []).forEach(function (e) {
        if (e.kind !== 'markbonus') return;
        if (e.weaponName && e.weaponName !== weapon.name) return;
        if ((t.marks || []).indexOf(e.label || 'MARKED') < 0) return;
        damage += Number(e.value) || 1;
        notes.push(ab.name + ' +' + (e.value || 1) + ' damage vs ' + (e.label || 'MARKED'));
      });
    });

    hit += effectMod(a, 'hit');
    wound += effectMod(a, 'wound');
    return { hit: hit, wound: wound, damage: damage, notes: notes };
  }

  /* How many dice this weapon throws. */
  function diceFor(a, weapon) {
    let n = 1, why = null;
    abilitiesOf(a).forEach(function (ab) {
      (ab.effects || []).forEach(function (e) {
        if (e.kind !== 'dice') return;
        if (e.weaponName && e.weaponName !== weapon.name) return;
        if (e.condition === 'notmoved' && a.movedTurn === S.turn.number) return;
        if (Number(e.value) > n) { n = Number(e.value); why = ab.name; }
      });
    });
    /* a power bought off the faction card, spent by the attack that uses it */
    const buffs = S.buffs && S.buffs[a.owner] ? S.buffs[a.owner] : [];
    for (let i = 0; i < buffs.length; i++) {
      const b = buffs[i];
      if (b.kind === 'dice' && (!b.weaponName || b.weaponName === weapon.name)) {
        if (Number(b.value) > n) { n = Number(b.value); why = b.from; }
        buffs.splice(i, 1);
        break;
      }
    }
    return { n: n, why: why };
  }

  /* Reactions a card takes off the table before the defender even sees them. */
  function blockedReactions(a, t, weapon) {
    const out = {};
    alive().forEach(function (u) {
      abilitiesOf(u).forEach(function (ab) {
        (ab.effects || []).forEach(function (e) {
          if (e.kind !== 'blockreact') return;
          if (e.weaponName && e.weaponName !== weapon.name) return;
          if (e.scope === 'enemy') {
            /* the attacker's card stopping the defender reacting */
            if (u.id !== a.id) return;
          } else {
            /* a friendly card stopping its own squad — Briant's job */
            if (u.owner !== t.owner) return;
            if (e.range && rangeTo(u, t) > e.range) return;
          }
          out[e.reaction] = ab.name;
        });
      });
    });
    return out;
  }

  /* The faction card and its pool. Its powers are bought in your own Start
     Phase, which is any point in your turn before the chain opens. */
  function cardPowers(player) {
    const card = S.cards[player];
    if (!card) return [];
    return (card.abilities || []).map(function (a, i) {
      let why = null;
      if (card.value < a.cost) why = 'needs ' + a.cost + ' ' + card.resource.name;
      if (S.turn.player !== player) why = 'only in your own turn';
      if (S.chain.active) why = 'the chain has already opened';
      return { index: i, name: a.name, cost: a.cost, text: a.text || '', ok: !why, why: why };
    });
  }

  function useCardPower(player, index, arg) {
    const card = S.cards[player];
    const a = card && (card.abilities || [])[index];
    if (!a || card.value < a.cost || S.turn.player !== player || S.chain.active) return;
    const need = (a.effects || []).some(e => e.kind === 'place') ? 'friend' : null;
    if (need && arg === undefined) {
      S.pending = { kind: 'card', player: player, index: index, need: need,
                    name: a.name, text: a.text || '' };
      emit();
      return;
    }
    card.value -= a.cost;
    log(S.players[player].name + ' spends ' + a.cost + ' ' + card.resource.name +
        ': ' + a.name + '.', 'action');
    if (a.text) log(a.text, 'note');

    if (need === 'friend') {
      const who = unit(arg);
      if (who) {
        S.pending = { kind: 'ability', unitId: who.id, index: -1, need: 'spot',
                      name: a.name, text: 'Place ' + who.name + ' anywhere on the battlefield.',
                      spots: arrivalSpots(who.id), cardEffect: a };
        emit();
        return;
      }
    }
    runEffects({ id: null, owner: player, x: 0, y: 0, effects: [], abilities: [], marks: [] },
               a, undefined, player, { noHandover: true });
    emit();
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
      /* the card's own conditions, so a button never costs AP and does nothing */
      (a.effects || []).forEach(function (e) {
        if (e.kind === 'hook') {
          const sniff = Number(e.near) || 3;
          if (!S.board.terrain.some(t => Board.distToBox(t, u) <= sniff)) {
            why = 'no terrain within ' + sniff + '"';
          }
        }
        if (e.kind === 'place' && !e.fromReserve && arrivalSpots(u.id, i).length === 0) {
          why = 'nowhere it may be placed';
        }
      });
      if (a.usesPerGame && a.usedGame) why = 'already used this game';
      if (/use only on your turn/i.test(a.text || '') && S.turn.player !== u.owner) {
        why = 'only on your own turn';
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
    const needsOne = e.filter(x => (x.kind === 'damage' || x.kind === 'mark' ||
                                    x.kind === 'heal' || x.kind === 'attack') &&
                                   x.pick !== 'multi' && x.pick !== 'attacker');
    if (needsOne.length) {
      return needsOne.some(x => x.side === 'friendly') ? 'friend' : 'enemy';
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
                    name: a.name, text: a.text || '',
                    spots: need === 'spot' ? arrivalSpots(unitId, index) : null };
      emit();
      return;
    }

    openChain(p);
    spend(p, cost);
    if (a.usesPerTurn) a.usedTurn = S.turn.number;
    if (a.usesPerGame) a.usedGame = true;
    log(S.players[p].name + ': ' + u.name + ' → ' + a.name + '.', 'action');
    if (a.text) log(a.text, 'note');
    runEffects(u, a, arg, p);
  }

  function runEffects(u, a, arg, p, opts) {
    let endsChain = a.opponentReacts === false;
    let attacked = false;
    /* A unit's action is a link in the chain: when it finishes, the table turns
       to your opponent to answer it. A power bought off your faction card is
       not an action — it is spent in your own Start Phase, before the chain
       exists — so it finishes by handing the turn straight back to you. Passing
       control there stranded the game: no chain was open, so the opponent's
       PASS had nothing to pass on, and neither player could act again. */
    const handover = !(opts && opts.noHandover);
    const after = opts && opts.then;
    const settle = function (o) {
      if (after) { after(); return; }
      if (handover) afterAction(p, o || {});
      else emit();
    };
    /* anything that has to stop and ask the player something, queued so the
       questions come one at a time rather than all at once */
    const pendingEffects = [];

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
          if (e.pick === 'multi') {
            /* everything within 6", this unit included, saves or takes it */
            const hitters = alive().filter(x => rangeTo(u, x) <= 6);
            hitters.forEach(function (x) {
              const r = roll();
              announce(r, 3, 'SAVE · ' + x.name.slice(0, 12).toUpperCase());
              if (r >= 3) { log(x.name + ' saves on ' + r + '.', 'miss'); return; }
              x.wounds = Math.max(0, x.wounds - (Number(e.value) || 1));
              log(x.name + ' fails on ' + r + ' — takes ' + (e.value || 1) + '.', 'damage');
              S.strikes.push({ at: S.seq++, attacker: u.id, target: x.id, melee: true,
                               weapon: a.name,
                               from: { x: u.x, y: u.y, z: Board.heightAt(S.board, u) },
                               to: { x: x.x, y: x.y, z: Board.heightAt(S.board, x) },
                               hit: true, wound: true, damage: Number(e.value) || 1,
                               killed: x.wounds <= 0, rolls: null });
              if (x.wounds <= 0) {
                x.alive = false;
                log(x.name + ' is DESTROYED.', 'kill');
                if (x.id === u.id) log('Nobody scores for ' + u.name + '.', 'note');
                else { u.kills += 1; S.players[p].vp += killValue(x, u).vp; }
                dropRelicFrom(x, true);
                checkVictory();
              }
            });
            break;
          }
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
            checkVictory();
          }
          break;
        }
        case 'mark': {
          const who = e.pick === 'attacker' ? (arg && arg.attackerUnit) || target : target;
          if (who) {
            who.marks.push(e.label || 'MARKED');
            log(who.name + ' is ' + (e.label || 'MARKED') + '.', 'note');
          }
          break;
        }
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
        case 'wander': {
          /* "Move up to D6 inches" — the dice say how far, you say where. */
          const r = roll();
          announce(r, null, (e.everyone ? 'WAAAAGH' : 'MOVE') + ' · D6');
          const movers = (e.everyone ? mine(p).filter(x => !isMarker(x)) : [u]).slice();
          log((e.everyone ? 'Every unit' : u.name) + ' may move up to ' + r + '".', 'note');
          pendingEffects.push(function (next) {
            (function step() {
              const mv = movers.shift();
              if (!mv) { next(); return; }
              const f = fieldFor(mv);
              askPut(mv, r, mv.name.toUpperCase() + ' — MOVE ' + r + '"',
                     'Anywhere it can walk to within ' + r + '".',
                     function (q) { return Board.canReach(f, q, r); },
                     function (at) {
                       if (at) {
                         mv.facing = Math.atan2(at.y - mv.y, at.x - mv.x);
                         mv.x = at.x; mv.y = at.y;
                         mv.movedTurn = S.turn.number;
                         log(mv.name + ' moves ' + Board.dist(mv, at).toFixed(1) + '".', 'note');
                       }
                       step();
                     });
            })();
          });
          break;
        }
        case 'hook': {
          /* Grappling Hook: straight at the nearest scenery, height ignored */
          const reach = Number(e.value) || 5, sniff = Number(e.near) || 3;
          const near = S.board.terrain
            .map(t2 => ({ t: t2, d: Board.distToBox(t2, u) }))
            .filter(o => o.d <= sniff)
            .sort((x, y) => x.d - y.d)[0];
          if (!near) { log('No terrain within 3".', 'muted'); break; }
          const cx = near.t.x + near.t.w / 2, cy = near.t.y + near.t.h / 2;
          const ang2 = Math.atan2(cy - u.y, cx - u.x);
          /* "ignoring height" is the whole point of a hook: of everywhere along
             the line it can reach, take the highest it can stand on, and only
             fall back to flat ground if it cannot get up at all. */
          let best = null, bestUp = -1;
          for (let d = 0.5; d <= reach + 1e-6; d += 0.25) {
            const q = { x: u.x + Math.cos(ang2) * d, y: u.y + Math.sin(ang2) * d };
            const lvl = Board.heightAt(S.board, q);
            if (!Board.standable(S.board, q, u.radius, lvl)) continue;
            if (alive().some(o => o !== u && rangeTo(o, q) < o.radius + u.radius)) continue;
            if (lvl > bestUp || (lvl === bestUp && best === null)) { bestUp = lvl; best = q; }
          }
          if (best) {
            u.facing = ang2;
            u.x = best.x; u.y = best.y;
            u.movedTurn = S.turn.number;
            u.climbed = { top: Board.heightAt(S.board, u), at: S.seq++ };
            log(u.name + ' hooks up onto the ' + (near.t.kind || 'terrain') + '.', 'note');
          }
          break;
        }
        case 'place': {
          const spot = arg && arg.x !== undefined ? arg : null;
          if (!spot) break;
          if (u.reserve) { u.reserve = false; log(u.name + ' arrives on the battlefield.', 'note'); }
          const was = { x: u.x, y: u.y };
          u.x = spot.x; u.y = spot.y;
          u.movedTurn = S.turn.number;
          if (e.noMoveThisTurn || e.noMoveTurn) u.noMoveTurn = S.turn.number;
          u.climbed = { top: Board.heightAt(S.board, u), at: S.seq++ };
          /* the card says it triggers overwatch, so it does */
          const watchers = triggeredWatchers(u);
          if (watchers.length) {
            openOverwatch(u, watchers, function () { settle({}); });
            return;
          }
          break;
        }
        case 'attack': {
          /* KWIK DAKKA and its like are REACTIONS: they are handed the attack
             that triggered them, not a unit id, so `target` is null and this
             broke out immediately — the card did nothing at all, ever. What
             you are shooting back at is whoever shot at you. */
          const t2 = target || (arg && arg.attackerUnit) || null;
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
        case 'token': {
          /* The card gives a distance, not a place. Roll it in the bowl, then
             hand the table over — where it goes is the player's decision. */
          const twoDice = /2D6/i.test(a.text || '');
          const r1 = roll();
          announce(r1, null, e.label + ' · D6');
          let far = r1;
          if (twoDice) { const r2 = roll(); announce(r2, null, e.label + ' · D6'); far += r2; }
          log(e.label + ': may be placed up to ' + far + '" away.', 'token');
          pendingEffects.push(function (next) {
            askPut(u, far, 'PLACE THE ' + e.label,
                   'Anywhere within ' + far + '" of ' + u.name + '. ' + (e.text || ''),
                   null,
                   function (at) {
                     if (at) {
                       S.tokens.push({ id: 't' + S.seq++, label: e.label, owner: p,
                                       x: at.x, y: at.y,
                                       radius: e.label === 'SMOKE BOMB' ? 1.5 : 3,
                                       expiry: e.expiry || 'chain', aura: e.aura || null,
                                       tokenEffects: e.tokenEffects || null,
                                       turn: S.turn.number });
                       log(e.label + ' is placed ' +
                           Board.dist(u, at).toFixed(1) + '" out.', 'token');
                     }
                     next();
                   });
          });
          break;
        }
        case 'resource': {
          const card = S.cards[p];
          if (card) {
            card.value += Number(e.value) || 1;
            log(S.players[p].name + ' gains ' + (e.value || 1) + ' ' + card.resource.name +
                ' (now ' + card.value + ').', 'ap');
          }
          break;
        }
        case 'dice':
          S.buffs[p].push({ kind: 'dice', value: e.value, weaponName: e.weaponName, from: a.name });
          log('The next attack with the ' + (e.weaponName || 'weapon') + ' rolls ' +
              e.value + ' dice.', 'note');
          break;
        case 'unmark':
          alive().filter(x => x.owner !== p).forEach(function (x) {
            if ((x.marks || []).length) log(x.name + ' is no longer ' + (e.label || 'MARKED') + '.', 'note');
            x.marks = [];
          });
          break;
        case 'note':
          log(e.text || a.text || '', 'note');
          break;
        default:
          if (e.text) log(e.text, 'note');
      }
    });

    if (pendingEffects.length) {
      (function drain() {
        const fn = pendingEffects.shift();
        if (!fn) { if (!attacked) settle({ endsChain: endsChain, reason: a.name }); return; }
        fn(drain);
      })();
      return;
    }
    if (!attacked) settle({ endsChain: endsChain, reason: a.name });
  }

  /* Placing something: the ability is waiting for a spot or a unit. */
  function confirmAbility(arg) {
    const pend = S.pending;
    if (!pend) return;
    if (pend.kind === 'card') { const p2 = pend.player, i = pend.index; S.pending = null;
                                useCardPower(p2, i, arg); return; }
    if (pend.kind !== 'ability') return;
    /* a placement bought off the faction card, rather than a unit's own */
    if (pend.index === -1 && pend.cardEffect) {
      const who = unit(pend.unitId);
      S.pending = null;
      const spot = arg && arg.x !== undefined ? arg : null;
      if (spot && who) {
        who.x = spot.x; who.y = spot.y;
        who.movedTurn = S.turn.number;
        who.noMoveTurn = S.turn.number;
        who.climbed = { top: Board.heightAt(S.board, who), at: S.seq++ };
        log(who.name + ' is placed.', 'note');
        const watchers = triggeredWatchers(who);
        if (watchers.length) { openOverwatch(who, watchers, () => emit()); return; }
      }
      emit();
      return;
    }
    S.pending = null;
    useAbility(pend.unitId, pend.index, arg);
  }

  /* Where an ability is allowed to put somebody — exactly what its card says.
     "more than 6 inches from an enemy" and "any elevated part" are measured,
     not left to the players to argue over. */
  function arrivalSpots(unitId, which) {
    const u = unit(unitId);
    const a = which === undefined || which === null ? null
            : (typeof which === 'number' ? abilityOf(u, which) : which);
    const e = a ? (a.effects || []).find(x => x.kind === 'place') : null;
    const away = a && /6"/.test(a.text || '') ? 6 : 0;
    const elevatedOnly = a && /elevated/i.test(a.text || '');
    const out = [];
    for (let y = 0.8; y < S.board.h; y += 0.6) {
      for (let x = 0.8; x < S.board.w; x += 0.6) {
        const p = { x: x, y: y };
        const lvl = Board.heightAt(S.board, p);
        if (elevatedOnly && lvl <= 0.01) continue;
        if (!Board.standable(S.board, p, u.radius, lvl)) continue;
        if (alive().some(o => o.id !== u.id && Board.dist(o, p) < o.radius + u.radius + 0.15)) continue;
        if (away && alive().some(o => o.owner !== u.owner && !isMarker(o) &&
                                      Board.dist(o, p) <= away)) continue;
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
    u.movedTurn = S.turn.number;
    alive().forEach(function (x) { delete x.__saidQuiet; });
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
    let i = 0, mounted = false;
    (function step() {
      if (!u.alive) { done(); return; }
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
        done(); return;
      }
      const c = legs[i++];
      /* Face the way you are going, from the FIRST step. This was `i > 1`, so
         the turn only happened from the second leg onward — and a short move
         is one leg, which meant models slid to their new position still facing
         wherever they had been looking. */
      if (Math.hypot(c.x - u.x, c.y - u.y) > 1e-6) {
        u.facing = Math.atan2(c.y - u.y, c.x - u.x);
      }
      u.x = c.x; u.y = c.y;
      if (S.relic && S.relic.carrier === u.id) { S.relic.x = u.x; S.relic.y = u.y; }
      const watchers = triggeredWatchers(u);
      if (watchers.length) { openOverwatch(u, watchers, step); return; }
      explainQuietWatchers(u);
      step();
    })();
  }

  function triggeredWatchers(mover) {
    return alive().filter(function (w) {
      if (w.owner === mover.owner) return false;
      if (!Board.canSee(S.board, w, mover)) return false;
      const d = rangeTo(w, mover) - w.radius - mover.radius;
      if (!weaponsOf(w, 'ranged').some(g => d <= (g.range || 0))) return false;
      /* a token placed by the OVERWATCH action */
      if (w.overwatch && rangeTo(mover, w.overwatch) <= 3) return true;
      /* or a card that does the same job — Fred's Snap Shot, once a game */
      return abilitiesOf(w).some(ab => ab.trigger === 'overwatch' && !ab.spent &&
                                       rangeTo(w, mover) <= 6);
    });
  }

  /* Why a watched arc stayed quiet.

     Crossing an overwatch token does not by itself draw a shot: the watcher
     also has to SEE you and have a gun that reaches. When it does not, nothing
     happened and nothing was said, which from the table looks exactly like the
     overwatch being broken. Now it says so. */
  function explainQuietWatchers(mover) {
    alive().forEach(function (w) {
      if (w.owner === mover.owner || !w.overwatch) return;
      if (rangeTo(mover, w.overwatch) > 3) return;          /* not in the arc */
      const d = rangeTo(w, mover) - w.radius - mover.radius;
      const guns = weaponsOf(w, 'ranged');
      let why = null;
      if (!Board.canSee(S.board, w, mover)) why = 'cannot see them';
      else if (!guns.length) why = 'has nothing to shoot with';
      else if (!guns.some(g => d <= (g.range || 0))) {
        why = 'is ' + d.toFixed(1) + '" away and their ' +
              guns.sort((a, b) => (b.range || 0) - (a.range || 0))[0].name +
              ' reaches ' + (guns[0].range || 0) + '"';
      }
      if (why && !w.__saidQuiet) {
        w.__saidQuiet = true;
        log(w.name + ' holds fire — ' + why + '.', 'muted');
      }
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
      if (!w) { next(); return; }
      const snap = !w.overwatch &&
        abilitiesOf(w).find(ab => ab.trigger === 'overwatch' && !ab.spent);
      if (!w.overwatch && !snap) { next(); return; }
      if (snap) { snap.spent = true; log(w.name + ' uses ' + snap.name + '.', 'token'); }
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
      /* The OVERWATCH action fires at -1. Snap Shot is a different card and
         says nothing of the sort, so it does not take the penalty. */
      log(w.name + (snap ? ' takes a snap shot at ' : ' fires overwatch at ') +
          mover.name + '.', 'token');
      resolveAttack({
        attacker: w, target: mover, weapon: gun, range: 'ranged',
        /* `overwatch` is the −1 to hit, which Snap Shot does not take.
           `interrupt` is the turn structure: BOTH of these happen inside
           somebody else's move and neither is an action in the chain. They
           were the same flag, so a Snap Shot fell through to the end of an
           action and handed the table to the wrong player — the mover's turn
           carried on with their opponent holding it. */
        overwatch: !snap, interrupt: true, noReaction: true
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
    const blocked = blockedReactions(atk.attacker, t, atk.weapon);
    const list = (atk.range === 'melee' ? RULES.meleeReactions : RULES.rangedReactions)
      .filter(r => !r.isSpecial)
      .map(function (r) {
        let why = null;
        if (blocked[r.id]) why = blocked[r.id] + ' takes this away';
        if (r.id === 'dive' && !why && !diveEscapes(atk).length) why = 'nowhere to dive that ends the attack';
        if (r.id === 'dodge' && !why && !dodgeSpots(atk).length) why = 'nowhere to step';
        /* DUCK is never refused: it always subtracts 1 from the wound roll.
           Whether it also ENDS the attack depends on whether there is anything
           to get behind, and that is answered when it is taken. */
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

  /* ONE sample, used by everything that asks where a model may step.

     This has to be a single number. A reaction is OFFERED by looking for legal
     ground, and then ANSWERED by clicking the legal ground it shades — and
     those were two different samples, 0.4" apart and 0.22" apart. The ground
     DIVE needs is a sliver: just out of sight, or just past the gun's reach. A
     sliver the coarse grid lands on, the fine grid can step straight over. So
     the game would offer DIVE, take it, ask where — and then refuse every
     answer, because by its second measurement there was nowhere to go. The
     table sat there, frozen, on a prompt with no answer. */
  const MOVE_STEP = 0.22;

  const dodgeSpots = atk => spotsWithin(atk.target, 1, null, MOVE_STEP).spots;

  /* DIVE may only be taken if the 3" actually ends the attack — the game can
     check that, so it does, and offers every landing spot that qualifies. */
  function diveEscapes(atk) {
    if (atk.range !== 'ranged') return [];
    const a = atk.attacker, t = atk.target;
    return spotsWithin(t, 3, function (p) {
      const d = Board.dist(a, p) - a.radius - t.radius;
      return !(Board.canSee(S.board, a, p) && d <= (atk.weapon.range || 0));
    }, MOVE_STEP).spots;
  }

  /* The card rolls for how far, and then YOU say where. Anything a card tells
     a player to "place" comes through here: the dice settle first, the legal
     ground is shaded, and nothing is chosen on their behalf. */
  function askPut(u, radius, label, hint, keep, then) {
    const spots = [];
    const STEP = 0.5;
    for (let dy = -radius; dy <= radius + 1e-9; dy += STEP) {
      for (let dx = -radius; dx <= radius + 1e-9; dx += STEP) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const q = { x: u.x + dx, y: u.y + dy };
        if (!Board.inside(S.board, q)) continue;
        if (keep && !keep(q)) continue;
        spots.push(q);
      }
    }
    if (!spots.length) { then(null); return; }
    S.pending = { kind: 'put', unitId: u.id, radius: radius, spots: spots,
                  label: label, hint: hint, then: then };
    emit();
  }

  function placePut(where) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'put') return;
    let to = where;
    if (Board.dist(unit(pend.unitId), to) > pend.radius + 1e-6) {
      /* snap to the nearest thing actually offered */
      let best = null, bestD = Infinity;
      pend.spots.forEach(function (sp) {
        const d = Board.dist(sp, where);
        if (d < bestD) { bestD = d; best = sp; }
      });
      if (!best || bestD > 3) return;
      to = best;
    }
    const then = pend.then;
    S.pending = null;
    then({ x: to.x, y: to.y });
  }

  /* Choosing a unit rather than a spot. */
  function askPick(list, label, hint, then) {
    if (!list.length) { then(null); return; }
    S.pending = { kind: 'pick', options: list.map(u => u.id), label: label,
                  hint: hint, then: then };
    emit();
  }

  function choosePick(id) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'pick') return;
    if (id !== null && pend.options.indexOf(id) < 0) return;
    const then = pend.then;
    S.pending = null;
    then(id === null ? null : unit(id));
  }

  /* Hand the table back to a player to choose where a reaction moves them.
     `inches` and `keep` are the exact rule; `spots` is only the shading. */
  function askMove(u, inches, keep, label, hint, then, whenNowhere) {
    /* Sampled finely: a reaction's legal ground is often a thin crescent and a
       coarse sample makes it look like three dots. Whatever samples it, it is
       the same MOVE_STEP that decided the reaction was on offer. */
    const sampled = spotsWithin(u, inches, keep, MOVE_STEP);
    /* Never post a question that cannot be answered. Belt to the braces above:
       if there is genuinely nowhere to put this model, say so and carry on
       rather than handing the players a prompt and no way out of it. */
    if (!sampled.spots.length) {
      log(u.name + ' has nowhere to go.', 'muted');
      (whenNowhere || then)();
      return;
    }
    S.pending = {
      kind: 'move', unitId: u.id, inches: inches, step: MOVE_STEP,
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
        const atk2 = pend.atk;
        S.pending = null;
        S.players[t2.owner].rp = 0;
        log(t2.name + ' reacts: ' + ab.name + '.', 'reaction');
        if (ab.text) log(ab.text, 'note');

        /* Two different cards redirect, and they do it differently.

           It's Your Job just names somebody who is ALREADY a legal target.
           Get In Front of Me moves a mate up to 3" first and only then asks
           whether he ended up in the line of fire — so the move happens, and
           the eligibility is judged after it, not before. */
        const redirect = (ab.effects || []).find(e => e.kind === 'redirect');
        if (redirect) {
          const shift = /move a friendly unit/i.test(ab.text || '');
          if (shift) {
            const reach = 3;
            const near = alive().filter(x => x.owner === t2.owner && x.id !== t2.id &&
                                             !isMarker(x) && rangeTo(t2, x) <= reach);
            if (!near.length) { log('No friendly unit within 3".', 'muted'); resolveAttack(atk2); return; }
            askPick(near, ab.name, 'Choose a friendly unit within 3" of ' + t2.name +
                    ' to move up to 3".', function (mate) {
              if (!mate) { resolveAttack(atk2); return; }
              const f = fieldFor(mate);
              askPut(mate, reach, mate.name.toUpperCase() + ' — MOVE UP TO 3"',
                     'Move them up to 3". If they end up in the line of fire, the attack ' +
                     'is against them instead.',
                     function (q) { return Board.canReach(f, q, reach); },
                     function (at) {
                       if (at) {
                         mate.facing = Math.atan2(at.y - mate.y, at.x - mate.x);
                         mate.x = at.x; mate.y = at.y;
                         mate.movedTurn = S.turn.number;
                       }
                       /* now, and only now, is he in the way? */
                       if (couldBeHit(atk2.attacker, mate, atk2)) {
                         log(mate.name + ' is in the line of fire — the attack is against ' +
                             'them instead.', 'reaction');
                         atk2.target = mate;
                       } else {
                         log(mate.name + ' does not end up in the line of fire.', 'muted');
                       }
                       resolveAttack(atk2);
                     });
            });
            return;
          }
          /* GET IN FRONT OF ME means exactly that: the unit has to be
             standing in the shot, not merely somewhere the attacker could
             also have shot at. It was offering anybody in range and line of
             sight, so a model twenty inches off to one side could "step in
             front of" a round it was nowhere near. */
          const inTheWay = function (x) {
            const a = atk2.attacker, t3 = t2;
            const dx = t3.x - a.x, dy = t3.y - a.y;
            const len2 = dx * dx + dy * dy;
            if (len2 < 1e-6) return false;
            /* how far along the shot it stands, and how far off the line */
            const s2 = ((x.x - a.x) * dx + (x.y - a.y) * dy) / len2;
            if (s2 <= 0.05 || s2 >= 1) return false;       /* behind, or past the target */
            const off = Math.abs((x.x - a.x) * dy - (x.y - a.y) * dx) / Math.sqrt(len2);
            return off <= x.radius + 1.2;                  /* within a step of the line */
          };
          const swaps = alive().filter(x => x.owner === t2.owner && x.id !== t2.id &&
                                            !isMarker(x) && inTheWay(x) &&
                                            couldBeHit(atk2.attacker, x, atk2));
          if (!swaps.length) { log('Nobody else can be put in the way.', 'muted'); resolveAttack(atk2); return; }
          S.pending = { kind: 'redirect', atk: atk2, ability: ab.name,
                        options: swaps.map(x => x.id) };
          emit();
          return;
        }

        /* "before their attack resolves" — this goes off first, and if it puts
           the attacker down their attack never happens */
        /* The reaction happens BEFORE the attack it is answering, and some of
           these stop and ask the player something — the grenade asks where it
           lands. runEffects returns straight away while that question is open,
           so the attack was resolving underneath it: the shot went in, and
           then the grenade you were still placing went off. The attack now
           waits until the reaction has actually finished. */
        const interrupts = (ab.effects || []).some(e => e.kind === 'attack');
        runEffects(t2, ab, { attackerUnit: atk2.attacker }, t2.owner, {
          noHandover: true,
          then: function () {
            if (interrupts && !atk2.attacker.alive) {
              log(atk2.attacker.name + ' is down before the shot — nothing comes of it.', 'reaction');
              afterAction(atk2.actor === undefined ? S.turn.player : atk2.actor, {});
              return;
            }
            resolveAttack(atk2);
          }
        });
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
        atk.missAt = { x: t.x, y: t.y };        /* where the shot was aimed */
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
        /* the ducked sight line, not the standing one it was testing before */
        if (!Board.canSeeDucked(S.board, atk.attacker, t)) {
          cancelAttack(atk, atk.attacker.name + ' has lost sight of ' + t.name);
          return;
        }
      }
      if (id === 'dive') {
        atk.missAt = { x: t.x, y: t.y };
        const a = atk.attacker;
        askMove(t, 3, function (p) {
          const d = Board.dist(a, p) - a.radius - t.radius;
          return !(Board.canSee(S.board, a, p) && d <= (atk.weapon.range || 0));
        }, 'DIVE — move 3"',
           'Only the ground that actually ends the attack is offered — out of ' +
           'sight of ' + a.name + ', or out of the ' + atk.weapon.name + '’s reach.',
           function () { cancelAttack(atk, t.name + ' dives clear'); },
           /* a dive with nowhere to land is not a dive: the shot goes in */
           function () { resolveAttack(atk); });
        return;
      }
      if (id === 'withdraw') atk.withdrawAfter = true;
    } else {
      S.players[t.owner].rp = 0;
      log(t.name + ' does not react.', 'muted');
    }
    resolveAttack(atk);
  }

  /* Could this attack legally be pointed at that unit instead? */
  function couldBeHit(a, x, atk) {
    const d = rangeTo(a, x) - a.radius - x.radius;
    if (atk.range === 'ranged') {
      return Board.canSee(S.board, a, x) && d <= (atk.weapon.range || 0);
    }
    return d <= (atk.weapon.range || 1);
  }

  /* The defender names who steps into it. */
  function chooseRedirect(id) {
    const pend = S.pending;
    if (!pend || pend.kind !== 'redirect') return;
    const atk = pend.atk;
    const to = unit(id);
    S.pending = null;
    if (!to || pend.options.indexOf(id) < 0) { resolveAttack(atk); return; }
    log(to.name + ' is put in the way — the attack is against them instead.', 'reaction');
    atk.target = to;
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
    /* The screen still has to show that a shot was fired and went wide, or a
       dodged attack looks exactly like the game ignoring the click. The strike
       carries `whiffed`, and the renderer puts the round into the ground where
       they had been standing. */
    const a = atk.attacker, t = atk.target;
    S.strikes.push({ at: S.seq++, attacker: a.id, target: t.id,
                     melee: atk.range === 'melee', weapon: atk.weapon && atk.weapon.name,
                     from: { x: a.x, y: a.y, z: Board.heightAt(S.board, a) },
                     to: { x: atk.missAt ? atk.missAt.x : t.x,
                           y: atk.missAt ? atk.missAt.y : t.y,
                           z: Board.heightAt(S.board, atk.missAt || t) },
                     hit: false, wound: false, damage: 0, killed: false,
                     whiffed: true, rolls: null });
    if (S.strikes.length > 12) S.strikes.shift();
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

  /* Anything a card does the moment its owner puts somebody down. */
  function onKill(a, t, weapon) {
    abilitiesOf(a).forEach(function (ab) {
      if (ab.trigger !== 'onkill') return;
      if (ab.weaponName && weapon && ab.weaponName !== weapon.name) return;
      /* Al's Kill Count only counts what he did with the Bayonet */
      if (/kill count/i.test(ab.name) && weapon && !/bayonet/i.test(weapon.name)) return;
      (ab.effects || []).forEach(function (e) {
        if (e.kind !== 'stat') return;
        a[e.stat] = (a[e.stat] || 0) + (Number(e.value) || 1);
        log(a.name + ': ' + ab.name + ' — ' + e.stat.toUpperCase() + ' is now ' +
            a[e.stat] + '.', 'note');
      });
    });
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

    const mods = attackMods(a, t, w, atk.range, {
      chargeHigh: atk.chargeHigh, fromCharge: atk.fromCharge, overwatch: atk.overwatch });
    if (mods.notes.length) log(mods.notes.join(' · ') + '.', 'note');

    const hitMod = mods.hit + (atk.hitMod || 0);
    const woundMod = mods.wound + (atk.woundMod || 0);
    const hitTarget = RULES.applyMod(Number(w.hit), hitMod).target;

    /* How many dice this weapon throws — the bowl shows them one at a time. */
    const shots = diceFor(a, w);
    if (shots.n > 1) log(shots.why + ': ' + shots.n + ' dice.', 'note');

    let hits = 0;
    const hitRolls = [];
    for (let i = 0; i < shots.n; i++) {
      const r = roll();
      hitRolls.push(r);
      if (r !== 1 && r >= hitTarget) hits++;
    }
    atk.rolls = { hit: hitRolls[0], hitTarget: hitTarget, hitRolls: hitRolls, shots: shots.n };
    log(a.name + ' rolls ' + hitRolls.join(', ') + ' against ' + hitTarget + '+ — ' +
        (hits ? hits + (shots.n > 1 ? ' hit' + (hits === 1 ? '' : 's') : ' — hits') : 'misses') + '.',
        hits ? 'hitline' : 'miss');

    if (!hits) { finish(atk, { hit: false }, done); return; }

    const wTarget = RULES.applyMod(
      RULES.woundTarget(Number(w.strength), t.toughness), woundMod).target;
    let wounds = 0;
    const woundRolls = [];
    for (let i = 0; i < hits; i++) {
      const r = roll();
      woundRolls.push(r);
      if (r !== 1 && r >= wTarget) wounds++;
    }
    atk.rolls.wound = woundRolls[0];
    atk.rolls.woundTarget = wTarget;
    atk.rolls.woundRolls = woundRolls;

    if (!wounds) {
      log('Wound rolls ' + woundRolls.join(', ') + ' against ' + wTarget + '+ — no wound.', 'miss');
      finish(atk, { hit: true }, done);
      return;
    }
    const per = weaponDamage(w) + mods.damage + (atk.damageMod || 0);
    const dmg = per * wounds;
    log('Wound rolls ' + woundRolls.join(', ') + ' against ' + wTarget + '+ — ' +
        (wounds > 1 ? wounds + ' wounds × ' + per + ' = ' : '') + dmg + ' damage.', 'damage');
    finish(atk, { hit: true, wound: true, damage: dmg }, done);
  }

  /* A weapon whose card says D3 or D6 rolls for it. */
  function weaponDamage(w) {
    const d = w.damage;
    if (typeof d === 'number') return d;
    const m = String(d || '1').match(/^D(\d)$/i);
    if (!m) return Number(d) || 1;
    const faces = Number(m[1]);
    const r = roll();
    const v = faces === 3 ? Math.ceil(r / 2) : r;
    announce(r, null, 'DAMAGE ' + d);
    log('Damage ' + d + ' — ' + v + '.', 'damage');
    return v;
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
      shots: atk.rolls ? atk.rolls.shots : 1,
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
        onKill(a, t, atk.weapon);
        checkVictory();
      }
    }
    S.strikes.push(strike);
    if (S.strikes.length > 12) S.strikes.shift();
    S.players[t.owner].rp = 0;

    if (atk.interrupt || atk.overwatch) { checkVictory(); if (done) done(); else emit(); return; }

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
      if (atk.withdrawAfter && spotsWithin(t, 3, null, MOVE_STEP).spots.length) {
        askMove(t, 3, null, 'WITHDRAW — move 3"',
                t.name + ' lived through it. Pull back anywhere within 3".',
                function () { log(t.name + ' pulls back.', 'reaction'); wrapUp(); },
                wrapUp);
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
      /* Nothing to pass on. If control has drifted off the player whose turn it
         is — which it should never do outside a chain — passing hands it back
         instead of doing nothing, so a stray bug costs a click rather than the
         game. */
      if (p !== S.turn.player) {
        S.control = { player: S.turn.player, forcedUnitId: null };
        log(S.players[p].name + ' passes — back to ' + S.players[S.turn.player].name + '.', 'action');
      } else {
        log(S.players[p].name + ' passes — no chain is running.', 'muted');
      }
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
    cardPowers, useCardPower, holderOf, attackMods, diceFor, blockedReactions,
    chooseReaction, chooseRedirect, toggleWatcher, fireOverwatch, endTurn, placeMove,
    placePut, choosePick, answerEndAbility, placeDeploy,
    mustPass, elevation, diveEscapes, spotsWithin, fieldFor, snapMove
  };
})();

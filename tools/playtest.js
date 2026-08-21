/* Play the whole game, over and over, and complain about anything that isn't
 * a game.
 *
 * The other tools check pieces: the maps against their cards, the abilities
 * clause by clause, two peers against each other, real clicks against real
 * pixels. None of them plays a match from deployment to a winner, and that is
 * exactly where the last two bugs lived — a faction power that quietly handed
 * the table to the opponent, and a PASS that then had no chain to pass on, so
 * neither player could ever act again. Both are invisible to a unit test and
 * obvious within thirty seconds of playing.
 *
 * So this one plays. It drives the same functions the screen drives, makes
 * legal choices at random, and after EVERY single decision it asks the
 * questions a player would ask out loud:
 *
 *   · can somebody do something?          (the deadlock check — the big one)
 *   · whose turn is it, and does control agree?
 *   · did that question have an answer?
 *   · is everybody still on the table, alive-or-dead, wounds in range?
 *   · did the score go backwards?
 *   · does the game ever actually end?
 *
 *   node tools/playtest.js [games] [--seed N] [--quiet]
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const GAMES = Number(ARGS.find(a => /^\d+$/.test(a))) || 40;
const QUIET = ARGS.indexOf('--quiet') >= 0;
const SEED0 = (() => { const i = ARGS.indexOf('--seed'); return i < 0 ? 1 : Number(ARGS[i + 1]); })();
const MISS_ARG = (() => { const i = ARGS.indexOf('--mission'); return i < 0 ? undefined : ARGS[i + 1]; })();

/* ------------------------------------------------------------ the engine */

function loadEngine() {
  const sandbox = { console: console, window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  ['../js/rules.js', '../js/state.js', 'js/maps.js', 'js/board.js', 'js/battle.js']
    .forEach(function (f) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'game', f), 'utf8'), sandbox,
                      { filename: f });
    });
  vm.runInContext('globalThis.__x = { Battle: Battle, Board: Board, MAPS: MAPS, ' +
                  'PRESETS: PRESETS, RULES: RULES };', sandbox);
  return sandbox.__x;
}

/* a repeatable little RNG, so a failing game can be replayed by its seed */
function rng(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, a) => a[Math.floor(rand() * a.length) % a.length];

/* --------------------------------------------------------- the complaints */

const FAULTS = [];
function fault(game, kind, detail) {
  if (FAULTS.some(f => f.kind === kind && f.detail === detail)) {
    FAULTS.find(f => f.kind === kind && f.detail === detail).seen++;
    return;
  }
  FAULTS.push({ kind: kind, detail: detail, game: game, seen: 1 });
}

/* Everything a player could notice changing. If a whole decision goes by and
   none of it moved, nothing happened — which, repeated, is a stuck game. */
function fingerprint(S) {
  return [
    S.turn.number, S.turn.player, S.control.player, S.control.forcedUnitId,
    S.chain.active ? 1 : 0, S.chain.passes,
    S.pending ? S.pending.kind : '-',
    S.players.map(p => p.ap + '/' + p.rp + '/' + p.vp).join(','),
    S.cards.map(c => c ? c.value : '-').join(','),
    /* S.log is capped at 300 entries, so its LENGTH stops changing in a long
       game — the last few lines are what actually moves. */
    S.log.length, S.seq, S.strikes.length, S.dice.length,
    S.log.slice(-3).map(l => l.text).join('~'),
    S.units.map(u => (u.alive ? 1 : 0) + ':' + u.wounds + ':' +
                     u.x.toFixed(2) + ':' + u.y.toFixed(2) + ':' +
                     (u.reserve ? 'R' : '-') + ':' + (u.marks || []).length).join('|'),
    S.tokens.length
  ].join(' # ');
}

/* ------------------------------------------------------- answering a question

   Every kind the engine can ask has to have an answer here. If it doesn't, the
   screen has nothing written for it either, and the game stops dead. */

const ANSWERS = {
  deploy: function (B, S, rand) {
    if (!S.pending.spots || !S.pending.spots.length) return 'deploy asked with no legal spot';
    B.placeDeploy(pick(rand, S.pending.spots));
  },
  put: function (B, S, rand) {
    if (!S.pending.spots || !S.pending.spots.length) return 'put asked with no legal spot';
    B.placePut(pick(rand, S.pending.spots));
  },
  pick: function (B, S, rand) {
    if (!S.pending.options || !S.pending.options.length) return 'pick asked with nothing to pick';
    B.choosePick(pick(rand, S.pending.options));
  },
  move: function (B, S, rand) {
    const p = S.pending;
    if (!p.spots || !p.spots.length) return 'a MOVE question was asked with nowhere to go';
    /* click the shaded ground, which is what the screen offers */
    B.placeMove(pick(rand, p.spots));
    if (S.pending === p) {
      /* it would not take a point it shaded itself */
      B.placeMove(p.spots[0]);
      if (S.pending === p) return 'a MOVE question refused the very ground it shaded';
    }
  },
  ability: function (B, S, rand) {
    const p = S.pending;
    if (p.need === 'spot') {
      if (!p.spots || !p.spots.length) return 'ability wants a spot but offers none';
      B.confirmAbility(pick(rand, p.spots));
    } else {
      const list = S.units.filter(u => u.alive && !u.marker);
      const want = p.need === 'foe'
        ? list.filter(u => u.owner !== B.unit(p.unitId).owner)
        : list.filter(u => u.owner === B.unit(p.unitId).owner);
      if (!want.length) return 'ability wants a ' + p.need + ' and there is none';
      B.confirmAbility(pick(rand, want).id);
    }
  },
  card: function (B, S, rand) {
    const me = S.pending.player;
    const mine = S.units.filter(u => u.alive && u.owner === me && !u.marker);
    if (!mine.length) {
      if (process.env.PT_DEBUG) {
        console.log('\n  --- nobody to choose ---');
        console.log('  pending  ', JSON.stringify({ kind: S.pending.kind, player: S.pending.player,
                                                    need: S.pending.need, name: S.pending.name }));
        console.log('  winner   ', S.winner, '| turn', JSON.stringify(S.turn));
        S.units.forEach(u => console.log('   ', u.name.padEnd(26), 'owner', u.owner,
          '| alive', u.alive, '| marker', !!u.marker, '| reserve', !!u.reserve,
          '| deployed', !!u.deployed, '| wounds', u.wounds));
        process.exit(9);
      }
      return 'a card power wants a friendly unit and there is none';
    }
    B.confirmAbility(pick(rand, mine).id);
  },
  /* Lay a Tactic Card face down, or decline — declining is a real choice, so
     the harness makes it sometimes. */
  tactic: function (B, S, rand) {
    const opts = S.pending.options || [];
    if (!opts.length) { B.chooseTactic(null); return; }
    B.chooseTactic(rand() < 0.15 ? null : Math.floor(rand() * opts.length) % opts.length);
  },
  endability: function (B, S, rand) { B.answerEndAbility(rand() < 0.5); },
  reaction: function (B, S, rand) {
    const ok = (S.pending.options || []).filter(o => o.ok);
    B.chooseReaction(ok.length && rand() < 0.7 ? pick(rand, ok).id : 'none');
  },
  redirect: function (B, S, rand) {
    const o = S.pending.options || [];
    B.chooseRedirect(o.length ? pick(rand, o) : null);
  },
  overwatch: function (B, S, rand) {
    (S.pending.watchers || []).forEach(function (w) { if (rand() < 0.6) B.toggleWatcher(w); });
    B.fireOverwatch();
  }
};

/* ------------------------------------------------------------ taking a turn */

/* A player who wanders at random never meets the enemy, and a game where the
   two sides never meet proves nothing. This one plays badly but plays to win:
   it shoots what it can see, hits what it can reach, walks towards the nearest
   enemy or the nearest objective, and grabs the mission piece when it is
   standing on it. */

const WEIGHT = { shoot: 8, fight: 9, charge: 6, secure: 12, relic: 12,
                 move: 5, overwatch: 1 };

function nearestFoe(S, u) {
  let best = null, bd = 1e9;
  S.units.forEach(function (x) {
    if (!x.alive || x.owner === u.owner || x.marker || x.reserve) return;
    const d = Math.hypot(x.x - u.x, x.y - u.y);
    if (d < bd) { bd = d; best = x; }
  });
  return best;
}

function goal(S, u) {
  const objs = (S.board.objectives || []).filter(o => isFinite(o.x));
  const foe = nearestFoe(S, u);
  if (objs.length && (!foe || Math.hypot(foe.x - u.x, foe.y - u.y) > 14)) {
    return objs.sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) -
                               Math.hypot(b.x - u.x, b.y - u.y))[0];
  }
  return foe;
}

function takeAnAction(B, S, rand) {
  const p = S.control.player;

  /* a power off the faction card, bought in the Start Phase */
  const powers = (B.cardPowers(p) || []).filter(x => x.ok);
  if (powers.length && rand() < 0.2) {
    const before = { chain: S.chain.active, ctrl: S.control.player, turn: S.turn.number };
    B.useCardPower(p, pick(rand, powers).index);
    /* the rule this broke: a card power is not an action. It opens no chain,
       and it does not pass the table across. */
    if (!S.pending) {
      if (S.chain.active && !before.chain) return 'spending on the faction card opened an action chain';
      if (S.control.player !== before.ctrl && S.turn.number === before.turn) {
        return 'spending on the faction card handed control to the opponent';
      }
    }
    return null;
  }

  /* everything the game says this player may do right now */
  const choices = [];
  S.units.forEach(function (u) {
    if (!u.alive || u.owner !== p || u.marker) return;
    (B.actionsFor(u.id) || []).forEach(function (a) {
      if (!a.ok) return;
      const w = a.id.indexOf('ability:') === 0 ? 7 : (WEIGHT[a.id] || 3);
      choices.push({ u: u, a: a, w: w * (0.4 + rand()) });
    });
  });
  choices.sort((x, y) => y.w - x.w);

  if (!choices.length) {
    if (S.chain.active || S.control.player !== S.turn.player) B.doPass(false);
    else B.endTurn();
    return null;
  }

  /* Try them best-first. An action the game offered as legal has to DO
     something — a button that costs a point and changes nothing on the table
     is the single most common way this game has broken. If every offer is a
     no-op, that is worth saying out loud rather than quietly ending the turn. */
  const before = fingerprint(S);
  const tried = [];
  for (let i = 0; i < choices.length; i++) {
    perform(B, S, rand, choices[i]);
    if (S.pending || fingerprint(S) !== before) return null;
    tried.push(choices[i].a.name || choices[i].a.id);
    if (tried.length >= 6) break;
  }
  const stillHere = fingerprint(S) === before;
  if (stillHere) {
    const who = choices.slice(0, tried.length).map(function (c) {
      return (c.a.name || c.a.id) + ' by ' + c.u.name +
             (c.u.reserve ? ' [IN RESERVE]' : '') +
             ' (cost ' + c.a.cost + ', AP ' + S.players[p].ap +
             (c.a.id === 'shoot' ? ', ' + B.rangedTargets(c.u.id).length + ' in sight' : '') +
             (c.a.id === 'fight' ? ', ' + B.meleeTargets(c.u.id).length + ' in reach' : '') +
             ', owner ' + c.u.owner + ' vs control ' + S.control.player +
             ', alive ' + c.u.alive + ', weapons ' +
             JSON.stringify((c.u.weapons || []).map(w => w.type + ':' + w.name + ':hit' + w.hit)) + ')';
    });
    return 'the game offered ' + tried.length + ' legal action(s) and every one did ' +
           'nothing — ' + who.join(' | ');
  }
  return null;
}

function perform(B, S, rand, c) {
  const id = c.u.id, act = c.a.id;
  if (act.indexOf('ability:') === 0) { B.useAbility(id, c.a.ability); return; }
  if (act === 'secure') { B.doSecure(id); return; }
  if (act === 'relic') { B.doRelic(id); return; }
  if (act === 'shoot' || act === 'fight' || act === 'charge') {
    /* these hand back IDs, not units — the screen works the same way */
    const ids = act === 'shoot' ? B.rangedTargets(id)
              : act === 'fight' ? B.meleeTargets(id) : B.chargeTargets(id);
    const t = ids.map(x => B.unit(x)).filter(Boolean);
    if (!t.length) return;
    const who = t.sort((a, b) => a.wounds - b.wounds)[0];   /* finish the wounded one */
    if (act === 'shoot') B.doShoot(id, who.id);
    else if (act === 'fight') B.doFight(id, who.id);
    else B.doCharge(id, who.id);
    return;
  }
  if (act === 'overwatch') {
    const g = goal(S, c.u);
    const a = g ? Math.atan2(g.y - c.u.y, g.x - c.u.x) : rand() * Math.PI * 2;
    B.doOverwatch(id, { x: c.u.x + Math.cos(a) * 6, y: c.u.y + Math.sin(a) * 6 });
    return;
  }
  if (act === 'move') {
    const f = B.moveField(id);
    /* a coarse sample: the screen shades at 0.4" because it has to look like a
       shape, but the harness only needs somewhere legal to stand */
    const spots = (B.spotsWithin(c.u, f.inches, null, 1.2) || {}).spots || [];
    if (!spots.length) return;
    const g = goal(S, c.u);
    const to = g
      ? spots.slice().sort((a, b) => Math.hypot(a.x - g.x, a.y - g.y) -
                                     Math.hypot(b.x - g.x, b.y - g.y))[0]
      : pick(rand, spots);
    B.doMove(id, to);
  }
}

/* ------------------------------------------------------------- the checking */

function inspect(B, S, g, ctx) {
  /* whose game is it */
  if (S.control.player !== 0 && S.control.player !== 1) {
    fault(g, 'control belongs to nobody', String(S.control.player));
  }
  if (!S.pending && !S.chain.active && S.winner === null &&
      S.control.player !== S.turn.player && !ctx.deploying) {
    fault(g, 'outside a chain, control is not with the player whose turn it is',
          'turn ' + S.turn.number + ' belongs to P' + S.turn.player +
          ' but P' + S.control.player + ' holds the table — after: ' +
          S.log.slice(-4).map(l => l.text).join('  //  '));
  }
  /* a question nobody wrote an answer for */
  if (S.pending && !ANSWERS[S.pending.kind]) {
    fault(g, 'the engine asks a question the game cannot answer', S.pending.kind);
  }
  /* the models */
  S.units.forEach(function (u) {
    if (u.marker) return;
    if (u.wounds < 0 || u.wounds > u.maxWounds) {
      fault(g, 'wounds out of range', u.name + ' at ' + u.wounds + '/' + u.maxWounds);
    }
    if (u.alive && u.wounds <= 0) fault(g, 'a unit is alive on zero wounds', u.name);
    if (!u.alive && u.wounds > 0) fault(g, 'a unit is dead with wounds left', u.name);
    if (u.deployed && !u.reserve && u.alive) {
      if (!isFinite(u.x) || !isFinite(u.y)) fault(g, 'a unit has no position', u.name);
      else if (u.x < -1 || u.y < -1 || u.x > S.board.w + 1 || u.y > S.board.h + 1) {
        fault(g, 'a unit is off the table', u.name + ' at ' +
              u.x.toFixed(1) + ',' + u.y.toFixed(1));
      }
    }
  });
  /* the score */
  S.players.forEach(function (p, i) {
    if (p.vp < ctx.vp[i]) fault(g, 'victory points went backwards', S.players[i].name);
    if (p.vp > 30) fault(g, 'victory points ran away', String(p.vp));
    if (p.ap < 0) fault(g, 'action points went negative', String(p.ap));
    ctx.vp[i] = p.vp;
  });
  if (S.turn.number < ctx.turn) fault(g, 'the turn counter went backwards', String(S.turn.number));
  ctx.turn = S.turn.number;
}

/* --------------------------------------------------------------- one match */

function playOne(g, seed, missionId, factions) {
  const X = loadEngine();
  const B = X.Battle;
  const rand = rng(seed);
  let S;
  try {
    B.start({ factions: factions, names: ['ALPHA', 'BETA'], seed: seed, missionId: missionId });
    S = B.get();
  } catch (e) {
    fault(g, 'the game would not start', e.message);
    return { steps: 0, ok: false };
  }

  const ctx = { vp: [0, 0], turn: 0, deploying: true };
  let steps = 0, stuck = 0, last = fingerprint(S);
  const MAX = 1500;

  while (S.winner === null && steps < MAX) {
    steps++;
    ctx.deploying = !!(S.pending && S.pending.kind === 'deploy') || !!(S.setupAsks || []).length;
    let complaint = null;
    try {
      if (S.pending) {
        const kind = S.pending.kind;
        const fn = ANSWERS[kind];
        if (!fn) { fault(g, 'no way to answer a “' + kind + '” question', kind); return { steps: steps, ok: false }; }
        complaint = fn(B, S, rand);
      } else {
        complaint = takeAnAction(B, S, rand);
      }
    } catch (e) {
      fault(g, 'the game threw while being played', e.message + ' @ ' +
            String(e.stack || '').split('\n')[1].trim());
      return { steps: steps, ok: false };
    }
    if (complaint) fault(g, complaint, 'turn ' + S.turn.number + ', seed ' + seed);

    if (process.env.PT_TRACE) {
      console.log('    ' + String(steps).padStart(4) + '  t' + S.turn.number +
        ' P' + S.turn.player + ' ctrl' + S.control.player +
        ' chain' + (S.chain.active ? '+' : '-') +
        ' ap' + S.players.map(x => x.ap).join('/') +
        ' pend=' + (S.pending ? S.pending.kind : '-') +
        '  | ' + (S.log.length ? S.log[S.log.length - 1].text.slice(0, 70) : ''));
    }
    inspect(B, S, g, ctx);

    const now = fingerprint(S);
    if (now === last) {
      stuck++;
      if (stuck >= 6) {
        fault(g, 'THE GAME IS STUCK — six decisions in a row changed nothing',
              'turn ' + S.turn.number + ' (P' + S.turn.player + '), control P' +
              S.control.player + ', chain ' + (S.chain.active ? 'open' : 'closed') +
              ', waiting on ' + (S.pending ? S.pending.kind : 'nothing') +
              ', AP ' + S.players.map(p => p.ap).join('/') + ', seed ' + seed);
        return { steps: steps, ok: false };
      }
    } else { stuck = 0; last = now; }
  }

  if (S.winner === null) {
    fault(g, 'the game never ended', steps + ' decisions and still no winner, seed ' + seed);
    return { steps: steps, ok: false };
  }
  return { steps: steps, ok: true, turns: S.turn.number, winner: S.winner,
           vp: S.players.map(p => p.vp),
           dead: S.units.filter(u => !u.alive && !u.marker).length };
}

/* ------------------------------------------------------------------- go on */

const X0 = loadEngine();
const MISSIONS = [null].concat((X0.RULES.missions || []).map(m => m.id));
const SIDES = X0.PRESETS.map(f => f.id);

console.log('Playing ' + GAMES + ' full games — deployment to a winner, ' +
            'checking after every decision.\n');

let played = 0, finished = 0, turns = 0, dead = 0, steps = 0;
const wins = [0, 0];
for (let g = 0; g < GAMES; g++) {
  const seed = SEED0 + g * 7919;
  const r = rng(seed ^ 0x5f3759df);
  const mission = MISS_ARG === undefined ? MISSIONS[g % MISSIONS.length]
               : (MISS_ARG === 'none' ? null : MISS_ARG);
  const a = SIDES[Math.floor(r() * SIDES.length) % SIDES.length];
  let b = SIDES[Math.floor(r() * SIDES.length) % SIDES.length];
  if (b === a) b = SIDES[(SIDES.indexOf(a) + 1) % SIDES.length];

  const out = playOne(g, seed, mission, [a, b]);
  played++;
  steps += out.steps;
  if (out.ok) {
    finished++; turns += out.turns; dead += out.dead; wins[out.winner]++;
    if (!QUIET) {
      console.log('  ' + String(g + 1).padStart(3) + '  ' +
                  (mission || 'no card').padEnd(14) + a.padEnd(12) + 'v ' + b.padEnd(12) +
                  out.turns + ' turns, ' + out.dead + ' down, ' +
                  out.vp.join('–') + ' VP');
    }
  } else if (!QUIET) {
    console.log('  ' + String(g + 1).padStart(3) + '  ' + (mission || 'no card').padEnd(14) +
                a.padEnd(12) + 'v ' + b.padEnd(12) + 'BROKE after ' + out.steps + ' decisions');
  }
}

console.log('\n' + finished + '/' + played + ' games played to a winner  ·  ' +
            steps + ' decisions  ·  ' +
            (finished ? (turns / finished).toFixed(1) + ' turns and ' +
                        (dead / finished).toFixed(1) + ' models down per game  ·  ' +
                        wins[0] + '–' + wins[1] + ' by side' : ''));

if (!FAULTS.length) {
  console.log('\nNothing to report. It plays.');
  process.exit(0);
}
console.log('\n' + FAULTS.length + ' thing(s) wrong:\n');
FAULTS.sort((a, b) => b.seen - a.seen).forEach(function (f) {
  console.log('  ✗ ' + f.kind);
  console.log('      ' + f.detail);
  if (f.seen > 1) console.log('      (' + f.seen + ' times)');
});
process.exit(1);

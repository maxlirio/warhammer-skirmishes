/* =========================================================================
   THE SCREEN
   Menu, then the table. One player at a time has control — the HUD says who,
   and nothing else answers to a click until they are done.

   Everything the player points at is a place on the table in inches, picked
   off the 3D scene, so a move is measured with a tape and not counted out in
   squares.
   ========================================================================= */

const GameUI = (function () {

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const inches = n => n.toFixed(1) + '"';

  let mode = null;          // what the player is in the middle of choosing
  let selected = null;
  let hover = null;         // {x, y} on the table
  let hoverPx = { x: 0, y: 0 };
  let cfg = { missionId: undefined,
              factions: ['astra', 'orks'], names: ['Player One', 'Player Two'] };
  let started = false;

  /* --------------------------------------------------------------- the menu */

  function showMenu() {
    $('menu').hidden = false;
    $('battle').hidden = true;
    $('victory').hidden = true;

    [0, 1].forEach(function (p) {
      const box = $('faction' + p);
      box.innerHTML = '';
      PRESETS.forEach(function (f) {
        const b = el('button', 'fbtn', f.name);
        if (cfg.factions[p] === f.id) b.classList.add('on');
        b.onclick = () => { cfg.factions[p] = f.id; showMenu(); };
        box.appendChild(b);
      });
      const roster = $('roster' + p);
      roster.innerHTML = '';
      PRESETS.find(x => x.id === cfg.factions[p]).units.forEach(u => roster.appendChild(
        el('li', null, u.name + '  ·  M' + u.move + '"  W' + u.maxWounds + '  T' + u.toughness +
                       (u.oc ? '  OC' + u.oc : ''))));
    });

    const miss = $('missionPick');
    miss.innerHTML = '';
    [{ id: null, name: 'NO CARD', flavour: '“Just fight.”',
       objective: ['Hold objectives at the end of your turn, first to 10 VP.'] }]
      .concat(RULES.missions).forEach(function (m) {
        const card = el('button', 'misscard');
        card.appendChild(el('span', 'missname', m.name));
        card.appendChild(el('span', 'missflav', m.flavour || ''));
        const ul = el('ul', 'missobj');
        (m.objective || []).forEach(t => ul.appendChild(el('li', null, t)));
        card.appendChild(ul);
        /* the table this card is played on comes with it */
        const map = MAPS.forMission(m.id);
        const strip = el('div', 'missmap');
        strip.appendChild(el('span', 'missmapname', map.name));
        strip.appendChild(el('span', 'missmapsize',
          map.w + '" × ' + map.h + '"  ·  ' +
          (map.objectives.length ? map.objectives.length + ' markers' : 'no markers')));
        card.appendChild(strip);
        card.appendChild(thumb(map));
        if (m.endsShort) card.appendChild(el('span', 'missends', m.endsShort));
        if (cfg.missionId === m.id) card.classList.add('on');
        card.onclick = () => { cfg.missionId = m.id; showMenu(); };
        miss.appendChild(card);
      });

    drawNet();
    $('startBtn').disabled = cfg.missionId === undefined || netMode !== 'local';
    $('startBtn').textContent = cfg.missionId === undefined ? 'CHOOSE A MISSION CARD'
      : netMode === 'local' ? 'DEPLOY' : 'WAITING FOR THE ROOM';
  }

  /* ------------------------------------------------------- playing somebody */

  let netMode = 'local';

  function drawNet() {
    ['netLocal', 'netHost', 'netJoin'].forEach(function (id, i) {
      $(id).classList.toggle('on', netMode === ['local', 'host', 'join'][i]);
    });
    const panel = $('netPanel');
    if (netMode === 'local') { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = '';

    if (netMode === 'host') {
      const st = Net.status();
      if (st === 'offline') {
        panel.appendChild(el('p', 'nhint',
          'You pick the battlefield and both forces, then read the code out to ' +
          'your opponent. The dice are seeded from here so you both see the ' +
          'same rolls.'));
        const go = el('button', 'netgo', 'OPEN THE ROOM');
        go.disabled = cfg.missionId === undefined;
        go.onclick = function () {
          Net.host(cfg, function (dealt, seat) { cfg = dealt; startNet(seat); });
          drawNet();
        };
        panel.appendChild(go);
      } else if (/error/.test(st)) {
        panel.appendChild(el('p', 'nerr', 'Could not open the room: ' + st.slice(6) +
          '. Check you are online.'));
      } else {
        panel.appendChild(el('div', 'ncode', Net.code() || '····'));
        panel.appendChild(el('p', 'nhint', st === 'waiting'
          ? 'Read that out. The game starts the moment they join.'
          : 'Opening the room…'));
      }
      return;
    }

    const st = Net.status();
    if (st === 'offline' || /error/.test(st)) {
      panel.appendChild(el('p', 'nhint',
        'Type the code your opponent read out. Their choice of battlefield and ' +
        'forces is the one you will play — yours above is ignored.'));
      const row = el('div', 'nrow');
      const inp = el('input', 'ncodein');
      inp.maxLength = 4;
      inp.placeholder = 'CODE';
      inp.autocapitalize = 'characters';
      inp.oninput = () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
      const go = el('button', 'netgo', 'JOIN');
      go.onclick = function () {
        if (inp.value.length < 4) return;
        Net.join(inp.value, function (dealt, seat) { cfg = dealt; startNet(seat); });
        drawNet();
      };
      row.appendChild(inp); row.appendChild(go);
      panel.appendChild(row);
      if (/error/.test(st)) {
        panel.appendChild(el('p', 'nerr', 'No room answered on that code (' +
          st.slice(6) + '). Check the code and that you are online.'));
      }
    } else {
      panel.appendChild(el('p', 'nhint', 'Connecting to ' + Net.code() + '…'));
    }
  }

  function startNet(seat) {
    const names = cfg.names.slice();
    names[seat] = names[seat] + ' (you)';
    cfg = Object.assign({}, cfg, { names: names });
    begin();
  }

  /* A plan of the table, drawn from the same boxes the game measures. */
  function thumb(m) {
    const c = el('canvas', 'thumb');
    const s = 5;
    c.width = m.w * s; c.height = m.h * s;
    const g = c.getContext('2d');
    g.fillStyle = '#26221b';
    g.fillRect(0, 0, c.width, c.height);
    m.deploy.forEach(function (z, i) {
      g.fillStyle = i === 0 ? 'rgba(47,74,99,.75)' : 'rgba(90,43,36,.75)';
      g.fillRect(z.x * s, z.y * s, z.w * s, z.h * s);
    });
    m.terrain.forEach(function (t) {
      g.fillStyle = t.blocks ? '#0b0a09' : '#5d4c37';
      g.fillRect(t.x * s, t.y * s, t.w * s, t.h * s);
    });
    m.objectives.forEach(function (o) {
      g.strokeStyle = '#b8912f'; g.lineWidth = 2;
      g.beginPath(); g.arc(o.x * s, o.y * s, 3 * s * 0.5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#b8912f';
      g.beginPath(); g.arc(o.x * s, o.y * s, 2.4, 0, Math.PI * 2); g.fill();
    });
    return c;
  }

  /* ------------------------------------------------------------- the battle */

  function begin() {
    $('menu').hidden = true;
    $('battle').hidden = false;
    $('loading').hidden = false;
    Sfx.wake();
    Render3D.attach($('board'));
    resize();
    /* The scenery has to be on the table before anybody is deployed onto it. */
    Assets.load('assets/kit/', function (done, total, name) {
      $('loadfill').style.width = Math.round(done / total * 100) + '%';
      $('loadwhat').textContent = name.replace(/_/g, ' ');
    }).then(function () {
      $('loading').hidden = true;
      Battle.on(render);
      Battle.start(cfg);
      started = true;
      window.addEventListener('resize', resize);
      resize();
      Sfx.chime(420, 0.16);
      if (window.Net) Net.onStart(cfg);
    });
  }

  function resize() { Render3D.resize(); }

  /* ---------------------------------------------------- what the table shows */

  function view(S) {
    const v = {};
    const pend = S.pending;

    /* Putting a model down at the start of the game. */
    if (pend && pend.kind === 'deploy') {
      v.area = pend.spots;
      v.areaColour = pend.owner === 0 ? Render3D.COL.p0 : Render3D.COL.p1;
      v.areaOpacity = 0.4;
      v.areaCell = 0.6;
      const land = hover ? Render3D.pickNearest(hoverPx.x, hoverPx.y, pend.spots, 70) : null;
      if (land) v.marks = [{ x: land.x, y: land.y, r: 0.9, colour: Render3D.COL.goldLit }];
      return v;
    }

    /* Placing something the card told you to place. */
    if (pend && pend.kind === 'put') {
      const u = Battle.unit(pend.unitId);
      v.focus = u;
      v.area = pend.spots;
      v.areaColour = Render3D.COL.goldLit;
      v.areaOpacity = 0.5;
      v.areaCell = 0.5;
      v.areaGlow = true;
      const land = hover ? Render3D.pickNearest(hoverPx.x, hoverPx.y, pend.spots, 60) : null;
      if (land) {
        v.tape = tape(u, land, Battle.rangeTo(u, land));
        v.marks = [{ x: land.x, y: land.y, r: 1.0, colour: Render3D.COL.goldLit }];
      }
      return v;
    }

    /* An ability waiting to be pointed at somebody. */
    if (pend && pend.kind === 'pick') {
      v.marks = pend.options.map(function (id) {
        const x = Battle.unit(id);
        return { x: x.x, y: x.y, r: x.radius + 0.5, colour: Render3D.COL.watch };
      });
      return v;
    }

    /* An ability waiting to be pointed at somewhere or somebody. */
    if (pend && pend.kind === 'ability') {
      const u = Battle.unit(pend.unitId);
      v.focus = u;
      if (pend.need === 'spot') {
        if (!pend.spots) pend.spots = Battle.arrivalSpots(pend.unitId);
        v.area = pend.spots;
        v.areaColour = Render3D.COL.goldLit;
        v.areaOpacity = 0.34;
        v.areaCell = 0.7;
      } else {
        v.marks = Battle.alive()
          .filter(x => pend.need === 'friend' ? x.owner === u.owner : x.owner !== u.owner)
          .map(x => ({ x: x.x, y: x.y, r: x.radius + 0.5, colour: Render3D.COL.watch }));
      }
      return v;
    }

    /* A reaction that moves you: the table is waiting for a destination. */
    if (pend && pend.kind === 'move') {
      v.area = pend.spots;
      v.areaColour = Render3D.COL.goldLit;
      v.areaOpacity = 0.5;
      v.areaCell = pend.step || 0.22;
      v.areaGlow = true;
      const u = Battle.unit(pend.unitId);
      v.focus = u;
      v.climbs = pend.climbs || [];
      const land = hover
        ? (Battle.snapMove(pend, hover) || Render3D.pickNearest(hoverPx.x, hoverPx.y, pend.spots))
        : null;
      if (land) {
        v.tape = tape(u, land, Board.costTo(pend.field, land));
        v.marks = [{ x: land.x, y: land.y, r: u.radius + 0.35,
                     colour: Render3D.COL.goldLit }];
      }
      return v;
    }
    if (!mode) return v;
    const u = Battle.unit(mode.unitId);
    if (!u) return v;
    v.focus = u;

    if (mode.kind === 'move') {
      v.area = mode.spots;
      v.areaColour = Render3D.COL.move;
      v.areaOpacity = 0.62;
      v.areaCell = 0.4;
      v.climbs = mode.climbs;
      if (hover) {
        if (Board.canReach(mode.field, hover, mode.inches)) {
          v.tape = tape(u, hover, Board.costTo(mode.field, hover));
        } else {
          const c = Board.climbFor(mode.field, mode.inches, hover);
          if (c) {
            v.tape = tape(u, c, c.cost, '#e8c65c');
            v.marks = [{ x: c.x, y: c.y, r: u.radius + 0.4, colour: Render3D.COL.goldLit }];
          }
        }
      }
    } else if (mode.kind === 'shoot') {
      v.area = mode.sight;
      v.areaColour = Render3D.COL.sight;
      v.areaOpacity = 0.5;
      v.areaCell = 0.5;
      v.marks = mode.targets.map(id => mark(Battle.unit(id)));
      const t = hoveredTarget(S);
      if (t) v.tape = tape(u, t, Battle.rangeTo(u, t), '#e8c65c');
    } else if (mode.kind === 'fight' || mode.kind === 'charge') {
      v.marks = mode.targets.map(id => mark(Battle.unit(id)));
      if (mode.kind === 'charge') v.ring = { x: u.x, y: u.y, r: 6 };
      const t = hoveredTarget(S);
      if (t) v.tape = tape(u, t, Battle.rangeTo(u, t), '#e8c65c');
    } else if (mode.kind === 'overwatch') {
      v.area = mode.spots;
      v.areaColour = Render3D.COL.watch;
      v.areaOpacity = 0.45;
      v.areaCell = 0.6;
      if (hover && Battle.rangeTo(u, hover) <= 12) {
        v.ring = { x: hover.x, y: hover.y, r: 3 };
        v.ringColour = Render3D.COL.watch;
        v.tape = tape(u, hover, Battle.rangeTo(u, hover));
      }
    }
    return v;
  }

  function tape(from, to, len, colour) {
    const S = Battle.get();
    return {
      from: { x: from.x, y: Board.heightAt(S.board, from), z: from.y },
      to: { x: to.x, y: Board.heightAt(S.board, to), z: to.y },
      label: inches(len), colour: colour
    };
  }

  const mark = u => ({ x: u.x, y: u.y, r: u.radius + 0.55, colour: Render3D.COL.watch });

  function hoveredTarget(S) {
    if (!hover || !mode || !mode.targets) return null;
    let best = null, bestD = 1.4;
    mode.targets.forEach(function (id) {
      const t = Battle.unit(id);
      const d = Math.hypot(t.x - hover.x, t.y - hover.y);
      if (d < bestD) { bestD = d; best = t; }
    });
    return best;
  }

  let leaning = false;
  let deployingFor = null;

  function render(S) {
    if (S.winner !== null) { showVictory(S); return; }
    /* Come in close while somebody is placing a model, then pull back out. */
    const placing = S.pending && (S.pending.kind === 'move' || S.pending.kind === 'put');
    if (placing && !leaning) {
      leaning = true;
      Render3D.leanIn(Battle.unit(S.pending.unitId),
                      S.pending.kind === 'put' ? Math.max(22, S.pending.radius * 3.2) : 22);
    } else if (!placing && leaning) {
      leaning = false;
      Render3D.leanOut();
    }
    Render3D.draw(S, Object.assign(view(S), { selected: selected }));

    /* Deployment is watched from the end of the table whose go it is — after
       the table exists, not before it. */
    if (S.pending && S.pending.kind === 'deploy') {
      if (deployingFor !== S.pending.owner) {
        deployingFor = S.pending.owner;
        Render3D.viewFrom(S.pending.owner);
      }
    } else { deployingFor = null; }
    drawHUD(S);
    drawPending(S);
    if (window.Net) Net.onState(S);
  }

  /* ------------------------------------------------------------------ HUD */

  function drawHUD(S) {
    const ctrl = S.control.player;
    document.body.dataset.control = ctrl;

    $('turnline').textContent = 'TURN ' + S.turn.number + ' · ' + S.players[S.turn.player].name;
    $('missionline').textContent = S.mission ? S.mission.name : 'NO CARD';
    $('chainline').textContent = S.chain.active ? 'ACTION CHAIN RUNNING' : 'no chain';
    $('chainline').className = 'chainline' + (S.chain.active ? ' on' : '');

    [0, 1].forEach(function (p) {
      const pl = S.players[p];
      $('pname' + p).textContent = pl.name;
      $('pap' + p).textContent = pl.ap;
      /* some cards are not won on points at all */
      $('pvp' + p).textContent = pl.vp + (S.vpTarget ? '/' + S.vpTarget : '');
      $('pbox' + p).classList.toggle('acting', p === ctrl);
      const list = $('plist' + p);
      list.innerHTML = '';
      S.units.filter(u => u.owner === p).forEach(function (u) {
        const row = el('button', 'urow' + (u.alive ? '' : ' dead') +
                                (selected === u.id ? ' sel' : ''));
        row.appendChild(el('span', 'uname', u.name));
        const pips = el('span', 'pips');
        for (let i = 0; i < u.maxWounds; i++) pips.appendChild(el('i', i < u.wounds ? 'pip on' : 'pip'));
        row.appendChild(pips);
        if (u.reserve) row.appendChild(el('span', 'tag res', 'RESERVE'));
        if (u.marker) row.appendChild(el('span', 'tag', 'MARKER'));
        if (u.carryingRelic) row.appendChild(el('span', 'tag kills', 'RELIC'));
        if (u.overwatch) row.appendChild(el('span', 'tag', 'OW'));
        if (u.kills) row.appendChild(el('span', 'tag kills', '☠' + u.kills));
        row.onclick = () => { if (u.alive && !u.reserve) { select(u.id); Render3D.leanIn(u, 26); }
                              else if (u.alive) select(u.id); };
        list.appendChild(row);
      });
    });

    drawActions(S);
    drawLog(S);
  }

  function myTurnBlocked(S) {
    return window.Net && Net.active() && Net.seat() !== S.control.player;
  }

  function drawActions(S) {
    const bar = $('actions');
    bar.innerHTML = '';
    const ctrl = S.control.player;

    /* Whatever the game is waiting on, say so plainly. Every kind of pending
       question needs its own line here — the fallback at the bottom is a bug
       report, not a prompt. */
    const pend = S.pending;

    if (pend && pend.kind === 'move') {
      bar.appendChild(el('div', 'ahead2', pend.label));
      bar.appendChild(el('div', 'prompt', pend.hint));
      bar.appendChild(el('div', 'prompt warn', 'Click the table to place ' +
        Battle.unit(pend.unitId).name + '.'));
      return;
    }
    if (pend && pend.kind === 'deploy') {
      bar.appendChild(el('div', 'ahead2', pend.label));
      bar.appendChild(el('div', 'prompt', pend.hint));
      bar.appendChild(el('div', 'prompt warn',
        'Click your deployment zone. ' + pend.left + ' still to put down.'));
      return;
    }
    if (pend && pend.kind === 'put') {
      bar.appendChild(el('div', 'ahead2', pend.label));
      bar.appendChild(el('div', 'prompt', pend.hint));
      bar.appendChild(el('div', 'prompt warn', 'Click the table to place it.'));
      return;
    }
    if (pend && pend.kind === 'pick') {
      bar.appendChild(el('div', 'ahead2', pend.label));
      bar.appendChild(el('div', 'prompt', pend.hint));
      bar.appendChild(el('div', 'prompt warn', 'Click the model you mean.'));
      const skip = el('div', 'afoot');
      const none = el('button', 'pass', 'NONE OF THEM');
      none.onclick = () => act(() => Battle.choosePick(null), { t: 'pick', id: null });
      skip.appendChild(none);
      bar.appendChild(skip);
      return;
    }
    if (pend && (pend.kind === 'ability' || pend.kind === 'card')) {
      bar.appendChild(el('div', 'ahead2', pend.name));
      if (pend.text) bar.appendChild(el('div', 'prompt', pend.text));
      bar.appendChild(el('div', 'prompt warn',
        pend.need === 'spot' ? 'Click the table to place ' + Battle.unit(pend.unitId).name + '.'
        : pend.need === 'friend' ? 'Click one of your own models.'
        : 'Click an enemy model.'));
      return;
    }
    if (pend && pend.kind === 'endability') {
      bar.appendChild(el('div', 'ahead2', 'END PHASE — ' + pend.name));
      bar.appendChild(el('div', 'prompt', pend.text));
      const row = el('div', 'afoot');
      const yes = el('button', 'endturn', 'USE IT');
      yes.onclick = () => act(() => Battle.answerEndAbility(true), { t: 'endab', v: 1 });
      const no = el('button', 'pass', 'SKIP');
      no.onclick = () => act(() => Battle.answerEndAbility(false), { t: 'endab', v: 0 });
      row.appendChild(yes); row.appendChild(no);
      bar.appendChild(row);
      return;
    }
    if (Render3D.busy() && !pend) {
      bar.appendChild(el('div', 'prompt resolving', 'the shot is still in the air…'));
      return;
    }
    if (pend && pend.kind === 'redirect') {
      bar.appendChild(el('div', 'prompt', 'choosing who steps into it…'));
      return;
    }
    if (pend && pend.kind === 'reaction') {
      bar.appendChild(el('div', 'prompt', 'waiting on the reaction…'));
      return;
    }
    if (pend && pend.kind === 'overwatch') {
      bar.appendChild(el('div', 'prompt', 'waiting on the overwatch…'));
      return;
    }
    if (pend) {
      bar.appendChild(el('div', 'prompt warn',
        'waiting on “' + pend.kind + '”, which has no prompt written for it'));
      return;
    }

    const head = el('div', 'ahead');
    head.appendChild(el('span', 'who', S.players[ctrl].name + ' to act'));
    if (S.control.forcedUnitId) {
      head.appendChild(el('span', 'forced',
        'the chain is on ' + Battle.unit(S.control.forcedUnitId).name));
    }
    bar.appendChild(head);

    if (myTurnBlocked(S)) {
      bar.appendChild(el('div', 'prompt warn', 'Waiting for your opponent.'));
      return;
    }

    const u = selected ? Battle.unit(selected) : null;
    if (!u || !u.alive) {
      bar.appendChild(el('div', 'prompt', 'click one of your models on the table'));
    } else if (u.owner !== ctrl) {
      bar.appendChild(el('div', 'prompt', 'not yours to move right now'));
    } else {
      bar.appendChild(unitCard(u, S));
      drawCard(bar, S, ctrl);
      const acts = Battle.actionsFor(u.id);
      const row = el('div', 'abtns');
      acts.filter(a => a.ability === undefined).forEach(function (a) {
        const def = RULES.actionById(a.id);
        const b = el('button', 'abtn' + (a.ok ? '' : ' off') +
                               (mode && mode.kind === a.id && mode.unitId === u.id ? ' on' : ''));
        b.appendChild(el('span', 'an', def ? def.name : a.id.toUpperCase()));
        b.appendChild(el('span', 'ac', a.cost + ' AP'));
        b.title = a.why || (def ? def.short || def.text : '');
        if (a.why) b.appendChild(el('span', 'awhy', a.why));
        b.disabled = !a.ok;
        b.onclick = () => enter(a.id, u.id);
        row.appendChild(b);
      });
      bar.appendChild(row);

      /* the unit's own card */
      const abils = acts.filter(a => a.ability !== undefined);
      if (abils.length) {
        bar.appendChild(el('div', 'asub', 'SPECIAL ABILITIES'));
        const arow = el('div', 'abtns one');
        abils.forEach(function (a) {
          const b = el('button', 'abtn ability' + (a.ok ? '' : ' off'));
          b.appendChild(el('span', 'an', a.name));
          b.appendChild(el('span', 'ac', a.cost + ' AP'));
          if (a.text) b.appendChild(el('span', 'atext', a.text));
          if (a.why) b.appendChild(el('span', 'awhy', a.why));
          b.disabled = !a.ok;
          b.onclick = () => act(() => Battle.useAbility(u.id, a.ability),
                               { t: 'ability', id: u.id, i: a.ability });
          arow.appendChild(b);
        });
        bar.appendChild(arow);
      }
      /* and what it can do without spending anything */
      const passives = (u.abilities || []).filter(x => x.trigger === 'passive' || x.trigger === 'rp');
      if (passives.length) {
        const p = el('div', 'apassive');
        passives.forEach(x => p.appendChild(el('div', 'pchip',
          (x.trigger === 'rp' ? '↩ ' : '● ') + x.name)));
        bar.appendChild(p);
      }
    }

    const foot = el('div', 'afoot');
    const pass = el('button', 'pass', 'PASS');
    pass.onclick = () => { mode = null; act(() => Battle.doPass(false), { t: 'pass' }); };
    foot.appendChild(pass);
    if (ctrl === S.turn.player) {
      const end = el('button', 'endturn', 'END TURN');
      end.onclick = () => { mode = null; selected = null; act(() => Battle.endTurn(), { t: 'endturn' }); };
      foot.appendChild(end);
    }
    if (mode) {
      const cancel = el('button', 'cancel', 'CANCEL');
      cancel.onclick = () => { mode = null; render(Battle.get()); };
      foot.appendChild(cancel);
    }
    bar.appendChild(foot);

    if (Battle.mustPass() && !mode) {
      bar.appendChild(el('div', 'prompt warn', 'no AP left — you must pass'));
    }
  }

  /* The faction card, and what its pool will buy right now. */
  function drawCard(bar, S, p) {
    const card = S.cards[p];
    if (!card) return;
    const box = el('div', 'faccard');
    const head = el('div', 'facthead');
    head.appendChild(el('span', 'factname', card.name));
    head.appendChild(el('span', 'factpool', card.value + ' ' + card.resource.name));
    box.appendChild(head);
    Battle.cardPowers(p).forEach(function (a) {
      const b = el('button', 'factpow' + (a.ok ? '' : ' off'));
      b.appendChild(el('span', 'pn', a.cost + ' ' + card.resource.name + ' — ' + a.name));
      b.appendChild(el('span', 'pt', a.why || a.text));
      b.disabled = !a.ok;
      b.onclick = () => act(() => Battle.useCardPower(p, a.index), { t: 'power', p: p, i: a.index });
      box.appendChild(b);
    });
    bar.appendChild(box);
  }

  function unitCard(u, S) {
    const c = el('div', 'ucard');
    c.appendChild(el('div', 'ucname', u.name));
    const up = Board.heightAt(S.board, u);
    c.appendChild(el('div', 'ustats',
      'M ' + u.move + '"   W ' + u.wounds + '/' + u.maxWounds + '   T ' + u.toughness +
      '   OC ' + (u.oc || 0) + (up > 0 ? '   ▲ ' + inches(up) + ' UP' : '')));
    const w = el('div', 'uweaps');
    u.weapons.forEach(function (wp) {
      if (wp.hit == null) return;
      w.appendChild(el('div', 'weap',
        wp.name + '  ·  ' + (wp.range || 1) + '"  ' + wp.hit + '+  S' + wp.strength +
        '  D' + wp.damage));
    });
    c.appendChild(w);
    if (u.effects && u.effects.length) {
      c.appendChild(el('div', 'ueff', u.effects.map(e => e.label).join(' · ')));
    }
    return c;
  }

  function drawLog(S) {
    const box = $('log');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.innerHTML = '';
    S.log.slice(-80).forEach(l => box.appendChild(el('div', 'l ' + l.cls, l.text)));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  /* ------------------------------------------------------- entering a mode */

  function select(id) {
    selected = id;
    mode = null;
    render(Battle.get());
  }

  function enter(kind, unitId) {
    const S = Battle.get();
    if (kind === 'secure') { act(() => Battle.doSecure(unitId), { t: 'secure', id: unitId }); return; }
    if (kind === 'relic') { act(() => Battle.doRelic(unitId), { t: 'relic', id: unitId }); return; }
    if (mode && mode.kind === kind && mode.unitId === unitId) { mode = null; render(S); return; }
    const u = Battle.unit(unitId);

    if (kind === 'move') {
      const mf = Battle.moveField(unitId);
      mode = { kind: 'move', unitId: unitId, field: mf.field, inches: mf.inches,
               climbs: mf.climbs,
               spots: Board.sampleReach(mf.field, mf.inches, 0.4) };
    } else if (kind === 'shoot') {
      const guns = Battle.weaponsOf(u, 'ranged');
      const reach = Math.max.apply(null, guns.map(g => g.range || 0));
      mode = { kind: 'shoot', unitId: unitId, targets: Battle.rangedTargets(unitId),
               sight: Board.sampleSight(S.board, u, reach, 0.5) };
    } else if (kind === 'fight') {
      mode = { kind: 'fight', unitId: unitId, targets: Battle.meleeTargets(unitId) };
    } else if (kind === 'charge') {
      mode = { kind: 'charge', unitId: unitId, targets: Battle.chargeTargets(unitId) };
    } else if (kind === 'overwatch') {
      /* The token is placed within 12" — measured, not walked. */
      const spots = [];
      for (let dy = -12; dy <= 12; dy += 0.6) {
        for (let dx = -12; dx <= 12; dx += 0.6) {
          if (dx * dx + dy * dy > 144) continue;
          const p = { x: u.x + dx, y: u.y + dy };
          if (!Board.inside(S.board, p)) continue;
          spots.push(p);
        }
      }
      mode = { kind: 'overwatch', unitId: unitId, spots: spots };
    }
    render(S);
  }

  /* ---------------------------------------------------------- table input */

  function wire() {
    const cv = $('board');
    cv.addEventListener('pointermove', function (e) {
      if (!started || e.buttons) return;
      const p = Render3D.pick(e.clientX, e.clientY);
      if (!p) return;
      hoverPx = { x: e.clientX, y: e.clientY };
      if (!hover || Math.hypot(hover.x - p.x, hover.y - p.y) > 0.12) {
        hover = { x: p.x, y: p.y };
        render(Battle.get());
      }
    });
    cv.addEventListener('pointerleave', function () {
      if (!started) return;
      hover = null; render(Battle.get());
    });
    /* the camera owns the pointer and tells us when a press was a click
       rather than the start of a drag */
    Render3D.setTap(function (x, y) { if (started) click(x, y); });
    $('startBtn').onclick = begin;
    $('againBtn').onclick = () => location.reload();
    $('viewP0').onclick = () => Render3D.viewFrom(0);
    $('viewP1').onclick = () => Render3D.viewFrom(1);
    $('sfxBtn').onclick = function () {
      const on = !Sfx.enabled();
      Sfx.enabled(on);
      $('sfxBtn').textContent = 'SOUND: ' + (on ? 'ON' : 'OFF');
      if (on) Sfx.ui();
    };
    $('netLocal').onclick = () => { Net.hangUp(); netMode = 'local'; showMenu(); };
    $('netHost').onclick  = () => { Net.hangUp(); netMode = 'host';  showMenu(); };
    $('netJoin').onclick  = () => { Net.hangUp(); netMode = 'join';  showMenu(); };
    Net.onChange(() => { if (!started) drawNet(); });
  }

  /* Run a move locally and tell the other end about it. */
  function act(fn, wire) {
    fn();
    if (window.Net && Net.active() && wire) Net.send(wire);
  }

  function click(cx, cy) {
    const S = Battle.get();
    if (!S || S.winner !== null) return;
    /* The table is held while a shot plays out — but never while it is asking
       you something. Waiting on the dice to settle and refusing the click that
       answers the question they were rolled for reads as a dead interface. */
    if (Render3D.busy() && !S.pending) return;
    /* Where on the table the click landed, IF it landed on the table at all.
       A click on a model near the far edge can miss the ground entirely — the
       ray goes over the lip — and questions that are answered by naming a
       model do not need a spot anyway. So this is allowed to be null, and
       only the branches that need somewhere to stand insist on it. */
    const p = Render3D.pick(cx, cy);
    const at = p ? { x: p.x, y: p.y } : null;

    /* Deployment: your zone, your choice, and only on your go. */
    if (S.pending && S.pending.kind === 'deploy') {
      const pend = S.pending;
      if (window.Net && Net.active() && Net.seat() !== pend.owner) return;
      const spot = Render3D.pickNearest(cx, cy, pend.spots, 70) || at;
      if (!spot) return;
      act(() => Battle.placeDeploy(spot), { t: 'deploy', at: spot });
      return;
    }

    /* Something a card told you to place — a smoke bomb, a grenade, a model
       moving up to the distance that was rolled. */
    if (S.pending && S.pending.kind === 'put') {
      const pend = S.pending;
      const spot = Render3D.pickNearest(cx, cy, pend.spots, 70) || at;
      if (!spot) return;
      act(() => Battle.placePut(spot), { t: 'put', at: spot });
      return;
    }

    /* Something a card told you to choose — the model Da Hunta marks, the
       mate who steps into a shot. */
    if (S.pending && S.pending.kind === 'pick') {
      const pend = S.pending;
      const hit2 = Render3D.pickUnit(cx, cy, S);
      if (hit2 && pend.options.indexOf(hit2.id) >= 0) {
        act(() => Battle.choosePick(hit2.id), { t: 'pick', id: hit2.id });
      }
      return;
    }

    if (S.pending && (S.pending.kind === 'ability' || S.pending.kind === 'card')) {
      const pend = S.pending;
      if (pend.need === 'spot') {
        const spot = Render3D.pickNearest(cx, cy, pend.spots || [], 40) || at;
        if (!spot) return;
        act(() => Battle.confirmAbility(spot), { t: 'abil2', at: spot });
      } else {
        const hit2 = Render3D.pickUnit(cx, cy, S);
        if (hit2) act(() => Battle.confirmAbility(hit2.id), { t: 'abil2', id: hit2.id });
      }
      return;
    }

    /* Placing a model after a reaction that moves it. */
    if (S.pending && S.pending.kind === 'move') {
      if (myTurnBlocked(S) && Net.seat() !== Battle.unit(S.pending.unitId).owner) return;
      const spot = (at && Battle.snapMove(S.pending, at)) ||
                   Render3D.pickNearest(cx, cy, S.pending.spots);
      if (!spot) return;
      act(() => Battle.placeMove(spot), { t: 'place', at: spot });
      return;
    }
    if (S.pending) return;
    if (myTurnBlocked(S)) return;

    const hit = Render3D.pickUnit(cx, cy, S);

    if (mode) {
      if (mode.kind === 'move') {
        const reach = at && Board.canReach(mode.field, at, mode.inches);
        const climb = (!reach && at) ? Board.climbFor(mode.field, mode.inches, at) : null;
        const to = climb ? climb
                 : reach ? at
                 : Render3D.pickNearest(cx, cy, mode.spots, 30);
        if (to) {
          const id = mode.unitId; mode = null;
          act(() => Battle.doMove(id, to), { t: 'move', id: id, at: to });
          return;
        }
      }
      if (mode.kind === 'overwatch') {
        const u = Battle.unit(mode.unitId);
        const to = (at && Battle.rangeTo(u, at) <= 12) ? at
                 : Render3D.pickNearest(cx, cy, mode.spots, 30);
        if (to) {
          const id = mode.unitId; mode = null;
          act(() => Battle.doOverwatch(id, to), { t: 'ow', id: id, at: to });
          return;
        }
      }
      if (hit && mode.targets && mode.targets.indexOf(hit.id) >= 0) {
        const id = mode.unitId, kind = mode.kind;
        if (kind === 'charge') {
          mode = null;
          act(() => Battle.doCharge(id, hit.id), { t: 'charge', id: id, tid: hit.id });
          return;
        }
        pickWeapon(id, hit.id, kind === 'shoot' ? 'ranged' : 'melee', function (name) {
          mode = null;
          if (kind === 'shoot') act(() => Battle.doShoot(id, hit.id, name),
                                    { t: 'shoot', id: id, tid: hit.id, w: name });
          else act(() => Battle.doFight(id, hit.id, name),
                   { t: 'fight', id: id, tid: hit.id, w: name });
        });
        return;
      }
    }
    if (hit) select(hit.id);
  }

  function pickWeapon(attackerId, targetId, type, then) {
    const a = Battle.unit(attackerId), t = Battle.unit(targetId);
    const d = Battle.rangeTo(a, t) - a.radius - t.radius;
    const usable = Battle.weaponsOf(a, type)
      .filter(w => d <= (w.range || (type === 'melee' ? 1 : 0)));
    if (usable.length <= 1) { then(usable.length ? usable[0].name : null); return; }
    modal('CHOOSE A WEAPON', a.name + ' → ' + t.name + ', ' + inches(Battle.rangeTo(a, t)) + ' away',
      usable.map(w => ({
        label: w.name,
        sub: (w.range || 1) + '"  ·  ' + w.hit + '+ to hit  ·  S' + w.strength + '  ·  D' + w.damage,
        on: () => then(w.name)
      })), a.owner);
  }

  /* ------------------------------------------------------------ the modals */

  function drawPending(S) {
    if (!S.pending || S.pending.kind === 'move' || S.pending.kind === 'ability' ||
        S.pending.kind === 'card' || S.pending.kind === 'put' ||
        S.pending.kind === 'pick' || S.pending.kind === 'endability' ||
        S.pending.kind === 'deploy') { closeModal(); return; }
    if (S.pending.kind === 'redirect') return redirectModal(S);
    if (S.pending.kind === 'reaction') return reactionModal(S);
    if (S.pending.kind === 'overwatch') return overwatchModal(S);
  }

  function reactionModal(S) {
    const atk = S.pending.atk;
    const t = atk.target, a = atk.attacker;
    if (window.Net && Net.active() && Net.seat() !== t.owner) {
      modal(atk.range === 'melee' ? 'MELEE REACTION' : 'RANGED REACTION',
        a.name + ' attacks ' + t.name + '. Waiting for ' + S.players[t.owner].name + '.',
        [], t.owner, true);
      return;
    }
    const rp = S.players[t.owner].rp;
    const opts = S.pending.options.map(o => ({
      label: o.name, sub: o.why || o.text,
      off: !o.ok || o.cost > rp,
      on: () => act(() => Battle.chooseReaction(o.id), { t: 'react', r: o.id })
    }));
    opts.push({ label: 'NO REACTION', sub: 'let it come',
                on: () => act(() => Battle.chooseReaction('none'), { t: 'react', r: 'none' }) });
    modal(atk.range === 'melee' ? 'MELEE REACTION' : 'RANGED REACTION',
      a.name + ' attacks ' + t.name + ' with the ' + atk.weapon.name + ' at ' +
      inches(Battle.rangeTo(a, t)) + ' — ' + atk.weapon.hit + '+ to hit, S' +
      atk.weapon.strength + ', D' + atk.weapon.damage + '.  You have ' + rp + ' RP.',
      opts, t.owner, true);
  }

  function redirectModal(S) {
    const pend = S.pending;
    const t = pend.atk.target;
    modal(pend.ability, 'Choose which of your units is put in the way of ' +
      pend.atk.attacker.name + '’s ' + pend.atk.weapon.name + '.',
      pend.options.map(function (id) {
        const x = Battle.unit(id);
        return { label: x.name,
                 sub: x.wounds + '/' + x.maxWounds + ' W · ' +
                      inches(Battle.rangeTo(pend.atk.attacker, x)) + ' from the shooter',
                 on: () => act(() => Battle.chooseRedirect(id), { t: 'redirect', id: id }) };
      }), t.owner, true);
  }

  function overwatchModal(S) {
    const mover = Battle.unit(S.pending.moverId);
    const owner = Battle.unit(S.pending.watchers[0]).owner;
    if (window.Net && Net.active() && Net.seat() !== owner) {
      modal('OVERWATCH TRIGGERED', mover.name + ' walked into a watched arc. Waiting for ' +
        S.players[owner].name + '.', [], owner, true);
      return;
    }
    const rows = S.pending.watchers.map(function (id) {
      const w = Battle.unit(id);
      const on = S.pending.queue.indexOf(id) >= 0;
      return {
        label: (on ? '✓ ' : '') + w.name,
        sub: 'fires at −1 to hit from ' + inches(Battle.rangeTo(w, mover)) +
             ', then the token is spent',
        cls: on ? 'picked' : '', keep: true,
        on: () => act(() => Battle.toggleWatcher(id), { t: 'watch', id: id })
      };
    });
    rows.push({ label: 'RESOLVE', sub: 'fire the ones you picked and carry on', cls: 'go',
                on: () => act(() => Battle.fireOverwatch(), { t: 'fire' }) });
    modal('OVERWATCH TRIGGERED',
      mover.name + ' has walked into a watched arc. Choose which tokens fire.',
      rows, owner, true);
  }

  let modalOpen = false;
  function modal(title, sub, rows, facing, sticky) {
    const wrap = $('modal');
    wrap.hidden = false;
    wrap.dataset.facing = facing;
    modalOpen = true;
    const inner = $('modalInner');
    inner.innerHTML = '';
    inner.appendChild(el('div', 'mwho', Battle.get().players[facing].name + ' DECIDES'));
    inner.appendChild(el('h2', null, title));
    if (sub) inner.appendChild(el('p', 'msub', sub));
    rows.forEach(function (r) {
      const b = el('button', 'mopt ' + (r.cls || '') + (r.off ? ' off' : ''));
      b.appendChild(el('span', 'ml', r.label));
      if (r.sub) b.appendChild(el('span', 'ms', r.sub));
      b.disabled = !!r.off;
      b.onclick = function () { if (!r.keep && !sticky) closeModal(); r.on(); };
      inner.appendChild(b);
    });
  }

  function closeModal() {
    if (!modalOpen) return;
    $('modal').hidden = true;
    modalOpen = false;
  }

  /* ----------------------------------------------------------- the victory */

  function report(S) {
    const w = S.winner, l = Battle.other(w);
    const deadliest = S.units.filter(u => u.owner === w && u.kills > 0)
      .sort((a, b) => b.kills - a.kills)[0];
    return {
      winner: S.players[w].name, loser: S.players[l].name,
      winnerVP: S.players[w].vp, loserVP: S.players[l].vp,
      wipedOut: S.units.filter(u => u.owner === l).every(u => !u.alive),
      force: S.units.filter(u => u.owner === w).length,
      losses: S.units.filter(u => u.owner === w && !u.alive).length,
      deadliest: deadliest ? { name: deadliest.name, kills: deadliest.kills } : null,
      turns: S.turn.number, missionId: null
    };
  }

  let victoryShown = false;
  function showVictory(S) {
    Render3D.draw(S, {});
    drawHUD(S);
    closeModal();
    if (victoryShown) return;
    victoryShown = true;
    const ep = RULES.epitaph(report(S));
    $('vhead').textContent = ep.headline;
    const body = $('vbody');
    body.innerHTML = '';
    ep.lines.forEach(t => body.appendChild(el('p', null, t)));
    $('vwinner').textContent = S.players[S.winner].name;
    const v = $('victory');
    v.hidden = false;
    requestAnimationFrame(() => v.classList.add('run'));
  }

  /* What the other end replays when a move arrives over the wire. */
  function apply(msg) {
    if (!msg) return;
    if (msg.t === 'move')   Battle.doMove(msg.id, msg.at);
    if (msg.t === 'shoot')  Battle.doShoot(msg.id, msg.tid, msg.w);
    if (msg.t === 'fight')  Battle.doFight(msg.id, msg.tid, msg.w);
    if (msg.t === 'charge') Battle.doCharge(msg.id, msg.tid);
    if (msg.t === 'ow')     Battle.doOverwatch(msg.id, msg.at);
    if (msg.t === 'place')  Battle.placeMove(msg.at);
    if (msg.t === 'react')  Battle.chooseReaction(msg.r);
    if (msg.t === 'watch')  Battle.toggleWatcher(msg.id);
    if (msg.t === 'fire')   Battle.fireOverwatch();
    if (msg.t === 'secure') Battle.doSecure(msg.id);
    if (msg.t === 'relic')  Battle.doRelic(msg.id);
    if (msg.t === 'ability') Battle.useAbility(msg.id, msg.i);
    if (msg.t === 'abil2')  Battle.confirmAbility(msg.id !== undefined ? msg.id : msg.at);
    if (msg.t === 'deploy') Battle.placeDeploy(msg.at);
    if (msg.t === 'put')    Battle.placePut(msg.at);
    if (msg.t === 'endab')  Battle.answerEndAbility(!!msg.v);
    if (msg.t === 'pick')   Battle.choosePick(msg.id);
    if (msg.t === 'power')  Battle.useCardPower(msg.p, msg.i);
    if (msg.t === 'redirect') Battle.chooseRedirect(msg.id);
    if (msg.t === 'pass')   Battle.doPass(false);
    if (msg.t === 'endturn') Battle.endTurn();
  }

  return { showMenu, wire, begin, apply, cfg: () => cfg, setCfg: c => { cfg = c; } };
})();

/* Every script here is a classic one loaded in order, so by the time the
   document is ready everything this needs already exists. */
function bootGame() {
  GameUI.wire();
  GameUI.showMenu();
}
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootGame);
} else {
  bootGame();
}

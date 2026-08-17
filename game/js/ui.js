/* =========================================================================
   THE SCREEN
   Menu, then the table. One player at a time has control — the HUD says who,
   and nothing else will answer to a click until they are done.
   ========================================================================= */

const GameUI = (function () {

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* What the player is in the middle of choosing. */
  let mode = null;          // {kind, unitId, cells, targets, weapon}
  let selected = null;      // unit id
  let hover = null;         // {x,y}
  let cfg = { mapId: null, factions: ['astra', 'orks'], names: ['Player One', 'Player Two'] };

  /* --------------------------------------------------------------- the menu */

  function showMenu() {
    $('menu').hidden = false;
    $('battle').hidden = true;
    $('victory').hidden = true;

    const maps = $('mapPick');
    maps.innerHTML = '';
    MAPS.list.forEach(function (m) {
      const dims = { w: Math.max.apply(null, m.rows.map(r => r.length)), h: m.rows.length };
      const card = el('button', 'mapcard');
      card.innerHTML =
        '<span class="mapname"></span>' +
        '<span class="mapsize"></span>' +
        '<span class="mapblurb"></span>';
      card.querySelector('.mapname').textContent = m.name;
      card.querySelector('.mapsize').textContent = dims.w + '" × ' + dims.h + '"  ·  ' +
        m.rows.join('').split('').filter(c => c === 'o' || c === 'O').length + ' objectives';
      card.querySelector('.mapblurb').textContent = m.blurb;
      card.appendChild(thumb(m, dims));
      if (cfg.mapId === m.id) card.classList.add('on');
      card.onclick = () => { cfg.mapId = m.id; showMenu(); };
      maps.appendChild(card);
    });

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
      const f = PRESETS.find(x => x.id === cfg.factions[p]);
      f.units.forEach(u => roster.appendChild(
        el('li', null, u.name + '  ·  M' + u.move + '"  W' + u.maxWounds + '  T' + u.toughness +
                       (u.oc ? '  OC' + u.oc : ''))));
    });

    $('startBtn').disabled = !cfg.mapId;
    $('startBtn').textContent = cfg.mapId ? 'DEPLOY' : 'CHOOSE A BATTLEFIELD';
  }

  /* A little painted preview of the map, drawn straight from the ASCII. */
  function thumb(m, dims) {
    const c = el('canvas', 'thumb');
    const s = 4;
    c.width = dims.w * s; c.height = dims.h * s;
    const g = c.getContext('2d');
    for (let y = 0; y < dims.h; y++) {
      for (let x = 0; x < dims.w; x++) {
        const ch = m.rows[y][x] || '.';
        g.fillStyle = ch === '#' ? '#0b0a09'
          : ch === '^' || ch === 'O' ? '#5d4c37'
          : ch === '1' ? '#2f4a63'
          : ch === '2' ? '#5a2b24'
          : '#26221b';
        g.fillRect(x * s, y * s, s, s);
        if (ch === 'o' || ch === 'O') {
          g.fillStyle = '#b8912f';
          g.fillRect(x * s + 1, y * s + 1, s - 2, s - 2);
        }
      }
    }
    return c;
  }

  /* ------------------------------------------------------------- the battle */

  function begin() {
    $('menu').hidden = true;
    $('battle').hidden = false;
    Render.attach($('board'));
    Battle.on(render);
    Battle.start(cfg);
    window.addEventListener('resize', resize);
    resize();
  }

  function resize() {
    const S = Battle.get();
    if (!S) return;
    const wrap = $('boardwrap');
    Render.fit(S.board, wrap.clientWidth - 4, wrap.clientHeight - 4);
    render(S);
  }

  /* Everything the canvas should be showing, worked out from `mode`. */
  function view(S) {
    const v = { selected: selected, ready: readyUnits(S) };
    if (!mode) return v;
    const u = Battle.unit(mode.unitId);
    if (!u) return v;

    if (mode.kind === 'move') {
      v.cells = mode.field.cells;
      v.fill = Render.COL.move; v.edge = Render.COL.moveEdge;
    } else if (mode.kind === 'shoot') {
      v.cells = mode.sight;
      v.fill = Render.COL.sight; v.edge = Render.COL.sightEdge;
      v.targets = mode.targets;
    } else if (mode.kind === 'fight' || mode.kind === 'charge') {
      v.targets = mode.targets;
      if (mode.kind === 'charge') {
        v.ring = { x: u.x, y: u.y, r: 6 };
        v.ringColour = Render.COL.moveEdge;
      }
    } else if (mode.kind === 'overwatch') {
      v.cells = mode.cells;
      v.fill = Render.COL.watch; v.edge = Render.COL.watchEdge;
      if (hover && mode.keys[hover.x + ',' + hover.y]) {
        v.ring = { x: hover.x, y: hover.y, r: 3 };
        v.ringColour = Render.COL.watchEdge;
      }
    }
    if (hover && v.targets) {
      const t = S.units.find(t => t.alive && t.x === hover.x && t.y === hover.y);
      if (t && v.targets.indexOf(t.id) >= 0) { v.threatFrom = u; v.threatTo = t; }
    }
    return v;
  }

  function readyUnits(S) {
    if (S.pending || S.winner !== null) return [];
    return Battle.mine(S.control.player)
      .filter(u => Battle.actionsFor(u.id).some(a => a.ok))
      .map(u => u.id);
  }

  function render(S) {
    if (S.winner !== null) { showVictory(S); return; }
    Render.draw(S, view(S));
    drawHUD(S);
    drawPending(S);
  }

  function drawHUD(S) {
    const ctrl = S.control.player;
    document.body.dataset.control = ctrl;

    $('turnline').textContent = 'TURN ' + S.turn.number + ' · ' + S.players[S.turn.player].name;
    $('chainline').textContent = S.chain.active ? 'ACTION CHAIN RUNNING' : 'no chain';
    $('chainline').className = 'chainline' + (S.chain.active ? ' on' : '');

    [0, 1].forEach(function (p) {
      const pl = S.players[p];
      $('pname' + p).textContent = pl.name;
      $('pap' + p).textContent = pl.ap;
      $('pvp' + p).textContent = pl.vp + '/' + S.vpTarget;
      $('pbox' + p).classList.toggle('acting', p === ctrl);
      const list = $('plist' + p);
      list.innerHTML = '';
      S.units.filter(u => u.owner === p).forEach(function (u) {
        const row = el('button', 'urow' + (u.alive ? '' : ' dead') +
                                (selected === u.id ? ' sel' : ''));
        row.appendChild(el('span', 'uname', u.name));
        const pips = el('span', 'pips');
        for (let i = 0; i < u.maxWounds; i++) {
          pips.appendChild(el('i', i < u.wounds ? 'pip on' : 'pip'));
        }
        row.appendChild(pips);
        if (u.overwatch) row.appendChild(el('span', 'tag', 'OW'));
        if (u.kills) row.appendChild(el('span', 'tag kills', '☠' + u.kills));
        row.onclick = () => { if (u.alive) { select(u.id); } };
        list.appendChild(row);
      });
    });

    drawActions(S);
    drawLog(S);
  }

  function drawActions(S) {
    const bar = $('actions');
    bar.innerHTML = '';
    const ctrl = S.control.player;

    if (S.pending) {
      bar.appendChild(el('div', 'prompt', 'waiting on the reaction…'));
      return;
    }

    const head = el('div', 'ahead');
    head.appendChild(el('span', 'who', S.players[ctrl].name + ' to act'));
    if (S.control.forcedUnitId) {
      const f = Battle.unit(S.control.forcedUnitId);
      head.appendChild(el('span', 'forced', 'the chain is on ' + f.name));
    }
    bar.appendChild(head);

    const u = selected ? Battle.unit(selected) : null;
    if (!u || !u.alive) {
      bar.appendChild(el('div', 'prompt', 'pick one of your models'));
    } else if (u.owner !== ctrl) {
      bar.appendChild(el('div', 'prompt', 'not yours to move right now'));
    } else {
      bar.appendChild(unitCard(u, S));
      const acts = Battle.actionsFor(u.id);
      const row = el('div', 'abtns');
      acts.forEach(function (a) {
        const def = RULES.actionById(a.id);
        const b = el('button', 'abtn' + (a.ok ? '' : ' off') +
                               (mode && mode.kind === a.id && mode.unitId === u.id ? ' on' : ''));
        b.appendChild(el('span', 'an', def ? def.name : a.id.toUpperCase()));
        b.appendChild(el('span', 'ac', a.cost + ' AP'));
        b.title = a.why ? a.why : (def ? def.short || def.text : '');
        if (a.why) b.appendChild(el('span', 'awhy', a.why));
        b.disabled = !a.ok;
        b.onclick = () => enter(a.id, u.id);
        row.appendChild(b);
      });
      bar.appendChild(row);
    }

    const foot = el('div', 'afoot');
    const pass = el('button', 'pass', S.chain.active ? 'PASS' : 'PASS');
    pass.onclick = () => { mode = null; Battle.doPass(false); };
    foot.appendChild(pass);
    if (ctrl === S.turn.player) {
      const end = el('button', 'endturn', 'END TURN');
      end.onclick = () => { mode = null; selected = null; Battle.endTurn(); };
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

  function unitCard(u, S) {
    const c = el('div', 'ucard');
    c.appendChild(el('div', 'ucname', u.name));
    c.appendChild(el('div', 'ustats',
      'M ' + u.move + '"   W ' + u.wounds + '/' + u.maxWounds + '   T ' + u.toughness +
      '   OC ' + (u.oc || 0) +
      (Board.heightAt(S.board, u.x, u.y) === Board.RAISED ? '   ▲ HIGH GROUND' : '')));
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
    S.log.slice(-70).forEach(l => box.appendChild(el('div', 'l ' + l.cls, l.text)));
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
    if (mode && mode.kind === kind && mode.unitId === unitId) { mode = null; render(S); return; }
    const u = Battle.unit(unitId);
    if (kind === 'move') {
      mode = { kind: 'move', unitId: unitId, field: Battle.moveField(unitId) };
    } else if (kind === 'shoot') {
      const targets = Battle.rangedTargets(unitId);
      const guns = Battle.weaponsOf(u, 'ranged');
      const reach = Math.max(...guns.map(g => g.range || 0));
      mode = {
        kind: 'shoot', unitId: unitId, targets: targets,
        sight: Board.visibleCells(S.board, u, reach)
      };
    } else if (kind === 'fight') {
      mode = { kind: 'fight', unitId: unitId, targets: Battle.meleeTargets(unitId) };
    } else if (kind === 'charge') {
      mode = { kind: 'charge', unitId: unitId, targets: Battle.chargeTargets(unitId) };
    } else if (kind === 'overwatch') {
      /* The token goes anywhere within 12" — measured, not walked. */
      const cells = Board.within(S.board, u, 12, false);
      const keys = {};
      cells.forEach(c => { keys[c.x + ',' + c.y] = true; });
      mode = { kind: 'overwatch', unitId: unitId, cells: cells, keys: keys };
    }
    render(S);
  }

  /* ---------------------------------------------------------- canvas input */

  function wire() {
    const cv = $('board');
    cv.addEventListener('mousemove', function (e) {
      const r = cv.getBoundingClientRect();
      const c = Render.cellAt(e.clientX - r.left, e.clientY - r.top);
      if (!hover || hover.x !== c.x || hover.y !== c.y) { hover = c; render(Battle.get()); }
    });
    cv.addEventListener('mouseleave', () => { hover = null; render(Battle.get()); });
    cv.addEventListener('click', function (e) {
      const r = cv.getBoundingClientRect();
      const c = Render.cellAt(e.clientX - r.left, e.clientY - r.top);
      click(c);
    });
    $('startBtn').onclick = begin;
    $('againBtn').onclick = () => location.reload();
  }

  function click(c) {
    const S = Battle.get();
    if (!S || S.pending || S.winner !== null) return;
    const hit = S.units.find(u => u.alive && u.x === c.x && u.y === c.y);

    if (mode) {
      const inField = f => f && f.cost[c.y * S.board.w + c.x] !== Infinity;
      if (mode.kind === 'move' && inField(mode.field)) {
        const id = mode.unitId; mode = null;
        Battle.doMove(id, c);
        return;
      }
      if (mode.kind === 'overwatch' && mode.keys[c.x + ',' + c.y]) {
        const id = mode.unitId; mode = null;
        Battle.doOverwatch(id, c);
        return;
      }
      if (hit && mode.targets && mode.targets.indexOf(hit.id) >= 0) {
        const id = mode.unitId, kind = mode.kind;
        if (kind === 'charge') { mode = null; Battle.doCharge(id, hit.id); return; }
        pickWeapon(id, hit.id, kind === 'shoot' ? 'ranged' : 'melee', function (name) {
          mode = null;
          if (kind === 'shoot') Battle.doShoot(id, hit.id, name);
          else Battle.doFight(id, hit.id, name);
        });
        return;
      }
    }
    if (hit) select(hit.id);
  }

  /* One weapon and it just fires; more than one and you choose. */
  function pickWeapon(attackerId, targetId, type, then) {
    const a = Battle.unit(attackerId), t = Battle.unit(targetId);
    const d = Board.dist(a, t);
    const usable = Battle.weaponsOf(a, type)
      .filter(w => d <= (w.range || (type === 'melee' ? 1 : 0)));
    if (usable.length <= 1) { then(usable.length ? usable[0].name : null); return; }
    modal('CHOOSE A WEAPON', a.name + ' → ' + t.name + ', ' + d.toFixed(1) + '" away',
      usable.map(w => ({
        label: w.name,
        sub: (w.range || 1) + '"  ·  ' + w.hit + '+ to hit  ·  S' + w.strength + '  ·  D' + w.damage,
        on: () => then(w.name)
      })), a.owner);
  }

  /* ------------------------------------------------------------ the modals */

  function drawPending(S) {
    if (!S.pending) { closeModal(); return; }
    if (S.pending.kind === 'reaction') return reactionModal(S);
    if (S.pending.kind === 'overwatch') return overwatchModal(S);
  }

  function reactionModal(S) {
    const atk = S.pending.atk;
    const t = atk.target, a = atk.attacker;
    const rp = S.players[t.owner].rp;
    const opts = S.pending.options.map(function (o) {
      return {
        label: o.name,
        sub: o.why ? o.why : o.text,
        off: !o.ok || o.cost > rp,
        on: () => Battle.chooseReaction(o.id)
      };
    });
    opts.push({ label: 'NO REACTION', sub: 'let it come', on: () => Battle.chooseReaction('none') });
    modal(
      atk.range === 'melee' ? 'MELEE REACTION' : 'RANGED REACTION',
      a.name + ' attacks ' + t.name + ' with the ' + atk.weapon.name +
      ' — ' + atk.weapon.hit + '+ to hit, S' + atk.weapon.strength + ', D' + atk.weapon.damage +
      '.  You have ' + rp + ' RP.',
      opts, t.owner, true);
  }

  function overwatchModal(S) {
    const mover = Battle.unit(S.pending.moverId);
    const rows = S.pending.watchers.map(function (id) {
      const w = Battle.unit(id);
      const on = S.pending.queue.indexOf(id) >= 0;
      return {
        label: (on ? '✓ ' : '') + w.name,
        sub: 'fires at −1 to hit, then the token is spent',
        cls: on ? 'picked' : '',
        keep: true,
        on: () => Battle.toggleWatcher(id)
      };
    });
    rows.push({ label: 'RESOLVE', sub: 'fire the ones you picked and carry on', cls: 'go',
                on: () => Battle.fireOverwatch() });
    modal('OVERWATCH TRIGGERED',
      mover.name + ' has walked into a watched arc. Choose which tokens fire.',
      rows, Battle.unit(S.pending.watchers[0]).owner, true);
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
    const force = S.units.filter(u => u.owner === w).length;
    const losses = S.units.filter(u => u.owner === w && !u.alive).length;
    const deadliest = S.units.filter(u => u.owner === w && u.kills > 0)
      .sort((a, b) => b.kills - a.kills)[0];
    return {
      winner: S.players[w].name, loser: S.players[l].name,
      winnerVP: S.players[w].vp, loserVP: S.players[l].vp,
      wipedOut: S.units.filter(u => u.owner === l).every(u => !u.alive),
      force: force, losses: losses,
      deadliest: deadliest ? { name: deadliest.name, kills: deadliest.kills } : null,
      turns: S.turn.number, missionId: null
    };
  }

  let victoryShown = false;
  function showVictory(S) {
    Render.draw(S, {});
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

  return { showMenu, wire, begin };
})();

window.addEventListener('DOMContentLoaded', function () {
  GameUI.wire();
  GameUI.showMenu();
});

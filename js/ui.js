/* =========================================================================
   UI — play screen, guided action flows, modals.
   ========================================================================= */

const UI = (function () {

  let modal = null;
  let chainOpen = false;      // the chain log folds away until you want it          // UI-only overlays: {acts} | 'menu' | 'log' | {unit:id}
  let damageDraft = null;

  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const G = () => Store.get();

  /* Card text is stored as printed lines, so render it that way. */
  const lines = xs => (Array.isArray(xs) ? xs : [xs]).map(esc).join('<br>');

  function render() {
    const app = document.getElementById('app');
    const g = G();
    if (!g) { app.innerHTML = Setup.render(); return; }
    const keep = captureScroll();
    app.innerHTML = playScreen(g) + overlay(g);
    restoreScroll(keep);

    /* The victory scene plays once, not on every redraw behind it. */
    const w = (g.winner === null || g.winner === undefined) ? null : g.winner;
    if (w !== null && modal !== 'win-dismissed') {
      if (victoryShownFor !== w) { victoryShownFor = w; playVictory(); }
    } else if (w === null) {
      victoryShownFor = null;
    }
  }

  /* Re-rendering replaces the whole screen, which would throw away where each
     player had scrolled to — unbearable in the across-the-table layout, where
     a roster is taller than its half. So the positions are carried over. */
  const SCROLLERS = ['.tablehalf.p0 > .inner', '.tablehalf.p1 > .inner',
                     '.rosters', '.chainbox'];

  function captureScroll() {
    const out = {};
    SCROLLERS.forEach(function (sel) {
      const el = document.querySelector(sel);
      if (el) out[sel] = el.scrollTop;
    });
    return out;
  }

  function restoreScroll(keep) {
    SCROLLERS.forEach(function (sel) {
      const el = document.querySelector(sel);
      if (!el) return;
      if (keep[sel] !== undefined) { el.scrollTop = keep[sel]; return; }
      /* First sight of an upside-down half: open it on its first unit, which
         is at the far end of the box from where that player is sitting. */
      const half = el.closest ? el.closest('.tablehalf') : null;
      if (half && half.classList.contains('p0') &&
          getComputedStyle(el).transform.indexOf('-1, 0, 0, -1') >= 0) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  function setModal(m) { modal = m; render(); }

  /* ================================================================ EFFECTS
     Sparks off the plate, blood off the wound, and a jolt through the whole
     board. Drawn straight onto the document, never into the game state, so
     nothing replays on a re-render or an undo. */

  let tapPoint = null;                 // where the player last put their finger
  function noteTap(x, y) { tapPoint = { x: x, y: y }; }

  const reducedMotion = () => window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fxOn() {
    const g = G();
    if (reducedMotion()) return false;
    return !(g && g.settings && g.settings.fx === false);
  }

  function fxLayer() {
    let l = document.getElementById('fx');
    if (!l) {
      l = document.createElement('div');
      l.id = 'fx';
      document.body.appendChild(l);
    }
    return l;
  }

  /* Where the effect should come from: the finger if we have it, otherwise the
     middle of whatever window is open, otherwise the middle of the screen. */
  function fxOrigin() {
    if (tapPoint) return tapPoint;
    const m = document.querySelector('.modal') || document.querySelector('.board');
    if (m) {
      const r = m.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  function shake(kind) {
    const app = document.getElementById('app');
    if (!app) return;
    app.classList.remove('jolt-sm', 'jolt-md', 'jolt-lg');
    void app.offsetWidth;                       // restart the animation
    app.classList.add('jolt-' + kind);
    setTimeout(() => app.classList.remove('jolt-' + kind), 700);
  }

  /* A burst of particles thrown outward from a point. */
  function burst(o, n, cls, spread, dist) {
    const l = fxLayer();
    const frag = document.createDocumentFragment();
    const made = [];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      made.push(p);
      p.className = 'fxp ' + cls;
      const a = (-90 + (Math.random() - .5) * spread) * Math.PI / 180;
      const d = dist * (.45 + Math.random() * .8);
      p.style.left = o.x + 'px';
      p.style.top = o.y + 'px';
      p.style.setProperty('--dx', Math.cos(a) * d * (Math.random() < .5 ? -1 : 1) + 'px');
      p.style.setProperty('--dy', (Math.sin(a) * d) + 'px');
      p.style.setProperty('--r', (Math.random() * 360) + 'deg');
      p.style.animationDelay = (Math.random() * 70) + 'ms';
      p.style.animationDuration = (420 + Math.random() * 320) + 'ms';
      frag.appendChild(p);
    }
    l.appendChild(frag);
    /* Remove the particles this burst made, not the first n in the layer —
       overlapping bursts would otherwise orphan each other's nodes. */
    setTimeout(() => made.forEach(c => c.remove()), 900);
  }

  function flash(cls, ms) {
    const l = fxLayer();
    const f = document.createElement('div');
    f.className = 'fxflash ' + cls;
    l.appendChild(f);
    setTimeout(() => f.remove(), ms);
  }

  function splat(o, scale) {
    const l = fxLayer();
    const d = document.createElement('div');
    d.className = 'fxsplat';
    d.style.left = o.x + 'px';
    d.style.top = o.y + 'px';
    d.style.setProperty('--s', scale);
    d.style.setProperty('--rot', (Math.random() * 360) + 'deg');
    l.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  /* The engine says what happened; this decides how hard it lands. */
  function playFx(kind, data) {
    if (!fxOn()) return;
    const o = fxOrigin();
    if (kind === 'hit') {
      shake('sm');
      burst(o, 10 + Math.min(6, (data.count || 1) * 2), 'spark', 150, 90);
    } else if (kind === 'miss' || kind === 'nowound') {
      shake('sm');
      burst(o, 5, 'dust', 120, 60);
    } else if (kind === 'damage') {
      shake(data.fatal ? 'lg' : 'md');
      burst(o, 12, 'blood', 170, 105);
      splat(o, data.fatal ? 1.5 : 1);
      if (!data.fatal) flash('red', 260);
    } else if (kind === 'kill') {
      shake('lg');
      flash('kill', 620);
      burst(o, 20, 'blood', 200, 150);
    }
  }

  function toggleChain() { chainOpen = !chainOpen; render(); }

  /* ================================================================ SHELL */

  function playScreen(g) {
    return '<div class="screen' + (g.settings.verbose === false ? ' lean' : '') +
      (g.settings.layout === 'table' ? ' table' : '') + '">' +
      topbar(g) +
      cardStrip(g) +
      controlbar(g) +
      (g.settings.layout === 'table'
        ? '<div class="board table">' +
            '<div class="tablehalf p0"><div class="inner">' + rosterCol(g, 0) + '</div></div>' +
            '<div class="tablemid">' + passCard(g) + '</div>' +
            '<div class="tablehalf p1"><div class="inner">' + rosterCol(g, 1) + '</div></div>' +
          '</div>'
        : '<div class="board"><div class="rosters">' +
            rosterCol(g, 0) + passCard(g) + rosterCol(g, 1) +
          '</div></div>') +
      tokenTray(g) +
      chainbox(g) +
      actionbar(g) +
    '</div>';
  }

  function topbar(g) {
    return '<div class="turnstrip">' +
        '<span class="tt">TURN ' + g.turn.number + '</span>' +
        '<span class="tn">' + esc(g.players[g.turn.player].name) + '</span>' +
        '<span class="tp">' + (g.turn.phase === 'start' ? 'START PHASE'
                             : g.turn.phase === 'end' ? 'END PHASE' : 'ACTION PHASE') + '</span>' +
        '<span class="tv">' + esc(g.settings.endsShort ||
          (g.settings.vpTarget ? 'FIRST TO ' + g.settings.vpTarget + ' VP' : 'SEE THE CARD')) +
        '</span>' +
      '</div>' +
      '<div class="topbar">' +
        g.players.map((p, i) => plate(g, i)).join('') +
      '</div>';
  }

  function plate(g, i) {
    const p = g.players[i];
    const active = g.control.player === i;
    return '<div class="pplate p' + i + (active ? ' active' : '') + '">' +
      '<div class="pname">' + esc(p.name) +
        (g.turn.player === i ? ' · TURN' : (active ? ' · REACTING' : '')) + '</div>' +
      '<div class="stats">' +
        '<div class="stat ap"><div class="v">' + p.ap + '</div><div class="k">AP</div>' +
          '<div class="nudge"><button data-act="ap:' + i + ':-1">−</button>' +
                             '<button data-act="ap:' + i + ':1">+</button></div></div>' +
        '<div class="stat vp"><div class="v">' + p.vp + '</div><div class="k">VP</div>' +
          '<div class="nudge"><button data-act="vp:' + i + ':-1">−</button>' +
                             '<button data-act="vp:' + i + ':1">+</button></div></div>' +
      '</div>' +
    '</div>';
  }

  /* A faction card sits with its player: a named pool and the powers it buys.
     The powers are only live in that player's Start Phase, but the card is
     always readable and the pool is always correctable by hand. */
  function cardStrip(g) {
    const cards = g.players.map((p, i) => p.card ? cardChip(g, p, i) : '').join('');
    return cards ? '<div class="cardstrip">' + cards + '</div>' : '';
  }

  function cardChip(g, p, i) {
    const c = p.card;
    const r = c.resource;
    const list = Engine.cardAbilities(i);
    const live = list.filter(a => a.available.ok).length;
    return '<div class="fcard p' + i + (live ? ' live' : '') + '">' +
      '<button class="fcmain" data-act="cardinfo:' + i + '">' +
        '<span class="fcname">' + esc(c.name) + '</span>' +
        '<span class="fcwho">' + esc(p.name) + (live ? ' · ' + live + ' READY' : '') + '</span>' +
      '</button>' +
      (r ? '<div class="fcres"><div class="v">' + r.value + '</div>' +
             '<div class="k">' + esc(r.name) + '</div>' +
             '<div class="nudge"><button data-act="res:' + i + ':-1">−</button>' +
                                '<button data-act="res:' + i + ':1">+</button></div></div>' : '') +
    '</div>';
  }

  function cardModal(g, i) {
    const p = g.players[i];
    const c = p.card;
    if (!c) return '';
    const r = c.resource;
    return head(esc(c.name), esc(p.name) +
        (r ? ' · ' + r.value + ' ' + r.name : '')) +
      '<div class="mbody">' +
        (c.tagline ? '<div class="cardline big">' + esc(c.tagline) + '</div>' : '') +
        (c.lines || []).map(l => '<div class="cardline">' + esc(l) + '</div>').join('') +
        Engine.cardAbilities(i).map(function (a) {
          const cost = (Number(a.cost) || 0) + (r ? ' ' + r.name : '');
          return '<button class="choice' + (a.available.ok ? '' : ' disabled') +
            '" data-act="cardab:' + i + ':' + a.id + '">' +
            '<div class="cmain"><div class="cname">' + esc(a.name) + '</div>' +
              '<div class="cdesc">' + esc(a.text) + '</div>' +
              (a.available.ok ? ''
                : '<div class="cflav" style="color:var(--bad)">' + esc(a.available.why) + '</div>') +
            '</div><div class="ccost">' + cost + '</div></button>';
        }).join('') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CLOSE</button></div>';
  }

  /* Buying a card power that needs a unit chosen. */
  function cardFlow(g, f) {
    const ab = Engine.cardAbility(f.playerId, f.abilityId);
    if (!ab) return '';
    const c = g.players[f.playerId].card;
    if (f.step === 'pick') {
      const needs = Engine.effectsNeedingTarget(ab, { sourceUnitId: null });
      const e = needs[f.pickIndex] || needs.find(x => !f.targets[x.id]) || needs[0];
      if (e.pick === 'multi') {
        return multiPick(g, f, e, 'picktarget', esc(ab.name), esc(e.text || ab.text));
      }
      return head(esc(ab.name), 'SELECT A UNIT') +
        '<div class="mbody">' +
          '<div class="noteline">' + esc(e.text || ab.text) + '</div>' +
          pickableUnits(g, e, f.playerId)
            .map(x => unitChoice(x, 'picktarget:' + e.id + ':' + x.id,
              x.owner === f.playerId ? 'friendly' : 'enemy')).join('') +
        '</div>' + footBack();
    }
    return head(esc(ab.name), 'CONFIRM') +
      '<div class="mbody">' +
        '<div class="rollbox"><div class="lbl">' + esc(c.name) + '</div>' +
          '<div class="big" style="font-size:20px">' + esc(ab.name) + '</div>' +
          '<div class="sub">' + esc(ab.text) + '</div></div>' +
        (ab.effects || []).map(e => '<div class="noteline">' + effectSummary(e) +
          targetNames(f.targets[e.id]) + '</div>').join('') +
        (c.resource ? '<div class="noteline warn">Costs ' + ab.cost + ' ' + esc(c.resource.name) +
          ' — ' + (c.resource.value - (Number(ab.cost) || 0)) + ' would be left.</div>' : '') +
      '</div>' +
      footBack('confirmcard', 'SPEND IT');
  }

  function controlbar(g) {
    const cp = g.control.player;
    const forced = g.control.forcedUnitId ? Store.unit(g.control.forcedUnitId) : null;
    let who = esc(g.players[cp].name) + ' TO ACT';
    let why = esc(g.control.reason || '') +
      (forced ? ' · ' + esc(g.players[cp].name) + ' has ' + g.players[cp].ap + ' AP' : '');
    if (forced) who = esc(forced.name).toUpperCase() + ' MUST ACT';
    if (g.pending) {
      who = (g.pending.type === 'start' ? 'START PHASE' : 'END PHASE') +
        ' — ' + esc(g.players[g.pending.player].name);
      why = g.pending.type === 'start'
        ? 'resolve START: abilities, then gain 1 AP'
        : 'resolve END: abilities, then check objectives';
    }
    const mode = Engine.controlMode();
    const broke = Engine.mustPass();
    const badge = {
      turn:       { t: 'THEIR TURN', c: 'turn' },
      continuing: { t: 'THEIR TURN · IN CHAIN', c: 'turn' },
      reacting:   { t: 'REACTING', c: 'react' },
      phase:      { t: 'PHASE', c: 'phase' }
    }[mode];
    return '<div class="controlbar p' + cp + ' mode-' + badge.c + (broke ? ' broke' : '') + '">' +
      '<div style="min-width:0">' +
        '<div class="badge ' + badge.c + '">' + badge.t +
          (mode === 'reacting' ? ' TO ' + esc(g.players[g.turn.player].name).toUpperCase() : '') +
        '</div>' +
        (broke ? '<div class="badge must">NO AP — MUST PASS</div>' : '') +
        '<div class="who">' + who + '</div>' +
        '<div class="why">' + why + '</div></div>' +
      '<div class="chip' + (g.chain.active ? ' on' : '') + '">' +
        (g.chain.active ? 'CHAIN #' + g.chain.id + ' ACTIVE' : 'NO ACTIVE CHAIN') + '</div>' +
    '</div>';
  }

  /* -------------------------------------------------------------- rosters */

  function rosterCol(g, i) {
    const units = Store.unitsOf(i, false);
    return '<div class="rostercol p' + i + '">' +
      '<div class="colhead">' + esc(g.players[i].name) + '</div>' +
      units.map(u => unitCard(g, u)).join('') +
    '</div>';
  }

  /* PASS behaves like a unit you can tap, so it lives on the board between the
     two rosters rather than in a list. */
  function passCard(g) {
    if (g.pending || g.flow) return '<div class="passcard off"></div>';
    const o = Engine.passOptions();
    const other = esc(g.players[Store.opponentOf(g.control.player)].name);
    const what = o.wouldEndChain ? 'ends the action chain'
               : (o.inChain ? 'declines — ' + other + ' answers'
                            : 'ends ' + esc(g.players[g.control.player].name) + '\u2019s turn');
    return '<button class="passcard' + (Engine.mustPass() ? ' must' : '') + '" data-act="dopass">' +
      '<span class="pc1">PASS</span>' +
      '<span class="pc2">' + what + '</span>' +
    '</button>';
  }

  function unitCard(g, u) {
    // Gold ring = this unit is required to act. Coloured edge = its player has
    // the initiative and may pick it.
    const mustAct = g.control.forcedUnitId === u.id && !g.pending;
    const canAct = !g.control.forcedUnitId && g.control.player === u.owner && u.alive && !g.pending;
    const ratio = u.maxWounds ? u.wounds / u.maxWounds : 0;
    const sev = u.wounds <= 0 ? 'crit' : ratio <= 0.34 ? 'crit' : ratio <= 0.67 ? 'hurt' : '';

    let pips = '';
    for (let i = 0; i < u.maxWounds; i++) {
      pips += '<div class="pip' + (i < u.wounds ? ' on ' + sev : '') + '"></div>';
    }

    const weapons = (u.weapons || []).map(function (w) {

      /* A card may leave a weapon's line blank — show the gap rather than
         inventing a number for it. */
      const has = v => !(v === null || v === undefined || v === '');
      const stats = has(w.hit) || has(w.strength) || has(w.damage)
        ? (has(w.hit) ? w.hit + '+' : '—') + ' · S' + (has(w.strength) ? w.strength : '—') +
          ' · D' + (has(w.damage) ? esc(String(w.damage)) : '—')
        : '<span style="color:var(--warn)">no stats on the card</span>';
      return '<div class="row">' +
        '<span class="tag">' + (w.type === 'melee' ? 'M' : 'R') + '</span>' +
        '<span class="nm">' + esc(w.name) + '</span>' +
        '<span>' + (w.range ? w.range + '" · ' : '') + stats + '</span>' +
      '</div>';
    }).join('');

    const mcard = Engine.missionCard();
    const flag = mcard && mcard.unitFlag;
    const flagOn = flag && u.flags && u.flags[flag.id];
    const carrying = Engine.relicCarrier() === u.id;

    const onwatch = (u.tokens || []).some(t => t.kind === 'overwatch');
    const passives = (u.abilities || [])
      .filter(a => a.trigger === 'passive' || a.trigger === 'onkill' || a.trigger === 'gamestart')
      .map(a => '<button class="chip-s pass" data-act="abilinfo:' + u.id + ':' + a.id + '" ' +
        'title="' + esc(a.text) + '">' + esc(a.name) + '</button>').join('') +
      (onwatch ? '<span class="chip-s watch">⌖ OVERWATCHING</span>' : '') +
      (u.reserve ? '<span class="chip-s reserve">IN RESERVE — OFF THE BATTLEFIELD</span>' : '') +
      (u.killVP ? '<span class="chip-s vpworth">WORTH ' + u.killVP + ' VP</span>' : '') +
      (u.noMoveTurn ? '<span class="chip-s warnchip">MAY NOT MOVE THIS TURN</span>' : '') +
      (flagOn ? '<span class="chip-s mission">' + flag.label + '</span>' : '') +
      (carrying ? '<span class="chip-s mission">CARRYING THE RELIC</span>' : '') +
      (u.marker ? '<span class="chip-s mission">MISSION MARKER · NO RP</span>' : '');

    const effects = (u.effects || []).map(e =>
      '<span class="chip-s eff">' + esc(e.label) +
        '<button data-act="rmeff:' + u.id + ':' + e.id + '">✕</button></span>').join('');

    /* Buttons live on the unit that owns them, so with several units ready you
       can always see who is firing and who is still waiting. */
    /* Overwatch fires from the movement check, so it is a status, not a button.
       Everything else still needs pressing when the table says so. */
    const markers = (u.tokens || []).filter(t => t.noPress).map(t =>
      '<span class="chip-s marker" title="' + esc(t.text) + '">◈ ' + esc(t.label) +
        '<button data-act="rmtok:' + u.id + ':' + t.id + '">✕</button></span>').join('');

    const tokens = (u.tokens || []).filter(t => t.kind !== 'overwatch' && !t.noPress)
      .map(function (t) {
      return '<div class="tokrow">' +
        '<button class="tokfire" data-act="tok:' + u.id + ':' + t.id + '">' +
          '<span class="tf1">▸ ' + esc(t.label) + '</span>' +
          '<span class="tf2">' + esc(t.text || 'Press when it triggers') + '</span>' +
        '</button>' +
        '<button class="tokx" data-act="rmtok:' + u.id + ':' + t.id + '">✕</button>' +
      '</div>';
    }).join('');

    const freeAbils = (u.alive ? Engine.usableFreeAbilities(u) : [])
      .map(a => '<button class="abilbtn" data-act="freeab:' + u.id + ':' + a.id + '">' +
        esc(a.name) + '</button>').join('');

    const ready = (mustAct || canAct) && Engine.unitActions(u.id).length > 0;
    const moveMod = Engine.unitMoveMod(u.id);
    return '<div class="unit p' + u.owner +
      (u.alive ? (mustAct ? ' acting' : (canAct ? ' canact' : '')) : ' dead') +
      (u.reserve ? ' reserve' : '') +
      (ready ? ' ready' : '') + '"' +
      (ready ? ' data-act="acts:' + u.id + '"' : '') + '>' +
      '<div class="uhead">' +
        '<div class="uname">' + esc(u.name) + '</div>' +
        '<div class="wtxt ' + sev + '"><span class="cur">' + u.wounds + '</span>' +
          '<span class="max"> / ' + u.maxWounds + ' W</span></div>' +
      '</div>' +
      '<div class="pips">' + pips + '</div>' +
      '<div class="ustats"><span><b>MOV</b> ' + (u.move + moveMod) + '"' +
          (moveMod ? ' <span style="color:var(--gold)">(' + u.move + (moveMod > 0 ? '+' : '') +
                     moveMod + ')</span>' : '') + '</span>' +
        '<span><b>T</b> ' + u.toughness + '</span>' +
        '<span><b>OC</b> ' + (u.oc || 0) + '</span>' +
        (u.alive ? '' : '<span style="color:var(--bad)"><b>DESTROYED</b></span>') + '</div>' +
      '<div class="uwep">' + weapons + '</div>' +
      (u.notes ? '<div class="hint" style="margin:6px 0 0">' + esc(u.notes) + '</div>' : '') +
      ((passives || effects || markers)
        ? '<div class="chips">' + passives + effects + markers + '</div>' : '') +
      (tokens ? '<div class="toks">' + tokens + '</div>' : '') +
      (freeAbils ? '<div class="chips">' + freeAbils + '</div>' : '') +
      '<div class="urow">' +
        '<button class="wbtn" data-act="w:' + u.id + ':-1">−</button>' +
        '<button class="wbtn" data-act="w:' + u.id + ':1">+</button>' +
        '<div class="spacer"></div>' +
        (ready ? '<span class="tapme">TAP TO ACT</span>' : '') +
        '<button class="abilbtn" data-act="unitinfo:' + u.id + '">DETAILS</button>' +
      '</div>' +
    '</div>';
  }

  function tokenTray(g) {
    const toks = Store.allTokens();
    const cps = (g.mission && g.mission.controlPoints) || [];
    const relic = g.mission && g.mission.relic;
    if (!toks.length && !cps.length && !relic) return '';
    const carrier = relic && relic.carrier ? Store.unit(relic.carrier) : null;
    return '<div class="tray">' +
      '<span class="traylbl">ON THE TABLE</span>' +
      cps.map(c => '<div class="cpchip' + (c.controller === null || c.controller === undefined
          ? '' : ' held p' + c.controller) + '"><b>' + esc(c.label) + '</b>' +
        (c.controller === null || c.controller === undefined
          ? 'unclaimed' : esc(g.players[c.controller].name)) + '</div>').join('') +
      (relic ? '<div class="cpchip' + (carrier ? ' held p' + carrier.owner : '') + '">' +
        '<b>RELIC</b>' + (carrier ? esc(carrier.name) : 'unclaimed') + '</div>' : '') +
      (toks.length
        ? '<div class="cpchip"><b>⌖ ' + toks.length + '</b>' +
          (toks.length === 1 ? 'button waiting' : 'buttons waiting') + ' — on their unit cards</div>'
        : '') +
      '<button class="abilbtn" data-act="newbutton">+ BUTTON</button>' +
    '</div>';
  }

  /* Pick a unit to hang a brand-new custom button on, mid-game. */
  function newButtonModal(g) {
    return head('NEW BUTTON', 'WHICH UNIT OWNS IT?') +
      '<div class="mbody">' +
        '<div class="noteline">For anything the app cannot model — a trap, an ambush, a one-off ' +
          'ability, a marker you want to remember. You name it, you press it, the app keeps it ' +
          'on screen until you dismiss it.</div>' +
        g.units.filter(u => u.alive).map(u => unitChoice(u, 'addtok:' + u.id,
          esc(g.players[u.owner].name))).join('') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CANCEL</button></div>';
  }

  /* The running commentary is useful but it was eating the board, so it folds
     down to its last line and opens on a tap. */
  function chainbox(g) {
    const entries = g.chain.entries.slice(-14);
    const last = entries.length ? entries[entries.length - 1] : null;
    const body = entries.length
      ? entries.map(e => '<div class="centry ' + e.cls + '">' + esc(e.text) + '</div>').join('')
      : '<div class="centry muted">No action chain running. The active player may spend AP.</div>';
    return '<div class="chainbox' + (chainOpen ? ' open' : '') + '" id="chainbox">' +
      '<button class="chead" data-act="togglechain">' +
        '<span class="cv">' + (chainOpen ? '▾' : '▸') + '</span>ACTION CHAIN' +
        '<span class="st">' + (g.chain.active ? 'ACTIVE' : 'ENDED') + '</span></button>' +
      (chainOpen
        ? '<div class="clist">' + body + '</div>'
        : '<div class="clast ' + (last ? last.cls : 'muted') + '">' +
            esc(last ? last.text : 'Nothing has happened yet this chain.') + '</div>') +
    '</div>';
  }

  function actionbar(g) {
    const pending = !!g.pending;
    return '<div class="actionbar">' +
      '<button class="sidebtn" data-act="undo"><span class="ic">↺</span>UNDO</button>' +
      (pending
        ? '<button class="bigbtn" data-act="openphase">' +
            (g.pending.type === 'start' ? 'RESOLVE START PHASE' : 'RESOLVE END PHASE') + '</button>'
        : '<div class="prompt' + (Engine.mustPass() ? ' must' : '') + '">' +
            esc(Engine.mustPass()
              ? 'No AP left — pass'
              : (g.control.forcedUnitId
                  ? 'Tap ' + (Store.unit(g.control.forcedUnitId) || {}).name
                  : 'Tap a glowing unit, or pass')) +
          '</div>') +
      '<button class="sidebtn" data-act="menu"><span class="ic">≡</span>MENU</button>' +
    '</div>';
  }

  /* =============================================================== OVERLAY */

  function overlay(g) {
    if (g.flow) return wrap(flowModal(g));
    // Anything that might score sits at the front of the queue: nothing else
    // matters until the player has said what it was worth.
    if ((g.asks || []).length) return wrap(askModal(g));
    if (modal && modal.card !== undefined) return wrap(cardModal(g, modal.card));
    if (modal && modal.acts) return wrap(unitActionsModal(g, modal.acts));
    if (modal && modal.abil) return wrap(abilityInfoModal(g, modal.abil[0], modal.abil[1]));
    if (modal === 'menu') return wrap(menuModal(g));
    if (modal === 'log') return wrap(logModal(g));
    if (modal === 'mission') return wrap(missionModal(g));
    if (modal === 'rules') return wrap(rulesModal());
    if (modal === 'houserules') return wrap(houseRulesModal(g));
    if (modal === 'newbutton') return wrap(newButtonModal(g));
    if (modal && modal.unit) return wrap(unitModal(g, modal.unit));
    if (g.pending && modal !== 'phase-dismissed') return wrap(phaseModal(g));
    if (g.winner !== null && g.winner !== undefined && modal !== 'win-dismissed') {
      return victoryScene(g);
    }
    if (g.gameOver && modal !== 'win-dismissed') return wrap(winModal(g));
    return '';
  }

  /* Lying flat between two players, a window that faces the wrong way is
     useless. Every screen knows who it is talking to, so it turns to them. */
  function modalFacing(g) {
    if (!g) return null;
    if ((g.asks || []).length) return g.asks[0].player;
    const f = g.flow;
    if (f) {
      if (f.kind === 'card') return f.playerId;
      if (f.kind === 'owcheck') {
        const mover = Store.unit(f.moverId);
        return mover ? Store.opponentOf(mover.owner) : g.control.player;
      }
      if (f.kind === 'attack') {
        /* The defender is the one choosing, right up until the roll. */
        const target = f.targetId ? Store.unit(f.targetId) : null;
        if (target && (f.step === 'reaction' || f.step === 'redirect')) return target.owner;
        const atk = f.attackerId ? Store.unit(f.attackerId) : null;
        return atk ? atk.owner : g.control.player;
      }
      const u = f.unitId ? Store.unit(f.unitId) : null;
      if (u) return u.owner;
      return g.control.player;
    }
    if (g.pending) return g.pending.player;
    if (modal && modal.acts) {
      const u = Store.unit(modal.acts);
      if (u) return u.owner;
    }
    if (modal && modal.card !== undefined) return modal.card;
    if (modal && modal.abil) {
      const u = Store.unit(modal.abil[0]);
      if (u) return u.owner;
    }
    if (modal && modal.unit) {
      const u = Store.unit(modal.unit);
      if (u) return u.owner;
    }
    return g.control.player;
  }

  function wrap(inner) {
    const g = G();
    const table = g && g.settings.layout === 'table';
    const facing = table ? modalFacing(g) : null;
    return '<div class="overlay' + (g && g.settings.verbose === false ? ' lean' : '') +
      (table ? ' table face-p' + (facing === 1 ? 1 : 0) : '') +
      '" data-overlay="1"><div class="modal">' + inner + '</div></div>';
  }

  function head(title, step, closeAct) {
    return '<div class="mhead">' +
      '<div><div class="mtitle">' + title + '</div>' +
      (step ? '<div class="mstep">' + step + '</div>' : '') + '</div>' +
      '<button class="mclose" data-act="' + (closeAct || 'close') + '">✕</button>' +
    '</div>';
  }

  /* Pick the unit first, then what it does. */
  function unitActionsModal(g, unitId) {
    const u = Store.unit(unitId);
    if (!u) return '';
    const list = Engine.unitActions(unitId);
    return head(esc(u.name).toUpperCase(), 'WHAT DOES IT DO?') +
      '<div class="mbody">' +
        (list.length ? list.map(function (a) {
          const cost = a.cost === null ? 'X AP' : (a.cost === 0 ? 'FREE' : a.cost + ' AP');
          return '<button class="choice' + (a.available.ok ? '' : ' disabled') +
            '" data-act="unitact:' + unitId + ':' + a.id + '">' +
            '<div class="cmain"><div class="cname">' + esc(a.name) +
              (a.isAbility
                ? ' <span class="ctag abil">SPECIAL ABILITY</span>'
                : ' <span class="ctag ' + (a.kind === 'aggressive' ? 'agg">AGGRESSIVE'
                                                                  : 'pas">PASSIVE') + '</span>') +
              '</div>' +
            '<div class="cdesc tip">' + esc(a.short || a.text) + '</div>' +
            '<div class="cflav leanonly">' + esc(a.flavour || '') + '</div>' +
            (a.isAbility
              ? (a.effects || []).map(e => '<div class="cflav">' + effectSummary(e) +
                  '</div>').join('') +
                '<div class="apnote tip' + (a.opponentReacts ? ' gives' : ' free') + '">' +
                  (a.opponentReacts ? 'Your opponent gets to react.'
                                    : 'No reaction — the action chain ends.') + '</div>'
              : '<div class="apnote tip' + (a.kind === 'aggressive' ? ' agg'
                  : (a.opponentGainsAP > 0 ? ' gives' : ' free')) + '">' +
                  esc(Engine.apConsequence(a)) + '</div>') +
            (a.available.ok ? '' : '<div class="cflav" style="color:var(--bad)">' +
              esc(a.available.why) + '</div>') +
            '</div><div class="ccost' + (a.cost === 0 ? ' free' : '') + '">' + cost + '</div>' +
          '</button>';
        }).join('')
          : '<div class="noteline">Nothing this unit can do right now.</div>') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CLOSE</button></div>';
  }

  /* One passive, spelled out. */
  function abilityInfoModal(g, unitId, abilityId) {
    const u = Store.unit(unitId);
    const a = u && (u.abilities || []).find(x => x.id === abilityId);
    if (!a) return '';
    const trig = RULES.abilityTriggers.find(t => t.id === a.trigger);
    return head(esc(a.name).toUpperCase(), esc(u.name).toUpperCase()) +
      '<div class="mbody">' +
        '<div class="noteline">' + esc(a.text) + '</div>' +
        (trig ? '<div class="noteline tip">' + esc(trig.label) + ' — ' + esc(trig.hint) + '</div>' : '') +
        ((a.effects || []).length
          ? '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;' +
            'margin:10px 0 5px">WHAT THE APP DOES WITH IT</div>' +
            a.effects.map(e => '<div class="noteline">' + effectSummary(e) + '</div>').join('')
          : '') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CLOSE</button></div>';
  }

  /* The full card text, for when someone needs the exact wording. */
  function rulesModal() {
    const block = (title, items, costUnit) =>
      '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
        title + '</div>' +
      items.map(x => '<div class="sub" style="background:#0f161d;margin-bottom:6px">' +
        '<div style="font-weight:800;font-size:13px">' + x.name +
          '<span style="color:var(--gold);font-weight:700;font-size:11px"> · ' +
          (x.cost === null ? 'X' : x.cost) + ' ' + costUnit + '</span>' +
          (x.kind ? ' <span class="ctag ' + (x.kind === 'aggressive' ? 'agg' : 'pas') + '">' +
            x.kind.toUpperCase() + '</span>' : '') + '</div>' +
        '<div style="font-size:11px;color:var(--ink-mute);font-style:italic;margin:2px 0 4px">' +
          esc(x.flavour) + '</div>' +
        '<div style="font-size:12px;color:var(--ink-dim);line-height:1.45">' + esc(x.text) + '</div>' +
      '</div>').join('');

    return head('RULES REFERENCE', 'ACTIONS &amp; REACTIONS') +
      '<div class="mbody">' +
        block('STANDARD ACTIONS', Engine.actionList(), 'AP') +
        block('RANGED REACTIONS', RULES.rangedReactions, 'RP') +
        block('MELEE REACTIONS', RULES.meleeReactions, 'RP') +
        '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
          'ELEVATION</div>' +
        '<div class="noteline">Shooting from higher elevation than the target: <b>+1 to Hit</b>.</div>' +
        '<div class="noteline">Charging from higher elevation: <b>+1 to Wound and +1 Damage</b>.</div>' +
        '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
          'WOUND TABLE</div>' +
        '<div class="noteline">S double or more than T: <b>2+</b> · S greater: <b>3+</b> · ' +
          'S equal: <b>4+</b> · S less: <b>5+</b> · S half or less: <b>6+</b></div>' +
        '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
          'THE ACTION CHAIN</div>' +
        '<div class="noteline">A chain only ends when the action says it ends, or when the player ' +
          'whose <b>turn</b> it is runs out of AP. If the opponent has no AP they simply cannot ' +
          'respond — the chain stays open and play returns to the turn player.</div>' +
        '<div class="noteline">Each weapon may only be used once per action chain. ' +
          'AP carries between turns; unspent RP does not carry between attacks.</div>' +
        '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
          'INTERRUPTED ACTIONS</div>' +
        '<div class="noteline">If an effect interrupts an action so that it cannot be performed — ' +
          'a unit shot off the board mid-move — the action immediately ends. The action chain ' +
          'continues, but nothing that would have come of that action happens, ' +
          '<b>not even gaining AP</b>. The app watches for this and does it for you.</div>' +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CLOSE</button></div>';
  }

  /* ------------------------------------------------------------- phase */

  /* "START: You may spend PSY points on an ability on this card." */
  function cardPowers(g, playerId) {
    const c = g.players[playerId].card;
    if (!c) return '';
    const r = c.resource;
    const list = Engine.cardAbilities(playerId);
    return '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;' +
        'margin:12px 0 6px">' + esc(c.name) + (r ? ' — ' + r.value + ' ' + esc(r.name) : '') +
        '</div>' +
      list.map(function (a) {
        return '<button class="choice' + (a.available.ok ? '' : ' disabled') +
          '" data-act="cardab:' + playerId + ':' + a.id + '">' +
          '<div class="cmain"><div class="cname">' + esc(a.name) + '</div>' +
            '<div class="cdesc">' + esc(a.text) + '</div>' +
            (a.available.ok ? ''
              : '<div class="cflav" style="color:var(--bad)">' + esc(a.available.why) + '</div>') +
          '</div><div class="ccost">' + (Number(a.cost) || 0) +
            (r ? ' ' + esc(r.name) : '') + '</div></button>';
      }).join('');
  }

  function phaseModal(g) {
    const p = g.pending;
    const isStart = p.type === 'start';
    const fired = p.fired || [];
    const abils = [];
    Store.unitsOf(p.player, true).forEach(function (u) {
      (u.abilities || []).filter(a => a.trigger === (isStart ? 'start' : 'end')).forEach(function (a) {
        abils.push({ u: u, a: a, done: fired.indexOf(a.id) >= 0 });
      });
    });

    return head(isStart ? 'START PHASE' : 'END PHASE', esc(g.players[p.player].name), 'dismissphase') +
      '<div class="mbody">' +
        (abils.length
          ? '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin-bottom:6px">' +
            (isStart ? 'START:' : 'END:') + ' ABILITIES — fire them in any order</div>' +
            abils.map(x => '<button class="choice' + (x.done ? ' disabled' : '') +
              '" data-act="phaseab:' + x.u.id + ':' + x.a.id + '">' +
              '<div class="cmain"><div class="cname">' + esc(x.a.name) + '</div>' +
              '<div class="cdesc">' + esc(x.u.name) + ' — ' + esc(x.a.text) + '</div></div>' +
              (x.done ? '<div class="ccost free">USED</div>' : '') +
            '</button>').join('')
          : '<div class="noteline">No ' + (isStart ? 'START:' : 'END:') + ' abilities on ' +
             esc(g.players[p.player].name) + '\'s units.</div>') +

        (isStart ? cardPowers(g, p.player) : '') +

        (isStart
          ? '<div class="noteline warn">' + esc(g.players[p.player].name) +
              ' gains 1 AP for the Start Phase (they will have ' + (g.players[p.player].ap + 1) + ' AP).</div>'
          : missionCheck(g)) +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn primary" data-act="' + (isStart ? 'confirmStart' : 'confirmEnd') + '">' +
          (isStart ? 'GAIN 1 AP & BEGIN ACTION PHASE' : 'END TURN') + '</button>' +
      '</div>';
  }

  /* End of turn. Everything the app watched, it scores itself; the one or two
     facts it cannot see from here it asks about — and the VP that follows is
     still the card's number. */
  function missionCheck(g) {
    const m = Engine.missionCard();
    const items = Engine.missionEndTurnItems();
    return '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
        (m ? 'MISSION — ' + m.name : 'SCORING') + '</div>' +
      (m ? '<div class="noteline">' + lines(m.objective) + '</div>'
         : '<div class="noteline">No Mission Card, so there is nothing for the app to score. ' +
           'Use the \u00b1 buttons on the score plates for whatever the two of you agreed.</div>') +
      controlPointStrip(g) +
      relicStrip(g) +
      items.map(o => o.mode === 'auto' ? autoScoreRow(g, o) : askScoreRow(g, o)).join('') +
      (m && !items.length
        ? '<div class="noteline">Nothing is scored at the end of a turn in this mission — its VP ' +
          'comes from what happens on the table, and the app has been counting.</div>'
        : '');
  }

  /* The app worked this one out: it says what it will score, and why. */
  function autoScoreRow(g, o) {
    /* Only the player whose turn is ending takes anything from an objective. */
    const me = Engine.endTurnScorer();
    const mine = (o.award || [])[me] || 0;
    const theirs = (o.award || [])[Store.opponentOf(me)] || 0;
    return '<div class="scorerow' + (mine > 0 ? ' scoring' : '') + '">' +
      '<div class="srhead"><span class="srname">' + esc(o.name) + '</span>' +
        '<span class="srtag auto">COUNTED FOR YOU</span></div>' +
      (o.text ? '<div class="srtext tip">' + esc(o.text) + '</div>' : '') +
      '<div class="srawards">' +
        g.players.map(function (pl, i) {
          const n = o.award[i] || 0;
          const counts = i === me;
          return '<div class="sraward p' + i + (counts && n > 0 ? ' on' : '') +
            (counts ? '' : ' idle') + '"><span class="v">+' + (counts ? n : 0) + '</span> VP · ' +
            esc(pl.name) + '</div>';
        }).join('') +
      '</div>' +
      '<div class="srfoot">' + (mine > 0
        ? 'Scored when you end the turn.'
        : (theirs > 0
            ? esc(g.players[Store.opponentOf(me)].name) + ' holds it, but only ' +
              esc(g.players[me].name) + ' scores at the end of their own turn.'
            : 'Nobody scores this one this turn.')) + '</div>' +
    '</div>';
  }

  /* One fact only the players can see. The number is not theirs to choose. */
  function askScoreRow(g, o) {
    const a = o.answer;
    const answered = a !== null && a !== undefined;
    const live = answered && a !== 'none' && a !== false;
    const me = Engine.endTurnScorer();
    const btn = (val, label, on) =>
      '<button class="btn sm' + (on ? ' primary' : '') + '" style="flex:1 1 30%" ' +
        'data-act="objans:' + o.id + ':' + val + '">' + label + '</button>';
    const carrier = Engine.relicCarrier();
    const who = (o.scorer === 'relicCarrier' && carrier)
      ? esc((Store.unit(carrier) || {}).name) + ' is carrying it' : '';
    return '<div class="scorerow' + (live ? ' scoring' : (answered ? '' : ' unanswered')) + '">' +
      '<div class="srhead"><span class="srname">' + esc(o.name) + '</span>' +
        '<span class="srtag ' + (answered ? 'auto' : 'ask') + '">' +
        (answered ? 'ANSWERED' : 'ONLY YOU CAN SEE THIS') + '</span></div>' +
      (o.text ? '<div class="srtext tip">' + esc(o.text) + '</div>' : '') +
      '<div class="srq">' + esc(o.question) + (who ? ' <b>' + who + '.</b>' : '') + '</div>' +
      '<div class="srtext tip">Only ' + esc(g.players[me].name) + ' scores at the end of ' +
        'their own turn — answer it truthfully either way.</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        (o.ask === 'yesno'
          ? btn('yes', 'YES — ' + o.vp + ' VP', a === true) + btn('no', 'NOT YET', a === false)
          : g.players.map((pl, i) => btn(String(i), esc(pl.name) + ' · ' + o.vp + ' VP',
              a === i)).join('') + btn('none', 'NOBODY', a === 'none')) +
      '</div>' +
    '</div>';
  }


  function controlPointStrip(g) {
    const cps = (g.mission && g.mission.controlPoints) || [];
    if (!cps.length) return '';
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
      cps.map(c => '<div class="cpchip' + (c.controller === null || c.controller === undefined
          ? '' : ' held p' + c.controller) + '">' +
        '<b>' + esc(c.label) + '</b>' +
        (c.controller === null || c.controller === undefined
          ? 'unclaimed' : esc(g.players[c.controller].name)) + '</div>').join('') +
    '</div>';
  }

  function relicStrip(g) {
    if (!g.mission || !g.mission.relic) return '';
    const cid = g.mission.relic.carrier;
    const u = cid ? Store.unit(cid) : null;
    return '<div class="cpchip' + (u ? ' held p' + u.owner : '') + '" style="margin-bottom:8px">' +
      '<b>RELIC</b>' + (u ? esc(u.name) + ' is carrying it' : 'on the ground, unclaimed') + '</div>';
  }

  /* The only VP question left in the app: not "how many?" but "where did that
     happen?". The card supplies the number either way. */
  function askModal(g) {
    const q = g.asks[0];
    if (q.kind !== 'killzone') return '';
    return head('ONE THING THE APP CANNOT SEE', esc(g.players[q.player].name).toUpperCase()) +
      '<div class="mbody">' +
        '<div class="rollbox">' +
          '<div class="lbl">' + esc(q.victim).toUpperCase() + ' WAS DESTROYED</div>' +
          '<div class="big" style="font-size:19px">In ' + esc(q.zone) + '?</div>' +
          '<div class="sub">The card scores ' + q.yes + ' VP if it was and ' + q.no +
            ' VP if it was not. Only you can see the board.</div>' +
        '</div>' +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn" data-act="askans:0">NO — ' + q.no + ' VP</button>' +
        '<button class="btn primary" data-act="askans:1">YES — ' + q.yes + ' VP</button>' +
      '</div>';
  }


  /* =============================================================== FLOWS */

  /* Something moved: which waiting triggers fire, and in what order? */
  function overwatchCheckFlow(g, f) {
    const mover = Store.unit(f.moverId);
    const opts = Engine.overwatchCandidates(f.moverId);
    const order = {};
    f.queue.forEach((q, i) => { order[q.abilityId || q.tokenId] = i + 1; });
    return head('MOVEMENT', 'DOES ANYTHING FIRE?') +
      '<div class="crumbs"><b>' + esc(mover ? mover.name : '?') + '</b> moved</div>' +
      '<div class="mbody">' +
        '<div class="noteline tip">You can see the table — did that movement bring ' +
          esc(mover ? mover.name : 'them') + ' into range of any of these? Tap them in the order ' +
          'you want them resolved.</div>' +
        opts.map(function (o) {
          const key = o.abilityId || o.tokenId;
          const n = order[key];
          return '<button class="choice p' + o.owner + (n ? ' sel' : '') +
            '" data-act="owpick:' + o.unitId + ':' + key + ':' + (o.abilityId ? 'a' : 't') + '">' +
            '<div class="cmain"><div class="cname">⌖ ' + esc(o.label) +
              (o.abilityId ? ' <span class="ctag abil">ABILITY</span>' : '') + '</div>' +
            '<div class="cdesc">' + esc(o.unitName) + ' · ' + esc(g.players[o.owner].name) +
            '</div>' +
            (o.text ? '<div class="cflav">' + esc(o.text) + '</div>' : '') + '</div>' +
            '<div class="ccost' + (n ? '' : ' free') + '">' + (n ? '#' + n : '—') + '</div>' +
          '</button>';
        }).join('') +
        (f.queue.length
          ? '<div class="noteline warn">They resolve in that order. If ' +
            esc(mover ? mover.name : 'the moving unit') + ' is destroyed partway through, the ' +
            'rest are <b>still spent</b> and whatever it was doing produces nothing — that is ' +
            'the risk of committing more than one.</div>'
          : '<div class="noteline tip">Choose which are firing and risk wasting one, or choose none ' +
            'at all — an unfired token stays on the table.</div>') +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn primary" data-act="owgo">' +
          (f.queue.length ? 'FIRE ' + f.queue.length + ' — IN ORDER' : 'NOTHING FIRES') +
        '</button>' +
      '</div>';
  }

  function flowModal(g) {
    const f = g.flow;
    if (f.kind === 'owcheck') return overwatchCheckFlow(g, f);
    if (f.kind === 'attack')    return attackFlow(g, f);
    if (f.kind === 'ability')   return abilityFlow(g, f);
    if (f.kind === 'overwatch') return overwatchFlow(g, f);
    if (f.kind === 'secure')    return secureFlow(g, f);
    if (f.kind === 'relic')     return relicFlow(g, f);
    if (f.kind === 'simple')    return simpleFlow(g, f);
    if (f.kind === 'pass')      return passFlow(g, f);
    if (f.kind === 'token')     return tokenFlow(g, f);
    if (f.kind === 'card')      return cardFlow(g, f);
    return '';
  }

  function unitChoice(u, act, extra) {
    return '<button class="choice p' + u.owner + '" data-act="' + act + '">' +
      '<div class="cmain"><div class="cname">' + esc(u.name) + '</div>' +
      '<div class="cdesc">' + u.wounds + '/' + u.maxWounds + ' W · T' + u.toughness +
        (extra ? ' · ' + extra : '') + '</div></div>' +
    '</button>';
  }

  function footBack(confirmAct, confirmLabel, cls) {
    return '<div class="mfoot">' +
      '<button class="btn ghost sm" data-act="flowback">BACK</button>' +
      (confirmAct ? '<button class="btn ' + (cls || 'primary') + '" data-act="' + confirmAct + '">' +
        confirmLabel + '</button>' : '') +
    '</div>';
  }

  /* ------------------------------------------------------------- simple */

  function simpleFlow(g, f) {
    const a = RULES.actionById(f.actionId);
    if (f.step === 'unit') {
      return head(a.name, 'SELECT UNIT') +
        '<div class="mbody">' + Engine.eligibleUnits().map(u =>
          unitChoice(u, 'pickunit:' + u.id)).join('') + '</div>' +
        footBack();
    }
    const u = Store.unit(f.unitId);
    return head(a.name, 'CONFIRM') +
      '<div class="mbody">' +
        '<div class="rollbox"><div class="lbl">' + a.name + '</div>' +
          '<div class="big" style="font-size:20px">' + esc(u.name) + '</div>' +
          '<div class="sub">' + esc(a.prompt || a.flavour || '') + '</div></div>' +
        '<div class="noteline tip">Costs ' + a.cost + ' AP. ' +
          (a.endsChain ? 'The action chain ends.' : 'The action chain continues.') + '</div>' +
        (a.expiresOverwatch && (u.tokens || []).some(t => t.kind === 'overwatch')
          ? '<div class="noteline warn">' + esc(u.name) + '\'s OVERWATCH token will be removed.</div>' : '') +
      '</div>' +
      footBack('confirmsimple', 'DONE — ' + a.name);
  }

  function passFlow(g, f) {
    const o = Engine.passOptions();
    const me = esc(g.players[g.control.player].name);
    const other = esc(g.players[Store.opponentOf(g.control.player)].name);
    /* Only asked when both outcomes are on the table. */
    return head('PASS', esc(g.players[g.control.player].ap) + ' AP REMAINING') +
      '<div class="mbody">' +
        '<div class="rollbox"><div class="lbl">PASS TO</div>' +
          '<div class="big" style="font-size:22px">' + other + '</div>' +
          '<div class="sub">' + me + ' has ' + g.players[g.control.player].ap +
            ' AP. End just the action chain, or the whole turn?</div></div>' +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn ghost sm" data-act="close">BACK</button>' +
        '<button class="btn" data-act="confirmpass:0">END THE CHAIN</button>' +
        '<button class="btn primary" data-act="confirmpass:1">END MY TURN</button>' +
      '</div>';
  }

  function passFlowOld(g, f) {
    const o = Engine.passOptions();
    const me = esc(g.players[g.control.player].name);
    return head('PASS', o.wouldEndChain ? 'THE SECOND PASS — THE CHAIN ENDS'
                                        : (o.inChain ? 'DECLINE TO ACT' : 'YOUR TURN')) +
      '<div class="mbody">' +
        (Engine.mustPass()
          ? '<div class="noteline warn">With no AP left, PASS is the only action you can afford. ' +
            'Persistent buttons still work — fire an overwatch token or a card button first if ' +
            'you have one.</div>' : '') +
        (o.inChain
          ? (o.wouldEndChain
              ? '<div class="noteline">' + esc(g.players[Store.opponentOf(g.control.player)].name) +
                ' passed too, so this ends the action chain and play returns to ' +
                esc(g.players[g.turn.player].name) + '.</div>'
              : '<div class="noteline tip">Passing on its own does nothing but decline to act — the ' +
                'chain carries on to ' + esc(g.players[Store.opponentOf(g.control.player)].name) +
                '. If they pass too, the chain ends.</div>')
          : '<div class="noteline tip">No action chain is running. Passing changes nothing unless you ' +
            'also end your turn.</div>') +
        (o.canEndTurn
          ? '<div class="noteline warn">It is your turn, so you may end it here. Nothing else ' +
            'will.</div>' : '') +
        '<div class="noteline tip">' + me + ' currently has ' + g.players[g.control.player].ap +
          ' AP. Anything unspent carries over.</div>' +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn ghost sm" data-act="flowback">BACK</button>' +
        (o.inChain || !o.canEndTurn
          ? '<button class="btn' + (o.canEndTurn ? '' : ' primary') + '" data-act="confirmpass:0">' +
            (o.wouldEndChain ? 'PASS — END THE CHAIN' : 'JUST PASS') + '</button>' : '') +
        (o.canEndTurn
          ? '<button class="btn primary" data-act="confirmpass:1">END MY TURN</button>' : '') +
      '</div>';
  }

  function secureFlow(g, f) {
    if (f.step === 'unit') {
      return head('SECURE', 'SELECT UNIT') +
        '<div class="mbody">' + Engine.eligibleUnits().map(u =>
          unitChoice(u, 'pickunit:' + u.id)).join('') + '</div>' + footBack();
    }
    const cps = (g.mission && g.mission.controlPoints) || [];
    if (f.step === 'point') {
      return head('SECURE', 'WHICH OBJECTIVE?') +
        '<div class="mbody">' +
          '<div class="noteline warn">Two things only you can see: ' +
            esc(Store.unit(f.unitId).name) + ' must be <b>within 3"</b> of it, and your side ' +
            'must have the <b>most OC within 3"</b> of it.</div>' +
          cps.map(c => '<button class="choice" data-act="pickcp:' + c.id + '">' +
            '<div class="cmain"><div class="cname">' + esc(c.label) + '</div>' +
            '<div class="cdesc">' + (c.controller === null || c.controller === undefined
              ? 'Unclaimed' : 'Held by ' + esc(g.players[c.controller].name)) + '</div></div></button>').join('') +
        '</div>' + footBack();
    }
    const cp = cps.find(c => c.id === f.cpId);
    return head('SECURE', 'CONFIRM') +
      '<div class="mbody">' +
        '<div class="rollbox"><div class="lbl">' + esc(Store.unit(f.unitId).name) + '</div>' +
          '<div class="big" style="font-size:20px">' + esc(cp ? cp.label : '') + '</div>' +
          '<div class="sub">It stays yours until an enemy SECURES it.</div></div>' +
        '<div class="noteline warn">Within 3", and the most OC within 3". You have checked both.</div>' +
        '<div class="noteline tip">Costs 1 AP. At the end of each turn you score 1 VP for every ' +
          'objective you hold — the app will count them for you.</div>' +
      '</div>' +
      footBack('confirmsecure', 'SECURE IT — 1 AP');
  }

  function relicFlow(g, f) {
    if (f.step === 'unit') {
      return head('THE RELIC', 'WHO PICKS IT UP?') +
        '<div class="mbody">' + Engine.eligibleUnits().map(u =>
          unitChoice(u, 'pickunit:' + u.id)).join('') + '</div>' + footBack();
    }
    return head('THE RELIC', 'CONFIRM') +
      '<div class="mbody">' +
        '<div class="rollbox"><div class="lbl">PICK UP THE RELIC</div>' +
          '<div class="big" style="font-size:20px">' + esc(Store.unit(f.unitId).name) + '</div>' +
          '<div class="sub">You have checked it is within 3" on the table.</div></div>' +
        '<div class="noteline warn">While carrying the RELIC this unit cannot use OVERWATCH. ' +
          'If it is destroyed, the RELIC drops where it fell.</div>' +
        '<div class="noteline tip">Get it to your own side of the battlefield to score 3 VP and end ' +
          'the game — tell the app in the End Phase when that happens.</div>' +
      '</div>' +
      footBack('confirmrelic', 'TAKE IT — 1 AP');
  }

  function overwatchFlow(g, f) {
    if (f.step === 'unit') {
      return head('OVERWATCH', 'SELECT UNIT') +
        '<div class="mbody">' + Engine.eligibleUnits().map(u =>
          unitChoice(u, 'pickunit:' + u.id)).join('') + '</div>' + footBack();
    }
    const u = Store.unit(f.unitId);
    const ranged = (u.weapons || []).filter(w => w.type === 'ranged');
    return head('OVERWATCH', 'CONFIRM') +
      '<div class="mbody">' +
        '<div class="rollbox"><div class="lbl">TOKEN</div><div class="big" style="font-size:20px">' +
          esc(u.name) + '</div>' +
          '<div class="sub">Place an overwatch token within 12" of this unit.</div></div>' +
        '<div class="noteline tip">A <b>⌖ FIRE OVERWATCH</b> button appears on ' + esc(u.name) +
          '\u2019s card. When an enemy moves within 3" of the token and is a legal target, press ' +
          'it to interrupt — the app never decides that.</div>' +
        '<div class="noteline tip">You interrupt and resolve a shoot sequence at <b>-1 to hit</b>, ' +
          'skipping steps 2 and 3 — so <b>the defender gains no RP</b>. Any of ' +
          esc(u.name) + '\u2019s ranged weapons may be used' +
          (ranged.length ? '' : ' — but this unit has none!') + '.</div>' +
        '<div class="noteline warn">Removed the moment this unit moves or attacks.</div>' +
      '</div>' +
      footBack('confirmoverwatch', 'PLACE TOKEN — 1 AP');
  }

  /* ------------------------------------------------------------ ability */

  function abilityFlow(g, f) {
    if (f.step === 'unit') {
      return head('SPECIAL ABILITY', 'SELECT UNIT') +
        '<div class="mbody">' + Engine.eligibleUnits()
          .filter(u => Engine.usableAPAbilities(u).length)
          .map(u => unitChoice(u, 'pickunit:' + u.id,
            Engine.usableAPAbilities(u).length + ' ready')).join('') + '</div>' + footBack();
    }
    const u = Store.unit(f.unitId);
    if (f.step === 'ability') {
      const list = Engine.usableAPAbilities(u);
      return head('SPECIAL ABILITY', esc(u.name).toUpperCase()) +
        '<div class="mbody">' + list.map(a =>
          '<button class="choice" data-act="pickab:' + a.id + '">' +
            '<div class="cmain"><div class="cname">' + esc(a.name) + '</div>' +
            '<div class="cdesc">' + esc(a.text) + '</div>' +
            (a.effects || []).map(e => '<div class="cflav">' + effectSummary(e) + '</div>').join('') +
            '<div class="apnote' + (Engine.abilityLetsThemReact(a) ? ' gives' : ' free') + '">' +
              (Engine.abilityLetsThemReact(a) ? 'Your opponent gets to react.'
                                              : 'No reaction — the chain ends.') + '</div>' +
            '</div><div class="ccost">' + a.cost + ' AP</div></button>').join('') +
        '</div>' + footBack();
    }
    const ab = Engine.findAbility(f.unitId, f.abilityId);
    if (f.step === 'roll') return rollFlow(g, f, esc(ab.name), '');
    if (f.step === 'pick') {
      const needs = Engine.effectsNeedingTarget(ab, { sourceUnitId: f.unitId });
      const e = needs[f.pickIndex] || needs.find(x => !f.targets[x.id]) || needs[0];
      if (e.pick === 'multi') {
        return multiPick(g, f, e, 'picktarget', esc(ab.name),
          'Everyone in range rolls. Tick the ones that failed.');
      }
      /* At the start of the game there is no chain to return to and nothing to
         confirm — the pick IS the whole ability. */
      return head(esc(ab.name), f.setupStep
          ? 'BEFORE THE FIRST TURN — ' + esc(u.name).toUpperCase()
          : 'SELECT TARGET — ' + effectSummary(e).toUpperCase()) +
        '<div class="mbody">' +
          (f.setupStep ? '<div class="noteline">' + esc(ab.text) + '</div>' : '') +
          pickableUnits(g, e, u.owner)
            .map(x => unitChoice(x, 'picktarget:' + e.id + ':' + x.id,
              x.owner === u.owner ? 'friendly' : 'enemy')).join('') +
        '</div>' + (f.setupStep ? '' : footBack());
    }
    return head(esc(ab.name), 'CONFIRM') +
      '<div class="mbody">' +
        '<div class="rollbox"><div class="lbl">' + esc(u.name) + '</div>' +
          '<div class="big" style="font-size:20px">' + esc(ab.name) + '</div>' +
          '<div class="sub">' + esc(ab.text) + '</div></div>' +
        (ab.effects || []).map(e => '<div class="noteline">' + effectSummary(e) +
          targetNames(f.targets[e.id]) + '</div>').join('') +
        /* AP and the action chain only exist when this is a Standard Action.
           A free ability — a card button, or one that resolves itself at the
           start of the game — costs nothing and interrupts nothing. */
        (f.freeUse ? ''
          : '<div class="noteline warn">Costs ' + ab.cost + ' AP. ' +
            (Engine.abilityLetsThemReact(ab)
              ? 'Your opponent gets to react — the chain continues, and they may answer with ' +
                'any unit if they have the AP.'
              : 'Your opponent does not get to react — the action chain ends here.') + '</div>') +
      '</div>' +
      footBack('confirmability', 'USE ABILITY');
  }

  /* One roll each: tick everyone the dice went against. */
  /* An effect may say whose units it can pick — "choose one enemy unit". */
  function pickableUnits(g, e, mineOwner) {
    const side = e.side || 'any';
    /* A unit in RESERVE is not on the battlefield, so it cannot be shot,
       healed or marked. A teleport is the exception — that is what fetches it. */
    const allowReserve = e.kind === 'place';
    return g.units.filter(function (x) {
      if (!x.alive) return false;
      if (x.reserve && !allowReserve) return false;
      if (side === 'enemy') return x.owner !== mineOwner;
      if (side === 'friendly') return x.owner === mineOwner;
      return true;
    });
  }

  /* Abilities belong to a unit, card powers belong to a player. */
  const flowOwner = f => (f.playerId !== undefined && f.playerId !== null)
    ? f.playerId : (Store.unit(f.unitId) || {}).owner;

  function multiPick(g, f, e, actPrefix, title, sub) {
    const chosen = Array.isArray(f.targets[e.id]) ? f.targets[e.id] : [];
    return head(title, 'WHICH UNITS? — ' + effectSummary(e).toUpperCase()) +
      '<div class="mbody">' +
        '<div class="noteline">' + sub + '</div>' +
        pickableUnits(g, e, flowOwner(f)).map(function (x) {
          const on = chosen.indexOf(x.id) >= 0;
          return '<button class="choice p' + x.owner + (on ? ' sel' : '') +
            '" data-act="' + actPrefix + ':' + e.id + ':' + x.id + '">' +
            '<div class="cmain"><div class="cname">' + esc(x.name) + '</div>' +
            '<div class="cdesc">' + x.wounds + '/' + x.maxWounds + ' W · ' +
              esc(g.players[x.owner].name) + '</div></div>' +
            '<div class="ccost' + (on ? '' : ' free') + '">' + (on ? 'HIT' : '—') + '</div>' +
          '</button>';
        }).join('') +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn ghost sm" data-act="flowback">BACK</button>' +
        '<button class="btn primary" data-act="donetargets">' +
          (chosen.length ? 'THAT\u2019S ALL ' + chosen.length : 'NONE OF THEM') + '</button>' +
      '</div>';
  }

  function effectSummary(e) {
    if (!e) return '';
    const v = Number(e.value) || 0;
    const sign = v > 0 ? '+' : '';
    switch (e.kind) {
      case 'ap_self': return 'Gain ' + v + ' AP';
      case 'ap_opponent': return 'Opponent gains ' + v + ' AP';
      case 'ap_drain': return 'Opponent loses ' + v + ' AP';
      case 'rp_self': return 'Gain ' + v + ' RP';
      case 'vp_self': return 'Score ' + v + ' VP';
      case 'vp_opponent': return 'Opponent scores ' + v + ' VP';
      case 'damage': return 'Deal ' + v + ' damage';
      case 'heal': return 'Restore ' + v + ' wounds';
      case 'mod_hit': return sign + v + ' to Hit rolls (' + durLabel(e.duration) + ')';
      case 'mod_wound': return sign + v + ' to Wound rolls (' + durLabel(e.duration) + ')';
      case 'token': return 'Place [ ' + (e.label || 'TOKEN') + ' ]';
      case 'place': return (e.pick === 'self' ? 'Place this unit' :
        (e.max ? 'Place up to ' + e.max + ' units' : 'Place a unit')) + ' anywhere' +
        (e.fromReserve ? ' (arrives from reserve)' : '') +
        (e.noMoveThisTurn ? ' — it may not MOVE this turn' : '');
      case 'dice': return 'Roll ' + (v || 2) + ' dice with ' + (e.weaponName || 'that weapon');
      case 'mod_move': return sign + v + '" MOV (' + durLabel(e.duration) + ')';
      case 'mark': return 'Mark a unit' + (e.label ? ' — ' + e.label : '');
      case 'unmark': return 'Clear ' + (e.label || 'MARKED') + ' from enemy units';
      case 'blockreact': return 'Blocks ' + String(e.reaction || '').toUpperCase() +
        (e.weaponName ? ' when using its ' + e.weaponName : '');
      case 'stat': return sign + v + ' ' + String(e.stat || 'OC').toUpperCase() + ' permanently';
      case 'note': return e.text || 'Reminder';
    }
    return e.kind;
  }

  function targetNames(t) {
    if (!t) return '';
    const list = Array.isArray(t) ? t : [t];
    if (!list.length) return ' → <b>nobody</b>';
    return ' → <b>' + list.map(id => {
      const u = Store.unit(id);
      return esc(u ? u.name : '?');
    }).join(', ') + '</b>';
  }

  function durLabel(id) {
    const d = RULES.durations.find(x => x.id === id);
    return d ? d.label.toLowerCase() : id;
  }

  /* -------------------------------------------------------------- token */

  function tokenFlow(g, f) {
    const u = Store.unit(f.unitId);
    const t = (u.tokens || []).find(x => x.id === f.tokenId);
    if (!t) return '';
    const effects = Engine.tokenEffects(f.unitId, f.tokenId);
    if (f.step === 'pick') {
      const needs = Engine.effectsNeedingTarget({ effects: effects }, { sourceUnitId: f.unitId });
      const e = needs[f.pickIndex] || needs.find(x => !f.targets[x.id]) || needs[0];
      if (e.pick === 'multi') {
        return multiPick(g, f, e, 'tokentarget', '[ ' + esc(t.label) + ' ]',
          esc(t.text || 'Everyone in range rolls. Tick the ones that failed.'));
      }
      return head('[ ' + esc(t.label) + ' ]', 'WHICH UNIT — ' + effectSummary(e).toUpperCase()) +
        '<div class="mbody">' + pickableUnits(g, e, u.owner)
          .map(x => unitChoice(x, 'tokentarget:' + e.id + ':' + x.id)).join('') + '</div>' +
        '<div class="mfoot"><button class="btn ghost" data-act="close">CANCEL</button></div>';
    }
    return head('[ ' + esc(t.label) + ' ]', 'RESOLVE') +
      '<div class="mbody">' +
        (t.text ? '<div class="noteline">' + esc(t.text) + '</div>' : '') +
        (effects.length
          ? effects.map(e => '<div class="noteline">' + effectSummary(e) +
              targetNames(f.targets[e.id]) + '</div>').join('')
          : '<div class="noteline tip">This token has no stored mechanical effects — it is a reminder only. ' +
            'Adjust wounds or AP by hand if needed.</div>') +
        (t.expiry === 'used' ? '<div class="noteline warn">The button is removed after this.</div>' : '') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost sm" data-act="close">CANCEL</button>' +
      '<button class="btn primary" data-act="confirmtoken">RESOLVE</button></div>';
  }

  /* ------------------------------------------------------------- attack */

  /* Auras are radii the app cannot measure, so each one that could apply is a
     toggle next to the roll it would change. */
  function auraToggles(f, stats) {
    const want = [].concat(stats);
    const list = Engine.applicableAuras(f).filter(a => want.indexOf(a.stat) >= 0);
    if (!list.length) return '';
    const auto = list.filter(a => a.always);
    const ask = list.filter(a => !a.always);
    return (auto.length
      ? '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;' +
          'margin:10px 0 5px">ALWAYS ON</div>' +
        auto.map(a => '<div class="noteline warn"><b>' + esc(a.unit) + ' — ' + esc(a.source) +
          '</b><br>' + esc(a.text || a.label) + '</div>').join('')
      : '') +
      (ask.length
        ? '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;' +
            'margin:10px 0 5px">AURAS IN RANGE?</div>' +
          ask.map(a => '<button class="toggle' + (f.auras && f.auras[a.key] ? ' on' : '') +
            '" data-act="aura:' + a.key + '">' +
            '<span class="box">' + (f.auras && f.auras[a.key] ? '✓' : '') + '</span>' +
            '<span><b>' + esc(a.unit) + ' — ' + esc(a.source) + '</b><br>' +
            '<span style="color:var(--ink-dim);font-size:11.5px">' +
              esc(a.text || a.label) + '</span></span></button>').join('')
        : '');
  }

  /* High ground is a tabletop fact, so the player tells the app about it. */
  function elevToggle(f, action) {
    if (!action.elevation) return '';
    const label = action.elevation === 'shoot'
      ? 'Attacker is higher in elevation than the target (+1 to Hit)'
      : 'Charging down from higher elevation (+1 to Wound, +1 Damage)';
    return '<button class="toggle' + (f.elevation ? ' on' : '') + '" data-act="elev">' +
      '<span class="box">' + (f.elevation ? '✓' : '') + '</span><span>' + label + '</span></button>';
  }

  /* "Rolls 4 dice instead of one if this unit has not moved this turn." The app
     knows whether it moved, so it answers for you — and you can overrule it. */
  function diceToggles(f) {
    return Engine.diceOptions(f).map(function (o) {
      const on = o.auto || !!(f.diceOn || {})[o.key];
      const label = o.label + ' — roll ' + o.value + ' dice' +
        (o.condition ? ' (' + o.condition + ')' : '');
      if (o.auto) {
        return '<div class="toggle on locked"><span class="box">✓</span><span>' + esc(label) +
          ' — bought and paid for</span></div>';
      }
      return '<button class="toggle' + (on ? ' on' : '') + '" data-act="dice:' + o.key + '">' +
        '<span class="box">' + (on ? '✓' : '') + '</span><span>' + esc(label) + '</span></button>';
    }).join('');
  }

  /* "How many of them landed?" — a keypad from 0 to N. */
  function countPad(act, max) {
    let out = '<div class="numpad wide">';
    for (let i = 0; i <= max; i++) {
      out += '<button data-act="' + act + ':' + i + '">' + i + '</button>';
    }
    return out + '</div>';
  }

  /* "Roll 1D6 and move that far." The app cannot roll for you, so it stops,
     says what to roll and why, and takes the number for the record. */
  function rollFlow(g, f, title, crumb) {
    const die = f.rollDie || 6;
    const count = f.rollCount || 1;
    const pad = [];
    for (let i = count; i <= count * die; i++) {
      pad.push('<button data-act="roll:' + i + '">' + i + '</button>');
    }
    const charge = f.kind === 'attack';
    return head(title, 'ROLL THE DICE') + (crumb || '') +
      '<div class="mbody">' +
        '<div class="rollbox">' +
          '<div class="lbl">ROLL</div>' +
          '<div class="big">' + count + 'D' + die + '</div>' +
          '<div class="sub">for ' + esc(f.rollWhat || 'this action') + '</div>' +
        '</div>' +
        (f.rollNote ? '<div class="noteline">' + esc(f.rollNote) + '</div>' : '') +
        '<div class="noteline tip">Roll it on the table and tap what you got — the app only ' +
          'keeps it for the record.</div>' +
        '<div class="numpad wide">' + pad.join('') + '</div>' +
      '</div>' +
      (charge
        ? '<div class="mfoot">' +
            '<button class="btn ghost sm" data-act="flowback">BACK</button>' +
            '<button class="btn bad" data-act="chargefailed">COULD NOT REACH</button>' +
          '</div>'
        : '<div class="mfoot"><button class="btn ghost sm" data-act="flowback">BACK</button></div>');
  }

  function attackFlow(g, f) {
    const action = RULES.actionById(f.actionId);
    const isOW = f.source === 'overwatch';
    const title = isOW ? 'OVERWATCH — ' + esc((Store.unit(f.attackerId) || {}).name || '')
                       : (f.source === 'free' ? esc(f.freeLabel || 'FREE ATTACK') : action.name);
    const attacker = f.attackerId ? Store.unit(f.attackerId) : null;
    const target = f.targetId ? Store.unit(f.targetId) : null;

    let stack = '';
    for (let p = f.resumeFlow, depth = 1; p; p = p.resumeFlow, depth++) {
      stack += '<div style="color:var(--ink-mute);font-size:10.5px">' +
        '↑ waiting: ' + esc((Store.unit(p.attackerId) || {}).name || '?') + ' → ' +
        esc((Store.unit(p.targetId) || {}).name || '?') + '</div>';
    }
    const crumb = '<div class="crumbs">' +
      (attacker ? '<b>' + esc(attacker.name) + '</b>' : 'attacker') + ' → ' + title +
      (target ? ' → <b>' + esc(target.name) + '</b>' : '') +
      (f.weaponId && attacker ? ' · ' + esc((attacker.weapons.find(w => w.id === f.weaponId) || {}).name) : '') +
      stack +
    '</div>';

    if (f.step === 'attacker') {
      return head(title, 'SELECT ATTACKING UNIT') + crumb +
        '<div class="mbody">' + Engine.eligibleUnits().map(u =>
          unitChoice(u, 'pickunit:' + u.id,
            Engine.weaponsFor(u.id, action.attackRange).length + ' ' +
            action.attackRange + ' weapon(s) ready')).join('') + '</div>' + footBack();
    }

    if (f.step === 'roll') return rollFlow(g, f, title, crumb);

    /* DUCK: the one attack that can end before the dice, and only the two of
       you can see whether it does. */
    if (f.step === 'los') {
      const why = f.losReaction === 'DUCK'
        ? 'If your opponent cannot see this unit\u2019s base with their LOS, the attack ' +
          'cannot be resolved.'
        : 'If that move takes this unit out of it, the attack cannot be resolved.';
      return head(title, 'CAN THE ATTACK STILL BE RESOLVED?') + crumb +
        '<div class="mbody">' +
          '<div class="rollbox">' +
            '<div class="lbl">' + esc(f.losReaction || 'THE REACTION') + ' \u2014 ' +
              esc((attacker || {}).name || '').toUpperCase() + ' LOOKS FOR</div>' +
            '<div class="big" style="font-size:22px">' + esc((target || {}).name || '') + '</div>' +
            '<div class="sub">' + esc(why) + '</div>' +
          '</div>' +
          '<div class="noteline tip">Nothing comes of an attack that cannot be resolved — no ' +
            'damage, no VP, and not even the AP the target would have gained. The action chain ' +
            'carries on.</div>' +
        '</div>' +
        '<div class="mfoot">' +
          '<button class="btn bad" data-act="los:0">NO — IT IS OVER</button>' +
          '<button class="btn good" data-act="los:1">YES — CARRY ON</button>' +
        '</div>';
    }

    if (f.step === 'target') {
      // A unit in RESERVE is not on the table, so it cannot be shot at.
      const enemies = g.units.filter(u => u.alive && !u.reserve && u.owner !== attacker.owner);
      return head(title, 'SELECT DEFENDING UNIT') + crumb +
        '<div class="mbody">' +
          '<div class="noteline tip">You have already checked range and line of sight on the table. ' +
            'The app just needs to know who is being attacked.</div>' +
          enemies.map(u => unitChoice(u, 'picktargetunit:' + u.id)).join('') +
        '</div>' + footBack();
    }

    if (f.step === 'weapon') {
      const list = Engine.weaponsFor(f.attackerId, action.attackRange);
      return head(title, 'SELECT WEAPON') + crumb +
        '<div class="mbody">' +
          (list.length ? '' : '<div class="noteline warn">This unit has no ' + action.attackRange +
            ' weapons. Add one in the roster editor, or cancel.</div>') +
          list.map(w => '<button class="choice' +
            '" data-act="pickweapon:' + w.id + '">' +
            '<div class="cmain"><div class="cname">' + esc(w.name) +
              (w.primary ? ' <span class="ctag">PRIMARY</span>' : '') + '</div>' +
            '<div class="cdesc">Hit ' + w.hit + '+ · Strength ' + w.strength + ' · Damage ' + w.damage +
              '</div></div></button>').join('') +
        '</div>' + footBack();
    }

    if (f.step === 'reaction') {
      const range = action.attackRange;
      const list = range === 'melee' ? RULES.meleeReactions : RULES.rangedReactions;
      const defPlayer = target.owner;
      const rp = g.players[defPlayer].rp;
      /* Some RP reactions only answer one kind of attack — Kwik Dakka shoots
         back, which is no use with an enemy already in melee with you. */
      const specials = (target.abilities || []).filter(a => a.trigger === 'rp' &&
        (Number(a.cost) || 0) <= rp &&
        (!a.reactRange || a.reactRange === 'any' || a.reactRange === range));

      const wpn = attacker && (attacker.weapons || []).find(w => w.id === f.weaponId);
      const blocked = Engine.blockedReactions(target.id, f.attackerId, wpn);
      return head(esc(g.players[defPlayer].name) + ' REACTS',
        (range === 'melee' ? 'MELEE' : 'RANGED') + ' REACTION · ' + rp + ' RP') + crumb +
        '<div class="mbody">' +
          list.filter(r => !r.isSpecial).map(r =>
            '<button class="choice' + (r.cost > rp ? ' disabled' : '') + '" data-act="reaction:' + r.id + '">' +
              '<div class="cmain"><div class="cname">' + r.name +
                (blocked[r.id] ? ' <span class="ctag agg">BLOCKED</span>' : '') + '</div>' +
              '<div class="cdesc tip">' + esc(r.text) + '</div>' +
              (blocked[r.id]
                ? '<div class="cflav" style="color:var(--bad)">' + esc(blocked[r.id]) +
                  ' — tap only if you agree it applies.</div>'
                : '<div class="cflav">' + esc(r.flavour) + '</div>') + '</div>' +
              '<div class="ccost">' + r.cost + ' RP</div></button>').join('') +
          specials.map(a =>
            '<button class="choice" data-act="reactionsp:' + a.id + '">' +
              '<div class="cmain"><div class="cname">SPECIAL RP — ' + esc(a.name) + '</div>' +
              '<div class="cdesc">' + esc(a.text) + '</div>' +
              (a.effects || []).map(e => '<div class="cflav">' + effectSummary(e) + '</div>').join('') +
              '</div><div class="ccost">' + a.cost + ' RP</div></button>').join('') +
          '<button class="choice" data-act="reaction:none">' +
            '<div class="cmain"><div class="cname">NO REACTION</div>' +
            '<div class="cdesc tip">Spend nothing and take the attack as it comes. ' +
              'Unspent RP does not carry over.</div></div>' +
            '<div class="ccost free">0 RP</div></button>' +
        '</div>' +
        '<div class="mfoot"><button class="btn ghost sm" data-act="flowback">BACK</button></div>';
    }

    if (f.step === 'redirect') {
      const friends = g.units.filter(u => u.alive && !u.reserve &&
        u.owner === target.owner && u.id !== target.id);
      return head('REDIRECT', 'WHICH UNIT IS HIT INSTEAD?') + crumb +
        '<div class="mbody">' +
          '<div class="noteline">Choose one of your units that would be an eligible target for ' +
            'this attack. You have checked that on the table.</div>' +
          (friends.length ? friends.map(u => unitChoice(u, 'redirect:' + u.id)).join('')
            : '<div class="noteline warn">No other friendly unit to take the hit.</div>') +
          '<button class="choice" data-act="redirect:' + target.id + '">' +
            '<div class="cmain"><div class="cname">KEEP THE ORIGINAL TARGET</div>' +
            '<div class="cdesc">' + esc(target.name) + ' takes it after all.</div></div></button>' +
        '</div>' +
        '<div class="mfoot"><button class="btn ghost sm" data-act="flowback">BACK</button></div>';
    }

    const n = Engine.attackNumbers();

    if (f.step === 'hit') {
      const modTxt = n.hitMod === 0 ? 'no modifiers'
        : (n.hitMod > 0 ? '+' : '') + n.hitMod + ' to the roll';
      const multi = n.dice > 1;
      return head(title, 'HIT ROLL') + crumb +
        '<div class="mbody">' +
          '<div class="rollbox">' +
            '<div class="lbl">ROLL ' + n.dice + ' DICE — ' +
              (multi ? 'EACH NEEDS' : 'YOU NEED') + '</div>' +
            '<div class="big">' + n.hitTarget + '+</div>' +
            '<div class="sub">' + esc(n.weapon.name) + ' hits on ' + n.baseHit + '+ · ' + modTxt +
              (n.hitCapped ? ' <span style="color:var(--warn)">(capped at the edge of the die)</span>' : '') +
            '</div>' +
            (f.notes.length ? '<div class="modline">' + f.notes.map(esc).join('<br>') + '</div>' : '') +
          '</div>' +
          diceToggles(f) +
          elevToggle(f, action) +
          auraToggles(f, 'hit') +
          (multi
            ? '<div class="noteline">Roll all ' + n.dice + ', then tap how many hit.</div>' +
              countPad('hits', n.dice)
            : '<div class="noteline tip">Roll it on the table, then tell the app what happened.</div>') +
        '</div>' +
        (multi ? '' :
        '<div class="mfoot">' +
          '<button class="btn bad" data-act="hit:0">MISS</button>' +
          '<button class="btn good" data-act="hit:1">HIT</button>' +
        '</div>');
    }

    if (f.step === 'wound' && (f.hits || 0) > 1) {
      const modTxt = n.woundMod === 0 ? 'no modifiers'
        : (n.woundMod > 0 ? '+' : '') + n.woundMod + ' to the roll';
      return head(title, 'WOUND ROLL') + crumb +
        '<div class="mbody">' +
          '<div class="rollbox">' +
            '<div class="lbl">ROLL ' + f.hits + ' DICE — EACH NEEDS</div>' +
            '<div class="big">' + n.woundTarget + '+</div>' +
            '<div class="sub">S' + n.strength + ' vs T' + n.target.toughness + ' — ' +
              n.woundReason + ' (' + n.baseWound + '+) · ' + modTxt +
              (n.woundCapped ? ' <span style="color:var(--warn)">(capped)</span>' : '') + '</div>' +
          '</div>' +
          auraToggles(f, ['wound', 'strength']) +
          '<div class="noteline">' + f.hits + ' shots hit. Tap how many of them wounded — ' +
            'each one deals ' + n.damage + '.</div>' +
          countPad('wounds', f.hits) +
        '</div>';
    }

    if (f.step === 'wound') {
      const modTxt = n.woundMod === 0 ? 'no modifiers'
        : (n.woundMod > 0 ? '+' : '') + n.woundMod + ' to the roll';
      return head(title, 'WOUND ROLL') + crumb +
        '<div class="mbody">' +
          '<div class="rollbox">' +
            '<div class="lbl">ROLL 1 DICE — YOU NEED</div>' +
            '<div class="big">' + n.woundTarget + '+</div>' +
            '<div class="sub">S' + n.strength +
              (n.strMod ? ' <span style="color:var(--warn)">(' + n.baseStrength +
                (n.strMod > 0 ? '+' : '') + n.strMod + ')</span>' : '') +
              ' vs T' + n.target.toughness + ' — ' +
              n.woundReason + ' (' + n.baseWound + '+) · ' + modTxt +
              (n.woundCapped ? ' <span style="color:var(--warn)">(capped)</span>' : '') + '</div>' +
            (n.elevWound ? '<div class="modline">High ground: +1 to Wound and +1 Damage.</div>' : '') +
          '</div>' +
          elevToggle(f, action) +
          auraToggles(f, ['wound', 'strength']) +
        '</div>' +
        '<div class="mfoot">' +
          '<button class="btn bad" data-act="wound:0">FAILED</button>' +
          '<button class="btn good" data-act="wound:1">WOUND</button>' +
        '</div>';
    }

    if (f.step === 'damage') {
      const woundCount = Math.max(1, f.woundCount || 1);
      const dflt = n.variableDamage ? 0 : n.damage * woundCount;
      const dmg = damageDraft === null ? dflt : damageDraft;
      const lethal = dmg >= n.target.wounds;
      return head(title, 'DAMAGE DEALT') + crumb +
        '<div class="mbody">' +
          '<div class="rollbox">' +
            '<div class="lbl">DAMAGE TO ' + esc(n.target.name).toUpperCase() + '</div>' +
            '<div class="big">' + dmg + '</div>' +
            '<div class="sub">' + esc(n.weapon.name) + ' deals ' + esc(n.damageText) +
              (woundCount > 1 ? ' × ' + woundCount + ' wounds' : '') +
              (n.variableDamage ? ' — roll it and tap the result' : '') +
              (n.elevDamage ? ' +1 from the high-ground charge' : '') +
              (n.markDamage ? ' +' + n.markDamage + ' against a marked target' : '') + ' · ' +
              n.target.name + ' has ' + n.target.wounds + ' W left' +
              (lethal ? ' — <b style="color:var(--bad)">this destroys it</b>' : '') + '</div>' +
          '</div>' +
          '<div class="numpad">' +
            [1, 2, 3, 4, 5, 6, 7, 8].map(x =>
              '<button data-act="dmgset:' + x + '">' + x + '</button>').join('') +
          '</div>' +
          '<div style="display:flex;gap:7px">' +
            '<button class="btn sm" data-act="dmgset:0" style="flex:1">0</button>' +
            '<button class="btn sm" data-act="dmgadd:-1" style="flex:1">− 1</button>' +
            '<button class="btn sm" data-act="dmgadd:1" style="flex:1">+ 1</button>' +
          '</div>' +
        '</div>' +
        '<div class="mfoot">' +
          '<button class="btn ghost sm" data-act="flowback">BACK</button>' +
          '<button class="btn primary" data-act="dmgok:' + dmg + '">APPLY ' + dmg + ' DAMAGE</button>' +
        '</div>';
    }
    return '';
  }

  /* ---------------------------------------------------------- menu / log */

  function menuModal(g) {
    return head('MENU', 'GAME TOOLS · BUILD ' + esc(RULES.build)) +
      '<div class="mbody">' +
        '<button class="choice" data-act="togglelayout"><div class="cmain">' +
          '<div class="cname">' + (g.settings.layout === 'table' ? 'ONE WAY UP' : 'ACROSS THE TABLE') +
          '</div><div class="cdesc tip">Currently ' +
            (g.settings.layout === 'table' ? 'turned to face each player'
                                           : 'all one way up') + '. Tap to switch.</div></div></button>' +
        '<button class="choice" data-act="togglefx"><div class="cmain">' +
          '<div class="cname">' + (g.settings.fx === false ? 'EFFECTS ON' : 'EFFECTS OFF') +
          '</div><div class="cdesc tip">Sparks, blood and the jolt when an attack lands. ' +
            'Currently ' + (g.settings.fx === false ? 'off' : 'on') + '.</div></div></button>' +
        '<button class="choice" data-act="toggleverbose"><div class="cmain">' +
          '<div class="cname">' + (g.settings.verbose === false ? 'WALKTHROUGH MODE' : 'EXPERIENCED MODE') +
          '</div><div class="cdesc tip">Currently ' +
            (g.settings.verbose === false ? 'experienced — names, costs and flavour only'
                                          : 'walking you through every action') +
          '. Tap to switch.</div></div></button>' +
        '<button class="choice" data-act="showhouserules"><div class="cmain">' +
          '<div class="cname">ACTIONS &amp; AP</div>' +
          '<div class="cdesc tip">What every action costs and whether it gives your opponent AP — ' +
            'change any of it if I have one wrong.</div></div></button>' +
        '<button class="choice" data-act="showrules"><div class="cmain">' +
          '<div class="cname">RULES REFERENCE</div>' +
          '<div class="cdesc">Every Standard Action and Reaction, the wound table and the ' +
            'elevation bonuses, in full.</div></div></button>' +
        '<a class="choice" href="game/index.html"><div class="cmain">' +
          '<div class="cname">THE VIDEO GAME</div>' +
          '<div class="cdesc">The same rules, played on a screen instead of a table — ' +
            'it rolls its own dice and measures its own ranges.</div></div></a>' +
        '<button class="choice" data-act="showlog"><div class="cmain">' +
          '<div class="cname">FULL GAME LOG</div>' +
          '<div class="cdesc tip">Every AP, VP, wound and effect change since the first turn.</div></div></button>' +
        ((g.mission && g.mission.id)
          ? '<button class="choice" data-act="showmission"><div class="cmain">' +
              '<div class="cname">MISSION</div>' +
              '<div class="cdesc">The card, its battlefield and what it scores for. Also read ' +
                'back to you in every End Phase.</div></div></button>'
          : '') +
        '<button class="choice" data-act="forceendchain"><div class="cmain">' +
          '<div class="cname">END THE ACTION CHAIN</div>' +
          '<div class="cdesc">Override: close the current chain and hand play back to the turn player.</div></div></button>' +
        '<button class="choice" data-act="forceendturn"><div class="cmain">' +
          '<div class="cname">END THIS TURN</div>' +
          '<div class="cdesc">Override: jump straight to the End Phase.</div></div></button>' +
        '<button class="choice p' + Store.opponentOf(g.control.player) + '" data-act="swapcontrol:' +
          Store.opponentOf(g.control.player) + '"><div class="cmain">' +
          '<div class="cname">GIVE CONTROL TO ' +
            esc(g.players[Store.opponentOf(g.control.player)].name).toUpperCase() + '</div>' +
          '<div class="cdesc">Override: they act next, with a free choice of unit.</div></div></button>' +
        '<button class="choice" data-act="newgame"><div class="cmain">' +
          '<div class="cname" style="color:var(--bad)">END GAME &amp; EDIT ROSTERS</div>' +
          '<div class="cdesc">Returns to setup. The current game state is discarded.</div></div></button>' +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CLOSE</button></div>';
  }

  function missionModal(g) {
    const m = Engine.missionCard();
    return head('MISSION', m ? m.name : 'NONE') +
      '<div class="mbody">' +
        (m
          ? '<div class="mcflav" style="margin-bottom:10px">' + esc(m.flavour) + '</div>' +
            '<div class="noteline"><b>BATTLEFIELD</b><br>' + lines(m.battlefield) + '</div>' +
            '<div class="noteline"><b>OBJECTIVE</b><br>' + lines(m.objective) + '</div>' +
            '<div class="noteline"><b>SPECIAL RULE' +
              ((m.special || []).length > 1 ? 'S' : '') + '</b><br>' + lines(m.special) + '</div>' +
            (g.mission.roles && g.mission.roles.attacker !== null
              ? '<div class="noteline">Attacker: <b>' + esc(g.players[g.mission.roles.attacker].name) +
                '</b> · Defender: <b>' + esc(g.players[g.mission.roles.defender].name) + '</b></div>'
              : '') +
            controlPointStrip(g) + relicStrip(g) +
            (m.unitFlag ? '<div class="noteline">' + esc(m.unitFlag.hint) + '</div>' : '')
          : '<div class="noteline">No mission card this game.</div>') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="menu">BACK</button></div>';
  }

  /* Every action's cost and AP consequence, editable mid-game. */
  function houseRulesModal(g) {
    const ov = (g.settings && g.settings.actionOverrides) || {};
    return head('ACTIONS &amp; AP', 'HOUSE RULES') +
      '<div class="mbody">' +
        '<div class="noteline">What each action costs, and whether it hands your opponent AP. ' +
          'Change anything here and the app follows your version for the rest of the game.</div>' +
        '<div class="noteline">An <b>Aggressive Action</b> never grants a flat AP — its target ' +
          'gains 1 AP only by surviving the attack, which is why those rows are fixed.</div>' +
        Engine.actionList().map(function (a) {
          const changed = !!ov[a.id];
          return '<div class="sub" style="background:#0f161d;margin-bottom:7px' +
            (changed ? ';border-color:var(--gold-dim)' : '') + '">' +
            '<div style="font-weight:800;font-size:13px">' + a.name +
              ' <span class="ctag ' + (a.kind === 'aggressive' ? 'agg' : 'pas') + '">' +
              a.kind.toUpperCase() + '</span>' +
              (changed ? ' <span style="color:var(--gold);font-size:10px">HOUSE RULE</span>' : '') +
            '</div>' +
            '<div style="font-size:10px;color:var(--ink-mute);letter-spacing:.1em;font-weight:800;margin:8px 0 4px">' +
              'COST</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              (a.cost === null
                ? '<div class="cpchip">set by the ability</div>'
                : [0, 1, 2, 3].map(c => '<button class="btn sm' + (a.cost === c ? ' primary' : '') +
                    '" style="flex:1" data-act="hrcost:' + a.id + ':' + c + '">' +
                    (c === 0 ? 'FREE' : c + ' AP') + '</button>').join('')) +
            '</div>' +
            '<div style="font-size:10px;color:var(--ink-mute);letter-spacing:.1em;font-weight:800;margin:8px 0 4px">' +
              'YOUR OPPONENT GAINS</div>' +
            (a.kind === 'aggressive'
              ? '<div class="cpchip">1 AP to the target, only if it survives</div>'
              : '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  [0, 1, 2].map(n => '<button class="btn sm' +
                    ((a.opponentGainsAP || 0) === n ? ' primary' : '') + '" style="flex:1" ' +
                    'data-act="hrap:' + a.id + ':' + n + '">' +
                    (n === 0 ? 'NOTHING' : n + ' AP') + '</button>').join('') +
                '</div>') +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="menu">BACK</button></div>';
  }

  function logModal(g) {
    return head('GAME LOG', 'TURN ' + g.turn.number) +
      '<div class="mbody">' +
        g.log.slice().reverse().map(l =>
          '<div class="logrow ' + l.cls + '">' + esc(l.text) + '</div>').join('') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="menu">BACK</button></div>';
  }

  function unitModal(g, unitId) {
    const u = Store.unit(unitId);
    if (!u) return '';
    return head(esc(u.name), esc(g.players[u.owner].name).toUpperCase() + ' · ' +
      u.wounds + '/' + u.maxWounds + ' W') +
      '<div class="mbody">' +
        '<div class="noteline">MOV ' + u.move + '" · W ' + u.maxWounds + ' · T ' + u.toughness +
          ' · OC ' + (u.oc || 0) + '</div>' +
        (u.notes ? '<div class="noteline">' + esc(u.notes) + '</div>' : '') +
        '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:10px 0 5px">WEAPONS</div>' +
        (u.weapons || []).map(w => '<div class="noteline">' + esc(w.name) + ' — ' +
          (w.type === 'melee' ? 'Melee' : 'Ranged') + ' · ' + (w.range || 0) + '" · Hit ' + w.hit +
          '+ · S' + w.strength + ' · D' + w.damage + '</div>').join('') +
        '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:10px 0 5px">ABILITIES</div>' +
        ((u.abilities || []).length
          ? u.abilities.map(a => '<div class="noteline"><b>' + esc(a.name) + '</b> — ' +
              (a.trigger === 'ap' ? a.cost + ' AP' : a.trigger === 'rp' ? a.cost + ' RP' : a.trigger.toUpperCase()) +
              '<br>' + esc(a.text) +
              ((a.effects || []).length ? '<br><span style="color:var(--gold)">' +
                a.effects.map(effectSummary).join(' · ') + '</span>' : '') + '</div>').join('')
          : '<div class="noteline">None.</div>') +
        ((u.effects || []).length
          ? '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:10px 0 5px">ACTIVE EFFECTS</div>' +
            u.effects.map(e => '<div class="noteline">' + esc(e.label) + ' — ' +
              durLabel(e.duration) + '<br>' + esc(e.detail || '') + '</div>').join('')
          : '') +
        '<div style="height:8px"></div>' +
        (Engine.missionCard() && Engine.missionCard().unitFlag
          ? '<button class="choice" data-act="flag:' + u.id + ':' + Engine.missionCard().unitFlag.id +
              '"><div class="cmain"><div class="cname">' +
              ((u.flags && u.flags[Engine.missionCard().unitFlag.id]) ? 'REMOVE ' : 'MARK AS ') +
              Engine.missionCard().unitFlag.label + '</div>' +
              '<div class="cdesc">' + esc(Engine.missionCard().unitFlag.hint) + '</div></div></button>'
          : '') +
        '<button class="choice" data-act="addtok:' + u.id + '"><div class="cmain">' +
          '<div class="cname">ADD A TOKEN / BUTTON BY HAND</div>' +
          '<div class="cdesc">For a mine, trap, ambush or marker you did not build into an ability.</div></div></button>' +
        '<button class="choice" data-act="addeff:' + u.id + '"><div class="cmain">' +
          '<div class="cname">ADD A MODIFIER BY HAND</div>' +
          '<div class="cdesc">A temporary +/- to this unit\'s Hit or Wound rolls.</div></div></button>' +
        (u.alive
          ? '<button class="choice" data-act="killunit:' + u.id + '"><div class="cmain">' +
              '<div class="cname" style="color:var(--bad)">REMOVE FROM THE BATTLEFIELD</div>' +
              '<div class="cdesc">Destroys the unit and awards 1 VP to the opponent.</div></div></button>'
          : '<button class="choice" data-act="w:' + u.id + ':1"><div class="cmain">' +
              '<div class="cname">RETURN TO THE BATTLEFIELD</div>' +
              '<div class="cdesc">Restores the unit at 1 wound. No VP is taken back.</div></div></button>') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CLOSE</button></div>';
  }

  /* ================================================================ VICTORY
     Sparks, then the skull, then the wings open, then the word — and last, a
     report assembled from what actually happened on the table. */

  let victoryShownFor = null;

  const AQUILA_SVG =
    '<svg class="vaquila" viewBox="0 0 200 96" aria-hidden="true">' +
      '<g class="wing left">' +
        '<path d="M78 34 L10 20 L12 31 L76 44 Z"/>' +
        '<path d="M78 46 L20 40 L22 51 L76 55 Z"/>' +
        '<path d="M78 58 L34 60 L36 70 L76 67 Z"/>' +
      '</g>' +
      '<g class="wing right">' +
        '<path d="M122 34 L190 20 L188 31 L124 44 Z"/>' +
        '<path d="M122 46 L180 40 L178 51 L124 55 Z"/>' +
        '<path d="M122 58 L166 60 L164 70 L124 67 Z"/>' +
      '</g>' +
      '<g class="skull">' +
        '<path fill-rule="evenodd" d="M100 14 C86 14 75 25 75 40 c0 9 4 17 11 21 l-2 8 h32 ' +
          'l-2-8 c7-4 11-12 11-21 0-15-11-26-25-26 Z M89 38 a6.5 6.5 0 1 0 0.01 0 Z ' +
          'M111 38 a6.5 6.5 0 1 0 0.01 0 Z M100 50 l-4 9 h8 Z"/>' +
        '<path d="M88 76 h24 v4 h-24 Z M92 82 h16 v3 h-16 Z"/>' +
      '</g>' +
    '</svg>';

  function victoryScene(g) {
    const w = g.players[g.winner];
    const report = Engine.victoryReport();
    const words = RULES.epitaph(report);
    return '<div class="victory" data-overlay="1">' +
      '<div class="vsky"></div>' +
      '<div class="vstage">' +
        AQUILA_SVG +
        '<div class="vword">VICTORY</div>' +
        '<div class="vwho p' + g.winner + '">' + esc(w.name) + '</div>' +
        '<div class="vhead">' + esc(words.headline) + '</div>' +
        '<div class="vlines">' +
          words.lines.map((l, i) => '<p style="animation-delay:' +
            (2150 + i * 420) + 'ms">' + esc(l) + '</p>').join('') +
        '</div>' +
      '</div>' +
      '<div class="vfoot">' +
        '<button class="btn ghost sm" data-act="dismisswin">KEEP PLAYING</button>' +
        '<button class="btn primary" data-act="newgame">NEW GAME</button>' +
      '</div>' +
    '</div>';
  }

  /* Sparks thrown across the top of the scene, once, as it opens. */
  function playVictory() {
    if (!fxOn()) return;
    const w = window.innerWidth, h = window.innerHeight;
    [0, 140, 260, 380, 520].forEach(function (delay, i) {
      setTimeout(function () {
        burst({ x: w * (0.2 + Math.random() * 0.6), y: h * (0.22 + Math.random() * 0.18) },
              14, 'spark', 240, 150);
      }, delay);
    });
    setTimeout(() => shake('md'), 900);      // the wings snap open
    setTimeout(() => shake('sm'), 1500);     // the word lands
  }

  function winModal(g) {
    const over = g.gameOver;
    const w = (g.winner === null || g.winner === undefined) ? null : g.players[g.winner];
    return head(over ? 'THE MISSION ENDS' : 'VICTORY',
                w ? esc(w.name).toUpperCase() : 'A DRAW') +
      '<div class="mbody">' +
        (over ? '<div class="noteline">' + esc(over.why) + '</div>' : '') +
        '<div class="winner">' + (w
          ? esc(w.name) + (over ? ' wins on ' + w.vp + ' VP' : ' reaches ' + w.vp + ' VP')
          : 'Level on VP — call it between you') + '</div>' +
        '<div class="noteline">' + g.players.map(pl =>
          esc(pl.name) + ' — ' + pl.vp + ' VP').join(' · ') + '</div>' +
        '<div class="noteline tip">Play on if you agreed a higher target; the app keeps tracking either way.</div>' +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn ghost sm" data-act="dismisswin">KEEP PLAYING</button>' +
        '<button class="btn primary" data-act="newgame">NEW GAME</button>' +
      '</div>';
  }

  /* --------------------------------------------------------------- damage */

  function setDamageDraft(v) { damageDraft = Math.max(0, v); render(); }
  function clearDamageDraft() { damageDraft = null; }
  function getDamageDraft() { return damageDraft; }


  return { render, setModal, getModal: () => modal,
           setDamageDraft, clearDamageDraft, getDamageDraft,
           toggleChain, noteTap, playFx, esc };
})();

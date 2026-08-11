/* =========================================================================
   UI — play screen, guided action flows, modals.
   ========================================================================= */

const UI = (function () {

  let modal = null;          // UI-only overlays: 'actions' | 'menu' | 'log' | {unit:id}
  let damageDraft = null;
  let vpDraft = null;

  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const G = () => Store.get();

  /* Card text is stored as printed lines, so render it that way. */
  const lines = xs => (Array.isArray(xs) ? xs : [xs]).map(esc).join('<br>');

  function render() {
    const app = document.getElementById('app');
    const g = G();
    if (!g) { app.innerHTML = Setup.render(); return; }
    app.innerHTML = playScreen(g) + overlay(g);
  }

  function setModal(m) { modal = m; render(); }

  /* ================================================================ SHELL */

  function playScreen(g) {
    return '<div class="screen">' +
      topbar(g) +
      controlbar(g) +
      '<div class="board"><div class="rosters">' +
        g.players.map((p, i) => rosterCol(g, i)).join('') +
      '</div></div>' +
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
      const used = g.chain.weaponsUsed.indexOf(u.id + '|' + w.id) >= 0;
      return '<div class="row' + (used ? ' used' : '') + '">' +
        '<span class="tag">' + (w.type === 'melee' ? 'M' : 'R') + '</span>' +
        '<span class="nm">' + esc(w.name) + '</span>' +
        '<span>' + (w.range ? w.range + '" · ' : '') +
          w.hit + '+ · S' + w.strength + ' · D' + esc(w.damage) + '</span>' +
      '</div>';
    }).join('');

    const mcard = Engine.missionCard();
    const flag = mcard && mcard.unitFlag;
    const flagOn = flag && u.flags && u.flags[flag.id];
    const carrying = Engine.relicCarrier() === u.id;

    const passives = (u.abilities || []).filter(a => a.trigger === 'passive')
      .map(a => '<span class="chip-s pass" title="' + esc(a.text) + '">' + esc(a.name) + '</span>').join('') +
      (flagOn ? '<span class="chip-s mission">' + flag.label + '</span>' : '') +
      (carrying ? '<span class="chip-s mission">CARRYING THE RELIC</span>' : '') +
      (u.marker ? '<span class="chip-s mission">MISSION MARKER · NO RP</span>' : '');

    const effects = (u.effects || []).map(e =>
      '<span class="chip-s eff">' + esc(e.label) +
        '<button data-act="rmeff:' + u.id + ':' + e.id + '">✕</button></span>').join('');

    /* Buttons live on the unit that owns them, so with several units ready you
       can always see who is firing and who is still waiting. */
    const tokens = (u.tokens || []).map(function (t) {
      const ow = t.kind === 'overwatch';
      return '<div class="tokrow' + (ow ? ' ow' : '') + '">' +
        '<button class="tokfire" data-act="tok:' + u.id + ':' + t.id + '">' +
          '<span class="tf1">' + (ow ? '⌖ FIRE OVERWATCH' : '▸ ' + esc(t.label)) + '</span>' +
          '<span class="tf2">' + esc(ow
            ? 'Ready — press when an enemy comes within 3" of the token'
            : (t.text || 'Press when it triggers')) + '</span>' +
        '</button>' +
        '<button class="tokx" data-act="rmtok:' + u.id + ':' + t.id + '">✕</button>' +
      '</div>';
    }).join('');

    const freeAbils = (u.alive ? Engine.usableFreeAbilities(u) : [])
      .map(a => '<button class="abilbtn" data-act="freeab:' + u.id + ':' + a.id + '">' +
        esc(a.name) + '</button>').join('');

    return '<div class="unit p' + u.owner +
      (u.alive ? (mustAct ? ' acting' : (canAct ? ' canact' : '')) : ' dead') + '">' +
      '<div class="uhead">' +
        '<div class="uname">' + esc(u.name) + '</div>' +
        '<div class="wtxt ' + sev + '"><span class="cur">' + u.wounds + '</span>' +
          '<span class="max"> / ' + u.maxWounds + ' W</span></div>' +
      '</div>' +
      '<div class="pips">' + pips + '</div>' +
      '<div class="ustats"><span><b>MOV</b> ' + u.move + '"</span>' +
        '<span><b>T</b> ' + u.toughness + '</span>' +
        '<span><b>OC</b> ' + (u.oc || 0) + '</span>' +
        (u.alive ? '' : '<span style="color:var(--bad)"><b>DESTROYED</b></span>') + '</div>' +
      '<div class="uwep">' + weapons + '</div>' +
      (u.notes ? '<div class="hint" style="margin:6px 0 0">' + esc(u.notes) + '</div>' : '') +
      ((passives || effects) ? '<div class="chips">' + passives + effects + '</div>' : '') +
      (tokens ? '<div class="toks">' + tokens + '</div>' : '') +
      (freeAbils ? '<div class="chips">' + freeAbils + '</div>' : '') +
      '<div class="urow">' +
        '<button class="wbtn" data-act="w:' + u.id + ':-1">−</button>' +
        '<button class="wbtn" data-act="w:' + u.id + ':1">+</button>' +
        '<div class="spacer"></div>' +
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

  function chainbox(g) {
    const entries = g.chain.entries.slice(-14);
    return '<div class="chainbox" id="chainbox">' +
      '<div class="chead">ACTION CHAIN' +
        '<span class="st">' + (g.chain.active ? 'ACTIVE' : 'ENDED') + '</span></div>' +
      (entries.length
        ? entries.map(e => '<div class="centry ' + e.cls + '">' + esc(e.text) + '</div>').join('')
        : '<div class="centry muted">No action chain running. The active player may spend AP.</div>') +
    '</div>';
  }

  function actionbar(g) {
    const pending = !!g.pending;
    return '<div class="actionbar">' +
      '<button class="sidebtn" data-act="undo"><span class="ic">↺</span>UNDO</button>' +
      '<button class="bigbtn' + (!pending && Engine.mustPass() ? ' must' : '') + '" data-act="' +
        (pending ? 'openphase' : 'openactions') + '">' +
        (pending ? (g.pending.type === 'start' ? 'RESOLVE START PHASE' : 'RESOLVE END PHASE')
                 : (Engine.mustPass() ? 'NO AP — PASS' : 'ACTION LIST')) +
      '</button>' +
      '<button class="sidebtn" data-act="menu"><span class="ic">≡</span>MENU</button>' +
    '</div>';
  }

  /* =============================================================== OVERLAY */

  function overlay(g) {
    if (g.flow) return wrap(flowModal(g));
    // Anything that might score sits at the front of the queue: nothing else
    // matters until the player has said what it was worth.
    if ((g.vpPrompts || []).length) return wrap(vpModal(g));
    if (modal === 'actions') return wrap(actionListModal(g));
    if (modal === 'menu') return wrap(menuModal(g));
    if (modal === 'log') return wrap(logModal(g));
    if (modal === 'mission') return wrap(missionModal(g));
    if (modal === 'rules') return wrap(rulesModal());
    if (modal === 'houserules') return wrap(houseRulesModal(g));
    if (modal === 'newbutton') return wrap(newButtonModal(g));
    if (modal && modal.unit) return wrap(unitModal(g, modal.unit));
    if (g.pending && modal !== 'phase-dismissed') return wrap(phaseModal(g));
    if (g.winner !== null && g.winner !== undefined && modal !== 'win-dismissed') return wrap(winModal(g));
    return '';
  }

  function wrap(inner) {
    return '<div class="overlay" data-overlay="1"><div class="modal">' + inner + '</div></div>';
  }

  function head(title, step, closeAct) {
    return '<div class="mhead">' +
      '<div><div class="mtitle">' + title + '</div>' +
      (step ? '<div class="mstep">' + step + '</div>' : '') + '</div>' +
      '<button class="mclose" data-act="' + (closeAct || 'close') + '">✕</button>' +
    '</div>';
  }

  /* ---------------------------------------------------------- action list */

  function actionListModal(g) {
    const cp = g.control.player;
    const rows = Engine.actionList().map(function (a) {
      const av = Engine.actionAvailability(a);
      if (av.hide) return '';
      const cost = a.cost === null ? 'X AP' : (a.cost === 0 ? 'FREE' : a.cost + ' AP');
      return '<button class="choice' + (av.ok ? '' : ' disabled') + '" data-act="action:' + a.id + '">' +
        '<div class="cmain">' +
          '<div class="cname">' + a.name +
            ' <span class="ctag ' + (a.kind === 'aggressive' ? 'agg">AGGRESSIVE' : 'pas">PASSIVE') + '</span>' +
            (a.id === 'pass' && Engine.mustPass()
              ? ' <span class="ctag req">YOUR ONLY MOVE</span>' : '') + '</div>' +
          '<div class="cdesc">' + esc(a.short || a.text) + '</div>' +
          '<div class="apnote' + (a.kind === 'aggressive' ? ' agg'
            : (a.opponentGainsAP > 0 ? ' gives' : ' free')) + '">' +
            esc(Engine.apConsequence(a)) + '</div>' +
          (av.ok ? '' : '<div class="cflav" style="color:var(--bad)">' + esc(av.why) + '</div>') +
        '</div>' +
        '<div class="ccost' + (a.cost === 0 ? ' free' : '') + '">' + cost + '</div>' +
      '</button>';
    }).join('');

    const mode = Engine.controlMode();
    return head('ACTION LIST', esc(g.players[cp].name) + ' · ' + g.players[cp].ap + ' AP AVAILABLE') +
      '<div class="crumbs"><span class="badge ' + (mode === 'reacting' ? 'react' : 'turn') + '">' +
        (mode === 'reacting' ? 'REACTING TO ' + esc(g.players[g.turn.player].name).toUpperCase()
                             : 'THEIR OWN TURN') + '</span>' +
        (Engine.mustPass() ? ' <span class="badge must">NO AP — MUST PASS</span>' : '') + '</div>' +
      (g.control.forcedUnitId
        ? '<div class="crumbs">Aggressive Action response: <b>' +
            esc(Store.unit(g.control.forcedUnitId).name) + '</b> must be the acting unit.</div>'
        : '') +
      '<div class="mbody">' + rows + '</div>' +
      '<div class="mfoot">' +
        '<button class="btn ghost sm" data-act="showrules">RULES</button>' +
        '<button class="btn ghost" data-act="close">CLOSE</button>' +
      '</div>';
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
          'a DIVE out of sight, a unit shot off the board mid-move — the action immediately ends. ' +
          'The action chain continues, but nothing that would have come of that action happens, ' +
          '<b>not even gaining AP</b>. Use <b>COULD NOT BE PERFORMED</b> in the attack flow.</div>' +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CLOSE</button></div>';
  }

  /* ------------------------------------------------------------- phase */

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

        (isStart
          ? '<div class="noteline warn">' + esc(g.players[p.player].name) +
              ' gains 1 AP for the Start Phase (they will have ' + (g.players[p.player].ap + 1) + ' AP).</div>'
          : missionCheck(g) +
            '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
            'ANY OTHER VP</div>' +
            '<div class="noteline">Anything else you scored this turn — the app has no idea what your ' +
              'mission rewards, so tell it.</div>' +
            '<div style="display:flex;gap:7px;margin-bottom:8px;flex-wrap:wrap">' +
              g.players.map(pl => '<button class="btn sm p' + pl.id + '" style="flex:1 1 45%" ' +
                'data-act="askvp:' + pl.id + '">VP FOR ' + esc(pl.name).toUpperCase() +
                '</button>').join('') +
            '</div>') +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn primary" data-act="' + (isStart ? 'confirmStart' : 'confirmEnd') + '">' +
          (isStart ? 'GAIN 1 AP & BEGIN ACTION PHASE' : 'END TURN') + '</button>' +
      '</div>';
  }

  /* End of turn: the app reads the mission card back to you and takes your
     number. For SECURE THE AREA it has watched every SECURE and counts for you. */
  function missionCheck(g) {
    const m = Engine.missionCard();
    const items = Engine.missionEndTurnItems();
    return '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
        (m ? 'MISSION — ' + m.name : 'SCORING') + '</div>' +
      '<div class="noteline">' + (m ? lines(m.objective)
        : esc('Standard game mode: at the end of each turn, 1 VP for each objective where you ' +
              'have the most OC.')) + '</div>' +
      controlPointStrip(g) +
      relicStrip(g) +
      (items.length
        ? items.map(function (o) {
            return '<div class="sub" style="background:#0f161d;margin-bottom:7px">' +
              '<div style="font-weight:700;font-size:13px">' + esc(o.name) + '</div>' +
              (o.text ? '<div style="color:var(--ink-dim);font-size:11.5px;margin:3px 0 7px;line-height:1.4">' +
                esc(o.text) + '</div>' : '<div style="height:6px"></div>') +
              '<div style="font-size:10px;color:var(--ink-mute);letter-spacing:.1em;font-weight:800;margin-bottom:4px">' +
                'SCORED BY?</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                g.players.map(function (pl) {
                  const c = Engine.objectiveScoredBy(o.id, pl.id);
                  const sug = o.perPlayerVP ? o.perPlayerVP[pl.id] : null;
                  return '<button class="btn sm p' + pl.id + '" style="flex:1 1 45%" ' +
                    'data-act="scoreobj:' + o.id + ':' + pl.id + '">' + esc(pl.name) +
                    (sug !== null ? ' · ' + sug + ' VP' : '') + (c ? ' ·' + c + 'x' : '') + '</button>';
                }).join('') +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="noteline">Nothing is scored at the end of a turn in this mission — its VP ' +
          'comes from what happens on the table.</div>');
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

  /* --------------------------------------------------------- VP entry pad */

  function vpModal(g) {
    const p = g.vpPrompts[0];
    const draft = vpDraft === null ? (Number(p.suggested) || 0) : vpDraft;
    return head('VICTORY POINTS', esc(g.players[p.player].name).toUpperCase(), 'vpok:0') +
      '<div class="mbody">' +
        '<div class="rollbox">' +
          '<div class="lbl">' + esc(p.reason).toUpperCase() + '</div>' +
          '<div class="big">' + draft + '</div>' +
          '<div class="sub">How many VP does ' + esc(g.players[p.player].name) +
            ' score for this? They are on ' + g.players[p.player].vp + ' VP' +
            (g.settings.vpTarget ? ' of ' + g.settings.vpTarget : '') + '.</div>' +
        '</div>' +
        '<div class="numpad">' +
          [0, 1, 2, 3, 4, 5, 6, 7].map(x =>
            '<button data-act="vpset:' + x + '">' + x + '</button>').join('') +
        '</div>' +
        '<div style="display:flex;gap:7px">' +
          '<button class="btn sm" style="flex:1" data-act="vpadd:-1">− 1</button>' +
          '<button class="btn sm" style="flex:1" data-act="vpadd:1">+ 1</button>' +
        '</div>' +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn ghost sm" data-act="vpok:0">NONE</button>' +
        '<button class="btn primary" data-act="vpok:' + draft + '">SCORE ' + draft + ' VP</button>' +
      '</div>';
  }

  /* =============================================================== FLOWS */

  function flowModal(g) {
    const f = g.flow;
    if (f.kind === 'attack')    return attackFlow(g, f);
    if (f.kind === 'ability')   return abilityFlow(g, f);
    if (f.kind === 'overwatch') return overwatchFlow(g, f);
    if (f.kind === 'secure')    return secureFlow(g, f);
    if (f.kind === 'relic')     return relicFlow(g, f);
    if (f.kind === 'simple')    return simpleFlow(g, f);
    if (f.kind === 'pass')      return passFlow(g, f);
    if (f.kind === 'token')     return tokenFlow(g, f);
    return '';
  }

  function unitChoice(u, act, extra) {
    return '<button class="choice p' + u.owner + '" data-act="' + act + '">' +
      '<div class="cmain"><div class="cname">' + esc(u.name) + '</div>' +
      '<div class="cdesc">' + u.wounds + '/' + u.maxWounds + ' W · T' + u.toughness +
        (extra ? ' · ' + extra : '') + '</div></div>' +
    '</button>';
  }

  /* "If an effect interrupts an action so that the action is not able to be
     performed, the action immediately ends." Always one tap away. */
  function abortRow() {
    return '<button class="abortbtn" data-act="abort">COULD NOT BE PERFORMED — ' +
      'nothing comes of it</button>';
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
          '<div class="sub">' + esc(a.prompt || a.text) + '</div></div>' +
        '<div class="noteline">Costs ' + a.cost + ' AP. ' +
          (a.endsChain ? 'The action chain ends.' : 'The action chain continues.') + '</div>' +
        (a.expiresOverwatch && (u.tokens || []).some(t => t.kind === 'overwatch')
          ? '<div class="noteline warn">' + esc(u.name) + '\'s OVERWATCH token will be removed.</div>' : '') +
        abortRow() +
      '</div>' +
      footBack('confirmsimple', 'DONE — ' + a.name);
  }

  function passFlow(g, f) {
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
              : '<div class="noteline">Passing on its own does nothing but decline to act — the ' +
                'chain carries on to ' + esc(g.players[Store.opponentOf(g.control.player)].name) +
                '. If they pass too, the chain ends.</div>')
          : '<div class="noteline">No action chain is running. Passing changes nothing unless you ' +
            'also end your turn.</div>') +
        (o.canEndTurn
          ? '<div class="noteline warn">It is your turn, so you may end it here. Nothing else ' +
            'will.</div>' : '') +
        '<div class="noteline">' + me + ' currently has ' + g.players[g.control.player].ap +
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
          '<div class="noteline">You have checked on the table that ' + esc(Store.unit(f.unitId).name) +
            ' can secure it. The app just remembers who holds it.</div>' +
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
        '<div class="noteline">Costs 1 AP. At the end of each turn you score 1 VP for every ' +
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
        '<div class="noteline">Get it to your own side of the battlefield to score 3 VP and end ' +
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
        '<div class="noteline">A <b>⌖ FIRE OVERWATCH</b> button appears on ' + esc(u.name) +
          '\u2019s card. When an enemy moves within 3" of the token and is a legal target, press ' +
          'it to interrupt — the app never decides that.</div>' +
        '<div class="noteline">You interrupt and resolve a shoot sequence at <b>-1 to hit</b>, ' +
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
    if (f.step === 'pick') {
      const needs = Engine.effectsNeedingTarget(ab, { sourceUnitId: f.unitId });
      const e = needs[f.pickIndex] || needs.find(x => !f.targets[x.id]) || needs[0];
      if (e.pick === 'multi') {
        return multiPick(g, f, e, 'picktarget', esc(ab.name),
          'Everyone in range rolls. Tick the ones that failed.');
      }
      return head(esc(ab.name), 'SELECT TARGET — ' + effectSummary(e).toUpperCase()) +
        '<div class="mbody">' + Store.get().units.filter(x => x.alive)
          .map(x => unitChoice(x, 'picktarget:' + e.id + ':' + x.id,
            x.owner === u.owner ? 'friendly' : 'enemy')).join('') +
        '</div>' + footBack();
    }
    return head(esc(ab.name), 'CONFIRM') +
      '<div class="mbody">' +
        '<div class="rollbox"><div class="lbl">' + esc(u.name) + '</div>' +
          '<div class="big" style="font-size:20px">' + esc(ab.name) + '</div>' +
          '<div class="sub">' + esc(ab.text) + '</div></div>' +
        (ab.effects || []).map(e => '<div class="noteline">' + effectSummary(e) +
          targetNames(f.targets[e.id]) + '</div>').join('') +
        '<div class="noteline warn">Costs ' + ab.cost + ' AP. ' +
          (Engine.abilityLetsThemReact(ab)
            ? 'Your opponent gets to react — the chain continues, and they may answer with any ' +
              'unit if they have the AP.'
            : 'Your opponent does not get to react — the action chain ends here.') + '</div>' +
      '</div>' +
      footBack('confirmability', 'USE ABILITY');
  }

  /* One roll each: tick everyone the dice went against. */
  function multiPick(g, f, e, actPrefix, title, sub) {
    const chosen = Array.isArray(f.targets[e.id]) ? f.targets[e.id] : [];
    return head(title, 'WHICH UNITS? — ' + effectSummary(e).toUpperCase()) +
      '<div class="mbody">' +
        '<div class="noteline">' + sub + '</div>' +
        g.units.filter(x => x.alive).map(function (x) {
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
        '<div class="mbody">' + Store.get().units.filter(x => x.alive)
          .map(x => unitChoice(x, 'tokentarget:' + e.id + ':' + x.id)).join('') + '</div>' +
        '<div class="mfoot"><button class="btn ghost" data-act="close">CANCEL</button></div>';
    }
    return head('[ ' + esc(t.label) + ' ]', 'RESOLVE') +
      '<div class="mbody">' +
        (t.text ? '<div class="noteline">' + esc(t.text) + '</div>' : '') +
        (effects.length
          ? effects.map(e => '<div class="noteline">' + effectSummary(e) +
              targetNames(f.targets[e.id]) + '</div>').join('')
          : '<div class="noteline">This token has no stored mechanical effects — it is a reminder only. ' +
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

  function attackFlow(g, f) {
    const action = RULES.actionById(f.actionId);
    const isOW = f.source === 'overwatch';
    const title = isOW ? 'OVERWATCH — ' + esc((Store.unit(f.attackerId) || {}).name || '')
                       : (f.source === 'free' ? esc(f.freeLabel || 'FREE ATTACK') : action.name);
    const attacker = f.attackerId ? Store.unit(f.attackerId) : null;
    const target = f.targetId ? Store.unit(f.targetId) : null;

    const crumb = '<div class="crumbs">' +
      (attacker ? '<b>' + esc(attacker.name) + '</b>' : 'attacker') + ' → ' + title +
      (target ? ' → <b>' + esc(target.name) + '</b>' : '') +
      (f.weaponId && attacker ? ' · ' + esc((attacker.weapons.find(w => w.id === f.weaponId) || {}).name) : '') +
    '</div>';

    if (f.step === 'attacker') {
      return head(title, 'SELECT ATTACKING UNIT') + crumb +
        '<div class="mbody">' + Engine.eligibleUnits().map(u =>
          unitChoice(u, 'pickunit:' + u.id,
            Engine.weaponsFor(u.id, action.attackRange).filter(w => !w.used).length + ' ' +
            action.attackRange + ' weapon(s) ready')).join('') + '</div>' + footBack();
    }

    if (f.step === 'target') {
      const enemies = g.units.filter(u => u.alive && u.owner !== attacker.owner);
      return head(title, 'SELECT DEFENDING UNIT') + crumb +
        '<div class="mbody">' +
          '<div class="noteline">You have already checked range and line of sight on the table. ' +
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
          list.map(w => '<button class="choice' + (w.used ? ' disabled' : '') +
            '" data-act="pickweapon:' + w.id + '">' +
            '<div class="cmain"><div class="cname">' + esc(w.name) +
              (w.primary ? ' <span class="ctag">PRIMARY</span>' : '') + '</div>' +
            '<div class="cdesc">Hit ' + w.hit + '+ · Strength ' + w.strength + ' · Damage ' + w.damage +
              (w.used ? ' · already used this action chain' : '') + '</div></div></button>').join('') +
        '</div>' + footBack();
    }

    if (f.step === 'reaction') {
      const range = action.attackRange;
      const list = range === 'melee' ? RULES.meleeReactions : RULES.rangedReactions;
      const defPlayer = target.owner;
      const rp = g.players[defPlayer].rp;
      const specials = (target.abilities || []).filter(a => a.trigger === 'rp' &&
        (Number(a.cost) || 0) <= rp);

      const blocked = Engine.blockedReactions(target.id);
      return head(esc(g.players[defPlayer].name) + ' REACTS',
        (range === 'melee' ? 'MELEE' : 'RANGED') + ' REACTION · ' + rp + ' RP') + crumb +
        '<div class="mbody">' +
          list.filter(r => !r.isSpecial).map(r =>
            '<button class="choice' + (r.cost > rp ? ' disabled' : '') + '" data-act="reaction:' + r.id + '">' +
              '<div class="cmain"><div class="cname">' + r.name +
                (blocked[r.id] ? ' <span class="ctag agg">BLOCKED</span>' : '') + '</div>' +
              '<div class="cdesc">' + esc(r.text) + '</div>' +
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
            '<div class="cdesc">Spend nothing and take the attack as it comes. ' +
              'Unspent RP does not carry over.</div></div>' +
            '<div class="ccost free">0 RP</div></button>' +
          abortRow() +
        '</div>' +
        '<div class="mfoot"><button class="btn ghost sm" data-act="flowback">BACK</button></div>';
    }

    if (f.step === 'redirect') {
      const friends = g.units.filter(u => u.alive && u.owner === target.owner && u.id !== target.id);
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
      return head(title, 'HIT ROLL') + crumb +
        '<div class="mbody">' +
          '<div class="rollbox">' +
            '<div class="lbl">ROLL 1 DICE — YOU NEED</div>' +
            '<div class="big">' + n.hitTarget + '+</div>' +
            '<div class="sub">' + esc(n.weapon.name) + ' hits on ' + n.baseHit + '+ · ' + modTxt +
              (n.hitCapped ? ' <span style="color:var(--warn)">(capped at the edge of the die)</span>' : '') +
            '</div>' +
            (f.notes.length ? '<div class="modline">' + f.notes.map(esc).join('<br>') + '</div>' : '') +
          '</div>' +
          elevToggle(f, action) +
          auraToggles(f, 'hit') +
          '<div class="noteline">Roll it on the table, then tell the app what happened.</div>' +
          abortRow() +
        '</div>' +
        '<div class="mfoot">' +
          '<button class="btn bad" data-act="hit:0">MISS</button>' +
          '<button class="btn good" data-act="hit:1">HIT</button>' +
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
          abortRow() +
        '</div>' +
        '<div class="mfoot">' +
          '<button class="btn bad" data-act="wound:0">FAILED</button>' +
          '<button class="btn good" data-act="wound:1">WOUND</button>' +
        '</div>';
    }

    if (f.step === 'damage') {
      const dmg = damageDraft === null ? (n.variableDamage ? 0 : n.damage) : damageDraft;
      const lethal = dmg >= n.target.wounds;
      return head(title, 'DAMAGE DEALT') + crumb +
        '<div class="mbody">' +
          '<div class="rollbox">' +
            '<div class="lbl">DAMAGE TO ' + esc(n.target.name).toUpperCase() + '</div>' +
            '<div class="big">' + dmg + '</div>' +
            '<div class="sub">' + esc(n.weapon.name) + ' deals ' + esc(n.damageText) +
              (n.variableDamage ? ' — roll it and tap the result' : '') +
              (n.elevDamage ? ' +1 from the high-ground charge' : '') + ' · ' +
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
    return head('MENU', 'GAME TOOLS') +
      '<div class="mbody">' +
        '<button class="choice" data-act="showhouserules"><div class="cmain">' +
          '<div class="cname">ACTIONS &amp; AP</div>' +
          '<div class="cdesc">What every action costs and whether it gives your opponent AP — ' +
            'change any of it if I have one wrong.</div></div></button>' +
        '<button class="choice" data-act="showrules"><div class="cmain">' +
          '<div class="cname">RULES REFERENCE</div>' +
          '<div class="cdesc">Every Standard Action and Reaction, the wound table and the ' +
            'elevation bonuses, in full.</div></div></button>' +
        '<button class="choice" data-act="showlog"><div class="cmain">' +
          '<div class="cname">FULL GAME LOG</div>' +
          '<div class="cdesc">Every AP, VP, wound and effect change since the first turn.</div></div></button>' +
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
        '<div class="noteline">Play on if you agreed a higher target; the app keeps tracking either way.</div>' +
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

  function setVPDraft(v) { vpDraft = Math.max(0, v); render(); }
  function clearVPDraft() { vpDraft = null; }
  function getVPDraft() { return vpDraft; }

  return { render, setModal, getModal: () => modal,
           setDamageDraft, clearDamageDraft, getDamageDraft,
           setVPDraft, clearVPDraft, getVPDraft, esc };
})();

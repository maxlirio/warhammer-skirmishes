/* =========================================================================
   UI — play screen, guided action flows, modals.
   ========================================================================= */

const UI = (function () {

  let modal = null;          // UI-only overlays: 'actions' | 'menu' | 'log' | {unit:id}
  let damageDraft = null;

  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const G = () => Store.get();

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
        rosterCol(g, 0) + rosterCol(g, 1) +
      '</div></div>' +
      tokenTray(g) +
      chainbox(g) +
      actionbar(g) +
    '</div>';
  }

  function topbar(g) {
    return '<div class="topbar">' +
      plate(g, 0) +
      '<div class="turnplate">' +
        '<div class="t1">TURN ' + g.turn.number + '</div>' +
        '<div class="t2">' + esc(g.players[g.turn.player].name) + '</div>' +
        '<div class="t3">' + (g.turn.phase === 'start' ? 'START PHASE'
                            : g.turn.phase === 'end' ? 'END PHASE' : 'ACTION PHASE') + '</div>' +
      '</div>' +
      plate(g, 1) +
    '</div>';
  }

  function plate(g, i) {
    const p = g.players[i];
    const active = g.control.player === i;
    return '<div class="pplate p' + i + (active ? ' active' : '') + '">' +
      '<div class="pname">' + esc(p.name) + (g.turn.player === i ? ' · turn' : '') + '</div>' +
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
    return '<div class="controlbar p' + cp + '">' +
      '<div><div class="who">' + who + '</div>' +
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
        '<span>' + w.hit + '+ · S' + w.strength + ' · D' + w.damage + '</span>' +
      '</div>';
    }).join('');

    const passives = (u.abilities || []).filter(a => a.trigger === 'passive')
      .map(a => '<span class="chip-s pass" title="' + esc(a.text) + '">' + esc(a.name) + '</span>').join('');

    const effects = (u.effects || []).map(e =>
      '<span class="chip-s eff">' + esc(e.label) +
        '<button data-act="rmeff:' + u.id + ':' + e.id + '">✕</button></span>').join('');

    const tokens = (u.tokens || []).map(t =>
      '<button class="tokenbtn" data-act="tok:' + u.id + ':' + t.id + '">[ ' + esc(t.label) + ' ]' +
        '<span class="x" data-act="rmtok:' + u.id + ':' + t.id + '">✕</span></button>').join('');

    const freeAbils = (u.abilities || []).filter(a => a.trigger === 'free' && u.alive)
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
      '<div class="ustats"><span><b>T</b> ' + u.toughness + '</span>' +
        '<span><b>Sv</b> ' + u.save + '+</span>' +
        '<span><b>M</b> ' + u.move + '"</span>' +
        (u.alive ? '' : '<span style="color:var(--bad)"><b>DESTROYED</b></span>') + '</div>' +
      '<div class="uwep">' + weapons + '</div>' +
      (u.notes ? '<div class="hint" style="margin:6px 0 0">' + esc(u.notes) + '</div>' : '') +
      ((passives || effects) ? '<div class="chips">' + passives + effects + '</div>' : '') +
      (tokens ? '<div class="chips">' + tokens + '</div>' : '') +
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
    if (!toks.length) return '';
    return '<div style="padding:7px 8px;border-top:1px solid var(--line);background:#0e141a;' +
      'display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
      '<span style="font-size:9px;letter-spacing:.16em;color:var(--ink-mute);font-weight:800">ON THE TABLE</span>' +
      toks.map(t => '<button class="tokenbtn" data-act="tok:' + t.unitId + ':' + t.id + '">' +
        '[ ' + esc(t.label) + ' ]<span style="color:var(--ink-mute);font-weight:600">' +
        esc(t.unitName) + '</span></button>').join('') +
    '</div>';
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
      '<button class="bigbtn' + (pending ? '' : '') + '" data-act="' +
        (pending ? 'openphase' : 'openactions') + '">' +
        (pending ? (g.pending.type === 'start' ? 'RESOLVE START PHASE' : 'RESOLVE END PHASE') : 'ACTION LIST') +
      '</button>' +
      '<button class="sidebtn" data-act="menu"><span class="ic">≡</span>MENU</button>' +
    '</div>';
  }

  /* =============================================================== OVERLAY */

  function overlay(g) {
    if (g.flow) return wrap(flowModal(g));
    if (modal === 'actions') return wrap(actionListModal(g));
    if (modal === 'menu') return wrap(menuModal(g));
    if (modal === 'log') return wrap(logModal(g));
    if (modal === 'mission') return wrap(missionModal(g));
    if (modal === 'rules') return wrap(rulesModal());
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
    const rows = RULES.actions.map(function (a) {
      const av = Engine.actionAvailability(a);
      const cost = a.cost === null ? 'X AP' : (a.cost === 0 ? 'FREE' : a.cost + ' AP');
      return '<button class="choice' + (av.ok ? '' : ' disabled') + '" data-act="action:' + a.id + '">' +
        '<div class="cmain">' +
          '<div class="cname">' + a.name +
            ' <span class="ctag ' + (a.kind === 'aggressive' ? 'agg">AGGRESSIVE' : 'pas">PASSIVE') + '</span></div>' +
          '<div class="cdesc">' + esc(a.short || a.text) + '</div>' +
          (av.ok ? '' : '<div class="cflav" style="color:var(--bad)">' + esc(av.why) + '</div>') +
        '</div>' +
        '<div class="ccost' + (a.cost === 0 ? ' free' : '') + '">' + cost + '</div>' +
      '</button>';
    }).join('');

    return head('ACTION LIST', esc(g.players[cp].name) + ' · ' + g.players[cp].ap + ' AP AVAILABLE') +
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
        block('STANDARD ACTIONS', RULES.actions, 'AP') +
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
          : missionCheck(g) + specialObjectiveCheck(g) +
            '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:12px 0 6px">' +
            'ANY OTHER VP</div>' +
            '<div class="noteline">Award anything the app cannot know about. Killing is not the only source of VP.</div>' +
            '<div style="display:flex;gap:7px;margin-bottom:8px">' +
              '<button class="btn sm" data-act="vp:0:1">+1 VP ' + esc(g.players[0].name) + '</button>' +
              '<button class="btn sm" data-act="vp:1:1">+1 VP ' + esc(g.players[1].name) + '</button>' +
            '</div>') +
      '</div>' +
      '<div class="mfoot">' +
        '<button class="btn primary" data-act="' + (isStart ? 'confirmStart' : 'confirmEnd') + '">' +
          (isStart ? 'GAIN 1 AP & BEGIN ACTION PHASE' : 'END TURN') + '</button>' +
      '</div>';
  }

  /* Mission objectives are checked in the End Phase, after END: abilities. */
  function missionCheck(g) {
    const m = g.mission || {};
    const objs = m.objectives || [];
    if (!m.name && !objs.length) return '';
    return '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
        'MISSION' + (m.name ? ' — ' + esc(m.name).toUpperCase() : '') + '</div>' +
      (m.text ? '<div class="noteline">' + esc(m.text) + '</div>' : '') +
      (objs.length
        ? objs.map(function (o) {
            const c0 = Engine.objectiveScoredBy(o.id, 0);
            const c1 = Engine.objectiveScoredBy(o.id, 1);
            const lock0 = !o.repeat && c0 > 0;
            const lock1 = !o.repeat && c1 > 0;
            return '<div class="sub" style="background:#0f161d;margin-bottom:7px">' +
              '<div style="font-weight:700;font-size:13px">' + esc(o.name) +
                ' <span style="color:var(--gold);font-size:11px">' + o.vp + ' VP</span></div>' +
              (o.text ? '<div class="cdesc" style="color:var(--ink-dim);font-size:11.5px;margin:3px 0 6px">' +
                esc(o.text) + '</div>' : '<div style="height:6px"></div>') +
              '<div style="display:flex;gap:6px">' +
                '<button class="btn sm' + (lock0 ? ' ghost' : '') + '" style="flex:1"' +
                  (lock0 ? ' disabled' : ' data-act="scoreobj:' + o.id + ':0"') + '>' +
                  esc(g.players[0].name) + (c0 ? ' ·' + c0 : '') + '</button>' +
                '<button class="btn sm' + (lock1 ? ' ghost' : '') + '" style="flex:1"' +
                  (lock1 ? ' disabled' : ' data-act="scoreobj:' + o.id + ':1"') + '>' +
                  esc(g.players[1].name) + (c1 ? ' ·' + c1 : '') + '</button>' +
                ((c0 || c1) ? '<button class="btn sm ghost" data-act="unscoreobj:' + o.id + ':' +
                  (c1 && !c0 ? 1 : 0) + '">↺</button>' : '') +
              '</div>' +
            '</div>';
          }).join('')
        : '<div class="noteline">No objectives on this mission card.</div>');
  }

  function specialObjectiveCheck(g) {
    const cards = g.players.map(p => p.objective).filter(Boolean);
    if (!cards.length) return '';
    return '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:12px 0 6px">' +
        'SPECIAL OBJECTIVES</div>' +
      g.players.map(function (p) {
        const o = p.objective;
        if (!o) return '';
        const done = (o.completed || 0) > 0 && !o.repeat;
        return '<div class="sub" style="background:#0f161d;margin-bottom:7px;' +
          (done ? 'opacity:.55' : '') + '">' +
          '<div style="font-weight:700;font-size:13px">' + esc(o.name) +
            ' <span style="color:var(--ink-mute);font-size:11px">· ' + esc(p.name) + '</span></div>' +
          (o.text ? '<div style="color:var(--ink-dim);font-size:11.5px;margin:3px 0 6px">' +
            esc(o.text) + '</div>' : '<div style="height:6px"></div>') +
          '<div style="color:var(--gold);font-size:11px;margin-bottom:6px">' +
            ((o.effects || []).length ? o.effects.map(effectSummary).join(' · ') : 'No automatic reward stored') +
          '</div>' +
          (done
            ? '<div class="noteline">Already completed this game.</div>'
            : '<button class="btn sm" style="width:100%" data-act="claimobj:' + p.id + '">' +
              'COMPLETED — CLAIM REWARD</button>') +
        '</div>';
      }).join('');
  }

  /* =============================================================== FLOWS */

  function flowModal(g) {
    const f = g.flow;
    if (f.kind === 'attack')    return attackFlow(g, f);
    if (f.kind === 'ability')   return abilityFlow(g, f);
    if (f.kind === 'overwatch') return overwatchFlow(g, f);
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
      '</div>' +
      footBack('confirmsimple', 'DONE — ' + a.name);
  }

  function passFlow(g, f) {
    return head('PASS', 'CONFIRM') +
      '<div class="mbody"><div class="noteline">Your turn ends immediately. Any unspent AP carries over.</div>' +
      '<div class="noteline">' + esc(g.players[g.control.player].name) + ' currently has ' +
        g.players[g.control.player].ap + ' AP.</div></div>' +
      footBack('confirmpass', 'END MY TURN');
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
          '<div class="sub">Place the overwatch token within 12" of this unit.</div></div>' +
        '<div class="noteline">The app will show a <b>[ OVERWATCH ]</b> button. Press it yourself when ' +
          'an enemy triggers it on the table — the app never decides that.</div>' +
        '<div class="noteline">The shot is at <b>-1 to hit</b> with ' +
          esc(ranged.length ? ranged[0].name : 'no ranged weapon!') + ', and the defender gains no RP.</div>' +
        '<div class="noteline warn">Removed if this unit moves or attacks' +
          (g.settings.overwatchEndsWithChain ? ', or when this action chain ends' : '') + '.</div>' +
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
            '</div><div class="ccost">' + a.cost + ' AP</div></button>').join('') +
        '</div>' + footBack();
    }
    const ab = Engine.findAbility(f.unitId, f.abilityId);
    if (f.step === 'pick') {
      const needs = Engine.effectsNeedingTarget(ab, { sourceUnitId: f.unitId });
      const e = needs.find(x => !f.targets[x.id]) || needs[0];
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
          (f.targets[e.id] ? ' → <b>' + esc(Store.unit(f.targets[e.id]).name) + '</b>' : '') +
          '</div>').join('') +
        '<div class="noteline warn">Costs ' + ab.cost + ' AP. ' +
          (ab.opponentGainsAP === 'default' || Number(ab.opponentGainsAP) > 0
            ? 'Your opponent gains ' + (ab.opponentGainsAP === 'default' ? 1 : ab.opponentGainsAP) +
              ' AP (SPECIAL ABILITY is a Passive Action — they may use any unit).'
            : 'Your opponent gains no AP.') + '</div>' +
      '</div>' +
      footBack('confirmability', 'USE ABILITY');
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
      const e = needs.find(x => !f.targets[x.id]) || needs[0];
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
              (f.targets[e.id] ? ' → <b>' + esc(Store.unit(f.targets[e.id]).name) + '</b>' : '') + '</div>').join('')
          : '<div class="noteline">This token has no stored mechanical effects — it is a reminder only. ' +
            'Adjust wounds or AP by hand if needed.</div>') +
        (t.expiry === 'used' ? '<div class="noteline warn">The button is removed after this.</div>' : '') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost sm" data-act="close">CANCEL</button>' +
      '<button class="btn primary" data-act="confirmtoken">RESOLVE</button></div>';
  }

  /* ------------------------------------------------------------- attack */

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
    const title = isOW ? 'OVERWATCH SHOT' : action.name;
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
      const enemies = Store.unitsOf(Store.opponentOf(attacker.owner), true);
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

      return head(esc(g.players[defPlayer].name) + ' REACTS',
        (range === 'melee' ? 'MELEE' : 'RANGED') + ' REACTION · ' + rp + ' RP') + crumb +
        '<div class="mbody">' +
          list.filter(r => !r.isSpecial).map(r =>
            '<button class="choice' + (r.cost > rp ? ' disabled' : '') + '" data-act="reaction:' + r.id + '">' +
              '<div class="cmain"><div class="cname">' + r.name + '</div>' +
              '<div class="cdesc">' + esc(r.text) + '</div>' +
              '<div class="cflav">' + esc(r.flavour) + '</div></div>' +
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
        '</div>' +
        '<div class="mfoot"><button class="btn ghost sm" data-act="flowback">BACK</button></div>';
    }

    if (f.step === 'eligible') {
      return head('DIVE', 'DID THE ATTACK STILL HAPPEN?') + crumb +
        '<div class="mbody">' +
          '<div class="noteline">' + esc(target.name) + ' moved 2". You decide on the table whether ' +
            'it is still an eligible target.</div>' +
        '</div>' +
        '<div class="mfoot">' +
          '<button class="btn" data-act="eligible:1">STILL ELIGIBLE</button>' +
          '<button class="btn good" data-act="eligible:0">OUT OF SIGHT — ATTACK CANCELLED</button>' +
        '</div>';
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
          '<div class="noteline">Roll it on the table, then tell the app what happened.</div>' +
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
            '<div class="sub">S' + n.weapon.strength + ' vs T' + n.target.toughness + ' — ' +
              n.woundReason + ' (' + n.baseWound + '+) · ' + modTxt +
              (n.woundCapped ? ' <span style="color:var(--warn)">(capped)</span>' : '') + '</div>' +
            (n.elevWound ? '<div class="modline">High ground: +1 to Wound and +1 Damage.</div>' : '') +
          '</div>' +
          elevToggle(f, action) +
        '</div>' +
        '<div class="mfoot">' +
          '<button class="btn bad" data-act="wound:0">FAILED</button>' +
          '<button class="btn good" data-act="wound:1">WOUND</button>' +
        '</div>';
    }

    if (f.step === 'damage') {
      const dmg = damageDraft === null ? n.damage : damageDraft;
      const lethal = dmg >= n.target.wounds;
      return head(title, 'DAMAGE DEALT') + crumb +
        '<div class="mbody">' +
          '<div class="rollbox">' +
            '<div class="lbl">DAMAGE TO ' + esc(n.target.name).toUpperCase() + '</div>' +
            '<div class="big">' + dmg + '</div>' +
            '<div class="sub">' + esc(n.weapon.name) + ' deals ' + n.baseDamage +
              (n.elevDamage ? ' +1 from the high-ground charge' : '') + ' by default · ' +
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
        '<button class="choice" data-act="showrules"><div class="cmain">' +
          '<div class="cname">RULES REFERENCE</div>' +
          '<div class="cdesc">Every Standard Action and Reaction, the wound table and the ' +
            'elevation bonuses, in full.</div></div></button>' +
        '<button class="choice" data-act="showlog"><div class="cmain">' +
          '<div class="cname">FULL GAME LOG</div>' +
          '<div class="cdesc">Every AP, VP, wound and effect change since the first turn.</div></div></button>' +
        ((g.mission && (g.mission.name || (g.mission.objectives || []).length)) ||
         g.players.some(p => p.objective)
          ? '<button class="choice" data-act="showmission"><div class="cmain">' +
              '<div class="cname">MISSION &amp; OBJECTIVES</div>' +
              '<div class="cdesc">The mission card, its objectives and both Special Objectives. ' +
                'They are also checked automatically in every End Phase.</div></div></button>'
          : '') +
        '<button class="choice" data-act="forceendchain"><div class="cmain">' +
          '<div class="cname">END THE ACTION CHAIN</div>' +
          '<div class="cdesc">Override: close the current chain and hand play back to the turn player.</div></div></button>' +
        '<button class="choice" data-act="forceendturn"><div class="cmain">' +
          '<div class="cname">END THIS TURN</div>' +
          '<div class="cdesc">Override: jump straight to the End Phase.</div></div></button>' +
        '<button class="choice" data-act="swapcontrol"><div class="cmain">' +
          '<div class="cname">GIVE CONTROL TO ' + esc(g.players[Store.opponentOf(g.control.player)].name).toUpperCase() + '</div>' +
          '<div class="cdesc">Override: the other player acts next, with a free choice of unit.</div></div></button>' +
        '<button class="choice" data-act="toggleow"><div class="cmain">' +
          '<div class="cname">OVERWATCH ENDS WITH THE CHAIN: ' +
            (g.settings.overwatchEndsWithChain ? 'ON' : 'OFF') + '</div>' +
          '<div class="cdesc">The rules say “until the end of this action chain”. Turn this off if ' +
            'you house-rule overwatch to persist until the unit moves or attacks.</div></div></button>' +
        '<button class="choice" data-act="newgame"><div class="cmain">' +
          '<div class="cname" style="color:var(--bad)">END GAME &amp; EDIT ROSTERS</div>' +
          '<div class="cdesc">Returns to setup. The current game state is discarded.</div></div></button>' +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="close">CLOSE</button></div>';
  }

  function missionModal(g) {
    return head('MISSION', esc((g.mission && g.mission.name) || 'OBJECTIVES')) +
      '<div class="mbody">' + missionCheck(g) + specialObjectiveCheck(g) + '</div>' +
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
        '<div class="noteline">T' + u.toughness + ' · Sv ' + u.save + '+ · M ' + u.move + '"</div>' +
        (u.notes ? '<div class="noteline">' + esc(u.notes) + '</div>' : '') +
        '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:10px 0 5px">WEAPONS</div>' +
        (u.weapons || []).map(w => '<div class="noteline">' + esc(w.name) + ' — ' +
          (w.type === 'melee' ? 'Melee' : 'Ranged') + ' · Hit ' + w.hit + '+ · S' + w.strength +
          ' · D' + w.damage + '</div>').join('') +
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
    const w = g.players[g.winner];
    return head('VICTORY', esc(w.name).toUpperCase()) +
      '<div class="mbody">' +
        '<div class="winner">' + esc(w.name) + ' reaches ' + w.vp + ' VP</div>' +
        '<div class="noteline">' + esc(g.players[0].name) + ' — ' + g.players[0].vp + ' VP · ' +
          esc(g.players[1].name) + ' — ' + g.players[1].vp + ' VP</div>' +
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

  return { render, setModal, getModal: () => modal, setDamageDraft, clearDamageDraft, getDamageDraft, esc };
})();

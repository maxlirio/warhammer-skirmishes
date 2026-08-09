/* =========================================================================
   MAIN — bootstrap and event routing.
   One delegated click handler drives both screens; every play-screen action
   goes through the Engine so AP/VP/wounds/chain stay consistent.
   ========================================================================= */

(function () {

  const KEY_SETUP = 'whsk.setup.v1';

  /* ------------------------------------------------------------ bootstrap */

  function saveSetup() {
    try { localStorage.setItem(KEY_SETUP, JSON.stringify(Setup.state())); } catch (e) {}
  }

  function loadSetup() {
    try {
      const raw = localStorage.getItem(KEY_SETUP);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  Store.subscribe(function () { UI.render(); });

  const hadGame = Store.load();
  Setup.init(loadSetup());
  UI.render();

  /* --------------------------------------------------------------- events */

  document.addEventListener('click', function (ev) {
    const el = ev.target.closest('[data-act]');
    if (!el) {
      // Tapping the dark area outside a modal closes UI-only overlays.
      if (ev.target.dataset && ev.target.dataset.overlay) {
        const g = Store.get();
        if (g && !g.flow && !g.pending) { UI.setModal(null); }
      }
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const cmd = el.getAttribute('data-act');
    if (Store.get()) handlePlay(cmd);
    else if (Setup.act(cmd)) { saveSetup(); UI.render(); }
    else saveSetup();
  });

  document.addEventListener('input', function (ev) {
    const el = ev.target.closest('[data-bind]');
    if (!el || Store.get()) return;
    Setup.bind(el.getAttribute('data-bind'), el.value);
    saveSetup();
  });

  document.addEventListener('change', function (ev) {
    const el = ev.target.closest('[data-bind]');
    if (!el || Store.get()) return;
    Setup.bind(el.getAttribute('data-bind'), el.value);
    saveSetup();
    if (el.hasAttribute('data-rerender') || el.tagName === 'SELECT') UI.render();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    const g = Store.get();
    if (!g) return;
    if (g.flow) Engine.cancelFlow();
    else UI.setModal(null);
  });

  /* ---------------------------------------------------------- play router */

  function handlePlay(cmd) {
    const p = cmd.split(':');
    const g = Store.get();

    switch (p[0]) {

      /* ---- shell ---- */
      case 'close':        UI.setModal(null); return;
      case 'dismissphase': UI.setModal('phase-dismissed'); return;
      case 'dismisswin':   UI.setModal('win-dismissed'); return;
      case 'menu':         UI.setModal('menu'); return;
      case 'showlog':      UI.setModal('log'); return;
      case 'showrules':    UI.setModal('rules'); return;
      case 'openactions':  UI.setModal('actions'); return;
      case 'openphase':    UI.setModal(null); return;
      case 'unitinfo':     UI.setModal({ unit: p[1] }); return;
      case 'undo': {
        const label = Store.undo();
        if (!label) return;
        UI.clearDamageDraft();
        UI.setModal(null);
        return;
      }

      /* ---- manual bookkeeping ---- */
      case 'ap': Engine.adjustAP(Number(p[1]), Number(p[2])); return;
      case 'vp': Engine.adjustVP(Number(p[1]), Number(p[2]), 'manual / objective'); return;
      case 'w':  Engine.adjustWounds(p[1], Number(p[2])); return;
      case 'rmeff': Engine.removeEffect(p[1], p[2]); return;
      case 'rmtok': Engine.removeToken(p[1], p[2]); Store.commit('remove token', function () {}); return;
      case 'killunit': Engine.removeUnit(p[1], true); UI.setModal(null); return;

      case 'addtok': {
        const label = prompt('Button label (e.g. PROXIMITY MINE):', 'TOKEN');
        if (!label) return;
        const text = prompt('What happens when it is pressed? (reminder text)', '') || '';
        Engine.addManualToken(p[1], label, 'manual', text);
        UI.setModal(null);
        return;
      }
      case 'addeff': {
        const label = prompt('Modifier name:', 'Custom modifier');
        if (!label) return;
        const h = Number(prompt('Modifier to this unit\'s Hit rolls (e.g. -1, 0, 1):', '0')) || 0;
        const w = Number(prompt('Modifier to this unit\'s Wound rolls (e.g. -1, 0, 1):', '0')) || 0;
        Engine.addManualEffect(p[1], label, h, w, 'manual');
        UI.setModal(null);
        return;
      }

      /* ---- phases ---- */
      case 'confirmStart': UI.setModal(null); Engine.confirmStartPhase(); return;
      case 'confirmEnd':   UI.setModal(null); Engine.confirmEndPhase(); return;
      case 'phaseab':      Engine.usePhaseAbility(p[1], p[2]); return;

      /* ---- missions & special objectives ---- */
      case 'showmission':  UI.setModal('mission'); return;
      case 'scoreobj':     UI.clearVPDraft(); Engine.scoreMissionObjective(p[1], Number(p[2])); return;
      case 'claimobj':     UI.clearVPDraft(); Engine.claimSpecialObjective(Number(p[1])); return;
      case 'askvp':
        UI.clearVPDraft();
        Engine.promptVP(Number(p[1]), 'objectives and mission scoring', 1);
        return;

      /* ---- VP entry ---- */
      case 'vpset': UI.setVPDraft(Number(p[1])); return;
      case 'vpadd': {
        const q = g.vpPrompts[0];
        const cur = UI.getVPDraft() === null ? (Number(q && q.suggested) || 0) : UI.getVPDraft();
        UI.setVPDraft(cur + Number(p[1]));
        return;
      }
      case 'vpok': {
        const q = g.vpPrompts[0];
        UI.clearVPDraft();
        if (q) Engine.resolveVP(q.id, Number(p[1]));
        return;
      }

      /* ---- overrides ---- */
      case 'forceendchain': UI.setModal(null); Engine.forceEndChain(); return;
      case 'forceendturn':  UI.setModal(null); Engine.forceEndTurn(); return;
      case 'swapcontrol':
        UI.setModal(null);
        Engine.forceControl(Store.opponentOf(g.control.player), null);
        return;
      case 'toggleow':
        Store.commit('setting', function () {
          const s = Store.get();
          s.settings.overwatchEndsWithChain = !s.settings.overwatchEndsWithChain;
        });
        return;
      case 'newgame': {
        if (!confirm('End this game and go back to roster setup?')) return;
        const cur = Store.get();
        const st = {
          p1: cur.players[0].name, p2: cur.players[1].name,
          vpTarget: cur.settings.vpTarget, firstPlayer: 0, tab: 0,
          units: JSON.parse(JSON.stringify(cur.units)), open: {},
          mission: JSON.parse(JSON.stringify(cur.mission || { name: '', text: '', objectives: [] })),
          objectives: cur.players.map(p => p.objective
            ? Object.assign(JSON.parse(JSON.stringify(p.objective)), { completed: 0 })
            : Store.newSpecialObjective()),
          showMission: !!(cur.mission && cur.mission.name)
        };
        st.units.forEach(u => { u.wounds = u.maxWounds; u.alive = true; u.effects = []; u.tokens = []; });
        Store.clear();
        Setup.init(st);
        saveSetup();
        UI.setModal(null);
        UI.render();
        return;
      }

      /* ---- starting an action ---- */
      case 'action':
        UI.setModal(null);
        UI.clearDamageDraft();
        Engine.beginAction(p[1]);
        return;

      /* ---- flow navigation ---- */
      case 'flowback': UI.clearDamageDraft(); Engine.flowBack(); return;

      case 'pickunit': Engine.flowPickUnit(p[1]); return;
      case 'picktargetunit': Engine.flowPickAttackTarget(p[1]); return;
      case 'pickweapon': Engine.flowPickWeapon(p[1]); return;
      case 'reaction': Engine.flowPickReaction(p[1], null); return;
      case 'reactionsp': Engine.flowPickReaction('special', p[1]); return;
      case 'eligible': Engine.flowEligibility(p[1] === '1'); return;
      case 'elev': Engine.setElevation(!g.flow.elevation); return;
      case 'hit': Engine.flowHit(p[1] === '1'); return;
      case 'wound': UI.clearDamageDraft(); Engine.flowWound(p[1] === '1'); return;

      case 'dmgset': UI.setDamageDraft(Number(p[1])); return;
      case 'dmgadd': {
        const n = Engine.attackNumbers();
        const cur = UI.getDamageDraft() === null ? (n ? n.damage : 1) : UI.getDamageDraft();
        UI.setDamageDraft(cur + Number(p[1]));
        return;
      }
      case 'dmgok': UI.clearDamageDraft(); Engine.flowDamage(Number(p[1])); return;

      case 'pickab': Engine.flowPickAbility(p[1]); return;
      case 'picktarget': Engine.flowPickTarget(p[1], p[2]); return;
      case 'confirmability': Engine.confirmAbility(); return;

      case 'confirmsimple': Engine.confirmSimple(); return;
      case 'confirmpass': Engine.confirmPass(); return;
      case 'confirmoverwatch': Engine.confirmOverwatch(); return;

      /* ---- tokens ---- */
      case 'tok': UI.setModal(null); Engine.triggerToken(p[1], p[2]); return;
      case 'tokentarget': Engine.tokenPickTarget(p[1], p[2]); return;
      case 'confirmtoken': Engine.confirmToken(); return;

      /* ---- unit-card abilities ---- */
      case 'freeab': Engine.useFreeAbility(p[1], p[2]); return;
    }
  }

  /* Keep the action-chain view scrolled to the newest entry. */
  const observer = new MutationObserver(function () {
    const box = document.getElementById('chainbox');
    if (box) box.scrollTop = box.scrollHeight;
  });
  observer.observe(document.getElementById('app'), { childList: true, subtree: false });

  if (hadGame) Engine.log('Game resumed from this device\'s saved state.', 'muted');
})();

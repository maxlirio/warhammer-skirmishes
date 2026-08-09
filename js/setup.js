/* =========================================================================
   SETUP — an ordered wizard: players → mission → each army → review.
   ========================================================================= */

const Setup = (function () {

  const MAX_PLAYERS = 4;
  let S = null;

  function blankState() {
    return {
      step: 0,
      playerCount: 2,
      playerNames: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
      vpTarget: RULES.defaultVPTarget,
      firstPlayer: 0,
      missionId: null,
      roles: { attacker: null, defender: null },
      flagged: [null, null, null, null],
      objectives: [Store.newSpecialObjective(), Store.newSpecialObjective(),
                   Store.newSpecialObjective(), Store.newSpecialObjective()],
      units: [],
      open: {},
      picker: null,
      showMission: false
    };
  }

  function init(existing) {
    S = existing || blankState();
    const b = blankState();

    /* Anything missing from an older saved setup gets filled in. */
    Object.keys(b).forEach(k => { if (S[k] === undefined || S[k] === null) S[k] = b[k]; });

    /* Migrate the old two-player shape. */
    if (S.p1 || S.p2) {
      S.playerNames = [S.p1 || 'Player 1', S.p2 || 'Player 2', 'Player 3', 'Player 4'];
      delete S.p1; delete S.p2;
    }
    while (S.playerNames.length < MAX_PLAYERS) S.playerNames.push('Player ' + (S.playerNames.length + 1));
    while (S.objectives.length < MAX_PLAYERS) S.objectives.push(Store.newSpecialObjective());
    S.playerCount = Math.max(2, Math.min(MAX_PLAYERS, Number(S.playerCount) || 2));
    S.step = Math.max(0, Math.min(lastStep(), Number(S.step) || 0));
    S.picker = null;
    return S;
  }

  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const unitsOf = owner => S.units.filter(u => u.owner === owner);
  const findUnit = id => S.units.find(u => u.id === id);
  const findWeapon = (uid, wid) => { const u = findUnit(uid); return u && u.weapons.find(w => w.id === wid); };
  const findAbility = (uid, aid) => { const u = findUnit(uid); return u && u.abilities.find(a => a.id === aid); };
  const findEffect = (uid, aid, eid) => { const a = findAbility(uid, aid); return a && a.effects.find(e => e.id === eid); };
  const findTEffect = (uid, aid, eid, tid) => {
    const e = findEffect(uid, aid, eid);
    return e && (e.tokenEffects || []).find(t => t.id === tid);
  };

  /* --------------------------------------------------------------- steps */

  /* The slides are built fresh each render, because the mission card decides
     whether a briefing slide is needed at all. */
  function steps() {
    const list = [{ kind: 'players' }, { kind: 'mission' }];
    for (let i = 0; i < S.playerCount; i++) list.push({ kind: 'army', owner: i });
    if (missionNeedsBriefing()) list.push({ kind: 'briefing' });
    list.push({ kind: 'review' });
    return list;
  }

  const lastStep = () => steps().length - 1;
  const stepAt = n => steps()[Math.max(0, Math.min(lastStep(), n))];
  const card = () => (S.missionId ? RULES.missionById(S.missionId) : null);

  function missionNeedsBriefing() {
    const m = card();
    if (!m) return false;
    return !!m.roles || !!(m.unitFlag && m.unitFlag.pickAtSetup);
  }

  function stepTitle(n) {
    const s = stepAt(n);
    if (s.kind === 'players') return 'PLAYERS';
    if (s.kind === 'mission') return 'MISSION';
    if (s.kind === 'briefing') return 'BRIEFING';
    if (s.kind === 'review') return 'READY';
    return esc(S.playerNames[s.owner]).toUpperCase() + '’S ARMY';
  }

  /* Why NEXT is unavailable, or null if it is fine. */
  function blockedReason(n) {
    const s = stepAt(n);
    if (s.kind === 'players') {
      const names = S.playerNames.slice(0, S.playerCount).map(x => String(x).trim());
      if (names.some(x => !x)) return 'Every player needs a name.';
    }
    if (s.kind === 'mission') {
      const m = card();
      if (m && m.players && m.players !== S.playerCount) {
        return m.name + ' is a ' + m.players + '-player mission.';
      }
    }
    if (s.kind === 'army' && !unitsOf(s.owner).length) {
      return 'Add at least one unit for ' + S.playerNames[s.owner] + '.';
    }
    if (s.kind === 'briefing') {
      const m = card();
      if (m && m.roles && (S.roles.attacker === S.roles.defender ||
          S.roles.attacker === null || S.roles.defender === null)) {
        return 'Choose who is attacking and who is defending.';
      }
      if (m && m.unitFlag && m.unitFlag.pickAtSetup) {
        for (let i = 0; i < S.playerCount; i++) {
          if (!S.flagged[i]) return 'Every player must name their ' + m.unitFlag.label + '.';
        }
      }
    }
    return null;
  }

  /* ------------------------------------------------------------- rendering */

  function render() {
    const n = S.step;
    const blocked = blockedReason(n);
    const last = n === lastStep();

    const s = stepAt(n);
    let body;
    if (s.kind === 'players') body = playersStep();
    else if (s.kind === 'mission') body = missionStep();
    else if (s.kind === 'briefing') body = briefingStep();
    else if (s.kind === 'review') body = reviewStep();
    else body = armyStepView(s.owner);

    return '<div class="screen">' +
      '<div class="wizhead">' +
        '<div class="wiztitle">WARHAMMER <span>SKIRMISHES</span></div>' +
        '<div class="wizstep">STEP ' + (n + 1) + ' OF ' + (lastStep() + 1) + ' — ' + stepTitle(n) + '</div>' +
        '<div class="wizdots">' +
          Array.from({ length: lastStep() + 1 }, (_, i) =>
            '<button class="dot' + (i === n ? ' on' : (i < n ? ' done' : '')) + '" ' +
              'data-act="goto:' + i + '"></button>').join('') +
        '</div>' +
      '</div>' +
      '<div class="screen scroll"><div class="setup">' + body + '<div style="height:20px"></div></div></div>' +
      '<div class="wizfoot">' +
        (n > 0 ? '<button class="btn ghost" style="flex:0 0 96px" data-act="prev">BACK</button>' : '') +
        (last
          ? '<button class="bigbtn" style="flex:1" data-act="start">BEGIN THE SKIRMISH</button>'
          : '<button class="bigbtn' + (blocked ? ' dim' : '') + '" style="flex:1" data-act="next">' +
            (blocked ? esc(blocked) : 'NEXT') + '</button>') +
      '</div>' +
    '</div>' + pickerOverlay();
  }

  function field(label, inner) {
    return '<div class="field"><label>' + label + '</label>' + inner + '</div>';
  }

  /* --------------------------------------------------------- step: players */

  function playersStep() {
    return '<div class="lead">How many of you are playing?</div>' +
      '<div class="pickrow">' +
        [2, 3, 4].map(n => '<button class="pickbtn' + (S.playerCount === n ? ' on' : '') +
          '" data-act="count:' + n + '">' + n + '<span>PLAYERS</span></button>').join('') +
      '</div>' +

      '<h2>NAMES</h2>' +
      S.playerNames.slice(0, S.playerCount).map((nm, i) =>
        '<div class="field"><label class="p' + i + '">PLAYER ' + (i + 1) + '</label>' +
          '<input type="text" data-bind="pname:' + i + '" data-rerender="1" value="' + esc(nm) + '">' +
        '</div>').join('') +

      '<h2>THE GAME</h2>' +
      '<div class="grid2">' +
        field('VICTORY POINTS TO WIN',
          '<input type="number" min="1" data-bind="cfg:vpTarget" value="' + esc(S.vpTarget) + '">') +
        field('WHO TAKES THE FIRST TURN',
          '<select data-bind="cfg:firstPlayer" data-rerender="1">' +
            S.playerNames.slice(0, S.playerCount).map((nm, i) =>
              '<option value="' + i + '"' + (S.firstPlayer === i ? ' selected' : '') + '>' +
                esc(nm) + '</option>').join('') +
          '</select>') +
      '</div>' +
      '<div class="hint">Play passes around the table in this order. Each turn the active player ' +
        'gains 1 AP in their Start Phase.</div>' +
      (S.playerCount > 2
        ? '<div class="noteline warn" style="margin-top:10px">With more than two players the rules\' ' +
          '“your opponent” is ambiguous, so the app will ask you which opponent it means whenever ' +
          'it matters. An attack never needs asking — the target\'s owner is the opponent.</div>'
        : '');
  }

  /* --------------------------------------------------------- step: mission */

  function missionCardFace(m, chosen) {
    const bad = m.players && m.players !== S.playerCount;
    return '<button class="misscard' + (chosen ? ' on' : '') + (bad ? ' bad' : '') + '" ' +
      'data-act="mission:' + m.id + '">' +
      '<div class="mcname">' + m.name +
        (m.players ? ' <span class="mcp">' + m.players + ' PLAYERS</span>' : '') + '</div>' +
      '<div class="mcflav">' + esc(m.flavour) + '</div>' +
      '<div class="mcsec"><b>BATTLEFIELD</b> ' + esc(m.battlefield) + '</div>' +
      '<div class="mcsec"><b>OBJECTIVE</b> ' + esc(m.objective) + '</div>' +
      '<div class="mcsec"><b>SPECIAL RULES</b> ' + esc(m.special) + '</div>' +
      (bad ? '<div class="mcbad">Needs exactly ' + m.players + ' players.</div>' : '') +
      (chosen ? '<div class="mcon">SELECTED</div>' : '') +
    '</button>';
  }

  function missionStep() {
    const m = card();
    return '<div class="lead">Which Mission Card?</div>' +
      '<div class="hint">The card sets the battlefield and what you score for. The app tracks ' +
        'everything it can — markers you can shoot, objectives you SECURE, who is carrying the ' +
        'RELIC — and reads the rest back to you at the end of each turn.</div>' +
      '<button class="misscard' + (!S.missionId ? ' on' : '') + '" data-act="mission:none">' +
        '<div class="mcname">NO MISSION CARD</div>' +
        '<div class="mcflav">Just fight. Award VP by hand whenever you agree one was scored.</div>' +
        (!S.missionId ? '<div class="mcon">SELECTED</div>' : '') +
      '</button>' +
      RULES.missions.map(x => missionCardFace(x, S.missionId === x.id)).join('') +
      (m && m.extraActions
        ? '<div class="noteline warn">This mission adds the ' +
          m.extraActions.map(a => RULES.actionById(a).name).join(' and ') +
          ' action to the Action List.</div>' : '');
  }

  /* ------------------------------------------------------- step: briefing */

  function briefingStep() {
    const m = card();
    if (!m) return '';
    let html = '<div class="lead">' + m.name + ' — before you start</div>';

    if (m.roles) {
      html += '<h2>ROLES</h2>' +
        '<div class="hint">' + esc(m.battlefield) + '</div>' +
        Object.keys(m.roles).map(function (role) {
          return '<div class="field"><label>' + role.toUpperCase() + '</label>' +
            '<div class="pickrow">' +
              S.playerNames.slice(0, S.playerCount).map((nm, i) =>
                '<button class="pickbtn small' + (S.roles[role] === i ? ' on' : '') +
                  '" data-act="role:' + role + ':' + i + '">' + esc(nm) + '</button>').join('') +
            '</div>' +
            '<div class="hint">' + esc(m.roles[role]) + '</div></div>';
        }).join('');
    }

    if (m.unitFlag && m.unitFlag.pickAtSetup) {
      html += '<h2>' + m.unitFlag.label + '</h2>' +
        '<div class="hint">' + esc(m.unitFlag.hint) + '</div>' +
        S.playerNames.slice(0, S.playerCount).map(function (nm, i) {
          const list = unitsOf(i);
          return '<div class="card"><div class="chd"><div class="t p' + i + '">' + esc(nm) + '</div></div>' +
            (list.length
              ? list.map(u => '<button class="choice' + (S.flagged[i] === u.id ? ' sel' : '') +
                  '" data-act="flagunit:' + i + ':' + u.id + '">' +
                  '<div class="cmain"><div class="cname">' + esc(u.name) + '</div>' +
                  '<div class="cdesc">' + u.maxWounds + 'W → ' +
                    (u.maxWounds + (m.unitFlag.boostWounds || 0)) + 'W as the ' +
                    m.unitFlag.label + '</div></div>' +
                  (S.flagged[i] === u.id ? '<div class="ccost">' + m.unitFlag.label + '</div>' : '') +
                  '</button>').join('')
              : '<div class="hint">No units yet — go back and add some.</div>') +
          '</div>';
        }).join('');
    }
    return html;
  }

  /* ------------------------------------------------------------ step: army */

  function armyStepView(owner) {
    const list = unitsOf(owner);
    const rosterList = Store.rosters();
    return '<div class="lead p' + owner + '">' + esc(S.playerNames[owner]) + '’s army</div>' +

      specialObjectiveCard(owner) +

      '<h2>UNITS · ' + list.length + '</h2>' +
      list.map(u => unitCard(u)).join('') +
      '<button class="addbtn" data-act="openPicker:unit:' + owner + '">+ ADD UNIT</button>' +

      '<div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:14px 0 6px">' +
        'PRESET FACTIONS</div>' +
      PRESETS.map(f => '<button class="choice" data-act="preset:' + owner + ':' + f.id + '">' +
        '<div class="cmain"><div class="cname">' + esc(f.name) + '</div>' +
        '<div class="cdesc">' + f.units.length + ' units' +
          (f.objective ? ' · Special Objective “' + esc(f.objective.name) + '”' : '') +
          ' — ' + esc(f.note) + '</div></div></button>').join('') +
      '<button class="btn sm" style="width:100%;margin-top:6px" data-act="saveRoster:' + owner + '">' +
        'SAVE THIS ROSTER TO REUSE</button>' +

      (rosterList.length
        ? '<div class="sub" style="margin-top:9px">' +
            '<div class="shd">SAVED ROSTERS — tap to load into this slot</div>' +
            rosterList.map((r, i) =>
              '<div style="display:flex;gap:6px;margin-bottom:5px;align-items:center">' +
                '<button class="btn sm" style="flex:1;text-align:left" ' +
                  'data-act="loadRoster:' + owner + ':' + i + '">' + esc(r.name) +
                  ' <span style="color:var(--ink-mute);font-weight:600"> · ' + r.units.length + ' units</span></button>' +
                '<button class="iconbtn" data-act="delRoster:' + i + '">✕</button>' +
              '</div>').join('') +
          '</div>'
        : '');
  }

  /* ---------------------------------------------------------- step: review */

  function reviewStep() {
    return '<div class="lead">Ready to play</div>' +
      '<div class="card">' +
        '<div class="shd" style="margin-bottom:8px">THE TABLE</div>' +
        S.playerNames.slice(0, S.playerCount).map((nm, i) =>
          '<div class="revrow p' + i + '">' +
            '<span class="rn">' + esc(nm) + (S.firstPlayer === i ? ' · first turn' : '') + '</span>' +
            '<span class="rv">' + unitsOf(i).length + ' units</span>' +
          '</div>' +
          '<div class="revsub">' + (unitsOf(i).map(u => esc(u.name)).join(', ') || 'no units') +
            (S.objectives[i] && S.objectives[i].name
              ? '<br><span style="color:var(--gold)">Special Objective: ' + esc(S.objectives[i].name) + '</span>'
              : '') +
          '</div>').join('') +
      '</div>' +
      '<div class="card">' +
        '<div class="shd" style="margin-bottom:8px">MISSION</div>' +
        (card()
          ? '<div class="revrow"><span class="rn">' + card().name + '</span></div>' +
            '<div class="revsub">' + esc(card().objective) + '</div>' +
            (S.roles.attacker !== null && card().roles
              ? '<div class="revsub">Attacker: <b>' + esc(S.playerNames[S.roles.attacker]) +
                '</b> · Defender: <b>' + esc(S.playerNames[S.roles.defender]) + '</b></div>' : '') +
            (card().unitFlag && card().unitFlag.pickAtSetup
              ? '<div class="revsub">' + card().unitFlag.label + 's: ' +
                S.flagged.slice(0, S.playerCount).map(function (id) {
                  const u = findUnit(id);
                  return u ? esc(u.name) : '—';
                }).join(', ') + '</div>' : '')
          : '<div class="revsub">No mission card — you can still award VP by hand at any time.</div>') +
      '</div>' +
      '<div class="card">' +
        '<div class="shd" style="margin-bottom:8px">VICTORY</div>' +
        '<div class="revsub">First to <b style="color:var(--good)">' + esc(S.vpTarget) +
          ' VP</b> wins. Every unit, mission and objective you entered is being saved to this ' +
          'browser, so next time it is a few taps.</div>' +
      '</div>' +
      '<div class="grid2">' +
        '<button class="btn sm" style="flex:1" data-act="export">EXPORT JSON</button>' +
        '<button class="btn sm" style="flex:1" data-act="import">IMPORT JSON</button>' +
      '</div>';
  }

  /* ------------------------------------------------------------ unit card */

  function unitCard(u) {
    const open = !!S.open[u.id];
    if (!open) {
      return '<div class="card">' +
        '<div class="chd">' +
          '<div class="t">' + esc(u.name) + '</div>' +
          '<div style="font-size:11px;color:var(--ink-mute)">' + u.maxWounds + 'W · T' + u.toughness +
            ' · ' + (u.weapons || []).length + ' wpn · ' + (u.abilities || []).length + ' abil</div>' +
          '<button class="iconbtn" data-act="open:' + u.id + '">EDIT</button>' +
          '<button class="iconbtn" data-act="delUnit:' + u.id + '">✕</button>' +
        '</div></div>';
    }

    return '<div class="card">' +
      '<div class="chd">' +
        '<div class="t">' + esc(u.name) + '</div>' +
        '<button class="iconbtn" data-act="libSaveUnit:' + u.id + '">SAVE</button>' +
        '<button class="iconbtn" data-act="dupUnit:' + u.id + '">COPY</button>' +
        '<button class="iconbtn" data-act="open:' + u.id + '">CLOSE</button>' +
        '<button class="iconbtn" data-act="delUnit:' + u.id + '">✕</button>' +
      '</div>' +

      field('UNIT NAME', '<input type="text" data-bind="unit:' + u.id + ':name" data-rerender="1" value="' + esc(u.name) + '">') +

      '<div class="grid4">' +
        field('MOV&quot;', '<input type="number" min="0" data-bind="unit:' + u.id + ':move" value="' + esc(u.move) + '">') +
        field('W', '<input type="number" min="1" data-bind="unit:' + u.id + ':maxWounds" value="' + esc(u.maxWounds) + '">') +
        field('T', '<input type="number" min="1" data-bind="unit:' + u.id + ':toughness" value="' + esc(u.toughness) + '">') +
        field('OC', '<input type="number" min="0" data-bind="unit:' + u.id + ':oc" value="' + esc(u.oc || 0) + '">') +
      '</div>' +
      '<div class="hint">Straight off the datasheet. Toughness feeds the wound-table reminder ' +
        'the app shows during attacks; OC is tracked for you to read, never judged.</div>' +

      '<div class="sub">' +
        '<div class="shd">WEAPONS</div>' +
        (u.weapons || []).map(w => weaponRow(u, w)).join('') +
        '<button class="addbtn" data-act="addWeapon:' + u.id + '">+ ADD WEAPON</button>' +
      '</div>' +

      '<div class="sub">' +
        '<div class="shd">ABILITIES</div>' +
        '<div class="hint" style="margin:-2px 0 8px">Anything the app cannot model mechanically can ' +
          'still be a <b>button</b>: give it the text you want to see and press it when it happens. ' +
          'Buttons live on the unit card (FREE) or on the table until used (a token).</div>' +
        (u.abilities || []).map(a => abilityCard(u, a)).join('') +
        '<div style="display:flex;gap:7px">' +
          '<button class="addbtn" style="flex:1" data-act="addAbility:' + u.id + '">+ ADD ABILITY</button>' +
          '<button class="addbtn" style="flex:1" data-act="addButton:' + u.id + '">+ ADD PLAIN BUTTON</button>' +
        '</div>' +
      '</div>' +

      field('NOTES (shown on the unit card during play)',
        '<textarea data-bind="unit:' + u.id + ':notes">' + esc(u.notes) + '</textarea>') +
    '</div>';
  }

  function weaponRow(u, w) {
    return '<div class="sub" style="background:#0f161d">' +
      '<div class="chd">' +
        '<input type="text" data-bind="weapon:' + u.id + ':' + w.id + ':name" data-rerender="1" ' +
          'value="' + esc(w.name) + '" style="flex:1;background:#0f161d;border:1px solid var(--line);' +
          'border-radius:6px;padding:7px;min-height:36px">' +
        '<button class="iconbtn" data-act="delWeapon:' + u.id + ':' + w.id + '">✕</button>' +
      '</div>' +
      field('TYPE',
        '<select data-bind="weapon:' + u.id + ':' + w.id + ':type">' +
          '<option value="ranged"' + (w.type === 'ranged' ? ' selected' : '') + '>Ranged</option>' +
          '<option value="melee"' + (w.type === 'melee' ? ' selected' : '') + '>Melee</option>' +
        '</select>') +
      '<div class="grid4">' +
        field('RANGE&quot;', '<input type="number" min="0" data-bind="weapon:' + u.id + ':' + w.id + ':range" value="' + esc(w.range === undefined ? 0 : w.range) + '">') +
        field('HIT', '<input type="number" min="2" max="6" data-bind="weapon:' + u.id + ':' + w.id + ':hit" value="' + esc(w.hit) + '">') +
        field('STRENGTH', '<input type="number" min="1" data-bind="weapon:' + u.id + ':' + w.id + ':strength" value="' + esc(w.strength) + '">') +
        field('DAMAGE', '<input type="number" min="0" data-bind="weapon:' + u.id + ':' + w.id + ':damage" value="' + esc(w.damage) + '">') +
      '</div>' +
      '<button class="toggle' + (w.unlimited ? ' on' : '') + '" data-act="togUnlimited:' +
        u.id + ':' + w.id + '">' +
        '<span class="box">' + (w.unlimited ? '✓' : '') + '</span>' +
        '<span>Can be used any number of times in the same action chain</span></button>' +
    '</div>';
  }

  /* --------------------------------------------------------- ability card */

  function abilityCard(u, a) {
    const trig = RULES.abilityTriggers.find(t => t.id === a.trigger) || RULES.abilityTriggers[0];
    const costUnit = a.trigger === 'rp' ? 'RP' : 'AP';
    const showCost = a.trigger === 'ap' || a.trigger === 'rp';

    return '<div class="sub" style="background:#0f161d">' +
      '<div class="chd">' +
        '<input type="text" data-bind="ability:' + u.id + ':' + a.id + ':name" data-rerender="1" ' +
          'value="' + esc(a.name) + '" style="flex:1;background:#0f161d;border:1px solid var(--line);' +
          'border-radius:6px;padding:7px;min-height:36px">' +
        '<button class="iconbtn" data-act="delAbility:' + u.id + ':' + a.id + '">✕</button>' +
      '</div>' +

      '<div class="grid2">' +
        field('WHEN IS IT USED',
          '<select data-bind="ability:' + u.id + ':' + a.id + ':trigger" data-rerender="1">' +
            RULES.abilityTriggers.map(t =>
              '<option value="' + t.id + '"' + (a.trigger === t.id ? ' selected' : '') + '>' + t.label + '</option>').join('') +
          '</select>') +
        (showCost
          ? field('COST (' + costUnit + ')',
              '<input type="number" min="0" data-bind="ability:' + u.id + ':' + a.id + ':cost" value="' + esc(a.cost) + '">')
          : field('USES PER GAME (0 = unlimited)',
              '<input type="number" min="0" data-bind="ability:' + u.id + ':' + a.id + ':usesPerGame" value="' + esc(a.usesPerGame || 0) + '">')) +
      '</div>' +
      '<div class="hint">' + trig.hint + '</div>' +

      field('WHAT IT DOES (shown to you whenever it fires)',
        '<textarea data-bind="ability:' + u.id + ':' + a.id + ':text">' + esc(a.text) + '</textarea>') +

      '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:8px 0 5px">' +
        'MECHANICAL EFFECTS — optional; leave empty for a reminder-only ability' +
      '</div>' +
      (a.effects || []).map(e => abilityEffectRow(u, a, e)).join('') +
      '<div style="display:flex;gap:7px">' +
        '<button class="addbtn" style="flex:1" data-act="addEffect:' + u.id + ':' + a.id + '">+ EFFECT</button>' +
        '<button class="addbtn" style="flex:1" data-act="addTokenEffect:' + u.id + ':' + a.id + '">+ BUTTON ON THE TABLE</button>' +
      '</div>' +

      (a.trigger === 'ap'
        ? '<div class="grid2" style="margin-top:8px">' +
            field('ENDS THE ACTION CHAIN?',
              '<select data-bind="ability:' + u.id + ':' + a.id + ':endsChain">' +
                '<option value="default"' + (a.endsChain === 'default' ? ' selected' : '') + '>Rules default (no)</option>' +
                '<option value="yes"' + (a.endsChain === 'yes' ? ' selected' : '') + '>Yes — chain ends</option>' +
                '<option value="no"' + (a.endsChain === 'no' ? ' selected' : '') + '>No — chain continues</option>' +
              '</select>') +
            field('OPPONENT GAINS AP',
              '<select data-bind="ability:' + u.id + ':' + a.id + ':opponentGainsAP">' +
                '<option value="default"' + (a.opponentGainsAP === 'default' ? ' selected' : '') + '>Rules default (1 AP)</option>' +
                '<option value="0"' + (String(a.opponentGainsAP) === '0' ? ' selected' : '') + '>None</option>' +
                '<option value="1"' + (String(a.opponentGainsAP) === '1' ? ' selected' : '') + '>1 AP</option>' +
                '<option value="2"' + (String(a.opponentGainsAP) === '2' ? ' selected' : '') + '>2 AP</option>' +
              '</select>') +
          '</div>'
        : '') +
    '</div>';
  }

  /* ---------------------------------------------------------- effect rows */

  function abilityEffectRow(u, a, e) {
    const base = 'effect:' + u.id + ':' + a.id + ':' + e.id;
    const children = (e.tokenEffects || []).map(function (te) {
      return effectRow(te,
        'teffect:' + u.id + ':' + a.id + ':' + e.id + ':' + te.id,
        'delTEffect:' + u.id + ':' + a.id + ':' + e.id + ':' + te.id,
        { nested: true });
    }).join('');
    return effectRow(e, base, 'delEffect:' + u.id + ':' + a.id + ':' + e.id, {
      tokenChildren: { rows: children, addAct: 'addTEffect:' + u.id + ':' + a.id + ':' + e.id }
    });
  }

  /* opts: { nested, allow (kind ids), tokenChildren:{addAct, rows} } */
  function effectRow(e, base, delAct, opts) {
    opts = opts || {};
    const kind = RULES.effectKinds.find(k => k.id === e.kind) || RULES.effectKinds[0];
    const parentEffectId = opts.nested ? true : null;

    let inner = '';
    if (kind.num) {
      inner += field('AMOUNT' + (kind.unit ? ' (' + kind.unit + ')' : ''),
        '<input type="number" data-bind="' + base + ':value" value="' + esc(e.value) + '">');
    }
    if (kind.pick) {
      inner += field('APPLIES TO',
        '<select data-bind="' + base + ':pick">' +
          '<option value="prompt"' + (e.pick === 'prompt' ? ' selected' : '') + '>Ask me when it fires</option>' +
          '<option value="self"' + (e.pick === 'self' ? ' selected' : '') + '>This unit</option>' +
          '<option value="attacker"' + (e.pick === 'attacker' ? ' selected' : '') + '>The attacking unit (reactions)</option>' +
          '<option value="defender"' + (e.pick === 'defender' ? ' selected' : '') + '>The defending unit (reactions)</option>' +
        '</select>');
    }
    if (kind.dur) {
      inner += field('LASTS FOR',
        '<select data-bind="' + base + ':duration">' +
          RULES.durations.map(d =>
            '<option value="' + d.id + '"' + (e.duration === d.id ? ' selected' : '') + '>' + d.label + '</option>').join('') +
        '</select>');
    }
    if (kind.note) {
      inner += field('REMINDER TEXT',
        '<input type="text" data-bind="' + base + ':text" value="' + esc(e.text) + '">');
    }
    if (kind.aura) {
      inner += '<div class="hint" style="margin:0 0 8px">The app cannot measure the radius, so ' +
        'during an attack it offers this as a tick-box on the roll it would change. You look at ' +
        'the table and decide.</div>' +
        '<div class="grid2">' +
          field('MODIFIES',
            '<select data-bind="' + base + ':stat">' +
              '<option value="hit"' + (e.stat !== 'wound' ? ' selected' : '') + '>Hit rolls</option>' +
              '<option value="wound"' + (e.stat === 'wound' ? ' selected' : '') + '>Wound rolls</option>' +
            '</select>') +
          field('BY', '<input type="number" data-bind="' + base + ':value" value="' + esc(e.value) + '">') +
        '</div>' +
        field('WHOSE ATTACK',
          '<select data-bind="' + base + ':side">' +
            RULES.auraSides.map(x => '<option value="' + x.id + '"' +
              (e.side === x.id ? ' selected' : '') + '>' + x.label + '</option>').join('') +
          '</select>') +
        '<div class="grid2">' +
          field('RADIUS',
            '<select data-bind="' + base + ':mode">' +
              RULES.auraModes.map(x => '<option value="' + x.id + '"' +
                (e.mode === x.id ? ' selected' : '') + '>' + x.label + '</option>').join('') +
            '</select>') +
          field('INCHES', '<input type="number" min="0" data-bind="' + base + ':range" value="' +
            esc(e.range === undefined ? 6 : e.range) + '">') +
        '</div>' +
        field('APPLIES TO',
          '<select data-bind="' + base + ':weapon">' +
            RULES.weaponScopes.map(x => '<option value="' + x.id + '"' +
              (e.weapon === x.id ? ' selected' : '') + '>' + x.label + '</option>').join('') +
          '</select>') +
        '<button class="toggle' + (e.onlyVsOwner ? ' on' : '') + '" data-act="' +
          base.replace(/^effect:/, 'togAura:').replace(/^objeffect:/, 'togAuraObj:') + '">' +
          '<span class="box">' + (e.onlyVsOwner ? '✓' : '') + '</span>' +
          '<span>Only when <b>this unit</b> is the one being attacked</span></button>' +
        field('THE WORDING SHOWN ON THE TICK-BOX',
          '<input type="text" data-bind="' + base + ':text" value="' + esc(e.text) +
          '" placeholder="Units in your squad within 6&quot; have +1 to hit for ranged attacks.">');
    }
    if (kind.attack) {
      inner += '<div class="hint" style="margin:0 0 8px">Opens the normal attack flow with no AP ' +
        'cost. Use it for “make an attack with this unit’s …” abilities.</div>' +
        '<div class="grid2">' +
          field('WEAPON',
            '<select data-bind="' + base + ':weapon">' +
              '<option value="ranged"' + (e.weapon !== 'melee' ? ' selected' : '') + '>A ranged weapon</option>' +
              '<option value="melee"' + (e.weapon === 'melee' ? ' selected' : '') + '>A melee weapon</option>' +
            '</select>') +
          field('HIT MODIFIER', '<input type="number" data-bind="' + base + ':hitMod" value="' +
            esc(e.hitMod || 0) + '">') +
        '</div>' +
        field('THE DEFENDER GETS RP?',
          '<select data-bind="' + base + ':noRP">' +
            '<option value="true"' + (e.noRP !== false ? ' selected' : '') + '>No RP — no reaction</option>' +
            '<option value="false"' + (e.noRP === false ? ' selected' : '') + '>Yes, the normal 1 RP</option>' +
          '</select>') +
        field('THE WOUND ROLL',
          '<select data-bind="' + base + ':skipWound">' +
            '<option value="false"' + (!e.skipWound ? ' selected' : '') + '>Roll to wound as normal</option>' +
            '<option value="true"' + (e.skipWound ? ' selected' : '') + '>No wound roll — a hit is all it needs</option>' +
          '</select>');
    }
    if (kind.stat) {
      inner += '<div class="grid2">' +
        field('STAT',
          '<select data-bind="' + base + ':stat">' +
            RULES.statKinds.map(x => '<option value="' + x.id + '"' +
              (e.stat === x.id ? ' selected' : '') + '>' + x.label + '</option>').join('') +
          '</select>') +
        field('CHANGE BY', '<input type="number" data-bind="' + base + ':value" value="' + esc(e.value) + '">') +
      '</div>' +
      '<div class="hint">Permanent — it stays changed for the rest of the game.</div>';
    }
    if (kind.redirect) {
      inner += '<div class="hint">On an RP reaction: the app will ask the defender which of their ' +
        'units takes the attack instead, then carry on with the new target.</div>';
    }
    if (kind.block) {
      inner += field('REACTION FRIENDS CANNOT USE',
        '<select data-bind="' + base + ':reaction">' +
          RULES.rangedReactions.concat(RULES.meleeReactions).filter(r => !r.isSpecial)
            .map(r => '<option value="' + r.id + '"' + (e.reaction === r.id ? ' selected' : '') +
              '>' + r.name + '</option>').join('') +
        '</select>') +
        '<div class="hint">Shown struck through with your unit named, but still tappable — the ' +
          'app will not stop you if you both agree it does not apply.</div>';
    }
    if (kind.token && !parentEffectId && opts.tokenChildren) {
      inner += field('BUTTON LABEL',
        '<input type="text" data-bind="' + base + ':label" data-rerender="1" value="' + esc(e.label) + '" placeholder="PROXIMITY MINE">');
      inner += field('THE BUTTON DISAPPEARS',
        '<select data-bind="' + base + ':expiry">' +
          RULES.tokenExpiries.map(x =>
            '<option value="' + x.id + '"' + (e.expiry === x.id ? ' selected' : '') + '>' + x.label + '</option>').join('') +
        '</select>');
      inner += field('WHAT THE BUTTON SAYS WHEN PRESSED',
        '<input type="text" data-bind="' + base + ':text" value="' + esc(e.text) + '">');
      inner += '<div style="font-size:10px;letter-spacing:.12em;color:var(--ink-mute);font-weight:800;margin:6px 0 4px">' +
        'AND WHAT IT DOES — optional, a reminder alone is fine</div>' +
        opts.tokenChildren.rows +
        '<button class="addbtn" data-act="' + opts.tokenChildren.addAct + '">+ ADD TRIGGER EFFECT</button>';
    }

    const kinds = RULES.effectKinds.filter(function (k) {
      if (opts.allow) return opts.allow.indexOf(k.id) >= 0;
      return !(parentEffectId && k.id === 'token');
    });

    return '<div class="sub" style="background:#141c25;border-color:var(--line-hot)">' +
      '<div class="chd">' +
        '<select data-bind="' + base + ':kind" data-rerender="1" style="flex:1;background:#0f161d;' +
          'border:1px solid var(--line);border-radius:6px;padding:7px;min-height:36px">' +
          kinds.map(k => '<option value="' + k.id + '"' + (e.kind === k.id ? ' selected' : '') + '>' +
            k.label + '</option>').join('') +
        '</select>' +
        '<button class="iconbtn" data-act="' + delAct + '">✕</button>' +
      '</div>' + inner +
    '</div>';
  }

  /* -------------------------------------------------- special objective */

  function specialObjectiveCard(owner) {
    const o = S.objectives[owner];
    const who = S.playerNames[owner];
    return '<div class="card" style="border-color:var(--gold-dim)">' +
      '<div class="chd">' +
        '<div class="t" style="color:var(--gold)">SPECIAL OBJECTIVE</div>' +
        (o.name ? '<button class="iconbtn" data-act="clearObjective:' + owner + '">✕</button>' : '') +
      '</div>' +
      '<div class="hint">' + esc(who) + '’s own card: a feat that rewards them for completing it. ' +
        'Checked in the End Phase, after END: abilities. Leave the name blank to skip it.</div>' +
      field('OBJECTIVE NAME', '<input type="text" data-bind="obj:' + owner + ':name" data-rerender="1" value="' +
        esc(o.name) + '" placeholder="Blood for the Blood God">') +
      field('THE TEXT THE APP READS BACK AT THE END OF EACH TURN',
        '<textarea data-bind="obj:' + owner + ':text" placeholder="Destroy an enemy unit in melee in each of two consecutive turns.">' +
          esc(o.text) + '</textarea>') +
      '<div class="grid2">' +
        field('TYPICAL VP (pre-fills only)',
          '<input type="number" min="0" data-bind="obj:' + owner + ':vp" value="' + esc(o.vp || 0) + '">') +
        field('HOW OFTEN',
          '<select data-bind="obj:' + owner + ':repeat">' +
            '<option value="false"' + (!o.repeat ? ' selected' : '') + '>Once per game</option>' +
            '<option value="true"' + (o.repeat ? ' selected' : '') + '>Every time it is completed</option>' +
          '</select>') +
      '</div>' +
      '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:8px 0 5px">' +
        'EXTRA REWARDS BEYOND VP — optional (an AP bonus, a modifier)</div>' +
      (o.effects || []).map(e => effectRow(e, 'objeffect:' + owner + ':' + e.id,
        'delObjEffect:' + owner + ':' + e.id, { allow: RULES.objectiveEffectKinds })).join('') +
      '<button class="addbtn" data-act="addObjEffect:' + owner + '">+ ADD REWARD</button>' +
      '<div style="display:flex;gap:7px;margin-top:8px">' +
        '<button class="btn sm" style="flex:1" data-act="openPicker:objective:' + owner + '">LOAD SAVED</button>' +
        '<button class="btn sm" style="flex:1" data-act="libSaveObjective:' + owner + '">SAVE TO LIBRARY</button>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------- library */

  function pickerOverlay() {
    if (!S.picker) return '';
    const kind = S.picker.kind;
    const lib = Store.library();
    const key = kind === 'unit' ? 'units' : 'objectives';
    const list = lib[key];
    const title = kind === 'unit' ? 'YOUR UNITS' : 'YOUR SPECIAL OBJECTIVES';

    const rows = list.map(function (x, i) {
      let sub;
      if (kind === 'unit') {
        sub = 'MOV ' + x.move + '" · W ' + x.maxWounds + ' · T ' + x.toughness + ' · OC ' + (x.oc || 0) +
          ' · ' + (x.weapons || []).length + ' weapons · ' + (x.abilities || []).length + ' abilities';
      } else {
        sub = (x.text || '').slice(0, 90);
      }
      return '<div style="display:flex;gap:6px;align-items:stretch;margin-bottom:7px">' +
        '<button class="choice" style="margin:0;flex:1" data-act="pickLib:' + kind + ':' + i + '">' +
          '<div class="cmain"><div class="cname">' + esc(x.name) + '</div>' +
          '<div class="cdesc">' + esc(sub) + '</div></div></button>' +
        '<button class="iconbtn" data-act="delLib:' + kind + ':' + i + '">✕</button>' +
      '</div>';
    }).join('');

    return '<div class="overlay" data-overlay="1"><div class="modal">' +
      '<div class="mhead"><div><div class="mtitle">' + title + '</div>' +
        '<div class="mstep">SAVED IN THIS BROWSER</div></div>' +
        '<button class="mclose" data-act="closePicker">✕</button></div>' +
      '<div class="mbody">' +
        (list.length ? rows
          : '<div class="noteline">Nothing saved yet. Everything you enter is added to this list ' +
            'when you start a game, so the next one is a few taps.</div>') +
        (kind === 'unit'
          ? '<button class="addbtn" data-act="addUnit:' + (S.picker.owner || 0) + '">+ BLANK UNIT INSTEAD</button>' : '') +
      '</div>' +
      '<div class="mfoot"><button class="btn ghost" data-act="closePicker">CLOSE</button></div>' +
    '</div></div>';
  }

  function stashEverything() {
    S.units.forEach(u => Store.libSave('units', u));
    S.objectives.slice(0, S.playerCount).forEach(o => { if (o && o.name) Store.libSave('objectives', o); });
  }

  /* ------------------------------------------------------------- bindings */

  function bind(path, value) {
    const p = path.split(':');
    const kind = p[0];
    if (kind === 'cfg') {
      const key = p[1];
      S[key] = (key === 'vpTarget' || key === 'firstPlayer') ? Number(value) : value;
      return;
    }
    if (kind === 'pname') { S.playerNames[Number(p[1])] = value; return; }
    if (kind === 'unit') {
      const u = findUnit(p[1]); if (!u) return;
      const key = p[2];
      u[key] = ['maxWounds', 'toughness', 'oc', 'move'].indexOf(key) >= 0 ? Number(value) : value;
      if (key === 'maxWounds') u.wounds = u.maxWounds;
      return;
    }
    if (kind === 'weapon') {
      const w = findWeapon(p[1], p[2]); if (!w) return;
      const key = p[3];
      w[key] = ['range', 'hit', 'strength', 'damage'].indexOf(key) >= 0 ? Number(value) : value;
      return;
    }
    if (kind === 'ability') {
      const a = findAbility(p[1], p[2]); if (!a) return;
      const key = p[3];
      a[key] = ['cost', 'usesPerGame'].indexOf(key) >= 0 ? Number(value) : value;
      return;
    }
    if (kind === 'effect') {
      const e = findEffect(p[1], p[2], p[3]); if (!e) return;
      const key = p[4];
      e[key] = ['value', 'range', 'hitMod'].indexOf(key) >= 0 ? Number(value)
             : (['noRP', 'skipWound'].indexOf(key) >= 0 ? value === 'true' : value);
      if (key === 'kind' && e.kind === 'token' && !e.tokenEffects) e.tokenEffects = [];
      return;
    }
    if (kind === 'teffect') {
      const e = findTEffect(p[1], p[2], p[3], p[4]); if (!e) return;
      const key = p[5];
      e[key] = key === 'value' ? Number(value) : value;
      return;
    }
    if (kind === 'obj') {
      const o = S.objectives[Number(p[1])]; if (!o) return;
      const key = p[2];
      o[key] = key === 'vp' ? Number(value) : (key === 'repeat' ? value === 'true' : value);
      return;
    }
    if (kind === 'objeffect') {
      const o = S.objectives[Number(p[1])]; if (!o) return;
      const e = (o.effects || []).find(x => x.id === p[2]); if (!e) return;
      const key = p[3];
      e[key] = ['value', 'range', 'hitMod'].indexOf(key) >= 0 ? Number(value) : value;
      return;
    }
  }

  /* --------------------------------------------------------------- actions */

  function act(cmd) {
    const p = cmd.split(':');
    switch (p[0]) {

      /* ---- wizard ---- */
      case 'next': {
        if (blockedReason(S.step)) return false;
        S.step = Math.min(lastStep(), S.step + 1);
        S.picker = null;
        window.scrollTo(0, 0);
        return true;
      }
      case 'prev':
        S.step = Math.max(0, S.step - 1);
        S.picker = null;
        return true;
      case 'goto': {
        const target = Number(p[1]);
        if (target > S.step && blockedReason(S.step)) return false;
        S.step = Math.max(0, Math.min(lastStep(), target));
        S.picker = null;
        return true;
      }
      case 'count': {
        S.playerCount = Number(p[1]);
        if (S.firstPlayer >= S.playerCount) S.firstPlayer = 0;
        // Units belonging to seats that no longer exist go away with them.
        S.units = S.units.filter(u => u.owner < S.playerCount);
        S.step = Math.min(S.step, lastStep());
        return true;
      }

      case 'open': S.open[p[1]] = !S.open[p[1]]; return true;
      case 'togAura': {
        const e = findEffect(p[1], p[2], p[3]);
        if (e) e.onlyVsOwner = !e.onlyVsOwner;
        return true;
      }
      case 'togAuraObj': {
        const o = S.objectives[Number(p[1])];
        const e = o && (o.effects || []).find(x => x.id === p[2]);
        if (e) e.onlyVsOwner = !e.onlyVsOwner;
        return true;
      }
      case 'togUnlimited': {
        const w = findWeapon(p[1], p[2]);
        if (w) w.unlimited = !w.unlimited;
        return true;
      }

      case 'addUnit': {
        const owner = Number(p[1]);
        const u = Store.newUnit(owner, { name: 'New Unit' });
        u.weapons.push(Store.newWeapon({ name: 'Ranged Weapon', type: 'ranged', range: 12 }));
        u.weapons.push(Store.newWeapon({ name: 'Melee Weapon', type: 'melee', range: 1, strength: 4, damage: 1 }));
        S.units.push(u);
        S.open = {}; S.open[u.id] = true;
        S.picker = null;
        return true;
      }
      case 'dupUnit': {
        const u = findUnit(p[1]);
        if (!u) return false;
        const copy = Store.rekey([u], u.owner)[0];
        copy.name = u.name + ' (2)';
        S.units.push(copy);
        S.open = {}; S.open[copy.id] = true;
        return true;
      }
      case 'delUnit':
        S.units = S.units.filter(x => x.id !== p[1]);
        return true;

      case 'addWeapon':
        findUnit(p[1]).weapons.push(Store.newWeapon({ name: 'New Weapon' }));
        return true;
      case 'delWeapon': {
        const u = findUnit(p[1]);
        u.weapons = u.weapons.filter(w => w.id !== p[2]);
        return true;
      }
      case 'addAbility':
        findUnit(p[1]).abilities.push(Store.newAbility({ name: 'New Ability' }));
        return true;

      /* A pure escape hatch: a named button on the unit card that just shows
         its text. No cost, no rules, press it whenever the table says so. */
      case 'addButton': {
        const u = findUnit(p[1]);
        u.abilities.push(Store.newAbility({
          name: 'New Button', trigger: 'free', cost: 0,
          text: 'Describe what happens; press this when it does.',
          effects: [Store.newEffectRow({ kind: 'note', text: '' })]
        }));
        return true;
      }
      case 'delAbility': {
        const u = findUnit(p[1]);
        u.abilities = u.abilities.filter(a => a.id !== p[2]);
        return true;
      }
      case 'addEffect':
        findAbility(p[1], p[2]).effects.push(Store.newEffectRow());
        return true;
      case 'addTokenEffect':
        findAbility(p[1], p[2]).effects.push(Store.newEffectRow({
          kind: 'token', label: 'NEW BUTTON', expiry: 'used', tokenEffects: []
        }));
        return true;
      case 'delEffect': {
        const a = findAbility(p[1], p[2]);
        a.effects = a.effects.filter(e => e.id !== p[3]);
        return true;
      }
      case 'addTEffect': {
        const e = findEffect(p[1], p[2], p[3]);
        if (!e.tokenEffects) e.tokenEffects = [];
        e.tokenEffects.push(Store.newEffectRow({ kind: 'damage', pick: 'prompt', value: 1 }));
        return true;
      }
      case 'delTEffect': {
        const e = findEffect(p[1], p[2], p[3]);
        e.tokenEffects = (e.tokenEffects || []).filter(t => t.id !== p[4]);
        return true;
      }

      /* ---- mission & objectives ---- */
      case 'mission':
        S.missionId = (p[1] === 'none') ? null : p[1];
        S.roles = { attacker: null, defender: null };
        S.flagged = [null, null, null, null];
        return true;
      case 'role': {
        const other = p[1] === 'attacker' ? 'defender' : 'attacker';
        const who = Number(p[2]);
        if (S.roles[other] === who) S.roles[other] = null;
        S.roles[p[1]] = who;
        return true;
      }
      case 'flagunit':
        S.flagged[Number(p[1])] = p[2];
        return true;
      case 'addObjEffect':
        S.objectives[Number(p[1])].effects.push(Store.newEffectRow({ kind: 'ap_self', value: 1 }));
        return true;
      case 'delObjEffect': {
        const o = S.objectives[Number(p[1])];
        o.effects = o.effects.filter(e => e.id !== p[2]);
        return true;
      }
      case 'clearObjective':
        S.objectives[Number(p[1])] = Store.newSpecialObjective();
        return true;

      /* ---- library ---- */
      case 'openPicker':
        S.picker = { kind: p[1], owner: p[2] === undefined ? S.step - 2 : Number(p[2]) };
        return true;
      case 'closePicker': S.picker = null; return true;
      case 'pickLib': {
        const kind = p[1];
        const key = kind === 'unit' ? 'units' : 'objectives';
        const entry = Store.library()[key][Number(p[2])];
        if (!entry) return false;
        const owner = S.picker ? S.picker.owner : 0;
        if (kind === 'unit') {
          S.units.push(Store.rekey([entry], owner)[0]);
          S.open = {};
        } else {
          S.objectives[owner] = Store.rekeyOne(entry);
        }
        S.picker = null;
        return true;
      }
      case 'delLib': {
        const kind = p[1];
        const key = kind === 'unit' ? 'units' : 'objectives';
        const entry = Store.library()[key][Number(p[2])];
        if (entry) Store.libDelete(key, entry.name);
        return true;
      }
      case 'libSaveUnit': {
        const u = findUnit(p[1]);
        if (u) Store.libSave('units', u);
        return true;
      }
      case 'libSaveObjective': {
        const o = S.objectives[Number(p[1])];
        if (o && o.name) Store.libSave('objectives', o);
        else alert('Give the objective a name first.');
        return true;
      }

      /* ---- rosters ---- */
      case 'preset': {
        const owner = Number(p[1]);
        const faction = PRESETS.find(f => f.id === p[2]);
        if (!faction) return false;
        const built = faction.units.map(function (spec) {
          const u = Store.newUnit(owner, {
            name: spec.name, move: spec.move, maxWounds: spec.maxWounds,
            wounds: spec.maxWounds, toughness: spec.toughness, oc: spec.oc || 0,
            notes: spec.notes || ''
          });
          u.weapons = spec.weapons.map(w => Store.newWeapon(w));
          u.abilities = (spec.abilities || []).map(function (a) {
            const ab = Store.newAbility({
              name: a.name, trigger: a.trigger, cost: a.cost, text: a.text,
              usesPerGame: a.usesPerGame || 0,
              endsChain: a.endsChain || 'default'
            });
            ab.effects = (a.effects || []).map(function (e) {
              const row = Store.newEffectRow(e);
              if (e.tokenEffects) row.tokenEffects = e.tokenEffects.map(t => Store.newEffectRow(t));
              return row;
            });
            return ab;
          });
          return u;
        });
        S.units = S.units.filter(x => x.owner !== owner).concat(built);
        if (faction.objective) {
          S.objectives[owner] = Store.newSpecialObjective(
            Object.assign({}, faction.objective, {
              effects: (faction.objective.effects || []).map(e => Store.newEffectRow(e))
            }));
        }
        S.open = {};
        return true;
      }
      case 'saveRoster': {
        const owner = Number(p[1]);
        const name = prompt('Save this roster as:', S.playerNames[owner]);
        if (!name) return false;
        Store.saveRoster(name, unitsOf(owner));
        return true;
      }
      case 'loadRoster': {
        const owner = Number(p[1]);
        const r = Store.rosters()[Number(p[2])];
        if (!r) return false;
        S.units = S.units.filter(x => x.owner !== owner).concat(Store.rekey(r.units, owner));
        S.open = {};
        return true;
      }
      case 'delRoster': {
        const r = Store.rosters()[Number(p[1])];
        if (r) Store.deleteRoster(r.name);
        return true;
      }

      /* ---- data ---- */
      case 'export': {
        const data = JSON.stringify({
          config: { playerNames: S.playerNames.slice(0, S.playerCount), vpTarget: S.vpTarget,
                    missionId: S.missionId },
          objectives: S.objectives, units: S.units
        }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'skirmish-setup.json';
        a.click();
        return false;
      }
      case 'import': {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'application/json';
        inp.onchange = function () {
          const file = inp.files[0];
          if (!file) return;
          const rd = new FileReader();
          rd.onload = function () {
            try {
              const data = JSON.parse(rd.result);
              if (data.config && data.config.playerNames) {
                data.config.playerNames.forEach((nm, i) => { if (i < MAX_PLAYERS) S.playerNames[i] = nm; });
                S.playerCount = Math.max(2, Math.min(MAX_PLAYERS, data.config.playerNames.length));
                S.vpTarget = data.config.vpTarget || S.vpTarget;
              }
              if (data.config && data.config.missionId !== undefined) S.missionId = data.config.missionId;
              if (data.objectives) data.objectives.forEach((o, i) => { if (i < MAX_PLAYERS) S.objectives[i] = o; });
              if (data.units) {
                S.units = [];
                for (let i = 0; i < S.playerCount; i++) {
                  S.units = S.units.concat(Store.rekey(data.units.filter(u => u.owner === i), i));
                }
              }
              UI.render();
            } catch (e) { alert('That file could not be read as a setup export.'); }
          };
          rd.readAsText(file);
        };
        inp.click();
        return false;
      }

      case 'start': {
        for (let i = 0; i < S.playerCount; i++) if (!unitsOf(i).length) { S.step = armyStep(i); return true; }
        stashEverything();
        const units = JSON.parse(JSON.stringify(S.units));
        units.forEach(u => { u.wounds = u.maxWounds; u.alive = true; u.effects = []; u.tokens = []; });
        const objectives = S.objectives.slice(0, S.playerCount).map(function (o) {
          if (!o.name) return null;
          const copy = JSON.parse(JSON.stringify(o));
          copy.completed = 0;
          return copy;
        });
        // The chosen TARGET carries its flag into the game.
        const m = card();
        if (m && m.unitFlag && m.unitFlag.pickAtSetup) {
          units.forEach(function (u) {
            const owner = u.owner;
            if (S.flagged[owner] === u.id) {
              u.flags = u.flags || {};
              u.flags[m.unitFlag.id] = true;
            }
          });
        }
        Engine.startGame({
          playerNames: S.playerNames.slice(0, S.playerCount),
          vpTarget: Number(S.vpTarget) || 10,
          firstPlayer: Number(S.firstPlayer) || 0,
          mission: m ? { id: m.id, roles: m.roles ? { attacker: S.roles.attacker,
                                                      defender: S.roles.defender } : null }
                     : { id: null },
          objectives: objectives
        }, units);
        return false;
      }
    }
    return false;
  }

  return { init, render, bind, act, state: () => S };
})();

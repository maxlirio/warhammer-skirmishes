/* =========================================================================
   SETUP — pre-game roster and ability builder.
   ========================================================================= */

const Setup = (function () {

  let S = null;   // setup-screen working state

  function init(existing) {
    S = existing || {
      p1: 'Player 1', p2: 'Player 2',
      vpTarget: RULES.defaultVPTarget,
      firstPlayer: 0,
      tab: 0,
      units: [],
      open: {}
    };
    // Fields added after a save may be missing from a restored setup state.
    if (!S.mission) S.mission = { name: '', text: '', objectives: [] };
    if (!S.objectives) S.objectives = [Store.newSpecialObjective(), Store.newSpecialObjective()];
    if (!S.showMission) S.showMission = false;
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

  /* ------------------------------------------------------------- rendering */

  function render() {
    const p0 = unitsOf(0), p1 = unitsOf(1);
    const ready = p0.length > 0 && p1.length > 0;
    const rosterList = Store.rosters();

    return '' +
      '<div class="screen scroll">' +
        '<div class="setup">' +

          '<div class="title">' +
            '<h1>WARHAMMER <span style="color:var(--gold)">SKIRMISHES</span></h1>' +
            '<div class="sub">The app is the game\'s memory, not its eyes.<br>' +
            'You judge the tabletop. It tracks AP, VP, wounds, chains and effects.</div>' +
          '</div>' +

          '<h2>PLAYERS</h2>' +
          '<div class="grid2">' +
            field('Player 1 name', '<input type="text" data-bind="cfg:p1" data-rerender="1" value="' + esc(S.p1) + '">') +
            field('Player 2 name', '<input type="text" data-bind="cfg:p2" data-rerender="1" value="' + esc(S.p2) + '">') +
          '</div>' +
          '<div class="grid2">' +
            field('Victory Points to win', '<input type="number" min="1" data-bind="cfg:vpTarget" value="' + esc(S.vpTarget) + '">') +
            field('Who takes the first turn',
              '<select data-bind="cfg:firstPlayer" data-rerender="1">' +
                '<option value="0"' + (S.firstPlayer === 0 ? ' selected' : '') + '>' + esc(S.p1) + '</option>' +
                '<option value="1"' + (S.firstPlayer === 1 ? ' selected' : '') + '>' + esc(S.p2) + '</option>' +
              '</select>') +
          '</div>' +

          missionSection() +

          '<h2>ROSTERS</h2>' +
          '<div class="tabs">' +
            '<button class="tab p0' + (S.tab === 0 ? ' on' : '') + '" data-act="tab:0">' +
              esc(S.p1).toUpperCase() + ' · ' + p0.length + '</button>' +
            '<button class="tab p1' + (S.tab === 1 ? ' on' : '') + '" data-act="tab:1">' +
              esc(S.p2).toUpperCase() + ' · ' + p1.length + '</button>' +
          '</div>' +

          specialObjectiveCard(S.tab) +

          (S.tab === 0 ? p0 : p1).map(unitCard).join('') +

          '<button class="addbtn" data-act="addUnit:' + S.tab + '">+ ADD UNIT</button>' +

          '<div class="grid2" style="margin-top:10px">' +
            '<button class="btn sm" style="flex:1" data-act="saveRoster:' + S.tab + '">SAVE THIS ROSTER</button>' +
            '<button class="btn sm" style="flex:1" data-act="sample:' + S.tab + '">LOAD EXAMPLE</button>' +
          '</div>' +

          (rosterList.length
            ? '<div class="sub" style="margin-top:9px">' +
                '<div class="shd">SAVED ROSTERS — tap to load into this slot</div>' +
                rosterList.map(r =>
                  '<div style="display:flex;gap:6px;margin-bottom:5px;align-items:center">' +
                    '<button class="btn sm" style="flex:1;text-align:left;justify-content:flex-start" ' +
                      'data-act="loadRoster:' + S.tab + ':' + esc(r.name) + '">' + esc(r.name) +
                      ' <span style="color:var(--ink-mute);font-weight:600"> · ' + r.units.length + ' units</span></button>' +
                    '<button class="iconbtn" data-act="delRoster:' + esc(r.name) + '">✕</button>' +
                  '</div>').join('') +
              '</div>'
            : '') +

          '<h2>DATA</h2>' +
          '<div class="grid2">' +
            '<button class="btn sm" style="flex:1" data-act="export">EXPORT JSON</button>' +
            '<button class="btn sm" style="flex:1" data-act="import">IMPORT JSON</button>' +
          '</div>' +

          '<div style="height:14px"></div>' +
          '<button class="bigbtn' + (ready ? '' : ' dim') + '" style="width:100%" data-act="start">' +
            (ready ? 'BEGIN THE SKIRMISH' : 'BOTH PLAYERS NEED AT LEAST ONE UNIT') +
          '</button>' +
          '<div style="height:26px"></div>' +
        '</div>' +
      '</div>';
  }

  function field(label, inner) {
    return '<div class="field"><label>' + label + '</label>' + inner + '</div>';
  }

  /* ------------------------------------------------------- mission card */

  function missionSection() {
    const m = S.mission;
    const open = S.showMission || m.name || (m.objectives || []).length;
    if (!open) {
      return '<h2>MISSION CARD <span style="color:var(--ink-mute);font-weight:600;letter-spacing:0">' +
        '· optional</span></h2>' +
        '<div class="hint">Mission Cards set the environment and the objectives you fight over. ' +
        'Leave this out until you are comfortable with the system — the app works fine without it.</div>' +
        '<button class="addbtn" data-act="showMission">+ ADD A MISSION CARD</button>';
    }
    return '<h2>MISSION CARD</h2>' +
      '<div class="hint">Objectives are checked in the End Phase, after END: abilities are resolved. ' +
      'The app will ask who scored each one.</div>' +
      '<div class="card">' +
        field('Mission name', '<input type="text" data-bind="mission:name" data-rerender="1" value="' +
          esc(m.name) + '" placeholder="Ruins of Vharn Secundus">') +
        field('Environment / special rules (reminder text)',
          '<textarea data-bind="mission:text" placeholder="Toxic fog: any unit that ends a turn in the open…">' +
            esc(m.text) + '</textarea>') +
        '<div class="sub">' +
          '<div class="shd">OBJECTIVES</div>' +
          (m.objectives || []).map(function (o) {
            return '<div class="sub" style="background:#0f161d">' +
              '<div class="chd">' +
                '<input type="text" data-bind="missionobj:' + o.id + ':name" data-rerender="1" value="' +
                  esc(o.name) + '" style="flex:1;background:#0f161d;border:1px solid var(--line);' +
                  'border-radius:6px;padding:7px;min-height:36px">' +
                '<button class="iconbtn" data-act="delMissionObj:' + o.id + '">✕</button>' +
              '</div>' +
              field('How it is scored (reminder text)',
                '<input type="text" data-bind="missionobj:' + o.id + ':text" value="' + esc(o.text) +
                '" placeholder="Control the central ruin at the end of your turn">') +
              '<div class="grid2">' +
                field('VP AWARDED', '<input type="number" min="0" data-bind="missionobj:' + o.id +
                  ':vp" value="' + esc(o.vp) + '">') +
                field('HOW OFTEN',
                  '<select data-bind="missionobj:' + o.id + ':repeat">' +
                    '<option value="true"' + (o.repeat ? ' selected' : '') + '>Every End Phase</option>' +
                    '<option value="false"' + (!o.repeat ? ' selected' : '') + '>Once per player, per game</option>' +
                  '</select>') +
              '</div>' +
            '</div>';
          }).join('') +
          '<button class="addbtn" data-act="addMissionObj">+ ADD OBJECTIVE</button>' +
        '</div>' +
      '</div>';
  }

  /* -------------------------------------------------- special objective */

  function specialObjectiveCard(owner) {
    const o = S.objectives[owner];
    const who = owner === 0 ? S.p1 : S.p2;
    return '<div class="card" style="border-color:var(--gold-dim)">' +
      '<div class="chd">' +
        '<div class="t" style="color:var(--gold)">SPECIAL OBJECTIVE — ' + esc(who) + '</div>' +
        (o.name ? '<button class="iconbtn" data-act="clearObjective:' + owner + '">✕</button>' : '') +
      '</div>' +
      '<div class="hint">Each faction\'s own card: a feat that rewards them for completing it. ' +
        'Checked in the End Phase, after END: abilities. Leave the name blank to skip it.</div>' +
      field('Objective name', '<input type="text" data-bind="obj:' + owner + ':name" data-rerender="1" value="' +
        esc(o.name) + '" placeholder="Blood for the Blood God">') +
      field('Requirement (reminder text)',
        '<textarea data-bind="obj:' + owner + ':text" placeholder="Destroy an enemy unit in melee in each of two consecutive turns.">' +
          esc(o.text) + '</textarea>') +
      field('HOW OFTEN',
        '<select data-bind="obj:' + owner + ':repeat">' +
          '<option value="false"' + (!o.repeat ? ' selected' : '') + '>Once per game</option>' +
          '<option value="true"' + (o.repeat ? ' selected' : '') + '>Every time it is completed</option>' +
        '</select>') +
      '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:8px 0 5px">' +
        'REWARD — what the app grants when it is claimed</div>' +
      (o.effects || []).map(e => effectRow(e, 'objeffect:' + owner + ':' + e.id,
        'delObjEffect:' + owner + ':' + e.id, { allow: RULES.objectiveEffectKinds })).join('') +
      '<button class="addbtn" data-act="addObjEffect:' + owner + '">+ ADD REWARD</button>' +
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
        '<button class="iconbtn" data-act="dupUnit:' + u.id + '">DUPLICATE</button>' +
        '<button class="iconbtn" data-act="open:' + u.id + '">CLOSE</button>' +
        '<button class="iconbtn" data-act="delUnit:' + u.id + '">✕</button>' +
      '</div>' +

      field('Unit name', '<input type="text" data-bind="unit:' + u.id + ':name" data-rerender="1" value="' + esc(u.name) + '">') +

      '<div class="grid4">' +
        field('WOUNDS', '<input type="number" min="1" data-bind="unit:' + u.id + ':maxWounds" value="' + esc(u.maxWounds) + '">') +
        field('TOUGH', '<input type="number" min="1" data-bind="unit:' + u.id + ':toughness" value="' + esc(u.toughness) + '">') +
        field('SAVE', '<input type="number" min="1" max="7" data-bind="unit:' + u.id + ':save" value="' + esc(u.save) + '">') +
        field('MOVE&quot;', '<input type="number" min="0" data-bind="unit:' + u.id + ':move" value="' + esc(u.move) + '">') +
      '</div>' +
      '<div class="hint">Wounds, Toughness and Move come off the datasheet. Toughness feeds the ' +
        'wound-table reminder the app shows during attacks.</div>' +

      '<div class="sub">' +
        '<div class="shd">WEAPONS</div>' +
        (u.weapons || []).map(w => weaponRow(u, w)).join('') +
        '<button class="addbtn" data-act="addWeapon:' + u.id + '">+ ADD WEAPON</button>' +
      '</div>' +

      '<div class="sub">' +
        '<div class="shd">SPECIAL ABILITIES</div>' +
        (u.abilities || []).map(a => abilityCard(u, a)).join('') +
        '<button class="addbtn" data-act="addAbility:' + u.id + '">+ ADD ABILITY</button>' +
      '</div>' +

      field('Notes (shown on the unit card)',
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
      '<div class="grid4">' +
        field('TYPE',
          '<select data-bind="weapon:' + u.id + ':' + w.id + ':type">' +
            '<option value="ranged"' + (w.type === 'ranged' ? ' selected' : '') + '>Ranged</option>' +
            '<option value="melee"' + (w.type === 'melee' ? ' selected' : '') + '>Melee</option>' +
          '</select>') +
        field('HIT +', '<input type="number" min="2" max="6" data-bind="weapon:' + u.id + ':' + w.id + ':hit" value="' + esc(w.hit) + '">') +
        field('STR', '<input type="number" min="1" data-bind="weapon:' + u.id + ':' + w.id + ':strength" value="' + esc(w.strength) + '">') +
        field('DMG', '<input type="number" min="0" data-bind="weapon:' + u.id + ':' + w.id + ':damage" value="' + esc(w.damage) + '">') +
      '</div>' +
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

      field('WHAT IT DOES (shown to you when it fires)',
        '<textarea data-bind="ability:' + u.id + ':' + a.id + ':text">' + esc(a.text) + '</textarea>') +

      '<div style="font-size:10px;letter-spacing:.14em;color:var(--ink-mute);font-weight:800;margin:8px 0 5px">' +
        'MECHANICAL EFFECTS — what the app should change' +
      '</div>' +
      (a.effects || []).map(e => abilityEffectRow(u, a, e)).join('') +
      '<button class="addbtn" data-act="addEffect:' + u.id + ':' + a.id + '">+ ADD EFFECT</button>' +

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

  /* ---------------------------------------------------------- effect row */

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

  /* opts: { nested, allow (list of kind ids), tokenChildren:{addAct, rows} } */
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
    if (kind.token && !parentEffectId && opts.tokenChildren) {
      inner += field('BUTTON LABEL',
        '<input type="text" data-bind="' + base + ':label" data-rerender="1" value="' + esc(e.label) + '" placeholder="PROXIMITY MINE">');
      inner += field('THE BUTTON DISAPPEARS',
        '<select data-bind="' + base + ':expiry">' +
          RULES.tokenExpiries.map(x =>
            '<option value="' + x.id + '"' + (e.expiry === x.id ? ' selected' : '') + '>' + x.label + '</option>').join('') +
        '</select>');
      inner += field('REMINDER TEXT WHEN TRIGGERED',
        '<input type="text" data-bind="' + base + ':text" value="' + esc(e.text) + '">');
      inner += '<div style="font-size:10px;letter-spacing:.12em;color:var(--ink-mute);font-weight:800;margin:6px 0 4px">' +
        'WHAT HAPPENS WHEN THE BUTTON IS PRESSED</div>' +
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

  /* ------------------------------------------------------------- bindings */

  function bind(path, value) {
    const p = path.split(':');
    const kind = p[0];
    if (kind === 'cfg') {
      const key = p[1];
      S[key] = (key === 'vpTarget' || key === 'firstPlayer') ? Number(value) : value;
      return;
    }
    if (kind === 'unit') {
      const u = findUnit(p[1]); if (!u) return;
      const key = p[2];
      u[key] = ['maxWounds', 'toughness', 'save', 'move', 'hit'].indexOf(key) >= 0 ? Number(value) : value;
      if (key === 'maxWounds') u.wounds = u.maxWounds;
      return;
    }
    if (kind === 'weapon') {
      const w = findWeapon(p[1], p[2]); if (!w) return;
      const key = p[3];
      w[key] = ['hit', 'strength', 'damage'].indexOf(key) >= 0 ? Number(value) : value;
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
      e[key] = key === 'value' ? Number(value) : value;
      if (key === 'kind' && e.kind === 'token' && !e.tokenEffects) e.tokenEffects = [];
      return;
    }
    if (kind === 'teffect') {
      const e = findTEffect(p[1], p[2], p[3], p[4]); if (!e) return;
      const key = p[5];
      e[key] = key === 'value' ? Number(value) : value;
      return;
    }
    if (kind === 'mission') {
      S.mission[p[1]] = value;
      return;
    }
    if (kind === 'missionobj') {
      const o = (S.mission.objectives || []).find(x => x.id === p[1]); if (!o) return;
      const key = p[2];
      o[key] = key === 'vp' ? Number(value) : (key === 'repeat' ? value === 'true' : value);
      return;
    }
    if (kind === 'obj') {
      const o = S.objectives[Number(p[1])]; if (!o) return;
      const key = p[2];
      o[key] = key === 'repeat' ? value === 'true' : value;
      return;
    }
    if (kind === 'objeffect') {
      const o = S.objectives[Number(p[1])]; if (!o) return;
      const e = (o.effects || []).find(x => x.id === p[2]); if (!e) return;
      const key = p[3];
      e[key] = key === 'value' ? Number(value) : value;
      return;
    }
  }

  /* --------------------------------------------------------------- actions */

  function act(cmd) {
    const p = cmd.split(':');
    switch (p[0]) {
      case 'tab': S.tab = Number(p[1]); return true;
      case 'open': S.open[p[1]] = !S.open[p[1]]; return true;

      case 'addUnit': {
        const u = Store.newUnit(Number(p[1]), { name: 'New Unit' });
        u.weapons.push(Store.newWeapon({ name: 'Ranged Weapon', type: 'ranged' }));
        u.weapons.push(Store.newWeapon({ name: 'Melee Weapon', type: 'melee', strength: 4, damage: 1 }));
        S.units.push(u);
        S.open = {}; S.open[u.id] = true;
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

      case 'addWeapon': {
        const u = findUnit(p[1]);
        u.weapons.push(Store.newWeapon({ name: 'New Weapon' }));
        return true;
      }
      case 'delWeapon': {
        const u = findUnit(p[1]);
        u.weapons = u.weapons.filter(w => w.id !== p[2]);
        return true;
      }
      case 'addAbility': {
        const u = findUnit(p[1]);
        u.abilities.push(Store.newAbility({ name: 'New Ability' }));
        return true;
      }
      case 'delAbility': {
        const u = findUnit(p[1]);
        u.abilities = u.abilities.filter(a => a.id !== p[2]);
        return true;
      }
      case 'addEffect': {
        const a = findAbility(p[1], p[2]);
        a.effects.push(Store.newEffectRow());
        return true;
      }
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

      case 'showMission': S.showMission = true; return true;
      case 'addMissionObj':
        S.mission.objectives.push(Store.newMissionObjective());
        return true;
      case 'delMissionObj':
        S.mission.objectives = S.mission.objectives.filter(o => o.id !== p[1]);
        return true;
      case 'addObjEffect':
        S.objectives[Number(p[1])].effects.push(Store.newEffectRow({ kind: 'vp_self', value: 1 }));
        return true;
      case 'delObjEffect': {
        const o = S.objectives[Number(p[1])];
        o.effects = o.effects.filter(e => e.id !== p[2]);
        return true;
      }
      case 'clearObjective':
        S.objectives[Number(p[1])] = Store.newSpecialObjective();
        return true;

      case 'sample': {
        const owner = Number(p[1]);
        const src = owner === 0 ? SAMPLES.imperial : SAMPLES.ork;
        const built = src.map(function (spec) {
          const u = Store.newUnit(owner, {
            name: spec.name, maxWounds: spec.maxWounds, wounds: spec.maxWounds,
            toughness: spec.toughness, save: spec.save, move: spec.move, hit: spec.hit
          });
          u.weapons = spec.weapons.map(w => Store.newWeapon(w));
          u.abilities = spec.abilities.map(function (a) {
            const ab = Store.newAbility({ name: a.name, trigger: a.trigger, cost: a.cost, text: a.text });
            ab.effects = (a.effects || []).map(e => Store.newEffectRow(e));
            return ab;
          });
          return u;
        });
        S.units = S.units.filter(x => x.owner !== owner).concat(built);
        S.open = {};
        return true;
      }

      case 'saveRoster': {
        const owner = Number(p[1]);
        const name = prompt('Save this roster as:', owner === 0 ? S.p1 : S.p2);
        if (!name) return false;
        Store.saveRoster(name, unitsOf(owner));
        return true;
      }
      case 'loadRoster': {
        const owner = Number(p[1]);
        const name = cmd.slice(cmd.indexOf(':', cmd.indexOf(':') + 1) + 1);
        const r = Store.rosters().find(x => x.name === name);
        if (!r) return false;
        S.units = S.units.filter(x => x.owner !== owner).concat(Store.rekey(r.units, owner));
        S.open = {};
        return true;
      }
      case 'delRoster':
        Store.deleteRoster(cmd.slice(cmd.indexOf(':') + 1));
        return true;

      case 'export': {
        const data = JSON.stringify({ config: { p1: S.p1, p2: S.p2, vpTarget: S.vpTarget }, units: S.units }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'skirmish-rosters.json';
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
              if (data.config) { S.p1 = data.config.p1 || S.p1; S.p2 = data.config.p2 || S.p2;
                                 S.vpTarget = data.config.vpTarget || S.vpTarget; }
              if (data.units) {
                S.units = Store.rekey(data.units.filter(u => u.owner === 0), 0)
                  .concat(Store.rekey(data.units.filter(u => u.owner !== 0), 1));
              }
              UI.render();
            } catch (e) { alert('That file could not be read as a roster export.'); }
          };
          rd.readAsText(file);
        };
        inp.click();
        return false;
      }

      case 'start': {
        if (!unitsOf(0).length || !unitsOf(1).length) return false;
        const units = JSON.parse(JSON.stringify(S.units));
        units.forEach(u => { u.wounds = u.maxWounds; u.alive = true; u.effects = []; u.tokens = []; });
        const objectives = S.objectives.map(function (o) {
          if (!o.name) return null;
          const copy = JSON.parse(JSON.stringify(o));
          copy.completed = 0;
          return copy;
        });
        Engine.startGame({
          p1: S.p1, p2: S.p2, vpTarget: Number(S.vpTarget) || 10,
          firstPlayer: Number(S.firstPlayer) || 0,
          mission: JSON.parse(JSON.stringify(S.mission)),
          objectives: objectives
        }, units);
        return false;
      }
    }
    return false;
  }

  return { init, render, bind, act, state: () => S };
})();

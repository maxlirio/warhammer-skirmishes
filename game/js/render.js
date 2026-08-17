/* =========================================================================
   DRAWING THE TABLE
   Top down, one inch to a cell. Terrain first, then the overlay for whatever
   you are in the middle of doing, then the models on top.

   Models are placeholders: a based token with initials and wound pips. When
   the scanner arrives, give a unit an `art` image and it is drawn in the base
   instead — nothing else here needs to change.
   ========================================================================= */

const Render = (function () {

  let cv = null, cx = null, cell = 22;
  const art = {};                       // unit id -> Image, once scans exist

  const COL = {
    ground:   '#23201a',
    groundAlt:'#2a251e',
    raised:   '#4a3c2b',
    raisedTop:'#6b5740',
    solid:    '#0c0b0a',
    solidTop: '#3d362c',
    solidEdge:'#584c3c',
    grid:     'rgba(120,100,70,.07)',
    objective:'#b8912f',
    p0:       '#5687b4',
    p1:       '#a8352a',
    move:     'rgba(86,135,180,.28)',
    moveEdge: 'rgba(140,190,235,.55)',
    sight:    'rgba(184,145,47,.16)',
    sightEdge:'rgba(216,180,80,.5)',
    watch:    'rgba(168,53,42,.20)',
    watchEdge:'rgba(200,90,70,.65)',
    threat:   'rgba(168,53,42,.75)',
    bone:     '#d9cfbc'
  };

  function attach(canvas) {
    cv = canvas;
    cx = cv.getContext('2d');
  }

  function fit(board, maxW, maxH) {
    cell = Math.max(10, Math.floor(Math.min(maxW / board.w, maxH / board.h)));
    const dpr = window.devicePixelRatio || 1;
    cv.width = board.w * cell * dpr;
    cv.height = board.h * cell * dpr;
    cv.style.width = (board.w * cell) + 'px';
    cv.style.height = (board.h * cell) + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return cell;
  }

  const px = v => v * cell;
  const mid = v => v * cell + cell / 2;
  const cellAt = (mx, my) => ({ x: Math.floor(mx / cell), y: Math.floor(my / cell) });

  function draw(S, view) {
    const b = S.board;
    view = view || {};
    cx.clearRect(0, 0, cv.width, cv.height);

    drawTerrain(b);
    drawObjectives(S, b);
    if (view.cells) drawRegion(view.cells, view.fill, view.edge);
    if (view.ring) drawRing(view.ring, view.ringColour);
    drawOverwatch(S);
    if (view.threatFrom && view.threatTo) drawThreat(view.threatFrom, view.threatTo);
    S.units.forEach(u => { if (!u.alive) drawWreck(u); });
    S.units.forEach(u => { if (u.alive) drawUnit(S, u, view); });
  }

  function drawTerrain(b) {
    const at = (x, y) => (x < 0 || y < 0 || x >= b.w || y >= b.h) ? -1 : b.height[y * b.w + x];

    /* The floor, everywhere, so the walls have something to stand on. */
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        cx.fillStyle = ((x + y) & 1) === 0 ? COL.ground : COL.groundAlt;
        cx.fillRect(px(x), px(y), cell, cell);
      }
    }

    cx.strokeStyle = COL.grid;
    cx.lineWidth = 1;
    cx.beginPath();
    for (let x = 0; x <= b.w; x++) { cx.moveTo(px(x) + .5, 0); cx.lineTo(px(x) + .5, px(b.h)); }
    for (let y = 0; y <= b.h; y++) { cx.moveTo(0, px(y) + .5); cx.lineTo(px(b.w), px(y) + .5); }
    cx.stroke();

    /* Deployment zones, tinted into the floor. */
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const d = b.deploy[y * b.w + x];
        if (d < 0) continue;
        cx.save();
        cx.globalAlpha = .13;
        cx.fillStyle = d === 0 ? COL.p0 : COL.p1;
        cx.fillRect(px(x), px(y), cell, cell);
        cx.restore();
      }
    }

    /* Raised ground: a lighter slab with a lip along its outside edge. */
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        if (at(x, y) !== Board.RAISED) continue;
        cx.fillStyle = COL.raised;
        cx.fillRect(px(x), px(y), cell, cell);
        if (at(x, y - 1) !== Board.RAISED) {
          cx.fillStyle = COL.raisedTop;
          cx.fillRect(px(x), px(y), cell, Math.max(2, cell * .16));
        }
      }
    }
    edge(b, at, Board.RAISED, 'rgba(140,116,80,.85)', 1.5);

    /* Solid cover: a black block with a lit top face and a hard outline. */
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        if (at(x, y) !== Board.SOLID) continue;
        cx.fillStyle = COL.solid;
        cx.fillRect(px(x), px(y), cell, cell);
        if (at(x, y - 1) !== Board.SOLID) {
          cx.fillStyle = COL.solidTop;
          cx.fillRect(px(x), px(y), cell, Math.max(3, cell * .30));
        }
      }
    }
    edge(b, at, Board.SOLID, COL.solidEdge, 2);
  }

  /* Trace only the outside border of every cell of one height. */
  function edge(b, at, h, colour, width) {
    cx.save();
    cx.strokeStyle = colour;
    cx.lineWidth = width;
    cx.beginPath();
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        if (at(x, y) !== h) continue;
        if (at(x, y - 1) !== h) { cx.moveTo(px(x), px(y)); cx.lineTo(px(x + 1), px(y)); }
        if (at(x, y + 1) !== h) { cx.moveTo(px(x), px(y + 1)); cx.lineTo(px(x + 1), px(y + 1)); }
        if (at(x - 1, y) !== h) { cx.moveTo(px(x), px(y)); cx.lineTo(px(x), px(y + 1)); }
        if (at(x + 1, y) !== h) { cx.moveTo(px(x + 1), px(y)); cx.lineTo(px(x + 1), px(y + 1)); }
      }
    }
    cx.stroke();
    cx.restore();
  }

  function drawObjectives(S, b) {
    b.objectives.forEach(function (o) {
      const cxp = mid(o.x), cyp = mid(o.y);
      const r = cell * .42;
      cx.save();
      cx.translate(cxp, cyp);
      cx.strokeStyle = COL.objective;
      cx.lineWidth = 2;
      cx.globalAlpha = .9;
      cx.beginPath(); cx.arc(0, 0, r, 0, Math.PI * 2); cx.stroke();
      cx.globalAlpha = .35;
      cx.beginPath(); cx.arc(0, 0, r * .45, 0, Math.PI * 2); cx.fillStyle = COL.objective; cx.fill();
      cx.restore();
    });
  }

  /* A region of cells, filled and then outlined along its border only. */
  function drawRegion(cells, fill, edge) {
    const set = {};
    cells.forEach(c => { set[c.x + ',' + c.y] = true; });
    cx.fillStyle = fill || COL.move;
    cells.forEach(c => cx.fillRect(px(c.x), px(c.y), cell, cell));
    cx.strokeStyle = edge || COL.moveEdge;
    cx.lineWidth = 2;
    cx.beginPath();
    cells.forEach(function (c) {
      if (!set[c.x + ',' + (c.y - 1)]) { cx.moveTo(px(c.x), px(c.y)); cx.lineTo(px(c.x + 1), px(c.y)); }
      if (!set[c.x + ',' + (c.y + 1)]) { cx.moveTo(px(c.x), px(c.y + 1)); cx.lineTo(px(c.x + 1), px(c.y + 1)); }
      if (!set[(c.x - 1) + ',' + c.y]) { cx.moveTo(px(c.x), px(c.y)); cx.lineTo(px(c.x), px(c.y + 1)); }
      if (!set[(c.x + 1) + ',' + c.y]) { cx.moveTo(px(c.x + 1), px(c.y)); cx.lineTo(px(c.x + 1), px(c.y + 1)); }
    });
    cx.stroke();
  }

  function drawRing(ring, colour) {
    cx.save();
    cx.strokeStyle = colour || COL.watchEdge;
    cx.setLineDash([5, 4]);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.arc(mid(ring.x), mid(ring.y), ring.r * cell, 0, Math.PI * 2);
    cx.stroke();
    cx.restore();
  }

  function drawOverwatch(S) {
    S.units.forEach(function (u) {
      if (!u.alive || !u.overwatch) return;
      const o = u.overwatch;
      const col = u.owner === 0 ? COL.p0 : COL.p1;
      cx.save();
      cx.globalAlpha = .16;
      cx.fillStyle = col;
      cx.beginPath(); cx.arc(mid(o.x), mid(o.y), 3 * cell, 0, Math.PI * 2); cx.fill();
      cx.globalAlpha = .85;
      cx.strokeStyle = col;
      cx.setLineDash([4, 3]);
      cx.lineWidth = 1.5;
      cx.beginPath(); cx.arc(mid(o.x), mid(o.y), 3 * cell, 0, Math.PI * 2); cx.stroke();
      cx.setLineDash([]);
      /* the token itself */
      cx.beginPath(); cx.arc(mid(o.x), mid(o.y), cell * .22, 0, Math.PI * 2);
      cx.fillStyle = col; cx.fill();
      cx.globalAlpha = .5;
      cx.beginPath();
      cx.moveTo(mid(u.x), mid(u.y)); cx.lineTo(mid(o.x), mid(o.y));
      cx.setLineDash([3, 5]); cx.stroke();
      cx.restore();
    });
  }

  function drawThreat(from, to) {
    cx.save();
    cx.strokeStyle = COL.threat;
    cx.lineWidth = 2;
    cx.setLineDash([7, 4]);
    cx.beginPath();
    cx.moveTo(mid(from.x), mid(from.y));
    cx.lineTo(mid(to.x), mid(to.y));
    cx.stroke();
    cx.restore();
  }

  function initials(name) {
    const clean = name.replace(/["']/g, '');
    const quoted = name.match(/"([^"]+)"/);
    if (quoted) return quoted[1].slice(0, 2).toUpperCase();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function drawUnit(S, u, view) {
    const col = u.owner === 0 ? COL.p0 : COL.p1;
    const r = cell * .40;
    const x = mid(u.x), y = mid(u.y);
    const raised = Board.heightAt(S.board, u.x, u.y) === Board.RAISED;

    cx.save();
    /* shadow, lifted a little when the model is up on something */
    cx.globalAlpha = .5;
    cx.fillStyle = '#000';
    cx.beginPath(); cx.ellipse(x, y + (raised ? r * .5 : r * .3), r * .95, r * .4, 0, 0, Math.PI * 2);
    cx.fill();
    cx.globalAlpha = 1;

    /* the base */
    const grd = cx.createLinearGradient(x, y - r, x, y + r);
    grd.addColorStop(0, '#2c2620');
    grd.addColorStop(1, '#15120f');
    cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2);
    cx.fillStyle = grd; cx.fill();
    cx.lineWidth = 2.2; cx.strokeStyle = col; cx.stroke();

    if (art[u.id]) {
      cx.save();
      cx.beginPath(); cx.arc(x, y, r - 2, 0, Math.PI * 2); cx.clip();
      cx.drawImage(art[u.id], x - r, y - r, r * 2, r * 2);
      cx.restore();
    } else {
      cx.fillStyle = COL.bone;
      cx.font = '700 ' + Math.round(cell * .40) + 'px Impact, sans-serif';
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(initials(u.name), x, y + 1);
    }

    /* selected / actable rings */
    if (view.selected === u.id) {
      cx.strokeStyle = '#e8c65c'; cx.lineWidth = 2.5;
      cx.beginPath(); cx.arc(x, y, r + 4, 0, Math.PI * 2); cx.stroke();
    } else if (view.ready && view.ready.indexOf(u.id) >= 0) {
      cx.strokeStyle = 'rgba(232,198,92,.55)'; cx.lineWidth = 1.5;
      cx.setLineDash([3, 3]);
      cx.beginPath(); cx.arc(x, y, r + 3, 0, Math.PI * 2); cx.stroke();
      cx.setLineDash([]);
    }
    if (view.targets && view.targets.indexOf(u.id) >= 0) {
      cx.strokeStyle = COL.threat; cx.lineWidth = 2.5;
      cx.beginPath(); cx.arc(x, y, r + 5, 0, Math.PI * 2); cx.stroke();
      cx.beginPath();
      cx.moveTo(x - r - 8, y); cx.lineTo(x - r - 3, y);
      cx.moveTo(x + r + 3, y); cx.lineTo(x + r + 8, y);
      cx.moveTo(x, y - r - 8); cx.lineTo(x, y - r - 3);
      cx.moveTo(x, y + r + 3); cx.lineTo(x, y + r + 8);
      cx.stroke();
    }

    /* wound pips under the base */
    const pipW = Math.max(2, cell * .14), gap = 1.5;
    const total = u.maxWounds * pipW + (u.maxWounds - 1) * gap;
    let pxp = x - total / 2;
    for (let i = 0; i < u.maxWounds; i++) {
      cx.fillStyle = i < u.wounds
        ? (u.wounds === 1 ? '#a8352a' : (u.wounds <= u.maxWounds / 2 ? '#c9832a' : '#c4b184'))
        : 'rgba(0,0,0,.65)';
      cx.fillRect(pxp, y + r + 2, pipW, Math.max(2, cell * .10));
      pxp += pipW + gap;
    }
    if (raised) {
      cx.fillStyle = '#e8c65c';
      cx.font = '700 ' + Math.round(cell * .3) + 'px Impact, sans-serif';
      cx.textAlign = 'left';
      cx.fillText('▲', x + r - 2, y - r + 4);
    }
    cx.restore();
  }

  function drawWreck(u) {
    const x = mid(u.x), y = mid(u.y), r = cell * .36;
    cx.save();
    cx.globalAlpha = .5;
    cx.strokeStyle = '#6d1a14'; cx.lineWidth = 2;
    cx.beginPath();
    cx.moveTo(x - r, y - r); cx.lineTo(x + r, y + r);
    cx.moveTo(x + r, y - r); cx.lineTo(x - r, y + r);
    cx.stroke();
    cx.restore();
  }

  /* Drop a scanned model in later: Render.setArt(unitId, 'scans/fred.png'). */
  function setArt(unitId, src) {
    const img = new Image();
    img.onload = () => { art[unitId] = img; };
    img.src = src;
  }

  return { attach, fit, draw, cellAt, setArt, COL, get cellSize() { return cell; } };
})();

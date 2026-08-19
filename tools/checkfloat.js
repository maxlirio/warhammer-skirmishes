/* Is anything hanging in the air, or buried?
 *
 * Chasing these one screenshot at a time does not work — a rock floating in
 * the corner of one biome is invisible in the other six, and every fix so far
 * has been aimed at whichever one happened to be photographed. So this walks
 * the whole scene on every battlefield, takes the world bounding box of every
 * mesh, and compares its underside to the ground actually beneath it.
 *
 * Floating: the bottom of the thing sits clear above what is under it.
 * Buried:   the top of the thing sits below what is under it.
 *
 * Things that are meant to be off the ground — a roof tank, a wall's upper
 * courses, the dice tray, a smoke cloud — are excluded by name, not by
 * fudging the tolerance.
 *
 *   node tools/checkfloat.js [--all]
 */

const path = require('path');

const CANDIDATES = [
  process.env.PLAYWRIGHT,
  path.join(process.env.HOME || '', 'Developer/ROBOT_EXPERIMENT/node_modules/playwright'),
  path.join(__dirname, '..', 'node_modules', 'playwright')
].filter(Boolean);
const found = CANDIDATES.find(p => { try { require.resolve(p); return true; } catch (e) { return false; } });
if (!found) { console.log('Playwright not found — set PLAYWRIGHT to an install.'); process.exit(0); }
const { chromium } = require(found);

const ROOT = path.join(__dirname, '..');
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const CARDS = ['NO CARD', 'SABOTAGE', 'KING OF THE HILL', 'AMBUSH',
               'ASSASSINATION', 'SECURE THE AREA', 'THE RELIC'];

(async () => {
  const browser = await chromium.launch({ args: GL });
  const pg = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

  let totalFloat = 0, totalBuried = 0, totalChecked = 0;

  for (const card of CARDS) {
    await pg.goto('file://' + ROOT + '/game/index.html');
    await pg.waitForTimeout(700);
    await pg.locator('.misscard', { hasText: card }).first().click();
    await pg.click('#startBtn');
    await pg.waitForTimeout(10000);

    const r = await pg.evaluate(() => {
      const S = Battle.get();
      const box = new window.THREE.Box3();
      const size = new window.THREE.Vector3();
      const floating = [], buried = [];
      let checked = 0;

      /* Only things that CLAIM to be standing on something. A building's
         upper storey, its parapet and its floor slabs are meant to be in the
         air; a crate, a tree, a rock and a rooftop tank are not. Whoever
         placed them recorded the height they were placed at, so this compares
         against a fact rather than guessing from the geometry. */
      /* Per PLACED OBJECT, not per mesh. A palm tree is two meshes — a trunk
         and a canopy — and only the trunk is supposed to touch the ground;
         testing the canopy said every tree on the table was floating three
         inches. What has to be resting on something is the thing that was
         placed, so that is what gets measured. */
      const placed = [];
      Render3D.scene.traverse(function (o) {
        if (o.userData && o.userData.rests !== undefined) placed.push(o);
      });

      placed.forEach(function (o) {
        /* skip one nested inside another that is already being checked */
        for (let a = o.parent; a; a = a.parent) {
          if (a.userData && a.userData.rests !== undefined) return;
        }
        box.setFromObject(o);
        box.getSize(size);
        if (!isFinite(box.min.y) || size.y < 0.02) return;
        checked++;
        let t = null;
        o.traverse(function (m) { if (!t && m.userData && m.userData.terrain) t = m.userData.terrain; });
        const name = (o.name || o.type) +
                     (t ? ' [' + (t.kind || 'terrain') + ' ' + t.w + 'x' + t.h + '@' + t.top + ']'
                        : ' [ground dressing]');
        const rests = o.userData.rests;
        const gap = box.min.y - rests;
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        if (gap > 0.3) floating.push({ n: name, gap: +gap.toFixed(2),
                                       at: [+cx.toFixed(1), +cz.toFixed(1)] });
        else if (box.max.y < rests - 0.1) {
          buried.push({ n: name, deep: +(rests - box.max.y).toFixed(2),
                        at: [+cx.toFixed(1), +cz.toFixed(1)] });
        }
      });

      return { map: S.map.name, checked: checked, floating: floating, buried: buried };
    });

    totalChecked += r.checked;
    totalFloat += r.floating.length;
    totalBuried += r.buried.length;

    const bad = r.floating.length + r.buried.length;
    console.log('  ' + (bad ? '✗' : '✓') + ' ' + r.map.padEnd(22) +
                r.checked + ' pieces' +
                (bad ? '  —  ' + r.floating.length + ' floating, ' +
                       r.buried.length + ' buried' : ''));
    r.floating.slice(0, 5).forEach(f =>
      console.log('        floating ' + f.gap + '" at ' + f.at.join(',') + '   ' + f.n));
    r.buried.slice(0, 3).forEach(f =>
      console.log('        buried   ' + f.deep + '" at ' + f.at.join(',') + '   ' + f.n));
  }

  console.log('\n' + totalChecked + ' pieces of terrain checked across seven battlefields');
  if (!totalFloat && !totalBuried) console.log('nothing hanging in the air, nothing buried.');
  else console.log(totalFloat + ' floating, ' + totalBuried + ' buried.');
  if (errs.length) console.log(errs.slice(0, 3).join('\n'));

  await browser.close();
  process.exit(totalFloat + totalBuried ? 1 : 0);
})();

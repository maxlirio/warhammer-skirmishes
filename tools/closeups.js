/* Photograph every piece of terrain on its own, at model height.
 *
 * tools/shots.js takes the wide view, and the wide view hides everything: a
 * gravestone blown up to four inches and jammed against four more looks like
 * texture from across the table and like nonsense from three feet away. Every
 * complaint so far has been about something only visible close up, which means
 * the wide shot was never the right thing to be looking at before shipping.
 *
 * So this frames each terrain piece individually, from a model's eye line, and
 * writes one picture per piece. They are meant to be LOOKED AT.
 *
 *   node tools/closeups.js [card] [outdir]
 *   node tools/closeups.js "SECURE THE AREA" /tmp/gy
 */

const path = require('path');
const fs = require('fs');

const CANDIDATES = [
  process.env.PLAYWRIGHT,
  path.join(process.env.HOME || '', 'Developer/ROBOT_EXPERIMENT/node_modules/playwright'),
  path.join(__dirname, '..', 'node_modules', 'playwright')
].filter(Boolean);
const found = CANDIDATES.find(p => { try { require.resolve(p); return true; } catch (e) { return false; } });
if (!found) { console.log('Playwright not found — set PLAYWRIGHT to an install.'); process.exit(0); }
const { chromium } = require(found);

const ROOT = path.join(__dirname, '..');
const CARD = process.argv[2] || 'NO CARD';
const OUT = process.argv[3] || path.join(ROOT, 'shots', 'close');
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: GL });
  const pg = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

  await pg.goto('file://' + ROOT + '/game/index.html');
  await pg.waitForTimeout(800);
  await pg.locator('.misscard', { hasText: CARD }).first().click();
  await pg.click('#startBtn');
  await pg.waitForTimeout(10000);

  /* stand a model beside each piece, so its size is readable */
  await pg.evaluate(() => {
    const S = Battle.get();
    let n = 0;
    while (S.pending && S.pending.kind === 'deploy' && n++ < 40) {
      Battle.placeDeploy(S.pending.spots[Math.floor(S.pending.spots.length * 0.5)]);
    }
    let m = 0;
    while (S.pending && S.pending.kind === 'pick' && m++ < 6) Battle.choosePick(S.pending.options[0]);
  });
  await pg.waitForTimeout(900);

  const pieces = await pg.evaluate(() => {
    const b = Battle.get().board;
    return b.terrain.map((t, i) => ({ i: i, x: t.x, y: t.y, w: t.w, h: t.h,
                                      top: t.top, kind: t.kind || 'terrain',
                                      blocks: !!t.blocks }));
  });

  const name = await pg.evaluate(() => Battle.get().map.name + ' — ' + Battle.get().map.biome);
  console.log(name + ' — ' + pieces.length + ' pieces\n');

  for (const p of pieces) {
    /* a model of the piece's own scale is 1.6" tall; stand back far enough to
       see the whole thing and low enough to read its silhouette */
    await pg.evaluate(([q]) => {
      const cam = Render3D.camera;
      const cx = q.x + q.w / 2, cz = q.y + q.h / 2;
      const span = Math.max(q.w, q.h, q.top) ;
      const d = span * 1.7 + 3;
      cam.position.set(cx - d * 0.72, q.top * 0.75 + span * 0.5 + 1.2, cz + d * 0.72);
      cam.lookAt(cx, q.top * 0.42, cz);
      cam.updateProjectionMatrix();
    }, [p]);
    await pg.waitForTimeout(420);
    const file = path.join(OUT, String(p.i).padStart(2, '0') + '-' + p.kind +
                           '-' + p.w + 'x' + p.h + '-h' + p.top + '.png');
    await pg.locator('#board').screenshot({ path: file });
    console.log('  ' + String(p.i).padStart(2) + '  ' + p.kind.padEnd(12) +
                p.w + '" x ' + p.h + '" x ' + p.top + '" high' +
                (p.blocks ? '  (blocks)' : ''));
  }

  console.log('\n' + (errs.length ? errs.length + ' error(s)' : 'no errors'));
  console.log('pictures in ' + OUT);
  await browser.close();
})();

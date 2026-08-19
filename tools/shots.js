/* Take a picture of every battlefield, so somebody can LOOK at it.
 *
 * Everything else here checks that the code runs. None of that catches a
 * staircase into a wall, a cactus on a gantry, or a battlefield that reads as
 * six grey boxes — and those are exactly what has been shipped. Rendering
 * clean is not the same as looking right, so this writes the pictures out and
 * they get looked at before anything goes.
 *
 *   node tools/shots.js [outdir]
 *
 * Needs Playwright; set PLAYWRIGHT if it lives somewhere unusual.
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
const OUT = process.argv[2] || path.join(ROOT, 'shots');
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/* one per mission card, because each card has its own battlefield now */
const CARDS = ['NO CARD', 'SABOTAGE', 'KING OF THE HILL', 'AMBUSH',
               'ASSASSINATION', 'SECURE THE AREA', 'THE RELIC'];

/* Two angles: the one the players get, and a low one down at model height —
   which is where a box stops looking like scenery. */
const VIEWS = [
  { tag: 'table', pitch: 0.62, dist: 1.0 },
  { tag: 'eye',   pitch: 0.13, dist: 0.55 },
  /* straight down, which is how a battlefield gets judged at a glance and
     where a table of plain rectangles has nowhere to hide */
  { tag: 'top',   pitch: 3.2,  dist: 0.62 }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: GL });
  const pg = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  for (let i = 0; i < CARDS.length; i++) {
    const card = CARDS[i];
    await pg.goto('file://' + ROOT + '/game/index.html');
    await pg.waitForTimeout(800);
    const tile = pg.locator('.misscard', { hasText: card }).first();
    if (!await tile.count()) { console.log('  ! no card tile for ' + card); continue; }
    await tile.click();
    await pg.click('#startBtn');
    await pg.waitForTimeout(11000);

    /* put the models on the table so the scale reads */
    await pg.evaluate(() => {
      const S = Battle.get();
      let n = 0;
      while (S.pending && S.pending.kind === 'deploy' && n++ < 40) {
        Battle.placeDeploy(S.pending.spots[Math.floor(S.pending.spots.length * 0.5)]);
      }
      let m = 0;
      while (S.pending && S.pending.kind === 'pick' && m++ < 8) {
        Battle.choosePick(S.pending.options[0]);
      }
    });
    await pg.waitForTimeout(1200);

    const name = await pg.evaluate(() => Battle.get().map.name + ' — ' + Battle.get().map.biome);

    for (const v of VIEWS) {
      await pg.evaluate(([pitch, dist]) => {
        const b = Battle.get().board;
        const cam = Render3D.camera;
        const c = { x: b.w / 2, z: b.h / 2 };
        const r = Math.max(b.w, b.h) * (0.85 * dist);
        if (pitch > 2) {                       /* straight down */
          cam.position.set(c.x, Math.max(b.w, b.h) * 1.15, c.z + 0.01);
          cam.lookAt(c.x, 0, c.z);
        } else {
          cam.position.set(c.x - r * 0.75, 4 + r * pitch, c.z + r * 0.75);
          cam.lookAt(c.x, pitch < 0.3 ? 2.2 : 0, c.z);
        }
        cam.updateProjectionMatrix();
      }, [v.pitch, v.dist]);
      await pg.waitForTimeout(700);
      const file = path.join(OUT, String(i) + '-' + card.toLowerCase().replace(/[^a-z]+/g, '') +
                             '-' + v.tag + '.png');
      await pg.locator('#board').screenshot({ path: file });
    }
    console.log('  ' + card.padEnd(17) + name);
  }

  if (errs.length) {
    console.log('\n' + errs.length + ' error(s) while rendering:');
    errs.slice(0, 6).forEach(e => console.log('  ' + e));
  } else {
    console.log('\nno errors');
  }
  console.log('pictures in ' + OUT);
  await browser.close();
})();

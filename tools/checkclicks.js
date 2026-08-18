/* Does clicking the thing actually do the thing?
 *
 * The other tools reason about the code. This one drives a real browser,
 * projects a real position to a real screen coordinate, and clicks it — which
 * is the only way to catch a question that reads perfectly, shades the right
 * ground, and quietly ignores you. Both of those shipped.
 *
 * Needs Playwright. It is not a dependency of this repo; point PLAYWRIGHT at an
 * install if it is somewhere else.
 *
 *   node tools/checkclicks.js
 */

const path = require('path');
const fs = require('fs');

const CANDIDATES = [
  process.env.PLAYWRIGHT,
  path.join(process.env.HOME || '', 'Developer/ROBOT_EXPERIMENT/node_modules/playwright'),
  path.join(__dirname, '..', 'node_modules', 'playwright')
].filter(Boolean);

const found = CANDIDATES.find(p => { try { require.resolve(p); return true; } catch (e) { return false; } });
if (!found) {
  console.log('Playwright not found. Set PLAYWRIGHT to an install, or skip this one —');
  console.log('the other tools do not need a browser.');
  process.exit(0);
}
const { chromium } = require(found);

const ROOT = path.join(__dirname, '..');
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

let checks = 0, failed = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log('  ✓ ' + label); return; }
  failed++;
  console.log('  ✗ ' + label + (detail ? '  — ' + detail : ''));
}

(async () => {
  const browser = await chromium.launch({ args: GL });
  const pg = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  await pg.goto('file://' + ROOT + '/game/index.html');
  await pg.waitForTimeout(700);
  await pg.locator('.misscard', { hasText: 'NO CARD' }).first().click();
  await pg.click('#startBtn');
  await pg.waitForTimeout(9000);

  /* screen position of a spot on the table, at a given height above it */
  const screenOf = (x, y, h) => pg.evaluate(([px, py, ph]) => {
    const S = Battle.get();
    const base = Board.heightAt(S.board, { x: px, y: py });
    const v = new window.THREE.Vector3(px, base + (ph || 0), py).project(Render3D.camera);
    const c = document.getElementById('board').getBoundingClientRect();
    return { x: c.left + (v.x + 1) / 2 * c.width, y: c.top + (1 - (v.y + 1) / 2) * c.height };
  }, [x, y, h]);

  console.log('\n== deployment, by clicking');
  {
    const before = await pg.evaluate(() => {
      const S = Battle.get();
      return S.pending && S.pending.kind === 'deploy'
        ? { unit: Battle.unit(S.pending.unitId).name, spots: S.pending.spots.length }
        : null;
    });
    ok(!!before, 'the game opens by asking where to put the first model',
       before ? '' : 'no deploy question');
    if (before) {
      const spot = await pg.evaluate(() => {
        const s = Battle.get().pending.spots;
        return s[Math.floor(s.length * 0.5)];
      });
      const px = await screenOf(spot.x, spot.y, 0);
      await pg.mouse.click(px.x, px.y);
      await pg.waitForTimeout(400);
      const after = await pg.evaluate(() => {
        const S = Battle.get();
        return { placed: S.units.filter(u => u.deployed && !u.reserve).length,
                 nextKind: S.pending ? S.pending.kind : null };
      });
      ok(after.placed > 0, 'clicking the zone puts the model down', 'placed ' + after.placed);
      ok(after.nextKind === 'deploy', 'and it moves on to the next one');
    }
    /* finish the rest without clicking, so the game can get going */
    await pg.evaluate(() => {
      const S = Battle.get();
      let n = 0;
      while (S.pending && S.pending.kind === 'deploy' && n++ < 40) {
        Battle.placeDeploy(S.pending.spots[Math.floor(S.pending.spots.length * 0.5)]);
      }
    });
    await pg.waitForTimeout(400);
  }

  console.log('\n== a card that asks you to choose a model');
  {
    const q = await pg.evaluate(() => {
      const S = Battle.get();
      return S.pending && S.pending.kind === 'pick'
        ? { options: S.pending.options.length } : null;
    });
    ok(!!q, "Da Hunta asks his owner which enemy to mark", q ? '' : 'nothing pending');
    if (q) {
      const who = await pg.evaluate(() => {
        const u = Battle.unit(Battle.get().pending.options[0]);
        return { x: u.x, y: u.y };
      });
      const px = await screenOf(who.x, who.y, 0.8);
      await pg.mouse.click(px.x, px.y);
      await pg.waitForTimeout(400);
      const marked = await pg.evaluate(() =>
        Battle.get().units.filter(u => (u.marks || []).length).map(u => u.name));
      ok(marked.length === 1, 'and clicking a model marks it',
         marked.length ? marked[0] : 'nothing was marked');
    }
  }

  console.log('\n== a card that asks you to place something');
  {
    await pg.evaluate(() => {
      const S = Battle.get();
      S.players[0].ap = 9;
      S.control.player = 0;
      Battle.emit();
    });
    await pg.locator('#plist0 .urow', { hasText: 'Alfred' }).first().click();
    await pg.waitForTimeout(1400);
    const btn = pg.locator('.abtn', { hasText: 'Smoke Bomb' }).first();
    ok(await btn.count() > 0, 'the Smoke Bomb is offered in the action list');
    await btn.click();
    await pg.waitForTimeout(600);

    /* click while the dice are still settling — the question must still answer */
    const q = await pg.evaluate(() => {
      const S = Battle.get();
      return S.pending && S.pending.kind === 'put'
        ? { radius: S.pending.radius, spots: S.pending.spots.length,
            rolling: Render3D.busy() } : null;
    });
    ok(!!q, 'using it asks where to put it', q ? '' : 'nothing pending');
    if (q) {
      const spot = await pg.evaluate(() => {
        const s = Battle.get().pending.spots;
        return s[Math.floor(s.length * 0.65)];
      });
      const px = await screenOf(spot.x, spot.y, 0);
      await pg.mouse.click(px.x, px.y);
      await pg.waitForTimeout(500);
      const t = await pg.evaluate(() => {
        const S = Battle.get();
        return { n: S.tokens.length, label: S.tokens.length ? S.tokens[0].label : null };
      });
      ok(t.n === 1, 'and clicking the table places it' +
         (q.rolling ? ' — even with the dice still settling' : ''),
         t.n ? '' : 'nothing was placed');
      ok(t.label === 'SMOKE BOMB', 'the right thing, at that');
    }
  }

  ok(errs.length === 0, 'and nothing threw along the way', errs.slice(0, 2).join(' | '));

  console.log('\n== summary\n' + (checks - failed) + '/' + checks + ' checks passed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();

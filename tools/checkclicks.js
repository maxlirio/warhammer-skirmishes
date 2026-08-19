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

  console.log('\n== choosing a model when others are in the way');
  {
    /* A fresh table: the sections above leave a token on the board and a
       selection in the panel, and this one is about a clean click. */
    await pg.goto('file://' + ROOT + '/game/index.html');
    await pg.waitForTimeout(700);
    await pg.locator('.misscard', { hasText: 'NO CARD' }).first().click();
    await pg.click('#startBtn');
    await pg.waitForTimeout(9000);

    /* Put the two forces nose to nose, in two tight files, so there is a real
       shot to take AND the models genuinely overlap on screen — which is the
       geometry that broke: the ray reaches somebody who is not a legal target
       before it reaches somebody who is. */
    const shooter = await pg.evaluate(() => {
      const S = Battle.get();
      let n = 0;
      while (S.pending && S.pending.kind === 'deploy' && n++ < 40) {
        Battle.placeDeploy(S.pending.spots[0]);
      }
      let m = 0;
      while (S.pending && S.pending.kind === 'pick' && m++ < 6) {
        Battle.choosePick(S.pending.options[0]);
      }
      const mine = S.units.filter(u => u.owner === 0 && u.alive && !u.marker && !u.reserve);
      const foes = S.units.filter(u => u.owner === 1 && u.alive && !u.marker && !u.reserve);
      const cx = S.board.w / 2, cy = S.board.h / 2;
      mine.forEach((u, i) => { u.x = cx - 5; u.y = cy - 3 + i * 1.4; });
      foes.forEach((u, i) => { u.x = cx + 5; u.y = cy - 3 + i * 1.4; });
      S.players[0].ap = 6;
      S.control = { player: 0, forcedUnitId: null };
      Battle.emit();
      for (const u of mine) {
        const t = Battle.rangedTargets(u.id);
        if (t.length > 1) return { id: u.id, name: u.name, targets: t };
      }
      return null;
    });
    await pg.waitForTimeout(900);
    ok(!!shooter, 'with the lines closed up, somebody has more than one target');

    if (shooter) {
      await pg.locator('#plist0 .urow', { hasText: shooter.name }).first().click();
      await pg.waitForTimeout(1000);
      const sh = pg.locator('.abtn', { hasText: 'SHOOT' }).first();
      const haveShoot = await sh.count() > 0;
      ok(haveShoot, 'SHOOT is offered for them');
      if (haveShoot) {
        await sh.click();
        await pg.waitForTimeout(500);

        /* aim at the one furthest down the file, which has its own friends
           standing between it and the camera */
        const tgt = await pg.evaluate(([ids]) => {
          const u = Battle.unit(ids[ids.length - 1]);
          return { id: u.id, name: u.name, x: u.x, y: u.y };
        }, [shooter.targets]);
        const px = await screenOf(tgt.x, tgt.y, 0.7);
        const before = await pg.evaluate(() => Battle.get().strikes.length);
        await pg.mouse.click(px.x, px.y);
        await pg.waitForTimeout(2600);
        const after = await pg.evaluate(() => ({
          strikes: Battle.get().strikes.length,
          pending: Battle.get().pending ? Battle.get().pending.kind : null,
          log: Battle.get().log.slice(-8).map(l => l.text).join(' | ')
        }));
        ok(after.strikes > before || after.pending,
           'clicking the enemy actually fires at them',
           'nothing happened — ' + after.log.slice(-120));
        ok(after.log.indexOf(tgt.name) >= 0,
           'and at the model that was clicked, not one standing in front of it',
           'wanted ' + tgt.name + ' — got: ' + after.log.slice(-160));
      }
    }
  }

  ok(errs.length === 0, 'and nothing threw along the way', errs.slice(0, 2).join(' | '));

  console.log('\n== summary\n' + (checks - failed) + '/' + checks + ' checks passed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();

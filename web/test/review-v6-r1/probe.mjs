// Review probe for the v6 dashboard polish (reviews/dash-v6-r1.md).
//
// Every check below is a failing assertion against the state of the branch at
// 7212fd2, with the brief sentence it contradicts named in the message. Run it
// against a demo Vite server:
//
//   VITE_DEMO=1 bun node_modules/vite/bin/vite.js --config apps/dashboard/vite.config.ts \
//     --host 127.0.0.1 --port 23336 &
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium bun test/review-v6-r1/probe.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

try {
  // (1) Passes today, kept as a guard. v6 added
  // `.topbar-actions .mobile-menu{display:none}` with a 600 px exception, which outranks
  // the 1250 px rule that used to show the glyph; the tab row only survives those widths
  // because a later `.topbar nav{display:flex;…}` overrides the 1250 px `display:none`.
  // Two rules deep in one file now decide whether the shell has any navigation at all.
  {
    const context = await browser.newContext({ viewport: { width: 1024, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${base}/#overview`);
    await page.getByRole('heading', { name: 'Overview' }).waitFor();
    for (const width of [1440, 1251, 1249, 1024, 900, 768, 601, 600, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(120);
      const state = await page.evaluate(() => ({
        nav: getComputedStyle(document.querySelector('.topbar nav')).display,
        menu: getComputedStyle(document.querySelector('.mobile-menu')).display,
        tabs: [...document.querySelectorAll('.topbar nav a')].filter(a => a.getBoundingClientRect().width > 0).length,
      }));
      const reachable = state.tabs > 0 || state.menu !== 'none';
      check(reachable, `${width}px: navigation is reachable (tab row display:${state.nav} with ${state.tabs} visible tabs, .mobile-menu display:${state.menu}) — v6 brief item 4 keeps the mobile menu glyph, it does not remove the only navigation`);
    }
    await context.close();
  }

  // (2) v6 brief item 2 asks for "the metric's unit chip if it has one" on the hover
  // card. `unit` was already the sparkline readout's formatter selector, and
  // analytics-v3.tsx documents the rule: "without a unit the readout reuses the headline
  // formatter, whose own text already names the unit". Adding `unit` to three Overview
  // tiles for the chip's sake therefore re-formats their trend readouts and hidden table
  // twins, which item 2 does not ask for.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
    const page = await context.newPage();
    await page.goto(`${base}/#overview`);
    await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
    await page.locator('.tile__value strong').first().waitFor();
    const read = label => page.evaluate(name => {
      const tile = [...document.querySelectorAll('.tile')].find(el => el.querySelector('.tile__label span')?.textContent?.trim() === name);
      if (!tile) return null;
      const rows = [...tile.querySelectorAll('table tbody tr')].map(tr => tr.lastElementChild?.textContent?.trim()).filter(Boolean);
      return { headline: tile.querySelector('.tile__value strong')?.textContent?.trim(), readouts: rows };
    }, label);

    const success = await read('Tool success');
    check(success?.readouts.length > 0, `Tool success: the trend readout has rows (${JSON.stringify(success)})`);
    check(success.readouts.every(v => /^\d+(\.\d+)?%$/.test(v)),
      `Tool success: the trend readout reads like its own headline ${JSON.stringify(success.headline)}; got ${JSON.stringify(success.readouts.slice(0, 3))} — unitFormat('%') inserts a space the pct() headline never has`);

    const tokens = await read('Context tokens');
    check(tokens?.readouts.length > 0, `Context tokens: the trend readout has rows (${JSON.stringify(tokens)})`);
    check(tokens.readouts.every(v => v.startsWith('≈')),
      `Context tokens: the trend readout keeps the estimate marker of its headline ${JSON.stringify(tokens.headline)}; got ${JSON.stringify(tokens.readouts.slice(0, 3))} — docs/analytics.md calls every token figure an estimate, never a provider invoice`);
    await context.close();
  }

  // (3) v6 brief item 5: "Polling itself stays as it is." The demo client answers in
  // process, so the loads the activity store records are the instrument here; the real
  // collector's request log is covered by `project-status-backend.mjs`.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(`${base}/#overview`);
    await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
    await page.locator('.tile__value strong').first().waitFor();
    const loads = () => page.evaluate(() => globalThis.__SIGNALS_ACTIVITY__?.loads ?? 0);
    const first = await loads();
    await page.clock.fastForward(61000);
    await page.waitForTimeout(400);
    check(await loads() > first, `the screen still polls: ${first} loads before the interval, ${await loads()} after`);
    await context.close();
  }

  // (5) v6 brief item 2: the hover card "opens on hover (120 ms delay) and on
  // click/focus". `pointerFocus` in packages/ui/src/info.tsx is set on `pointerdown` and
  // cleared only in `onClick`, so a press that drags off the button never clears it and
  // that button stops opening on focus for the rest of the page's life.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${base}/#overview`);
    await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
    await page.waitForTimeout(600);
    const trigger = page.locator('.info-button').first();
    await trigger.focus();
    await page.waitForTimeout(200);
    check(await page.locator('.info-pop').count() === 1, 'focusing the info button opens its hover card');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const box = await trigger.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, 900);
    await page.mouse.up();                   // a press that drags off the button: no click
    await page.locator('h1').click();
    await page.waitForTimeout(200);
    await trigger.focus();
    await page.waitForTimeout(250);
    check(await page.locator('.info-pop').count() === 1,
      'the info button still opens on focus after a press that was dragged off it (pointerFocus is never cleared without a click)');
    await context.close();
  }

  // (4) v6 brief item 2: the hover card is "never clipped" by the viewport. The desktop
  // branch of place() clamps `top` to >= 8 px but applies no max-height, so a card taller
  // than the viewport runs off the bottom. 620 px is an ordinary laptop browser window
  // with devtools docked.
  for (const [width, height] of [[1440, 620], [1440, 1000], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${base}/#settings`);
    await page.getByRole('heading', { name: 'Alert rules' }).waitFor();
    const buttons = page.locator('.card .info-button');
    const count = await buttons.count();
    let worst = null;
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      await button.scrollIntoViewIfNeeded();
      await button.click();
      const pop = page.locator('.info-pop');
      await pop.waitFor();
      const box = await pop.boundingBox();
      const over = Math.max(0, Math.round(box.y + box.height - height), Math.round(-box.y), Math.round(box.x + box.width - width), Math.round(-box.x));
      const title = await pop.locator('.info-pop__title').textContent();
      if (!worst || over > worst.over) worst = { over, title, box };
      await page.keyboard.press('Escape');
    }
    check(worst && worst.over === 0, `${width}x${height}: no hover card is clipped by the viewport; worst is ${JSON.stringify(worst)}`);
    await context.close();
  }
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r1 probe passed');

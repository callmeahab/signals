// Review probe for the v6 dashboard polish (reviews/dash-v6-r1.md): the ordinary-reload
// layout-shift gate in `scripts/reload-series.mjs` (`warm.cls < 0.01`).
//
// v6 item 3 replaced the project cards' status line with a dot, which makes the cards one
// row instead of two and the workspace strip 68 px instead of 85 px. The whole empty
// shell therefore sits 17 px higher, and the top ~11 px of `.app-footer` is now inside a
// 1000 px viewport while the screen still has no content. When the content arrives the
// footer leaves the viewport, and Chromium records that as a layout shift of 0.00905 on
// top of the pre-existing 0.00199 webfont shift of the nav — 0.0110, over the gate.
//
// The CLS number itself only exceeds the gate when the content is slow enough to paint
// after the shell, so this probe asserts the invariant underneath it instead, which is
// load-independent: while the first screen's content is pending, the footer must not be
// in the viewport. Run it against a demo server:
//
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium bun test/review-v6-r1/reload-cls.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', timezoneId: 'UTC' });
  await context.addInitScript(() => {
    globalThis.__shifts = [];
    new globalThis.PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) globalThis.__shifts.push({ value: entry.value, at: Math.round(entry.startTime), sources: (entry.sources ?? []).map(s => s.node ? `${s.node.nodeName}.${s.node.className ?? ''}`.trim() : '?') }); }).observe({ type: 'layout-shift', buffered: true });
  });
  // A deterministic pending window: the shell is up and the screen has nothing yet.
  await context.route('**/src/demo.ts*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: `${body}
const originalAnalytics=demoClient.analytics;
demoClient.analytics=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,900));return originalAnalytics(...args);};` });
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  await page.evaluate(() => { globalThis.__shifts = []; });
  await page.reload({ waitUntil: 'commit' });
  await page.locator('.workspace-strip').waitFor();
  const pending = await page.evaluate(() => {
    const footer = document.querySelector('.app-footer');
    const strip = document.querySelector('.workspace-strip');
    return {
      cards: document.querySelectorAll('.signals-ui .card, .signals-ui .tile').length,
      stripHeight: strip ? Math.round(strip.getBoundingClientRect().height) : null,
      footerTop: footer ? Math.round(footer.getBoundingClientRect().top) : null,
      viewport: globalThis.innerHeight,
    };
  });
  check(pending.cards === 0, `the screen's content is still pending while this is measured (${pending.cards} cards/tiles)`);
  check(pending.footerTop !== null && pending.footerTop >= pending.viewport,
    `the footer is out of the viewport while the screen has no content: strip ${pending.stripHeight}px, footer top ${pending.footerTop}px in a ${pending.viewport}px viewport — the ${pending.viewport - pending.footerTop}px of it that are visible become a layout shift the moment the content arrives`);

  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await page.waitForTimeout(600);
  const shifts = await page.evaluate(() => globalThis.__shifts ?? []);
  const cls = shifts.reduce((sum, entry) => sum + entry.value, 0);
  console.log(`     reload shifts ${cls.toFixed(4)}: ${JSON.stringify(shifts)}`);
  check(cls < 0.01, `cumulative layout shift after an ordinary reload is under the 0.01 gate scripts/reload-series.mjs keeps: ${cls.toFixed(4)}`);
  await context.close();
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r1 reload-cls probe passed');

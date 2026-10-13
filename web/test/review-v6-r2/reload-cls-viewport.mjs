// Review round 2 (reviews/dash-v6-r2.md), fresh variant of B2: the reload layout-shift
// invariant at a viewport height the round-1 evidence never used. The fix reserves
// `calc(100dvh - 64px - 68px)` on `#main > .signals-ui`, which is a function of the
// viewport, so it has to be checked at more than one height.
//
// Same measurement as `test/review-v6-r1/reload-cls.mjs`: the browser's own
// layout-instability entries across an ordinary reload, with the screen's data
// deliberately slow so the shell is up before any content, plus the invariant underneath
// the number — the footer must not be in the viewport while the screen is empty.
//
//   VIEWPORT_HEIGHT=900 BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
//     bun test/review-v6-r2/reload-cls-viewport.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const width = Number(process.env.VIEWPORT_WIDTH ?? 1440);
const height = Number(process.env.VIEWPORT_HEIGHT ?? 900);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

try {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light', timezoneId: 'UTC' });
  await context.addInitScript(() => {
    globalThis.__shifts = [];
    new globalThis.PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) globalThis.__shifts.push({ value: entry.value, at: Math.round(entry.startTime), sources: (entry.sources ?? []).map(s => s.node ? `${s.node.nodeName}.${s.node.className ?? ''}`.trim() : '?') }); }).observe({ type: 'layout-shift', buffered: true });
  });
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
    const view = document.querySelector('#main > .signals-ui');
    return {
      cards: document.querySelectorAll('.signals-ui .card, .signals-ui .tile').length,
      stripHeight: strip ? Math.round(strip.getBoundingClientRect().height) : null,
      reserved: view ? Math.round(view.getBoundingClientRect().height) : null,
      footerTop: footer ? Math.round(footer.getBoundingClientRect().top) : null,
      viewport: globalThis.innerHeight,
    };
  });
  check(pending.cards === 0, `${width}x${height}: the screen's content is still pending while this is measured (${pending.cards} cards/tiles)`);
  check(pending.footerTop !== null && pending.footerTop >= pending.viewport,
    `${width}x${height}: the footer is out of the viewport while the screen has no content — strip ${pending.stripHeight}px, reserved view ${pending.reserved}px, footer top ${pending.footerTop}px in a ${pending.viewport}px viewport`);

  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await page.waitForTimeout(600);
  const settled = await page.evaluate(() => {
    const footer = document.querySelector('.app-footer');
    return { footerTop: footer ? Math.round(footer.getBoundingClientRect().top) : null };
  });
  const shifts = await page.evaluate(() => globalThis.__shifts ?? []);
  const cls = shifts.reduce((sum, entry) => sum + entry.value, 0);
  console.log(`     ${width}x${height}: footer ${pending.footerTop}px -> ${settled.footerTop}px, shifts ${cls.toFixed(4)}: ${JSON.stringify(shifts)}`);
  check(!shifts.some(entry => entry.sources.some(source => source.startsWith('FOOTER'))),
    `${width}x${height}: no layout shift is attributed to the footer`);
  check(cls < 0.01, `${width}x${height}: cumulative layout shift after an ordinary reload is under the 0.01 gate scripts/reload-series.mjs keeps: ${cls.toFixed(4)}`);
  await context.close();
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log(`review-v6-r2 reload-cls probe passed at ${width}x${height}`);

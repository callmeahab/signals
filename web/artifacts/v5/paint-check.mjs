// Every chart on every screen has its SVG and its table twin right after load, with the
// page never scrolled. Run with the demo server up:
//   BASE_URL=http://127.0.0.1:23500 node artifacts/v5/paint-check.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:23500';
const browser = await chromium.launch({ channel: 'chromium' });
const screens = ['overview','adoption','tools','reliability','sessions','callers','cost','protocol','live','settings','setup'];
for (const width of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: 'light', timezoneId: 'UTC' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });
  for (const screen of screens) {
    await page.goto(`${base}/#${screen}`);
    await page.waitForTimeout(150);
    await page.locator('.signals-ui .panel').first().waitFor();
    // No scrolling at all. Wait until every chart has an SVG, then report how long it took.
    const t0 = Date.now();
    let ok = false, last = null;
    for (let i = 0; i < 80; i++) {
      last = await page.evaluate(() => {
        const charts = [...document.querySelectorAll('.v3-chart')];
        return { total: charts.length, svg: charts.filter(c => c.querySelector('svg[role=img]')).length,
                 twin: charts.filter(c => c.querySelector('table.sr-only')).length,
                 scrollY: Math.round(scrollY) };
      });
      if (last.total > 0 && last.svg === last.total && last.twin === last.total) { ok = true; break; }
      if (i > 8 && last.total === 0) break;
      await page.waitForTimeout(50);
    }
    const verdict = last.total === 0 ? 'no .v3-chart on this screen' : ok ? 'OK' : 'INCOMPLETE';
    console.log(`${width} ${screen.padEnd(12)} charts=${last.total} svg=${last.svg} twin=${last.twin} scrollY=${last.scrollY} ${verdict}${last.total ? ` in ${Date.now()-t0}ms` : ''}`);
  }
  await ctx.close();
}
await browser.close();

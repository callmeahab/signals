// Tab-switch main-thread work for every nav destination, using the same method
// as web/scripts/performance-qa.mjs (CDP Performance.getMetrics TaskDuration
// around a CDP-dispatched nav click, 750 ms settle). Adoption and Tools are
// included so the method can be calibrated against the committed numbers.
// This probe does NOT start a tracing session, so if anything it undercounts
// relative to performance-qa.mjs.
//
// Run from web/:
//   PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
//     bun ../reports/review-r2/perf-screens.mjs [repeats]
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:26210';
const repeats = Number(process.argv[2] ?? 3);
const theme = process.env.PERFORMANCE_THEME ?? 'light';
const targets = ['adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live', 'setup', 'settings'];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const runs = [];

for (let r = 0; r < repeats; r++) {
  for (const screen of targets) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    const page = await ctx.newPage();
    await page.addInitScript((dark) => { globalThis.__SIGNALS_VISUAL_QA__ = true; localStorage.setItem('signals-theme', dark ? 'dark' : 'light'); }, theme === 'dark');
    await page.goto(product);
    await page.locator('.chart-stacked-area svg').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const box = await page.locator(`nav a[href="#${screen}"]`).boundingBox();
    const before = await metric();
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 });
    }
    await page.waitForTimeout(750);
    const after = await metric();
    const ms = Math.round((after.TaskDuration - before.TaskDuration) * 1000 * 1000) / 1000;
    runs.push({ run: r + 1, screen, mainThreadMs: ms, over: ms >= 100 });
    console.log(`run ${r + 1} overview → ${screen}: ${ms.toFixed(2)} ms${ms >= 100 ? '  OVER BUDGET' : ''}`);
    await ctx.close();
  }
}

await browser.close();
const summary = targets.map((screen) => {
  const values = runs.filter((x) => x.screen === screen).map((x) => x.mainThreadMs).sort((a, b) => a - b);
  return { screen, runs: values, min: values[0], median: values[Math.floor(values.length / 2)], max: values.at(-1), overBudget: values.filter((v) => v >= 100).length };
});
writeFileSync(`${outDir}/perf-screens.json`, JSON.stringify({ product, theme, repeats, runs, summary }, null, 2));
console.log(JSON.stringify(summary, null, 2));

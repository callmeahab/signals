// web/scripts/performance-qa.mjs measures only the FIRST tab switch after a
// fresh load. This probe measures every switch in one continuous session, the
// way a reader clicks through the nav, with the same instrument (CDP
// Performance.getMetrics TaskDuration delta, 750 ms settle, no tracing
// session). The budget in the implement brief is per tab switch, not per first
// tab switch.
//
// Run from web/:
//   PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
//     bun ../reports/review-r2/perf-sequence.mjs [repeats]
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:26210';
const repeats = Number(process.argv[2] ?? 3);
const theme = process.env.PERFORMANCE_THEME ?? 'light';
const order = ['adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live', 'overview', 'adoption', 'reliability'];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const runs = [];

for (let r = 0; r < repeats; r++) {
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
  let step = 0;
  let from = 'overview';
  for (const screen of order) {
    step += 1;
    const box = await page.locator(`nav a[href="#${screen}"]`).boundingBox();
    const before = await metric();
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 });
    }
    await page.waitForTimeout(750);
    const after = await metric();
    const ms = Math.round((after.TaskDuration - before.TaskDuration) * 1000 * 1000) / 1000;
    const pick = (name, scale = 1) => Math.round((after[name] - before[name]) * scale * 1000) / 1000;
    const state = await page.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      charts: document.querySelectorAll('.v3-chart').length,
      svgs: document.querySelectorAll('.v3-chart svg').length,
      animations: document.getAnimations().length,
    }));
    runs.push({
      run: r + 1, step, transition: `${from} → ${screen}`, mainThreadMs: ms, over: ms >= 100,
      recalcStyleMs: pick('RecalcStyleDuration', 1000), layoutMs: pick('LayoutDuration', 1000),
      scriptMs: pick('ScriptDuration', 1000), recalcCount: pick('RecalcStyleCount'), layoutCount: pick('LayoutCount'),
      nodesTotal: after.Nodes, listenersTotal: after.JSEventListeners, layoutObjects: after.LayoutObjects, ...state,
    });
    console.log(`run ${r + 1} step ${step} ${from} → ${screen}: ${ms.toFixed(2)} ms${ms >= 100 ? '  OVER BUDGET' : ''}`);
    from = screen;
    await page.waitForTimeout(250);
  }
  await ctx.close();
}

await browser.close();
const byStep = [...new Set(runs.map((x) => x.step))].map((step) => {
  const rows = runs.filter((x) => x.step === step);
  const values = rows.map((x) => x.mainThreadMs).sort((a, b) => a - b);
  return { step, transition: rows[0].transition, runs: values, median: values[Math.floor(values.length / 2)], max: values.at(-1), overBudget: values.filter((v) => v >= 100).length };
});
writeFileSync(`${outDir}/perf-sequence.json`, JSON.stringify({ product, theme, repeats, runs, byStep }, null, 2));
console.log(JSON.stringify(byStep, null, 2));
console.log('over budget:', runs.filter((x) => x.over).length, 'of', runs.length);

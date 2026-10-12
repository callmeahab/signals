// Fresh performance variants of the round-2 ten-step walk.
// Same instrument as reports/review-r2/perf-sequence.mjs: CDP
// Performance.getMetrics TaskDuration delta around a CDP-dispatched nav click,
// 750 ms settle, 250 ms gap, __SIGNALS_VISUAL_QA__, 1440×1000, no tracing.
// Also records Nodes, LayoutObjects and JSEventListeners after every step.
//
// Default (no args) runs three scenarios against PRODUCT_URL:
//   order  — a different 10-step order, 3 repeats, light
//   walk20 — a 20-step walk, 2 repeats, light
//   dark   — the round-2 order, 3 repeats, dark
//
//   bun ../reports/review-r3/perf-variants.mjs
//   bun ../reports/review-r3/perf-variants.mjs --only ten --repeats 1 --out perf-restored.json
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:27110';
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const only = arg('--only');
const repeatsOverride = arg('--repeats');
const outName = arg('--out') ?? 'perf-variants.json';

const TEN = ['adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live', 'overview', 'adoption', 'reliability'];
// Different order that still includes the two switches round 2 found most expensive
// (live → overview, adoption → reliability), twice for the first of those.
const ORDER = ['protocol', 'sessions', 'live', 'overview', 'adoption', 'reliability', 'cost', 'tools', 'live', 'overview'];
const WALK20 = ['tools', 'cost', 'protocol', 'live', 'overview', 'reliability', 'sessions', 'adoption', 'tools', 'live', 'overview', 'cost', 'adoption', 'reliability', 'protocol', 'sessions', 'live', 'overview', 'tools', 'cost'];

const scenarios = [
  { name: 'order', theme: 'light', repeats: 3, order: ORDER },
  { name: 'walk20', theme: 'light', repeats: 2, order: WALK20 },
  { name: 'dark', theme: 'dark', repeats: 3, order: TEN },
  { name: 'ten', theme: 'light', repeats: 1, order: TEN },
].filter((s) => !only || s.name === only);

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const all = [];

for (const scenario of scenarios) {
  const repeats = repeatsOverride ? Number(repeatsOverride) : scenario.repeats;
  for (let r = 0; r < repeats; r++) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: scenario.theme });
    const page = await ctx.newPage();
    await page.addInitScript((dark) => { globalThis.__SIGNALS_VISUAL_QA__ = true; localStorage.setItem('signals-theme', dark ? 'dark' : 'light'); }, scenario.theme === 'dark');
    await page.goto(product);
    await page.locator('.chart-stacked-area svg').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    let from = 'overview';
    let step = 0;
    for (const screen of scenario.order) {
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
      const row = {
        scenario: scenario.name, theme: scenario.theme, run: r + 1, step,
        transition: `${from} → ${screen}`, mainThreadMs: ms, over: ms >= 100,
        recalcStyleMs: pick('RecalcStyleDuration', 1000), layoutMs: pick('LayoutDuration', 1000),
        scriptMs: pick('ScriptDuration', 1000),
        nodes: after.Nodes, layoutObjects: after.LayoutObjects, listeners: after.JSEventListeners,
      };
      all.push(row);
      console.log(`${scenario.name} r${r + 1} ${String(step).padStart(2)} ${from} → ${screen}: ${ms.toFixed(2)} ms  style ${row.recalcStyleMs.toFixed(2)}  nodes ${row.nodes} layout ${row.layoutObjects} listeners ${row.listeners}${row.over ? '  OVER BUDGET' : ''}`);
      from = screen;
      await page.waitForTimeout(250);
    }
    await ctx.close();
  }
}

await browser.close();
const summary = scenarios.map((scenario) => {
  const rows = all.filter((x) => x.scenario === scenario.name);
  const values = rows.map((x) => x.mainThreadMs).sort((a, b) => a - b);
  const styles = rows.map((x) => x.recalcStyleMs);
  return {
    name: scenario.name, theme: scenario.theme, steps: scenario.order.length,
    n: rows.length, over: rows.filter((x) => x.over).length,
    min: values[0], median: values[Math.floor(values.length / 2)], max: values.at(-1),
    maxStyle: Math.max(...styles),
    nodesStart: rows[0]?.nodes, nodesEnd: rows.at(-1)?.nodes,
    layoutStart: rows[0]?.layoutObjects, layoutEnd: rows.at(-1)?.layoutObjects,
    listenersStart: rows[0]?.listeners, listenersEnd: rows.at(-1)?.listeners,
  };
});
writeFileSync(resolve(outDir, outName), JSON.stringify({ product, summary, runs: all }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('over budget:', all.filter((x) => x.over).length, 'of', all.length);

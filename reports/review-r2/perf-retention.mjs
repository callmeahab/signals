// Why later tab switches cost more: is the growth in Nodes / LayoutObjects /
// JSEventListeners uncollected garbage, or retained state? This walks the nav,
// then forces a GC (CDP HeapProfiler.collectGarbage) and re-reads the counters
// and one more switch, so the two explanations can be told apart.
//
// Run from web/:
//   PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
//     bun ../reports/review-r2/perf-retention.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:26210';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
const page = await ctx.newPage();
await page.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; localStorage.setItem('signals-theme', 'light'); });
await page.goto(product);
await page.locator('.chart-stacked-area svg').waitFor();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('HeapProfiler.enable');
const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const liveDom = () => page.evaluate(() => document.querySelectorAll('*').length);
const click = async (screen) => {
  const box = await page.locator(`nav a[href="#${screen}"]`).boundingBox();
  const before = await metric();
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 });
  }
  await page.waitForTimeout(750);
  const after = await metric();
  return {
    screen,
    mainThreadMs: Math.round((after.TaskDuration - before.TaskDuration) * 1e6) / 1000,
    recalcStyleMs: Math.round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1e6) / 1000,
    nodes: after.Nodes, layoutObjects: after.LayoutObjects, listeners: after.JSEventListeners, liveDom: await liveDom(),
  };
};

const out = { product, walk: [], afterGc: {}, postGcSwitch: null, secondGc: {} };
for (const screen of ['adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live', 'overview']) {
  out.walk.push(await click(screen));
}
out.beforeGc = { ...(await metric()), liveDom: await liveDom() };
await cdp.send('HeapProfiler.collectGarbage');
await page.waitForTimeout(1200);
await cdp.send('HeapProfiler.collectGarbage');
await page.waitForTimeout(1200);
const gc = await metric();
out.afterGc = { Nodes: gc.Nodes, LayoutObjects: gc.LayoutObjects, JSEventListeners: gc.JSEventListeners, Documents: gc.Documents, liveDom: await liveDom() };
out.postGcSwitch = await click('adoption');
await cdp.send('HeapProfiler.collectGarbage');
await page.waitForTimeout(1000);
const gc2 = await metric();
out.secondGc = { Nodes: gc2.Nodes, LayoutObjects: gc2.LayoutObjects, JSEventListeners: gc2.JSEventListeners, liveDom: await liveDom() };

await browser.close();
writeFileSync(`${outDir}/perf-retention.json`, JSON.stringify(out, null, 2));
console.log('walk:');
for (const w of out.walk) console.log(` → ${w.screen.padEnd(12)} ${String(w.mainThreadMs).padStart(8)} ms  style ${String(w.recalcStyleMs).padStart(7)} ms  nodes ${String(w.nodes).padStart(6)}  layoutObjects ${String(w.layoutObjects).padStart(6)}  listeners ${String(w.listeners).padStart(4)}  liveDOM ${w.liveDom}`);
console.log('before GC:', { Nodes: out.beforeGc.Nodes, LayoutObjects: out.beforeGc.LayoutObjects, JSEventListeners: out.beforeGc.JSEventListeners, liveDom: out.beforeGc.liveDom });
console.log('after  GC:', out.afterGc);
console.log('switch after GC:', out.postGcSwitch);
console.log('after 2nd GC:', out.secondGc);

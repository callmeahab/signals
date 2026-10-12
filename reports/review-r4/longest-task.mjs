// Independent longest-task measurement. Does not import performance-qa.mjs.
// Each switch: CDP mouse click, 750 ms settle, TaskDuration delta, and a
// separate Tracing session. The longest task is the maximum complete-event
// duration of RunTask and ThreadControllerImpl::RunTask on CrRendererMain.
// The longest complete event of any name on that thread is recorded beside
// it, so a long task under another name stays visible.
//
//   cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27210 \
//     bun ../reports/review-r4/longest-task.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:27210';
const outDir = resolve(import.meta.dirname);
const budgetMs = 50;
const TEN = ['adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live', 'overview', 'adoption', 'reliability'];
const ORDER = ['protocol', 'sessions', 'live', 'overview', 'adoption', 'reliability', 'cost', 'tools', 'live', 'overview'];
const WALK20 = ['tools', 'cost', 'protocol', 'live', 'overview', 'reliability', 'sessions', 'adoption', 'tools', 'live', 'overview', 'cost', 'adoption', 'reliability', 'protocol', 'sessions', 'live', 'overview', 'tools', 'cost'];
const scenarios = [
  { name: 'order', theme: 'light', repeats: 3, order: ORDER },
  { name: 'walk20', theme: 'light', repeats: 2, order: WALK20 },
  { name: 'dark', theme: 'dark', repeats: 3, order: TEN },
  { name: 'ten', theme: 'light', repeats: 1, order: TEN },
];

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function analyse(traceText) {
  const events = JSON.parse(traceText).traceEvents ?? [];
  const main = new Set(events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
  const onMain = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number' && main.has(`${e.pid}:${e.tid}`));
  const maxDur = (list) => list.reduce((m, e) => (e.dur > m ? e.dur : m), 0);
  const tasks = onMain.filter((e) => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
  const longest = onMain.reduce((m, e) => (e.dur > m.dur ? e : m), { dur: 0, name: null });
  const sum = {};
  const max = {};
  for (const e of onMain) {
    const ms = e.dur / 1000;
    sum[e.name] = (sum[e.name] ?? 0) + ms;
    max[e.name] = Math.max(max[e.name] ?? 0, ms);
  }
  const top = Object.keys(max).sort((a, b) => max[b] - max[a]).slice(0, 12).map((name) => ({
    name, maxMs: round(max[name]), sumMs: round(sum[name]),
  }));
  return {
    rendererMainThreads: main.size,
    taskEvents: tasks.length,
    longestTaskMs: round(maxDur(tasks) / 1000),
    longestRunTaskMs: round(maxDur(onMain.filter((e) => e.name === 'RunTask')) / 1000),
    longestControllerTaskMs: round(maxDur(onMain.filter((e) => e.name === 'ThreadControllerImpl::RunTask')) / 1000),
    longestEvent: { name: longest.name, ms: round(longest.dur / 1000) },
    top,
  };
}

async function readTrace(cdp) {
  const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  const { stream } = await complete;
  let trace = '';
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream });
    trace += chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  return trace;
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const rows = [];
let cause = null;
try {
  for (const scenario of scenarios) {
    for (let r = 0; r < scenario.repeats; r++) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: scenario.theme });
      await page.addInitScript((theme) => {
        globalThis.__SIGNALS_VISUAL_QA__ = true;
        globalThis.localStorage.setItem('signals-theme', theme);
      }, scenario.theme);
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
        await cdp.send('Tracing.start', {
          categories: 'devtools.timeline,toplevel',
          transferMode: 'ReturnAsStream',
        });
        for (const type of ['mousePressed', 'mouseReleased']) {
          await cdp.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 });
        }
        await page.waitForTimeout(750);
        const after = await metric();
        const href = await page.locator('nav a[aria-current=page]').getAttribute('href');
        const trace = await readTrace(cdp);
        const parsed = analyse(trace);
        const mainThreadMs = round((after.TaskDuration - before.TaskDuration) * 1000);
        const row = {
          scenario: scenario.name, theme: scenario.theme, run: r + 1, step,
          transition: `${from} → ${screen}`,
          landed: href === `#${screen}`,
          mainThreadMs,
          recalcStyleMs: round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000),
          layoutMs: round((after.LayoutDuration - before.LayoutDuration) * 1000),
          scriptMs: round((after.ScriptDuration - before.ScriptDuration) * 1000),
          ...parsed,
          over: parsed.longestTaskMs >= budgetMs,
        };
        rows.push(row);
        console.log(`${scenario.name} r${r + 1} ${String(step).padStart(2)} ${row.transition}: aggregate ${mainThreadMs.toFixed(2)} ms  longest ${parsed.longestTaskMs.toFixed(2)} ms  event ${parsed.longestEvent.name} ${parsed.longestEvent.ms.toFixed(2)}${row.over ? '  OVER' : ''}`);
        if (row.transition === 'live → overview' && (cause == null || row.mainThreadMs > cause.mainThreadMs)) {
          cause = { ...row, traceBytes: trace.length };
          writeFileSync(resolve(outDir, 'live-overview-trace.json.gz'), gzipSync(Buffer.from(trace)));
        }
        from = screen;
        await page.waitForTimeout(250);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const values = rows.map((r) => r.longestTaskMs).sort((a, b) => a - b);
const aggregates = rows.map((r) => r.mainThreadMs).sort((a, b) => a - b);
const summary = {
  product, budgetMs, switches: rows.length,
  over: rows.filter((r) => r.over).length,
  longestTaskMin: values[0],
  longestTaskMedian: values[Math.floor(values.length / 2)],
  longestTaskMax: values.at(-1),
  aggregateMin: aggregates[0],
  aggregateMedian: aggregates[Math.floor(aggregates.length / 2)],
  aggregateMax: aggregates.at(-1),
  filterMisses: rows.filter((r) => r.longestEvent.ms > r.longestTaskMs + 1).map((r) => ({
    transition: r.transition, scenario: r.scenario, run: r.run, step: r.step,
    longestTaskMs: r.longestTaskMs, longestEvent: r.longestEvent,
  })),
  byScenario: scenarios.map((s) => {
    const mine = rows.filter((r) => r.scenario === s.name);
    const task = mine.map((r) => r.longestTaskMs).sort((a, b) => a - b);
    const agg = mine.map((r) => r.mainThreadMs).sort((a, b) => a - b);
    return {
      name: s.name, theme: s.theme, n: mine.length,
      over: mine.filter((r) => r.over).length,
      longestTaskMax: task.at(-1),
      aggregateMedian: agg[Math.floor(agg.length / 2)],
      aggregateMax: agg.at(-1),
    };
  }),
};
writeFileSync(resolve(outDir, 'longest-task.json'), JSON.stringify({ summary, cause, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`over budget: ${summary.over} of ${summary.switches}`);
if (summary.over > 0) process.exitCode = 1;

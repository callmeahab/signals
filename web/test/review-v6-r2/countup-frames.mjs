// Review round 2 (reviews/dash-v6-r2.md): the count-up assertions in
// `scripts/choreography-qa.mjs` that read sampled frames rather than scheduled values.
//
//   check(values[0] === 0, …)                  // the first sample must be "0"
//   check(samples.length >= 3, `… reached ${last.text} in ${samples.length} step(s),
//                                which is not a climb`)
//   check(climbing.length > 0, `${where}: no tile counted up`)
//
// `Count` in packages/ui/src/analytics-v3.tsx tweens on a requestAnimationFrame clock, so
// the number of *distinct headline texts* a run observes is a function of the renderer's
// frame rate during the 640 ms climb, not of anything the page scheduled. This probe
// reproduces that with CDP CPU throttling, which is deterministic, and reports the step
// count and the frame rate achieved at each rate.
//
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
//     bun test/review-v6-r2/countup-frames.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const rates = (process.env.THROTTLE_RATES ?? '1,4,8,12,20').split(',').map(Number);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

// The same sampler choreography-qa.mjs installs: a frame loop that records each tile
// headline whenever its text changes.
const recordCounts = () => {
  globalThis.__counts = [];
  const last = new Map();
  let until = globalThis.performance.now() + 4000;
  globalThis.__frames = 0;
  const tick = () => {
    globalThis.__frames++;
    for (const tile of document.querySelectorAll('.tiles > .tile')) {
      const label = tile.querySelector('.tile__label span')?.textContent?.trim() ?? null;
      const text = tile.querySelector('.tile__value strong')?.textContent ?? null;
      if (label == null || text == null) continue;
      if (last.get(label) === text) continue;
      last.set(label, text);
      globalThis.__counts.push({ label, text, at: Math.round(globalThis.performance.now()) });
    }
    if (globalThis.performance.now() < until) globalThis.requestAnimationFrame(tick);
  };
  tick();
};

const results = [];
try {
  for (const rate of rates) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
    await context.addInitScript(recordCounts);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(`${base}/#overview`);
    await page.getByRole('heading', { name: 'Calls by client' }).waitFor({ timeout: 120000 });
    await page.waitForTimeout(4500 * Math.max(1, rate / 4));
    const { counts, frames } = await page.evaluate(() => ({ counts: globalThis.__counts ?? [], frames: globalThis.__frames ?? 0 }));
    const perLabel = new Map();
    for (const row of counts) perLabel.set(row.label, (perLabel.get(row.label) ?? 0) + 1);
    const steps = [...perLabel.entries()].map(([label, n]) => ({ label, steps: n }));
    const climbing = steps.filter(s => s.steps >= 3);
    const openedAtZero = [...new Set(counts.map(c => c.label))].every(label => /^0%?$/.test(counts.find(c => c.label === label).text));
    const row = { rate, fps: Math.round(frames / 4), steps: steps.map(s => `${s.label}:${s.steps}`), tilesWithThreeSteps: climbing.length, openedAtZero };
    results.push(row);
    console.log(`     ${JSON.stringify(row)}`);
    await context.close();
  }
} finally { await browser.close(); }

const broken = results.filter(r => r.tilesWithThreeSteps === 0);
const degraded = results.filter(r => r.steps.some(s => Number(s.split(':')[1]) < 3));
console.log(`     step counts collapse below 3 from ${degraded[0]?.rate ?? 'no'}x throttling; every tile collapses from ${broken[0]?.rate ?? 'no'}x`);
check(degraded.length === 0,
  `the sampled step count stays at or above the 3 that choreography-qa.mjs requires at every CPU rate: ${JSON.stringify(results, null, 1)}`);

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r2 countup-frames probe passed');

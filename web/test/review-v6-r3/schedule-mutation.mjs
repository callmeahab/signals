// Review round 3 (reviews/dash-v6-r3.md): the round-2 fix made the choreography gate's
// observational checks conditional on 20 fps. The claim that matters is the other half —
// that the *scheduled* assertions stay exact and still bite. `scripts/count-sampling-qa.mjs`
// proves that against synthetic snapshots; this proves it against the real page, by
// serving a mutated `@mcpramen/signals-ui` build in which one scheduled number is wrong
// and showing that `checkCounts` fails on a snapshot taken from that page.
//
// Nothing in the worktree is modified: the mutation is a response rewrite inside this
// browser context only.
//
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
//     bun test/review-v6-r3/schedule-mutation.mjs
import { chromium } from '@playwright/test';
import { recordCounts, checkCounts } from '../../scripts/count-sampling.mjs';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

// Each mutation breaks exactly one scheduled or terminal fact the gate claims to assert.
const MUTATIONS = [
  { name: 'count duration 640 -> 500', from: 'const duration = first ? 640 : 300;', to: 'const duration = first ? 500 : 300;', expect: /count schedule/ },
  { name: 'tile stagger 55 -> 60', file: '**/motion.js*', from: 'export const tileDelay = (index) => 130 + Math.max(0, index) * 55;', to: 'export const tileDelay = (index) => 130 + Math.max(0, index) * 60;', expect: /count schedule/ },
  { name: 'terminal value off by one', from: 'const at = from + (value - from) * eased;', to: 'const at = from + (value - from) * eased - (k === 1 ? 1 : 0);', expect: /terminal value/ },
];

const snapshotWith = async mutation => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
  await context.addInitScript(recordCounts);
  let patched = 0;
  if (mutation) {
    await context.route(mutation.file ?? '**/analytics-v3.js*', async route => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes(mutation.from)) patched++;
      await route.fulfill({ response, body: body.replaceAll(mutation.from, mutation.to) });
    });
  }
  const page = await context.newPage();
  await page.goto(`${base}/#overview`);
  await page.getByRole('heading', { name: 'Calls by client' }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  const snapshot = await page.evaluate(() => globalThis.__countSnapshot());
  await context.close();
  return { snapshot, patched };
};

const errorsFor = snapshot => {
  const errors = [];
  checkCounts('mutation', snapshot, snapshot.tiles.map((tile, i) => ({ label: tile.label, delay: 130 + 55 * i })),
    (ok, message) => { if (!ok) errors.push(message); });
  return errors;
};

try {
  const baseline = await snapshotWith(null);
  const baseErrors = errorsFor(baseline.snapshot);
  check(baseErrors.length === 0, `the unmutated page passes every scheduled, monotonic and terminal check: ${JSON.stringify(baseErrors)}`);
  check(baseline.snapshot.tiles.every(t => Number.isFinite(t.delay) && t.duration === 640 && t.target),
    `every tile publishes its scheduled delay, 640 ms duration and formatted target: ${JSON.stringify(baseline.snapshot.tiles.map(t => ({ l: t.label, d: t.delay, u: t.duration, t: t.target })))}`);

  for (const mutation of MUTATIONS) {
    const { snapshot, patched } = await snapshotWith(mutation);
    check(patched > 0, `${mutation.name}: the mutation was applied to the served module (${patched} responses)`);
    const errors = errorsFor(snapshot);
    check(errors.some(e => mutation.expect.test(e)),
      `${mutation.name}: the gate still fails on it — expected ${mutation.expect}, got ${JSON.stringify(errors)}`);
  }
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r3 schedule-mutation probe passed');

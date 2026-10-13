// Review round 2: exercise the same schedule, sample quality and terminal-value
// assertions as choreography under CDP throttling. Low frame rates may hide steps;
// they must never excuse a wrong duration, backwards count or wrong terminal value.
// THROTTLE_RATES=1,8,20 selects the requested acceptance rates.
import { recordCounts, checkCounts } from '../../scripts/count-sampling.mjs';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const rates = (process.env.THROTTLE_RATES ?? '1,4,8,12,20').split(',').map(Number);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

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
    const snapshot = await page.evaluate(() => globalThis.__countSnapshot());
    const rows = checkCounts(`${rate}x`, snapshot, snapshot.tiles.map((tile, i) => ({ label: tile.label, delay: 130 + 55 * i })), check);
    results.push({ rate, rows });
    await context.close();
  }
} finally { await browser.close(); }

console.log(JSON.stringify(results));

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r2 countup-frames probe passed');

// Review round 2 (reviews/dash-v6-r2.md), fresh variant of B1: a failing *supporting*
// route on a *range* change. Round 1 covered a failing supporting route on a project
// change and a failing primary route on a range change; this is the remaining corner,
// and it is the one `useQuery`'s `answerVersion` has to get right for a dependency that
// is not the project.
//
// Fix brief B1: "a failed supporting read shows its own notice inside the cards it feeds
// and those cards render their empty/error frame, never another project's data."
//
//   VITE_DEMO=1 bun node_modules/vite/bin/vite.js --config apps/dashboard/vite.config.ts \
//     --host 127.0.0.1 --port 23336 &
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
//     bun test/review-v6-r2/supporting-range.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

const legendRows = page => page.locator('.client-mix .legendlist .r').count();
const donuts = page => page.locator('.client-mix .v3-chart').count();
const sparkRows = (page, label) => page.evaluate(name => {
  const tile = [...document.querySelectorAll('.tile')].find(el => el.querySelector('.tile__label span')?.textContent?.trim() === name);
  return [...(tile?.querySelectorAll('table tbody tr') ?? [])].map(tr => tr.lastElementChild?.textContent?.trim());
}, label);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  // `adoption` answers for 7 days and then fails for every later request, so the first
  // paint is real and only the range change is broken.
  await context.route('**/src/demo.ts*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: `${body}
const originalAnalytics=demoClient.analytics;
demoClient.analytics=async(...args)=>{if(globalThis.__failAdoption&&args[1]==='adoption')throw new Error('Injected adoption failure');return originalAnalytics(...args);};` });
  });
  const page = await context.newPage();
  await page.goto(`${base}/#overview`);
  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await page.locator('.tile__value strong').first().waitFor();
  await page.waitForTimeout(800);

  const beforeRows = await legendRows(page);
  const beforeSpark = await sparkRows(page, 'Active users');
  check(beforeRows === 3 && beforeSpark.length > 0, `the 7-day answer is painted first: ${beforeRows} legend rows, ${beforeSpark.length} Active users trend rows`);

  await page.evaluate(() => { globalThis.__failAdoption = true; });
  await page.getByRole('button', { name: '90 days' }).click();
  await page.waitForTimeout(1500);

  const pressed = await page.locator('.range-control button[aria-pressed=true]').textContent();
  const afterRows = await legendRows(page);
  const afterDonuts = await donuts(page);
  const afterSpark = await sparkRows(page, 'Active users');
  const notices = await page.locator('.signals-ui .notice[role=alert]').allTextContents();
  console.log(`     range=${JSON.stringify(pressed)} legend ${beforeRows} -> ${afterRows}, donuts ${afterDonuts}, Active users trend rows ${beforeSpark.length} -> ${afterSpark.length}`);
  console.log(`     notices: ${JSON.stringify(notices)}`);

  check(afterRows === 0 && afterDonuts === 0,
    `range ${pressed}: the Client mix card does not still show the 7-day answer (${afterRows} legend rows, ${afterDonuts} donuts)`);
  check(afterSpark.length === 0,
    `range ${pressed}: the Active users trend does not still show the 7-day series (${afterSpark.length} rows: ${JSON.stringify(afterSpark.slice(0, 3))})`);
  check(notices.length > 0 && notices.every(text => /adoption/i.test(text)),
    `range ${pressed}: every surface the failed adoption read feeds says so (${notices.length} notices)`);
  check(notices.every(text => !/previous answer/i.test(text)),
    `range ${pressed}: no notice offers the previous range's answer: ${JSON.stringify(notices)}`);

  // The primary answer for the new range is real, so the tiles it owns must be the new
  // range's, not blanked by the supporting failure.
  const toolCalls = await page.evaluate(() => [...document.querySelectorAll('.tile')]
    .find(el => el.querySelector('.tile__label span')?.textContent?.trim() === 'Tool calls')
    ?.querySelector('.tile__value strong')?.textContent?.trim());
  check(typeof toolCalls === 'string' && toolCalls !== 'No data yet',
    `range ${pressed}: the primary answer still paints its own tiles (Tool calls reads ${JSON.stringify(toolCalls)})`);

  await context.close();
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r2 supporting-range probe passed');

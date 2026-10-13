// Review round 3 (reviews/dash-v6-r3.md): S1's fresh variant. The round-2 probe
// (`test/review-v6-r2/supporting-blanking.mjs`) breaks the `tools` read on the Overview
// screen with a range change. This one changes all three axes: a different screen (Cost),
// a different trigger (a project switch) and a second failed route (`adoption` on
// Overview), so that the `support:'trend'`/`support:'caption'` scoping is exercised where
// the round-2 probe never looked.
//
// Fix brief S1: "`SupportFrame` must not blank headline numbers that the primary answer
// carries; only the parts fed by the failed supporting read (sparkline, caption fragment)
// show the error state."
//
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
//     bun test/review-v6-r3/support-scope.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

const tiles = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tile')].map(tile => [
  tile.querySelector('.tile__label span')?.textContent?.trim(),
  {
    headline: tile.querySelector('.tile__value strong')?.textContent?.trim() ?? null,
    caption: tile.querySelector('.tile__meta')?.textContent?.trim() ?? null,
    // Where the error frame sits is the whole question: before `.tile__value` would
    // mean the headline was replaced, after it means only a dependent fragment was.
    errorBeforeHeadline: (() => {
      const error = tile.querySelector('.support-error'), value = tile.querySelector('.tile__value');
      if (!error) return false;
      if (!value) return true;
      return !!(error.compareDocumentPosition(value) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING);
    })(),
    errorFrames: tile.querySelectorAll('.support-error').length,
    trend: !!tile.querySelector('.tile__spark svg'),
    notices: tile.querySelectorAll('.notice[role=alert]').length,
  }])));

const open = async (route, armed) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  await context.route('**/src/demo.ts*', async handler => {
    const response = await handler.fetch();
    const body = await response.text();
    await handler.fulfill({ response, body: `${body}
globalThis.__failRead=${armed};
const originalAnalytics=demoClient.analytics;
demoClient.analytics=async(...args)=>{if(globalThis.__failRead&&args[1]===${JSON.stringify(route)})throw new Error('Injected ${route} failure');return originalAnalytics(...args);};` });
  });
  const page = await context.newPage();
  return { context, page };
};

try {
  // (a) Cost screen, a failed `tools` read, triggered by a project switch.
  {
    const { context, page } = await open('tools', false);
    await page.goto(`${base}/#cost`);
    await page.locator('.tile__value strong').first().waitFor();
    await page.waitForTimeout(900);
    const before = await tiles(page);
    await page.evaluate(() => { globalThis.__failRead = true; });
    await page.locator('.project-card').nth(1).click();
    await page.waitForTimeout(1800);
    const after = await tiles(page);
    const selected = await page.locator('.project-card.is-selected .project-card__name').textContent();
    console.log(`     cost after switching to ${JSON.stringify(selected)}: ${JSON.stringify(after)}`);

    // `cost.tile.context-tokens` is the only Cost tile `feedFor` maps to `tools`; its
    // headline is `d.total_tokens_est` from the primary cost answer.
    const tokens = after['Context tokens'];
    check(tokens && !tokens.errorBeforeHeadline && tokens.headline && tokens.headline !== 'No data yet',
      `Cost / Context tokens keeps the primary token total after a failed tools read on a project switch: ${JSON.stringify(tokens)}`);
    check(tokens && tokens.notices > 0, `Cost / Context tokens says which read failed: ${tokens?.notices} notices`);
    check(tokens && !tokens.trend, `Cost / Context tokens shows no trend from the failed read: trend=${tokens?.trend}`);
    for (const label of ['Per call', 'Heaviest tool', 'Tenants', 'Largest payload', 'Billing period']) {
      const tile = after[label];
      check(tile && tile.errorFrames === 0 && tile.notices === 0,
        `Cost / ${label} is untouched by a failed tools read: ${JSON.stringify(tile)}`);
    }
    check(Object.keys(before).length === Object.keys(after).length,
      `the Cost screen still shows all ${Object.keys(before).length} tiles`);
    await context.close();
  }

  // (b) Overview, a failed `adoption` read, triggered by a project switch. Active users
  // and Sessions are `support:'trend'`; their headlines and captions are primary.
  {
    const { context, page } = await open('adoption', false);
    await page.goto(`${base}/#overview`);
    await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
    await page.waitForTimeout(900);
    await page.evaluate(() => { globalThis.__failRead = true; });
    await page.locator('.project-card').nth(1).click();
    await page.waitForTimeout(1800);
    const after = await tiles(page);
    console.log(`     overview after a failed adoption read: ${JSON.stringify(after)}`);
    for (const label of ['Active users', 'Sessions']) {
      const tile = after[label];
      check(tile && !tile.errorBeforeHeadline && tile.headline && tile.headline !== 'No data yet',
        `Overview / ${label} keeps the primary headline after a failed adoption read: ${JSON.stringify(tile)}`);
      check(tile && tile.caption && !/^$/.test(tile.caption),
        `Overview / ${label} keeps its primary caption: ${JSON.stringify(tile?.caption)}`);
      check(tile && tile.notices > 0 && !tile.trend,
        `Overview / ${label} replaces only its adoption-fed trend: ${JSON.stringify(tile)}`);
    }
    for (const label of ['Tool calls', 'Tool success', 'p95 latency', 'Context tokens']) {
      const tile = after[label];
      check(tile && tile.notices === 0 && tile.errorFrames === 0,
        `Overview / ${label} is untouched by a failed adoption read: ${JSON.stringify(tile)}`);
    }
    await context.close();
  }
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r3 support-scope probe passed');

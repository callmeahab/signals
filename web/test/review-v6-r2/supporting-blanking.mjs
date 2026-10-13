// Review round 2 (reviews/dash-v6-r2.md): the round-1 B1 fix routes every supporting
// read to the surfaces it feeds and renders "their empty/error frame" when it fails.
// `SupportFrame` in packages/ui/src/analytics-v3.tsx wraps a tile's whole body, but an
// Overview tile's headline comes from the *primary* overview answer — only its sparkline
// and part of its caption come from the supporting read. A failed `tools` read therefore
// blanks three headline numbers the page successfully loaded.
//
// `feedFor` maps 'overview.tile.tool-calls', 'overview.tile.tool-success' and
// 'overview.tile.context-tokens' to ['tools'], while their values are
// `d.tiles.tool_calls.value`, `d.tiles.success_rate.value` and
// `d.tiles.context_tokens.value` from the primary answer.
//
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
//     bun test/review-v6-r2/supporting-blanking.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

const headlines = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tile')]
  .map(tile => [tile.querySelector('.tile__label span')?.textContent?.trim(),
    tile.querySelector('.tile__value strong')?.textContent?.trim() ?? (tile.querySelector('.support-error') ? '<support-error>' : null)])));

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  await context.route('**/src/demo.ts*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: `${body}
const originalAnalytics=demoClient.analytics;
demoClient.analytics=async(...args)=>{if(globalThis.__failTools&&args[1]==='tools')throw new Error('Injected tools failure');return originalAnalytics(...args);};` });
  });
  const page = await context.newPage();
  await page.goto(`${base}/#overview`);
  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await page.locator('.tile__value strong').first().waitFor();
  await page.waitForTimeout(800);
  const before = await headlines(page);

  await page.evaluate(() => { globalThis.__failTools = true; });
  await page.getByRole('button', { name: '90 days' }).click();
  await page.waitForTimeout(1500);
  const after = await headlines(page);

  // The primary overview answer for 90 days succeeded: its own tiles prove it.
  check(after['Active users'] && after['Active users'] !== '<support-error>',
    `the primary 90-day answer painted (Active users reads ${JSON.stringify(after['Active users'])})`);
  console.log(`     before: ${JSON.stringify(before)}`);
  console.log(`     after : ${JSON.stringify(after)}`);

  for (const label of ['Tool calls', 'Tool success', 'Context tokens']) {
    check(after[label] !== '<support-error>' && after[label] != null,
      `${label}: the headline the primary overview answer carries survives a failed supporting \`tools\` read; got ${JSON.stringify(after[label])}`);
  }
  await context.close();
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r2 supporting-blanking probe passed');

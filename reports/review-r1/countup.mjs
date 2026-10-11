// 40 ms samples of the overview count-up, then protocol dot fill attributes.
// PRODUCT_URL=http://127.0.0.1:PORT bun reports/review-r1/countup.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
const base = process.env.PRODUCT_URL || 'http://127.0.0.1:26110';
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference' });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('signals-theme','light'));
await page.goto(base + '/#overview', { waitUntil: 'commit' });
const samples = [];
for (let i = 0; i < 16; i++) {
  const t = await page.locator('.tile__value strong').first().innerText().catch(() => 'na');
  samples.push(t);
  await page.waitForTimeout(40);
}
const numeric=samples.map(v=>Number(v.replace('K',''))*(v.endsWith('K')?1000:1));assert(numeric.every((v,i)=>Number.isFinite(v)&&v>=0&&(!i||v>=numeric[i-1])),'count-up must be non-negative and monotone');
const dots = await page.evaluate(() => {
  location.hash = 'protocol';
});
await page.waitForTimeout(600);
const colors = await page.evaluate(() => {
  const grids = [...document.querySelectorAll('[data-chart="dot-grid"]')];
  return grids.map(g => {
    const circles = [...g.querySelectorAll('circle')];
    const fills = circles.map(c => c.getAttribute('fill'));
    const computed = [...new Set(circles.map(c => getComputedStyle(c).fill))].slice(0, 6);
    return { label: g.getAttribute('aria-label'), n: circles.length, attr: [...new Set(fills)], computed };
  });
});
console.log(JSON.stringify({ samples, colors }, null, 2));
await browser.close();

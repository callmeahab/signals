// Sankey node-rect heights, heatmap monotonicity, protocol dot colours, hover.
// Run against a VITE_DEMO=1 server: PRODUCT_URL=http://127.0.0.1:PORT bun reports/review-r1/followup.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
const base = process.env.PRODUCT_URL || 'http://127.0.0.1:26110';
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('signals-theme', 'light'));
await page.goto(base + '/#overview', { waitUntil: 'commit' });
await page.waitForTimeout(80);
const early = await page.locator('.tile__value strong').first().innerText().catch(() => 'missing');
await page.waitForTimeout(800);
const late = await page.locator('.tile__value strong').first().innerText();
const motion = await page.evaluate(() => {
  const tile = document.querySelector('.tile');
  const card = document.querySelector('.card');
  return {
    tileAnim: getComputedStyle(tile).animationDuration + ' ' + getComputedStyle(tile).animationName,
    cardAnim: getComputedStyle(card).animationDuration + ' delay ' + getComputedStyle(card).animationDelay,
  };
});
const card = page.locator('.card').first();
const before = await card.evaluate(el => getComputedStyle(el).transform);
await card.hover();
await page.waitForTimeout(250);
const after = await card.evaluate(el => ({ transform: getComputedStyle(el).transform, shadow: getComputedStyle(el).boxShadow.slice(0, 80) }));
await page.goto(base + '/#tools');
await page.locator('[data-chart="sankey"] svg').waitFor();
await page.waitForTimeout(400);
const sankey = await page.evaluate(() => {
  const svg = document.querySelector('[data-chart="sankey"] svg');
  const nodes = [...svg.querySelectorAll('rect')].map(r => {
    const text = [...svg.querySelectorAll('text')].find(t => Math.abs(Number(t.getAttribute('y')) - (r.y.baseVal.value + r.height.baseVal.value / 2)) < 8);
    return { name: text?.textContent.trim() || '', h: Math.round(r.height.baseVal.value * 10) / 10, y: Math.round(r.y.baseVal.value) };
  });
  return nodes;
});
await page.goto(base + '/#protocol');
await page.locator('[data-chart="dot-grid"]').first().waitFor();
const dots = await page.evaluate(() => {
  const grids = [...document.querySelectorAll('[data-chart="dot-grid"]')];
  return grids.map(g => {
    const label = g.getAttribute('aria-label');
    const fills = [...g.querySelectorAll('circle')].slice(0, 3).map(c => getComputedStyle(c).fill);
    const on = [...g.querySelectorAll('circle')].filter(c => getComputedStyle(c).fill !== getComputedStyle(document.querySelector('[data-chart="dot-grid"] circle')).fill);
    const colors = [...new Set([...g.querySelectorAll('circle')].map(c => getComputedStyle(c).fill))];
    return { label, colors };
  });
});
const heat = await page.evaluate(async () => {
  location.hash = 'overview';
  await new Promise(r => setTimeout(r, 500));
  const svg = document.querySelector('[data-chart="heatmap"] svg');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { ctx.clearRect(0,0,1,1); ctx.fillStyle = c; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data].slice(0,3); };
  const accent = rgb(getComputedStyle(document.documentElement).getPropertyValue('--chart-3'));
  const dist = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
  const rects = [...svg.querySelectorAll('rect')];
  const cells = [...svg.querySelectorAll('text')].filter(t => /%|–/.test(t.textContent)).map(t => {
    const x = Number(t.getAttribute('x'));
    const rect = rects.reduce((best, r) => {
      const cx = Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2;
      const d = Math.abs(cx - x);
      return d < best.d ? { d, r } : best;
    }, { d: 1e9, r: null }).r;
    const fill = rect ? rgb(getComputedStyle(rect).fill) : null;
    return { label: t.textContent.trim(), dist: fill ? Math.round(dist(fill, accent)) : null };
  });
  const nums = cells.filter(c => c.label.endsWith('%')).map(c => ({ pct: Number(c.label.replace('%','')), dist: c.dist }));
  let inversions = 0;
  const sorted = [...nums].sort((a,b) => a.pct - b.pct);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].dist > sorted[i-1].dist + 2) inversions++;
  return { nums, inversions };
});
console.log(JSON.stringify({ early, late, motion, before, after, sankey, dots, heat }, null, 2));
await browser.close();

// Histogram markers and chart inventory after bar layers moved out of the chart SVG.
// The round-1 fidelity probe still looks for rect.growy inside the first svg and throws.
//
//   cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27210 \
//     bun ../reports/review-r4/markers.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:27210';
const screens = ['overview', 'adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live'];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; localStorage.setItem('signals-theme', 'light'); });
const inventory = {};
for (const screen of screens) {
  await page.goto(`${product}/#${screen}`);
  await page.locator('h1').waitFor();
  await page.waitForTimeout(400);
  inventory[screen] = await page.evaluate(() => [...document.querySelectorAll('[data-chart]')].map((el) => el.getAttribute('data-chart')));
}
await page.goto(`${product}/#tools`);
await page.locator('[data-chart="histogram"]').waitFor();
await page.waitForTimeout(600);
const histogram = await page.evaluate(() => {
  const hist = document.querySelector('[data-chart="histogram"]');
  const svg = hist.querySelector('svg[role=img]');
  const bars = [...hist.querySelectorAll('svg.growy')].map((layer) => ({
    x: parseFloat(layer.style.left),
    width: parseFloat(layer.getAttribute('width')),
    height: parseFloat(layer.getAttribute('height')),
  }));
  const rows = [...hist.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  const lo0 = Number(rows[0][0]);
  const lowers = rows.map((r) => Number(r[0]));
  const hi = lowers.at(-1) * 1.26;
  const x0 = bars[0].x;
  const x1 = bars.at(-1).x + bars.at(-1).width;
  const lx = (v) => x0 + (Math.log(v) - Math.log(lo0)) / (Math.log(hi) - Math.log(lo0)) * (x1 - x0);
  const markers = [...svg.querySelectorAll('g.popin')].map((g) => {
    const line = g.querySelector('line');
    const label = g.querySelector('text')?.textContent.trim();
    const value = Number(label?.replace(/,/g, '').match(/[\d.]+$/)?.[0]);
    const x = Number(line?.getAttribute('x1'));
    return { label, value, x: Math.round(x * 10) / 10, expected: Math.round(lx(value) * 10) / 10, delta: Math.round((x - lx(value)) * 10) / 10 };
  });
  const counts = rows.map((r) => Number(r[2].replace(/,/g, '')));
  const maxC = Math.max(...counts);
  const maxH = Math.max(...bars.map((b) => b.height));
  const heightOff = counts.reduce((n, c, i) => n + (Math.abs(bars[i].height - maxH * c / maxC) > 1 ? 1 : 0), 0);
  return { markers, rows: rows.length, bars: bars.length, gridlines: hist.querySelectorAll('line.gridline').length, heightOff, x0, x1 };
});
const report = { product, inventory, histogram };
writeFileSync(resolve(import.meta.dirname, 'markers.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

// Round-2 geometry check for the charts the round-1 fix pass added or rewired:
// the Adoption conversion curve and identity donut, the Cost context-token tile
// sparkline, the two Live sparklines and the event-mix bars, and the Reliability
// latency band (including the sparse gaps the fix brief asked to preserve).
// Every drawn number is compared with that chart's own sr-only table twin.
//
// Run from web/:
//   PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
//     bun ../reports/review-r2/geometry.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:26210';
const out = {};
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('signals-theme', 'light'));

async function open(screen) {
  await page.goto(`${product}/#${screen}`, { waitUntil: 'networkidle' });
  await page.locator('h1').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);
}

await open('adoption');
out.conversion = await page.evaluate(() => {
  const chart = document.querySelector('[data-chart="line"]');
  if (!chart) return { missing: true };
  const rows = [...chart.querySelectorAll('table.sr-only tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  const counts = rows.map((r) => Number(r[1].replace(/,/g, '')));
  const shares = rows.map((r) => Number(r[2].replace('%', '')));
  const circles = [...chart.querySelectorAll('svg circle')].map((c) => ({ cx: Number(c.getAttribute('cx')), cy: Number(c.getAttribute('cy')) }));
  const drawn = [...chart.querySelectorAll('svg text')].map((t) => t.textContent.trim()).filter((t) => /%$/.test(t));
  const base = counts[0];
  const expectedShare = counts.map((c) => Math.round(c / base * 1000) / 10);
  // y = 190 - share * 1.7 in the renderer; recover the share from the pixel.
  const recovered = circles.map((c) => Math.round((190 - c.cy) / 1.7 * 10) / 10);
  return { rows, counts, shares: shares.map((s) => Math.round(s * 10) / 10), expectedShare, drawnLabels: drawn, recoveredFromPixels: recovered, monotoneX: circles.every((c, i) => !i || c.cx > circles[i - 1].cx) };
});
out.identityDonut = await page.evaluate(() => {
  const chart = document.querySelector('[data-chart="donut"]');
  const rows = [...chart.querySelectorAll('table.sr-only tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  const values = rows.map((r) => Number(r[1].replace(/,/g, '')));
  const total = values.reduce((s, n) => s + n, 0);
  const texts = [...chart.querySelectorAll('svg text')].map((t) => t.textContent.trim());
  const arcs = [...chart.querySelectorAll('svg path, svg circle')].map((p) => ({ stroke: p.getAttribute('stroke'), fill: p.getAttribute('fill'), dash: p.getAttribute('stroke-dasharray') }));
  const legend = [...document.querySelectorAll('.legendlist .r')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
  return { label: chart.querySelector('svg').getAttribute('aria-label'), rows, total, strongPct: Math.round(values[0] / total * 100), centreTexts: texts, arcs: arcs.slice(0, 6), legend };
});
out.adoptionBars = await page.evaluate(() => [...document.querySelectorAll('[data-chart="bars"]')].map((b) => {
  const rows = [...b.querySelectorAll('table.sr-only tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  const fills = [...b.querySelectorAll('svg rect')].filter((r) => r.getAttribute('fill') !== 'var(--viz-track)');
  const widths = fills.map((r) => Math.round(r.width.baseVal.value * 10) / 10);
  const values = rows.map((r) => Number(r[1].replace(/,/g, '')));
  const max = Math.max(...values);
  return { label: b.querySelector('svg').getAttribute('aria-label')?.split('.')[0], rows, widths, proportional: values.map((v, i) => ({ v, w: widths[i], expected: Math.round(widths[0] / values[0] * v * 10) / 10 })), max };
}));

await open('cost');
out.costSparkline = await page.evaluate(() => {
  const tile = [...document.querySelectorAll('.tile')].find((t) => /Context tokens/i.test(t.textContent));
  const spark = tile.querySelector('[data-chart="sparkline"]');
  const rows = [...spark.querySelectorAll('table.sr-only tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  const values = rows.map((r) => Number(r[1].replace(/,/g, '')));
  const d = spark.querySelector('svg path')?.getAttribute('d') ?? '';
  const ys = [...d.matchAll(/[ML]\s*([\d.]+),([\d.]+)/g)].map((m) => Number(m[2]));
  const lo = Math.min(...values), hi = Math.max(...values);
  const recovered = ys.map((y, i) => ({ y, value: values[i] }));
  return { points: rows.length, values, hasNaN: /NaN/.test(d), pathPoints: ys.length, lo, hi, firstRows: rows.slice(0, 3), pixelOrderMatchesValues: recovered.every((p, i) => i === 0 || (values[i] >= values[i - 1]) === (ys[i] <= ys[i - 1]) || values[i] === values[i - 1]) };
});
out.payload = await page.evaluate(() => {
  const chart = [...document.querySelectorAll('[data-chart="bars"]')].find((c) => /Payload/i.test(c.querySelector('svg')?.getAttribute('aria-label') ?? ''));
  const legend = [...document.querySelectorAll('.legend')].map((l) => ({ text: l.innerText.replace(/\s+/g, ' ').trim(), swatches: [...l.querySelectorAll('i')].map((i) => ({ attr: i.style.background, computed: getComputedStyle(i).backgroundColor })) }));
  const fills = [...new Set([...chart.querySelectorAll('svg rect.growy')].map((r) => r.getAttribute('fill')))];
  const rows = [...chart.querySelectorAll('table.sr-only tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  return { fills, legend, rows: rows.slice(0, 4), rowCount: rows.length };
});

await open('live');
out.live = await page.evaluate(() => {
  const charts = [...document.querySelectorAll('[data-chart]')].map((c) => {
    const rows = [...c.querySelectorAll('table.sr-only tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    const d = [...c.querySelectorAll('svg path')].map((p) => p.getAttribute('d') ?? '');
    return {
      kind: c.getAttribute('data-chart'),
      label: c.querySelector('svg')?.getAttribute('aria-label')?.split('.')[0],
      points: rows.length,
      sample: rows.slice(0, 3),
      hasNaN: d.some((x) => /NaN/.test(x)),
      segments: d.map((x) => (x.match(/M/g) ?? []).length),
    };
  });
  return { charts, h2: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()) };
});

await open('reliability');
out.band = await page.evaluate(() => {
  const chart = document.querySelector('[data-chart="band"]');
  if (!chart) return { missing: true };
  const rows = [...chart.querySelectorAll('table.sr-only tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  const nums = rows.map((r) => r.slice(1).map((v) => (v === '—' || v === '' || v === 'No data yet' ? null : Number(v.replace(/,/g, '')))));
  const ordered = nums.filter((r) => r.every((v) => v != null)).every(([p50, p95, p99]) => p50 <= p95 && p95 <= p99);
  const gaps = nums.filter((r) => r.some((v) => v == null)).length;
  const paths = [...chart.querySelectorAll('svg path')].map((p) => p.getAttribute('d') ?? '');
  return {
    points: rows.length,
    sample: rows.slice(0, 4),
    orderedPercentiles: ordered,
    gapRows: gaps,
    hasNaN: paths.some((d) => /NaN/.test(d)),
    pathMoveCounts: paths.map((d) => (d.match(/M/g) ?? []).length),
  };
});

await browser.close();
writeFileSync(`${outDir}/geometry.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log('WROTE', `${outDir}/geometry.json`);

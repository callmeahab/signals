// Review probe for dashboard v3 fidelity, chart geometry, motion, contrast.
// Two fields in the emitted JSON are not measurements:
// geometry.heatmapMono.inversions parsed Number("100%") as NaN, so its
// inversion count is void. geometry.tools.sankey.pathHeights are path
// bounding boxes, not ribbon thickness. Use followup.mjs for both.
// Run from web/: bun ../reports/review-r1/fidelity.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const shotDir = resolve(outDir, 'shots');
mkdirSync(shotDir, { recursive: true });
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:26110';
const mock = process.env.MOCK_URL ?? 'file:///home/vuk/orca/workspaces/syncup/boxfish/briefs/v3/dashboard-v3.html';
const screens = ['overview', 'adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live', 'setup', 'settings'];

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const report = { product, mock, screens: {}, geometry: {}, motion: {}, performance: {}, contrast: [], overflow: [], clipped: [], drawers: {} };

const luminance = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrastOf = (a, b) => {
  const L1 = luminance(a), L2 = luminance(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
};

async function inventory(page) {
  return page.evaluate(() => {
    const text = (el) => (el.innerText || '').replace(/\s+/g, ' ').trim();
    const charts = [...document.querySelectorAll('[data-chart], [data-c]')].map((el) => ({
      kind: el.getAttribute('data-chart') || el.getAttribute('data-c'),
      label: el.getAttribute('aria-label') || el.querySelector('svg')?.getAttribute('aria-label') || '',
    }));
    const tiles = [...document.querySelectorAll('.tile')].map((el) => text(el.querySelector('.tile__label') || el).slice(0, 80));
    const headings = [...document.querySelectorAll('h1, h2, h3')].map((el) => ({
      tag: el.tagName,
      text: text(el).slice(0, 120),
      size: getComputedStyle(el).fontSize,
      weight: getComputedStyle(el).fontWeight,
      family: getComputedStyle(el).fontFamily.split(',')[0],
    }));
    const empties = [...document.querySelectorAll('.emptychart')].map((el) => text(el).slice(0, 160));
    const legends = [...document.querySelectorAll('.legend')].map((el) => text(el).slice(0, 160));
    return {
      h1: text(document.querySelector('h1')),
      headings, tiles, charts, empties, legends,
      overflow: [document.documentElement.scrollWidth, innerWidth],
    };
  });
}

import { contrastAndClip } from '../../web/scripts/contrast-clip.mjs';

async function openProduct(page, screen) {
  await page.goto(`${product}/#${screen}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1, name: new RegExp(`^${screen[0].toUpperCase()}${screen.slice(1)}$`) }).waitFor({ timeout: 15000 }).catch(async () => {
    await page.locator('h1').first().waitFor();
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=500){scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}scrollTo(0,0);});
  await page.waitForTimeout(100);
}

async function openMock(page, screen) {
  const url = `${mock}?theme=${new URL(page.url()).searchParams.get('theme') || 'light'}#${screen}`;
  if (!page.url().includes('dashboard-v3.html')) await page.goto(`${mock}?theme=light`, { waitUntil: 'load' });
  await page.evaluate((id) => document.querySelector(`button[data-id="${id}"]`)?.click(), screen);
  await page.waitForTimeout(400);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1 });
const page = await context.newPage();
await page.addInitScript(() => { localStorage.clear(); });

// Product inventory + geometry at 1440 light, then other viewports for contrast/overflow.
for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(() => localStorage.removeItem('signals-theme'));
    for (const screen of screens) {
      await openProduct(page, screen);
      // Force theme class in case localStorage from a prior page won.
      await page.evaluate((dark) => {
        localStorage.setItem('signals-theme', dark ? 'dark' : 'light');
        document.documentElement.classList.toggle('dark', dark);
      }, theme === 'dark');
      await page.waitForTimeout(150);
      const key = `${screen}-${width}-${theme}`;
      if (width === 1440 && theme === 'light') report.screens[screen] = { product: await inventory(page) };
      const scan = await contrastAndClip(page, key);
      if (scan.overflow[0] > scan.overflow[1] + 1) report.overflow.push({ key, ...{ scroll: scan.overflow } });
      report.clipped.push(...scan.clipped);
      report.contrast.push(...scan.failures);
      if (['overview', 'adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live'].includes(screen) && width === 1440 && theme === 'light') {
        await page.screenshot({ path: `${shotDir}/product-${screen}-1440-light.png`, fullPage: false });
      }
    }
    if (width === 1440 && theme === 'light') {
      await openProduct(page, 'tools');
      await page.getByRole('button', { name: 'search_products', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(400);
      report.drawers.tool = await inventory(page);
      await page.keyboard.press('Escape');
      await openProduct(page, 'sessions');
      await page.locator('.table-scroll tbody .row-button').first().click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(400);
      report.drawers.session = await inventory(page);
      await page.keyboard.press('Escape');
    }
  }
}

// Geometry + keyboard + crosshair + scale on the settled 1440 light overview/tools/cost.
await page.setViewportSize({ width: 1440, height: 1000 });
await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
await openProduct(page, 'overview');
report.geometry.overview = await page.evaluate(() => {
  const out = {};
  const funnel = document.querySelector('[data-chart="funnel"]');
  if (funnel) {
    const widths = [...funnel.querySelectorAll('rect.growx')].map((r) => r.getBBox().width);
    const counts = [...funnel.querySelectorAll('tbody td:nth-child(2)')].map((td) => Number(td.textContent.replace(/,/g, '')));
    const max = Math.max(...counts);
    const ratios = widths.map((w, i) => ({ count: counts[i], width: Math.round(w * 10) / 10, expected: Math.round(widths[0] * counts[i] / max * 10) / 10 }));
    out.funnel = ratios;
    const table = [...funnel.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    const drawn = [...funnel.querySelectorAll('text')].map((t) => t.textContent.trim());
    out.funnelTable = table;
    out.funnelDrawn = drawn;
    out.funnelTooltip = funnel.getAttribute('tabindex');
  }
  const heat = document.querySelector('[data-chart="heatmap"]');
  if (heat) {
    const svg = heat.querySelector('svg');
    const rects = [...svg.querySelectorAll('rect')];
    const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent.trim());
    const cells = rects.map((r) => ({ fill: r.getAttribute('fill'), x: r.getAttribute('x'), y: r.getAttribute('y') }));
    const labels = [...svg.querySelectorAll('text')].filter((t) => /%$|–/.test(t.textContent));
    const pairs = labels.map((t) => {
      const x = Number(t.getAttribute('x')), y = Number(t.getAttribute('y'));
      const rect = rects.find((r) => Math.abs(Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2 - x) < 8 && Math.abs(Number(r.getAttribute('y')) + Number(r.getAttribute('height')) / 2 - (y - 8)) < 20);
      return { label: t.textContent.trim(), fill: rect?.getAttribute('fill') || null };
    });
    out.heatmap = pairs;
    out.heatmapTextCount = texts.length;
  }
  const area = document.querySelector('[data-chart="stacked-area"]');
  if (area) {
    const svg = area.querySelector('svg');
    const grids = [...svg.querySelectorAll('line.gridline')].map((l) => Number(l.getAttribute('y1')));
    const top = Math.min(...grids);
    const plot = svg.querySelector('g.plot');
    const box = plot.getBBox();
    const ticks = [...svg.querySelectorAll('text.ax')].map((t) => t.textContent.trim()).slice(0, 8);
    out.area = { topGrid: top, plotTop: Math.round(box.y * 10) / 10, withinScale: box.y >= top - 1.5, ticks, legend: area.parentElement.querySelector('.legend')?.innerText.replace(/\s+/g, ' ') };
  }
  return out;
});

// Keyboard tooltip on the funnel.
await page.locator('[data-chart="funnel"]').focus();
await page.keyboard.press('ArrowRight');
report.geometry.funnelTooltipVisible = await page.getByRole('tooltip').count();

// Crosshair on stacked area.
const areaBox = await page.locator('[data-chart="stacked-area"] svg').boundingBox();
if (areaBox) {
  await page.mouse.move(areaBox.x + areaBox.width * 0.45, areaBox.y + areaBox.height * 0.5);
  await page.waitForTimeout(100);
  report.geometry.crosshair = await page.evaluate(() => {
    const xh = document.querySelector('[data-chart="stacked-area"] .xh');
    const tip = document.querySelector('[data-chart="stacked-area"] .tip');
    return { opacity: xh ? getComputedStyle(xh).opacity : null, tip: tip?.innerText?.replace(/\s+/g, ' ').slice(0, 180) || '' };
  });
}

await openProduct(page, 'tools');
report.geometry.tools = await page.evaluate(() => {
  const hist = document.querySelector('[aria-label^="Latency distribution"]')?.closest('[data-chart]') || document.querySelector('[data-chart="histogram"]');
  if (!hist) return { missing: true };
  const svg = hist.querySelector('svg');
  const bars = [...svg.querySelectorAll('rect.growy')];
  const rows = [...hist.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  const lo0 = Number(rows[0][0]);
  const lowers = rows.map((r) => Number(r[0]));
  const lastLo = lowers.at(-1);
  const hi = lastLo * 1.26;
  const x0 = bars[0].x.baseVal.value;
  const x1 = bars.at(-1).x.baseVal.value + bars.at(-1).width.baseVal.value;
  const lx = (v) => x0 + (Math.log(v) - Math.log(lo0)) / (Math.log(hi) - Math.log(lo0)) * (x1 - x0);
  const markers = [...svg.querySelectorAll('g.popin')].map((g) => {
    const line = g.querySelector('line');
    const label = g.querySelector('text')?.textContent.trim();
    const value = Number(label?.replace(/,/g, '').match(/[\d.]+$/)?.[0]);
    const x = Number(line?.getAttribute('x1'));
    return { label, value, x: Math.round(x * 10) / 10, expected: Math.round(lx(value) * 10) / 10, delta: Math.round((x - lx(value)) * 10) / 10 };
  });
  const grids = [...svg.querySelectorAll('line.gridline')].map((l) => l.getAttribute('y1'));
  const counts = rows.map((r) => Number(r[2].replace(/,/g, '')));
  const heights = bars.map((b) => b.height.baseVal.value);
  const maxC = Math.max(...counts), maxH = Math.max(...heights);
  const heightRatios = counts.map((c, i) => ({ n: c, h: Math.round(heights[i] * 10) / 10, expected: Math.round(maxH * c / maxC * 10) / 10 }));
  const sankey = document.querySelector('[data-chart="sankey"]');
  let sankeyOut = null;
  if (sankey) {
    const paths = [...sankey.querySelectorAll('svg path')].map((p) => Math.round(p.getBBox().height * 10) / 10);
    const table = [...sankey.querySelectorAll('tbody tr')].map((tr) => ({ path: tr.children[0].textContent.trim(), count: Number(tr.children[1].textContent.replace(/,/g, '')) }));
    sankeyOut = { pathHeights: paths, table };
  }
  return { markers, rows: rows.length, bars: bars.length, tickLines: grids.length, heightRatios: heightRatios.filter((_, i) => i % 10 === 0), sankey: sankeyOut, tableHead: rows.slice(0, 2) };
});
await page.locator('[data-chart="histogram"]').first().focus();
await page.keyboard.press('ArrowRight');
report.geometry.histogramTooltip = await page.getByRole('tooltip').count();

await openProduct(page, 'cost');
report.geometry.cost = await page.evaluate(() => {
  const tree = document.querySelector('[data-chart="treemap"]');
  const rects = [...tree.querySelectorAll('svg rect')].map((r) => ({
    name: r.parentElement.querySelector('text')?.textContent.trim() || '',
    area: r.width.baseVal.value * r.height.baseVal.value,
  })).filter((r) => r.area > 20);
  const table = [...tree.querySelectorAll('tbody tr')].map((tr) => ({ name: tr.children[0].textContent.trim(), tokens: Number(tr.children[1].textContent.replace(/,/g, '')) }));
  const totalA = rects.reduce((s, r) => s + r.area, 0);
  const totalT = table.reduce((s, r) => s + r.tokens, 0);
  const joined = table.map((row) => {
    const cell = rects.find((r) => r.name === row.name);
    return { name: row.name, tokens: row.tokens, tokenShare: Math.round(row.tokens / totalT * 1000) / 10, areaShare: cell ? Math.round(cell.area / totalA * 1000) / 10 : null };
  });
  const bars = document.querySelector('[data-chart="bars"]');
  const barRects = bars ? [...bars.querySelectorAll('svg rect')].filter((r) => r.getAttribute('fill') !== 'var(--viz-track)').map((r) => r.width.baseVal.value) : [];
  const barTable = bars ? [...bars.querySelectorAll('tbody tr')].map((tr) => Number(tr.children[1].textContent.replace(/,/g, ''))) : [];
  const maxB = Math.max(...barTable);
  const sparks = document.querySelectorAll('[data-chart="sparkline"]').length;
  const payload = document.querySelector('[aria-label*="Payload"]');
  const payloadFills = payload ? [...payload.querySelectorAll('rect.growy')].map((r) => r.getAttribute('fill')) : [];
  return { treemap: joined, bars: { widths: barRects.map((w) => Math.round(w)), values: barTable, proportional: barTable.map((v, i) => ({ v, w: Math.round(barRects[i] || 0), expected: Math.round((barRects[0] || 0) * v / (barTable[0] || 1)) })) }, sparks, payloadFills };
});
await page.locator('[data-chart="treemap"]').focus();
await page.keyboard.press('ArrowRight');
report.geometry.treemapTooltip = await page.getByRole('tooltip').count();
await page.locator('[data-chart="heatmap"]').count().catch(() => 0);

// Heatmap monotonicity needs computed colors. Do it on overview.
await openProduct(page, 'overview');
report.geometry.heatmapMono = await page.evaluate(() => {
  const heat = document.querySelector('[data-chart="heatmap"] svg');
  if (!heat) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = (color) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color || '#000';
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const accent = rgb(getComputedStyle(document.documentElement).getPropertyValue('--chart-3').trim() || 'oklch(0.44 0.075 189)');
  const labels = [...heat.querySelectorAll('text')].filter((t) => /%$/.test(t.textContent));
  const rects = [...heat.querySelectorAll('rect')];
  const cells = labels.map((t) => {
    const x = Number(t.getAttribute('x')), y = Number(t.getAttribute('y'));
    const rect = rects.find((r) => Math.abs(Number(r.getAttribute('x')) + Number(r.getAttribute('width')) / 2 - x) < 6);
    const fill = rect ? rgb(getComputedStyle(rect).fill) : null;
    return { pct: Number(t.textContent), nearAccent: fill ? Math.round(dist(fill, accent) * 10) / 10 : null };
  }).filter((c) => c.nearAccent != null);
  const sorted = [...cells].sort((a, b) => a.pct - b.pct);
  let inversions = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].nearAccent > sorted[i - 1].nearAccent + 1) inversions++;
  return { cells, inversions };
});

// Motion: durations, reduced motion, layout shift, lamp.
await page.emulateMedia({ reducedMotion: 'no-preference' });
await openProduct(page, 'overview');
await page.waitForTimeout(200);
report.motion.overview = await page.evaluate(() => {
  const anims = document.getAnimations().map((a) => {
    const t = a.effect?.getTiming?.() || {};
    return { name: a.animationName || a.transitionProperty || a.constructor.name, duration: t.duration, iterations: t.iterations };
  });
  const long = anims.filter((a) => typeof a.duration === 'number' && a.duration > 700 && a.iterations !== Infinity);
  return { count: anims.length, long, names: [...new Set(anims.map((a) => String(a.name)))].slice(0, 30) };
});
const before = await page.locator('.tile__value strong').first().innerText();
await page.waitForTimeout(500);
const mid = await page.locator('.tile__value strong').first().innerText();
report.motion.countUp = { before, mid };

await page.goto(`${product}/#live`);
await page.locator('h1').waitFor();
await page.waitForTimeout(300);
report.motion.lamp = await page.evaluate(() => {
  const el = document.querySelector('.signal-dot, .lamp');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const before = getComputedStyle(el, '::before');
  return { name: cs.animationName, duration: cs.animationDuration, iteration: cs.animationIterationCount, beforeName: before.animationName, beforeDuration: before.animationDuration };
});

// Layout shift after load.
await page.goto(`${product}/#overview`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);
await page.evaluate(() => {
  window.__cls = 0;
  new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false });
});
await page.waitForTimeout(1200);
await page.locator('nav a[href="#adoption"]').click();
await page.getByRole('heading', { name: 'Adoption', exact: true }).waitFor();
await page.waitForTimeout(800);
report.motion.clsAfterLoadAndSwitch = await page.evaluate(() => window.__cls);

// Reduced motion.
const reduced = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
const rp = await reduced.newPage();
await rp.addInitScript(() => localStorage.setItem('signals-theme', 'light'));
await rp.goto(`${product}/#overview`, { waitUntil: 'networkidle' });
await rp.locator('h1').waitFor();
const immediate = await rp.locator('.tile__value strong').first().innerText();
await rp.waitForTimeout(400);
const later = await rp.locator('.tile__value strong').first().innerText();
report.motion.reduced = await rp.evaluate((pair) => {
  const anims = document.getAnimations().filter((a) => {
    const t = a.effect?.getTiming?.() || {};
    return (typeof t.duration === 'number' && t.duration > 0 && t.iterations !== 0) || t.iterations === Infinity;
  }).map((a) => a.animationName || a.constructor.name);
  const dot = document.querySelector('.signal-dot');
  return { running: anims.slice(0, 20), dot: dot ? getComputedStyle(dot).animationName : null, countPair: pair };
}, [immediate, later]);
await rp.goto(`${product}/#live`);
await rp.locator('h1').waitFor();
report.motion.reducedLive = await rp.evaluate(() => {
  const el = document.querySelector('.signal-dot, .lamp');
  return el ? { name: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration } : null;
});
await reduced.close();

// Performance traces: first paint and tab switch.
await page.emulateMedia({ reducedMotion: 'no-preference' });
const cdp = await context.newCDPSession(page);
const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
await cdp.send('Performance.enable');
const paintBefore = await metric();
await page.goto(`${product}/#overview`, { waitUntil: 'commit' });
await page.locator('.chart-stacked-area svg, [data-chart="stacked-area"] svg').first().waitFor();
const paintAfter = await metric();
report.performance.firstPaintTaskMs = Math.round((paintAfter.TaskDuration - paintBefore.TaskDuration) * 1000 * 1000) / 1000;
await page.waitForTimeout(900);
const box = await page.locator('nav a[href="#tools"]').boundingBox();
const switchBefore = await metric();
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReturnAsStream' });
for (const type of ['mousePressed', 'mouseReleased']) {
  await cdp.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 });
}
await page.waitForTimeout(750);
const switchAfter = await metric();
const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
await cdp.send('Tracing.end');
const { stream } = await complete;
let trace = '';
for (;;) {
  const chunk = await cdp.send('IO.read', { handle: stream });
  trace += chunk.data;
  if (chunk.eof) break;
}
await cdp.send('IO.close', { handle: stream });
writeFileSync(`${outDir}/tab-switch-trace.json`, trace);
report.performance.tabSwitchTaskMs = Math.round((switchAfter.TaskDuration - switchBefore.TaskDuration) * 1000 * 1000) / 1000;
report.performance.tabSwitchTraceBytes = trace.length;

// Mock inventory at 1440 light for the same screens.
const mockPage = await context.newPage();
await mockPage.setViewportSize({ width: 1440, height: 1000 });
await mockPage.goto(`${mock}?theme=light`, { waitUntil: 'load' });
await mockPage.waitForTimeout(600);
for (const screen of screens) {
  await mockPage.evaluate((id) => document.querySelector(`button[data-id="${id}"]`)?.click(), screen);
  await mockPage.waitForTimeout(250);
  report.screens[screen] = report.screens[screen] || {};
  report.screens[screen].mock = await inventory(mockPage);
  if (['overview', 'adoption', 'live', 'protocol', 'cost', 'tools'].includes(screen)) {
    await mockPage.screenshot({ path: `${shotDir}/mock-${screen}-1440-light.png`, fullPage: false });
  }
}
await mockPage.evaluate(() => document.querySelector('tr[data-tool="search_products"]')?.click());
await mockPage.waitForTimeout(300);
report.drawers.mockTool = await inventory(mockPage);
await mockPage.evaluate(() => document.querySelector('#drawerClose')?.click());
await mockPage.evaluate((id) => document.querySelector(`button[data-id="${id}"]`)?.click(), 'sessions');
await mockPage.waitForTimeout(200);
await mockPage.evaluate(() => document.querySelector('tr[data-session]')?.click());
await mockPage.waitForTimeout(300);
report.drawers.mockSession = await inventory(mockPage);

// Mock overflow + a light contrast sample at 390 dark, product already scanned.
await mockPage.setViewportSize({ width: 390, height: 844 });
await mockPage.goto(`${mock}?theme=dark`, { waitUntil: 'load' });
for (const screen of screens) {
  await mockPage.evaluate((id) => document.querySelector(`button[data-id="${id}"]`)?.click(), screen);
  await mockPage.waitForTimeout(150);
  const scan = await contrastAndClip(mockPage, `mock-${screen}-390-dark`);
  if (scan.overflow[0] > scan.overflow[1] + 1) report.overflow.push({ key: `mock-${screen}-390-dark`, scroll: scan.overflow });
}

await browser.close();
writeFileSync(`${outDir}/fidelity.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  overflow: report.overflow,
  clipped: report.clipped.slice(0, 12),
  contrast: report.contrast.length,
  contrastSample: report.contrast.slice(0, 12),
  performance: report.performance,
  motion: report.motion,
  geometryKeys: Object.keys(report.geometry),
  funnel: report.geometry.overview?.funnel,
  heatmapInversions: report.geometry.heatmapMono?.inversions,
  markers: report.geometry.tools?.markers,
  treemap: report.geometry.cost?.treemap?.slice(0, 6),
  sparks: report.geometry.cost?.sparks,
  payloadFills: report.geometry.cost?.payloadFills,
  tooltip: { funnel: report.geometry.funnelTooltipVisible, hist: report.geometry.histogramTooltip, tree: report.geometry.treemapTooltip },
  crosshair: report.geometry.crosshair,
  headings: Object.fromEntries(screens.map((s) => [s, {
    product: report.screens[s]?.product?.headings?.filter((h) => h.tag === 'H2').map((h) => h.text),
    mock: report.screens[s]?.mock?.headings?.filter((h) => h.tag === 'H2').map((h) => h.text),
    productCharts: report.screens[s]?.product?.charts?.map((c) => c.kind),
    mockCharts: report.screens[s]?.mock?.charts?.map((c) => c.kind),
    productTiles: report.screens[s]?.product?.tiles,
    mockTiles: report.screens[s]?.mock?.tiles,
  }])),
}, null, 2));
console.log('WROTE', `${outDir}/fidelity.json`);

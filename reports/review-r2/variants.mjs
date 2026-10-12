// Round-2 fresh variants. One independent variant per round-1 finding, written
// from scratch (it does not import web/scripts/contrast-clip.mjs) so a mistake
// in the shared measurement cannot hide a defect.
//
// Run from web/:
//   PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
//     bun ../reports/review-r2/variants.mjs
// Writes reports/review-r2/variants.json and shots/*.png.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const shotDir = resolve(outDir, 'shots');
mkdirSync(shotDir, { recursive: true });
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:26210';
const report = { product, when: new Date().toISOString(), contrast: [], clipped: [], overflow: [], screens: {}, drawer: {}, lamp: {}, countUp: {}, perf: [] };

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });

// Independent composited-contrast + visible-clip scan.
// Walks real text nodes, blends every translucent ancestor background over the
// page background, and uses the WCAG 2.x relative-luminance ratio. Large text
// (>= 24px, or >= 18.66px at weight >= 700) is held to 3:1 and reported apart.
async function scan(page, tag) {
  return page.evaluate((tagName) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const rgba = (value) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const blend = (top, bottom) => {
      const a = top.a + bottom.a * (1 - top.a);
      if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      const mix = (x, y) => (x * top.a + y * bottom.a * (1 - top.a)) / a;
      return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
    };
    const lum = (col) => {
      const ch = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(col.r) + 0.7152 * ch(col.g) + 0.0722 * ch(col.b);
    };
    const ratio = (x, y) => {
      const a = lum(x), b = lum(y);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const under = (el) => {
      // Page background first, then every ancestor background painted on top.
      const stack = [];
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const parsed = rgba(getComputedStyle(n).backgroundColor);
        if (parsed.a > 0.004) stack.push(parsed);
        if (parsed.a > 0.985) break;
      }
      const page = rgba(getComputedStyle(document.documentElement).backgroundColor);
      const body = rgba(getComputedStyle(document.body).backgroundColor);
      let acc = page.a > 0.985 ? page : body.a > 0.985 ? body : { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of stack.reverse()) acc = blend(layer, acc);
      return acc;
    };
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.visibility !== 'visible' || s.display === 'none' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      // Off-screen (the skip link parks at top:-80px until focus).
      if (r.bottom < 0 || r.right < 0) return false;
      return true;
    };
    const small = [], large = [], seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || el.closest('.sr-only, [aria-hidden="true"], svg')) continue;
      if (!visible(el)) continue;
      const style = getComputedStyle(el);
      const fg0 = rgba(style.color);
      if (fg0.a < 0.15) continue;
      const bg = under(el);
      const value = Math.round(ratio(blend(fg0, bg), bg) * 100) / 100;
      const px = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const isLarge = px >= 24 || (bold && px >= 18.66);
      const limit = isLarge ? 3 : 4.5;
      if (value >= limit) continue;
      const key = `${style.color}|${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}|${text.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hit = { tag: tagName, text: text.slice(0, 70), ratio: value, limit, size: style.fontSize, weight: style.fontWeight, color: style.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` };
      (isLarge ? large : small).push(hit);
      if (small.length + large.length > 60) break;
    }
    // Visible clipping: an element that hides its own overflowing text.
    const clipped = [];
    for (const el of document.querySelectorAll('#main *, dialog *, .drawer *, [role="dialog"] *')) {
      if (el.closest('.table-scroll, pre, .copy-block, .sr-only, nav, .topbar')) continue;
      const s = getComputedStyle(el);
      const hides = ['hidden', 'clip'].includes(s.overflowX) || s.textOverflow === 'ellipsis';
      if (!hides) continue;
      if (el.scrollWidth <= el.clientWidth + 2) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      clipped.push({ tag: tagName, own, text: text.slice(0, 90), sw: el.scrollWidth, cw: el.clientWidth, cls: el.className?.toString?.().slice(0, 60) ?? '' });
      if (clipped.length > 25) break;
    }
    return { small, large, clipped, overflow: [document.documentElement.scrollWidth, window.innerWidth] };
  }, tag);
}

async function open(page, screen) {
  await page.goto(`${product}/#${screen}`, { waitUntil: 'networkidle' });
  await page.locator('h1').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  // Charts create their SVG when they enter the viewport; walk the page so every
  // chart is real before anything is measured.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(200);
}

const screens = ['overview', 'adoption', 'tools', 'reliability', 'sessions', 'callers', 'cost', 'protocol', 'live', 'setup', 'settings'];

// ---- Variants for blockers 7 and 8: widths and surfaces round 1 never scanned.
for (const theme of ['light', 'dark']) {
  for (const width of [1280, 320]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 320 ? 740 : 900 }, colorScheme: theme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((dark) => localStorage.setItem('signals-theme', dark ? 'dark' : 'light'), theme === 'dark');
    for (const screen of screens) {
      console.error('scan', screen, width, theme);
      await open(page, screen);
      const key = `${screen}-${width}-${theme}`;
      const got = await scan(page, key);
      report.contrast.push(...got.small, ...got.large);
      report.clipped.push(...got.clipped);
      if (got.overflow[0] > got.overflow[1] + 1) report.overflow.push({ key, scroll: got.overflow });
    }
    // Both drawers, which round 1 inventoried but never measured.
    console.error('drawers', width, theme);
    await open(page, 'tools');
    await page.getByRole('button', { name: 'search_products', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(600);
    const td = await scan(page, `tool-drawer-${width}-${theme}`);
    report.contrast.push(...td.small, ...td.large);
    report.clipped.push(...td.clipped);
    await page.keyboard.press('Escape');
    await open(page, 'sessions');
    await page.locator('.table-scroll tbody .row-button').first().click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(600);
    const sd = await scan(page, `session-drawer-${width}-${theme}`);
    report.contrast.push(...sd.small, ...sd.large);
    report.clipped.push(...sd.clipped);
    await page.keyboard.press('Escape');
    await ctx.close();
  }
}

// ---- Variants for blockers 3, 4, 5, 6 at 390 (round 1 compared 1440 only).
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('signals-theme', 'light'));
  const resolveColor = (name) => page.evaluate((n) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx2 = c.getContext('2d');
    ctx2.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return ctx2.fillStyle;
  }, name);
  for (const screen of ['adoption', 'cost', 'protocol', 'live', 'tools']) {
    console.error('390', screen);
    await open(page, screen);
    report.screens[`${screen}-390`] = await page.evaluate(() => ({
      tiles: [...document.querySelectorAll('.tile__label')].map((e) => e.textContent.trim()),
      charts: [...document.querySelectorAll('[data-chart]')].map((e) => e.getAttribute('data-chart')),
      chartLabels: [...document.querySelectorAll('[data-chart]')].map((e) => e.querySelector('svg')?.getAttribute('aria-label')?.split('.')[0] ?? ''),
      h2: [...document.querySelectorAll('h2')].map((e) => e.textContent.trim()),
      legends: [...document.querySelectorAll('.legend')].map((e) => ({
        text: e.innerText.replace(/\s+/g, ' ').trim(),
        swatches: [...e.querySelectorAll('i')].map((i) => getComputedStyle(i).backgroundColor),
      })),
      tables: [...document.querySelectorAll('.card table:not(.sr-only)')].length,
      nan: (document.querySelector('#main')?.innerText ?? '').includes('NaN'),
    }));
    await page.screenshot({ path: `${shotDir}/r2-${screen}-390-light.png`, fullPage: false });
  }
  // Blocker 5 variant: resolved dot colours, not attribute strings.
  await open(page, 'protocol');
  report.screens.protocolDots = await page.evaluate(() => [...document.querySelectorAll('[data-chart="dot-grid"]')].map((g) => {
    const circles = [...g.querySelectorAll('circle')];
    const tally = {};
    for (const circle of circles) {
      const f = getComputedStyle(circle).fill;
      tally[f] = (tally[f] ?? 0) + 1;
    }
    return { label: g.querySelector('svg')?.getAttribute('aria-label')?.split('.')[0] ?? '', n: circles.length, tally };
  }));
  report.screens.tokens = { chart1: await resolveColor('--chart-1'), chart3: await resolveColor('--chart-3'), track: await resolveColor('--viz-track') };

  // Blocker 4 variant: the Context-tokens tile sparkline is real and has data.
  await open(page, 'cost');
  report.screens.costSpark = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.tile')].find((t) => /Context tokens/i.test(t.textContent));
    const spark = tile?.querySelector('[data-chart="sparkline"]');
    const rows = [...(spark?.querySelectorAll('table.sr-only tbody tr') ?? [])].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    const path = spark?.querySelector('svg path')?.getAttribute('d') ?? null;
    return { present: !!spark, points: rows.length, firstRows: rows.slice(0, 3), lastRows: rows.slice(-2), pathHasNaN: path ? /NaN/.test(path) : null, pathLen: path?.length ?? 0 };
  });

  // Blocker 6 variant: lamp rings in both themes, and under reduced motion.
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
    await open(page, 'live');
    report.lamp[theme] = await page.evaluate(() => {
      const dot = document.querySelector('.signal-dot, .lamp');
      if (!dot) return null;
      const read = (pseudo) => {
        const s = getComputedStyle(dot, pseudo);
        return { name: s.animationName, duration: s.animationDuration, delay: s.animationDelay, border: s.borderTopColor, iterations: s.animationIterationCount };
      };
      return { self: getComputedStyle(dot).animationName, before: read('::before'), after: read('::after') };
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page, 'live');
  report.lamp.reduced = await page.evaluate(() => {
    const dot = document.querySelector('.signal-dot, .lamp');
    return {
      self: getComputedStyle(dot).animationName,
      before: getComputedStyle(dot, '::before').animationName,
      after: getComputedStyle(dot, '::after').animationName,
      running: document.getAnimations().map((a) => a.animationName ?? a.constructor.name),
    };
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await ctx.close();
}

// ---- Blocker 2 variant: every tool drawer histogram, not just one tool.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('signals-theme', 'light'));
  await open(page, 'tools');
  const names = await page.locator('.card table:not(.sr-only) tbody .row-button').allTextContents();
  report.drawer.tools = names;
  report.drawer.histograms = [];
  for (const name of names.slice(0, 6)) {
    console.error('drawer-hist', name);
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400);
    report.drawer.histograms.push(await page.evaluate((tool) => {
      const dialog = document.querySelector('dialog[open], dialog, [role="dialog"]');
      const hist = dialog.querySelector('[data-chart="histogram"]');
      const labels = [...(hist?.querySelectorAll('g.popin text') ?? [])].map((t) => t.textContent.trim());
      const rows = [...(hist?.querySelectorAll('table.sr-only tbody tr') ?? [])];
      const bars = hist?.querySelectorAll('rect.growy,.bar-layer.growy>svg>rect').length ?? 0;
      const counts = rows.map((tr) => Number(tr.children[2].textContent.replace(/,/g, '')));
      const tiles = [...dialog.querySelectorAll('.tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim());
      return { tool, labels, bars, bins: rows.length, binSum: counts.reduce((s, n) => s + n, 0), tiles, nan: dialog.innerText.includes('NaN') };
    }, name));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  // Tools screen aggregate histogram against the per-tool call counts.
  report.drawer.screenHistogram = await page.evaluate(() => {
    const hist = document.querySelector('[data-chart="histogram"]');
    const labels = [...hist.querySelectorAll('g.popin text')].map((t) => t.textContent.trim());
    const table = [...document.querySelectorAll('.card table:not(.sr-only)')].find((t) => /p95/.test(t.textContent));
    const header = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const callIdx = header.indexOf('Calls');
    const calls = [...table.querySelectorAll('tbody tr')].map((tr) => Number(tr.children[callIdx].textContent.replace(/,/g, '')));
    const bins = [...hist.querySelectorAll('table.sr-only tbody tr')].map((tr) => Number(tr.children[2].textContent.replace(/,/g, '')));
    return { labels, binSum: bins.reduce((s, n) => s + n, 0), callSum: calls.reduce((s, n) => s + n, 0), bins: bins.length, nan: hist.innerText.includes('NaN') };
  });
  await ctx.close();
}

// ---- Should-fix 1 variant: finer sampling, every tile, two screens.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('signals-theme', 'light'));
  for (const screen of ['overview', 'adoption']) {
    await page.goto(`${product}/#${screen}`, { waitUntil: 'commit' });
    const frames = [];
    for (let i = 0; i < 48; i++) {
      frames.push(await page.evaluate(() => [...document.querySelectorAll('.tile__value strong')].map((e) => e.textContent.trim())));
      await page.waitForTimeout(16);
    }
    report.countUp[screen] = frames.filter((f) => f.length);
  }
  await ctx.close();
}

// ---- Blocker 1 variant: transitions the author did not measure.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; localStorage.setItem('signals-theme', 'light'); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  for (const screen of ['cost', 'reliability', 'protocol', 'live', 'sessions']) {
    await page.goto(`${product}/#overview`, { waitUntil: 'networkidle' });
    await page.locator('[data-chart="stacked-area"] svg').first().waitFor();
    await page.waitForTimeout(1000);
    const box = await page.locator(`nav a[href="#${screen}"]`).boundingBox();
    const before = await metric();
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 });
    }
    await page.waitForTimeout(750);
    const after = await metric();
    report.perf.push({ transition: `overview → ${screen}`, mainThreadMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000 * 1000) / 1000 });
  }
  await ctx.close();
}

await browser.close();
writeFileSync(`${outDir}/variants.json`, JSON.stringify(report, null, 2));
const countNegative = Object.entries(report.countUp).flatMap(([screen, frames]) => frames.flatMap((f, i) => f.map((v, j) => ({ screen, i, j, v })).filter((s) => /^-/.test(s.v))));
console.log(JSON.stringify({
  contrastFailures: report.contrast.length,
  contrastSample: report.contrast.slice(0, 10),
  clipped: report.clipped.length,
  clippedSample: report.clipped.slice(0, 10),
  overflow: report.overflow,
  perf: report.perf,
  negativeCountUpFrames: countNegative,
  lamp: report.lamp,
  protocolDots: report.screens.protocolDots,
  tokens: report.screens.tokens,
  costSpark: report.screens.costSpark,
  drawerHistograms: report.drawer.histograms,
  screenHistogram: report.drawer.screenHistogram,
  screens390: Object.fromEntries(Object.entries(report.screens).filter(([k]) => k.endsWith('-390'))),
}, null, 2));
console.log('WROTE', `${outDir}/variants.json`);

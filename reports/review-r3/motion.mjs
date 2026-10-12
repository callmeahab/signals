// Measure product motion against the approved mock.
// Records animation duration, delay, easing and animated properties for the
// overview load and for one tab switch, plus the count-up length.
// Does not grade. The coordinator rules on the timing difference.
//
//   cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27110 \
//     bun ../reports/review-r3/motion.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:27110';
const mock = process.env.MOCK_URL ?? 'file:///home/vuk/orca/workspaces/syncup/boxfish/briefs/v3/dashboard-v3.html';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });

const recorder = () => {
  const records = [];
  const seen = new Set();
  const start = performance.now();
  const tick = () => {
    for (const a of document.getAnimations()) {
      const effect = a.effect;
      const target = effect && effect.target;
      const timing = effect && effect.getTiming ? effect.getTiming() : {};
      const key = [target && target.className, effect && effect.pseudoElement, a.animationName, timing.duration, timing.delay, Math.round(a.startTime || 0)].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      let props = [];
      try {
        props = [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))];
      } catch { /* css transitions may not expose keyframes */ }
      records.push({
        name: a.animationName || '(generated)',
        type: a.constructor.name,
        duration: timing.duration,
        delay: timing.delay,
        easing: timing.easing,
        iterations: timing.iterations,
        props,
        pseudo: (effect && effect.pseudoElement) || null,
        cls: target ? String(target.className || target.tagName).slice(0, 90) : null,
      });
    }
    if (performance.now() - start < 2500) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  globalThis.__motionRecords = records;
};

function summarise(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = `${row.cls}|${row.name}|${row.duration}|${row.props.join(',')}`;
    const g = groups.get(id) ?? { ...row, delays: [], n: 0 };
    g.n += 1;
    g.delays.push(row.delay);
    groups.set(id, g);
  }
  return [...groups.values()].map((g) => ({
    n: g.n, cls: g.cls, name: g.name, type: g.type, duration: g.duration,
    delays: [...new Set(g.delays)].sort((a, b) => a - b).slice(0, 12),
    easing: g.easing, iterations: g.iterations, props: g.props, pseudo: g.pseudo,
  }));
}

const compositorProps = new Set(['transform', 'opacity', 'offsetDistance', 'filter']);
function classify(groups) {
  return groups.map((g) => ({
    cls: g.cls, name: g.name, duration: g.duration, props: g.props,
    compositorOnly: g.props.length > 0 && g.props.every((p) => compositorProps.has(p)),
  }));
}

async function countUpLength(page, url, selector) {
  await page.goto(url, { waitUntil: 'commit' });
  await page.locator(selector).first().waitFor({ timeout: 8000 });
  const samples = [];
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    samples.push({ t: Date.now() - t0, values: await page.evaluate((sel) => [...document.querySelectorAll(sel)].slice(0, 6).map((e) => e.textContent.trim()), selector) });
    await page.waitForTimeout(16);
  }
  const width = samples[0].values.length;
  const spans = Array.from({ length: width }, (_, j) => {
    const col = samples.map((s) => s.values[j]);
    let first = null;
    let last = 0;
    for (let i = 1; i < col.length; i++) if (col[i] !== col[0]) { first = samples[i].t; break; }
    for (let i = 1; i < col.length; i++) if (col[i] !== col[i - 1]) last = samples[i].t;
    return { first, last, length: first == null ? 0 : last - first, start: col[0], end: col.at(-1) };
  });
  return { spans, longestChangeMs: Math.max(0, ...spans.map((s) => s.length)), lastChangeMs: Math.max(0, ...spans.map((s) => s.last)) };
}

const report = { product, mock, designNotes: {
  source: 'briefs/v3/dashboard-v3-notes.md §5',
  riseMs: 520,
  tiles: '140 ms + 60 ms stagger',
  cards: '260 ms + 80 ms stagger',
  charts: 'lines/areas 560 ms clip-path; strokes stroke-dashoffset; bars scaleX/scaleY',
  countUpMs: 640,
  mockComputedDelays: 'dashboard-v3.html sets tile --d to 130+i*55 and card --d to 300+i*85; rise is .52s; plot clip-path transition is .58s',
} };

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('signals-theme', 'light'));
  await page.addInitScript(recorder);
  report.productCountUp = await countUpLength(page, `${product}/#overview`, '.tile__value strong');
  await page.waitForTimeout(800);
  report.productLoad = summarise(await page.evaluate(() => globalThis.__motionRecords ?? []));
  report.productComputed = await page.evaluate(() => {
    const dur = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return { sel, animation: s.animationName, duration: s.animationDuration, delay: s.animationDelay }; };
    return [
      dur('.tiles'), dur('.tile'), dur('.card'), dur('.tile__spark'),
      dur('.chart-stacked-area > div:first-child'), dur('.chart-donut > div:first-child'),
      dur('.chart-histogram > div:first-child'), dur('.plot.on'), dur('.stroke-draw.on'), dur('.growy.on'), dur('.growx.on'),
    ];
  });
  // One tab switch, capturing animations that start on the destination.
  await page.evaluate(() => {
    const records = globalThis.__motionRecords;
    records.length = 0;
    const seen = new Set();
    const start = performance.now();
    const tick = () => {
      for (const a of document.getAnimations()) {
        const effect = a.effect;
        const target = effect && effect.target;
        const timing = effect && effect.getTiming ? effect.getTiming() : {};
        const key = [target && target.className, a.animationName, timing.duration, timing.delay, Math.round(a.startTime || 0)].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        let props = [];
        try { props = [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))]; } catch { /* ignore */ }
        records.push({ name: a.animationName || '(generated)', type: a.constructor.name, duration: timing.duration, delay: timing.delay, easing: timing.easing, iterations: timing.iterations, props, pseudo: (effect && effect.pseudoElement) || null, cls: target ? String(target.className || target.tagName).slice(0, 90) : null });
      }
      if (performance.now() - start < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const box = await page.locator('nav a[href="#adoption"]').boundingBox();
  const before = await metric();
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left', clickCount: 1 });
  }
  await page.waitForTimeout(900);
  const after = await metric();
  report.productSwitch = {
    transition: 'overview → adoption',
    mainThreadMs: Math.round((after.TaskDuration - before.TaskDuration) * 1e6) / 1e3,
    recalcStyleMs: Math.round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1e6) / 1e3,
    layoutMs: Math.round((after.LayoutDuration - before.LayoutDuration) * 1e6) / 1e3,
    scriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1e6) / 1e3,
    animations: summarise(await page.evaluate(() => globalThis.__motionRecords ?? [])),
  };
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(recorder);
  report.mockCountUp = await countUpLength(page, `${mock}?theme=light#overview`, '[data-count]');
  await page.waitForTimeout(1200);
  report.mockLoad = summarise(await page.evaluate(() => globalThis.__motionRecords ?? []));
  report.mockComputed = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('#panel .tile, .screen .tile, .tile')].slice(0, 8).map((el) => ({
      delay: getComputedStyle(el).animationDelay, duration: getComputedStyle(el).animationDuration, name: getComputedStyle(el).animationName,
    }));
    const cards = [...document.querySelectorAll('.card')].slice(0, 8).map((el) => ({
      delay: getComputedStyle(el).animationDelay, duration: getComputedStyle(el).animationDuration, name: getComputedStyle(el).animationName,
    }));
    const plot = document.querySelector('.plot.on');
    const plotStyle = plot ? getComputedStyle(plot) : null;
    return {
      tiles, cards,
      plot: plotStyle ? { transition: plotStyle.transitionProperty, duration: plotStyle.transitionDuration, delay: plotStyle.transitionDelay, clip: plotStyle.clipPath } : null,
    };
  });
  await ctx.close();
}

report.productLoadClass = classify(report.productLoad);
report.productSwitchClass = classify(report.productSwitch.animations);
report.mockLoadClass = classify(report.mockLoad);

await browser.close();
writeFileSync(resolve(outDir, 'motion.json'), JSON.stringify(report, null, 2));
const brief = {
  productCountUpLastChangeMs: report.productCountUp.lastChangeMs,
  mockCountUpLastChangeMs: report.mockCountUp.lastChangeMs,
  productLoad: report.productLoad.map((g) => ({ n: g.n, cls: g.cls, dur: g.duration, delays: g.delays, props: g.props })),
  productSwitchMs: report.productSwitch.mainThreadMs,
  productSwitchStyle: report.productSwitch.recalcStyleMs,
  productSwitchLayout: report.productSwitch.layoutMs,
  mockTiles: report.mockComputed.tiles,
  mockCards: report.mockComputed.cards,
  mockPlot: report.mockComputed.plot,
};
console.log(JSON.stringify(brief, null, 2));

// Dark-theme motion check. The round-3 motion probe asserts light theme only.
// This one repeats the approved timings in dark, then reloads with reduced motion.
//
//   cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27210 \
//     bun ../reports/review-r4/motion-dark.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:27210';
const allowed = new Set(['opacity', 'transform', 'strokeDashoffset', 'offsetDistance', 'filter']);
const recorder = () => {
  const seen = new Set();
  globalThis.__motionRecords = [];
  const start = performance.now();
  const tick = () => {
    for (const a of document.getAnimations()) {
      const effect = a.effect;
      const target = effect && effect.target;
      const timing = effect && effect.getTiming ? effect.getTiming() : {};
      const key = [target && target.getAttribute && target.getAttribute('class'), a.animationName, timing.duration, timing.delay].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      let props = [];
      try { props = [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))]; } catch { /* ignore */ }
      globalThis.__motionRecords.push({
        cls: target ? String((target.getAttribute && target.getAttribute('class')) || target.tagName).slice(0, 90) : null,
        name: a.animationName || '(generated)',
        duration: timing.duration,
        delay: timing.delay,
        props,
      });
    }
    if (performance.now() - start < 2800) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('signals-theme', 'dark'));
await page.addInitScript(recorder);
await page.goto(`${product}/#overview`, { waitUntil: 'commit' });
await page.locator('.tile__value strong').first().waitFor();
const countSamples = [];
for (let i = 0; i < 40; i++) {
  countSamples.push(await page.evaluate(() => [...document.querySelectorAll('.tile__value strong')].slice(0, 6).map((el) => el.textContent.trim())));
  await page.waitForTimeout(16);
}
await page.waitForTimeout(2200);
const load = await page.evaluate(() => {
  const html = document.documentElement;
  const anims = document.getAnimations().map((a) => {
    const effect = a.effect;
    const target = effect?.target;
    const timing = effect?.getTiming?.() ?? {};
    let props = [];
    try {
      props = [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))];
    } catch { /* cross-origin or finished */ }
    const style = target ? getComputedStyle(target) : null;
    return {
      cls: target ? String(target.getAttribute?.('class') || target.tagName).slice(0, 90) : null,
      name: a.animationName || '(generated)',
      duration: timing.duration,
      delay: timing.delay,
      props,
      transition: style ? style.transitionProperty : null,
    };
  });
  const tile = [...document.querySelectorAll('.tile')].map((el) => {
    const s = getComputedStyle(el);
    return { duration: s.animationDuration, delay: s.animationDelay, name: s.animationName };
  });
  return {
    darkClass: html.classList.contains('dark'),
    counts: [...document.querySelectorAll('.tile__value strong')].slice(0, 6).map((el) => el.textContent.trim()),
    anims: globalThis.__motionRecords ?? [],
    tile,
  };
});
assert.equal(load.darkClass, true, 'dark class missing');
const parseCount = (text) => {
  const cleaned = String(text).replace('≈', '').replace(/,/g, '').replace('%', '').replace('ms', '').trim();
  const match = cleaned.match(/^(-?[\d.]+)\s*([KMB])?$/);
  if (!match) return null;
  return Number(match[1]) * { K: 1e3, M: 1e6, B: 1e9 }[match[2] || ''] || Number(match[1]);
};
const countCols = countSamples[0].map((_, j) => countSamples.map((row) => parseCount(row[j])));
for (const col of countCols) {
  assert.ok(col.every((n) => n == null || n >= 0));
  for (let i = 1; i < col.length; i++) if (col[i] != null && col[i - 1] != null) assert.ok(col[i] + 1e-9 >= col[i - 1]);
}
const tiles = load.anims.filter((a) => a.cls?.startsWith('tile rv'));
assert.equal(tiles.length, 6);
assert.deepEqual(tiles.map((a) => a.duration).sort((a, b) => a - b), [520, 520, 520, 520, 520, 520]);
assert.deepEqual([...new Set(tiles.map((a) => a.delay))].sort((a, b) => a - b), [130, 185, 240, 295, 350, 405]);
const cards = load.anims.filter((a) => a.cls?.includes('card panel'));
assert.ok(cards.length >= 4, `expected several cards, saw ${cards.length}`);
assert.ok(cards.every((a) => a.duration === 520));
const cardDelays = [...new Set(cards.map((a) => a.delay))].sort((a, b) => a - b);
for (const delay of cardDelays) assert.ok([300, 385, 470, 555, 640].includes(delay), `unexpected card delay ${delay}`);
for (const a of load.anims) {
  for (const prop of a.props) assert.ok(allowed.has(prop), `${a.cls} animates ${prop}`);
}
const charts = await page.evaluate(() => {
  const dur = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return { sel, name: s.animationName, duration: s.animationDuration, transition: s.transitionProperty };
  };
  return [
    dur('.tile__spark'),
    dur('.chart-stacked-area > div:first-child'),
    dur('.chart-donut > div:first-child'),
    dur('.plot.on'),
    dur('.stroke-draw.on'),
    dur('.growx.on'),
    dur('.growy.on'),
  ];
});
for (const chart of charts) if (chart) assert.ok(!String(chart.transition).includes('clip-path'), `${chart.sel} transitions clip-path`);
await page.locator('.grid>.card').last().scrollIntoViewIfNeeded();
await page.waitForTimeout(900);
const scrolled = await page.evaluate(() => document.getAnimations().some((a) => {
  const cls = a.effect?.target?.getAttribute?.('class') || '';
  const delay = a.effect?.getTiming?.().delay;
  return cls.includes('card panel') && delay === 640 && a.effect.getTiming().duration === 520;
}));
assert.equal(scrolled, true, 'fifth card 640 ms entrance missing');
await page.locator('nav a[href="#tools"]').click();
await page.locator('.chart-histogram svg[role=img]').waitFor();
await page.waitForTimeout(400);
const bars = await page.locator('.chart-histogram svg.growy').evaluateAll((nodes) => nodes.map((bar) => {
  const s = getComputedStyle(bar);
  return { durationMs: parseFloat(s.animationDuration) * 1000, delayMs: parseFloat(s.animationDelay) * 1000 };
}));
assert.equal(bars.length, 60);
bars.forEach((bar, i) => {
  assert.equal(bar.durationMs, 520);
  assert.ok(Math.abs(bar.delayMs - i * 12) < 0.001, `bar ${i} delay ${bar.delayMs}`);
});
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.reload();
await page.waitForTimeout(600);
const reduced = await page.evaluate(() => document.getAnimations().map((a) => a.animationName || 'WAAPI'));
assert.deepEqual(reduced, []);
const report = {
  product, theme: 'dark', tiles: tiles.length, cardDelays, charts, histogramBars: bars.length, reduced,
  countFirst: countSamples[0], countLast: countSamples.at(-1),
};
writeFileSync(resolve(import.meta.dirname, 'motion-dark.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

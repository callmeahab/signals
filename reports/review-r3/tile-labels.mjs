// Fresh variant for the round-2 tile-label ellipsis. Independent of
// reports/review-r2/variants.mjs: reads computed white-space / overflow and
// whether the label's own box or an ancestor clips the full string.
// Widths: 320 (the reported width), 359 (inside the max-width:360px rule),
// 390 (a width the product already asserts). Both themes. Every screen that
// renders tiles, plus the session drawer.
//
//   cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27110 \
//     bun ../reports/review-r3/tile-labels.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:27110';
const screens = ['overview', 'adoption', 'tools', 'reliability', 'sessions', 'cost', 'protocol', 'live'];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const hits = [];
const samples = [];

async function measure(page, key) {
  return page.evaluate((keyName) => {
    const labels = [...document.querySelectorAll('.tile__label')];
    return labels.map((el) => {
      const s = getComputedStyle(el);
      const rects = el.getClientRects();
      let clipper = null;
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX) || ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowY)) {
          const er = el.getBoundingClientRect();
          const nr = node.getBoundingClientRect();
          if (er.bottom > nr.bottom + 1 || er.right > nr.right + 1 || er.top < nr.top - 1) {
            clipper = { cls: node.className?.toString?.().slice(0, 60) ?? '', overflowX: cs.overflowX, overflowY: cs.overflowY };
            break;
          }
        }
        node = node.parentElement;
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      const textBox = range.getBoundingClientRect();
      const value = el.parentElement?.querySelector('.tile__value');
      const overlap = value ? (() => {
        const a = el.getBoundingClientRect();
        const b = value.getBoundingClientRect();
        return a.bottom > b.top + 1 && a.top < b.bottom;
      })() : false;
      return {
        key: keyName,
        text: el.textContent.trim(),
        whiteSpace: s.whiteSpace,
        overflow: s.overflow,
        textOverflow: s.textOverflow,
        sw: el.scrollWidth,
        cw: el.clientWidth,
        sh: el.scrollHeight,
        ch: el.clientHeight,
        lines: range.getClientRects().length,
        textW: Math.round(textBox.width * 10) / 10,
        boxW: Math.round(el.getBoundingClientRect().width * 10) / 10,
        ellipsis: s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1,
        selfClip: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        textOverflowPx: Math.round((textBox.width - el.getBoundingClientRect().width) * 10) / 10,
        clipper,
        overlap,
      };
    });
  }, key);
}

for (const theme of ['light', 'dark']) {
  for (const width of [320, 359, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 390 ? 740 : 844 }, colorScheme: theme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((dark) => localStorage.setItem('signals-theme', dark ? 'dark' : 'light'), theme === 'dark');
    for (const screen of screens) {
      await page.goto(`${product}/#${screen}`, { waitUntil: 'networkidle' });
      await page.locator('h1').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const rows = await measure(page, `${screen}-${width}-${theme}`);
      samples.push(...rows);
      hits.push(...rows.filter((r) => r.ellipsis || r.selfClip || r.clipper || r.overlap || r.textOverflowPx > 1));
    }
    await page.goto(`${product}/#sessions`, { waitUntil: 'networkidle' });
    await page.locator('.table-scroll tbody .row-button').first().click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(400);
    const drawer = await measure(page, `session-drawer-${width}-${theme}`);
    samples.push(...drawer);
    hits.push(...drawer.filter((r) => r.ellipsis || r.selfClip || r.clipper || r.overlap || r.textOverflowPx > 1));
    await ctx.close();
    console.log(`${width} ${theme}: hits ${hits.length}`);
  }
}

await browser.close();
const report = {
  product,
  labels: samples.length,
  hits,
  at320: samples.filter((s) => s.key.includes('-320-')).map((s) => ({ key: s.key, text: s.text, whiteSpace: s.whiteSpace, lines: s.lines, ellipsis: s.ellipsis, selfClip: s.selfClip, textW: s.textW, boxW: s.boxW, textOverflowPx: s.textOverflowPx, sw: s.sw, cw: s.cw })),
};
writeFileSync(resolve(outDir, 'tile-labels.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ labels: samples.length, hits: hits.length, hitSample: hits.slice(0, 12) }, null, 2));

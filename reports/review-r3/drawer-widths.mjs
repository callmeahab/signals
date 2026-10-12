// Fresh contrast variant: the author's contrast-clip.mjs on both drawers at
// 1280 and 320, both themes. Round 2 measured 1440 and 390 only.
//
//   cd web && PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:27110 \
//     bun ../reports/review-r3/drawer-widths.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contrastAndClip } from '../../web/scripts/contrast-clip.mjs';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:27110';
const out = { product, widths: [1280, 320], failures: [], clipped: [], pills: [] };
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });

for (const theme of ['light', 'dark']) {
  for (const width of [1280, 320]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 320 ? 740 : 900 }, colorScheme: theme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((dark) => localStorage.setItem('signals-theme', dark ? 'dark' : 'light'), theme === 'dark');
    const open = async (screen) => {
      await page.goto(`${product}/#${screen}`, { waitUntil: 'networkidle' });
      await page.locator('h1').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
    };
    const pillSample = async (surface) => page.evaluate((surfaceName) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx2 = canvas.getContext('2d', { willReadFrequently: true });
      const parse = (v) => { ctx2.clearRect(0, 0, 1, 1); ctx2.fillStyle = '#000'; ctx2.fillStyle = v; ctx2.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx2.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
      const over = (fg, bg) => {
        const a = fg.a + bg.a * (1 - fg.a);
        if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
        return { r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a, g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a, b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a, a };
      };
      const backdrop = (el) => {
        let node = el;
        const layers = [];
        while (node && node !== document.documentElement) {
          const parsed = parse(getComputedStyle(node).backgroundColor);
          if (parsed.a > 0.01) layers.push(parsed);
          if (parsed.a > 0.98) break;
          node = node.parentElement;
        }
        const rootBg = parse(getComputedStyle(document.body).backgroundColor);
        let acc = rootBg.a > 0 ? rootBg : { r: 255, g: 255, b: 255, a: 1 };
        for (const layer of layers.reverse()) acc = over(layer, acc);
        return acc;
      };
      const L = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const lum = (c) => 0.2126 * L(c.r) + 0.7152 * L(c.g) + 0.0722 * L(c.b);
      const pills = [...document.querySelectorAll('dialog .status-pill.ok, [role="dialog"] .status-pill.ok')];
      const root = getComputedStyle(document.documentElement);
      const sample = pills[0];
      let ratio = null;
      let bg = null;
      if (sample) {
        const fg0 = parse(getComputedStyle(sample).color);
        bg = backdrop(sample);
        const fg = over(fg0, bg);
        const a = lum(fg);
        const b = lum(bg);
        ratio = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 1000) / 1000;
      }
      return {
        surface: surfaceName,
        okInk: root.getPropertyValue('--ok-ink').trim(),
        chart3: root.getPropertyValue('--chart-3').trim(),
        n: pills.length,
        texts: [...new Set(pills.map((p) => p.textContent.trim()))],
        color: sample ? getComputedStyle(sample).color : null,
        fontSize: sample ? getComputedStyle(sample).fontSize : null,
        fontWeight: sample ? getComputedStyle(sample).fontWeight : null,
        backdrop: bg,
        ratio,
      };
    }, surface);

    await open('sessions');
    await page.locator('.table-scroll tbody .row-button').first().click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(500);
    const session = await contrastAndClip(page, `session-drawer-${width}-${theme}`);
    out.failures.push(...session.failures);
    out.clipped.push(...session.clipped);
    out.pills.push(await pillSample(`session-drawer-${width}-${theme}`));
    await page.keyboard.press('Escape');

    await open('tools');
    await page.getByRole('button', { name: 'search_products', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(500);
    const tool = await contrastAndClip(page, `tool-drawer-${width}-${theme}`);
    out.failures.push(...tool.failures);
    out.clipped.push(...tool.clipped);
    out.pills.push(await pillSample(`tool-drawer-${width}-${theme}`));
    await ctx.close();
    console.log(`${width} ${theme}: contrast failures so far ${out.failures.length}, clipped ${out.clipped.length}`);
  }
}

await browser.close();
writeFileSync(resolve(outDir, 'drawer-widths.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ failures: out.failures.length, clipped: out.clipped.length, pills: out.pills.map((p) => ({ surface: p.surface, n: p.n, ratio: p.ratio, okInk: p.okInk, texts: p.texts })) }, null, 2));

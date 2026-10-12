// Points the author's own shared measurement (web/scripts/contrast-clip.mjs)
// at the two drawers, which the round-1 scan opened but never measured, at the
// two widths the fix brief names (1440 and 390) in both themes.
//
// Run from web/:
//   PLAYWRIGHT_CHANNEL=chromium PRODUCT_URL=http://127.0.0.1:26210 \
//     bun ../reports/review-r2/drawer-contrast.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire('/home/vuk/orca/workspaces/signals-collector/dash-v2/web/package.json')('@playwright/test');
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contrastAndClip } from '../../web/scripts/contrast-clip.mjs';

const outDir = resolve(import.meta.dirname);
const product = process.env.PRODUCT_URL ?? 'http://127.0.0.1:26210';
const out = { product, failures: [], clipped: [], pill: {} };
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, colorScheme: theme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((dark) => localStorage.setItem('signals-theme', dark ? 'dark' : 'light'), theme === 'dark');
    const open = async (screen) => {
      await page.goto(`${product}/#${screen}`, { waitUntil: 'networkidle' });
      await page.locator('h1').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
    };
    await open('sessions');
    await page.locator('.table-scroll tbody .row-button').first().click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(700);
    const session = await contrastAndClip(page, `session-drawer-${width}-${theme}`);
    out.failures.push(...session.failures);
    out.clipped.push(...session.clipped);
    // Resolve the exact pair for the timeline event-type pill.
    out.pill[`${width}-${theme}`] = await page.evaluate(() => {
      const pill = document.querySelector('[role="dialog"] .status-pill, dialog .status-pill, dialog .timeline .status-pill');
      if (!pill) return null;
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx2 = c.getContext('2d', { willReadFrequently: true });
      const parse = (v) => { ctx2.clearRect(0, 0, 1, 1); ctx2.fillStyle = '#000'; ctx2.fillStyle = v; ctx2.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx2.getImageData(0, 0, 1, 1).data; return { r, g, b, a: a / 255 }; };
      const style = getComputedStyle(pill);
      const parentBg = getComputedStyle(pill.parentElement.closest('.drawer, dialog, .card, body')).backgroundColor;
      return {
        text: pill.textContent.trim(),
        classes: pill.className,
        color: style.color,
        colorRgba: parse(style.color),
        pillBackground: style.backgroundColor,
        pillBackgroundRgba: parse(style.backgroundColor),
        surface: parentBg,
        surfaceRgba: parse(parentBg),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        chart3: getComputedStyle(document.documentElement).getPropertyValue('--chart-3').trim(),
      };
    });
    await page.keyboard.press('Escape');
    await open('tools');
    await page.getByRole('button', { name: 'search_products', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(700);
    const tool = await contrastAndClip(page, `tool-drawer-${width}-${theme}`);
    out.failures.push(...tool.failures);
    out.clipped.push(...tool.clipped);
    await ctx.close();
  }
}

await browser.close();
writeFileSync(`${outDir}/drawer-contrast.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ failures: out.failures, clipped: out.clipped, pill: out.pill }, null, 2));
console.log('failures:', out.failures.length, 'clipped:', out.clipped.length);

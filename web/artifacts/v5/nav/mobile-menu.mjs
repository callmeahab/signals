// The mobile menu's stacked list is dead CSS in this build (the button is display:none
// at every width, since v3 made the tab row scroll instead), but it must still lay out
// as a stacked list hung off the 64 px bar if it is reached.
import { chromium } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:23500';
const browser = await chromium.launch({ channel: 'chromium' });
for (const width of [390, 1200]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });
  await page.goto(base + '/#overview');
  await page.locator('.topbar nav a').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.querySelector('.topbar nav').classList.add('open'));
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const nav = document.querySelector('.topbar nav'), s = getComputedStyle(nav), b = nav.getBoundingClientRect();
    const links = [...nav.querySelectorAll('a')];
    return { position: s.position, top: s.top, display: s.display, wrap: s.flexWrap,
      box: { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width) },
      links: links.length, rows: [...new Set(links.map(a => Math.round(a.getBoundingClientRect().top)))].length,
      barHeight: Math.round(document.querySelector('.topbar-inner').getBoundingClientRect().height),
      menuButton: getComputedStyle(document.querySelector('.mobile-menu')).display };
  });
  console.log(width, JSON.stringify(m));
  await page.screenshot({ path: `artifacts/v5/nav/mobile-menu-${width}.png`, clip: { x: 0, y: 0, width, height: 420 } });
  await ctx.close();
}
await browser.close();

import { chromium } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:23500';
const browser = await chromium.launch({ channel: 'chromium' });
for (const width of [1920, 1680, 1600, 1440, 1439, 1366, 1280, 1279, 1024, 1014, 1013, 820, 560, 390, 320]) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });
  await page.goto(base + '/#overview');
  await page.locator('.topbar nav a').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.topbar-inner');
    const nav = document.querySelector('.topbar nav');
    const brand = document.querySelector('.brand-link');
    const btns = [...document.querySelectorAll(".topbar-actions > .icon-button")];
    const a = nav.querySelector('a');
    const icon = a.querySelector('lord-icon');
    const r = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      bar: r(bar), nav: r(nav), brand: r(brand),
      btns: btns.map(b => ({ ...r(b), vis: getComputedStyle(b).display })),
      navScrollW: nav.scrollWidth, navClientW: nav.clientWidth,
      tabs: [...nav.querySelectorAll('a')].map(x => Math.round(x.getBoundingClientRect().width)),
      tabsSum: [...nav.querySelectorAll('a')].reduce((s,x)=>s+x.getBoundingClientRect().width,0),
      label: getComputedStyle(a).fontSize, tabH: r(a).h, pad: getComputedStyle(a).paddingLeft,
      iconBox: icon ? r(icon) : null,
      mobileMenu: getComputedStyle(document.querySelector('.mobile-menu')).display,
      docW: document.documentElement.scrollWidth, innerW: innerWidth,
    };
  });
  const navCentre = (m.nav.l + m.nav.r) / 2, barCentre = (m.bar.l + m.bar.r) / 2;
  console.log(`\n== ${width}px ==`);
  console.log(`bar ${JSON.stringify(m.bar)} brand ${JSON.stringify(m.brand)} btns ${JSON.stringify(m.btns)}`);
  console.log(`nav ${JSON.stringify(m.nav)} scrollW=${m.navScrollW} clientW=${m.navClientW} tabsSum=${m.tabsSum.toFixed(1)}`);
  console.log(`navCentre=${navCentre} barCentre=${barCentre} delta=${(navCentre-barCentre).toFixed(1)}`);
  console.log(`label=${m.label} tabH=${m.tabH} pad=${m.pad} icon=${JSON.stringify(m.iconBox)} mobileMenu=${m.mobileMenu} doc=${m.docW}/${m.innerW}`);
  console.log(`tabs=${JSON.stringify(m.tabs)}`);
  await ctx.close();
}
await browser.close();

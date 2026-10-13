// Before/after crops for the two drawer items (v5 items 3 and 4), from one build: the
// "before" frames re-apply the three rules this pass changed -- the drawer header's
// divider, the blurred `::backdrop`, and the top bar's own `backdrop-filter` -- with
// `addStyleTag`, so the only difference between a pair is those rules.
// Run with the demo server up: BASE_URL=http://127.0.0.1:23500 node artifacts/v5/drawer/capture.mjs
import { chromium } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:23500';
const out = 'artifacts/v5/drawer';
const BEFORE = `
.drawer .drawer-header{border-bottom:1px solid var(--border)}
.drawer::backdrop{background:color-mix(in oklch,var(--foreground) 22%,transparent);backdrop-filter:blur(3px)}
html:has(dialog[open]) .topbar{backdrop-filter:blur(16px) saturate(150%);background:color-mix(in oklch,var(--background) 74%,transparent)}
`;
const drawers = {
  tool: {
    screen: '#tools',
    ready: page => page.getByRole('button', { name: 'search_products', exact: true }).waitFor(),
    open: async page => { await page.getByRole('button', { name: 'search_products', exact: true }).click(); await page.getByRole('heading', { name: 'Error split', exact: true }).waitFor(); },
  },
  session: {
    screen: '#sessions',
    ready: page => page.getByRole('heading', { name: 'The story of a connection', exact: true }).waitFor(),
    open: async page => { await page.locator('.signals-ui .table-scroll tbody .row-button').first().click(); await page.locator('.timeline li').first().waitFor(); },
  },
};
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium', args: ['--disable-partial-raster'] });
for (const theme of ['light', 'dark'])
  for (const [label, drawer] of Object.entries(drawers))
    for (const state of ['before', 'after']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme, reducedMotion: 'reduce', timezoneId: 'UTC' });
      await context.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });
      const page = await context.newPage();
      await page.goto(base + '/' + drawer.screen);
      await drawer.ready(page);
      // The page behind is scrolled, so a blur over the top bar has something to blur.
      await page.evaluate(() => globalThis.scrollTo(0, 420));
      await page.waitForTimeout(500);
      await drawer.open(page);
      if (state === 'before') await page.addStyleTag({ content: BEFORE });
      await page.waitForTimeout(1200);
      const box = await page.locator('.drawer').boundingBox();
      const head = await page.locator('.drawer .drawer-header').boundingBox();
      // The header, what is under it, and the page behind the drawer where the blur fell.
      await page.screenshot({ path: `${out}/${label}-${theme}-${state}.png`, clip: { x: box.x, y: Math.max(0, head.y - 12), width: box.width, height: 320 } });
      await page.screenshot({ path: `${out}/${label}-${theme}-${state}-page.png`, clip: { x: 0, y: 0, width: 880, height: 420 } });
      await context.close();
    }
await browser.close();
console.log('drawer crops written to ' + out);

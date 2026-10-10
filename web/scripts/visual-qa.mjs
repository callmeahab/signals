import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3300';
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(base);
      await page.getByRole('heading', { name: 'A little pulse. A lot of insight.' }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const fonts = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, heading: getComputedStyle(document.querySelector('h1')).fontFamily, loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) }));
      check(/Manrope/.test(fonts.body) && fonts.loaded.some(f => /Manrope/.test(f)), `${width}/${theme}: Manrope loaded`);
      check(/Unbounded/.test(fonts.heading) && fonts.loaded.some(f => /Unbounded/.test(f)), `${width}/${theme}: Unbounded loaded`);
      await page.screenshot({ path: `artifacts/overview-${width}-${theme}.png`, fullPage: true });
      for (const screen of ['overview', 'tools', 'callers', 'sessions', 'live', 'settings', 'setup']) {
        await page.goto(`${base}/#${screen}`);
        await page.waitForTimeout(150);
        const size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        check(size[0] <= size[1], `${screen} ${width}/${theme}: overflow ${size}`);
      }
      await page.goto(`${base}/#setup`);
      await page.getByRole('button', {name:'Python',exact:true}).click();
      check((await page.locator('.copy-block').last().innerText()).includes('signals.asgi(mcp.streamable_http_app())'), 'Python SDK snippet');
      await page.screenshot({path:`artifacts/setup-python-${width}-${theme}.png`,fullPage:true});
      await page.getByRole('button', {name:'Node.js',exact:true}).click();
      check((await page.locator('.copy-block').last().innerText()).includes('app.use(signals.express())'), 'Node SDK snippet');
      await page.screenshot({path:`artifacts/setup-node-${width}-${theme}.png`,fullPage:true});
      await page.getByRole('button', {name:'cURL',exact:true}).click();
      const curl = await page.locator('.copy-block pre').last().innerText();
      const batch = JSON.parse(curl.match(/-d '(.+)'/)[1]);
      check(batch.schema_version === 1 && batch.dropped === 0 && batch.source.instance_id === 'i_demo', 'spec batch envelope');
      check(batch.events[0].type === 'custom' && batch.events[0].attrs.name === 'hello', 'spec custom attrs');
      check(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(batch.events[0].id), 'raw example UUIDv7');
      check(curl.includes('Bearer $SIGNALS_KEY'), 'raw example authorization');
      await page.screenshot({path:`artifacts/setup-curl-${width}-${theme}.png`,fullPage:true});
      await page.goto(`${base}/#tools`);
      await page.getByRole('button', { name: 'search_documents', exact: true }).click();
      check(await page.getByRole('dialog').isVisible(), 'tool details open');
      await page.getByRole('heading',{name:'Recent errors',exact:true}).waitFor();
      check(await page.getByRole('heading',{name:'Recent errors',exact:true}).isVisible(),'tool recent errors shown');
      check(await page.getByRole('dialog').locator('svg[role="img"]').count()===2,'tool activity and latency charts');
      await page.keyboard.press('Escape');
      await page.goto(`${base}/#callers`);
      await page.locator('tbody .row-button').first().click();
      await page.getByRole('heading',{name:/Activity history/}).waitFor();
      check(await page.getByRole('dialog').locator('svg[role="img"]').count()===1,'caller history chart');
      await page.keyboard.press('Escape');
      await page.goto(`${base}/#live`);
      await page.getByRole('button', {name:'Pause', exact:true}).click();
      check(await page.getByText('Paused', {exact:true}).isVisible(), 'live tail pauses');
      await page.getByLabel('Event type').selectOption('log');
      await page.getByRole('heading', {name:'Log stream',exact:true}).waitFor();
      check(await page.locator('.event-row summary').first().innerText().then(t=>t.includes('Connected to document index')), 'log messages visible');
      await page.getByLabel('Event type').selectOption('errors');
      await page.getByRole('heading', {name:'Recent errors',exact:true}).waitFor();
      check(await page.locator('.event-row.has-error').count() > 0, 'errors view includes spec errors');
      await page.getByLabel('Event type').selectOption('resource.read');
      check(await page.locator('.event-row summary').first().innerText().then(t=>t.includes('docs://getting-started')), 'resource URI visible');
      await page.getByLabel('Event type').selectOption('');
      await page.getByRole('button', {name:'Resume', exact:true}).click();
      await page.goto(`${base}/#settings`);
      await page.getByLabel('Key label').fill('QA key');
      await page.getByRole('button', {name:'Create key', exact:true}).click();
      check(await page.getByRole('dialog').isVisible(), 'new key revealed once');
      await page.getByRole('button', {name:'I’ve saved it'}).click();
      await page.getByRole('button', {name:'Revoke QA key', exact:true}).click();
      await page.getByRole('dialog').getByRole('button', {name:'Revoke key', exact:true}).click();
      check(await page.getByText('Key revoked.', {exact:true}).isVisible(), 'key revoked');
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: {width:320,height:900}, reducedMotion:'reduce' });
  const page = await context.newPage();
  for(const screen of ['overview','tools','callers','sessions','live','settings','setup']) {
    await page.goto(`${base}/#${screen}`);
    await page.waitForTimeout(150);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen}: 320px overflow`);
  }
  await context.close();
} finally { await browser.close(); }
if(failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Visual QA passed: 7 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.');

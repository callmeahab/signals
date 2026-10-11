import { contrastAndClip } from './contrast-clip.mjs';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function settleCharts(page) {
  // Exercise the same viewport trigger as a reader, including scrollable drawers.
  for(const chart of await page.locator('.v3-chart').all()){
    await chart.scrollIntoViewIfNeeded();
    await chart.locator('svg').waitFor();
  }
  await page.evaluate(async()=>{
    await document.fonts.ready;
    for(const el of document.querySelectorAll('.drawer,.table-scroll')){el.scrollTop=0;el.scrollLeft=0;}
    globalThis.scrollTo(0,0);
    await new Promise(resolve=>globalThis.requestAnimationFrame(()=>globalThis.requestAnimationFrame(resolve)));
  });
}

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3300';
mkdirSync('artifacts/v3', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, timezoneId: 'UTC', reducedMotion: 'reduce' });
      await context.addInitScript(() => {
        let seed=123456789;
        const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        Math.random=random;
        Object.defineProperty(crypto,'getRandomValues',{value:array=>{for(let i=0;i<array.length;i++)array[i]=Math.floor(random()*256);return array;}});
        Object.defineProperty(crypto,'randomUUID',{value:()=> 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(random()*16);return (c==='x'?r:(r&3)|8).toString(16);})});
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-10-12T00:00:00Z'));
      await context.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });

      page.on('pageerror', error => failures.push(error.message));
      await page.goto(base);
      await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const fonts = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, heading: getComputedStyle(document.querySelector('h1')).fontFamily, loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) }));
      check(/Urbanist/.test(fonts.body) && fonts.loaded.some(f => /Urbanist/.test(f)), `${width}/${theme}: Urbanist loaded`);
      check(fonts.loaded.some(f => /IBM Plex Mono/.test(f)), `${width}/${theme}: mono loaded`);
      check(/Krona One/.test(fonts.heading) && fonts.loaded.some(f => /Krona One/.test(f)), `${width}/${theme}: Krona One loaded`);
      await page.evaluate(() => document.fonts.ready);
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `artifacts/v3/overview-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
      for (const screen of ['overview', 'adoption', 'tools', 'reliability', 'sessions', 'callers', 'cost', 'protocol', 'live', 'settings', 'setup']) {
        await page.goto(`${base}/#${screen}`);
        await page.waitForTimeout(150);
        await page.locator('.signals-ui .panel').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        check(await page.locator('.brand svg[aria-label="mcpramen"]').count() === 1, `${screen}: wordmark present`);
        await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){globalThis.scrollTo(0,y);await new Promise(r=>setTimeout(r,40));}globalThis.scrollTo(0,0);});
      const charts=page.locator('.v3-chart');
      for(const chart of await charts.all()){check(await chart.locator('svg').count()===1,`${screen}: chart SVG`);check(await chart.locator('table.sr-only').count()===1,`${screen}: chart table twin`);check(await chart.getAttribute('tabindex')==='0',`${screen}: keyboard inspection`);}
      const expected={overview:['stacked-area','donut','funnel','heatmap','ribbon','sparkline'],adoption:['stacked-area','donut','bars','line'],tools:['ribbon','sankey','histogram'],reliability:['gauge','ribbon','band'],sessions:['gantt'],cost:['treemap','bars','sparkline'],protocol:['dot-grid'],live:['sparkline','bars']};
      if(await charts.count()){await charts.first().focus();await page.keyboard.press('ArrowRight');check(await page.getByRole('tooltip').count()===1,`${screen}: keyboard tooltip shown`);await page.locator('h1').click();}
      for(const kind of expected[screen]??[])check(await page.locator(`[data-chart="${kind}"]`).count()>0,`${screen}: ${kind} present`);
      const scan=await contrastAndClip(page,`${screen}/${width}/${theme}`);
      for(const f of scan.failures)check(false,`Contrast ${JSON.stringify(f)}`);
      for(const f of scan.clipped)check(false,`Clip ${JSON.stringify(f)}`);
      if(screen==='tools') {const markers=await page.locator('.chart-histogram svg .popin text').allTextContents();check(markers.length===3&&markers.every((m,i)=>m.startsWith(['p50','p95','p99'][i]+' ')),'Histogram has exactly percentile markers');check(!(await page.locator('.chart-histogram svg').textContent()).includes('NaN'),'No NaN histogram labels');}
      if(screen==='adoption'){check(await page.locator('.chart-bars').count()===2,'Adoption transport and protocol bars');check(await page.locator('.card').filter({has:page.getByRole('heading',{name:'Clients',exact:true})}).locator('table').count()===1,'Adoption client table');check(await page.locator('.chart-funnel,.chart-heatmap').count()===0,'Adoption uses conversion curve');}
      if(screen==='live')check(await page.locator('.chart-sparkline').count()===2&&await page.locator('.chart-area,.chart-donut').count()===0,'Live two sparklines and bars');
      if(screen==='protocol')check(await page.locator('.chart-dot-grid').count()===2&&await page.locator('.tile').count()===6,'Protocol two grids and six tiles');
      const tiles={adoption:['DAU','WAU','MAU','Stickiness','New users','D7 retention'],cost:['Context tokens','Per call','Heaviest tool','Tenants','Largest payload','Billing period'],protocol:['Sessions','Client capabilities','Server capabilities','Sampling','Elicitation','Tasks']};
      if(tiles[screen])check(JSON.stringify(await page.locator('.tile__label').allTextContents())===JSON.stringify(tiles[screen]),`${screen}: approved tile set`);
      if(screen==='adoption')check(await page.locator('.chart-donut').getAttribute('aria-label').then(v=>v.startsWith('Identity quality.')),'Adoption identity donut');
      if(screen==='cost')check(await page.locator('.chart-bars').count()===2&&await page.getByRole('heading',{name:'Where the context goes',exact:true}).count()===1,'Cost payload and tenant bars');

      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await page.screenshot({path:`artifacts/v3/${screen}-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
        const layout = await page.evaluate(() => ({
          krona: [...document.querySelectorAll('body *')].filter(el => getComputedStyle(el).fontFamily.includes('Krona One')).every(el => getComputedStyle(el).fontWeight === '400' && getComputedStyle(el).fontSynthesis === 'none'),
          mono: [...document.querySelectorAll('.eyebrow,.status-pill')].every(el => getComputedStyle(el).fontSize === '10.5px'),
          tables: [...document.querySelectorAll('.table-scroll')].every(el => el.scrollWidth <= el.clientWidth + 1 || el.tabIndex===0 && !!el.parentElement.querySelector('.table-scroll-hint'))
        }));
        check(layout.krona, `${screen} ${width}/${theme}: Krona weight and synthesis`);
        check(layout.mono, `${screen} ${width}/${theme}: 10.5px eyebrows and pills`);
        check(layout.tables, `${screen} ${width}/${theme}: mobile list or visible scroll affordance`);
        const size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
        check(size[0] <= size[1], `${screen} ${width}/${theme}: overflow ${size}`);
      }
      await page.goto(`${base}/#setup`);
      await page.getByRole('button', {name:'Python',exact:true}).click();
      check((await page.locator('.copy-block').last().innerText()).includes('signals.asgi(mcp.streamable_http_app())'), 'Python SDK snippet');
      await page.evaluate(() => document.fonts.ready);
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await page.screenshot({path:`artifacts/v3/setup-python-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await page.getByRole('button', {name:'Node.js',exact:true}).click();
      check((await page.locator('.copy-block').last().innerText()).includes('app.use(signals.express())'), 'Node SDK snippet');
      await page.evaluate(() => document.fonts.ready);
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await page.screenshot({path:`artifacts/v3/setup-node-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await page.getByRole('button', {name:'cURL',exact:true}).click();
      const curl = await page.locator('.copy-block pre').last().innerText();
      const batch = JSON.parse(curl.match(/-d '(.+)'/)[1]);
      check(batch.schema_version === 1 && batch.dropped === 0 && batch.source.instance_id === 'i_demo', 'spec batch envelope');
      check(batch.events[0].type === 'custom' && batch.events[0].attrs.name === 'hello', 'spec custom attrs');
      check(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(batch.events[0].id), 'raw example UUIDv7');
      check(curl.includes('Bearer $SIGNALS_KEY'), 'raw example authorization');
      await page.evaluate(() => document.fonts.ready);
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await page.screenshot({path:`artifacts/v3/setup-curl-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await page.goto(`${base}/#tools`);
      await page.getByRole('button', { name: 'search_products', exact: true }).click();
      check(await page.getByRole('dialog').isVisible(), 'tool details open');
      await page.getByRole('heading',{name:'Error split',exact:true}).waitFor();
      check(await page.getByRole('dialog').locator('.chart-stacked-area').count()===1,'tool calls and errors chart');
      check((await page.getByRole('dialog').innerText()).includes('Self-corrected'),'tool recovery metrics');
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await page.screenshot({path:`artifacts/v3/tool-drawer-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await page.keyboard.press('Escape');
      await page.goto(`${base}/#sessions`);
      await page.locator('.table-scroll tbody .row-button').first().click();
      await page.locator('.timeline li').first().waitFor();
      check(await page.locator('.timeline li').count()===6,'active session timeline contract events');
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await page.screenshot({path:`artifacts/v3/session-drawer-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await page.keyboard.press('Escape');
      await page.goto(`${base}/#callers`);
      await page.locator('.table-scroll tbody .row-button').first().click();
      await page.getByRole('heading',{name:/Activity history/}).waitFor();
      check(await page.getByRole('dialog').locator('svg[role="img"]').count()===1,'caller history chart');
      await page.keyboard.press('Escape');
      await page.getByRole('button', {name:'Network a18c72',exact:true}).click();
      await page.getByText('Network hash', {exact:true}).waitFor();
      check(await page.getByRole('dialog').locator('dd').filter({hasText:/^a18c72[0]{58}$/}).count()===1, 'network caller stored hash visible');
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
      await page.getByLabel('Digest recipient').fill('digest@example.com');
      await page.getByLabel('Token divisor', {exact:true}).fill('5');
      await page.getByRole('button',{name:'Save analytics settings',exact:true}).click();
      await page.getByText('Analytics settings saved.',{exact:true}).waitFor();
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
  for(const screen of ['overview','adoption','tools','reliability','sessions','callers','cost','protocol','live','settings','setup']) {
    await page.goto(`${base}/#${screen}`);
    await page.waitForTimeout(150);
    check(await page.locator('.signal-dot').first().evaluate(el => getComputedStyle(el).animationName === 'none'), `${screen}: reduced motion`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen}: 320px overflow`);
  }
  await page.getByLabel('Select project').selectOption('demo-truncated');
  for(const screen of ['overview','tools','settings']) {
    await page.goto(`${base}/#${screen}`);
    await page.getByText(/Catalogue truncated, coverage unknown/).first().waitFor();
    check(await page.locator('.dead-tool').count()===0, `${screen}: truncated catalogue hides dead tools`);
    check(await page.getByText('cancel_booking',{exact:true}).count()===0, `${screen}: no dead attention row`);
    if(screen==='tools')check(await page.getByRole('button',{name:'book_flight',exact:true}).isVisible(), 'truncated catalogue retains called tools');
    if(screen==='settings')check(await page.locator('select[aria-label$=" SLO class"]').count()===0, 'truncated catalogue does not offer unverified SLO classes');
  }
  await page.getByLabel('Select project').selectOption('demo');
  await page.getByLabel('book_flight SLO class').waitFor();
  await context.close();
} finally { await browser.close(); }
if(failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.');

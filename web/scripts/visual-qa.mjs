import { contrastAndClip } from './contrast-clip.mjs';
import { chromium } from '@playwright/test';
const iconsReady=async page=>{await page.mouse.move(0,0);await page.waitForFunction(()=>[...document.querySelectorAll('lord-icon')].every(e=>e.shadowRoot&&e.shadowRoot.querySelector('svg')),null,{timeout:15000}).catch(()=>{});await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'),null,{timeout:5000}).catch(()=>{});};
import { mkdirSync } from 'node:fs';

async function settleCharts(page) {
  // Exercise the same viewport trigger as a reader, including scrollable drawers. The
  // list is re-read on a detached handle: content now arrives after a quiet window, so
  // a chart collected a moment too early can be replaced while this runs.
  for(let attempt=0;;attempt++){
    try {
      for(const chart of await page.locator('.v3-chart').all()){
        await chart.scrollIntoViewIfNeeded();
        await chart.locator('svg[role=img]').waitFor();
      }
      break;
    } catch (error) {
      if(attempt===2||!/not attached to the DOM/.test(String(error)))throw error;
      await page.waitForTimeout(250);
    }
  }
  await page.evaluate(async()=>{
    await document.fonts.ready;
    for(const el of document.querySelectorAll('.drawer,.table-scroll')){el.scrollTop=0;el.scrollLeft=0;}
    globalThis.scrollTo(0,0);
    await new Promise(resolve=>globalThis.requestAnimationFrame(()=>globalThis.requestAnimationFrame(resolve)));
  });
}

// The workspace selector is a row of cards, so a test picks a project the way a reader
// does, and waits for the selection to settle before reading the screen.
const selectProject = async (page, id) => {
  await page.locator(`.project-card[data-project="${id}"]`).click();
  await page.waitForFunction(wanted => document.querySelector('.project-card.is-selected')?.dataset.project === wanted, id);
};
// A viewport point that genuinely lands on chart geometry: a donut arc's bounding-box
// centre is inside the ring hole, so a grid search is the honest way to hover one.
const pointOnRow = (page, selector) => page.evaluate(sel => {
  const figure = document.querySelector(sel);
  if (!figure) return null;
  const box = figure.getBoundingClientRect();
  for (let row = 1; row < 40; row++) for (let column = 1; column < 40; column++) {
    const x = box.left + box.width * column / 40, y = box.top + box.height * row / 40;
    const found = document.elementFromPoint(x, y);
    if (found && figure.contains(found) && found.closest('[data-row]')) return { x, y, row: found.closest('[data-row]').getAttribute('data-row') };
  }
  return null;
}, selector);
// Every rendered primary path of an animated icon, with the ink it actually paints and
// the colour its element inherits; the two must agree in both themes.
const inkOfIcons = page => page.evaluate(() => [...document.querySelectorAll('lord-icon')].map(el => {
  const path = el.shadowRoot?.querySelector('svg path.primary[stroke], svg path.primary[fill]');
  if (!path) return null;
  const style = getComputedStyle(path);
  return {
    where: el.closest('nav') ? 'nav' : el.closest('.icon-button,.button') ? 'button' : el.closest('.status-pill') ? 'pill' : el.closest('.emptychart') ? 'empty' : el.closest('.project-card') ? 'card' : 'other',
    ink: style.stroke === 'none' ? style.fill : style.stroke,
    color: getComputedStyle(el).color,
  };
}).filter(Boolean));

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3300';
mkdirSync('artifacts/v3', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };
async function scanSurface(page,label){
 const scan=await contrastAndClip(page,label);
 for(const f of scan.failures)check(false,`Contrast ${JSON.stringify(f)}`);
 for(const f of scan.clipped)check(false,`Clip ${JSON.stringify(f)}`);
}
try {
  for (const theme of ['light', 'dark']) {
    const inkPlaces = new Set();
    for (const width of [390, 1280, 1440]) {
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
      await iconsReady(page);await page.screenshot({ path: `artifacts/v3/overview-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
      for (const screen of ['overview', 'adoption', 'tools', 'reliability', 'sessions', 'callers', 'cost', 'protocol', 'live', 'settings', 'setup']) {
        await page.goto(`${base}/#${screen}`);
        await page.waitForTimeout(150);
        await page.locator('.signals-ui .panel').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        check(await page.locator('.brand svg[aria-label="mcpramen"]').count() === 1, `${screen}: wordmark present`);
        await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){globalThis.scrollTo(0,y);await new Promise(r=>setTimeout(r,40));}globalThis.scrollTo(0,0);});
      await page.waitForFunction(()=>{const all=[...document.querySelectorAll('lord-icon')];return all.length>0&&all.every(e=>e.shadowRoot&&e.shadowRoot.querySelector('svg'));},null,{timeout:15000});check(await page.locator('.topbar nav lord-icon svg').count()===10,`${screen}/${width}: ten animated nav icons rendered`);
      const charts=page.locator('.v3-chart');
      for(const chart of await charts.all()){check(await chart.locator('svg[role=img]').count()===1,`${screen}: chart SVG`);check(await chart.locator('table.sr-only').count()===1,`${screen}: chart table twin`);check(await chart.getAttribute('tabindex')==='0',`${screen}: keyboard inspection`);}
      const expected={overview:['stacked-area','donut','funnel','heatmap','ribbon','sparkline'],adoption:['stacked-area','donut','bars','line'],tools:['ribbon','sankey','histogram'],reliability:['gauge','ribbon','band'],sessions:['gantt'],cost:['treemap','bars','sparkline'],protocol:['dot-grid'],live:['sparkline','bars']};
      // Item 1: the ink of every rendered icon follows the text colour, in both themes.
      const ink=await inkOfIcons(page);
      check(ink.length>0,`${screen}/${width}/${theme}: no animated icon exposed a primary path`);
      check(ink.every(i=>i.ink===i.color),`${screen}/${width}/${theme}: icon ink does not follow the text colour ${JSON.stringify(ink.filter(i=>i.ink!==i.color).slice(0,3))}`);
      for(const place of ink.map(i=>i.where))inkPlaces.add(place);
      // Item 2: every analytics card and tile carries an explanation, and one opens,
      // closes and returns focus by keyboard, by Escape, by click and by outside click.
      const infoButtons=page.locator('.signals-ui .info-button');
      const infoCount=await infoButtons.count();
      const titlesWithout=await page.locator('.signals-ui .card__title-row, .signals-ui .panel-title-row').evaluateAll(els=>els.filter(el=>!el.querySelector('.info-button')).map(el=>el.textContent.trim()));
      const tilesWithout=await page.locator('.signals-ui .tile__label').evaluateAll(els=>els.filter(el=>!el.querySelector('.info-button')).map(el=>el.textContent.trim()));
      if(screen==='setup'){check(infoCount===0,'setup carries info popovers');}
      else {
       check(infoCount>0,`${screen}: no info popovers`);
       check(tilesWithout.length===0,`${screen}: tiles with no explanation ${JSON.stringify(tilesWithout)}`);
       // Settings' key and user panels are forms with their own inline hints; its two
       // analytics cards must still explain themselves.
       if(screen==='settings')for(const title of ['Alert rules','Analytics settings'])check(await page.locator('.panel').filter({has:page.getByRole('heading',{name:title,exact:true})}).locator('.info-button').count()===1,`settings: ${title} has no explanation`);
       else check(titlesWithout.length===0,`${screen}: cards with no explanation ${JSON.stringify(titlesWithout)}`);
      }
      if(infoCount){
       const trigger=infoButtons.first();
       await trigger.scrollIntoViewIfNeeded();
       await trigger.focus();await page.keyboard.press('Enter');
       const pop=page.locator('.info-pop');
       check(await pop.count()===1,`${screen}: Enter did not open an explanation`);
       check(await trigger.getAttribute('aria-expanded')==='true',`${screen}: aria-expanded is not set while open`);
       check(await pop.evaluate(el=>document.activeElement===el),`${screen}: focus did not move into the explanation`);
       check(await pop.evaluate(el=>{const id=el.getAttribute('aria-labelledby');return !!document.getElementById(id??'')?.textContent?.trim();}),`${screen}: the explanation is not labelled by its card title`);
       check(await pop.evaluate((el,w)=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=w+.5&&r.top>=0&&r.bottom<=globalThis.innerHeight+.5;},width),`${screen}/${width}: the explanation clips the viewport`);
       check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${screen}/${width}: an open explanation widened the page`);
       await scanSurface(page,`${screen}/${width}/${theme}/info`);
       await page.keyboard.press('Escape');
       check(await page.locator('.info-pop').count()===0,`${screen}: Escape did not close the explanation`);
       check(await trigger.evaluate(el=>document.activeElement===el),`${screen}: focus did not return to the button`);
       await trigger.click();
       check(await page.locator('.info-pop').count()===1,`${screen}: a click did not open the explanation`);
       await page.locator('h1').click();
       check(await page.locator('.info-pop').count()===0,`${screen}: an outside click did not close the explanation`);
      }
      // Item 5: a pointer click opens nothing; a key press opens a readout whose text is
      // the table twin's own headers and formatted values.
      if(await charts.count()){
       const figure=charts.first();
       await figure.scrollIntoViewIfNeeded();
       await figure.click({position:{x:6,y:6}});
       check(await page.locator('.chart-key-tooltip').count()===0,`${screen}: a pointer click opened the chart readout`);
       await figure.focus();await page.keyboard.press('ArrowRight');
       check(await page.getByRole('tooltip').count()===1,`${screen}: keyboard tooltip shown`);
       const readout=(await page.getByRole('tooltip').first().textContent())??'';
       const headers=await figure.locator('table.sr-only thead th').allTextContents();
       check(headers.length>0&&headers.every(h=>readout.includes(`${h}: `)),`${screen}: the readout and the table twin disagree ${JSON.stringify({headers,readout})}`);
       check(!/\b(Bucket|Value)\b/.test(headers.join(' ')),`${screen}: a chart still labels its axis "Bucket"/"Value": ${JSON.stringify(headers)}`);
       await page.locator('h1').click();
      }
      // Every chart on the screen, not just the first: a sparkline handed values without
      // their own timestamps used to fall back to "Bucket: 2".
      const bucketColumns=await page.locator('.v3-chart table.sr-only thead th').evaluateAll(cells=>cells.map(cell=>cell.textContent?.trim()).filter(text=>text==='Bucket'||text==='Value'));
      check(bucketColumns.length===0,`${screen}: ${bucketColumns.length} chart columns still read "Bucket"/"Value"`);
      for(const kind of expected[screen]??[])check(await page.locator(`[data-chart="${kind}"]`).count()>0,`${screen}: ${kind} present`);
      const tileColumns=await page.locator('.signals-ui>.tiles').evaluateAll(els=>els.map(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length));
      const compactScreens=['tools','reliability','sessions','cost','protocol'];const expectedColumns=compactScreens.includes(screen)?(width>=1024?6:width>600?3:2):(width>=1024?3:1);
      check(tileColumns.every(n=>n===expectedColumns),`${screen}/${width}: ${compactScreens.includes(screen)?'compact':'shared'} tile columns`);
      for(const spark of await page.locator('.tile__spark svg[role=img]').all()){
        check(await spark.evaluate((el,min)=>el.getBoundingClientRect().height>=min,compactScreens.includes(screen)?30:96),`${screen}/${width}: sparkline plot height`);
        check(await spark.evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.closest('.tile').clientWidth)<=2),`${screen}/${width}: full-width sparkline`);
      }
      if(width>=1024){
        const fullWidth={overview:['Calls by client','Client mix','Tools needing attention'],adoption:['Clients','Transport and protocol'],tools:['Tool health','Tool performance','Top tool paths'],sessions:['The story of a connection','Sessions by client'],cost:['By tenant','Billing periods'],protocol:['Capability matrix'],settings:['Alert rules','Analytics settings']};
        for(const title of fullWidth[screen]??[]){
          const card=page.locator('.grid > .panel').filter({has:page.getByRole('heading',{name:title,exact:true})});
          check(await card.evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement.getBoundingClientRect().width)<2),`${screen}/${width}: ${title} occupies a full row`);
        }
      }
      await scanSurface(page,`${screen}/${width}/${theme}`);
      if(screen==='tools') {const markers=await page.locator('.chart-histogram svg .popin text').allTextContents();check(markers.length===3&&markers.every((m,i)=>m.startsWith(['p50','p95','p99'][i]+' ')),'Histogram has exactly percentile markers');check(!(await page.locator('.chart-histogram svg[role=img]').textContent()).includes('NaN'),'No NaN histogram labels');}
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
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/${screen}-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
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
      // Item 5, pointer side: the hover readout appears only after its 120 ms delay, on
      // each chart kind that carries one, and never escapes the plot box.
      for(const [screen,kinds] of Object.entries({overview:['sparkline','donut','funnel'],tools:['sankey','histogram'],cost:['treemap'],adoption:['bars']})){
       await page.goto(`${base}/#${screen}`);
       await page.locator('.signals-ui .v3-chart').first().waitFor();
       await settleCharts(page);
       for(const kind of kinds){
        const selector=`[data-chart="${kind}"]`;
        await page.locator(selector).first().scrollIntoViewIfNeeded();
        const at=await pointOnRow(page,selector);
        if(!check(at!==null,`${screen}/${kind}: no hoverable geometry`))continue;
        await page.mouse.move(at.x,at.y);
        await page.waitForTimeout(60);
        check(await page.locator(`${selector} .chart-key-tooltip--pointer`).count()===0,`${screen}/${kind}: the hover readout appeared before its 120 ms delay`);
        const tip=page.locator(`${selector} .chart-key-tooltip--pointer`).first();
        // Wait rather than sample once: the delay is a floor, not a deadline, and this
        // suite shares the box with whatever else is building.
        if(!check(await tip.waitFor({timeout:5000}).then(()=>true,()=>false),`${screen}/${kind}: no hover readout`))continue;
        check(/: \S/.test((await tip.textContent())??''),`${screen}/${kind}: the hover readout is unlabelled`);
        check(await page.locator(`${selector} .chart-tip-layer`).evaluate(el=>{const t=el.firstElementChild.getBoundingClientRect(),f=el.closest('figure').getBoundingClientRect();return t.left>=f.left-1&&t.right<=f.right+1&&t.top>=f.top-1&&t.bottom<=f.bottom+1;}),`${screen}/${kind}: the hover readout leaves the plot box`);
        await page.mouse.move(0,0);
        await page.waitForTimeout(60);
        check(await page.locator(`${selector} .chart-key-tooltip--pointer`).count()===0,`${screen}/${kind}: the hover readout outstayed the pointer`);
       }
      }
      // The stacked area keeps its own crosshair; hovering the plot must raise exactly one.
      await page.goto(`${base}/#overview`);
      await page.locator('.chart-stacked-area svg').first().waitFor();
      await settleCharts(page);
      const crosshair=page.locator('.chart-stacked-area .tip');
      check(await crosshair.count()===1,`${width}/${theme}: the stacked area has ${await crosshair.count()} crosshair tooltips, expected 1`);
      const plot=await page.locator('.chart-stacked-area svg rect.hit').first().boundingBox();
      await page.mouse.move(plot.x+plot.width/2,plot.y+plot.height/2);
      await page.waitForTimeout(120);
      check(await crosshair.evaluate(el=>el.classList.contains('on')&&el.textContent.trim().length>0),`${width}/${theme}: the stacked-area crosshair did not read out on hover`);
      check(await page.locator('.chart-stacked-area .xh').evaluate(el=>getComputedStyle(el).opacity==='1'),`${width}/${theme}: the stacked-area crosshair line stayed hidden`);
      await page.mouse.move(0,0);
      await page.waitForTimeout(80);
      // At 24 hours the collector serves one daily calls point and twenty-four hourly
      // latency points, so a sparkline that did not carry its own timestamps read out
      // "Bucket: 2". Walk every chart's readout on that range.
      await page.goto(`${base}/#overview`);
      await page.getByRole('button',{name:'24 hours',exact:true}).click();
      await page.locator('.tile__spark .chart-sparkline svg').first().waitFor();
      await settleCharts(page);
      for(const figure of await page.locator('.v3-chart').all()){
       await figure.scrollIntoViewIfNeeded();
       await figure.focus();
       await page.keyboard.press('ArrowRight');
       const readout=(await page.locator('.chart-key-tooltip').first().textContent())??'';
       check(!/Bucket/.test(readout),`${width}/${theme}: a 24-hour readout says "Bucket": ${JSON.stringify(readout)}`);
       await page.locator('h1').click();
      }
      const p95Tile=page.locator('.tile').filter({has:page.getByText('p95 latency',{exact:true})});
      await p95Tile.locator('.v3-chart').scrollIntoViewIfNeeded();
      await p95Tile.locator('.v3-chart').focus();
      await page.keyboard.press('ArrowRight');
      const p95Readout=(await p95Tile.locator('.chart-key-tooltip').first().textContent())??'';
      check(/^Date: \d\d:\d\d p95 latency: [\d,]+ ms\s*$/.test(p95Readout),`${width}/${theme}: the 24-hour p95 readout is ${JSON.stringify(p95Readout)}, expected an hour timestamp and a value in ms`);
      await page.locator('h1').click();
      // The Below-SLO tile and its meta read the targets the collector applied.
      await page.goto(`${base}/#tools`);
      await page.locator('.tile').first().waitFor();
      const belowSlo=page.locator('.tile').filter({has:page.getByText('Below SLO',{exact:true})});
      const reliability=await page.evaluate(async()=>{const module=await import('/src/demo.ts');return module.demoClient.analytics('demo','reliability',{range:'24h'});});
      const want=`read ${reliability.slo.find(s=>s.class==='read').target}% · mutate ${reliability.slo.find(s=>s.class==='mutate').target}%`;
      check((await belowSlo.locator('.tile__meta').textContent())===want,`${width}/${theme}: the Below SLO meta is ${JSON.stringify(await belowSlo.locator('.tile__meta').textContent())}, expected ${JSON.stringify(want)}`);
      await page.goto(`${base}/#overview`);
      await page.getByRole('button',{name:'7 days',exact:true}).click();
      await page.getByRole('heading',{name:'Calls by client'}).waitFor();

      // Item 3 and 4: the card selection survives a reload and a shared link, and a
      // reload with a cached account never shows the Connecting or Reading screen.
      await page.goto(`${base}/#overview`);
      await page.getByRole('heading',{name:'Calls by client'}).waitFor();
      await selectProject(page,'demo-fresh');
      check(await page.evaluate(()=>globalThis.localStorage.getItem('signals-project'))==='demo-fresh',`${width}/${theme}: the project was not stored`);
      check(await page.evaluate(()=>globalThis.location.hash)==='#overview?project=demo-fresh',`${width}/${theme}: the project is not in the shareable hash`);
      await page.reload();
      await page.getByRole('heading',{name:'Calls by client'}).waitFor();
      check(await page.locator('.project-card.is-selected').getAttribute('data-project')==='demo-fresh',`${width}/${theme}: the project did not survive a reload`);
      check(await page.locator('.login-page, .loading-state').count()===0,`${width}/${theme}: a reload showed a Connecting or Reading screen`);
      check(await page.locator('.project-card[aria-pressed=true]').count()===1&&await page.locator('.project-card.is-selected lord-icon').count()===1,`${width}/${theme}: the selected card is not marked`);
      const cardRows=await page.locator('.project-cards').evaluate(el=>({direction:getComputedStyle(el).flexDirection,wrap:getComputedStyle(el).flexWrap,rows:[...new Set([...el.children].map(card=>Math.round(card.getBoundingClientRect().top)))].length,cards:el.children.length}));
      if(width>=1280)check(cardRows.direction==='row'&&cardRows.wrap==='wrap'&&cardRows.rows===1,`${width}/${theme}: four project cards should sit on one row, measured ${JSON.stringify(cardRows)}`);
      else check(cardRows.direction==='column'&&cardRows.rows===cardRows.cards,`${width}/${theme}: project cards should stack one per row, measured ${JSON.stringify(cardRows)}`);
      // Past six projects the row scrolls, with the hint and the focusable region.
      await page.goto(`${base}/#overview?projects=9`);
      await page.getByRole('heading',{name:'Calls by client'}).waitFor();
      check(await page.locator('.project-card').count()===9,`${width}/${theme}: nine project cards`);
      check(await page.locator('.project-cards').evaluate(el=>getComputedStyle(el).flexWrap==='nowrap'&&el.scrollWidth>el.clientWidth+1&&el.tabIndex===0&&el.getAttribute('role')==='region'),`${width}/${theme}: more than six projects do not scroll with an affordance`);
      check(await page.locator('.project-strip .table-scroll-hint').count()===1,`${width}/${theme}: the project row scrolls with no hint`);
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}/${theme}: the scrolling project row widened the page`);
      // A stored id that no longer exists falls back to the first project.
      await page.evaluate(()=>globalThis.localStorage.setItem('signals-project','deleted-project'));
      // A distinct URL with no project query, so the document reloads and the stored id
      // is the only thing the shell has to go on.
      await page.goto(`${base}/?v4=stale-project`);
      await page.getByRole('heading',{name:'Calls by client'}).waitFor();
      check(await page.locator('.project-card.is-selected').getAttribute('data-project')==='demo',`${width}/${theme}: a stale stored project id did not fall back`);

      await selectProject(page,'demo-many-clients');
      await page.goto(`${base}/#overview`);
      await page.getByRole('heading',{name:'Client mix',exact:true}).waitFor();
      await settleCharts(page);
      const mix=page.locator('.client-mix');
      check(await mix.locator('.legendlist .r').count()===27,`${width}/${theme}: 27 client legend entries`);
      check(await mix.locator('.chart-donut .stroke-draw').count()===26,`${width}/${theme}: zero-call client has no arc`);
      const colorsMatch=await mix.evaluate(el=>{
        const dots=[...el.querySelectorAll('.legendlist i')].slice(0,-1).map(dot=>getComputedStyle(dot).backgroundColor);
        const arcs=[...el.querySelectorAll('.stroke-draw')].map(arc=>getComputedStyle(arc).stroke);
        return JSON.stringify(dots)===JSON.stringify(arcs);
      });
      check(colorsMatch,`${width}/${theme}: legend colors match client arcs`);
      // The twin now carries the unit with the value ("22,178 calls"), which is what the
      // keyboard readout and the pointer tooltip read, so parse the number back out.
      const cells=await mix.locator('table.sr-only tbody tr').evaluateAll(rows=>rows.map(row=>row.lastElementChild.textContent));
      const values=cells.map(text=>Number(text.replace(/[^0-9.]/g,'')));
      check(cells.every(text=>/ calls$/.test(text)),`${width}/${theme}: donut twin carries the call unit`);
      check(values.length===27&&values.at(-1)===0&&values[0]>values[25]&&values[0]>100,`${width}/${theme}: donut values are raw uneven call counts`);
      if(width>=1024){
        check(await mix.locator('.legendlist').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length>=2),`${width}/${theme}: multi-column 27-client legend`);
        check(await mix.evaluate(el=>{const card=el.closest('.card'),box=card.getBoundingClientRect();return Math.abs(box.width-card.parentElement.getBoundingClientRect().width)<2&&[...card.parentElement.children].filter(c=>c!==card).every(c=>{const b=c.getBoundingClientRect();return b.bottom<=box.top||b.top>=box.bottom;});}),`${width}/${theme}: no card beside client mix`);
      }
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await scanSurface(page,`many-clients/${width}/${theme}`);
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/many-clients-overview-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      // A project whose identities are all younger than a week cannot measure day-7
      // return. The funnel must still paint the four steps it did measure and keep
      // day 7 as a null step inside the chart.
      await selectProject(page,'demo-fresh');
      await page.goto(`${base}/#overview`);
      await page.waitForTimeout(150);
      await page.getByRole('heading', {name:'Activation funnel',exact:true}).waitFor();
      await settleCharts(page);
      const funnelCard=page.locator('.card').filter({has:page.getByRole('heading',{name:'Activation funnel',exact:true})});
      check(await funnelCard.locator('.emptychart').count()===0,`${width}/${theme}: null day-7 step does not blank the funnel`);
      check(await funnelCard.locator('.chart-funnel svg.growx').count()===4,`${width}/${theme}: four painted funnel steps`);
      check(await funnelCard.locator('.chart-funnel rect.nullstep').count()===1,`${width}/${theme}: one null funnel step`);
      check((await funnelCard.locator('.chart-funnel svg[role=img] text').allTextContents()).includes('Waiting · 0 eligible'),`${width}/${theme}: null step waiting caption and eligible note`);
      check(JSON.stringify(await funnelCard.locator('.chart-funnel table.sr-only tbody tr').last().locator('td').allTextContents())===JSON.stringify(['returned_day_7','—','—']),`${width}/${theme}: null step table twin`);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await scanSurface(page,`funnel-null/${width}/${theme}`);
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/funnel-null-overview-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await page.goto(`${base}/#adoption`);
      await page.waitForTimeout(150);
      await page.getByRole('heading', {name:'Conversion',exact:true}).waitFor();
      await settleCharts(page);
      const curve=page.locator('.chart-line');
      check(await curve.locator('svg[role=img] circle').count()===4,`${width}/${theme}: conversion curve ends at the last counted step`);
      check(!(await curve.locator('svg[role=img]').textContent()).includes('returned day 7'),`${width}/${theme}: conversion curve plots no null step`);
      check(JSON.stringify(await curve.locator('table.sr-only tbody tr').last().locator('td').allTextContents())===JSON.stringify(['returned_day_7','—','—']),`${width}/${theme}: conversion table twin`);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await scanSurface(page,`conversion-null/${width}/${theme}`);
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/funnel-null-adoption-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await selectProject(page,'demo');
      await page.getByRole('heading', {name:'Conversion',exact:true}).waitFor();
      await page.goto(`${base}/#setup`);
      await page.getByRole('button', {name:'Python',exact:true}).click();
      check((await page.locator('.copy-block').last().innerText()).includes('signals.asgi(mcp.streamable_http_app())'), 'Python SDK snippet');
      await page.evaluate(() => document.fonts.ready);
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/setup-python-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await page.getByRole('button', {name:'Node.js',exact:true}).click();
      check((await page.locator('.copy-block').last().innerText()).includes('app.use(signals.express())'), 'Node SDK snippet');
      await page.evaluate(() => document.fonts.ready);
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/setup-node-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
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
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/setup-curl-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
      await page.goto(`${base}/#tools`);
      await page.getByRole('button', { name: 'search_products', exact: true }).click();
      check(await page.getByRole('dialog').isVisible(), 'tool details open');
      await page.getByRole('heading',{name:'Error split',exact:true}).waitFor();
      check(await page.getByRole('dialog').locator('.chart-stacked-area').count()===1,'tool calls and errors chart');
      check((await page.getByRole('dialog').innerText()).includes('Self-corrected'),'tool recovery metrics');
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await scanSurface(page,`tool-drawer/${width}/${theme}`);
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/tool-drawer-${width}-${theme}.png`,fullPage:true,animations:'disabled',mask:[page.locator('.topbar')]}); // the dialog backdrop blur over the top bar rasterises non-deterministically
      await page.keyboard.press('Escape');
      await page.goto(`${base}/#sessions`);
      await page.locator('.table-scroll tbody .row-button').first().click();
      await page.locator('.timeline li').first().waitFor();
      check(await page.locator('.timeline li').count()===6,'active session timeline contract events');
      await settleCharts(page);
      await page.mouse.move(0,0);
      await page.waitForTimeout(500);
      await scanSurface(page,`session-drawer/${width}/${theme}`);
      await iconsReady(page);await page.screenshot({path:`artifacts/v3/session-drawer-${width}-${theme}.png`,fullPage:true,animations:'disabled',mask:[page.locator('.topbar')]}); // the dialog backdrop blur over the top bar rasterises non-deterministically
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
      check(await page.locator('.event-row summary[data-event-id]').count()>0,'event rows are addressable by event id');
      await page.getByLabel('Event type').selectOption('');
      await page.getByRole('button', {name:'Resume', exact:true}).click();
      await page.goto(`${base}/#settings`);
      await page.getByLabel('Digest recipient').fill('digest@example.com');
      await page.getByLabel('Token divisor', {exact:true}).fill('5');
      await page.getByLabel('Error-budget burn threshold').fill('3');
      await page.getByLabel('read SLO target (%)').fill('80');
      await page.getByRole('button',{name:'Save analytics settings',exact:true}).click();
      await page.getByText('Analytics settings saved.',{exact:true}).waitFor();
      // The error-budget dial is scaled by the project's own burn alert, and the Tools
      // tile by the project's own targets; both used to be hardcoded.
      await page.goto(`${base}/#reliability`);
      await page.locator('.chart-gauge svg').first().waitFor();
      check((await page.locator('.chart-gauge svg .burn-alert-label').allTextContents()).every(text=>text==='3×'),`${width}/${theme}: the error-budget dial still marks a fixed burn: ${JSON.stringify(await page.locator('.chart-gauge svg .burn-alert-label').allTextContents())}`);
      check((await page.locator('.card').filter({has:page.getByRole('heading',{name:'Error budget',exact:true})}).locator('.card__sub').textContent())?.includes('3× alert line'),`${width}/${theme}: the error-budget subtitle still names a fixed burn`);
      await page.goto(`${base}/#tools`);
      await page.locator('.tile').first().waitFor();
      check((await page.locator('.tile').filter({has:page.getByText('Below SLO',{exact:true})}).locator('.tile__meta').textContent())==='read 80% · mutate 98%',`${width}/${theme}: the Below SLO meta did not follow the saved read target`);
      await page.goto(`${base}/#settings`);
      await page.getByRole('heading',{name:'SLOs, alerts and digest',exact:true}).waitFor();
      await page.getByLabel('Key label').fill('QA key');
      await page.getByRole('button', {name:'Create key', exact:true}).click();
      check(await page.getByRole('dialog').isVisible(), 'new key revealed once');
      await page.getByRole('button', {name:'I’ve saved it'}).click();
      await page.getByRole('button', {name:'Revoke QA key', exact:true}).click();
      await page.getByRole('dialog').getByRole('button', {name:'Revoke key', exact:true}).click();
      check(await page.getByText('Key revoked.', {exact:true}).isVisible(), 'key revoked');
      await context.close();
    }
    check(['nav','button','pill','empty'].every(place=>inkPlaces.has(place)),`${theme}: icon ink not measured in every place ${JSON.stringify([...inkPlaces])}`);
  }
  const context = await browser.newContext({ viewport: {width:320,height:900}, reducedMotion:'reduce' });
  const page = await context.newPage();
  for(const screen of ['overview','adoption','tools','reliability','sessions','callers','cost','protocol','live','settings','setup']) {
    await page.goto(`${base}/#${screen}`);
    await page.waitForTimeout(150);
    check(await page.locator('.topbar nav lord-icon').count()===10&&await page.locator('lord-icon[trigger]').count()===0, `${screen}: reduced motion leaves icons static`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen}: 320px overflow`);
    await scanSurface(page,`${screen}/320`);
    for(const label of await page.locator('.tile__label').all())check(await label.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1),`${screen}: 320px complete tile label`);
  }
  await selectProject(page,'demo-truncated');
  for(const screen of ['overview','tools','settings']) {
    await page.goto(`${base}/#${screen}`);
    await page.getByText(/Catalogue truncated, coverage unknown/).first().waitFor();
    check(await page.locator('.dead-tool').count()===0, `${screen}: truncated catalogue hides dead tools`);
    check(await page.getByText('cancel_booking',{exact:true}).count()===0, `${screen}: no dead attention row`);
    if(screen==='tools')check(await page.getByRole('button',{name:'book_flight',exact:true}).isVisible(), 'truncated catalogue retains called tools');
    if(screen==='settings')check(await page.locator('select[aria-label$=" SLO class"]').count()===0, 'truncated catalogue does not offer unverified SLO classes');
  }
  await selectProject(page,'demo');
  await page.getByLabel('book_flight SLO class').waitFor();
  await context.close();
} finally { await browser.close(); }
if(failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Visual QA passed: v3 chart SVG/table twins, painted funnel with a null day-7 step and a conversion curve that ends at the last counted step, both drawer captures; 11 screens, light/dark, 390/1280/1440 widths, three-column tiles, 108px sparklines, full-row entity lists, 27-client legend, zero-call arcs, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.');

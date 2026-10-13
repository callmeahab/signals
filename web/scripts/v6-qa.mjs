import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const base=process.env.BASE_URL??'http://127.0.0.1:23336';
const out='artifacts/v6';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chromium'});
const evidence=[];
try {
 for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:theme});
  await context.addInitScript(theme=>{
   globalThis.localStorage.setItem('signals-theme',theme);
   globalThis.__skeleton={appearances:0,afterContent:0,painted:false,showing:false};
   new globalThis.MutationObserver(()=>{
    const state=globalThis.__skeleton;
    const showing=!!document.querySelector('.signals-ui > .loading-state');
    if(showing&&!state.showing){state.appearances++;if(state.painted)state.afterContent++;}
    state.showing=showing;
    if(document.querySelector('.tile,.signals-ui .card'))state.painted=true;
   }).observe(document,{subtree:true,childList:true});
  },theme);
  // Exercise the real hooks with deliberately staggered answers, including the
  // original failure case: supporting reads land after the first content paint.
  await context.route('**/src/demo.ts*',async route=>{
   const response=await route.fetch();
   const body=await response.text();
   await route.fulfill({response,body:body+`\nconst originalAnalytics=demoClient.analytics;demoClient.analytics=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,args[1]==='overview'?450:1100));const data=await originalAnalytics(...args);if(args[0]==='demo-fresh'&&args[1]==='overview')data.tiles.success_rate.value=null;return data;};`});
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const series=async name=>{
   const start=Date.now(),frames=[];
   for(let i=0;i<18;i++){
    await page.waitForTimeout(Math.max(0,start+i*100-Date.now()));
    const facts=await page.evaluate(()=>({at:Math.round(globalThis.performance.now()),html:getComputedStyle(document.documentElement).backgroundColor,body:document.body&&getComputedStyle(document.body).backgroundColor,skeleton:{...globalThis.__skeleton},cards:document.querySelectorAll('.tile,.card').length,pending:[...document.querySelectorAll('.tile__spark.card-pending')].map(el=>({height:getComputedStyle(el).height,compact:!!el.closest('.tiles--compact')}))}));
    for(const pending of facts.pending)assert.equal(pending.height,pending.compact?'38px':'108px','pending sparkline changed the chart frame height');
    assert.notEqual(facts.html,'rgb(255, 255, 255)');assert.notEqual(facts.body,'rgb(255, 255, 255)');
    const png=await page.screenshot({path:`${out}/${name}-${String(i*100).padStart(4,'0')}.png`});
    const corner=await page.evaluate(async src=>{const img=new globalThis.Image();img.src=src;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(0,img.height-1,1,1).data];},`data:image/png;base64,${png.toString('base64')}`);
    assert.ok(corner.slice(0,3).some(v=>v<245),`${name}: white frame ${i}`);frames.push({...facts,corner});
   }
   const skeleton=await page.evaluate(()=>globalThis.__skeleton);assert.ok(skeleton.appearances<=1,JSON.stringify(skeleton));assert.equal(skeleton.afterContent,0);evidence.push({name,frames});
  };
  await page.goto(`${base}/#overview`,{waitUntil:'commit'});await series(`cold-${theme}`);
  assert.equal((await page.evaluate(()=>globalThis.__skeleton)).appearances,1,'delayed cold load did not exercise the skeleton');
  await page.locator('.card-pending').waitFor({state:'detached'});
  const button=page.locator('.info-button').first();
  const geometry=await button.evaluate(el=>{const r=el.getBoundingClientRect(),card=el.closest('.tile,.card,.panel').getBoundingClientRect();return {width:r.width,height:r.height,right:card.right-r.right,icon:el.querySelector('lord-icon').getBoundingClientRect().width};});
  assert.deepEqual([geometry.width,geometry.height,geometry.icon],[40,40,20]);assert.ok(geometry.right<20);
  await button.hover();await page.waitForTimeout(160);assert.equal(await page.locator('.info-pop').count(),1);
  const pop=page.locator('.info-pop');
  assert.equal(await pop.locator('.info-pop__title').textContent(),'Tool callscalls');assert.ok(await pop.locator('.info-pop__computed').textContent());
  const style=await pop.evaluate(el=>{const s=getComputedStyle(el);return {family:s.fontFamily,transform:s.textTransform,white:s.whiteSpace,spacing:s.letterSpacing};});
  assert.ok(style.family.includes('Urbanist'));assert.equal(style.transform,'none');assert.equal(style.white,'normal');assert.equal(style.spacing,'normal');
  await page.screenshot({path:`${out}/info-${theme}.png`});
  await button.click();await page.mouse.move(0,0);await page.waitForTimeout(160);assert.equal(await pop.count(),1);
  await page.keyboard.press('Escape');assert.equal(await pop.count(),0);
  assert.equal(await page.locator('.updated-ago,.signal-dot').count(),0);
  assert.equal(await page.locator('.project-status-dot').count(),4);
  assert.equal(await page.locator('.project-card__status.status-dead lord-icon').first().evaluate(el=>el.getBoundingClientRect().width),14);
  assert.equal(await page.locator('.topbar-actions lord-icon').first().evaluate(el=>el.getBoundingClientRect().width),22);
  assert.equal(await page.locator('.mobile-menu').isVisible(),false);
  assert.equal(await page.locator('.card .info-button lord-icon').first().evaluate(el=>el.getBoundingClientRect().width),24);
  // These assertions exercise the same observer fed by the client's existing reads.
  const statuses=await page.evaluate(async()=>{const m=await import('/src/project-status.ts');const path='/projects/qa/analytics/overview?range=7d';const values=[];m.recordProjectRead(path,false,{tiles:{active_users:{value:2}}});values.push(m.projectStatus('qa',false));values.push(m.projectStatus('qa',false,'24h'));m.recordProjectRead(path,false,{tiles:{active_users:{value:0}}});values.push(m.projectStatus('qa',false));m.recordProjectRead(path,true);values.push(m.projectStatus('qa',false));return values;});
  assert.deepEqual(statuses,['healthy','warn','warn','error']);
  await page.locator('.project-card').nth(1).click();await series(`switch-${theme}`);
  await page.locator('.project-card').nth(2).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.tile')].find(el=>el.querySelector('.tile__label span')?.textContent==='Tool success')?.querySelector('strong')?.textContent==='No data yet');
  const cdp=await context.newCDPSession(page);await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await page.reload({waitUntil:'commit'});await series(`reload-${theme}`);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await page.locator('.info-button').first().click();
  const sheet=await page.locator('.info-pop').boundingBox();assert.ok(sheet.x>=0&&sheet.x+sheet.width<=390&&sheet.y+sheet.height<=844);assert.ok(Math.abs(sheet.y+sheet.height-836)<2);
  await page.screenshot({path:`${out}/info-mobile-${theme}.png`});
  assert.deepEqual(errors,[]);await context.close();
 }
 // An initial failure and retry are still the same navigation: the skeleton
 // episode is spent even when no successful content has painted yet.
 const retryContext=await browser.newContext({viewport:{width:1440,height:1000}});
 await retryContext.route('**/src/demo.ts*',async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:(await response.text())+`\nconst originalRetryAnalytics=demoClient.analytics;demoClient.analytics=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,650));if(args[1]==='overview'&&!globalThis.__recovered)throw new Error('Temporary test failure');return originalRetryAnalytics(...args);};`});
 });
 const retry=await retryContext.newPage();await retry.goto(`${base}/#overview`);
 await retry.getByRole('heading',{name:'Couldn’t load this view'}).waitFor();
 await retry.evaluate(()=>{globalThis.__recovered=true;});
 await retry.getByRole('button',{name:'Try again'}).click();await retry.waitForTimeout(300);
 assert.equal(await retry.locator('.signals-ui > .loading-state').count(),0,'retry replayed the navigation skeleton');
 await retry.getByRole('heading',{name:'Calls by client'}).waitFor();await retryContext.close();
 writeFileSync(`${out}/evidence.json`,JSON.stringify(evidence,null,2));
 console.log('v6 QA passed: corner geometry, hover/sticky card fields, typography, unit, mobile sheet, project states, icon size, badge absence, skeleton <=1 and none after content, cold/switch/reload 100 ms series in both themes with no white frames.');
}finally{await browser.close();}

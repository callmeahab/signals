import { chromium, expect } from '../../web/node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base='http://10.8.0.11:8300', dir='reports/redeploy-v2';
const env=Object.fromEntries(readFileSync('/home/vuk/signals-deploy/.env','utf8').trim().split('\n').map(l=>{const i=l.indexOf('=');return [l.slice(0,i),JSON.parse(l.slice(i+1))]}));
const browser=await chromium.launch({channel:'chromium'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100},colorScheme:'light'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByLabel('Email',{exact:true}).fill(env.SIGNALS_BOOTSTRAP_EMAIL);await page.getByLabel('Password',{exact:true}).fill(env.SIGNALS_BOOTSTRAP_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
 const account=await (await page.request.get(base+'/v1/auth/me')).json();assert.deepEqual(account.projects.map(p=>p.slug).sort(),['egg-node','egg-python']);console.log('PASS dashboard login; both historical projects present');
 for(const p of account.projects){
  await page.getByLabel('Select project').selectOption(p.id);
  const captured={};
  for(const screen of (process.argv.includes('--initial')?['overview']:['overview','tools','reliability','cost','adoption'])){
   await page.goto(base+'/#'+screen);await page.getByRole('heading',{name:screen[0].toUpperCase()+screen.slice(1),exact:true}).waitFor();
   const response=await page.request.get(`${base}/v1/projects/${p.id}/analytics/${screen}`);assert.equal(response.status(),200);captured[screen]=await response.json();
   await expect(page.getByRole('button',{name:'Try again'})).toHaveCount(0);await expect(page.getByText('Loading…',{exact:true})).toHaveCount(0);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700);
   await page.screenshot({path:`${dir}/${p.slug}-${screen}${process.argv.includes('--initial')?'-historical':''}.png`,fullPage:true});
   if(screen==='tools'){assert.equal(captured[screen].catalog.advertised,15);assert(Array.isArray(captured[screen].catalog.dead));}
   if(screen==='reliability'){assert(captured[screen].hallucinated_tools.names.includes('redeploy_v2_unknown_tool'));await expect(page.getByText(/redeploy_v2_unknown_tool/).first()).toBeVisible();}
   if(screen==='cost')assert(captured[screen].total_tokens_est>0);
   if(screen==='adoption')assert.equal(captured[screen].identity_quality.network,2);
   console.log(p.slug,screen,JSON.stringify(captured[screen]));
  }
  writeFileSync(`${dir}/${p.slug}${process.argv.includes('--initial')?'-historical':''}.json`,JSON.stringify(captured,null,2));
  assert(captured.overview.tiles.tool_calls.value>0);
 }
 assert.deepEqual(errors,[]);console.log('PASS live dashboard pages; no browser exceptions');
} finally {await browser.close()}

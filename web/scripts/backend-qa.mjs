import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { checkLoginStyles } from './login-styles.mjs';

const docker=process.argv.includes('--docker');
const base=process.env.SIGNALS_URL??(docker?'http://127.0.0.1:8350':'http://127.0.0.1:8300');
const replica=process.env.SIGNALS_REPLICA_URL??(docker?'http://127.0.0.1:8351':base);
const email=process.env.SIGNALS_TEST_EMAIL??'owner@signals.test';
const password=process.env.SIGNALS_TEST_PASSWORD??'signals-test-password';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome'});
mkdirSync('artifacts',{recursive:true});
try{
 await checkLoginStyles(browser,base);
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));
 await page.goto(base);
 await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('heading',{name:'Overview.',exact:true}).waitFor();
 const me=await page.request.get(`${base}/v1/auth/me`);assert.equal(me.status(),200);const account=await me.json();const project=account.projects[0];
 const minted=await page.request.post(`${base}/v1/projects/${project.id}/keys`,{data:{label:'Browser QA',scopes:['ingest','read']}});assert.equal(minted.status(),200);const {secret,key}=await minted.json();
 const first={id:crypto.randomUUID(),ts:new Date().toISOString(),type:'tool.call',session_id:'browser-qa',tool:'search_documents',duration_ms:74,is_error:false,client_name:'Claude',caller:{subject:'Browser QA'},attrs:{transport:'streamable-http'}};
 const events=Array.from({length:25},(_,i)=>({...first,id:crypto.randomUUID(),duration_ms:74+i*13,is_error:i===7,tool:i%2?'get_customer':'search_documents'}));
 const batch={sent_at:first.ts,events};
 const response=await page.request.post(`${base}/v1/events`,{headers:{Authorization:`Bearer ${secret}`},data:batch});assert.equal(response.status(),202);assert.equal((await response.json()).accepted,25);
 const replay=await page.request.post(`${base}/v1/events`,{headers:{Authorization:`Bearer ${secret}`},data:batch});assert.equal(replay.status(),202);assert.equal((await replay.json()).accepted,0);
 // Exercise actual read routes, filters and project cookie authorization.
 for(const route of ['events','sessions','keys','callers?range=24h','tools?range=24h','timeseries?range=24h']){const result=await page.request.get(`${base}/v1/projects/${project.id}/${route}`);assert.equal(result.status(),200,route);}
 const found=await page.request.get(`${base}/v1/projects/${project.id}/events?tool=search_documents`);assert((await found.json()).items.every(e=>e.tool==='search_documents'));
 await page.goto(`${base}/#live`);await page.getByText('Streaming',{exact:true}).waitFor();
 const liveEvent={...first,id:crypto.randomUUID(),ts:new Date().toISOString(),tool:`live-${Date.now()}`};
 await page.request.post(`${replica}/v1/events`,{headers:{Authorization:`Bearer ${secret}`},data:{sent_at:liveEvent.ts,events:[liveEvent]}});
 await page.getByText(liveEvent.tool,{exact:true}).waitFor({timeout:10000});
 await page.goto(`${base}/#settings`);await page.getByLabel('Project name').fill('Browser QA MCP');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Project settings saved.',{exact:true}).waitFor();
 const csrf=await page.request.patch(`${base}/v1/projects/${project.id}`,{headers:{Origin:'https://untrusted.invalid'},data:{...project,name:'CSRF'}});assert.equal(csrf.status(),403);
 const userResponse=await page.request.post(`${base}/v1/projects/${project.id}/users`,{data:{email:`viewer-${Date.now()}@signals.test`,password:'viewer-test-password',role:'viewer'}});assert.equal(userResponse.status(),200);
 const usersResponse=await page.request.get(`${base}/v1/projects/${project.id}/users`);assert.equal(usersResponse.status(),200);assert((await usersResponse.json()).length>=2);
 // The worker interval is 60 seconds. Poll until this batch appears in its rollups.
 await page.goto(`${base}/#overview`);
 for(let attempt=0;attempt<65;attempt++) {
   const summary=await page.request.get(`${base}/v1/projects/${project.id}/overview`);
   if((await summary.json()).requests>=25)break;
   if(attempt===64)throw new Error('Rollup worker did not populate overview');
   await page.waitForTimeout(1000);
 }
 await page.reload();
 await page.getByRole('heading',{name:'A little pulse. A lot of insight.'}).waitFor();
 await page.screenshot({path:'artifacts/real-overview.png',fullPage:true});
 const revoked=await page.request.delete(`${base}/v1/projects/${project.id}/keys/${key.id}`);assert.equal(revoked.status(),204);
 const denied=await page.request.get(`${base}/v1/projects/${project.id}/overview`,{headers:{Authorization:`Bearer ${secret}`}});assert.equal(denied.status(),401);
 await page.getByRole('button',{name:'Log out',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 assert.deepEqual(failures,[]);
 console.log('Backend browser QA passed: login, project, key mint/revoke, ingest/replay, read routes, SSE, settings, CSRF, logout.');
 await context.close();
}finally{await browser.close();}

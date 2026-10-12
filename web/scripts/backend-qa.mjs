import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { checkLoginStyles } from './login-styles.mjs';
import { POLL_INTERVAL_MS, SKELETON_DELAY_MS, SKELETON_MIN_MS } from '../packages/ui/src/activity.js';

const uuid7=()=>{const hex=Date.now().toString(16).padStart(12,'0');return `${hex.slice(0,8)}-${hex.slice(8)}-7${crypto.randomUUID().slice(15)}`;};
const envelope=events=>({schema_version:1,source:{sdk:'browser-qa',sdk_version:'1',server_name:'qa',server_version:'1',instance_id:'qa-1'},sent_at:new Date().toISOString(),dropped:0,events});
const docker=process.argv.includes('--docker');
const base=process.env.SIGNALS_URL??(docker?'http://127.0.0.1:8350':'http://127.0.0.1:8300');
const replica=process.env.SIGNALS_REPLICA_URL??(docker?'http://127.0.0.1:8351':base);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chromium'});
mkdirSync('artifacts/v3-live',{recursive:true});
try {
 await checkLoginStyles(browser,base);
 const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});
 const page=await context.newPage();const failures=[];page.on('pageerror',e=>failures.push(e.message));
 const json=async response=>{assert.equal(response.status(),200,await response.text());return response.json();};
 // The workspace selector is a row of cards; a test picks a project the way a reader does.
 const selectProject=async id=>{await page.locator(`.project-card[data-project="${id}"]`).click();await page.waitForFunction(wanted=>document.querySelector('.project-card.is-selected')?.dataset.project===wanted,id);};
 const setHidden=(target,hidden)=>target.evaluate(value=>{Object.defineProperty(document,'hidden',{value,configurable:true});Object.defineProperty(document,'visibilityState',{value:value?'hidden':'visible',configurable:true});document.dispatchEvent(new globalThis.Event('visibilitychange'));},hidden);
 const login=async()=>{await page.getByLabel('Email',{exact:true}).fill(process.env.SIGNALS_TEST_EMAIL??'owner@signals.test');await page.getByLabel('Password',{exact:true}).fill(process.env.SIGNALS_TEST_PASSWORD??'signals-test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();};
 await page.goto(base);await login();
 const account=await json(await page.request.get(`${base}/v1/auth/me`));
 const initial=account.projects[0];assert(initial,'bootstrap project');
 const project=await json(await page.request.post(`${base}/v1/admin/projects`,{headers:{Authorization:`Bearer ${process.env.SIGNALS_ADMIN_TOKEN??'ci-isolated-admin-token-32-characters'}`},data:{tenant_id:initial.tenant_id,slug:`browser-${Date.now()}`,name:'Browser integration'}}));
 await page.reload();await selectProject(project.id);
 const route=path=>`${base}/v1/projects/${project.id}/${path}`;
 const analytics=async name=>json(await page.request.get(route(`analytics/${name}`)));
 // Tiles are addressed by their exact label so "MAU" does not also match the DAU / MAU chip.
 const tileFor=label=>page.locator('.tile').filter({has:page.getByText(label,{exact:true})});
 const visit=async (screen,api)=>{
  const response=api?page.waitForResponse(r=>r.url().includes(`/projects/${project.id}/${api}`)&&r.request().method()==='GET').catch(()=>null):null;
  // A `goto` that only changes the fragment never leaves the document, so re-entering the
  // screen the page already shows would fetch nothing and this would wait for a request
  // that is never made. Returning to the current screen therefore reloads, and every visit
  // really does exercise the route it names. The fragment can carry a query, as in
  // `#settings?project=...`, so only the screen in front of it is compared.
  const entered=page.url();
  const current=new URL(entered).hash.replace(/^#/,'').split('?')[0];
  if(current===screen)await page.reload();else await page.goto(`${base}/#${screen}`);
  if(response){
   const landed=await response;
   // The commonest cause is a page left on another project: the route carries the project
   // in its path, so the request this waits for is the selected project's.
   assert(landed,`${screen} never requested ${api} for ${project.id}; entered from ${entered}`);
   assert.equal(landed.status(),200,`${screen} uses live ${api}`);
  }
  await page.getByRole('heading',{name:screen==='live'?'Live':screen[0].toUpperCase()+screen.slice(1),exact:true}).waitFor();
 };
 await expect(page.locator('.tile').filter({hasText:'Tool calls'}).locator('strong')).toHaveText('0');
 await expect(page.locator('.tile').filter({hasText:'Tool success'}).locator('strong')).toHaveText('No data yet');
 await visit('settings','analytics/alerts');
 await page.getByLabel('Key label',{exact:true}).fill('Browser QA');await page.getByLabel('Permissions').selectOption('both');
 const mint=page.waitForResponse(r=>r.url()===route('keys')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Create key',exact:true}).click();const {secret,key}=await json(await mint);
 await page.getByRole('button',{name:'I’ve saved it'}).click();
 const start=Date.now()-30000, session='browser-qa-session', caller='Browser QA identity';
 const event=(type,offset,attrs)=>({id:uuid7(),ts:new Date(start+offset).toISOString(),type,session_id:session,client:{name:'Browser QA client',version:'1',protocol_version:'2025-03-26'},caller:{subject:caller},attrs});
 const calls=Array.from({length:25},(_,i)=>event('tool.called',1000+i*100,{tool:i===24?'live_browser_probe':i%2?'get_customer':'search_documents',duration_ms:74+i*13,is_error:i===7,input_bytes:20,output_bytes:40,output_kinds:['text'],cancelled:false}));
 const catalogued=['archive_browser_probe','get_customer','live_browser_probe','search_documents'];
 const deadTool='archive_browser_probe', hallucinated='invented_browser_tool';
 const catalog=event('tools.listed',50,{count:catalogued.length,tools:catalogued.map(name=>({name,annotations:['readOnly']})),catalog_hash:'a'.repeat(64),duration_ms:5,is_error:false,source:'list',truncated:false});
 const unknown=event('tool.called',4000,{...calls[0].attrs,tool:hallucinated,is_error:true,error_kind:'unknown_tool'});
 const events=[event('session.started',0,{transport:'streamable-http'}),event('mcp.initialize',20,{requested_protocol_version:'2025-03-26',client_capabilities:['roots'],server_capabilities:['tools']}),event('mcp.request',40,{method:'tools/list',duration_ms:5,is_error:false}),catalog,...calls,unknown,event('session.ended',5000,{reason:'client',duration_ms:5000})];
 const batch=envelope(events);
 for(const body of [batch,batch]){const result=await page.request.post(`${base}/v1/events`,{headers:{Authorization:`Bearer ${secret}`},data:body});assert.equal(result.status(),202,await result.text());assert.equal((await result.json()).accepted,events.length);}
 await expect.poll(async()=>(await analytics('overview')).tiles.tool_calls.value,{timeout:70000}).toBe(26);
 // Raw-event-derived expectations ensure replay did not double count or display demo data.
 const toolData=await analytics('tools');
 assert.equal(toolData.catalog.known,true);assert.equal(toolData.catalog.complete,true);
 assert.deepEqual(toolData.tools.map(t=>t.tool).sort(),catalogued);assert.deepEqual(toolData.catalog.dead,[deadTool]);
 assert.deepEqual((await analytics('reliability')).hallucinated_tools,{count:1,names:[hallucinated]});
 const latencySeries=(await analytics('reliability')).latency_over_time;
 assert(latencySeries?.points.some(p=>p.p95!==null),'real latency band has populated buckets');
 for(const tool of toolData.tools){if(tool.calls){assert.equal(tool.latency.buckets.edges.length,61);assert.equal(tool.latency.buckets.edges.at(-1),null);assert.equal(tool.latency.buckets.counts.length,60);assert.equal(tool.latency.buckets.counts.reduce((n,c)=>n+c,0),tool.calls);}}
 const overview=await analytics('overview');
 const bucketMs=latencySeries.bucket==='hour'?3600000:86400000;const expectedBuckets=Math.ceil(Date.parse(overview.range.to)/bucketMs)-Math.floor(Date.parse(overview.range.from)/bucketMs);assert.equal(overview.tiles.latency.sparkline.length,expectedBuckets);assert.equal(overview.tiles.latency.sparkline.length,latencySeries.points.length);assert(overview.tiles.latency.sparkline.some(v=>v!==null));
 // A fresh project has no identity old enough to return on day 7, so that step is
 // null while the four measured steps keep their counts.
 assert.deepEqual(overview.funnel.map(step=>step.count),[1,1,1,1,null]);
 assert.deepEqual(overview.funnel.at(-1),{step:'returned_day_7',count:null,eligible:0});
 const adoptionData=await analytics('adoption');
 assert.deepEqual(adoptionData.funnel.steps.at(-1),{step:'returned_day_7',count:null,eligible:0,dropoff_pct:null});
 // Every bucket carries the three trend series the tiles draw, and the per-bucket
 // session counts add up to the sessions tile.
 assert(adoptionData.active.points.length>0,'adoption has at least one bucket');
 for(const point of adoptionData.active.points){
  for(const field of ['sessions','wau','mau'])assert.equal(typeof point[field],'number',`adoption point ${field}: ${JSON.stringify(point)}`);
  assert(point.wau>=point.users&&point.mau>=point.wau,`rolling counts contain the bucket: ${JSON.stringify(point)}`);
 }
 assert.equal(adoptionData.active.points.reduce((n,p)=>n+p.sessions,0),overview.tiles.sessions.value);
 assert.equal(adoptionData.active.points.at(-1).wau,adoptionData.active.wau);
 assert.equal(adoptionData.active.points.at(-1).mau,adoptionData.active.mau);
 assert(overview.attention.some(t=>t.tool===deadTool&&t.status==='dead'));assert(!overview.attention.some(t=>t.tool===hallucinated));assert.equal(overview.tiles.active_users.value,1);assert.equal(overview.tiles.sessions.value,1);assert.equal(overview.tiles.success_rate.value,92.3);assert.equal(overview.tiles.context_tokens.value,260);
 for(const screen of ['overview','adoption','tools','reliability','cost','protocol']){
  await visit(screen,`analytics/${screen}`);
  await expect(page.getByRole('button',{name:'Try again'})).toHaveCount(0);
  if(screen==='overview'){await expect(page.locator('.tile').filter({hasText:'Tool calls'}).locator('strong')).toHaveText('26');await expect(page.locator('.tile').filter({hasText:'Tool success'}).locator('strong')).toHaveText('92.3%');await expect(page.locator('.legend').getByText('Browser QA client',{exact:true})).toBeVisible();await expect(page.getByRole('img',{name:'Stacked calls by client'}).locator('rect:not(.hit)')).toHaveCount(1);}
  if(screen==='adoption'){await expect(page.getByRole('row').filter({hasText:'Browser QA client'})).toContainText('26');
   for(const label of ['WAU','MAU','Stickiness']){const tile=tileFor(label);await tile.scrollIntoViewIfNeeded();await expect(tile.locator('.chart-sparkline svg')).toHaveCount(1);await expect(tile.getByText('Waiting for trend',{exact:true})).toHaveCount(0);}
   await page.locator('.chart-line').scrollIntoViewIfNeeded();
   await expect(page.locator('.chart-line svg[role=img] circle')).toHaveCount(4);
   await expect(page.locator('.chart-line svg[role=img]')).not.toContainText('returned day 7');}
  if(screen==='tools'){await expect(page.getByRole('row').filter({has:page.getByRole('button',{name:'search_documents',exact:true})})).toContainText('12');await expect(page.getByRole('row').filter({has:page.getByRole('button',{name:'get_customer',exact:true})})).toContainText('12');}
  if(screen==='reliability'){await expect(page.getByText('96%',{exact:true}).first()).toBeVisible();await expect(page.locator('.tile').filter({hasText:'Hallucinated tools'}).locator('strong')).toHaveText('1');await expect(page.locator('.tile').filter({hasText:'Hallucinated tools'})).toContainText(hallucinated);}
  if(screen==='tools'){assert.deepEqual((await page.locator('tbody button.row-button').allTextContents()).sort(),catalogued);await expect(page.locator('.dead-tool')).toHaveText([deadTool]);await expect(page.getByRole('button',{name:hallucinated,exact:true})).toHaveCount(0);}
  if(screen==='overview')await expect(page.locator('.tile').filter({hasText:'p95 latency'}).locator('.chart-sparkline svg')).toHaveCount(1);
  if(screen==='overview'){const sessionsTile=tileFor('Sessions');await sessionsTile.scrollIntoViewIfNeeded();await expect(sessionsTile.locator('.chart-sparkline svg')).toHaveCount(1);await expect(sessionsTile.getByText('Waiting for trend',{exact:true})).toHaveCount(0);
   const funnelCard=page.locator('.card').filter({has:page.getByRole('heading',{name:'Activation funnel',exact:true})});
   await funnelCard.locator('.chart-funnel').scrollIntoViewIfNeeded();
   await expect(funnelCard.locator('.chart-funnel svg.growx')).toHaveCount(4);
   await expect(funnelCard.locator('.chart-funnel rect.nullstep')).toHaveCount(1);
   await expect(funnelCard.locator('.emptychart')).toHaveCount(0);
   assert.deepEqual(await funnelCard.locator('.chart-funnel table.sr-only tbody tr').last().locator('td').allTextContents(),['returned_day_7','—','—']);}
  if(screen==='reliability'){await page.locator('.chart-band').scrollIntoViewIfNeeded();await expect(page.locator('.chart-band svg')).toHaveCount(1);}
  if(screen==='overview')await expect(page.locator('.ribrow').filter({hasText:deadTool})).toContainText('dead');
  if(screen==='cost'){await expect(page.locator('.tile').filter({hasText:'Context tokens'}).locator('strong')).toHaveText('≈ 260');await expect(page.getByRole('table',{name:'Tenant share',exact:true})).toContainText('260');}
  if(screen==='protocol')await expect(page.locator('.chart-dot-grid').filter({has:page.locator('table').filter({hasText:'roots'})})).toContainText('100');
  if(['overview','tools','cost'].includes(screen)){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`artifacts/v3-live/${screen}.png`,fullPage:true,animations:'disabled'});}
 }
 await expect.poll(async()=>(await json(await page.request.get(route('sessions')))).items.length,{timeout:70000}).toBe(1);
 await visit('tools','analytics/tools');
 await page.getByRole('button',{name:'search_documents',exact:true}).click();
 await page.getByRole('dialog').locator('.chart-histogram').scrollIntoViewIfNeeded();
 await expect(page.getByRole('dialog').locator('.chart-histogram svg[role=img]')).toHaveCount(1);
 assert.equal(await page.getByRole('dialog').locator('.chart-histogram table tbody tr').count(),60);
 await page.getByRole('button',{name:'Close details'}).click();
 await visit('sessions','sessions');await page.locator('tbody .row-button').first().click();
 await expect(page.locator('.timeline li')).toHaveCount(events.length);await expect(page.getByRole('dialog')).toContainText(caller);await expect(page.getByRole('dialog')).toContainText('5,000 ms');await page.getByRole('button',{name:'Close details'}).click();
 await visit('callers','callers?');await expect(page.getByRole('row').filter({has:page.getByRole('button',{name:caller,exact:true})})).toContainText(String(events.filter(e=>!e.type.startsWith('session.')).length));
 await visit('setup');await expect(page.getByText('Connect your server',{exact:false}).first()).toBeVisible();
 await visit('live');await page.getByText('Streaming',{exact:true}).waitFor();
 const live=event('tool.called',Date.now()-start,{...calls[0].attrs,tool:'live_browser_probe'});
 assert.equal((await page.request.post(`${replica}/v1/events`,{headers:{Authorization:`Bearer ${secret}`},data:envelope([live])})).status(),202);
 const liveRow=page.locator('.event-row').filter({hasText:live.id});
 await liveRow.waitFor({timeout:15000});
 // Each row's summary carries its event id, so a row is addressable without expanding it.
 await expect(liveRow.locator('summary')).toHaveAttribute('data-event-id',live.id);
 await visit('settings','analytics/alerts');
 await expect(page.getByLabel('search_documents SLO class')).toBeVisible();
 assert.deepEqual((await page.locator('select[aria-label$=" SLO class"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label').replace(/ SLO class$/,'')))).sort(),catalogued);
 await expect(page.getByLabel(`${hallucinated} SLO class`,{exact:true})).toHaveCount(0);
 await page.getByLabel('search_documents SLO class').selectOption('mutate');await page.getByLabel('read SLO target (%)').fill('99');
 await page.getByLabel('Error rate (%) threshold').fill('9');await page.getByLabel('Weekly email digest').check();await page.getByLabel('Digest recipient').fill('digest@signals.test');await page.getByLabel('Token divisor',{exact:true}).fill('8');
 const patch=page.waitForResponse(r=>r.url()===`${base}/v1/projects/${project.id}`&&r.request().method()==='PATCH');
 await page.getByRole('button',{name:'Save analytics settings',exact:true}).click();const saved=await json(await patch);await page.getByText('Analytics settings saved.',{exact:true}).waitFor();
 assert.equal(saved.alerts.find(r=>r.id==='errors').threshold,9);assert.equal(saved.slo_classes.search_documents,'mutate');assert.equal(saved.slo_targets.read,99);assert.equal(saved.token_divisor,8);assert.equal(saved.digest.enabled,true);assert.equal(saved.digest.recipient,'digest@signals.test');
 assert.equal((await analytics('alerts')).rules.find(r=>r.id==='errors').threshold,9);
 assert.equal((await analytics('cost')).total_tokens_est,135); // 27 calls (including hallucination) * 40 bytes / divisor 8
 const digest=await analytics('digest');assert.equal(digest.tools.reduce((n,t)=>n+t.calls,0),26);
 await page.reload();await selectProject(project.id);
 // The project card selection survives a real reload, and the reload shows no
 // login-style "Connecting" page and no "Reading your signals" state.
 await expect(page.locator('.project-card.is-selected')).toHaveAttribute('data-project',project.id);
 assert.equal(await page.locator('.login-page, .loading-state').count(),0,'a reload with a session showed a Connecting or Reading screen');
 await expect(page.getByLabel('Token divisor',{exact:true})).toHaveValue('8');await expect(page.getByLabel('Digest recipient')).toHaveValue('digest@signals.test');await expect(page.getByLabel('search_documents SLO class')).toHaveValue('mutate');await expect(page.getByLabel('Error rate (%) threshold')).toHaveValue('9');
 // A real rejected PATCH must retain the form and expose the actionable server message.
 await page.getByLabel('read SLO target (%)').fill('100');await page.getByRole('button',{name:'Save analytics settings',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'SLO targets must be between 0 and 100'})).toBeVisible();
 const csrf=await page.request.patch(`${base}/v1/projects/${project.id}`,{headers:{Origin:'https://untrusted.invalid'},data:{name:'CSRF'}});assert.equal(csrf.status(),403);
 const viewerEmail=`viewer-${Date.now()}@signals.test`;
 await json(await page.request.post(route('users'),{data:{email:viewerEmail,password:'viewer-test-password',role:'viewer'}}));assert((await json(await page.request.get(route('users')))).some(u=>u.email===viewerEmail));
 await page.getByRole('button',{name:'Revoke Browser QA',exact:true}).click();await page.getByRole('button',{name:'Revoke key',exact:true}).click();await page.getByText('Key revoked.',{exact:true}).waitFor();
 assert.equal((await page.request.get(route('analytics/overview'),{headers:{Authorization:`Bearer ${secret}`}})).status(),401);assert(key.id);
 // A separate project proves calls remain discoverable without a catalogue.
 const noCatalog=await json(await page.request.post(`${base}/v1/admin/projects`,{headers:{Authorization:`Bearer ${process.env.SIGNALS_ADMIN_TOKEN??'ci-isolated-admin-token-32-characters'}`},data:{tenant_id:initial.tenant_id,slug:`browser-no-catalog-${Date.now()}`,name:'Browser no catalogue'}}));
 const noCatalogRoute=path=>`${base}/v1/projects/${noCatalog.id}/${path}`;
 const noCatalogKey=await json(await page.request.post(noCatalogRoute('keys'),{data:{label:'No catalogue QA',scopes:['ingest','read']}}));
 const noCatalogEvents=[event('session.started',0,{transport:'streamable-http'}),...['search_documents',hallucinated].map((tool,i)=>event('tool.called',100+i,{...calls[0].attrs,tool}))];
 const ingested=await page.request.post(`${base}/v1/events`,{headers:{Authorization:`Bearer ${noCatalogKey.secret}`},data:envelope(noCatalogEvents)});
 assert.equal(ingested.status(),202,await ingested.text());assert.equal((await ingested.json()).accepted,noCatalogEvents.length);
 await expect.poll(async()=>(await json(await page.request.get(noCatalogRoute('analytics/tools')))).tools.length,{timeout:70000}).toBe(2);
 const noCatalogTools=await json(await page.request.get(noCatalogRoute('analytics/tools')));
 assert.equal(noCatalogTools.catalog.known,false);assert.equal(noCatalogTools.catalog.complete,false);
 assert.deepEqual(noCatalogTools.tools.map(t=>t.tool).sort(),[hallucinated,'search_documents'].sort());
 await page.reload();await selectProject(noCatalog.id);await page.goto(`${base}/#tools`);
 await expect(page.getByRole('button',{name:hallucinated,exact:true})).toBeVisible();
 assert.deepEqual((await page.locator('tbody button.row-button').allTextContents()).sort(),[hallucinated,'search_documents'].sort());
 await page.goto(`${base}/#settings`);await page.getByRole('heading',{name:'SLOs, alerts and digest',exact:true}).waitFor();
 await expect(page.locator('select[aria-label$=" SLO class"]')).toHaveCount(0);
 assert.equal((await page.request.delete(noCatalogRoute(`keys/${noCatalogKey.key.id}`))).status(),204);
 await selectProject(initial.id);await expect(page.getByLabel('Project name')).toHaveValue(initial.name);
 // Live stats, against the real routes: the active screen's own burst on the interval,
 // nothing while the tab is hidden, an immediate burst on return. A fake clock drives
 // the 60-second interval without 60 seconds of wall clock.
 {
  const poller=await context.newPage();
  await poller.clock.install();
  const log=[];
  poller.on('request',request=>{const match=/\/v1\/projects\/[^/]+\/analytics\/([a-z]+)/.exec(request.url());if(match&&request.method()==='GET')log.push(match[1]);});
  await poller.goto(`${base}/#overview?project=${project.id}`);
  await poller.getByRole('heading',{name:'Calls by client'}).waitFor();
  await poller.waitForTimeout(600);
  const burst=[...new Set(log)].sort();log.length=0;
  assert.deepEqual(burst,['adoption','overview','reliability','tools'],`Overview reads only its own routes: ${JSON.stringify(burst)}`);
  await poller.clock.fastForward(POLL_INTERVAL_MS-5000);
  await poller.waitForTimeout(400);
  assert.deepEqual(log,[],`the screen refreshed before its interval was due: ${JSON.stringify(log)}`);
  await poller.clock.fastForward(6000);
  await expect.poll(()=>[...new Set(log)].sort().join(','),{timeout:15000}).toBe('adoption,overview,reliability,tools');
  log.length=0;
  await setHidden(poller,true);
  await poller.clock.fastForward(POLL_INTERVAL_MS*3);
  await poller.waitForTimeout(600);
  assert.deepEqual(log,[],`a hidden tab kept polling: ${JSON.stringify(log)}`);
  await setHidden(poller,false);
  await expect.poll(()=>log.length,{timeout:15000}).toBeGreaterThan(0);
  await poller.close();
 }
 // The skeleton waits 200 ms before it appears and then stays 400 ms, so neither it nor
 // the content it replaces can flash. Only ONE route is delayed: Overview's analytics
 // calls run in sequence, so delaying all of them would put every answer far past both
 // thresholds and the test could not tell a working hold from a missing one. The answer's
 // real arrival is measured rather than assumed, sampling `.loading-state` every 20 ms.
 const skeletonRun=async delayMs=>{
  const slow=await context.newPage();
  await slow.addInitScript(()=>{
   globalThis.__samples=[];
   const started=globalThis.performance.now();
   const sampler=globalThis.setInterval(()=>globalThis.__samples.push({at:Math.round(globalThis.performance.now()-started),skeleton:!!document.querySelector('.loading-state'),content:!!document.querySelector('.tile strong')}),20);
   globalThis.setTimeout(()=>globalThis.clearInterval(sampler),8000);
  });
  if(delayMs)await slow.route('**/v1/projects/*/analytics/overview*',async route=>{await new Promise(resolve=>setTimeout(resolve,delayMs));await route.continue();});
  await slow.goto(`${base}/#overview?project=${project.id}`);
  await slow.getByRole('heading',{name:'Calls by client'}).waitFor();
  await slow.waitForTimeout(SKELETON_DELAY_MS+SKELETON_MIN_MS+600);
  const samples=await slow.evaluate(()=>globalThis.__samples);
  await slow.close();
  assert(samples.length>40,`the skeleton sampler collected only ${samples.length} samples`);
  const skeleton=samples.find(sample=>sample.skeleton), content=samples.find(sample=>sample.content);
  return {samples,skeleton,content,cleared:skeleton&&samples.find(sample=>!sample.skeleton&&sample.at>skeleton.at)};
 };
 {
  // Unthrottled, the three live routes answer well inside the 200 ms the skeleton waits,
  // and nothing appears at all: the content paints at once instead of waiting out a hold.
  const fast=await skeletonRun(0);
  assert(fast.content!==undefined,`the unthrottled overview never painted a tile: ${JSON.stringify(fast.samples.slice(-6))}`);
  assert.equal(fast.skeleton,undefined,`an answer in ${fast.content.at} ms still flashed a skeleton at ${fast.skeleton?.at} ms`);
  assert(fast.content.at<SKELETON_DELAY_MS+SKELETON_MIN_MS,`the unthrottled overview took ${fast.content.at} ms to paint, long enough that it may have waited out a skeleton hold rather than beaten the ${SKELETON_DELAY_MS} ms delay`);
  // One route delayed 300 ms pushes the query past the delay, and the skeleton then has to
  // wait out its own minimum before the content replaces it. The delay is counted from when
  // the query starts, roughly 100 ms into the load, not from the navigation, so 150 ms sits
  // on the boundary and was measured falling on both sides of it: 300 ms is unambiguous.
  const held=await skeletonRun(300);
  assert(held.skeleton!==undefined,`a 300 ms answer showed no skeleton: ${JSON.stringify(held.samples.slice(0,12))}`);
  assert(held.skeleton.at>=SKELETON_DELAY_MS-20,`the skeleton appeared ${held.skeleton.at} ms after navigation, inside its ${SKELETON_DELAY_MS} ms delay`);
  assert(held.cleared!==undefined,`the skeleton never cleared: ${JSON.stringify(held.samples.slice(-12))}`);
  assert(held.cleared.at-held.skeleton.at>=SKELETON_MIN_MS-20,`the skeleton lasted ${held.cleared.at-held.skeleton.at} ms, under its ${SKELETON_MIN_MS} ms minimum`);
  assert(Math.abs(held.content.at-held.cleared.at)<=20,`the skeleton cleared at ${held.cleared.at} ms and the content arrived at ${held.content.at} ms; they have to swap in one paint`);
 }
 // Saved SLO targets move the Tools below-SLO tile, its meta, and the overview caption.
 {
  // The project switch above left the page on the bootstrap project; these targets belong
  // to the project this test filled with calls.
  await selectProject(project.id);
  await visit('settings','analytics/alerts');
  await page.getByLabel('read SLO target (%)').fill('80');
  await page.getByLabel('mutate SLO target (%)').fill('80');
  const savedTargets=page.waitForResponse(r=>r.url()===`${base}/v1/projects/${project.id}`&&r.request().method()==='PATCH');
  await page.getByRole('button',{name:'Save analytics settings',exact:true}).click();
  const targets=await json(await savedTargets);
  await page.getByText('Analytics settings saved.',{exact:true}).waitFor();
  assert.deepEqual(targets.slo_targets,{read:80,mutate:80});
  await visit('tools','analytics/tools');
  const belowSlo=page.locator('.tile').filter({has:page.getByText('Below SLO',{exact:true})});
  await expect(belowSlo.locator('strong')).toHaveText('0');
  await expect(belowSlo.locator('.tile__meta')).toHaveText('read 80% · mutate 80%');
  await expect(page.locator('.card').filter({has:page.getByRole('heading',{name:'Tool health',exact:true})}).locator('.card__sub')).toContainText('read 80% · mutate 80%');
  await visit('overview','analytics/overview');
  await expect(page.locator('.tile').filter({has:page.getByText('Tool success',{exact:true})}).locator('.tile__meta')).toHaveText('0 tools below SLO');
  await expect(page.locator('.card').filter({has:page.getByRole('heading',{name:'Tools needing attention',exact:true})}).locator('.card__sub')).toContainText('read 80% · mutate 80%');
  assert.equal((await analytics('overview')).tiles.success_rate.tools_below_slo,0);
 }
 // Every sparkline carries its own series' timestamps, so no readout can say "Bucket".
 {
  await visit('overview','analytics/overview');
  await page.getByRole('button',{name:'24 hours',exact:true}).click();
  await page.locator('.tile__spark .chart-sparkline svg').first().waitFor();
  const columns=await page.locator('.v3-chart table.sr-only thead th').evaluateAll(cells=>cells.map(cell=>cell.textContent?.trim()).filter(text=>text==='Bucket'||text==='Value'));
  assert.deepEqual(columns,[],`chart columns still read "Bucket"/"Value": ${JSON.stringify(columns)}`);
  const p95Tile=page.locator('.tile').filter({has:page.getByText('p95 latency',{exact:true})});
  await p95Tile.locator('.v3-chart').scrollIntoViewIfNeeded();
  await p95Tile.locator('.v3-chart').focus();
  await page.keyboard.press('ArrowRight');
  const readout=(await p95Tile.locator('.chart-key-tooltip').first().textContent())??'';
  assert(/^Date: \d\d:\d\d p95 latency: ([\d,]+ ms|No data yet)\s*$/.test(readout),`the 24-hour p95 readout is ${JSON.stringify(readout)}, expected an hour timestamp`);
  // The route defaults to seven days, so the window has to be named to see the hourly bucket.
  const live=await analytics('reliability?range=24h');
  assert.equal(live.latency_over_time.bucket,'hour','a 24-hour window serves hourly latency');
  assert.equal((await analytics('reliability')).latency_over_time.bucket,'day','a seven-day window serves daily latency');
  await page.locator('h1').click();
  await page.getByRole('button',{name:'7 days',exact:true}).click();
 }
 await page.getByRole('button',{name:'Log out',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 assert.equal((await page.request.get(`${base}/v1/auth/me`)).status(),401);assert.deepEqual(failures,[]);
 await context.close();
 console.log('Backend browser QA passed: real v3 analytics, project cards that survive a reload, a 60-second refresh of the active screen alone that stops while the tab is hidden, a skeleton held back 200 ms and kept 400 ms, painted funnel with a null day-7 step, adoption session/WAU/MAU trend series, latency histogram count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings that carry saved SLO targets into the Tools tile and the overview caption, hour-stamped sparkline readouts on a 24-hour window, 400 message, CSRF, logout.');
} finally {await browser.close();}

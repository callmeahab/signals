import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { checkLoginStyles } from './login-styles.mjs';

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
 const login=async()=>{await page.getByLabel('Email',{exact:true}).fill(process.env.SIGNALS_TEST_EMAIL??'owner@signals.test');await page.getByLabel('Password',{exact:true}).fill(process.env.SIGNALS_TEST_PASSWORD??'signals-test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();};
 await page.goto(base);await login();
 const account=await json(await page.request.get(`${base}/v1/auth/me`));
 const initial=account.projects[0];assert(initial,'bootstrap project');
 const project=await json(await page.request.post(`${base}/v1/admin/projects`,{headers:{Authorization:`Bearer ${process.env.SIGNALS_ADMIN_TOKEN??'ci-isolated-admin-token-32-characters'}`},data:{tenant_id:initial.tenant_id,slug:`browser-${Date.now()}`,name:'Browser integration'}}));
 await page.reload();await page.getByLabel('Select project').selectOption(project.id);
 const route=path=>`${base}/v1/projects/${project.id}/${path}`;
 const analytics=async name=>json(await page.request.get(route(`analytics/${name}`)));
 const visit=async (screen,api)=>{
  const response=api?page.waitForResponse(r=>r.url().includes(`/projects/${project.id}/${api}`)&&r.request().method()==='GET'):null;
  await page.goto(`${base}/#${screen}`);
  if(response)assert.equal((await response).status(),200,`${screen} uses live ${api}`);
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
 assert(overview.attention.some(t=>t.tool===deadTool&&t.status==='dead'));assert(!overview.attention.some(t=>t.tool===hallucinated));assert.equal(overview.tiles.active_users.value,1);assert.equal(overview.tiles.sessions.value,1);assert.equal(overview.tiles.success_rate.value,92.3);assert.equal(overview.tiles.context_tokens.value,260);
 for(const screen of ['overview','adoption','tools','reliability','cost','protocol']){
  await visit(screen,`analytics/${screen}`);
  await expect(page.getByRole('button',{name:'Try again'})).toHaveCount(0);
  if(screen==='overview'){await expect(page.locator('.tile').filter({hasText:'Tool calls'}).locator('strong')).toHaveText('26');await expect(page.locator('.tile').filter({hasText:'Tool success'}).locator('strong')).toHaveText('92.3%');await expect(page.locator('.legend').getByText('Browser QA client',{exact:true})).toBeVisible();await expect(page.getByRole('img',{name:'Stacked calls by client'}).locator('rect:not(.hit)')).toHaveCount(1);}
  if(screen==='adoption')await expect(page.getByRole('row').filter({hasText:'Browser QA client'})).toContainText('26');
  if(screen==='tools'){await expect(page.getByRole('row').filter({has:page.getByRole('button',{name:'search_documents',exact:true})})).toContainText('12');await expect(page.getByRole('row').filter({has:page.getByRole('button',{name:'get_customer',exact:true})})).toContainText('12');}
  if(screen==='reliability'){await expect(page.getByText('96%',{exact:true}).first()).toBeVisible();await expect(page.locator('.tile').filter({hasText:'Hallucinated tools'}).locator('strong')).toHaveText('1');await expect(page.locator('.tile').filter({hasText:'Hallucinated tools'})).toContainText(hallucinated);}
  if(screen==='tools'){assert.deepEqual((await page.locator('tbody button.row-button').allTextContents()).sort(),catalogued);await expect(page.locator('.dead-tool')).toHaveText([deadTool]);await expect(page.getByRole('button',{name:hallucinated,exact:true})).toHaveCount(0);}
  if(screen==='overview')await expect(page.locator('.tile').filter({hasText:'p95 latency'}).locator('.chart-sparkline svg')).toHaveCount(1);
  if(screen==='reliability')await expect(page.locator('.chart-band svg')).toHaveCount(1);
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
 await page.locator('.event-row').filter({hasText:live.id}).waitFor({timeout:15000});
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
 await page.reload();await page.getByLabel('Select project').selectOption(project.id);
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
 await page.reload();await page.getByLabel('Select project').selectOption(noCatalog.id);await page.goto(`${base}/#tools`);
 await expect(page.getByRole('button',{name:hallucinated,exact:true})).toBeVisible();
 assert.deepEqual((await page.locator('tbody button.row-button').allTextContents()).sort(),[hallucinated,'search_documents'].sort());
 await page.goto(`${base}/#settings`);await page.getByRole('heading',{name:'SLOs, alerts and digest',exact:true}).waitFor();
 await expect(page.locator('select[aria-label$=" SLO class"]')).toHaveCount(0);
 assert.equal((await page.request.delete(noCatalogRoute(`keys/${noCatalogKey.key.id}`))).status(),204);
 await page.getByLabel('Select project').selectOption(initial.id);await expect(page.getByLabel('Project name')).toHaveValue(initial.name);
 await page.getByRole('button',{name:'Log out',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 assert.equal((await page.request.get(`${base}/v1/auth/me`)).status(),401);assert.deepEqual(failures,[]);
 await context.close();
 console.log('Backend browser QA passed: real v3 analytics, latency histogram count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.');
} finally {await browser.close();}

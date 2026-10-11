import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { snippetId } from '../packages/ui/src/snippet-id.ts';

// Run from web/ after building the UI and `cargo build --locked --bin signals`.
const host = process.env.SIGNALS_E2E_HOST ?? '127.0.0.1';
const port = Number(process.env.SIGNALS_E2E_PORT ?? 23441);
const pgPort = Number(process.env.SIGNALS_E2E_PG_PORT ?? 23442);
const base = `http://${host}:${port}`;
const container = `signals-dashboard-e2e-${process.pid}`;
const docker = args => {
  const result = spawnSync('docker', args, {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
mkdirSync('artifacts', {recursive:true});
let server, browser, started = false;
const log = openSync('artifacts/e2e-insecure-server.log', 'w');
try {
  docker(['run','--detach','--rm','--name',container,'--publish',`127.0.0.1:${pgPort}:5432`,'--tmpfs','/var/lib/postgresql/data','--env','POSTGRES_USER=signals','--env','POSTGRES_PASSWORD=signals','--env','POSTGRES_DB=signals','postgres:16']);
  started = true;
  for(let i=0;i<100;i++) {
    if(spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','signals'],{stdio:'ignore'}).status===0)break;
    if(i===99)throw new Error('Postgres not ready');
    await delay(200);
  }
  server = spawn(resolve('../target/debug/signals'), ['serve'], {stdio:['ignore',log,log],env:{...process.env,
    DATABASE_URL:`postgres://signals:signals@127.0.0.1:${pgPort}/signals`,
    SIGNALS_BIND:`${host}:${port}`, SIGNALS_PUBLIC_URL:base,
    SIGNALS_ADMIN_TOKEN:'ci-isolated-admin-token-32-characters',
    SIGNALS_SESSION_SECRET:'ci-isolated-session-secret-32-characters',
    SIGNALS_BOOTSTRAP_EMAIL:'owner@signals.test', SIGNALS_BOOTSTRAP_PASSWORD:'signals-test-password',
  }});
  for(let i=0;i<150;i++) {
    assert.equal(server.exitCode,null,'Collector exited; inspect artifacts/e2e-insecure-server.log');
    let ready=false;try{ready=(await globalThis.fetch(`${base}/readyz`)).ok;}catch{/* starting */}
    if(ready)break;
    if(i===149)throw new Error('Collector not ready');
    await delay(200);
  }
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chromium',args:['--no-proxy-server']});
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const failures=[];page.on('pageerror',error=>failures.push(error.message));
  await page.goto(base);
  assert.deepEqual(await page.evaluate(()=>({secure:globalThis.isSecureContext,randomUUID:typeof globalThis.crypto.randomUUID})),{secure:false,randomUUID:'undefined'});
  await page.getByLabel('Email',{exact:true}).fill('owner@signals.test');
  await page.getByLabel('Password',{exact:true}).fill('signals-test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Overview.',exact:true}).waitFor();
  await page.goto(`${base}/#setup`);
  for(const [label,expected,file] of [['Python','signals.asgi','python'],['Node.js','Signals.fromEnv','node'],['cURL','schema_version','curl']]) {
    await page.getByRole('button',{name:label,exact:true}).click();
    assert((await page.locator('.copy-block pre').last().innerText()).includes(expected));
    await page.screenshot({path:`artifacts/e2e-http-setup-${file}.png`,fullPage:true});
  }
  console.log(`PASS insecure origin ${base}: secureContext=false, randomUUID absent, all three Setup snippets render`);
  const account=await (await page.request.get(`${base}/v1/auth/me`)).json();
  const project=account.projects[0].id;
  const minted=await page.request.post(`${base}/v1/projects/${project}/keys`,{data:{label:'E2E',scopes:['ingest']}});
  assert.equal(minted.status(),200);
  const {secret}=await minted.json();
  const ts=new Date().toISOString();
  const client={name:'Insecure HTTP MCP Client',version:'1.0',protocol_version:'2025-03-26'};
  const event=attrs=>({id:snippetId(),ts,session_id:'e2e-http-session',client,caller:{subject:'E2E caller'},...attrs});
  const response=await page.request.post(`${base}/v1/events`,{headers:{Authorization:`Bearer ${secret}`},data:{schema_version:1,source:{sdk:'e2e',sdk_version:'1',server_name:'E2E',server_version:'1',instance_id:'e2e-http'},sent_at:ts,dropped:0,events:[
    event({type:'session.started',attrs:{transport:'streamable-http'}}),
    event({type:'tool.called',attrs:{tool:'e2e_add',duration_ms:12,is_error:false,input_bytes:13,output_bytes:14,output_kinds:['text'],cancelled:false}}),
  ]}});
  assert.equal(response.status(),202);assert.equal((await response.json()).accepted,2);
  // Sessions are materialized by the collector's once-per-minute rollup.
  let sessions;
  for(let i=0;i<90;i++) {
    sessions=await (await page.request.get(`${base}/v1/projects/${project}/sessions`)).json();
    if(sessions.items.length)break;
    if(i===0)console.log('Waiting for the session rollup');
    await delay(1000);
  }
  assert.equal(sessions.items[0]?.client_name,client.name);
  await page.goto(`${base}/#sessions`);
  await page.locator('tbody .row-button').filter({hasText:client.name}).waitFor();
  await page.screenshot({path:'artifacts/e2e-http-sessions.png',fullPage:true});
  await page.locator('tbody .row-button').filter({hasText:client.name}).click();
  await page.getByRole('heading',{name:`${client.name} session`,exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.goto(`${base}/#overview`);
  await page.getByText(client.name,{exact:true}).first().waitFor();
  await page.goto(`${base}/#tools`);await page.getByRole('button',{name:'e2e_add',exact:true}).waitFor();
  await page.goto(`${base}/#callers`);await page.getByRole('button',{name:'E2E caller',exact:true}).waitFor();
  await page.goto(`${base}/#live`);await page.getByText('e2e_add',{exact:true}).waitFor();
  assert.deepEqual(failures,[]);
  console.log('PASS live collector: spec batch accepted; Sessions, session drawer, Overview, Tools, Callers and Live show read API values');
} finally {
  if(browser)await browser.close();
  if(server && server.exitCode===null) {
    server.kill('SIGTERM');
    await new Promise(resolve=>server.once('exit',resolve));
  }
  closeSync(log);
  if(started)docker(['stop',container]);
  console.log('Stopped collector and disposable Postgres container');
}

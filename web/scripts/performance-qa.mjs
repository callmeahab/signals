import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
const screen=process.env.PERFORMANCE_SCREEN??'adoption';
const theme=process.env.PERFORMANCE_THEME??'light';
const walk=process.argv.includes('--walk');
const repeats=walk?3:Number(process.env.PERFORMANCE_REPEATS??1);
const order=walk?['adoption','tools','reliability','sessions','cost','protocol','live','overview','adoption','reliability']:[screen];
const runs=[];
const budgetMs=130;
const suffix=(screen==='adoption'?'':`-${screen}`)+(theme==='dark'?'-dark':'');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chromium'});
mkdirSync('artifacts/v3',{recursive:true});
try {
 for(let run=1;run<=repeats;run++){
 const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:theme});
 await page.addInitScript(theme=>{globalThis.__SIGNALS_VISUAL_QA__=true;globalThis.localStorage.setItem('signals-theme',theme);},theme);
 await page.goto(process.env.BASE_URL??'http://127.0.0.1:23331');
 await page.locator('.chart-stacked-area svg').waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(1000);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Performance.enable');
 const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 let from='overview';
 for(const [index,screen] of order.entries()){
 if(process.argv.includes('--cpu-profile')){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
 const box=await page.locator(`nav a[href="#${screen}"]`).boundingBox();
 const before=await metric();
 await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,v8,blink.user_timing',transferMode:'ReturnAsStream'});
 // CDP input avoids charging Playwright's repeated accessibility/actionability scans to the app.
 for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,x:box.x+box.width/2,y:box.y+box.height/2,button:'left',clickCount:1});
 await page.waitForTimeout(750);
 const after=await metric();
 assert.equal(await page.locator('nav a[aria-current=page]').getAttribute('href'),`#${screen}`);
 const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
 await cdp.send('Tracing.end');
 const {stream}=await complete;
 let trace='';for(;;){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.data;if(chunk.eof)break;}
 await cdp.send('IO.close',{handle:stream});
 if(!walk||Number(process.env.PERFORMANCE_TRACE_STEP)===index+1)writeFileSync(`artifacts/v3/tab-switch${walk?'-live-overview':suffix}-trace.json`,trace);
 if(process.argv.includes('--cpu-profile')){const {profile}=await cdp.send('Profiler.stop');if(!walk||Number(process.env.PERFORMANCE_TRACE_STEP)===index+1)writeFileSync('artifacts/v3/tab-switch.cpuprofile',JSON.stringify(profile));}
 const workMs=(after.TaskDuration-before.TaskDuration)*1000;
 const events=JSON.parse(trace).traceEvents;
 const mainThreads=new Set(events.filter(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>`${e.pid}:${e.tid}`));
 const longestTaskMs=Math.max(0,...events.filter(e=>e.name==='RunTask'&&e.ph==='X'&&mainThreads.has(`${e.pid}:${e.tid}`)).map(e=>e.dur/1000));
 runs.push({run,step:index+1,transition:`${from} → ${screen}`,mainThreadMs:workMs,longestTaskMs,recalcStyleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,nodes:after.Nodes,listeners:after.JSEventListeners,budgetMs});
 console.log(`Run ${run} ${from} → ${screen}: ${workMs.toFixed(2)} ms (budget < ${budgetMs} ms; longest task ${longestTaskMs.toFixed(2)} ms)`);
 from=screen;
 await page.waitForTimeout(250);
 }
 await page.close();
 }
 writeFileSync(`artifacts/v3/performance${walk?'-walk':suffix}.json`,JSON.stringify({theme,repeats,budgetMs,runs},null,2)+'\n');
 for(const row of runs)assert(row.mainThreadMs<budgetMs,`Tab switch exceeded ${budgetMs} ms: ${JSON.stringify(row)}`);
}finally{await browser.close();}

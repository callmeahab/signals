import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
const screen=process.env.PERFORMANCE_SCREEN??'adoption';
const theme=process.env.PERFORMANCE_THEME??'light';
const walk=process.argv.includes('--walk');
const repeats=walk?3:Number(process.env.PERFORMANCE_REPEATS??1);
const order=walk?['adoption','tools','reliability','sessions','cost','protocol','live','overview','adoption','reliability']:[screen];
const runs=[];
const longestTaskBudgetMs=50;
// One documented exception, and only this one. Mounting the Live screen costs more than
// the budget every other transition is held to, and it cost the same at the branch point
// (`1caeb4e`): the "Pre-existing: Live mount" section of `reports/dash-v4-ux.md` has the
// measurements, and the coordinator accepted that cost rather than raising the budget for
// everything. Stating it here means the gate reports the same thing on every host instead
// of passing or failing with the weather. Nothing else belongs in this table.
const longestTaskExceptionsMs={'protocol → live':60};
const budgetFor=transition=>longestTaskExceptionsMs[transition]??longestTaskBudgetMs;
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
 await cdp.send('Tracing.start',{categories:'devtools.timeline,toplevel,v8,blink.user_timing',transferMode:'ReturnAsStream'});
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
 const tasks=events.filter(e=>(e.name==='RunTask'||e.name==='ThreadControllerImpl::RunTask')&&e.ph==='X'&&mainThreads.has(`${e.pid}:${e.tid}`));
 assert(tasks.length>0,'Trace did not contain renderer task durations');
 const longestTaskMs=Math.max(...tasks.map(e=>e.dur/1000));
 const transition=`${from} → ${screen}`,budgetMs=budgetFor(transition),excepted=budgetMs!==longestTaskBudgetMs;
 runs.push({run,step:index+1,transition,mainThreadMs:workMs,longestTaskMs,recalcStyleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,nodes:after.Nodes,listeners:after.JSEventListeners,longestTaskBudgetMs:budgetMs,...(excepted?{budgetException:'pre-existing Live mount, accepted; see "Pre-existing: Live mount" in reports/dash-v4-ux.md'}:{})});
 console.log(`Run ${run} ${transition}: ${workMs.toFixed(2)} ms aggregate (informational); longest task ${longestTaskMs.toFixed(2)} ms (budget < ${budgetMs} ms${excepted?`, documented exception against the ${longestTaskBudgetMs} ms every other transition keeps: the pre-existing Live mount`:''})`);
 from=screen;
 await page.waitForTimeout(250);
 }
 await page.close();
 }
 const firstSwitches=runs.filter(r=>r.step===1).map(r=>r.mainThreadMs).sort((a,b)=>a-b);
 const mid=Math.floor(firstSwitches.length/2),firstSwitchMedianMs=firstSwitches.length%2?firstSwitches[mid]:(firstSwitches[mid-1]+firstSwitches[mid])/2;
 writeFileSync(`artifacts/v3/performance${walk?'-walk':suffix}.json`,JSON.stringify({theme,repeats,longestTaskBudgetMs,longestTaskExceptionsMs,aggregateInformational:true,firstSwitchMedianMs,runs},null,2)+'\n');
 for(const row of runs)assert(row.longestTaskMs<row.longestTaskBudgetMs,`Longest task exceeded ${row.longestTaskBudgetMs} ms: ${JSON.stringify(row)}`);
}finally{await browser.close();}

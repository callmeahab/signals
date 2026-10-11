import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chromium'});
mkdirSync('artifacts/v3',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.addInitScript(()=>{globalThis.__SIGNALS_VISUAL_QA__=true;});
 await page.goto(process.env.BASE_URL??'http://127.0.0.1:23331');
 await page.locator('.chart-stacked-area svg').waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(1000);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Performance.enable');
 const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const box=await page.locator('nav a[href="#adoption"]').boundingBox();
 const before=await metric();
 await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing',transferMode:'ReturnAsStream'});
 // CDP input avoids charging Playwright's repeated accessibility/actionability scans to the app.
 for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,x:box.x+box.width/2,y:box.y+box.height/2,button:'left',clickCount:1});
 await page.waitForTimeout(750);
 const after=await metric();
 await page.getByRole('heading',{name:'Active users',exact:true}).waitFor();
 const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
 await cdp.send('Tracing.end');
 const {stream}=await complete;
 let trace='';for(;;){const chunk=await cdp.send('IO.read',{handle:stream});trace+=chunk.data;if(chunk.eof)break;}
 await cdp.send('IO.close',{handle:stream});
 writeFileSync('artifacts/v3/tab-switch-trace.json',trace);
 const workMs=(after.TaskDuration-before.TaskDuration)*1000;
 writeFileSync('artifacts/v3/performance.json',JSON.stringify({screen:'overview → adoption',mainThreadMs:workMs,budgetMs:100},null,2)+'\n');
 console.log(`Chromium tab switch main-thread work: ${workMs.toFixed(2)} ms (budget < 100 ms)`);
 assert(workMs<100,`Tab switch exceeded 100 ms: ${workMs}`);
}finally{await browser.close();}

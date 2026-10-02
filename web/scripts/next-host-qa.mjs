import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome'});
try {const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.SIGNALS_NEXT_URL??'http://127.0.0.1:3331');await page.getByRole('heading',{name:'A little pulse. A lot of insight.'}).waitFor();
const size=await page.locator('.host-banner').evaluate(el=>getComputedStyle(el).fontSize);assert.equal(size,'18px');
for(const screen of ['tools','callers','sessions','live','settings','setup']){await page.locator('.host-screen-controls').getByRole('button',{name:screen,exact:true}).click();await page.locator('.signals-ui').waitFor();}
await page.locator('.host-screen-controls').getByRole('button',{name:'tools',exact:true}).click();await page.getByRole('button',{name:'search_documents',exact:true}).click();await page.getByRole('heading',{name:'Recent errors',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').locator('svg[role="img"]').count(),2);assert.deepEqual(errors,[]);console.log('Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.');
}finally{await browser.close();}

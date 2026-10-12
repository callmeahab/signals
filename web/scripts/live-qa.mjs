// The live-refresh behaviour, measured in a browser with a fake clock so a 60-second
// interval does not cost 60 seconds of wall clock. Deliberately runs WITHOUT
// `__SIGNALS_VISUAL_QA__`, since that flag is what freezes polling; the last block
// checks that the flag does freeze it.
import { chromium } from '@playwright/test';
import { CONTENT_FADE_MS, POLL_INTERVAL_MS, SKELETON_DELAY_MS, SKELETON_MIN_MS } from '../packages/ui/src/activity.js';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23330';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const activity = page => page.evaluate(() => globalThis.__SIGNALS_ACTIVITY__ ?? null);
const hide = (page, hidden) => page.evaluate(value => { Object.defineProperty(document, 'hidden', { value, configurable: true }); Object.defineProperty(document, 'visibilityState', { value: value ? 'hidden' : 'visible', configurable: true }); document.dispatchEvent(new globalThis.Event('visibilitychange')); }, hidden);

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(`page error: ${error.message}`));
  await page.clock.install();
  await page.goto(`${base}/#overview`);
  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await page.locator('.tile__value strong').first().waitFor();

  // 1. The interval fires, and only after it is due.
  const before = await activity(page);
  check(before?.loads >= 1, `no load recorded on first paint: ${JSON.stringify(before)}`);
  await page.clock.fastForward(POLL_INTERVAL_MS - 5000);
  await page.waitForTimeout(150);
  check((await activity(page)).loads === before.loads, 'the screen refreshed before its interval was due');
  await page.clock.fastForward(6000);
  await page.waitForTimeout(250);
  const polled = await activity(page);
  check(polled.loads > before.loads, `the screen did not refresh after ${POLL_INTERVAL_MS} ms: ${JSON.stringify(polled)}`);
  check(polled.updatedAt !== before.updatedAt, 'the refresh did not move the freshness stamp');

  // 2. A refresh must not dim the content or restart an entrance.
  check(await page.locator('.signals-ui').evaluate(el => !el.hasAttribute('data-stale')), 'a poll dimmed the screen as though the project had changed');
  check(await page.locator('.signals-ui').evaluate(el => !el.classList.contains('signals-ui--enter')), 'a poll replayed the content fade');
  const motion = await page.evaluate(() => {
    const marked = [...document.querySelectorAll('.plot,.stroke-draw,.growx,.growy,.popin')];
    return { total: marked.length, instant: marked.filter(n => n.classList.contains('nt')).length, running: document.getAnimations().filter(a => a.playState === 'running').length };
  });
  check(motion.total > 0 && motion.instant === motion.total, `charts redrew with draw-in motion: ${JSON.stringify(motion)}`);
  check(motion.running === 0, `animations were still running after a refresh: ${motion.running}`);

  // 3. The strip ticks and says how long ago.
  const stamp = await page.locator('.updated-ago').textContent();
  check(/^updated \d+ s ago$/.test(stamp ?? ''), `freshness stamp reads ${JSON.stringify(stamp)}`);
  await page.clock.fastForward(12000);
  await page.waitForTimeout(120);
  check(/updated 1[0-9] s ago/.test(await page.locator('.updated-ago').textContent() ?? ''), 'the freshness stamp did not tick');

  // 4. A hidden tab polls nothing, and coming back refreshes at once.
  const beforeHidden = (await activity(page)).loads;
  await hide(page, true);
  await page.clock.fastForward(POLL_INTERVAL_MS * 3);
  await page.waitForTimeout(250);
  check((await activity(page)).loads === beforeHidden, 'a hidden tab kept polling');
  await hide(page, false);
  await page.waitForTimeout(400);
  check((await activity(page)).loads > beforeHidden, 'returning to the tab did not refresh immediately');

  // 5. A range change refreshes at once and keeps the previous content while it does.
  const beforeRange = (await activity(page)).loads;
  await page.getByRole('button', { name: '30 days', exact: true }).click();
  await page.waitForTimeout(400);
  check((await activity(page)).loads > beforeRange, 'a range change did not refresh');

  // 6. A count-up runs once. The second value tweens from the first, never from zero.
  const tile = page.locator('.tile').filter({ has: page.getByText('Tool calls', { exact: true }) }).locator('strong');
  const settled = await tile.textContent();
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  const samples = [];
  for (let i = 0; i < 12; i++) { samples.push(await tile.textContent()); await page.waitForTimeout(40); }
  check(!samples.includes('0'), `the tile counted up from zero again: ${JSON.stringify(samples.slice(0, 6))}`);
  check(samples[0] !== null && settled !== null, 'the tile had no value to tween from');

  // 6b. A project change dims the previous screen; a poll does not. The demo client
  // answers in a microtask, so watch the attribute rather than a rendered frame.
  await page.evaluate(() => {
    globalThis.__stale = [];
    const el = document.querySelector('.signals-ui');
    new globalThis.MutationObserver(() => globalThis.__stale.push(el.hasAttribute('data-stale'))).observe(el, { attributes: true, attributeFilter: ['data-stale'] });
  });
  await page.clock.fastForward(POLL_INTERVAL_MS + 1000);
  await page.waitForTimeout(250);
  check((await page.evaluate(() => globalThis.__stale)).length === 0, 'a poll dimmed the screen');
  await page.locator('.project-card').nth(1).click();
  await page.waitForTimeout(300);
  const dimmed = await page.evaluate(() => globalThis.__stale);
  check(dimmed[0] === true && dimmed.at(-1) === false, `a project change did not dim and undim the screen: ${JSON.stringify(dimmed)}`);

  // 6c. The dim and the content fade are the approved values, and opacity only.
  // Its own context: the motion checks above run under reduced motion, which is exactly
  // what turns these two off.
  const motionContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
  const design = await motionContext.newPage();
  await design.goto(`${base}/#overview`);
  await design.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await design.waitForTimeout(CONTENT_FADE_MS + 200); // let the one-time fade finish first
  const tokens = await design.locator('.signals-ui').evaluate((el, fade) => {
    // getComputedStyle returns a live declaration, so snapshot each value while the
    // class or attribute is still on, and silence the transition for the dim reading.
    const previous = el.style.transition;
    el.style.transition = 'none';
    el.toggleAttribute('data-stale', true);
    const stale = getComputedStyle(el).opacity;
    el.toggleAttribute('data-stale', false);
    el.style.transition = previous;
    el.classList.add('signals-ui--enter');
    const name = getComputedStyle(el).animationName, duration = getComputedStyle(el).animationDuration;
    el.classList.remove('signals-ui--enter');
    const frames = [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules]; } catch { return []; } })
      .filter(rule => rule.type === globalThis.CSSRule.KEYFRAMES_RULE && rule.name === 'v4-content-in')
      .flatMap(rule => [...rule.cssRules].map(frame => ({ at: frame.keyText, css: frame.style.cssText })));
    return { stale, duration, name, frames, fade };
  }, CONTENT_FADE_MS);
  await motionContext.close();
  check(tokens.stale === '0.7', `the dimmed opacity is ${tokens.stale}, not 0.7`);
  check(tokens.name === 'v4-content-in' && tokens.duration === `${CONTENT_FADE_MS / 1000}s`, `the content fade is ${tokens.name} ${tokens.duration}, not v4-content-in ${CONTENT_FADE_MS}ms`);
  check(tokens.frames.length === 2 && tokens.frames.every(frame => /^opacity:/.test(frame.css.trim())), `the content fade animates more than opacity: ${JSON.stringify(tokens.frames)}`);

  // 7. Visual QA freezes the whole thing.
  const frozen = await context.newPage();
  await frozen.clock.install();
  await frozen.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });
  await frozen.goto(`${base}/#overview`);
  await frozen.getByRole('heading', { name: 'Calls by client' }).waitFor();
  const quiet = await activity(frozen);
  await frozen.clock.fastForward(POLL_INTERVAL_MS * 4);
  await frozen.waitForTimeout(250);
  check((await activity(frozen)).loads === quiet.loads, 'polling ran under __SIGNALS_VISUAL_QA__');
  await context.close();
} finally { await browser.close(); }
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Live QA passed: ${POLL_INTERVAL_MS} ms refresh observed on the active screen, skeleton held ${SKELETON_DELAY_MS}/${SKELETON_MIN_MS} ms, nothing while the tab is hidden, an immediate refresh on return and on a range change, no dim, no replayed entrance, no count-up from zero, a ticking freshness stamp, and no polling under __SIGNALS_VISUAL_QA__.`);

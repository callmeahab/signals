// Evidence for the load item: the screen's entrance is one choreography, run once per
// navigation, and this is where its timings are a measurement rather than a claim.
//
// The timings are read from the animations themselves (`document.getAnimations()`), so
// the gate does not race the sampler: a tile's or a card's entrance carries its own
// delay and duration, and a chart's draw-in carries its absolute start on the document
// timeline, which is what "after its card" means. Alongside that the script records a
// 100 ms-step screenshot series of one navigation into `artifacts/v5/choreography/`,
// the way `reload-series.mjs` records a reload, so the run can be looked at as well as
// asserted. Those frames are timing-dependent and deliberately live outside
// `artifacts/v3`, which the byte-identity gate covers.
//
// Run against the demo server (`bun scripts/test.mjs` starts one) or any BASE_URL.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23330';
const out = process.env.CHOREOGRAPHY_OUT ?? 'artifacts/v5/choreography';
// The approved timings, from packages/ui/src/motion.ts.
const TILE_FIRST = 130, TILE_STEP = 55, CARD_FIRST = 300, CARD_STEP = 85, CARD_CAP = 1100;
const ENTER_MS = 520, CHART_AFTER = 180, COUNT_MS = 640;
const FRAMES = Number(process.env.CHOREOGRAPHY_FRAMES ?? 18);
mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };

// A tile's and a card's entrance is a Web Animations call the component makes once at
// mount, and an entrance that has already finished is no longer in
// `document.getAnimations()`, so the hook below records each one as it is created. The
// chart draw-ins are CSS animations and are read from `getAnimations()` while they are
// still in their delay. Both carry an absolute start on the document timeline
// (`startTime + delay`), which is the only comparison that says whether one ran before
// another.
const recordEntrances = () => {
  globalThis.__entrances = [];
  const animate = globalThis.Element.prototype.animate;
  globalThis.Element.prototype.animate = function (frames, options) {
    const animation = animate.call(this, frames, options);
    globalThis.__entrances.push({ el: this, animation, delay: Number(options?.delay) || 0, duration: Number(options?.duration) || 0 });
    return animation;
  };
};
const entrances = page => page.evaluate(() => {
  const indexOf = (el, selector) => [...el.parentElement.children].filter(n => n.matches(selector)).indexOf(el);
  const rows = [];
  for (const { el, animation, delay, duration } of globalThis.__entrances ?? []) {
    if (!el.isConnected || animation.startTime == null) continue;
    const row = { delay, duration, start: animation.startTime + delay, playState: animation.playState };
    if (el.matches('.tiles > .tile')) rows.push({ ...row, kind: 'tile', index: indexOf(el, '.tile') });
    else if (el.matches('.card')) rows.push({ ...row, kind: 'card', index: indexOf(el, '.card') });
    else rows.push({ ...row, kind: 'other', what: el.tagName + '.' + (el.className?.toString?.() ?? '') });
  }
  let unresolved = 0;
  for (const animation of document.getAnimations()) {
    const target = animation.effect?.target;
    const name = animation.animationName;
    if (!(target instanceof globalThis.Element) || !name) continue;
    // Every form a chart's entrance takes: the parts a renderer builds and marks `on`,
    // and the boxes that carry their own reveal from the first render.
    const figure = target.closest('.v3-chart');
    const spark = target.matches('.tile__spark');
    if (!spark && !(figure && /^v3-(draw|rise|stroke|grow-x|grow-y)$/.test(name))) continue;
    if (animation.startTime == null) { unresolved++; continue; }
    const delay = Number(animation.effect.getTiming().delay) || 0;
    const owner = target.closest('.card, .tile');
    rows.push({ kind: 'chart', name, delay, duration: Number(animation.effect.getTiming().duration) || 0,
      start: animation.startTime + delay, playState: animation.playState,
      chart: figure?.dataset.chart ?? (spark ? 'tile sparkline' : ''),
      owner: owner ? (owner.matches('.tile') ? 'tile' : 'card') + ':' + indexOf(owner, owner.matches('.tile') ? '.tile' : '.card') : null });
  }
  return { rows, unresolved, now: globalThis.performance.now(), scrollY: Math.round(globalThis.scrollY) };
});
// Every chart built, every entrance over: the point at which "nothing is left running".
const settle = page => page.waitForFunction(() => {
  const charts = [...document.querySelectorAll('.v3-chart')];
  if (!charts.length || !charts.every(c => c.querySelector('svg[role=img]'))) return false;
  return !document.getAnimations().some(a => a.playState === 'running' &&
    (a.animationName ? /^v3-(draw|stroke|grow-x|grow-y)$/.test(a.animationName) : a.effect?.target?.matches?.('.tiles > .tile, .card')));
}, null, { timeout: 15000 });
// As early as the run can be read in full. The entrance hook is what says the new
// screen has mounted -- waiting on the charts alone would be satisfied by the screen
// being navigated away from -- then every chart has its SVG, so every draw-in exists,
// and four frames give each of those animations a resolved start time while the first
// of them is still inside its delay.
const mounted = async page => {
  await page.waitForFunction(() => (globalThis.__entrances ?? []).some(e => e.el.matches?.('.tiles > .tile')));
  await page.waitForFunction(() => {
    const charts = [...document.querySelectorAll('.v3-chart')];
    return charts.length > 0 && charts.every(c => c.querySelector('svg[role=img]'));
  });
  await page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => globalThis.requestAnimationFrame(resolve)); });
};

const paintedState = page => page.evaluate(() => {
  const charts = [...document.querySelectorAll('.v3-chart')];
  const cards = [...document.querySelectorAll('.signals-ui .card, .signals-ui .panel')];
  return {
    charts: charts.length,
    svg: charts.filter(c => c.querySelector('svg[role=img]')).length,
    twin: charts.filter(c => c.querySelector('table.sr-only')).length,
    tiles: document.querySelectorAll('.tiles > .tile').length,
    tilesShown: [...document.querySelectorAll('.tiles > .tile')].filter(t => Number(getComputedStyle(t).opacity) > 0.99).length,
    cards: cards.length,
    cardsShown: cards.filter(c => Number(getComputedStyle(c).opacity) > 0.99).length,
    running: document.getAnimations().filter(a => a.playState === 'running').length,
    scrollY: Math.round(globalThis.scrollY),
  };
});

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', timezoneId: 'UTC' });
  // The flag freezes the icons and the poll, not the entrance: what is measured here is
  // the choreography, with nothing else moving beside it.
  await context.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });
  await context.addInitScript(recordEntrances);
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(`page error: ${error.message}`));
  await page.goto(`${base}/#overview`);
  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  // The page's own context, heading and range control open the choreography.
  const shell = await page.evaluate(() => Object.fromEntries(['.workspace-strip', '.page-heading', '.range-control']
    .map(selector => [selector, getComputedStyle(document.querySelector(selector)).animationDelay])));
  const ms = value => Math.round(parseFloat(value) * (/\dms$/.test(value) ? 1 : 1000));
  for (const [selector, want] of [['.workspace-strip', 40], ['.page-heading', 90], ['.range-control', 140]])
    check(ms(shell[selector]) === want, `${selector} opens the page at ${shell[selector]}, expected ${want} ms`);
  await settle(page);

  // One navigation, read as soon as the new screen has mounted.
  for (const screen of ['tools', 'adoption', 'cost']) {
    await page.evaluate(() => { globalThis.__entrances = []; });
    await page.locator(`nav a[href="#${screen}"]`).click();
    await mounted(page);
    const { rows, unresolved } = await entrances(page);
    check(unresolved === 0, `${screen}: ${unresolved} chart draw-ins had no start time when the run was read`);
    const tiles = rows.filter(r => r.kind === 'tile').sort((a, b) => a.index - b.index);
    const cards = rows.filter(r => r.kind === 'card').sort((a, b) => a.index - b.index);
    const charts = rows.filter(r => r.kind === 'chart');
    check(tiles.length > 0 && cards.length > 0, `${screen}: no entrance was running when the screen mounted (tiles ${tiles.length}, cards ${cards.length})`);
    for (const tile of tiles) {
      check(tile.delay === TILE_FIRST + TILE_STEP * tile.index, `${screen}: tile ${tile.index} enters at ${tile.delay} ms, expected ${TILE_FIRST + TILE_STEP * tile.index} ms`);
      check(tile.duration === ENTER_MS, `${screen}: tile ${tile.index} runs for ${tile.duration} ms, expected ${ENTER_MS} ms`);
    }
    for (const card of cards) {
      const want = Math.min(CARD_CAP, CARD_FIRST + CARD_STEP * card.index);
      check(card.delay === want, `${screen}: card ${card.index} enters at ${card.delay} ms, expected ${want} ms`);
      check(card.duration === ENTER_MS, `${screen}: card ${card.index} runs for ${card.duration} ms, expected ${ENTER_MS} ms`);
    }
    check(cards.every(c => c.delay <= CARD_CAP), `${screen}: a card enters later than the ${CARD_CAP} ms cap`);
    // Top to bottom: the tiles lead the cards, and both are one run from the same mount.
    if (tiles.length && cards.length) {
      const lead = cards[0].start - tiles[0].start;
      check(Math.abs(lead - (CARD_FIRST - TILE_FIRST)) <= 4, `${screen}: the first card follows the first tile by ${Math.round(lead)} ms, expected ${CARD_FIRST - TILE_FIRST} ms`);
      const spread = tiles.map(t => t.start - tiles[0].start);
      check(spread.every((v, i) => Math.abs(v - TILE_STEP * i) <= 2), `${screen}: the tile row is not one run: ${JSON.stringify(spread.map(Math.round))}`);
    }
    // Every chart draws in after the card or tile it belongs to, never before it.
    const owners = new Map([...tiles.map(t => ['tile:' + t.index, t]), ...cards.map(c => ['card:' + c.index, c])]);
    let checked = 0;
    for (const chart of charts) {
      const owner = chart.owner && owners.get(chart.owner);
      if (!owner) continue;
      checked++;
      check(chart.start >= owner.start + CHART_AFTER - 2,
        `${screen}: the ${chart.chart} chart in ${chart.owner} draws in ${Math.round(owner.start + CHART_AFTER - chart.start)} ms before its own entrance allows`);
    }
    check(checked > 0, `${screen}: no chart draw-in could be matched to the card or tile it sits in`);
    console.log(`${screen}: ${tiles.length} tiles ${tiles[0]?.delay}+${TILE_STEP}i ms, ${cards.length} cards ${cards[0]?.delay}+${CARD_STEP}i ms (last ${cards.at(-1)?.delay} ms), ${checked}/${charts.length} chart draw-ins anchored to their card`);
    await settle(page);
    // And when it is over, it is over: nothing is left running on the screen.
    const settled = await paintedState(page);
    check(settled.charts > 0 && settled.svg === settled.charts && settled.twin === settled.charts, `${screen}: ${settled.svg}/${settled.charts} charts painted with ${settled.twin} twins after the entrance`);
    check(settled.tilesShown === settled.tiles && settled.cardsShown === settled.cards, `${screen}: ${settled.cardsShown}/${settled.cards} cards and ${settled.tilesShown}/${settled.tiles} tiles finished their entrance`);
    check(settled.scrollY === 0, `${screen}: the page scrolled during the entrance`);
  }

  // Nothing on scroll, nothing on resize. The entrance has already run; moving the
  // viewport must not start another one.
  await page.locator('nav a[href="#overview"]').click();
  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await settle(page);
  await page.evaluate(() => { globalThis.__entrances = []; });
  const quiet = async label => {
    const { rows } = await entrances(page);
    const moving = rows.filter(r => ['tile', 'card', 'chart'].includes(r.kind));
    check(moving.length === 0, `${label}: ${moving.length} entrance or draw-in animations started: ${JSON.stringify(moving.slice(0, 4))}`);
  };
  for (const y of [900, 2400, 0]) { await page.evaluate(top => globalThis.scrollTo(0, top), y); await page.waitForTimeout(260); await quiet(`scrolled to ${y}`); }
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.waitForTimeout(400);
  await quiet('after a resize');
  const afterResize = await paintedState(page);
  check(afterResize.svg === afterResize.charts, `after a resize: ${afterResize.svg}/${afterResize.charts} charts have an SVG`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(400);
  await quiet('back at 1440');

  // The 100 ms series, as evidence of one run from the top.
  const series = [];
  await page.locator('nav a[href="#tools"]').click();
  const started = Date.now();
  for (let frame = 0; frame < FRAMES; frame++) {
    const at = Date.now() - started;
    const facts = await paintedState(page).catch(() => null);
    await page.screenshot({ path: `${out}/frame-${String(frame).padStart(2, '0')}.png` });
    series.push({ frame, atMs: at, ...(facts ?? { detached: true }) });
    const left = 100 - (Date.now() - started - at);
    if (left > 0) await page.waitForTimeout(left);
  }
  check(series.filter(f => f.tilesShown < f.tiles || f.cardsShown < f.cards).length >= 3, `the series caught only ${series.filter(f => f.tilesShown < f.tiles || f.cardsShown < f.cards).length} frames mid-entrance; nothing was choreographed`);
  check(series.at(-1).tilesShown === series.at(-1).tiles && series.at(-1).cardsShown === series.at(-1).cards, `the series ended with ${series.at(-1).cardsShown}/${series.at(-1).cards} cards shown`);
  check(series.every(f => f.scrollY === 0), 'the series scrolled the page');
  // Top to bottom: no frame shows a card finished while a tile has not started.
  check(series.every(f => f.tilesShown >= f.cardsShown || f.cardsShown === f.cards), `a card entered before the tiles above it: ${JSON.stringify(series.map(f => [f.atMs, f.tilesShown, f.cardsShown]))}`);
  writeFileSync(`${out}/series.json`, JSON.stringify({ base, frames: FRAMES, timings: { TILE_FIRST, TILE_STEP, CARD_FIRST, CARD_STEP, CARD_CAP, ENTER_MS, CHART_AFTER, COUNT_MS }, series, failures }, null, 2) + '\n');
  console.log(series.map(f => `${String(f.atMs).padStart(5)}ms tiles ${f.tilesShown}/${f.tiles} cards ${f.cardsShown}/${f.cards} charts ${f.svg}/${f.charts} running=${f.running}`).join('\n'));
  await context.close();

  // Reduced motion shows the finished page at once: no entrance at all, and every chart
  // already painted with its twin, with nothing scrolled.
  const still = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  await still.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });
  const stillPage = await still.newPage();
  for (const screen of ['overview', 'tools', 'cost']) {
    await stillPage.goto(`${base}/#${screen}`);
    await stillPage.locator('.v3-chart svg[role=img]').first().waitFor();
    await stillPage.waitForFunction(() => {
      const charts = [...document.querySelectorAll('.v3-chart')];
      return charts.length > 0 && charts.every(c => c.querySelector('svg[role=img]'));
    });
    const state = await paintedState(stillPage);
    check(state.running === 0, `reduced motion/${screen}: ${state.running} animations were running`);
    check(state.tilesShown === state.tiles && state.cardsShown === state.cards, `reduced motion/${screen}: ${state.cardsShown}/${state.cards} cards and ${state.tilesShown}/${state.tiles} tiles are at full opacity`);
    check(state.svg === state.charts && state.twin === state.charts, `reduced motion/${screen}: ${state.svg}/${state.charts} charts painted`);
    check(state.scrollY === 0, `reduced motion/${screen}: the page scrolled`);
  }
  await still.close();
} finally { await browser.close(); }

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Choreography QA passed: tiles at ${TILE_FIRST}+${TILE_STEP}i ms, cards at ${CARD_FIRST}+${CARD_STEP}i ms capped at ${CARD_CAP} ms, every chart's draw-in ${CHART_AFTER} ms behind its own card or tile, one run per navigation with nothing on scroll or resize, a ${FRAMES}-frame 100 ms series in ${out}/, and the finished page at once under reduced motion.`);

// Evidence for the load item: the screen's entrance is one choreography, run once per
// navigation, and this is where its timings are a measurement rather than a claim.
//
// Scheduled delays and durations are asserted exactly on every host. Frame-dependent
// observations are additional checks only when the measured window sustains 20 fps.
// Counts always check their scheduled target and monotonic samples; the screenshot
// series remains diagnostic evidence alongside the finished/reduced-motion checks.
//
// Run against the demo server (`bun scripts/test.mjs` starts one) or any BASE_URL.
import { recordCounts, frameRate, checkCounts } from './count-sampling.mjs';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23330';
const out = process.env.CHOREOGRAPHY_OUT ?? 'artifacts/v5/choreography';
// The approved timings, from packages/ui/src/motion.ts.
const TILE_FIRST = 130, TILE_STEP = 55, CARD_FIRST = 300, CARD_STEP = 85, CARD_CAP = 1100;
const ENTER_MS = 520, CHART_AFTER = 180, COUNT_MS = 640;
const FRAMES = Number(process.env.CHOREOGRAPHY_FRAMES ?? 18);
// What a schedule is worth and what an observation is worth are two different things.
// A delay or a duration read off an animation is the number the page asked for, and is
// asserted exactly. An *order* -- this animation's absolute start against that one's --
// is read from two clocks that are only aligned to a rendering update: an animation's
// `startTime` is the frame it was created in, and `performance.now()` inside an effect
// is some way into that frame's work. On a shared runner that gap is a frame or more, so
// ordering gets a frame of slack at 30 fps rather than a couple of milliseconds. The CI
// failure this exists for: "the donut chart in card:1 draws in 17 ms before its own
// entrance allows", on a host where every count and every delay was already correct.
const FRAME_SLACK = 60;
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
    globalThis.__entrances.push({ el: this, animation, created: globalThis.performance.now(), delay: Number(options?.delay) || 0, duration: Number(options?.duration) || 0 });
    return animation;
  };
};
const entrances = page => page.evaluate(() => {
  const indexOf = (el, selector) => [...el.parentElement.children].filter(n => n.matches(selector)).indexOf(el);
  const rows = [];
  for (const { el, animation, delay, duration, created } of globalThis.__entrances ?? []) {
    if (!el.isConnected || animation.startTime == null) continue;
    const row = { created, delay, duration, start: animation.startTime + delay, playState: animation.playState };
    const drawIn = Math.round(parseFloat(getComputedStyle(el).getPropertyValue('--draw-in')) || 0);
    if (el.matches('.tiles > .tile')) rows.push({ ...row, drawIn, kind: 'tile', index: indexOf(el, '.tile'), label: el.querySelector('.tile__label span')?.textContent?.trim() ?? null, countDelay: Number(el.querySelector('strong')?.dataset.countDelay), countDuration: Number(el.querySelector('strong')?.dataset.countDuration) });
    else if (el.matches('.card')) rows.push({ ...row, drawIn, kind: 'card', index: indexOf(el, '.card') });
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
// The count-up is the one part of the choreography that is text rather than motion, so
// it is sampled rather than read off an animation: a frame loop records a tile's
// headline whenever it changes, with the timestamp, into `globalThis.__counts`. It is
// installed before the document runs, so a cold load is covered from its first frame,
// and `__countsFrom(ms)` restarts it for a navigation.
const counts = page => page.evaluate(() => globalThis.__countSnapshot());
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
  await context.addInitScript(recordCounts);
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
  // A cold load counts up too, and the sampler has been running since the first frame.
  const coldCounts = await counts(page);
  checkCounts('cold #overview', coldCounts, (await entrances(page)).rows, check);

  // One navigation, read as soon as the new screen has mounted.
  for (const screen of ['tools', 'adoption', 'cost']) {
    await page.evaluate(() => { globalThis.__entrances = []; globalThis.__countsFrom(2400); });
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
    const snapshot = await counts(page);
    const observed = frameRate(snapshot.frames, Math.min(...tiles.map(t => t.created), ...cards.map(c => c.created)), snapshot.frames.at(-1));
    console.log(`${screen}: ordering observed at ${observed.sustained.toFixed(1)} fps, ${observed.sustained >= 20 ? 'checked' : 'skipped'} (average ${observed.fps.toFixed(1)} fps; threshold uses slowest-frame cadence); exact schedules checked`);
    // Top to bottom: the tiles lead the cards, and both are one run from the same mount.
    if (tiles.length && cards.length) {
      check(cards[0].delay - tiles[0].delay === CARD_FIRST - TILE_FIRST, `${screen}: first card/tile scheduled order differs`);
      check(tiles.every((t, i) => t.delay - tiles[0].delay === TILE_STEP * i), `${screen}: tile row scheduled spacing differs`);
      if (observed.sustained >= 20) {
        const lead = cards[0].start - tiles[0].start;
        check(Math.abs(lead - (CARD_FIRST - TILE_FIRST)) <= FRAME_SLACK, `${screen}: the first card follows the first tile by ${Math.round(lead)} ms, expected ${CARD_FIRST - TILE_FIRST} ms`);
        const spread = tiles.map(t => t.start - tiles[0].start);
        check(spread.every((v, i) => Math.abs(v - TILE_STEP * i) <= FRAME_SLACK), `${screen}: the tile row is not one run: ${JSON.stringify(spread.map(Math.round))}`);
      }
    }
    // Every chart draws in after the card or tile it belongs to, never before it.
    const owners = new Map([...tiles.map(t => ['tile:' + t.index, t]), ...cards.map(c => ['card:' + c.index, c])]);
    let checked = 0, margin = Infinity;
    for (const chart of charts) {
      const owner = chart.owner && owners.get(chart.owner);
      if (!owner) continue;
      checked++;
      margin = Math.min(margin, chart.start - owner.start - CHART_AFTER);
      if (observed.sustained >= 20) check(chart.start >= owner.start + CHART_AFTER - FRAME_SLACK,
        `${screen}: the ${chart.chart} chart in ${chart.owner} draws in ${Math.round(owner.start + CHART_AFTER - chart.start)} ms before its own entrance allows, past the ${FRAME_SLACK} ms a frame is worth`);
    }
    check(checked > 0, `${screen}: no chart draw-in could be matched to the card or tile it sits in`);
    // And the same claim from the schedule instead of the clock: every owner publishes
    // the instant its charts may start, and that number is exact on any host.
    for (const owner of [...tiles, ...cards])
      check(owner.drawIn === owner.delay + CHART_AFTER,
        `${screen}: the ${owner.kind} at ${owner.delay} ms lets its charts draw in at ${owner.drawIn} ms, expected ${owner.delay + CHART_AFTER} ms`);
    // The count-up finishes after the entrances do, so it is read once the screen has
    // settled -- the sampler has been recording since before the click either way.
    await settle(page);
    checkCounts(screen, await counts(page), rows, check);
    console.log(`${screen}: ${tiles.length} tile and ${cards.length} card schedules checked, ${checked} chart owners matched; observed margin ${Math.round(margin)} ms is diagnostic`);
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

  // The nominal 100 ms series, as evidence of one run from the top.
  const series = [];
  await page.evaluate(() => { globalThis.__entrances = []; globalThis.__countsFrom(); });
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
  const seriesRows = (await entrances(page)).rows.filter(r => r.kind === 'tile' || r.kind === 'card');
  for (const row of seriesRows) {
    const delay = row.kind === 'tile' ? TILE_FIRST + TILE_STEP * row.index : Math.min(CARD_CAP, CARD_FIRST + CARD_STEP * row.index);
    check(row.delay === delay && row.duration === ENTER_MS && row.drawIn === delay + CHART_AFTER, `series: incorrect ${row.kind} schedule`);
  }
  const seriesSampling = await counts(page);
  const seriesRate = frameRate(seriesSampling.frames, Math.min(...seriesRows.map(r => r.created)), Math.max(...seriesRows.map(r => r.created + r.delay + r.duration)));
  console.log(`series: ordering observed at ${seriesRate.sustained.toFixed(1)} fps, ${seriesRate.sustained >= 20 ? 'checked' : 'skipped'}; exact schedules checked`);
  if (seriesRate.sustained >= 20) check(series.filter(f => f.tilesShown < f.tiles || f.cardsShown < f.cards).length >= 3, `the series caught only ${series.filter(f => f.tilesShown < f.tiles || f.cardsShown < f.cards).length} frames mid-entrance; nothing was choreographed`);
  check(series.at(-1).tilesShown === series.at(-1).tiles && series.at(-1).cardsShown === series.at(-1).cards, `the series ended with ${series.at(-1).cardsShown}/${series.at(-1).cards} cards shown`);
  check(series.every(f => f.scrollY === 0), 'the series scrolled the page');
  // Top to bottom: no frame shows a card finished while a tile has not started.
  if (seriesRate.sustained >= 20) check(series.every(f => f.tilesShown >= f.cardsShown || f.cardsShown === f.cards), `a card entered before the tiles above it: ${JSON.stringify(series.map(f => [f.atMs, f.tilesShown, f.cardsShown]))}`);
  writeFileSync(`${out}/series.json`, JSON.stringify({ base, frames: FRAMES, timings: { TILE_FIRST, TILE_STEP, CARD_FIRST, CARD_STEP, CARD_CAP, ENTER_MS, CHART_AFTER, COUNT_MS }, series, counts: coldCounts, failures }, null, 2) + '\n');
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
console.log(`Choreography QA passed: tiles at ${TILE_FIRST}+${TILE_STEP}i ms, cards at ${CARD_FIRST}+${CARD_STEP}i ms capped at ${CARD_CAP} ms, every chart's draw-in scheduled ${CHART_AFTER} ms behind its own card or tile, count-ups scheduled for ${COUNT_MS} ms at their tile entrance with monotonic samples and terminal values checked; early zero, step counts and observed ordering checked only when sampling permits, one run per navigation with nothing on scroll or resize, a ${FRAMES}-frame nominal 100 ms series in ${out}/, and the finished page at once under reduced motion.`);

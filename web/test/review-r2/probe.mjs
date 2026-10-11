// Round-2 review probes for the dashboard v2 fix pass (reviews/dash-v2-r2.md).
// Measures the nine round-1 items in a real browser (computed styles and box
// measurements, not source reading), the blast radius of the fixes across all
// eleven screens, and the three screens round 1 did not open in detail.
// Starts its own demo Vite server. Run from web/:
//   PLAYWRIGHT_CHANNEL=chromium bun test/review-r2/probe.mjs
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoClient } from '../../apps/dashboard/src/demo.ts';
import { ReliabilityScreen } from '../../packages/ui/src/analytics.tsx';

const failures = [];
const notes = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };
const note = message => notes.push(message);

const SCREENS = ['overview', 'adoption', 'tools', 'reliability', 'sessions', 'callers', 'cost', 'protocol', 'live', 'settings', 'setup'];
// Round-1 fix brief mapping, written out literally so the probe does not inherit
// an error from the implementation's own bucketForRange().
const BUCKETS = { '24h': { bucket: 'hour', label: 'Hourly', hours: 1, points: 24 }, '7d': { bucket: 'day', label: 'Daily', hours: 24, points: 7 }, '30d': { bucket: 'day', label: 'Daily', hours: 24, points: 30 }, '90d': { bucket: 'week', label: 'Weekly', hours: 168, points: 13 } };
const RANGE_BUTTON = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days' };

// ---------------------------------------------------------------- data checks
// 1. Buckets: spacing, count and the declared bucket name, per range.
for (const [range, want] of Object.entries(BUCKETS)) {
  const overview = await demoClient.analytics('demo', 'overview', { range });
  const adoption = await demoClient.analytics('demo', 'adoption', { range });
  for (const [name, series, bucketField] of [['calls_by_client', overview.calls_by_client.points, overview.calls_by_client.buckets], ['active', adoption.active.points, adoption.active.bucket]]) {
    const times = series.map(p => Date.parse(p.t));
    const gaps = [...new Set(times.slice(1).map((t, i) => (t - times[i]) / 3600000))];
    check(bucketField === want.bucket, `${range} ${name}: bucket ${bucketField}, expected ${want.bucket}`);
    check(gaps.length === 1 && gaps[0] === want.hours, `${range} ${name}: gaps ${gaps.join(',')}h, expected ${want.hours}h`);
    check(times.length === want.points, `${range} ${name}: ${times.length} points, expected ${want.points}`);
  }
  // Totals must survive the split into buckets (tiles versus charts).
  const perClient = {};
  for (const point of overview.calls_by_client.points) for (const [client, n] of Object.entries(point.by_client)) perClient[client] = (perClient[client] ?? 0) + n;
  const charted = Object.values(perClient).reduce((a, b) => a + b, 0);
  check(charted === overview.tiles.tool_calls.value, `${range}: calls_by_client sums to ${charted}, tool_calls tile is ${overview.tiles.tool_calls.value}`);
  const tools = await demoClient.analytics('demo', 'tools', { range });
  const tableCalls = tools.tools.reduce((a, t) => a + t.calls, 0);
  check(tableCalls === overview.tiles.tool_calls.value, `${range}: tools table sums to ${tableCalls}, tool_calls tile is ${overview.tiles.tool_calls.value}`);
  for (const tool of tools.tools) {
    const trend = tool.trend.reduce((a, p) => a + p.calls, 0);
    check(trend === tool.calls, `${range} ${tool.tool}: trend sums to ${trend}, calls is ${tool.calls}`);
  }
  const cost = await demoClient.analytics('demo', 'cost', { range });
  const byTool = cost.by_tool.reduce((a, t) => a + t.tokens, 0);
  check(byTool === cost.total_tokens_est, `${range}: cost by_tool sums to ${byTool}, total_tokens_est is ${cost.total_tokens_est}`);
  // Tiles versus tables versus charts, across the routes that share a number.
  const adoptionData = await demoClient.analytics('demo', 'adoption', { range });
  const protocol = await demoClient.analytics('demo', 'protocol', { range });
  const sum = (rows, key) => rows.reduce((a, r) => a + r[key], 0);
  const tiles = overview.tiles;
  check(sum(adoptionData.clients, 'calls') === tiles.tool_calls.value, `${range}: client mix calls ${sum(adoptionData.clients, 'calls')} vs tool_calls tile ${tiles.tool_calls.value}`);
  check(sum(adoptionData.clients, 'sessions') === tiles.sessions.value, `${range}: client mix sessions ${sum(adoptionData.clients, 'sessions')} vs sessions tile ${tiles.sessions.value}`);
  check(sum(adoptionData.clients, 'pct') === 100, `${range}: client shares sum to ${sum(adoptionData.clients, 'pct')}%`);
  check(sum(adoptionData.protocol_versions, 'sessions') === tiles.sessions.value, `${range}: protocol version sessions do not sum to the sessions tile`);
  check(sum(adoptionData.transports, 'sessions') === tiles.sessions.value, `${range}: transport sessions do not sum to the sessions tile`);
  check(protocol.capabilities.sessions === tiles.sessions.value, `${range}: protocol capability sessions ${protocol.capabilities.sessions} vs sessions tile ${tiles.sessions.value}`);
  check(sum(cost.by_tenant, 'calls') === tiles.tool_calls.value, `${range}: cost by_tenant calls do not sum to the tool_calls tile`);
  check(sum(cost.by_tenant, 'tokens') === cost.total_tokens_est, `${range}: cost by_tenant tokens do not sum to total_tokens_est`);
  check(cost.total_tokens_est === tiles.context_tokens.value && cost.per_call === tiles.context_tokens.per_call, `${range}: cost screen (${cost.total_tokens_est}/${cost.per_call}) disagrees with the overview token tile (${tiles.context_tokens.value}/${tiles.context_tokens.per_call})`);
  for (const side of ['input', 'output']) check(cost.payload_hist[side].reduce((a, b) => a + b, 0) === tiles.tool_calls.value, `${range}: payload histogram ${side} does not sum to the call count`);
  const kinds = tiles.active_users.by_kind;
  check(kinds.strong + kinds.key + kinds.network === tiles.active_users.value, `${range}: identity kinds do not sum to active users`);
  check(adoptionData.identity_quality.strong + adoptionData.identity_quality.key + adoptionData.identity_quality.network === tiles.active_users.value, `${range}: adoption identity quality does not sum to active users`);
  check(overview.funnel.every((step, i) => i === 0 || overview.funnel[i - 1].count >= step.count), `${range}: funnel steps are not monotonic ${JSON.stringify(overview.funnel.map(s => s.count))}`);
  check(tools.catalog.known && tools.catalog.advertised === tools.catalog.used + tools.catalog.dead.length, `${range}: catalogue ${tools.catalog.advertised} advertised vs ${tools.catalog.used} used + ${tools.catalog.dead.length} dead`);
}

// 2. Attention ordering: contract says error, warn, dead, then by calls.
{
  const overview = await demoClient.analytics('demo', 'overview', { range: '7d' });
  const tools = await demoClient.analytics('demo', 'tools', { range: '7d' });
  const rank = { error: 0, warn: 1, dead: 2, ok: 3 };
  const rows = overview.attention;
  for (let i = 1; i < rows.length; i++) {
    const [prev, row] = [rows[i - 1], rows[i]];
    check(rank[prev.status] <= rank[row.status], `attention: ${prev.status} before ${row.status}`);
    if (prev.status === row.status) check(prev.calls >= row.calls, `attention: ${prev.status} rows not sorted by calls (${prev.tool} ${prev.calls} before ${row.tool} ${row.calls})`);
  }
  const dead = new Set(rows.filter(r => r.status === 'dead').map(r => r.tool));
  for (const name of tools.catalog.dead) check(dead.has(name), `catalog dead tool ${name} missing from attention`);
}

// 3. Handshake waiting copy only while rate or p95 is null (not reachable in the
// demo, whose handshake is always null, so rendered server-side).
{
  const base = {
    range: { from: '2026-10-05T00:00:00Z', to: '2026-10-12T00:00:00Z', prev_from: 'a', prev_to: 'b' }, generated_at: 'c',
    slo: [{ class: 'read', target: 99.5, success_rate: null, error_budget_pct: null, burn_rate_1h: null, burn_rate_6h: null }],
    timeouts: { count: null, pct: null }, cancellations: { count: null, pct: null }, error_codes: [],
    hallucinated_tools: { count: null, names: [] }, sessions_with_errors: { count: null, pct: null },
    silent_failures: { count: null }, auth_failures: [], availability: null,
  };
  for (const [handshake, wantWaiting] of [[{ attempts: 10, success_rate: 99.2, p95: 40 }, false], [{ attempts: 10, success_rate: null, p95: 40 }, true], [{ attempts: 10, success_rate: 99.2, p95: null }, true], [{ attempts: 10, success_rate: null, p95: null }, true]]) {
    const html = renderToStaticMarkup(createElement(ReliabilityScreen, { data: { ...base, handshake } }));
    check(html.includes('waiting for init outcomes') === wantWaiting, `handshake rate=${handshake.success_rate} p95=${handshake.p95}: waiting copy ${wantWaiting ? 'missing' : 'still shown'}`);
    check(!/<progress/.test(html), 'null error_budget_pct still renders a progress element');
  }
}

// 4. The request the real (non-demo) client builds, against the contract's
// parameter list: range|from|to and the filters client, tool, caller, transport.
{
  const urls = [];
  const savedFetch=globalThis.fetch;
  const savedLocation=globalThis.location;
  try {
  globalThis.location ??= { origin: 'http://127.0.0.1' };
  globalThis.fetch = async url => { urls.push(String(url)); return new globalThis.Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const { client } = await import('../../apps/dashboard/src/client.ts');
  for (const range of Object.keys(BUCKETS)) {
    await client.analytics('p1', 'overview', { range });
    await client.timeseries('p1', range);
    await client.toolTimeseries('p1', 'get_product', range);
  }
  const allowed = new Set(['range', 'from', 'to', 'client', 'tool', 'caller', 'transport']);
  for (const url of urls.filter(u => u.includes('/analytics/'))) {
    const params = [...new globalThis.URLSearchParams(url.split('?')[1] ?? '').keys()].filter(k => !allowed.has(k));
    check(params.length === 0, `analytics request sends non-contract parameter(s) ${params.join(',')}: ${url}`);
  }
  for (const url of urls.filter(u => /timeseries/.test(u))) {
    const bucket = new globalThis.URLSearchParams(url.split('?')[1] ?? '').get('bucket');
    const range = new globalThis.URLSearchParams(url.split('?')[1] ?? '').get('range');
    check(['24h','7d','30d'].includes(range), `legacy timeseries uses unsupported range: ${url}`);
    check(bucket === null || ['1h', '1d'].includes(bucket), `timeseries request sends bucket=${bucket}, collector accepts only 1h or 1d: ${url}`);
  }
  note(`client request URLs: ${urls.join(' | ')}`);
  } finally {globalThis.fetch=savedFetch;if(savedLocation===undefined)delete globalThis.location;else globalThis.location=savedLocation;}
}

// ----------------------------------------------------------- browser measures
const port = Number(process.env.R2_PORT ?? 23461);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/dashboard/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], { env: { ...process.env, VITE_DEMO: '1' }, stdio: 'pipe' });
server.stdout.on('data', () => {});
server.stderr.on('data', data => process.stderr.write(data));
let browser;
try {
  let ready = false;
  for (let n = 0; n < 150; n++) { if (server.exitCode !== null) throw new Error('demo server exited'); try { ready = (await globalThis.fetch(base)).ok; } catch { ready = false; } if (ready) break; await delay(100); }
  if (!ready) throw new Error('demo server did not start');
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });

  const open = async (width, theme) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, timezoneId: 'UTC', reducedMotion: 'reduce' });
    await context.addInitScript(() => { globalThis.__SIGNALS_VISUAL_QA__ = true; });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-12T00:00:00Z'));
    page.on('pageerror', error => failures.push(`page error: ${error.message}`));
    return { context, page };
  };
  const show = async (page, screen) => {
    await page.goto(`${base}/#${screen}`);
    await page.locator('.signals-ui .panel').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
  };

  // (a) theme-color meta: the bowl yellow, not a different literal.
  {
    const { context, page } = await open(1440, 'light');
    await page.goto(base);
    const themeColor = await page.getAttribute('meta[name="theme-color"]', 'content');
    check(themeColor?.toUpperCase() === '#FBC118', `theme-color is ${themeColor}, expected #FBC118`);
    await context.close();
  }

  // (b) Chart copy and axis labels follow the response bucket, per range.
  {
    const { context, page } = await open(1440, 'light');
    for (const [range, want] of Object.entries(BUCKETS)) {
      for (const [screen, panel, expected] of [['overview', 'Calls by client', `${want.label} tool calls · UTC`], ['adoption', 'Active users', `${want.label} observations · active identities`]]) {
        await show(page, screen);
        await page.getByRole('button', { name: RANGE_BUTTON[range], exact: true }).click();
        await page.waitForTimeout(400);
        const seen = await page.evaluate(title => {
          const node = [...document.querySelectorAll('.panel')].find(p => p.querySelector('h2')?.textContent?.trim() === title);
          return { subtitle: node?.querySelector('.card__sub')?.textContent?.trim(), labels: [...node.querySelectorAll('svg text.ax--dim')].map(t => t.textContent) };
        }, panel);
        check(seen.subtitle === expected, `${range} ${screen}: subtitle "${seen.subtitle}", expected "${expected}"`);
        const time = seen.labels.filter(l => !/^[\d.]+[KM]?$/.test(l));
        const shape = want.bucket === 'hour' ? /^\d{2}:\d{2}$/ : want.bucket === 'week' ? /^Week of \d{2}-\d{2}$/ : /^\d{2}\/\d{2}$/;
        check(time.length > 0 && time.every(l => shape.test(l)), `${range} ${screen}: time axis ${JSON.stringify(time)} does not match ${shape}`);
      }
    }
    await context.close();
  }

  // (c) Session durations come from the timestamps, with seconds precision.
  {
    const { context, page } = await open(1440, 'light');
    await show(page, 'sessions');
    const rows = await page.evaluate(() => {
      const table = document.querySelector('.signals-ui .table-scroll table');
      const index = [...table.querySelectorAll('thead th')].findIndex(h => h.textContent.trim() === 'Duration');
      return [...table.querySelectorAll('tbody tr')].map(r => r.children[index].textContent.trim());
    });
    const sessions = await demoClient.sessions('demo');
    sessions.items.forEach((session, i) => {
      if (!session.ended_at) return;
      const ms = Date.parse(session.ended_at) - Date.parse(session.started_at);
      const seconds = Math.floor(ms / 1000);
      const want = seconds >= 3600 ? `${Math.floor(seconds / 3600)} h ${Math.floor(seconds / 60) % 60} min` : seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
      check(rows[i] === want, `session ${session.session_id} lasts ${ms}ms, screen shows "${rows[i]}", expected "${want}"`);
    });
    note(`session durations: ${JSON.stringify(rows)}`);
    await context.close();
  }

  // (d) Every catalogued dead tool is an attention row on the rendered screen.
  {
    const { context, page } = await open(1440, 'light');
    await show(page, 'overview');
    const rows = await page.evaluate(() => {
      const panel = [...document.querySelectorAll('.panel')].find(p => p.querySelector('h2')?.textContent?.trim() === 'Tools needing attention');
      return [...panel.querySelectorAll('.ribrow')].map(r => [r.querySelector('code').textContent.trim(),r.querySelector('.chip').textContent.trim(),r.querySelector('.val').textContent.trim()]);
    });
    const tools = await demoClient.analytics('demo', 'tools', { range: '7d' });
    for (const name of tools.catalog.dead) {
      const row = rows.find(r => r[0] === name);
      check(!!row && row[2] === 'dead', `attention row for dead tool ${name}: ${JSON.stringify(row)}`);
    }
    await context.close();
  }

  // (e) A null error budget shows no data and no progress element. Reached by
  // moving every tool to the read class in Settings, which empties mutate.
  {
    const { context, page } = await open(1440, 'light');
    await show(page, 'settings');
    const selects = await page.getByRole('combobox').all();
    let moved = 0;
    for (const select of selects) {
      const label = await select.getAttribute('aria-label');
      if (!label?.endsWith('SLO class')) continue;
      if (await select.inputValue() === 'mutate') { await select.selectOption('read'); moved++; }
    }
    check(moved > 0, 'settings: no tool was in the mutate class to move');
    await page.getByRole('button', { name: 'Save analytics settings', exact: true }).click();
    await page.getByText('Analytics settings saved.', { exact: true }).waitFor();
    await show(page, 'reliability');
    const slo = await page.evaluate(() => [...document.querySelectorAll('.slo-gauge')].map(p => ({ title: p.querySelector('h3').textContent.trim(), text: p.innerText.replace(/\n+/g, ' | '), progress: [...p.querySelectorAll('progress')].map(x => x.getAttribute('value')) })));
    const mutate = slo.find(s => s.title.startsWith('mutate'));
    check(!!mutate, 'reliability: no mutate SLO panel after moving every tool to read');
    check(mutate?.progress.length === 0, `mutate SLO with no calls still renders progress ${JSON.stringify(mutate?.progress)}`);
    check(/No data yet/.test(mutate?.text ?? ''), `mutate SLO with no calls shows "${mutate?.text}"`);
    check(/No calls for this class/.test(mutate?.text ?? ''), `mutate SLO missing the no-data reason: "${mutate?.text}"`);
    note(`null-budget SLO panels: ${JSON.stringify(slo)}`);
    await context.close();
  }

  // (f) Nullable measurements never render a false zero.
  {
    const { context, page } = await open(1440, 'light');
    for (const screen of ['reliability', 'protocol', 'cost', 'callers', 'sessions']) {
      await show(page, screen);
      const zeroed = await page.evaluate(() => [...document.querySelectorAll('.tile')].filter(t => /^(0|0 ms|0%|0 ×)$/.test(t.querySelector('strong')?.textContent?.trim() ?? '')).map(t => t.innerText.replace(/\n+/g, ' | ')));
      note(`${screen}: zero-valued tiles ${JSON.stringify(zeroed)}`);
    }
    const reliability = await demoClient.analytics('demo', 'reliability', { range: '7d' });
    await show(page, 'reliability');
    const tiles = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tile')].map(t => [t.querySelector('.eyebrow').textContent.trim().toUpperCase(), t.querySelector('strong').textContent.trim()])));
    check(reliability.timeouts.count !== null || tiles.TIMEOUTS === 'No data yet', `null timeouts count rendered as ${tiles.TIMEOUTS}`);
    check(reliability.handshake.success_rate !== null || tiles.HANDSHAKE === 'No data yet', `null handshake rate rendered as ${tiles.HANDSHAKE}`);
    check(reliability.hallucinated_tools.count !== null || tiles['HALLUCINATED TOOLS'] === 'No data yet', `null hallucinated count rendered as ${tiles['HALLUCINATED TOOLS']}`);
    check(/waiting for init outcomes/.test(await page.locator('.tile', { hasText: 'HANDSHAKE' }).innerText()), 'handshake with null rate and p95 omits the waiting reason');
    await context.close();
  }

  // (g) Blast radius: every screen, both themes, both widths. Krona weight,
  // label sizes, table visibility, mobile list pattern, no page scroll, no
  // clipped text.
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 1440]) {
      const { context, page } = await open(width, theme);
      for (const screen of SCREENS) {
        await show(page, screen);
        const m = await page.evaluate(() => {
          const style = el => getComputedStyle(el);
          const krona = [...document.querySelectorAll('body *')].filter(el => style(el).fontFamily.includes('Krona One'));
          return {
            kronaCount: krona.length,
            kronaBad: krona.filter(el => style(el).fontWeight !== '400' || style(el).fontSynthesis !== 'none').map(el => `${el.tagName}.${el.className}:${style(el).fontWeight}/${style(el).fontSynthesis}`),
            labelCount: document.querySelectorAll('.eyebrow,.status-pill').length,
            labelBad: [...document.querySelectorAll('.eyebrow,.status-pill')].filter(el => style(el).fontSize !== '10.5px').map(el => `${el.className}:${style(el).fontSize}`),
            tables: [...document.querySelectorAll('.table-scroll')].map(el => ({
              overflows: el.scrollWidth > el.clientWidth + 1,
              hint: !!el.parentElement.querySelector('.table-scroll-hint'),
              focusable: el.tabIndex === 0,
              rowDisplay: [...new Set([...el.querySelectorAll('tbody tr')].map(r => style(r).display))],
              headVisible: style(el.querySelector('thead')).clipPath === 'none',
              clipped: [...el.querySelectorAll('th,td')].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => `${c.tagName}"${c.textContent.trim().slice(0, 24)}" ${c.scrollWidth}>${c.clientWidth}`),
              unlabelled: [...el.querySelectorAll('tbody tr')].flatMap(r => [...r.children].slice(1).filter(c => !c.getAttribute('data-label')).map(c => `"${c.textContent.trim().slice(0, 20)}"`)),
              labelsRendered: [...el.querySelectorAll('tbody tr td:nth-child(2)')].map(c => getComputedStyle(c, '::before').content).slice(0, 1),
            })),
            clippedText: [...document.querySelectorAll('.signals-ui *,.topbar *,.page-heading *,.app-footer *')].filter(el => {
              const cs = style(el);
              if (el.closest('.sr-only') || el.closest('svg') || el.closest('.tile__meta') || el.closest('.tile__label') || el.closest('.ribrow code') || el.closest('.table-scroll') || el.closest('pre') || el.tagName === 'PRE' || ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)) return false;
              return !el.children.length && el.textContent.trim() && (el.scrollWidth > el.clientWidth + 1 || cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 1);
            }).map(el => `${el.tagName}.${el.className}"${el.textContent.trim().slice(0, 24)}" ${el.scrollWidth}x${el.scrollHeight}>${el.clientWidth}x${el.clientHeight}`),
            pageScroll: document.documentElement.scrollWidth - innerWidth,
          };
        });
        const where = `${screen} ${width}/${theme}`;
        check(m.kronaCount > 0, `${where}: no Krona element found (selector drifted?)`);
        check(m.kronaBad.length === 0, `${where}: Krona weight/synthesis ${JSON.stringify(m.kronaBad)}`);
        check(m.labelCount > 0, `${where}: no eyebrow or pill found`);
        check(m.labelBad.length === 0, `${where}: label size ${JSON.stringify(m.labelBad)}`);
        check(m.pageScroll <= 0, `${where}: horizontal page scroll ${m.pageScroll}px`);
        check(m.clippedText.length === 0, `${where}: clipped text ${JSON.stringify(m.clippedText.slice(0, 3))}`);
        m.tables.forEach((t, i) => {
          check(t.clipped.length === 0, `${where} table ${i}: clipped cells ${JSON.stringify(t.clipped.slice(0, 3))}`);
          check(t.headVisible, `${where} table ${i}: header remains visible`);
          if (t.overflows) {
            check(t.hint, `${where} table ${i}: scrolls with no visible affordance`);
            check(t.focusable, `${where} table ${i}: scroll region is not keyboard focusable`);
          }
        });
      }
      await context.close();
    }
  }

  // (h) Tools drawer.
  {
    const { context, page } = await open(1440, 'light');
    await show(page, 'tools');
    await page.getByRole('button', { name: 'book_flight', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Error split', exact: true }).waitFor();
    const text = await dialog.innerText();
    const tools = await demoClient.analytics('demo', 'tools', { range: '7d' });
    const tool = tools.tools.find(t => t.tool === 'book_flight');
    const cells = await dialog.evaluate(d => Object.fromEntries([...d.querySelectorAll('tbody tr')].map(r => [r.children[0].textContent.trim(), r.children[1].textContent.trim()])));
    check(text.includes('book_flight'), 'tools drawer: tool name missing');
    for (const [kind, value] of Object.entries(tool.errors)) {
      const want = value === null ? 'No data yet' : value.toLocaleString('en');
      check(cells[kind] === want, `tools drawer: error kind ${kind} shows "${cells[kind]}", data says ${value} (expected "${want}")`);
    }
    check(cells['Retries within 30s'] === String(tool.retries.count), `tools drawer: retries show "${cells['Retries within 30s']}", data says ${tool.retries.count}`);
    check(cells['Self-corrected'] === `${tool.retries.self_corrected_pct}%`, `tools drawer: self-corrected shows "${cells['Self-corrected']}", data says ${tool.retries.self_corrected_pct}`);
    check(cells['Input schema failures'] === (tool.schema_failures.input === null ? 'No data yet' : String(tool.schema_failures.input)), `tools drawer: input schema failures show "${cells['Input schema failures']}"`);
    check(cells['Output schema failures'] === (tool.schema_failures.output === null ? 'No data yet' : String(tool.schema_failures.output)), `tools drawer: output schema failures show "${cells['Output schema failures']}"`);
    check(cells['Output tokens'] === `≈ ${tool.output_tokens_est.toLocaleString('en')}`, `tools drawer: output tokens show "${cells['Output tokens']}", data says ${tool.output_tokens_est}`);
    check(await dialog.locator('.sparkline,svg[role="img"]').count() > 0, 'tools drawer: no trend chart');
    check(!/\b0 ms\b/.test(text) || tool.latency.p50 === 0, 'tools drawer: a null latency rendered as 0 ms');
    note(`tools drawer text: ${text.replace(/\n+/g, ' | ')}`);
    await page.keyboard.press('Escape');
    await context.close();
  }

  // (i) Sessions timeline drawer.
  {
    const { context, page } = await open(1440, 'light');
    await show(page, 'sessions');
    await page.locator('tbody .row-button').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.timeline li').first().waitFor();
    const sessions = await demoClient.sessions('demo');
    const session = sessions.items[0];
    const timeline = await demoClient.timeline('demo', session.session_id);
    const seen = await dialog.evaluate(d => ({
      text: d.innerText.replace(/\n+/g, ' | '),
      items: [...d.querySelectorAll('.timeline li')].map(li => li.innerText.replace(/\n+/g, ' · ')),
    }));
    check(seen.items.length === timeline.events.length, `sessions drawer: ${seen.items.length} timeline rows, demo timeline has ${timeline.events.length}`);
    const offsets = timeline.events.map(e => e.offset_ms);
    check(offsets.every((v, i) => i === 0 || offsets[i - 1] <= v), `sessions drawer: timeline offsets not ordered ${offsets.join(',')}`);
    for (const field of [timeline.session.client?.name, timeline.session.transport, timeline.session.identity?.key]) {
      if (field) check(seen.text.includes(String(field)), `sessions drawer: header field "${field}" missing`);
    }
    check(!/\b0 ms\b/.test(seen.text.split('Session timeline')[0]), `sessions drawer: running session duration rendered as 0 ms: ${seen.text}`);
    note(`sessions drawer (running): ${seen.text}`);
    note(`timeline rows: ${JSON.stringify(seen.items)}`);
    await page.keyboard.press('Escape');
    // An ended session: the contract's session header carries reason and duration.
    const endedIndex = sessions.items.findIndex(s => s.ended_at);
    await page.locator('tbody .row-button').nth(endedIndex).click();
    await dialog.locator('.timeline li').first().waitFor();
    const endedTimeline = await demoClient.timeline('demo', sessions.items[endedIndex].session_id);
    const endedText = (await dialog.innerText()).replace(/\n+/g, ' | ');
    check(endedText.includes(endedTimeline.session.reason), `sessions drawer: end reason "${endedTimeline.session.reason}" missing from ${endedText}`);
    check(/8,400 ms|8 s/.test(endedText), `sessions drawer: duration (${endedTimeline.session.duration_ms} ms) missing from ${endedText}`);
    check(await dialog.locator('.timeline li').count() === endedTimeline.events.length, `sessions drawer: ended session shows ${await dialog.locator('.timeline li').count()} rows, timeline has ${endedTimeline.events.length}`);
    check(/SESSION.ENDED/i.test(endedText), 'sessions drawer: ended session has no session.ended row');
    note(`sessions drawer (ended): ${endedText}`);
    await page.keyboard.press('Escape');
    await context.close();
  }

  // (j) Settings: alert rules, digest, token divisor.
  {
    const { context, page } = await open(1440, 'light');
    await show(page, 'settings');
    const alerts = await demoClient.analytics('demo', 'alerts', {});
    const rules = await page.evaluate(() => [...document.querySelectorAll('.alert-rule')].map(r => ({
      name: r.querySelector('label').innerText.trim(),
      enabled: r.querySelector('input[type=checkbox]').checked,
      threshold: r.querySelector('input[aria-label$="threshold"]').value,
      window: r.querySelector('input[aria-label$="window"]').value,
      state: r.querySelector('.status-pill')?.textContent.trim(),
    })));
    check(rules.length === 5, `settings: ${rules.length} alert rules, the contract names five defaults`);
    for (const rule of alerts.rules) {
      const row = rules.find(r => r.name === rule.name);
      check(!!row, `settings: alert rule "${rule.name}" not rendered`);
      if (row) {
        check(Number(row.threshold) === rule.threshold, `settings: "${rule.name}" threshold shows ${row.threshold}, data says ${rule.threshold}`);
        check(Number(row.window) === rule.window_minutes, `settings: "${rule.name}" window shows ${row.window}, data says ${rule.window_minutes}`);
        check(row.enabled === rule.enabled, `settings: "${rule.name}" enabled shows ${row.enabled}, data says ${rule.enabled}`);
        check(row.state === rule.state, `settings: "${rule.name}" state shows ${row.state}, data says ${rule.state}`);
      }
    }
    // Edit a rule and the digest, save, leave the screen and come back.
    await page.getByLabel('Error rate (%) threshold').fill('9');
    await page.getByLabel('Error rate (%) window').fill('25');
    await page.getByRole('checkbox', { name: 'Volume versus 7-day average' }).uncheck();
    await page.getByLabel('Weekly email digest').check();
    await page.getByLabel('Digest recipient').fill('r2@example.com');
    await page.getByLabel('Token divisor', { exact: true }).fill('8');
    await page.getByRole('button', { name: 'Save analytics settings', exact: true }).click();
    await page.getByText('Analytics settings saved.', { exact: true }).waitFor();
    await show(page, 'cost');
    const perCall = await page.evaluate(() => [...document.querySelectorAll('.tile')].find(t => t.querySelector('.eyebrow').textContent.trim().toUpperCase() === 'PER CALL')?.querySelector('strong').textContent.trim());
    const baseCost = await demoClient.analytics('demo', 'cost', { range: '7d' });
    note(`cost per call with divisor 8: ${perCall} (divisor-4 demo value ${baseCost.per_call})`);
    check(!!perCall, 'cost screen: no "per call" tile found');
    check(perCall !== `≈ ${baseCost.per_call.toLocaleString('en')}`, `settings: token divisor 8 left "per call" at the divisor-4 value ${perCall}`);
    const halved = Math.abs(Number(perCall?.replace(/[^\d.]/g, '')) - baseCost.per_call / 2);
    check(halved <= 2, `settings: token divisor 8 gave per-call ${perCall}, expected about ${Math.round(baseCost.per_call / 2)}`);
    await show(page, 'settings');
    const after = await page.evaluate(() => ({
      rules: [...document.querySelectorAll('.alert-rule')].map(r => ({ name: r.querySelector('label').innerText.trim(), enabled: r.querySelector('input[type=checkbox]').checked, threshold: r.querySelector('input[aria-label$="threshold"]').value, window: r.querySelector('input[aria-label$="window"]').value })),
      digest: document.querySelector('.checkbox-field input').checked,
      recipient: [...document.querySelectorAll('input[type=email]')].map(i => i.value),
      divisor: [...document.querySelectorAll('input[type=number]')].map(i => i.value),
    }));
    const errorRule = after.rules.find(r => r.name === 'Error rate (%)');
    check(errorRule?.threshold === '9' && errorRule?.window === '25', `settings: edited alert rule did not persist ${JSON.stringify(errorRule)}`);
    check(after.rules.find(r => r.name.startsWith('Volume'))?.enabled === false, 'settings: disabling an alert rule did not persist');
    check(after.digest === true, 'settings: digest toggle did not persist');
    check(after.recipient.includes('r2@example.com'), `settings: digest recipient did not persist ${JSON.stringify(after.recipient)}`);
    check(after.divisor.includes('8'), `settings: token divisor did not persist ${JSON.stringify(after.divisor)}`);
    note(`settings after reload: ${JSON.stringify(after)}`);
    // SLO targets drive the reliability screen and the below-SLO tile.
    await page.getByLabel('read SLO target (%)').fill('99.9');
    await page.getByRole('button', { name: 'Save analytics settings', exact: true }).click();
    await page.getByText('Analytics settings saved.', { exact: true }).waitFor();
    await show(page, 'reliability');
    const target = await page.evaluate(() => [...document.querySelectorAll('.slo-gauge')].map(p => `${p.querySelector('h3').textContent.trim()}: ${p.querySelector('small').textContent.trim()}`));
    check(target.some(t => t.startsWith('read SLO') && t.includes('99.9')), `settings: read SLO target 99.9 not reflected on the reliability screen ${JSON.stringify(target)}`);
    await show(page, 'overview');
    const belowSlo = await page.evaluate(() => [...document.querySelectorAll('.tile')].find(t => t.querySelector('.eyebrow').textContent.trim().toUpperCase() === 'TOOL SUCCESS')?.innerText.replace(/\n+/g, ' | '));
    note(`success tile after read target 99.9: ${belowSlo}`);
    check(/below SLO/i.test(belowSlo ?? ''), `overview: success tile does not report tools below SLO (${belowSlo})`);
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}

if (process.env.R2_NOTES) console.log(notes.join('\n'));
if (failures.length) { console.error(`review-r2 probe failures (${failures.length}):\n${failures.join('\n')}`); process.exit(1); }
console.log('review-r2 probe passed');

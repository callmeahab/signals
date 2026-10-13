// Review probe for the v6 dashboard polish (reviews/dash-v6-r1.md): the teal / gold /
// ember / muted project mapping of item 3, proven against a real collector rather than
// against direct calls into the observer.
//
// `scripts/backend-qa.mjs` has no project-status assertion, and `scripts/v6-qa.mjs`
// proves the mapping by importing `project-status.ts` in the page and feeding it a
// literal overview body, so the one thing nothing covers is the wiring: does a real
// `/v1/projects/<id>/analytics/overview` answer from a project that has events reach the
// card as teal, and a project with none as gold?
//
// Needs a collector serving the built dashboard:
//
//   docker run -d --name review-v6-pg -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals \
//     -p 127.0.0.1:25680:5432 postgres:17
//   DATABASE_URL=postgres://postgres:signals@127.0.0.1:25680/review_v6_ui \
//   SIGNALS_BIND=127.0.0.1:25691 SIGNALS_PUBLIC_URL=http://127.0.0.1:25691 \
//   SIGNALS_ADMIN_TOKEN=ci-isolated-admin-token-32-characters \
//   SIGNALS_SESSION_SECRET=ci-isolated-session-secret-32-characters \
//   SIGNALS_BOOTSTRAP_EMAIL=owner@signals.test SIGNALS_BOOTSTRAP_PASSWORD=signals-test-password \
//     target/debug/signals serve &
//   SIGNALS_URL=http://127.0.0.1:25691 PLAYWRIGHT_CHANNEL=chromium \
//     bun test/review-v6-r1/project-status-backend.mjs
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const base = process.env.SIGNALS_URL ?? 'http://127.0.0.1:25691';
const admin = process.env.SIGNALS_ADMIN_TOKEN ?? 'ci-isolated-admin-token-32-characters';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

const uuid7 = () => { const hex = Date.now().toString(16).padStart(12, '0'); return `${hex.slice(0, 8)}-${hex.slice(8)}-7${crypto.randomUUID().slice(15)}`; };
const envelope = events => ({ schema_version: 1, source: { sdk: 'review-v6', sdk_version: '1', server_name: 'review', server_version: '1', instance_id: 'review-1' }, sent_at: new Date().toISOString(), dropped: 0, events });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const page = await context.newPage();
  const json = async response => { assert.equal(response.status(), 200, await response.text()); return response.json(); };

  await page.goto(base);
  await page.getByLabel('Email', { exact: true }).fill(process.env.SIGNALS_TEST_EMAIL ?? 'owner@signals.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.SIGNALS_TEST_PASSWORD ?? 'signals-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();

  const account = await json(await page.request.get(`${base}/v1/auth/me`));
  const tenant = account.projects[0].tenant_id;
  const make = async (name, slug) => json(await page.request.post(`${base}/v1/admin/projects`, { headers: { Authorization: `Bearer ${admin}` }, data: { tenant_id: tenant, slug: `${slug}-${Date.now()}`, name } }));
  const busy = await make('Receiving events', 'busy');
  const quiet = await make('No events yet', 'quiet');

  // Real ingest into `busy` only.
  const key = await json(await page.request.post(`${base}/v1/admin/keys`, { headers: { Authorization: `Bearer ${admin}` }, data: { project_id: busy.id, label: 'review-v6', scopes: ['ingest', 'read'] } }));
  const start = Date.now() - 30000;
  const event = (type, offset, attrs) => ({ id: uuid7(), ts: new Date(start + offset).toISOString(), type, session_id: 'review-v6-session', client: { name: 'Review client', version: '1', protocol_version: '2025-03-26' }, caller: { subject: 'review-v6 identity' }, attrs });
  const events = [
    event('session.started', 0, { transport: 'streamable-http' }),
    ...Array.from({ length: 5 }, (_, i) => event('tool.called', 1000 + i * 100, { tool: 'search_documents', duration_ms: 70 + i, is_error: false, input_bytes: 20, output_bytes: 40, output_kinds: ['text'], cancelled: false })),
    event('session.ended', 5000, { reason: 'client', duration_ms: 5000 }),
  ];
  const ingested = await page.request.post(`${base}/v1/events`, { headers: { Authorization: `Bearer ${key.secret}` }, data: envelope(events) });
  assert.equal(ingested.status(), 202, await ingested.text());
  await expect.poll(async () => (await json(await page.request.get(`${base}/v1/projects/${busy.id}/analytics/overview?range=7d`))).tiles.tool_calls.value, { timeout: 70000 }).toBe(5);
  assert.equal((await json(await page.request.get(`${base}/v1/projects/${quiet.id}/analytics/overview?range=7d`))).tiles.tool_calls.value, 0);

  const state = async id => page.locator(`.project-card[data-project="${id}"] .project-card__status`).evaluate(el => ({ cls: el.className, title: el.getAttribute('title'), dot: getComputedStyle(el.querySelector('.project-status-dot')).backgroundColor, icon: el.querySelector('lord-icon')?.getAttribute('data-name') ?? el.querySelector('lord-icon')?.className }));
  const select = async id => { await page.locator(`.project-card[data-project="${id}"]`).click(); await page.waitForFunction(w => document.querySelector('.project-card.is-selected')?.dataset.project === w, id); await page.waitForTimeout(1500); };

  await page.reload();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await page.waitForTimeout(1500);

  // The author's brief defines gold as "connected but no events in the window". A
  // project nobody has selected yet has had no overview read, so it is gold whatever its
  // data says — here while `/analytics/overview` for it reports five tool calls.
  const unvisited = await state(busy.id);
  check(unvisited.cls.includes('status-unknown') && unvisited.title === 'Not checked yet',
    `a project with five tool calls in the window is not shown as gold before it is selected: ${JSON.stringify(unvisited)} — gold means "connected but no events in the window", which is not what is known here`);

  // teal: connected and receiving events in the window.
  await select(busy.id);
  const busyState = await state(busy.id);
  check(busyState.cls.includes('status-healthy'), `a project with events in the window is teal: ${JSON.stringify(busyState)}`);

  // gold: connected, no events in the window.
  await select(quiet.id);
  const quietState = await state(quiet.id);
  check(quietState.cls.includes('status-warn'), `a project with no events in the window is gold: ${JSON.stringify(quietState)}`);

  // The project that was teal a moment ago must stay teal while another is selected.
  const busyAfter = await state(busy.id);
  check(busyAfter.cls.includes('status-healthy'), `the busy project keeps its teal state while another project is selected: ${JSON.stringify(busyAfter)}`);

  // ember: the collector answers 503 for this project's reads.
  await page.route(`**/v1/projects/${quiet.id}/**`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Collector unavailable' }) }));
  await select(busy.id);
  await select(quiet.id);
  const downState = await state(quiet.id);
  check(downState.cls.includes('status-error'), `a project whose reads fail with 503 is ember: ${JSON.stringify(downState)}`);
  await page.unroute(`**/v1/projects/${quiet.id}/**`);

  // No status request of its own: every request the page made carries a screen's route.
  const extra = [];
  page.on('request', request => { const url = new URL(request.url()); if (/^\/v1\/projects\/[^/]+\/?$/.test(url.pathname)) extra.push(url.pathname + url.search); });
  await select(busy.id);
  check(extra.length === 0, `selecting a project adds no per-project status request: ${JSON.stringify(extra)}`);

  // v6 brief item 5: the freshness badge is gone, "Polling itself stays as it is" —
  // read off the collector's own request log rather than off the activity store.
  {
    const polls = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const poller = await polls.newPage();
    const log = [];
    poller.on('request', request => { const url = new URL(request.url()); if (url.pathname.includes('/analytics/')) log.push(url.pathname + url.search); });
    await poller.clock.install();
    await poller.goto(base);
    await poller.getByLabel('Email', { exact: true }).fill(process.env.SIGNALS_TEST_EMAIL ?? 'owner@signals.test');
    await poller.getByLabel('Password', { exact: true }).fill(process.env.SIGNALS_TEST_PASSWORD ?? 'signals-test-password');
    await poller.getByRole('button', { name: 'Sign in', exact: true }).click();
    await poller.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    await poller.waitForTimeout(1500);
    check(await poller.locator('.updated-ago, .signal-dot').count() === 0, 'the freshness badge and collector pulse are gone');
    const before = log.length;
    await poller.clock.fastForward(61000);
    await poller.waitForTimeout(1500);
    check(log.length > before, `polling is observed in the collector's request log: ${before} analytics requests before the interval, ${log.length} after`);
    await polls.close();
  }

  await context.close();
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r1 project-status backend probe passed');

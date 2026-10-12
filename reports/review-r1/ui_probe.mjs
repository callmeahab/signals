// Browser checks for the funnel null step and the four trend sparklines.
// Reads project ids from /tmp/dash-v3-review-projects.json (trend_probe.py).
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../web/package.json'));
const { chromium } = require('@playwright/test');
const base = process.env.SIGNALS_URL ?? 'http://127.0.0.1:25540';
const projects = require('/tmp/dash-v3-review-projects.json');
const shots = '/tmp/dash-v3-review-ui';
mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); console.log(`${ok ? 'PASS' : 'FAIL'} ${message}`); };

const tileFor = (page, label) => page.locator('.tile').filter({ has: page.getByText(label, { exact: true }) });

async function login(page) {
  await page.goto(base);
  await page.getByLabel('Email', { exact: true }).fill(process.env.SIGNALS_BOOTSTRAP_EMAIL ?? 'owner@signals.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.SIGNALS_BOOTSTRAP_PASSWORD ?? 'signals-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
}

async function show(page, project, screen) {
  await page.getByLabel('Select project').selectOption(project);
  await page.goto(`${base}/#${screen}`);
  await page.getByLabel('Select project').selectOption(project);
  await page.getByRole('heading', { name: screen[0].toUpperCase() + screen.slice(1), exact: true }).waitFor();
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      scrollTo(0, y);
      await new Promise(r => setTimeout(r, 30));
    }
    scrollTo(0, 0);
    await document.fonts.ready;
  });
}

async function painted(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.locator('svg[role=img], .spark-wait, .emptychart').first().waitFor({ timeout: 10000 });
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, timezoneId: 'UTC' });
      const page = await context.newPage();
      const tag = `${theme}/${width}`;
      await login(page);
      await show(page, projects.fresh, 'overview');
      const funnel = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Activation funnel', exact: true }) });
      await painted(funnel);
      check(await funnel.locator('.emptychart').count() === 0, `${tag} funnel is not the whole-chart empty state`);
      check(await funnel.locator('.chart-funnel svg.growx').count() === 4, `${tag} four painted funnel steps`);
      check(await funnel.locator('.chart-funnel rect.nullstep').count() === 1, `${tag} one null funnel step`);
      const caption = await funnel.locator('.chart-funnel svg[role=img] text').allTextContents();
      check(caption.includes('Waiting · 0 eligible'), `${tag} null step caption ${JSON.stringify(caption)}`);
      const twin = await funnel.locator('.chart-funnel table.sr-only tbody tr').last().locator('td').allTextContents();
      check(JSON.stringify(twin) === JSON.stringify(['returned_day_7', '—', '—']), `${tag} funnel table twin ${JSON.stringify(twin)}`);
      const sessions = tileFor(page, 'Sessions');
      await painted(sessions);
      check(await sessions.locator('.chart-sparkline svg').count() === 1, `${tag} sessions sparkline drawn`);
      check(await sessions.getByText('Waiting for trend', { exact: true }).count() === 0, `${tag} sessions tile is not waiting`);
      const size = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      check(size[0] <= size[1], `${tag} overview overflow ${size}`);
      await page.screenshot({ path: `${shots}/funnel-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });

      await show(page, projects.fresh, 'adoption');
      for (const label of ['WAU', 'MAU', 'Stickiness']) {
        const tile = tileFor(page, label);
        await painted(tile);
        check(await tile.locator('.chart-sparkline svg').count() === 1, `${tag} ${label} sparkline drawn`);
        check(await tile.getByText('Waiting for trend', { exact: true }).count() === 0, `${tag} ${label} is not waiting`);
      }
      const curve = page.locator('.chart-line');
      await painted(curve);
      check(await curve.locator('svg[role=img] circle').count() === 4, `${tag} conversion ends at the last counted step`);
      check(!(await curve.locator('svg[role=img]').textContent()).includes('returned day 7'), `${tag} conversion has no null-step label`);
      const curveTwin = await curve.locator('table.sr-only tbody tr').last().locator('td').allTextContents();
      check(JSON.stringify(curveTwin) === JSON.stringify(['returned_day_7', '—', '—']), `${tag} conversion table twin ${JSON.stringify(curveTwin)}`);
      await page.screenshot({ path: `${shots}/adoption-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });

      await show(page, projects.fresh, 'sessions');
      const pageSessions = tileFor(page, 'Sessions');
      await painted(pageSessions);
      check(await pageSessions.locator('.chart-sparkline svg').count() === 1, `${tag} sessions page sparkline drawn`);
      check(await pageSessions.getByText('Waiting for trend', { exact: true }).count() === 0, `${tag} sessions page is not waiting`);
      await context.close();
    }
  }

  // No session ids: the sessions series is null, so that tile waits. WAU is a
  // real zero-or-more count, so its sparkline still draws.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
    const page = await context.newPage();
    await login(page);
    await show(page, projects.nosession, 'overview');
    const sessions = tileFor(page, 'Sessions');
    await painted(sessions);
    check(await sessions.getByText('Waiting for trend', { exact: true }).count() === 1, 'null sessions series waits');
    check(await sessions.locator('.chart-sparkline svg').count() === 0, 'null sessions series draws no sparkline');
    await show(page, projects.nosession, 'adoption');
    const wau = tileFor(page, 'WAU');
    await painted(wau);
    check(await wau.locator('.chart-sparkline svg').count() === 1, 'wau still draws when sessions are null');
    check(await wau.getByText('Waiting for trend', { exact: true }).count() === 0, 'wau is not waiting');
    await context.close();
  }

  // Force every sample null, then a mix, without changing the collector.
  async function withAdoption(mutate, run) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await context.newPage();
    await page.route('**/analytics/adoption**', async route => {
      const response = await route.fetch();
      const body = await response.json();
      mutate(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await login(page);
    await run(page);
    await context.close();
  }
  await withAdoption(body => {
    for (const point of body.active.points) {
      point.sessions = null;
      point.wau = null;
      point.mau = null;
    }
  }, async page => {
    await show(page, projects.fresh, 'overview');
    await painted(tileFor(page, 'Sessions'));
    check(await tileFor(page, 'Sessions').getByText('Waiting for trend', { exact: true }).count() === 1, 'all-null sessions waits');
    await show(page, projects.fresh, 'adoption');
    for (const label of ['WAU', 'MAU', 'Stickiness']) {
      await painted(tileFor(page, label));
      check(await tileFor(page, label).getByText('Waiting for trend', { exact: true }).count() === 1, `all-null ${label} waits`);
    }
  });
  await withAdoption(body => {
    body.active.points = [
      { t: '2026-10-09', users: 1, sessions: 1, wau: 1, mau: 0, new: 1, returning: 0, by_kind: { strong: 1, key: 0, network: 0 } },
      { t: '2026-10-10', users: 2, sessions: null, wau: 2, mau: 0, new: 0, returning: 2, by_kind: { strong: 2, key: 0, network: 0 } },
    ];
  }, async page => {
    await show(page, projects.fresh, 'overview');
    const sessions = tileFor(page, 'Sessions');
    await painted(sessions);
    check(await sessions.locator('.chart-sparkline svg').count() === 1, 'mixed sessions draws a sparkline');
    check(await sessions.getByText('Waiting for trend', { exact: true }).count() === 0, 'mixed sessions does not wait');
    await show(page, projects.fresh, 'adoption');
    await painted(tileFor(page, 'WAU'));
    await painted(tileFor(page, 'MAU'));
    await painted(tileFor(page, 'Stickiness'));
    check(await tileFor(page, 'WAU').locator('.chart-sparkline svg').count() === 1, 'numeric wau draws');
    check(await tileFor(page, 'MAU').locator('.chart-sparkline svg').count() === 1, 'zero mau draws rather than waiting');
    check(await tileFor(page, 'Stickiness').getByText('Waiting for trend', { exact: true }).count() === 1, 'stickiness waits when every mau is 0');
  });
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('UI probe passed');

// Review probe for the v6 dashboard polish (reviews/dash-v6-r1.md): a failed read on a
// project change must not leave the previous project's answer on screen as this one's.
//
// `useQuery` dropped `if (kind !== 'refresh') held.current = undefined` in
// packages/ui/src/dashboard.tsx, so every failure now keeps `old.value`. v6 brief item 6
// asks for content continuity through *refreshes and dependency changes* ("never show a
// skeleton or unmount content"); the previous answer standing in for a different project
// is the case the removed line existed to prevent, and the split supporting queries in
// `AnalyticsV3` carry no error notice of their own at all.
//
//   VITE_DEMO=1 bun node_modules/vite/bin/vite.js --config apps/dashboard/vite.config.ts \
//     --host 127.0.0.1 --port 23336 &
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium bun test/review-v6-r1/stale-project.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

// `demo` has three clients in its mix, `demo-many-clients` has 27: the legend row count
// alone says which project's adoption answer is on screen.
const legendRows = page => page.locator('.client-mix .legendlist .r').count();
const tileValue = (page, label) => page.evaluate(name => [...document.querySelectorAll('.tile')]
  .find(el => el.querySelector('.tile__label span')?.textContent?.trim() === name)
  ?.querySelector('.tile__value strong')?.textContent?.trim(), label);

// Fail one analytics route for one project, leaving every other read alone. `armed`
// defers the failure until the page says so, for the cases that need a first paint from
// the same project.
const breakRoute = (context, project, route, armed = true) => context.route('**/src/demo.ts*', async handler => {
  const response = await handler.fetch();
  const body = await response.text();
  await handler.fulfill({ response, body: `${body}
globalThis.__failRead=${armed};
const originalAnalytics=demoClient.analytics;
demoClient.analytics=async(...args)=>{if(globalThis.__failRead&&args[0]===${JSON.stringify(project)}&&args[1]===${JSON.stringify(route)})throw new Error('Injected ${route} failure');return originalAnalytics(...args);};` });
});

const open = async (project, route, armed = true) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  await breakRoute(context, project, route, armed);
  const page = await context.newPage();
  await page.goto(`${base}/#overview`);
  await page.getByRole('heading', { name: 'Calls by client' }).waitFor();
  await page.locator('.tile__value strong').first().waitFor();
  await page.waitForTimeout(600);
  return { context, page };
};

try {
  // (a) A supporting read fails on the new project. The Client mix card and the Active
  // users / Sessions sparklines come from `adoption`; nothing on the screen says the
  // answer is not this project's.
  {
    const { context, page } = await open('demo-many-clients', 'adoption');
    const before = await legendRows(page);
    check(before === 3, `the first project's client mix has ${before} legend rows`);
    await page.locator('.project-card').nth(3).click();   // Northwind MCP · 27 clients
    await page.waitForTimeout(1200);
    const selected = await page.locator('.project-card.is-selected .project-card__name').textContent();
    const after = await legendRows(page);
    const notice = await page.locator('.signals-ui .notice[role=alert]').count();
    check(after !== before || notice > 0,
      `${selected}: its client mix is not the previous project's ${before} rows (got ${after}) or the screen says so (${notice} notices) — a failed adoption read keeps the old project's donut and legend silently`);
    await context.close();
  }

  // (b) The primary read fails on the new project. The tiles keep the previous project's
  // numbers under the new project's name, with one notice above them.
  {
    const { context, page } = await open('demo-fresh', 'overview');
    const before = await tileValue(page, 'Tool calls');
    await page.locator('.project-card').nth(2).click();   // Northwind MCP · first week
    await page.waitForTimeout(1200);
    const selected = await page.locator('.project-card.is-selected .project-card__name').textContent();
    const after = await tileValue(page, 'Tool calls');
    const eyebrow = await page.locator('.eyebrow').first().textContent();
    console.log(`     selected=${JSON.stringify(selected)} eyebrow=${JSON.stringify(eyebrow)} tool calls ${before} -> ${after}`);
    check(after !== before,
      `${selected}: the Tool calls tile does not still read the previous project's ${before} while the page says ${JSON.stringify(eyebrow)}`);
    await context.close();
  }

  // (c) The same for a range change, which has no second notice either.
  {
    const { context, page } = await open('demo', 'overview', false);
    const before = await tileValue(page, 'Tool calls');
    await page.evaluate(() => { globalThis.__failRead = true; });
    await page.getByRole('button', { name: '90 days' }).click();
    await page.waitForTimeout(1200);
    const after = await tileValue(page, 'Tool calls');
    const pressed = await page.locator('.range-control button[aria-pressed=true]').textContent();
    console.log(`     range=${JSON.stringify(pressed)} tool calls ${before} -> ${after}`);
    check(after !== before,
      `range ${pressed}: the Tool calls tile does not still read the 7-day answer ${before}`);
    await context.close();
  }
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r1 stale-project probe passed');

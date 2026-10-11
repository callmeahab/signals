import { chromium, expect } from '../../web/node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const base = 'http://10.8.0.11:8300';
const dir = 'reports/e2e-v2';
const timelineOnly = process.argv.includes('--timeline');
const env = Object.fromEntries(readFileSync('/home/vuk/signals-deploy/.env', 'utf8').trim().split('\n').filter(Boolean).map(line => {
  const i = line.indexOf('=');
  return [line.slice(0, i), JSON.parse(line.slice(i + 1))];
}));
const screens = [
  ['overview', 'Overview'],
  ['adoption', 'Adoption'],
  ['tools', 'Tools'],
  ['reliability', 'Reliability'],
  ['sessions', 'Sessions'],
  ['callers', 'Callers'],
  ['cost', 'Cost'],
  ['protocol', 'Protocol'],
  ['settings', 'Settings'],
];
const findings = [];
const check = (ok, message) => {
  console.log(ok ? 'PASS' : 'FAIL', message);
  if (!ok) findings.push(message);
};
const format = n => n == null ? 'No data yet' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(n);
const short = n => n == null ? 'No data yet' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const delta = (n, prev, unit = false) => {
  if (n == null || prev == null || prev === 0) return 'No prior data';
  const raw = unit ? n - prev : (n / prev - 1) * 100;
  return `${n >= prev ? '+' : ''}${raw.toFixed(1)}${unit ? ' pt' : '%'} vs prior`;
};

async function settle(page, heading) {
  await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function show(page, id) {
  await page.evaluate(screen => { location.hash = screen; }, id);
  await page.waitForFunction(screen => location.hash === '#' + screen, id);
}

const browser = await chromium.launch({ channel: 'chromium' });
try {
  for (const theme of timelineOnly ? ['light'] : ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      colorScheme: theme,
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    });
    await context.addInitScript(value => localStorage.setItem('signals-theme', value), theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel('Email', { exact: true }).fill(env.SIGNALS_BOOTSTRAP_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(env.SIGNALS_BOOTSTRAP_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    check(dark === (theme === 'dark'), `${theme} theme class applied (${dark})`);
    const account = await (await page.request.get(base + '/v1/auth/me')).json();
    check(account.projects.map(p => p.slug).sort().join() === 'egg-node,egg-python', `${theme} both projects present`);
    for (const project of account.projects) {
      await page.getByLabel('Select project').selectOption(project.id);
      if (timelineOnly) {
        await show(page, 'sessions');
        await settle(page, 'Sessions');
        const button = page.getByRole('button', { name: /e2e-v2-long/ }).first();
        const visible = await button.isVisible().catch(() => false);
        check(visible, `${project.slug} long session row visible`);
        if (visible) {
          await button.click();
          await page.getByRole('heading', { name: /e2e-v2-long session/ }).waitFor();
          await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
          await page.waitForTimeout(500);
          const timeline = await page.locator('.timeline').innerText();
          check(timeline.includes('search_products'), `${project.slug} timeline lists search_products`);
          check((timeline.match(/tool\.called/g) || []).length >= 5, `${project.slug} timeline has five tool calls`);
          await page.screenshot({ path: `${dir}/${project.slug}-${theme}-sessions-timeline.png`, fullPage: true });
          const sessionId = (await page.locator('.drawer .mono').first().innerText()).trim();
          const timelineApi = await (await page.request.get(`${base}/v1/projects/${project.id}/analytics/sessions/${encodeURIComponent(sessionId)}/timeline?range=7d`)).json();
          writeFileSync(`${dir}/${project.slug}-timeline.json`, JSON.stringify(timelineApi, null, 2));
          const offsets = timelineApi.events.filter(event => event.tool === 'search_products').map(event => event.offset_ms);
          console.log(project.slug, 'timeline offsets', offsets.join(','));
          check(offsets.length >= 5, `${project.slug} timeline API has ${offsets.length} search_products calls`);
        }
        continue;
      }
      const captured = {};
      for (const [id, heading] of screens) {
        await show(page, id);
        await settle(page, heading);
        if (['overview', 'adoption', 'tools', 'reliability', 'cost', 'protocol'].includes(id)) {
          const response = await page.request.get(`${base}/v1/projects/${project.id}/analytics/${id}?range=7d`);
          check(response.status() === 200, `${project.slug} ${theme} ${id} analytics ${response.status()}`);
          captured[id] = await response.json();
        }
        await page.screenshot({ path: `${dir}/${project.slug}-${theme}-${id}.png`, fullPage: true });
      }
      if (theme !== 'light') continue;
      try {
      const overview = captured.overview;
      await show(page, 'overview');
      await settle(page, 'Overview');
      const toolTileNow = await page.locator('.tile', { has: page.locator('.eyebrow', { hasText: /^Tool calls$/ }) }).innerText();
      const expectedCalls = short(overview.tiles.tool_calls.value);
      const expectedDelta = delta(overview.tiles.tool_calls.value, overview.tiles.tool_calls.prev);
      check(toolTileNow.includes(expectedCalls), `${project.slug} tool-calls tile shows ${expectedCalls}`);
      check(toolTileNow.includes(expectedDelta), `${project.slug} tool-calls delta shows ${expectedDelta}`);
      const adoption = captured.adoption;
      await show(page, 'adoption');
      await settle(page, 'Adoption');
      const dau = await page.locator('.tile', { has: page.locator('.eyebrow', { hasText: /^DAU$/ }) }).innerText();
      check(dau.includes(format(adoption.active.dau)), `${project.slug} DAU shows ${format(adoption.active.dau)}`);
      const adoptionText = await page.locator('main').innerText();
      check(adoptionText.includes('e2e-v2'), `${project.slug} adoption client mix shows e2e-v2`);
      check(adoptionText.includes('network'), `${project.slug} adoption shows network identity kind`);
      for (const step of adoption.funnel.steps) {
        check(adoptionText.toLowerCase().includes(step.step.replaceAll('_', ' ')), `${project.slug} funnel shows ${step.step} (${step.count})`);
      }
      const tools = captured.tools;
      await show(page, 'tools');
      await settle(page, 'Tools');
      const advertised = await page.locator('.tile', { has: page.locator('.eyebrow', { hasText: /^Advertised$/ }) }).innerText();
      check(tools.catalog.advertised === 15 && advertised.includes('15'), `${project.slug} catalogue advertised 15`);
      const dead = tools.catalog.dead || [];
      console.log(project.slug, 'dead', JSON.stringify(dead));
      const toolsText = await page.locator('main').innerText();
      check(!toolsText.includes('e2e_v2_unknown_tool'), `${project.slug} unknown call is not a tools row`);
      const names = new Set((tools.tools || []).map(tool => tool.tool));
      for (const name of ['search_products', 'get_product', 'book_ticket', 'place_food_order', 'reserve_tickets']) {
        const row = (tools.tools || []).find(tool => tool.tool === name);
        check(!!row && row.success_rate != null && row.latency && row.latency.p95 != null, `${project.slug} ${name} has success and p95`);
      }
      const sequences = (tools.paths || []).map(path => path.sequence.join(' → '));
      console.log(project.slug, 'paths', sequences.slice(0, 8).join(' | '));
      check(sequences.some(sequence => sequence.includes('search_products') && sequence.includes('get_product')), `${project.slug} paths include the catalogue sequence`);
      const reliability = captured.reliability;
      await show(page, 'reliability');
      await settle(page, 'Reliability');
      const reliabilityText = await page.locator('main').innerText();
      const unknownCount = reliability.hallucinated_tools.count;
      console.log(project.slug, 'unknown_tool', unknownCount, (reliability.hallucinated_tools.names || []).join(','));
      check(reliabilityText.includes('e2e_v2_unknown_tool'), `${project.slug} reliability shows e2e_v2_unknown_tool`);
      check(unknownCount === 1, `${project.slug} unknown_tool count is 1 (observed ${unknownCount})`);
      check(reliability.sessions_with_errors && reliability.sessions_with_errors.count != null, `${project.slug} sessions with errors present`);
      const availability = reliability.availability;
      console.log(project.slug, 'availability', availability ? 'present' : 'absent');
      if (availability) check(reliabilityText.toLowerCase().includes('uptime'), `${project.slug} availability uptime is shown`);
      else check(reliabilityText.includes('No synthetic prober connected'), `${project.slug} availability waiting without a prober`);
      const cost = captured.cost;
      await show(page, 'cost');
      await settle(page, 'Cost');
      check(cost.total_tokens_est > 0, `${project.slug} cost tokens ${cost.total_tokens_est}`);
      check((cost.by_tool || []).some(tool => tool.tokens > 0), `${project.slug} cost has tokens by tool`);
      const protocol = captured.protocol;
      await show(page, 'protocol');
      await settle(page, 'Protocol');
      const protocolText = await page.locator('main').innerText();
      const capabilityRows = (protocol.capabilities.client || []).length + (protocol.capabilities.server || []).length;
      check(capabilityRows > 0 && protocolText.includes('Capability matrix'), `${project.slug} capability matrix populated (${capabilityRows})`);
      for (const key of ['sampling', 'elicitation', 'tasks', 'progress']) {
        const values = Object.values(protocol[key] || {}).filter(value => !Array.isArray(value));
        const waiting = values.every(value => value == null);
        console.log(project.slug, key, waiting ? 'waiting' : JSON.stringify(protocol[key]));
        check(waiting, `${project.slug} protocol ${key} is waiting`);
      }
      check(protocolText.includes('Waiting for SDK events'), `${project.slug} protocol screen says waiting`);
      await show(page, 'callers');
      await settle(page, 'Callers');
      const callersText = await page.locator('main').innerText();
      check(callersText.includes('network') || callersText.includes('Network'), `${project.slug} callers shows an identity kind`);
      await show(page, 'sessions');
      await settle(page, 'Sessions');
      const longVisible = await page.getByRole('button', { name: /e2e-v2-long/ }).first().isVisible().catch(() => false);
      console.log(project.slug, 'long session visible during first pass', longVisible);
      writeFileSync(`${dir}/${project.slug}-analytics.json`, JSON.stringify(captured, null, 2));
      const original = String(project.slo_targets?.read ?? '');
      await show(page, 'settings');
      await settle(page, 'Settings');
      const target = page.getByLabel('read SLO target (%)');
      await expect(target).toBeVisible();
      const before = await target.inputValue();
      const next = before === '99.4' ? '99.3' : '99.4';
      await target.fill(next);
      await page.getByRole('button', { name: 'Save analytics settings' }).click();
      await page.getByRole('status').filter({ hasText: 'Analytics settings saved.' }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
      await page.getByLabel('Select project').selectOption(project.id);
      await show(page, 'settings');
      await settle(page, 'Settings');
      const after = await page.getByLabel('read SLO target (%)').inputValue();
      check(after === next, `${project.slug} settings round-trip kept read target ${next} (saw ${after}, started ${before}, project ${original})`);
      await page.screenshot({ path: `${dir}/${project.slug}-light-settings-reloaded.png`, fullPage: true });
      await page.getByLabel('read SLO target (%)').fill(before);
      await page.getByRole('button', { name: 'Save analytics settings' }).click();
      await page.getByRole('status').filter({ hasText: 'Analytics settings saved.' }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
      await page.getByLabel('Select project').selectOption(project.id);
      await show(page, 'settings');
      await settle(page, 'Settings');
      const restored = await page.getByLabel('read SLO target (%)').inputValue();
      check(restored === before, `${project.slug} settings restored to ${before} (saw ${restored})`);
      await page.screenshot({ path: `${dir}/${project.slug}-light-settings-restored.png`, fullPage: true });
      } catch (error) {
        findings.push(`${project.slug} ${theme} checks threw ${error instanceof Error ? error.message : error}`);
        console.log('FAIL', project.slug, error);
        await page.screenshot({ path: `${dir}/${project.slug}-${theme}-error.png`, fullPage: true }).catch(() => {});
      }
    }
    check(errors.length === 0, `${theme} page errors: ${errors.join(' | ') || 'none'}`);
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${dir}/browser-findings.json`, JSON.stringify(findings, null, 2));
if (findings.length) {
  console.log('FINDINGS', findings.length);
  process.exitCode = 1;
} else {
  console.log('PASS browser checks');
}

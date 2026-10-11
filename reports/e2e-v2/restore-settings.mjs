import { chromium, expect } from '../../web/node_modules/@playwright/test/index.mjs';
import { readFileSync } from 'node:fs';

const base = 'http://10.8.0.11:8300';
const env = Object.fromEntries(readFileSync('/home/vuk/signals-deploy/.env', 'utf8').trim().split('\n').filter(Boolean).map(line => {
  const i = line.indexOf('=');
  return [line.slice(0, i), JSON.parse(line.slice(i + 1))];
}));
const browser = await chromium.launch({ channel: 'chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: 'light', timezoneId: 'UTC' });
await context.addInitScript(() => localStorage.setItem('signals-theme', 'light'));
const page = await context.newPage();
await page.goto(base);
await page.getByLabel('Email', { exact: true }).fill(env.SIGNALS_BOOTSTRAP_EMAIL);
await page.getByLabel('Password', { exact: true }).fill(env.SIGNALS_BOOTSTRAP_PASSWORD);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
const account = await (await page.request.get(base + '/v1/auth/me')).json();
for (const project of account.projects) {
  await page.getByLabel('Select project').selectOption(project.id);
  await page.evaluate(() => { location.hash = 'settings'; });
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  const target = page.getByLabel('read SLO target (%)');
  await expect(target).toBeVisible();
  const seen = await target.inputValue();
  console.log(project.slug, 'before-restore', seen);
  if (seen !== '99.5') {
    await target.fill('99.5');
    await page.getByRole('button', { name: 'Save analytics settings' }).click();
    await page.getByRole('status').filter({ hasText: 'Analytics settings saved.' }).waitFor();
  }
  await page.goto(base + '/#settings');
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  await page.getByLabel('Select project').selectOption(project.id);
  await expect(page.getByText('Loading…', { exact: true })).toHaveCount(0);
  const after = await page.getByLabel('read SLO target (%)').inputValue();
  console.log(project.slug, 'after-reload', after);
  if (after !== '99.5') process.exitCode = 1;
  await page.screenshot({ path: `reports/e2e-v2/${project.slug}-light-settings-restored.png`, fullPage: true });
}
await browser.close();

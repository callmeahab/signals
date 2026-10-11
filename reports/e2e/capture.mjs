// Capture Live, Tools, Sessions, the Live "All errors" view, and Setup snippets.
// Usage: node reports/e2e/capture.mjs /absolute/path/to/playwright/index.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const env = Object.fromEntries(fs.readFileSync('/home/vuk/signals-deploy/.env', 'utf8')
  .trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), JSON.parse(line.slice(line.indexOf('=') + 1))]));
const outDir = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => console.log('pageerror', error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('console', msg.text().slice(0, 400)); });
  await page.goto('http://10.8.0.11:8300');
  await page.getByLabel('Email').fill(env.SIGNALS_BOOTSTRAP_EMAIL);
  await page.getByLabel('Password').fill(env.SIGNALS_BOOTSTRAP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Select project').waitFor();
  console.log('signed-in');

  for (const name of ['egg-node', 'egg-python']) {
    await page.getByLabel('Select project').selectOption({ label: name });
    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await page.getByLabel('Event type').selectOption('');
    await page.locator('details.event-row').first().waitFor();
    await page.screenshot({ path: `${outDir}${name}-live.png`, fullPage: true });
    console.log(name, 'live', await page.locator('details.event-row').count());

    await page.getByRole('link', { name: 'Tools', exact: true }).click();
    await page.getByText('search_products', { exact: true }).first().waitFor();
    await page.screenshot({ path: `${outDir}${name}-tools.png`, fullPage: true });
    console.log(name, 'tools', await page.locator('tbody tr').count());

    await page.getByRole('link', { name: 'Sessions', exact: true }).click();
    await page.getByText('The story of a connection').waitFor();
    await page.locator('tbody tr').first().waitFor();
    const sessionText = await page.locator('tbody').innerText();
    await page.screenshot({ path: `${outDir}${name}-sessions.png`, fullPage: true });
    console.log(name, 'sessions', await page.locator('tbody tr').count(), 'shows-e2e-rtxbox', sessionText.includes('e2e-rtxbox'), 'shows-Unknown', sessionText.includes('Unknown'));

    await page.getByRole('link', { name: 'Live', exact: true }).click();
    await page.getByLabel('Event type').selectOption('errors');
    await page.locator('details.event-row').first().waitFor({ timeout: 15000 });
    const selected = await page.getByLabel('Event type').inputValue();
    await page.screenshot({ path: `${outDir}${name}-errors.png`, fullPage: true });
    console.log(name, 'errors', await page.locator('details.event-row').count(), 'filter', selected);
  }

  const setupLink = page.getByRole('link', { name: 'Setup', exact: true });
  console.log('setup-links', await setupLink.count(), 'hrefs', await setupLink.evaluateAll(els => els.map(el => el.getAttribute('href'))));
  const secure = await page.evaluate(() => ({
    isSecureContext,
    randomUUID: typeof crypto.randomUUID,
    getRandomValues: typeof crypto.getRandomValues,
  }));
  console.log('crypto', JSON.stringify(secure));
  await setupLink.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}setup-crash.png`, fullPage: true });
  const body = await page.locator('body').innerText({ timeout: 5000 });
  console.log('setup-url', page.url());
  console.log('setup-body-empty', body.trim().length === 0);
  console.log('setup-has-python-snippet', body.includes('mcpramen_signals'));
  console.log('setup-has-node-snippet', body.includes('@mcpramen/signals'));
  console.log('setup-has-curl-snippet', body.includes('Authorization: Bearer'));
} finally {
  await browser.close();
}

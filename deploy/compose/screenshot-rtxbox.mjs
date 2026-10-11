// Usage: node deploy/compose/screenshot-rtxbox.mjs /absolute/path/to/playwright/index.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const env = Object.fromEntries(fs.readFileSync('/home/vuk/signals-deploy/.env', 'utf8')
  .trim().split('\n').map(line => [line.slice(0, line.indexOf('=')), JSON.parse(line.slice(line.indexOf('=') + 1))]));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://10.8.0.11:8300');
  await page.getByLabel('Email').fill(env.SIGNALS_BOOTSTRAP_EMAIL);
  await page.getByLabel('Password').fill(env.SIGNALS_BOOTSTRAP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Select project').waitFor();
  await page.getByRole('link', { name: 'Live', exact: true }).click();
  for (const name of ['egg-node', 'egg-python']) {
    await page.getByLabel('Select project').selectOption({ label: name });
    await page.getByLabel('Event type').selectOption('tool.called');
    await page.getByText('search_products', { exact: true }).first().waitFor();
    await page.locator('details.event-row').first().locator('summary').click();
    await page.screenshot({ path: `reports/deploy-rtxbox-${name}.png`, fullPage: true });
    console.log(name, 'dashboard tool.called search_products visible; screenshot saved');
  }
} finally {
  await browser.close();
}

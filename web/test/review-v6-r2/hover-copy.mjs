// Review round 2 (reviews/dash-v6-r2.md), S2 re-check: the twelve explanations that had
// advice under "How it's computed" now have the derivation there, but several of them
// were fixed by swapping the two sentences, which leaves the body — the first line a
// reader sees, under the card's own title — as a sentence whose subject is a pronoun with
// nothing to refer to.
//
// `packages/ui/src/copy/explanations.ts` states the contract in its header: "Each entry is
// two or three short sentences for a manager: what the number is, how it is computed
// (window, identity precedence, SLO class, estimate against exact), and what a bad value
// means or what to do about it." This probe reads the rendered hover cards.
//
//   BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
//     bun test/review-v6-r2/hover-copy.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:23336';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };

// A body that opens with a bare pronoun or demonstrative has no antecedent: the card's
// title is a noun phrase, not a sentence, so "It" and "These" point at nothing.
const DANGLING = /^(It|They|These|Those|This|Blank|Long-lived|Each tool here)\b/;

const cards = [
  ['#sessions', 'Cancelled'], ['#sessions', 'With errors'], ['#sessions', 'stdio'], ['#sessions', 'Open on this page'],
  ['#reliability', 'Sessions with errors'], ['#reliability', 'Authentication failures'],
  ['#cost', 'Per call'], ['#protocol', 'Elicitation'], ['#live', 'Your server, in the moment'],
];

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'UTC' });
  const page = await context.newPage();
  const seen = [];
  for (const [screen, label] of cards) {
    await page.goto(`${base}/${screen}`);
    await page.locator('.signals-ui .tile, .signals-ui .card, .signals-ui .panel').first().waitFor();
    await page.waitForTimeout(700);
    const host = page.locator('.signals-ui .tile, .signals-ui .card, .signals-ui .panel')
      .filter({ has: page.getByText(label, { exact: true }) }).first();
    const button = host.locator('.info-button').first();
    if (!(await button.count())) { check(false, `${screen} ${label}: no info button found`); continue; }
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const pop = page.locator('.info-pop');
    await pop.waitFor();
    const copy = await pop.evaluate(el => ({
      title: el.querySelector('.info-pop__title')?.textContent?.trim(),
      body: el.querySelector(':scope > p')?.textContent?.trim(),
      computed: el.querySelector('.info-pop__computed p')?.textContent?.trim(),
    }));
    seen.push({ screen, label, ...copy });
    await page.keyboard.press('Escape');
  }
  for (const entry of seen) {
    console.log(`     ${entry.screen} ${JSON.stringify(entry.title)}\n       body     : ${JSON.stringify(entry.body)}\n       computed : ${JSON.stringify(entry.computed)}`);
  }
  const dangling = seen.filter(entry => DANGLING.test(entry.body ?? ''));
  check(dangling.length === 0,
    `every hover card's first line says what the number is; ${dangling.length} open with a pronoun that has no antecedent: ${JSON.stringify(dangling.map(e => `${e.title}: ${e.body}`), null, 1)}`);
  const restates = seen.filter(entry => entry.body && entry.body.split(/[.!?]/).filter(Boolean).length === 1 && entry.body.length < 30);
  check(restates.length === 0,
    `no hover card's body is a bare label instead of a sentence: ${JSON.stringify(restates.map(e => `${e.title}: ${e.body}`))}`);
  await context.close();
} finally { await browser.close(); }

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r2 hover-copy probe passed');

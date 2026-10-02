import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

// Use the real standalone login with only its initial account request mocked.
// No deployment credentials or database writes are needed for these checks.
export async function checkLoginStyles(browser, base) {
  mkdirSync('artifacts', { recursive: true });
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
      try {
        const page = await context.newPage();
        await page.route('**/v1/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Sign in required"}' }));
        await page.goto(base);
        await page.getByRole('heading', { name: 'Follow the signal.' }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const styles = await page.evaluate(() => {
          const card = document.querySelector('.login-card');
          const button = card.querySelector('button');
          const email = card.querySelector('input[type=email]');
          const password = card.querySelector('input[type=password]');
          return {
            bodyFont: getComputedStyle(document.body).fontFamily,
            headingFont: getComputedStyle(card.querySelector('h1')).fontFamily,
            loadedFonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family),
            primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
            dark: document.documentElement.classList.contains('dark'),
            margin: getComputedStyle(document.body).margin,
            cardBorder: getComputedStyle(card).borderTopWidth,
            cardWidth: card.getBoundingClientRect().width,
            buttonDisplay: getComputedStyle(button).display,
            stacked: password.getBoundingClientRect().top > email.getBoundingClientRect().bottom,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        const label = `${width}/${theme}`;
        assert.match(styles.bodyFont, /Manrope/, `${label}: body font`);
        assert.match(styles.headingFont, /Unbounded/, `${label}: heading font`);
        assert(styles.loadedFonts.some(f => /Manrope/.test(f)) && styles.loadedFonts.some(f => /Unbounded/.test(f)), `${label}: fonts loaded`);
        assert(styles.primary && styles.margin === '0px' && styles.cardBorder !== '0px', `${label}: document theme and card styles`);
        assert.equal(styles.dark, theme === 'dark', `${label}: theme applied`);
        assert.equal(styles.buttonDisplay, 'inline-flex', `${label}: styled sign-in button`);
        assert(styles.stacked && styles.cardWidth <= 440 && !styles.overflow, `${label}: form layout fits viewport`);
        await page.screenshot({ path: `artifacts/login-${width}-${theme}.png`, fullPage: true });
      } finally {
        await context.close();
      }
    }
  }
  console.log('Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.');
}

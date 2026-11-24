/**
 * Browser check for the calm homepage (issue #206). Drives a running site (`next start`) in
 * Chromium, in both colour schemes:
 *
 *   1. it renders: one h1, the six chapters in order, each named by its h2, no console errors;
 *   2. the first 1440×900 viewport is the overview only: the next chapter starts below the fold;
 *   3. nothing scrolls sideways at 390 px;
 *   4. the section nav marks the chapter being read, and its links point at real sections;
 *   5. every link in <main> that stays on the site answers 2xx/3xx.
 *
 * Run: node web/scripts/home-check.mjs [base-url] (default http://localhost:3000; needs
 * Playwright's Chromium). Exits 1 on a failed check.
 */
import { createRequire } from 'node:module';

// Playwright is not a dependency of the site: resolve the machine's (as background-return-check).
const { chromium } = createRequire(import.meta.url)('playwright');

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const CHAPTERS = ['overview', 'now', 'engines', 'watch', 'how', 'news'];
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch();
try {
  for (const colorScheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    check(res?.ok() ?? false, `${colorScheme}: / answers ${res?.status()}`);

    const ids = await page.$$eval('main > section', (els) => els.map((e) => e.id));
    check(ids.join() === CHAPTERS.join(), `${colorScheme}: chapters in order (${ids.join(', ')})`);
    check((await page.locator('h1').count()) === 1, `${colorScheme}: exactly one h1`);
    const named = await page.$$eval('main > section', (els) =>
      els.every((s) => {
        const h = document.getElementById(s.getAttribute('aria-labelledby') ?? '');
        return h !== null && s.contains(h);
      }),
    );
    check(named, `${colorScheme}: every chapter is named by its own heading`);

    const nextTop = await page.$eval('#now', (e) => e.getBoundingClientRect().top);
    check(
      nextTop >= 900,
      `${colorScheme}: first viewport holds the overview only (#now at ${Math.round(nextTop)}px)`,
    );

    await page.$eval('#engines', (e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    const current = await page.$eval('[data-slot="section-nav"] [aria-current]', (a) =>
      a.getAttribute('href'),
    );
    check(
      current === '#engines',
      `${colorScheme}: section nav marks the chapter in view (${current})`,
    );
    const targets = await page.$$eval('[data-slot="section-nav"] a', (as) =>
      as.every((a) => document.querySelector(a.getAttribute('href') ?? '') !== null),
    );
    check(targets, `${colorScheme}: every section-nav link has a target`);
    check(errors.length === 0, `${colorScheme}: no page errors ${errors.join(' | ')}`);

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme });
    await phone.goto(`${base}/`, { waitUntil: 'networkidle' });
    const overflow = await phone.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(overflow <= 0, `${colorScheme}: no sideways scroll at 390 px (${overflow}px)`);
    await phone.close();

    if (colorScheme === 'light') {
      const hrefs = await page.$$eval('main a[href]', (as) => [
        ...new Set(
          as
            .map((a) => a.getAttribute('href') ?? '')
            .filter((h) => h.startsWith('/') && !h.startsWith('//')),
        ),
      ]);
      for (const href of hrefs) {
        const r = await page.request.get(`${base}${href}`, { maxRedirects: 0 });
        check(r.status() < 400, `link ${href} answers ${r.status()}`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll homepage checks passed.');

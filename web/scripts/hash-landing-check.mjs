/**
 * Browser check for a live board's link (#262): `/matches/<id>#games` must open with the games
 * section in view. The match page streams its content inside `<Suspense>`, so neither the browser
 * (a direct load) nor Next's router (a `<Link>` click) finds `#games` when it scrolls;
 * `HashLanding` scrolls once the section mounts. Drives a running site (`next start`) in Chromium:
 *
 *   1. direct load of `/matches/<id>#games`;
 *   2. client navigation from `/fleet`: a live board's link when one is on the page, otherwise
 *      the app router's `push` (what a `<Link>` click does);
 *   3. the direct load again with reduced motion (the jump is instant, not smooth);
 *   4. control: `/matches/<id>` without the hash stays at the top.
 *
 * "In view" means the section's top sits under the sticky header and section nav, between 0 and
 * NAV_MAX px from the top of the viewport. The match id is the first `/matches/<id>` link on the
 * engine pages, so the check needs live data; without any it says so and exits 0.
 *
 * Run: node web/scripts/hash-landing-check.mjs [base-url] (default http://localhost:3000; needs
 * Playwright's Chromium, which resolves wherever it is installed). Exits 1 on a failed check.
 */
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const NAV_MAX = 200;
const SETTLE_MS = 8_000;

const browser = await chromium.launch();
let failed = false;
const report = (ok, name, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed = true;
};

const inView = ({ top }) => top >= 0 && top <= NAV_MAX;
const where = (page) =>
  page.evaluate(() => ({
    top: Math.round(document.getElementById('games').getBoundingClientRect().top),
    scrollY: Math.round(window.scrollY),
    path: location.pathname + location.hash,
  }));

/**
 * Waits for `#games`, then up to SETTLE_MS (hydration, then the glide) for it to land in view and
 * the page to stop scrolling; returns where it sits then, landed or not. With `expectLanding`
 * false it waits the whole SETTLE_MS, so a late scroll would still show.
 */
const settle = async (page, expectLanding = true) => {
  await page.waitForSelector('#games', { timeout: 30_000 });
  const until = Date.now() + SETTLE_MS;
  let last = await where(page);
  while (Date.now() < until) {
    await page.waitForTimeout(300);
    const now = await where(page);
    if (expectLanding && now.scrollY === last.scrollY && inView(now)) return now;
    last = now;
  }
  return last;
};
const show = (r) => `#games top ${r.top}px, scrollY ${r.scrollY} (${r.path})`;

const find = await browser.newPage();
let match;
for (const from of ['/engines/hex', '/engines/chess', '/engines/go9', '/engines/othello']) {
  await find.goto(base + from, { waitUntil: 'networkidle' });
  match = await find
    .$$eval('a[href^="/matches/"]', (a) => a[0]?.getAttribute('href').split('#')[0])
    .catch(() => undefined);
  if (match) break;
}
await find.close();
if (!match) {
  console.log('no /matches/<id> link on the engine pages: nothing to check (no live data?)');
  await browser.close();
  process.exit(0);
}

// 1 · Direct load.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}${match}#games`);
  const r = await settle(page);
  report(inView(r), 'direct load', show(r));
  await page.close();
}

// 2 · Client navigation from /fleet.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/fleet`, { waitUntil: 'networkidle' });
  const live = page.locator('a[data-slot="engine-board"][href^="/matches/"]').first();
  let how;
  if (await live.count()) {
    how = 'a live board on /fleet';
    await live.click();
  } else {
    how = 'router.push from /fleet (no live board right now)';
    await page.evaluate((href) => window.next.router.push(href), `${match}#games`);
  }
  await page.waitForURL(/\/matches\/[^/]+#games$/);
  const r = await settle(page);
  report(inView(r), `client navigation, ${how}`, show(r));
  await page.close();
}

// 3 · Direct load with reduced motion.
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  await page.goto(`${base}${match}#games`);
  const r = await settle(page);
  report(inView(r), 'direct load, reduced motion', show(r));
  await page.close();
}

// 4 · Control: no hash, no scroll.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(base + match);
  const r = await settle(page, false);
  report(r.scrollY === 0, 'no hash stays at the top', show(r));
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);

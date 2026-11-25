/**
 * Horizontal-overflow sweep (issue #249). Drives a running site (`next start`) in Chromium with
 * real phone emulation (Playwright `devices[...]`, which honours the viewport meta), in both
 * colour schemes, over every page route:
 *
 *   - every route without a dynamic segment, plus the four `/engines/<id>` pages;
 *   - one sample of each detail route type (`/games/<id>`, `/tasks/<id>`, `/fleet/<seat>`, …),
 *     found by following the first matching link on the list pages, so it needs live data to
 *     cover them and simply reports them as not found on a site without any;
 *   - interactive states: on each page, every closed `<details>` is opened and every
 *     `aria-expanded="false"` control (menus, disclosures) is clicked before measuring again.
 *
 * A page fails when `document.documentElement.scrollWidth > innerWidth`, or when an element's
 * box ends past the viewport and no ancestor below <body> clips it (an `overflow-x` scroll
 * container is how wide content is meant to live on a phone). `overflow-x: hidden` on html or
 * body does not count as clipping: it would mask the bug, not fix it.
 *
 *   node web/scripts/overflow-check.mjs [base-url] [--devices "iPhone SE,iPhone 13"]
 *                                      [--only /,/engines/chess] [--no-details]
 *
 * Default devices: iPhone SE (320 px) and iPhone 13 (390 px); `--devices all` adds 360, 375 and
 * 430 px. Exits 1 on any overflow. Playwright is not a dependency of the site: it resolves the
 * machine's (as background-return-check).
 */
import { createRequire } from 'node:module';

import { pageRoutes } from './impeccable-routes.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const base = (positional[0] ?? 'http://localhost:3000').replace(/\/$/, '');

const DEFAULT_DEVICES = ['iPhone SE', 'iPhone 13'];
const ALL_DEVICES = ['iPhone SE', 'Galaxy S8', 'iPhone X', 'iPhone 13', 'iPhone 14 Pro Max'];
const deviceArg = flag('--devices');
const deviceNames =
  deviceArg === 'all'
    ? ALL_DEVICES
    : deviceArg
      ? deviceArg.split(',').map((d) => d.trim())
      : DEFAULT_DEVICES;
const only = flag('--only')?.split(',');
const withDetails = !args.includes('--no-details');

/**
 * Detail route types and where a sample id is found: the first link on `from` whose path matches
 * `pattern`. Order matters only for reading the report.
 */
export const DETAIL_ROUTES = [
  { type: '/games/[id]', from: ['/games'], pattern: /^\/games\/[^/]+$/ },
  { type: '/matches/[id]', from: ['/games', '/engines/chess'], pattern: /^\/matches\/[^/]+$/ },
  {
    type: '/tasks/[id]',
    from: ['/engines/chess', '/engines/go9', '/'],
    pattern: /^\/tasks\/[^/]+$/,
  },
  { type: '/graveyard/[id]', from: ['/graveyard'], pattern: /^\/graveyard\/[^/]+$/ },
  { type: '/fleet/[id]', from: ['/fleet'], pattern: /^\/fleet\/[^/]+$/ },
  { type: '/board/[id]', from: ['/board'], pattern: /^\/board\/[^/]+$/ },
  { type: '/messages/[id]', from: ['/messages'], pattern: /^\/messages\/[^/]+$/ },
  { type: '/news/[slug]', from: ['/news'], pattern: /^\/news\/[^/]+$/ },
  { type: '/concepts/[slug]', from: ['/concepts'], pattern: /^\/concepts\/[^/]+$/ },
  { type: '/skills/[name]', from: ['/skills'], pattern: /^\/skills\/[^/]+$/ },
  {
    type: '/versions/[engine]/[version]',
    from: ['/versions'],
    pattern: /^\/versions\/[^/]+\/[^/]+$/,
  },
  {
    type: '/engines/[id]/ladder/[rung]',
    from: ['/engines/chess'],
    pattern: /^\/engines\/[^/]+\/ladder\/[^/]+$/,
  },
  { type: '/engines/[id]/play', from: ['/engines/chess'], pattern: /^\/engines\/[^/]+\/play$/ },
];

/**
 * Runs in the page: what sticks out past the device's width, and the document's own scroll width.
 * The device width, not `innerWidth`, is the yardstick: with the viewport meta honoured, content
 * wider than the phone enlarges the layout viewport itself (`innerWidth` 358 on a 320 px phone),
 * so `scrollWidth <= innerWidth` holds even while the page is zoomed out and pans sideways.
 */
const measure = (deviceWidth) => {
  const vw = deviceWidth;
  const doc = document.documentElement;
  const clipped = (el) => {
    for (let a = el.parentElement; a && a !== document.body && a !== doc; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible') {
        const r = a.getBoundingClientRect();
        if (r.right <= vw + 0.5 && r.left >= -0.5) return true;
      }
    }
    return false;
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}`
        : '';
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
  };
  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const s = getComputedStyle(el);
    if (s.position === 'fixed' && s.visibility === 'hidden') continue;
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    // A fixed layer sizes to the layout viewport, so it is wide because the page is, not why.
    if (s.position === 'fixed') continue;
    // Off-screen on purpose (skip links, visually-hidden labels).
    if (r.right <= 0 || r.left >= vw) continue;
    if (clipped(el)) continue;
    // Report the outermost offender only: its children stick out because it does.
    if (offenders.some((o) => o.el.contains(el))) continue;
    offenders.push({ el, right: Math.round(r.right), left: Math.round(r.left) });
  }
  const masked = ['html', 'body'].filter((t) => {
    const s = getComputedStyle(t === 'html' ? doc : document.body);
    return s.overflowX === 'hidden' || s.overflowX === 'clip';
  });
  return {
    vw,
    innerWidth: window.innerWidth,
    scrollWidth: doc.scrollWidth,
    masked,
    offenders: offenders.slice(0, 6).map((o) => `${describe(o.el)} [${o.left}..${o.right}]`),
  };
};

/** Opens every closed disclosure and every collapsed control, one at a time, measuring each. */
const interactiveStates = async (page, width) => {
  const results = [];
  const details = await page.locator('details:not([open])').count();
  if (details) {
    await page.$$eval('details:not([open])', (els) => els.forEach((d) => (d.open = true)));
    await page.waitForTimeout(150);
    results.push({ state: `${details} <details> open`, ...(await page.evaluate(measure, width)) });
  }
  const toggles = page.locator('[aria-expanded="false"]:visible');
  const n = Math.min(await toggles.count(), 8);
  for (let i = 0; i < n; i++) {
    const t = toggles.nth(i);
    const label = ((await t.getAttribute('aria-label')) ?? (await t.textContent()) ?? '')
      .trim()
      .slice(0, 30);
    try {
      await t.click({ timeout: 2000 });
      await page.waitForTimeout(200);
      results.push({ state: `expanded "${label}"`, ...(await page.evaluate(measure, width)) });
      await page.keyboard.press('Escape');
      if ((await t.getAttribute('aria-expanded')) === 'true')
        await t.click({ timeout: 2000 }).catch(() => {});
    } catch {
      // A control that hides itself or navigates is not a state to measure here.
    }
  }
  return results;
};

const failures = [];
const report = (where, m, resting = true) => {
  const over = Math.max(m.scrollWidth, m.innerWidth) > m.vw;
  const bad = over || m.offenders.length > 0;
  if (bad) {
    failures.push(where);
    console.log(
      `FAIL ${where}: scrollWidth ${m.scrollWidth}, layout ${m.innerWidth} on a ${m.vw} px screen`,
    );
    for (const o of m.offenders) console.log(`       ${o}`);
  }
  // A modal menu locks scrolling with body overflow: hidden while open; only the resting page counts.
  if (resting && m.masked.length) {
    failures.push(`${where}: overflow-x hidden on ${m.masked.join(', ')}`);
    console.log(`FAIL ${where}: overflow-x hidden/clip on ${m.masked.join(', ')} masks overflow`);
  }
  return bad;
};

// Behind an HTTPS proxy (cloud sessions) Chromium needs it named; locally it is unset.
const proxy =
  process.env.HTTPS_PROXY && !/localhost|127\.0\.0\.1/.test(base)
    ? { server: process.env.HTTPS_PROXY }
    : undefined;
const browser = await chromium.launch({ proxy });
try {
  // Discover one sample of each detail route from the list pages (once, at desktop width).
  const discovered = [];
  if (withDetails && !only) {
    const page = await browser.newPage();
    const linksCache = new Map();
    const links = async (path) => {
      if (!linksCache.has(path)) {
        try {
          await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });
          linksCache.set(
            path,
            await page.$$eval('a[href]', (as) =>
              as
                .map((a) => new URL(a.href, location.href))
                .filter((u) => u.origin === location.origin)
                .map((u) => u.pathname),
            ),
          );
        } catch {
          linksCache.set(path, []);
        }
      }
      return linksCache.get(path);
    };
    for (const d of DETAIL_ROUTES) {
      let found;
      for (const from of d.from) {
        found = (await links(from)).find((p) => d.pattern.test(p));
        if (found) break;
      }
      if (found) discovered.push(found);
      else console.log(`skip ${d.type}: no sample link found (no data?)`);
    }
    await page.close();
  }
  const routes = only ?? [...pageRoutes(), ...discovered];

  for (const name of deviceNames) {
    const device = devices[name];
    if (!device) throw new Error(`unknown device ${name}`);
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ ...device, colorScheme });
      const page = await context.newPage();
      for (const route of routes) {
        const where = `${route} @ ${name} ${device.viewport.width}px ${colorScheme}`;
        try {
          const res = await page.goto(`${base}${route}`, {
            waitUntil: 'networkidle',
            timeout: 45_000,
          });
          if (!res || res.status() >= 400) {
            console.log(`skip ${where}: HTTP ${res?.status()}`);
            continue;
          }
        } catch (e) {
          // A page that keeps polling never reaches networkidle; measure what has loaded.
          await page.waitForTimeout(1500);
          if (!page.url().startsWith(base)) {
            console.log(`skip ${where}: ${e.message.split('\n')[0]}`);
            continue;
          }
        }
        const bad = report(where, await page.evaluate(measure, device.viewport.width));
        if (!bad) {
          for (const s of await interactiveStates(page, device.viewport.width)) {
            const { state, ...m } = s;
            report(`${where} (${state})`, m, false);
          }
        }
        if (!bad && colorScheme === 'light' && name === deviceNames[0])
          console.log(`ok   ${route}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} overflow(s)` : '\nno horizontal overflow');
process.exit(failures.length ? 1 : 0);

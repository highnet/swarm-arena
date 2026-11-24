/**
 * Browser check for a calm fleet graph on the real site (issue #202). Point it at a production
 * build (`npm run build && npm start` in web/) or the deployed site:
 *   node web/scripts/fleet-calm-check.mjs [url]   (default http://localhost:3000/fleet)
 * It records every node's position each frame while it drives the page: every ordered pair of
 * presets, a container resize and back, hover, a hidden tab coming back (the catch-up), the 24 h
 * replay, and a minute of live Realtime (with the 20 s prune clock). For each scenario, the nodes
 * it leaves alone (present and whole throughout, and placed by the same data before and after)
 * must move less than MAX_RATE px in any second and swing less than MAX_SWING px. A resize
 * stretches the layout with the canvas in one step; it is measured from just after the stretch.
 * Needs Playwright's Chromium. Exits 1 on a failed check.
 */
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const MAX_RATE = 10; // px per second
const MAX_SWING = 15; // px
const url = process.argv[2] ?? 'http://localhost:3000/fleet';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForSelector('g.sg-node', { timeout: 30_000 });
await page.waitForTimeout(9000); // the intro, and the layout settling after it

await page.evaluate(() => {
  window.__calm = [];
  const step = () => {
    const pos = {};
    // Where each node is linked to (its assignment, its sector): part of what places it.
    const ties = {};
    for (const l of document.querySelectorAll('path')) {
      const d = l.__data__;
      if (!d?.source?.id || !d.target?.id || d.kind === 'contribution') continue;
      (ties[d.source.id] ??= []).push(`${d.kind}>${d.target.id}`);
    }
    for (const g of document.querySelectorAll('g.sg-node')) {
      const d = g.__data__;
      const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(g.getAttribute('transform') ?? '');
      if (!d || !m) continue;
      // What places the node: when this changes, the node may move.
      const key = [d.sectorId, d.phase, d.workItem?.stage, ...(ties[d.id] ?? []).sort()].join('|');
      pos[d.id] = [
        Number(m[1]),
        Number(m[2]),
        g.style.opacity === '' ? 1 : Number(g.style.opacity),
        key,
      ];
    }
    window.__calm.push({ t: performance.now(), pos });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
const clock = () => page.evaluate(() => performance.now());
const marks = [];
const scenario = async (name, act, { hold = 6000, skipMs = 0 } = {}) => {
  const start = await clock();
  await act();
  await page.waitForTimeout(hold);
  marks.push({ name, start: start + skipMs, end: await clock() });
};

const presets = await page.$$eval('[aria-label="Events shown"] button', (bs) =>
  bs.map((b) => b.textContent ?? ''),
);
const choose = (label) =>
  page.click(`[aria-label="Events shown"] button:text-is(${JSON.stringify(label)})`);
const pressed = await page.$eval(
  '[aria-label="Events shown"] button[aria-pressed="true"]',
  (b) => b.textContent ?? '',
);
let current = pressed;
await scenario('idle', async () => {});
for (const from of presets)
  for (const to of presets) {
    if (from === to) continue;
    if (current !== from) {
      await choose(from);
      await page.waitForTimeout(6000);
    }
    await scenario(`preset ${from} → ${to}`, () => choose(to));
    current = to;
  }
await scenario('resize narrower', () => page.setViewportSize({ width: 1100, height: 900 }), {
  skipMs: 600,
});
await scenario('resize back', () => page.setViewportSize({ width: 1280, height: 900 }), {
  skipMs: 600,
});
await scenario('hover', async () => {
  const box = await page.$eval('svg', (s) => {
    const r = s.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  for (let i = 0; i < 20; i++)
    await page.mouse.move(box.x + box.w * (0.2 + 0.03 * i), box.y + box.h * (0.3 + 0.02 * i), {
      steps: 4,
    });
});
await scenario(
  'hidden tab, then back (catch-up)',
  async () => {
    const set = (hidden) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'visibilityState', {
          value: h ? 'hidden' : 'visible',
          configurable: true,
        });
        Object.defineProperty(document, 'hidden', { value: h, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    await set(true);
    await page.waitForTimeout(30_000);
    await set(false);
  },
  { hold: 10_000 },
);
const replay = page.locator('button[title^="Play back the last 24"]');
if (await replay.count())
  await scenario('the 24 h replay', async () => {
    await replay.first().click();
    await page.waitForTimeout(8000);
    await page.keyboard.press('Escape');
  });
await scenario('a minute of live Realtime and prune ticks', async () => {}, { hold: 60_000 });

const frames = await page.evaluate(() => window.__calm);
await browser.close();

let ok = errors.length === 0;
for (const m of marks) {
  const w = frames.filter((f) => f.t >= m.start && f.t <= m.end);
  const a = w[0].pos;
  const ids = Object.keys(a).filter(
    (id) =>
      !id.startsWith('hub') && w.every((f) => f.pos[id]?.[2] >= 0.999 && f.pos[id][3] === a[id][3]),
  );
  let rate = 0;
  let swing = 0;
  let who = '';
  for (const id of ids) {
    let j = 0;
    for (let i = 0; i < w.length; i++) {
      const p = w[i].pos[id];
      const s = Math.hypot(p[0] - a[id][0], p[1] - a[id][1]);
      if (s > swing) [swing, who] = [s, id];
      while (w[i].t - w[j].t > 1000) j++;
      const q = w[j].pos[id];
      rate = Math.max(rate, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
  }
  const pass = rate < MAX_RATE && swing < MAX_SWING;
  ok &&= pass;
  console.log(
    `${pass ? 'ok  ' : 'FAIL'} ${m.name}: ${ids.length} unchanged nodes, peak ${rate.toFixed(1)} px/s, ` +
      `swing ${swing.toFixed(1)} px${pass ? '' : ` (${who})`}`,
  );
}
if (errors.length) console.log('FAIL page errors', errors);
process.exit(ok ? 0 : 1);

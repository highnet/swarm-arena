/**
 * Browser check for a calm fleet graph on the real site (issues #202, #221). Point it at a production
 * build (`npm run build && npm start` in web/) or the deployed site:
 *   node web/scripts/fleet-calm-check.mjs [url]   (default http://localhost:3000/fleet)
 * It records every node's position each frame while it drives the page: every ordered pair of
 * presets, a container resize and back, hover, a hidden tab coming back (the catch-up), the 24 h
 * replay, and a minute of live Realtime (with the 20 s prune clock). For each scenario, every node
 * present throughout must close on where it ends without overshoot (≤ MAX_OVERSHOOT px), the ones
 * it leaves alone (placed by the same data before and after) must move less than MAX_STILL px, and
 * every move must be over within MAX_SETTLE_MS of the scenario's last action. A resize may re-fit
 * the layout once (moves allowed, still without overshoot and within the time). It reports
 * time-to-stable, peak per-frame displacement, the longest layout (the renderer's
 * `swarm-graph layout` measures, which must stay under MAX_LAYOUT_MS) and, for comparison, the
 * longest main-thread task of any kind per scenario. The 24 h replay plays from start to end.
 * Needs Playwright's Chromium. Exits 1 on a failed check.
 */
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const MAX_OVERSHOOT = 1; // px
const MAX_STILL = 2; // px
const MAX_SETTLE_MS = 700;
const MAX_LAYOUT_MS = 50; // the longest single layout: never a long task of its own
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
  window.__tasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__tasks.push({ t: e.startTime, ms: e.duration, end: e.startTime + e.duration });
    }).observe({ type: 'longtask' });
  } catch {}
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
// Sizes (#221) on the real page, at the default viewport: sectors in a bounded range, agents
// with room for their icon, and no node name, sub-line or glyph under 11 px.
const sizes = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('g.sg-node')].map((g) => g.__data__);
  const r = (kind) => nodes.filter((n) => n.kind === kind).map((n) => n.r);
  let minFont = Infinity;
  let minText = '';
  for (const t of document.querySelectorAll('text.sg-label, text.sg-sub, text.sg-glyph')) {
    if (!t.textContent) continue;
    const px = Number(t.getAttribute('font-size')) * (t.getScreenCTM()?.a ?? 1);
    if (px < minFont) [minFont, minText] = [px, t.textContent];
  }
  return {
    sectorRatio: Math.max(...r('sector')) / Math.min(...r('sector')),
    minAgentDiameter: 2 * Math.min(...r('agent')),
    minFont,
    minText,
  };
});
const sizeChecks = [
  [
    'the largest sector is at most 1.6× the smallest',
    sizes.sectorRatio <= 1.6,
    `${sizes.sectorRatio.toFixed(2)}×`,
  ],
  [
    'agents have room for a 16–20 px icon',
    !(sizes.minAgentDiameter < 24),
    `${sizes.minAgentDiameter} px`,
  ],
  [
    'no node text under 11 px',
    sizes.minFont >= 11,
    `${sizes.minFont.toFixed(1)} px ("${sizes.minText}")`,
  ],
];

const clock = () => page.evaluate(() => performance.now());
const marks = [];
const scenario = async (name, act, { hold = 6000, refit = false } = {}) => {
  const start = await clock();
  await act();
  const acted = await clock();
  await page.waitForTimeout(hold);
  marks.push({ name, start, acted, end: await clock(), refit });
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
  refit: true,
});
await scenario('resize back', () => page.setViewportSize({ width: 1280, height: 900 }), {
  refit: true,
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
  // A primary scenario (#221): the whole replay, start to end (the site plays it over 60 s),
  // then back to live.
  await scenario('the 24 h replay, start to end', async () => {
    await replay.first().click();
    await page.waitForTimeout(63_000);
    await page.keyboard.press('Escape');
  });
await scenario('a minute of live Realtime and prune ticks', async () => {}, { hold: 60_000 });

const frames = await page.evaluate(() => window.__calm);
const tasks = await page.evaluate(() => window.__tasks);
const layouts = await page.evaluate(() =>
  performance
    .getEntriesByName('swarm-graph layout')
    .map((e) => ({ t: e.startTime, ms: e.duration, end: e.startTime + e.duration })),
);
await browser.close();

let ok = errors.length === 0;
const rows = [];
for (const m of marks) {
  // The hidden tab draws nothing: measure from the moment it is back.
  const w = frames.filter((f) => f.t >= m.start && f.t <= m.end);
  if (!w.length) continue;
  const a = w[0].pos;
  const z = w[w.length - 1].pos;
  const ids = Object.keys(a).filter((id) => w.every((f) => f.pos[id]));
  let still = 0;
  let who = '';
  let overshoot = 0;
  let oWho = '';
  let perFrame = 0;
  let lastMove = m.acted;
  for (const id of ids) {
    // Placed by the same data throughout: it should not move at all.
    const same = !m.refit && w.every((f) => f.pos[id][3] === a[id][3]);
    let closest = Infinity;
    for (let i = 0; i < w.length; i++) {
      const p = w[i].pos[id];
      const d = Math.hypot(p[0] - z[id][0], p[1] - z[id][1]);
      closest = Math.min(closest, d);
      if (d - closest > overshoot) [overshoot, oWho] = [d - closest, id];
      if (i > 0) {
        const q = w[i - 1].pos[id];
        const step = Math.hypot(p[0] - q[0], p[1] - q[1]);
        perFrame = Math.max(perFrame, step);
        if (step > 0.05) lastMove = Math.max(lastMove, w[i].t);
      }
      if (same && !id.startsWith('hub')) {
        const s = Math.hypot(p[0] - a[id][0], p[1] - a[id][1]);
        if (s > still) [still, who] = [s, id];
      }
    }
  }
  const settleMs = Math.max(0, lastMove - m.acted);
  const within = (list) => list.filter((t) => t.end >= m.start && t.t <= m.end).map((t) => t.ms);
  const layout = Math.max(0, ...within(layouts));
  const task = Math.max(
    0,
    ...tasks.filter((t) => t.end >= m.acted && t.t <= m.end).map((t) => t.ms),
  );
  const pass =
    overshoot <= MAX_OVERSHOOT &&
    settleMs <= MAX_SETTLE_MS &&
    (m.refit || still < MAX_STILL) &&
    layout <= MAX_LAYOUT_MS;
  ok &&= pass;
  rows.push({
    name: m.name,
    nodes: ids.length,
    still,
    overshoot,
    settleMs,
    perFrame,
    layout,
    task,
    pass,
  });
  console.log(
    `${pass ? 'ok  ' : 'FAIL'} ${m.name}: ${ids.length} nodes, ` +
      (m.refit ? 're-fit, ' : `still ${still.toFixed(1)} px, `) +
      `overshoot ${overshoot.toFixed(1)} px, time-to-stable ${Math.round(settleMs)} ms, ` +
      `peak ${perFrame.toFixed(1)} px/frame, longest layout ${layout.toFixed(1)} ms ` +
      `(any task ${Math.round(task)} ms)` +
      (pass ? '' : ` (${[who, oWho].filter(Boolean).join(', ')})`),
  );
}
for (const [name, pass, value] of sizeChecks) {
  ok &&= pass;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}: ${value}`);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
if (errors.length) console.log('FAIL page errors', errors);
process.exit(ok ? 0 : 1);

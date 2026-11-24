/**
 * Browser check for a calm graph (issues #202, #221): nodes a change does not touch hold still,
 * and the ones it does move glide straight to their place. Bundles the real renderer, then drives
 * each kind of change the site makes and samples every node's position each frame in Chromium.
 * For every node present before and after a change it asserts:
 *   - zero oscillation: its distance to where it ends only ever shrinks (overshoot ≤ MAX_OVERSHOOT);
 *   - the nodes the change leaves alone move less than MAX_STILL px (a resize may re-fit once);
 *   - every move is over within MAX_SETTLE_MS of the last update (time-to-stable).
 * It reports time-to-stable and the peak per-frame displacement per scenario, for before/after.
 * Scenarios: a seat changing status, a work item moving stage, an agent arriving and one leaving,
 * the 20 s prune tick, a catch-up burst (many arriving and leaving at once), every preset switch
 * (live ↔ Everything), a stream of small updates, hover, the replay starting and stopping, and a
 * container resize (the layout stretches once with the canvas; nothing moves after that).
 * Run: node swarm-graph/scripts/calm-check.mjs [--src <swarm-graph dir>] [--json]
 * (needs Playwright's Chromium). `--src` measures another checkout's renderer, for before/after
 * numbers. Exits 1 on a failed check.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

const MAX_OVERSHOOT = 1; // px past the closest it came to its final place
const MAX_STILL = 2; // px, any node the change leaves alone
const MAX_SETTLE_MS = 700; // from the last update to the last frame anything moved

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const root = path.resolve(arg('--src') ?? fileURLToPath(new URL('..', import.meta.url)));
const bundle = await build({
  stdin: {
    contents: `import { createSwarmGraph, buildSwarmGraph, LIFETIMES } from './src/index.ts';
      window.SG = { createSwarmGraph, buildSwarmGraph, LIFETIMES };`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'iife',
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.setContent(
  '<html><body style="margin:0"><div id="g" style="position:relative;width:1200px;height:800px"></div></body></html>',
);
await page.addScriptTag({ content: bundle.outputFiles[0].text });

const results = await page.evaluate(async () => {
  const { createSwarmGraph, buildSwarmGraph, LIFETIMES } = window.SG;
  const T0 = Date.parse('2026-11-24T12:00:00Z');
  const at = (m) => new Date(T0 + m * 60_000).toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sectors = ['chess', 'go9', 'othello', 'hex', 'site', 'protocol'];
  const base = () => ({
    integrationBranch: 'main',
    asOf: at(0),
    sectors: sectors.map((id) => ({ id, label: id })),
    workItems: sectors.flatMap((s, i) => [
      { id: `${s}-b`, sector: s, title: `${s} branch`, stage: 'claimed', issue: 10 + i },
      { id: `${s}-p`, sector: s, title: `${s} pr`, stage: 'review', issue: 30 + i, pr: 60 + i },
      { id: `${s}-i`, sector: s, title: `${s} issue`, stage: 'backlog', issue: 20 + i },
      { id: `${s}-i2`, sector: s, title: `${s} issue 2`, stage: 'backlog', issue: 40 + i },
      { id: `${s}-m`, sector: s, title: `${s} merged`, stage: 'merged', at: at(-120) },
    ]),
    agents: sectors.flatMap((s, i) => [
      {
        id: `${s}-w`,
        role: 'worker',
        status: 'working',
        sector: s,
        workItem: `${s}-b`,
        lastSeen: at(-1),
      },
      {
        id: `${s}-r`,
        role: 'reviewer',
        status: 'working',
        sector: s,
        workItem: `${s}-p`,
        lastSeen: at(-1),
      },
      { id: `${s}-old`, role: 'merger', status: 'idle', sector: s, lastSeen: at(-100 - i) },
    ]),
    // A day of work, for the replay.
    events: sectors.flatMap((s, i) =>
      [0, 1, 2, 3].map((k) => ({
        id: `e-${s}-${k}`,
        at: at(-600 + i * 60 + k * 10),
        kind: k === 3 ? 'merge' : 'progress',
        agent: `${s}-w`,
        sector: s,
        workItem: `${s}-b`,
        title: `${s} step ${k}`,
      })),
    ),
  });
  const graphOf = (input, { all = false, now = 0 } = {}) =>
    buildSwarmGraph(input, {
      lifetimes: all ? LIFETIMES.everything : LIFETIMES.live,
      now: at(now),
    });

  const el = document.getElementById('g');
  const frames = [];
  let sampling = true;
  const sample = () => {
    const pos = {};
    for (const g of el.querySelectorAll('g.sg-node')) {
      const d = g.__data__;
      const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(g.getAttribute('transform') ?? '');
      if (d && m)
        pos[d.id] = [
          Number(m[1]),
          Number(m[2]),
          g.style.opacity === '' ? 1 : Number(g.style.opacity),
        ];
    }
    frames.push({ t: performance.now(), pos });
    if (sampling) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  const last = () => frames[frames.length - 1];

  /** Motion of every node present throughout, from `from` to now. */
  const measure = (name, from, { changed = [], skipMs = 0, refit = false, since = from } = {}) => {
    const w = frames.filter((f) => f.t >= from + skipMs);
    const a = w[0].pos;
    const z = w[w.length - 1].pos;
    const ids = Object.keys(a).filter((id) => w.every((f) => f.pos[id]));
    let still = 0;
    let who = '';
    let overshoot = 0;
    let oWho = '';
    let perFrame = 0;
    let lastMove = since;
    for (const id of ids) {
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
        if (!refit && !changed.includes(id)) {
          const s = Math.hypot(p[0] - a[id][0], p[1] - a[id][1]);
          if (s > still) [still, who] = [s, id];
        }
      }
    }
    return {
      name,
      nodes: ids.length,
      still,
      who,
      overshoot,
      oWho,
      perFrame,
      settleMs: Math.max(0, lastMove - since),
      refit,
    };
  };
  const out = [];
  const scenario = async (name, act, { hold = 6000, ...opts } = {}) => {
    const from = performance.now();
    lastShow = from;
    await act();
    const since = Math.max(from, lastShow);
    await sleep(hold);
    out.push(measure(name, from, { ...opts, since: opts.since ?? since }));
  };

  const r = createSwarmGraph(el, { intro: 'none' });
  let input = base();
  let all = false;
  let now = 0;
  let lastShow = 0;
  const show = (opts) => {
    lastShow = performance.now();
    r.update(graphOf(input, { all, now }), opts);
  };
  const born = performance.now();
  show();
  await sleep(6000);
  out.push(measure('first load', born, { refit: true }));

  await scenario('idle', async () => {});
  const seat = () => last().pos['agent:hex-w'];
  const seatFrom = seat();
  await scenario(
    'a seat changes status',
    async () => {
      input.agents = input.agents.map((a) =>
        a.id === 'hex-w' ? { ...a, status: 'idle', workItem: undefined, lastSeen: at(0) } : a,
      );
      show();
    },
    { changed: ['agent:hex-w'] },
  );
  const seatTo = seat();
  const moved = Math.hypot(seatTo[0] - seatFrom[0], seatTo[1] - seatFrom[1]);
  await scenario(
    'a work item moves stage',
    async () => {
      input.workItems = input.workItems.map((w) =>
        w.id === 'chess-b' ? { ...w, stage: 'review', pr: 99 } : w,
      );
      show();
    },
    { changed: ['work:chess-b'] },
  );
  await scenario('an agent arrives', async () => {
    input.agents.push({
      id: 'go9-new',
      role: 'worker',
      status: 'working',
      sector: 'go9',
      workItem: 'go9-i',
      lastSeen: at(0),
    });
    show();
  });
  await scenario('an agent leaves', async () => {
    input.agents = input.agents.filter((a) => a.id !== 'site-r');
    show();
  });
  await scenario('the prune tick', async () => {
    now += 25; // the idle seats and old merges age out of the live view
    show();
  });
  await scenario('a catch-up burst', async () => {
    input.agents = input.agents.filter((a) => !a.id.endsWith('-r'));
    for (const s of sectors)
      input.agents.push({
        id: `${s}-x`,
        role: 'fixer',
        status: 'working',
        sector: s,
        workItem: `${s}-i2`,
        lastSeen: at(now),
      });
    show({ quiet: true });
  });
  for (const [name, to] of [
    ['preset live → Everything', true],
    ['preset Everything → live', false],
    ['preset live → Everything again', true],
    ['preset Everything → live again', false],
  ])
    await scenario(name, async () => {
      all = to;
      show({ quiet: true, view: true });
    });
  await scenario('preset switch, then a live update mid-fade', async () => {
    all = true;
    show({ quiet: true, view: true });
    await sleep(700);
    input.agents = input.agents.map((a) => (a.id === 'chess-w' ? { ...a, lastSeen: at(now) } : a));
    show();
    await sleep(1500);
    all = false;
    show({ quiet: true, view: true });
    await sleep(500);
    input = { ...input, asOf: at(now) };
    show();
  });
  await scenario('a stream of small updates', async () => {
    for (let i = 0; i < 10; i++) {
      input.agents = input.agents.map((a) =>
        a.status === 'working' ? { ...a, lastSeen: at(now) } : a,
      );
      input = { ...input, asOf: at(now) };
      show();
      await sleep(400);
    }
  });
  await scenario('hover', async () => {
    for (const id of ['agent:chess-w', 'sector:hex', 'work:site-b', null]) {
      r.highlight(id);
      await sleep(300);
    }
  });
  await scenario(
    'the replay plays and stops',
    async () => {
      r.replay(3000);
      await sleep(4000);
      r.stopReplay();
    },
    { hold: 4000 },
  );
  // The layout re-fits once with the canvas, gliding; after that nothing moves.
  const before = last().pos;
  let resized = 0;
  await scenario(
    'container resize',
    async () => {
      resized = performance.now();
      el.style.width = '1000px';
    },
    { refit: true },
  );
  await scenario(
    'container resize back',
    async () => {
      resized = performance.now();
      el.style.width = '1200px';
    },
    { refit: true },
  );
  void resized;
  const after = last().pos;
  out.push({
    name: 'resize back: every node returns to its place',
    nodes: Object.keys(before).length,
    still: Math.max(
      ...Object.keys(before)
        .filter((id) => after[id])
        .map((id) => Math.hypot(after[id][0] - before[id][0], after[id][1] - before[id][1])),
    ),
    who: '',
    overshoot: 0,
    perFrame: 0,
    settleMs: 0,
    refit: false,
    loose: true,
  });
  sampling = false;
  r.destroy();
  return { out, moved };
});
await browser.close();

if (process.argv.includes('--json')) console.log(JSON.stringify(results));
// Calm is not frozen: the seat that went idle still moves to its new place.
let ok = errors.length === 0 && results.moved > 20;
console.log(
  `${results.moved > 20 ? 'ok  ' : 'FAIL'} the changed seat still moves to its new place: ${results.moved.toFixed(1)} px`,
);
for (const s of results.out) {
  // Returning home after a resize round trip is reported, held to the looser #202 bound (15 px).
  const pass = s.loose
    ? s.still < 15
    : s.overshoot <= MAX_OVERSHOOT &&
      s.settleMs <= MAX_SETTLE_MS &&
      (s.refit || s.still < MAX_STILL);
  ok &&= pass;
  console.log(
    `${pass ? 'ok  ' : 'FAIL'} ${s.name}: ${s.nodes} nodes, ` +
      (s.refit ? 're-fit, ' : `still ${s.still.toFixed(1)} px, `) +
      `overshoot ${s.overshoot.toFixed(1)} px, time-to-stable ${Math.round(s.settleMs)} ms, ` +
      `peak ${s.perFrame.toFixed(1)} px/frame` +
      (pass ? '' : ` (${[s.who, s.oWho].filter(Boolean).join(', ')})`),
  );
}
if (errors.length) console.log('FAIL page errors', errors);
process.exit(ok ? 0 : 1);

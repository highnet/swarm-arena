/**
 * Browser check for a calm view change (issue #192). Bundles the real renderer and switches it
 * between a live view and the longer-memoried `Everything` view (`LIFETIMES.everything`), the way
 * the site's preset switch does (`update(graph, { quiet: true, view: true })`), then samples the
 * DOM in Chromium:
 *   1. the nodes both views show stay where they were (< 3 px) through the switch and after it;
 *   2. the nodes only one view shows fade in or out (#174) rather than pop;
 *   3. with reduced motion, the switch is static: shared nodes do not move, new ones are whole.
 * Run: node swarm-graph/scripts/view-check.mjs (needs Playwright's Chromium). Exits 1 on a failed
 * check.
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Playwright resolves wherever it is installed (it is not a dependency of this package).
const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
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
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.setContent(
  '<html><body style="margin:0"><div id="g" style="position:relative;width:1000px;height:700px"></div></body></html>',
);
await page.addScriptTag({ content: bundle.outputFiles[0].text });

const results = await page.evaluate(async () => {
  const { createSwarmGraph, buildSwarmGraph, LIFETIMES } = window.SG;
  const T0 = Date.parse('2026-11-24T12:00:00Z');
  const ago = (m) => new Date(T0 - m * 60_000).toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sectors = ['chess', 'go', 'othello', 'hex', 'site'];
  const input = {
    integrationBranch: 'main',
    asOf: ago(0),
    sectors: sectors.map((id) => ({ id, label: id })),
    workItems: sectors.flatMap((s, i) => [
      { id: `${s}-b`, sector: s, title: `${s} branch`, stage: 'claimed', issue: 10 + i },
      { id: `${s}-i`, sector: s, title: `${s} issue`, stage: 'backlog', issue: 20 + i },
      // Merged two hours ago: only the Everything view still shows it.
      { id: `${s}-m`, sector: s, title: `${s} merged`, stage: 'merged', at: ago(120) },
    ]),
    agents: sectors.flatMap((s, i) => [
      {
        id: `${s}-live`,
        role: 'worker',
        status: 'working',
        sector: s,
        workItem: `${s}-b`,
        lastSeen: ago(1),
      },
      // Idle for two hours: only the Everything view still shows it.
      { id: `${s}-old`, role: 'reviewer', status: 'idle', sector: s, lastSeen: ago(100 + i) },
    ]),
    events: [],
  };
  const view = (lifetimes) => buildSwarmGraph(input, { lifetimes, now: ago(0) });
  const live = view(LIFETIMES.live);
  const everything = view(LIFETIMES.everything);
  const liveIds = new Set(live.nodes.map((n) => n.id));
  const extra = everything.nodes.map((n) => n.id).filter((id) => !liveIds.has(id));

  const el = document.getElementById('g');
  const nodeEl = (id) => [...el.querySelectorAll('g.sg-node')].find((g) => g.__data__?.id === id);
  const pose = (id) => {
    const g = nodeEl(id);
    if (!g) return null;
    const m = /translate\(([-\d.e]+),([-\d.e]+)\)(?: scale\(([-\d.e]+)\))?/.exec(
      g.getAttribute('transform') ?? '',
    );
    return {
      x: Number(m?.[1]),
      y: Number(m?.[2]),
      scale: m?.[3] ? Number(m[3]) : 1,
      opacity: g.style.opacity === '' ? 1 : Number(g.style.opacity),
    };
  };
  const shared = () => Object.fromEntries([...liveIds].map((id) => [id, pose(id)]));
  const maxShift = (a, b) =>
    Math.max(
      ...Object.keys(a)
        .filter((k) => a[k] && b[k])
        .map((k) => Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)),
    );
  /** Switch views and sample the shared nodes' largest move from where they stood. */
  const switchTo = async (r, graph, probe) => {
    const before = shared();
    const t0 = performance.now();
    r.update(graph, { quiet: true, view: true });
    const samples = [];
    for (const ms of [100, 300, 600, 1000, 1500, 2200]) {
      await sleep(ms - (performance.now() - t0));
      samples.push({ ms, shift: maxShift(before, shared()), probe: pose(probe) });
    }
    await sleep(2500);
    return { samples, settled: maxShift(before, shared()), probe: pose(probe) };
  };
  const out = { extra };

  const r = createSwarmGraph(el, { intro: 'none' });
  r.update(live);
  await sleep(4000); // settle
  out.toEverything = await switchTo(r, everything, extra[0]);
  out.toLive = await switchTo(r, live, extra[0]);
  out.back = await switchTo(r, everything, extra[0]);
  r.destroy();

  // Reduced motion: the switch is static.
  el.innerHTML = '';
  const rm = createSwarmGraph(el, { intro: 'none', reducedMotion: true });
  rm.update(live);
  await sleep(3000);
  const before = shared();
  rm.update(everything, { quiet: true, view: true });
  await sleep(50);
  out.reduced = { shift: maxShift(before, shared()), arrived: pose(extra[0]) };
  await sleep(1000);
  out.reduced.later = maxShift(before, shared());
  rm.destroy();
  return out;
});
await browser.close();

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const peak = (run) => Math.max(...run.samples.map((s) => s.shift), run.settled);
check('the Everything view adds nodes', results.extra.length >= 5, results.extra);
for (const [name, run] of [
  ['live → Everything', results.toEverything],
  ['Everything → live', results.toLive],
  ['live → Everything again', results.back],
])
  check(`${name}: shared nodes stay put (< 3 px)`, peak(run) < 3, {
    shifts: run.samples.map((s) => +s.shift.toFixed(2)),
    settled: run.settled,
  });
const arriving = results.toEverything.samples.find((s) => s.ms === 300)?.probe;
check(
  'an Everything-only node fades in',
  arriving && arriving.opacity < 0.95 && results.toEverything.probe?.opacity === 1,
  { arriving, arrived: results.toEverything.probe },
);
const leaving = results.toLive.samples.find((s) => s.ms === 600)?.probe;
check(
  'an Everything-only node fades out, then leaves',
  leaving && leaving.opacity < 0.95 && results.toLive.probe === null,
  { leaving, after: results.toLive.probe },
);
check(
  'reduced motion: shared nodes do not move',
  results.reduced.shift < 0.5 && results.reduced.later < 0.5,
  results.reduced,
);
check(
  'reduced motion: the new node is whole at once',
  results.reduced.arrived?.opacity === 1 && results.reduced.arrived?.scale === 1,
  results.reduced,
);
check('no page errors', errors.length === 0, errors);

for (const c of checks)
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `  ${JSON.stringify(c.detail)}`}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);

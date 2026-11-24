/**
 * Browser check for nodes leaving and arriving (issue #174). Bundles the real renderer, drives it
 * with fake timestamps, and samples the DOM mid-animation in Chromium:
 *   1. an agent goes stale: it dims (fading), then fades out in place within 700 ms, shrinking,
 *      label first, with no jump in the other nodes, and only then leaves the DOM;
 *   2. a new agent appears: mid-arrival it is partly transparent and smaller, already at its place
 *      (it fades and grows in there, #221), and no other node moves.
 * Run: node swarm-graph/scripts/lifecycle-check.mjs (needs Playwright's Chromium). Exits 1 on a
 * failed check.
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
  const at = (m) => new Date(T0 + m * 60_000).toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const input = (extra = []) => ({
    integrationBranch: 'main',
    asOf: at(0),
    sectors: [
      {
        id: 'chess',
        label: 'Chess',
        color: '#c55',
        count: { value: 9, unit: 'landed', recent: 1, recentUnit: 'today' },
      },
      { id: 'go', label: 'Go', color: '#5c5' },
      {
        id: 'site',
        label: 'Site',
        color: '#55c',
        count: { value: 28, unit: 'merged', recent: 0, recentUnit: 'today' },
      },
    ],
    workItems: [
      {
        id: 'b',
        sector: 'chess',
        title: 'Search',
        stage: 'claimed',
        issue: 9,
        branch: 'agent/9-search',
        at: at(0),
      },
    ],
    agents: [
      {
        id: 'live',
        role: 'worker',
        status: 'working',
        sector: 'chess',
        workItem: 'b',
        lastSeen: at(0),
      },
      { id: 'stale', role: 'reviewer', status: 'idle', sector: 'go', lastSeen: at(0) },
      ...extra,
    ],
    events: [
      {
        id: 'e1',
        at: at(0),
        kind: 'progress',
        agent: 'stale',
        sector: 'go',
        workItem: null,
        title: 'x',
      },
    ],
  });
  const graphAt = (m, extra) =>
    buildSwarmGraph(input(extra), { lifetimes: LIFETIMES.live, now: at(m) });
  const el = document.getElementById('g');
  const r = createSwarmGraph(el, { intro: 'none' });
  const nodeEl = (id) => [...el.querySelectorAll('g.sg-node')].find((g) => g.__data__?.id === id);
  const tagEl = (id) => [...el.querySelectorAll('g.sg-tag')].find((g) => g.__data__?.id === id);
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
      dim: Number(g.querySelector('g.sg-inner').getAttribute('opacity') ?? 1),
      label: (() => {
        const t = tagEl(id)?.querySelector('text.sg-sub');
        return t && t.style.opacity !== '' ? Number(t.style.opacity) : 1;
      })(),
    };
  };
  const others = () =>
    Object.fromEntries(
      [...el.querySelectorAll('g.sg-node')]
        .map((g) => g.__data__.id)
        .filter((id) => id !== 'agent:stale' && id !== 'agent:new')
        .map((id) => [id, pose(id)]),
    );
  const maxShift = (a, b) =>
    Math.max(
      ...Object.keys(a)
        .filter((k) => b[k])
        .map((k) => Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)),
    );
  const out = {};

  r.update(graphAt(2));
  await sleep(3500); // settle
  out.sectorGlyphs = [...el.querySelectorAll('g.sg-tag')]
    .filter((g) => g.__data__.kind === 'sector')
    .map((g) => [
      g.__data__.id,
      g.querySelector('text.sg-glyph').textContent,
      g.querySelector('text.sg-sub').textContent,
    ]);

  // 8 minutes after its last activity: winding down, dimmer.
  r.update(graphAt(8));
  await sleep(1000);
  out.fading = pose('agent:stale');

  // 11 minutes: gone from the graph, fading out.
  const before = others();
  const t0 = performance.now();
  r.update(graphAt(11));
  const samples = [];
  for (const ms of [120, 300, 480]) {
    await sleep(ms - (performance.now() - t0));
    samples.push({ ms, ...pose('agent:stale'), shift: maxShift(before, others()) });
  }
  out.leaving = samples;
  await sleep(760 - (performance.now() - t0));
  out.afterLeave = { inDom: Boolean(nodeEl('agent:stale')), tag: Boolean(tagEl('agent:stale')) };
  await sleep(1500);
  out.settleShift = maxShift(before, others());

  // A new agent arrives in Go.
  const newAgent = { id: 'new', role: 'worker', status: 'working', sector: 'go', lastSeen: at(11) };
  const sector = pose('sector:go');
  const t1 = performance.now();
  r.update(graphAt(11, [newAgent]));
  await sleep(200 - (performance.now() - t1));
  out.arriving = { ...pose('agent:new'), sector };
  const beside = others();
  await sleep(2500);
  out.arrived = pose('agent:new');
  out.arrivalShift = maxShift(beside, others());
  r.destroy();

  // Reduced motion: removals and arrivals are instant.
  el.innerHTML = '';
  const rm = createSwarmGraph(el, { intro: 'none', reducedMotion: true });
  rm.update(graphAt(2));
  await sleep(50);
  rm.update(graphAt(11, [newAgent]));
  await sleep(50);
  out.reduced = { stale: Boolean(nodeEl('agent:stale')), arrived: pose('agent:new') };
  rm.destroy();
  return out;
});
await browser.close();

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const glyph = Object.fromEntries(results.sectorGlyphs.map(([id, n, sub]) => [id, { n, sub }]));
check(
  'sector numbers are the host count, labelled',
  glyph['sector:chess'].n === '9' &&
    glyph['sector:chess'].sub.startsWith('landed · 1 today') &&
    glyph['sector:site'].n === '28' &&
    glyph['sector:site'].sub.startsWith('merged'),
  glyph,
);
check('a sector with no count shows no number', glyph['sector:go'].n === '', glyph['sector:go']);
check(
  'a stale agent dims before it leaves',
  Math.abs(results.fading.dim - 0.7) < 0.02 && results.fading.opacity === 1,
  results.fading,
);
const [early, mid, late] = results.leaving;
check(
  'mid-fade: partly transparent and shrinking',
  mid.opacity > 0.15 && mid.opacity < 0.85 && mid.scale < 1 && mid.scale > 0.6,
  mid,
);
check(
  'the fade keeps going down',
  early.opacity > mid.opacity && mid.opacity > late.opacity && late.scale < mid.scale,
  results.leaving,
);
check('its label fades ahead of the circle', mid.label < mid.opacity, mid);
check(
  'no layout jump while it fades (others move < 6 px)',
  Math.max(...results.leaving.map((s) => s.shift)) < 6,
  results.leaving.map((s) => s.shift),
);
check(
  'it leaves the DOM only after the fade',
  !results.afterLeave.inDom && !results.afterLeave.tag,
  results.afterLeave,
);
check(
  'nothing moves into the room it leaves (others move < 1 px)',
  results.settleShift < 1,
  results.settleShift,
);
const a = results.arriving;
const dParent = Math.hypot(a.x - a.sector.x, a.y - a.sector.y);
const dFinal = Math.hypot(a.x - results.arrived.x, a.y - results.arrived.y);
check(
  'mid-arrival: partly transparent and smaller',
  a.opacity > 0.05 && a.opacity < 0.95 && a.scale > 0.4 && a.scale < 1,
  a,
);
check('mid-arrival: already at its place, beside its sector', dParent > 3 && dFinal < 1, {
  dParent,
  dFinal,
});
check('an arrival moves no other node (< 1 px)', results.arrivalShift < 1, results.arrivalShift);
check(
  'arrived: whole',
  results.arrived.opacity === 1 && results.arrived.scale === 1,
  results.arrived,
);
check('an arrival fades in once (no second dim layer)', a.dim === 1, a);
check('reduced motion: the dead node is gone at once', !results.reduced.stale, results.reduced);
check(
  'reduced motion: the new node is whole at once',
  results.reduced.arrived?.opacity === 1 && results.reduced.arrived?.scale === 1,
  results.reduced,
);
check('no page errors', errors.length === 0, errors);

for (const c of checks)
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `  ${JSON.stringify(c.detail)}`}`);
console.log(JSON.stringify({ leaving: results.leaving, arriving: { ...a, dParent, dFinal } }));
process.exit(checks.every((c) => c.ok) ? 0 : 1);

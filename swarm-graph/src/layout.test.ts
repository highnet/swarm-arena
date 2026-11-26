import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrangeSectors,
  COMPACT_WIDTH,
  layoutGraph,
  startLayout,
  type LayoutLink,
  type LayoutNode,
  type LayoutPoint,
} from './layout';

/** A fleet like the site's: `k` sectors on the ring, each with work in flight, issues and seats. */
const fleet = (k: number) => {
  const nodes: LayoutNode[] = [];
  const links: LayoutLink[] = [];
  const limit = { x: 560, y: 360 };
  const R = { x: 460, y: 280 };
  nodes.push({
    id: 'hub',
    r: 30,
    anchor: { x: 0, y: 0 },
    anchorStrength: 0,
    charge: -140,
    fixed: { x: 0, y: 0 },
    limit,
  });
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2 - Math.PI / 2;
    const ring = { x: Math.cos(a) * R.x, y: Math.sin(a) * R.y };
    const s = `sector:${i}`;
    const at = (f: number) => ({ x: ring.x * f, y: ring.y * f });
    nodes.push({
      id: s,
      r: 40,
      anchor: ring,
      anchorStrength: 0.5,
      charge: -420,
      fixed: ring,
      limit,
    });
    const work = (id: string, f: number, r: number) => {
      nodes.push({
        id,
        r,
        anchor: at(f),
        anchorStrength: 0.2,
        charge: -50,
        parent: s,
        limit,
      });
      links.push({ source: id, target: s, distance: 74, strength: 0.4 });
    };
    work(`work:${i}-b`, 0.56, 15);
    work(`work:${i}-p`, 0.56, 15);
    work(`work:${i}-i`, 1.2, 9);
    work(`work:${i}-i2`, 1.2, 9);
    work(`work:${i}-m`, 1, 8);
    for (const [seat, on] of [
      ['w', `work:${i}-b`],
      ['r', `work:${i}-p`],
    ]) {
      const id = `agent:${i}-${seat}`;
      nodes.push({
        id,
        r: 17,
        anchor: at(1.08),
        anchorStrength: 0.03,
        charge: -140,
        parent: on,
        limit,
      });
      links.push({ source: id, target: on, distance: 34, strength: 0.6 });
    }
    nodes.push({
      id: `agent:${i}-old`,
      r: 14,
      anchor: at(1.08),
      anchorStrength: 0.03,
      charge: -140,
      parent: s,
      limit,
    });
    links.push({ source: `agent:${i}-old`, target: s, distance: 86, strength: 0.6 });
  }
  return { nodes, links };
};

/** The same fleet with every node laid out pinned where `places` has it. */
const pinnedTo = (nodes: LayoutNode[], places: Map<string, LayoutPoint>) =>
  nodes.map((n) => (n.fixed || !places.has(n.id) ? n : { ...n, pinned: places.get(n.id) }));

const overlaps = (nodes: LayoutNode[], places: Map<string, LayoutPoint>) => {
  let count = 0;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = places.get(nodes[i].id)!;
      const b = places.get(nodes[j].id)!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < nodes[i].r + nodes[j].r - 0.5) count++;
    }
  return count;
};

const timed = (fn: () => void, runs = 7) => {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    ms.push(performance.now() - t);
  }
  return ms.sort((a, b) => a - b)[Math.floor(runs / 2)];
};

test('deterministic: the same graph gives exactly the same places', () => {
  const { nodes, links } = fleet(6);
  const a = layoutGraph(nodes, links).positions;
  const b = layoutGraph(
    nodes.map((n) => ({ ...n })),
    links.map((l) => ({ ...l })),
  ).positions;
  assert.equal(a.size, nodes.length);
  for (const [id, p] of a) assert.deepEqual(b.get(id), p, id);
});

test('sectors and the hub stay exactly on their fixed places', () => {
  const { nodes, links } = fleet(6);
  const { positions } = layoutGraph(nodes, links);
  for (const n of nodes) if (n.fixed) assert.deepEqual(positions.get(n.id), n.fixed, n.id);
});

test('a full layout leaves no two nodes overlapping, each near its sector', () => {
  const { nodes, links } = fleet(6);
  const { positions } = layoutGraph(nodes, links);
  assert.equal(overlaps(nodes, positions), 0);
  for (const n of nodes) {
    if (n.fixed) continue;
    const p = positions.get(n.id)!;
    assert.ok(Math.abs(p.x) <= n.limit.x && Math.abs(p.y) <= n.limit.y, `${n.id} off the canvas`);
    // Closer to its own sector than to either neighbour's anchor slot.
    const sector = n.id.replace(/^(agent|work):(\d+)-.*$/, 'sector:$2');
    const own = positions.get(sector)!;
    const d = Math.hypot(p.x - own.x, p.y - own.y);
    assert.ok(d < 260, `${n.id} is ${d.toFixed(0)} px from its sector`);
  }
});

test('an agent arriving moves no node already placed, and lands beside its work', () => {
  const { nodes, links } = fleet(6);
  const before = layoutGraph(nodes, links).positions;
  const fresh: LayoutNode = {
    id: 'agent:new',
    r: 17,
    anchor: { x: 0, y: -300 },
    anchorStrength: 0.03,
    charge: -140,
    parent: 'work:0-b',
    limit: { x: 560, y: 360 },
  };
  const next = [...pinnedTo(nodes, before), fresh];
  const { positions, free } = layoutGraph(next, [
    ...links,
    { source: 'agent:new', target: 'work:0-b', distance: 34, strength: 0.6 },
  ]);
  assert.equal(free, 1);
  for (const [id, p] of before) assert.deepEqual(positions.get(id), p, `${id} moved`);
  const at = positions.get('agent:new')!;
  const work = positions.get('work:0-b')!;
  assert.ok(Math.hypot(at.x - work.x, at.y - work.y) < 90, 'beside the work it holds');
  assert.equal(overlaps(next, positions), 0);
});

test('an agent leaving moves nothing; nothing free means no solving at all', () => {
  const { nodes, links } = fleet(6);
  const before = layoutGraph(nodes, links).positions;
  const rest = pinnedTo(nodes, before).filter((n) => n.id !== 'agent:2-r');
  const { positions, free, ticks } = layoutGraph(
    rest,
    links.filter((l) => l.source !== 'agent:2-r'),
  );
  assert.equal(free, 0);
  assert.equal(ticks, 0);
  for (const n of rest) assert.deepEqual(positions.get(n.id), before.get(n.id), n.id);
});

test('a re-fit (settle) pushes an overlapped neighbour out by exactly the overlap', () => {
  const { nodes, links } = fleet(6);
  const before = layoutGraph(nodes, links).positions;
  const pinned = pinnedTo(nodes, before);
  // Grow sector 0 until it reaches its nearest neighbour, plus 10 px.
  const s = pinned.find((n) => n.id === 'sector:0')!;
  const sp = before.get('sector:0')!;
  let nearest = { id: '', gap: Infinity };
  for (const n of pinned) {
    if (n.fixed) continue;
    const p = before.get(n.id)!;
    const gap = Math.hypot(p.x - sp.x, p.y - sp.y) - n.r - s.r;
    if (gap < nearest.gap) nearest = { id: n.id, gap };
  }
  const grown = pinned.map((n) => (n.id === s.id ? { ...n, r: n.r + nearest.gap + 10 } : n));
  const { positions } = layoutGraph(grown, links, { settle: true });
  // A data update never moves a pinned node, overlap or not.
  const kept = layoutGraph(grown, links).positions;
  for (const [id, p] of before) assert.deepEqual(kept.get(id), p, `${id} moved on an update`);
  const was = before.get(nearest.id)!;
  const now = positions.get(nearest.id)!;
  const moved = Math.hypot(now.x - was.x, now.y - was.y);
  assert.ok(moved > 9 && moved < 11.5, `pushed ${moved.toFixed(2)} px for a 10 px overlap`);
  assert.equal(overlaps(grown, positions), 0);
});

test('performance: well inside a frame at today’s size and at 3×', () => {
  for (const [k, budget] of [
    [6, 25],
    [18, 50],
  ]) {
    const { nodes, links } = fleet(k);
    const full = timed(() => layoutGraph(nodes, links));
    const places = layoutGraph(nodes, links).positions;
    const fresh: LayoutNode = {
      id: 'agent:new',
      r: 17,
      anchor: { x: 0, y: -300 },
      anchorStrength: 0.03,
      charge: -140,
      parent: 'work:0-b',
      limit: { x: 560, y: 360 },
    };
    const one = [...pinnedTo(nodes, places), fresh];
    const incremental = timed(() => layoutGraph(one, links));
    console.log(
      `# ${nodes.length} nodes: full layout ${full.toFixed(1)} ms, one arrival ${incremental.toFixed(1)} ms`,
    );
    // Generous for a slow CI runner: the point is no long task (50 ms) on the main thread.
    assert.ok(full < budget, `full layout of ${nodes.length} nodes took ${full.toFixed(1)} ms`);
    assert.ok(incremental < budget, `one arrival took ${incremental.toFixed(1)} ms`);
  }
});

test('a layout run in slices gives exactly the one-shot result', () => {
  const { nodes, links } = fleet(6);
  const whole = layoutGraph(nodes, links);
  const job = startLayout(nodes, links);
  let slices = 0;
  while (!job.step(7)) slices++;
  assert.ok(slices > 2, 'it took several slices');
  const sliced = job.result();
  assert.equal(sliced.ticks, whole.ticks);
  for (const [id, p] of whole.positions) assert.deepEqual(sliced.positions.get(id), p, id);
});

// ---- sector arrangement (#272) --------------------------------------------------------------

/** The site's numbers: sectors of 90–100 px at full size, 12 px of arc and margin, hub room 30. */
const arrange = (count: number, width: number, height: number) =>
  arrangeSectors({ count, width, height, maxBody: 100, ringRoom: 12, hubRoom: 30 });

test('a wide canvas keeps the ring, exactly as before (#272: desktop unchanged)', () => {
  const a = arrange(6, 1398, 600);
  assert.equal(a.kind, 'ring');
  assert.equal(a.scale, Math.max(0.6, Math.min(1, 600 / 620)));
  const R = { x: Math.max(100, 699 - 140 * a.scale), y: Math.max(100, 300 - 120 * a.scale) };
  a.slots.forEach((p, i) => {
    const t = (i / 6) * Math.PI * 2 - Math.PI / 2;
    assert.ok(Math.abs(p.x - Math.cos(t) * R.x) < 1e-9 && Math.abs(p.y - Math.sin(t) * R.y) < 1e-9);
  });
});

test('below COMPACT_WIDTH the sectors stand in a grid where no two (arcs included) overlap', () => {
  for (const width of [254, 286, 326, 341, 356, 396, COMPACT_WIDTH - 1])
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const height = 416;
      const a = arrange(count, width, height);
      assert.equal(a.kind, 'grid');
      const room = 100 * a.scale + 12;
      for (let i = 0; i < count; i++) {
        const p = a.slots[i];
        // Clear of the hub and inside the canvas.
        assert.ok(Math.hypot(p.x, p.y) >= room + 30, `sector ${i} clears the hub at ${width}`);
        assert.ok(Math.abs(p.x) + room <= width / 2 + 1e-9, `sector ${i} inside at ${width}`);
        for (let j = i + 1; j < count; j++) {
          const q = a.slots[j];
          assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= 2 * room - 1e-9, `${i}/${j} at ${width}`);
        }
      }
    }
});

test('six sectors on a phone: three by two, with the hub in the band between the rows', () => {
  const a = arrange(6, 356, 416);
  assert.deepEqual([a.cols, a.rows], [3, 2]);
  assert.ok(a.slots.slice(0, 3).every((p) => p.y < 0));
  assert.ok(a.slots.slice(3).every((p) => p.y > 0));
  // Legible circles at 390 px (a 356 px canvas), and the whole grid within the canvas height.
  assert.ok(100 * a.scale >= 40, `body ${100 * a.scale}`);
  assert.ok(Math.max(...a.slots.map((p) => Math.abs(p.y))) + 100 * a.scale + 12 <= 208);
});

test('the arrangement is a pure function of the canvas and the count', () => {
  assert.deepEqual(arrange(6, 356, 416), arrange(6, 356, 416));
  assert.deepEqual(arrange(5, 1200, 600), arrange(5, 1200, 600));
});

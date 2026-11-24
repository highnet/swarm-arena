import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_INTRO,
  SHORT_INTRO,
  clockAngle,
  introCamera,
  introEdge,
  introLabels,
  introPose,
  introProgress,
  planIntro,
  type IntroNode,
} from './intro';

const ring = (n: number, r = 200): IntroNode[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { id: `sector:s${i}`, role: 'sector' as const, x: Math.cos(a) * r, y: Math.sin(a) * r };
  });

const graph = (): IntroNode[] => [
  { id: 'hub', role: 'hub', x: 0, y: 0 },
  // Listed out of order on purpose: the plan sorts by angle, not by input order.
  ...ring(4).reverse(),
  { id: 'w-far', role: 'other', sectorId: 'sector:s1', x: 300, y: 10 },
  { id: 'w-near', role: 'other', sectorId: 'sector:s1', x: 120, y: 5 },
  { id: 'gate', role: 'other', sectorId: null, x: 40, y: 40 },
];

test('clockAngle runs clockwise from 12 o’clock in screen coordinates', () => {
  assert.equal(clockAngle(0, -1), 0);
  assert.ok(Math.abs(clockAngle(1, 0) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(clockAngle(0, 1) - Math.PI) < 1e-9);
  assert.ok(Math.abs(clockAngle(-1, 0) - (3 * Math.PI) / 2) < 1e-9);
});

test('the hub goes first, then the sectors clockwise from the top, 80 ms apart', () => {
  const plan = planIntro(graph());
  assert.equal(plan.timing.get('hub')!.delay, 0);
  const delays = [0, 1, 2, 3].map((i) => plan.timing.get(`sector:s${i}`)!.delay);
  assert.ok(delays[0] > 0);
  for (let i = 1; i < 4; i++) assert.equal(delays[i] - delays[i - 1], FULL_INTRO.sectorStaggerMs);
});

test('satellites follow their sector, nearest the hub first', () => {
  const plan = planIntro(graph());
  const sector = plan.timing.get('sector:s1')!.delay;
  const near = plan.timing.get('w-near')!.delay;
  const far = plan.timing.get('w-far')!.delay;
  assert.ok(near > sector);
  assert.ok(far > near);
  // An unattached node (a gate role by the hub) still gets a slot.
  assert.ok(plan.timing.get('gate')!.delay > 0);
  assert.equal(plan.timing.size, graph().length);
});

test('a busy sector stays within a bounded stagger', () => {
  const many: IntroNode[] = [
    { id: 'hub', role: 'hub', x: 0, y: 0 },
    ...ring(6),
    ...Array.from({ length: 200 }, (_, i) => ({
      id: `w${i}`,
      role: 'other' as const,
      sectorId: 'sector:s0',
      x: i,
      y: -300,
    })),
  ];
  const plan = planIntro(many);
  assert.ok(plan.totalMs < 1800, `full intro took ${plan.totalMs} ms`);
  const short = planIntro(many, SHORT_INTRO);
  assert.ok(short.totalMs <= 550, `short intro took ${short.totalMs} ms`);
});

test('nodes travel the straight radial line from the hub, easing out without overshoot', () => {
  const plan = planIntro(graph());
  const timing = plan.timing.get('sector:s1')!;
  const target = { x: 200, y: 0 };
  assert.deepEqual(introPose(target, timing, 0), { x: 0, y: 0, scale: 0.05, opacity: 0 });
  let prev = 0;
  for (let t = 0; t <= plan.totalMs + 100; t += 16) {
    const p = introPose(target, timing, t);
    assert.ok(Math.abs(p.y) < 1e-9, 'stays on its radial line');
    assert.ok(p.x >= prev - 1e-9, 'never moves back');
    assert.ok(p.x <= target.x + 1e-9, 'never overshoots');
    prev = p.x;
  }
  const end = introPose(target, timing, timing.delay + timing.duration);
  assert.deepEqual(end, { x: 200, y: 0, scale: 1, opacity: 1 });
  // Ease-out: more than half the way in the first half of the tween.
  assert.ok(introPose(target, timing, timing.delay + timing.duration / 2).x > 150);
});

test('edges draw on as their later endpoint arrives', () => {
  const plan = planIntro(graph());
  const hub = plan.timing.get('hub');
  const far = plan.timing.get('w-far')!;
  assert.equal(introEdge(hub, far, far.delay), 0);
  assert.equal(introEdge(hub, far, far.delay + far.duration), 1);
  assert.ok(introEdge(hub, far, far.delay + far.duration / 2) > 0);
  assert.equal(introProgress(undefined, 0), 1, 'a node outside the plan is already there');
});

test('the camera pulls back to the fitted view and labels come last', () => {
  const plan = planIntro(graph());
  assert.ok(Math.abs(introCamera(plan, 0) - 1.15) < 1e-9);
  assert.equal(introCamera(plan, plan.totalMs), 1);
  assert.equal(introLabels(plan, 0), 0);
  assert.equal(introLabels(plan, plan.labelsAt), 0);
  assert.equal(introLabels(plan, plan.totalMs), 1);
  assert.ok(plan.labelsAt > plan.timing.get('sector:s3')!.delay);
});

test('an empty graph has nothing to play', () => {
  const plan = planIntro([]);
  assert.equal(plan.totalMs, 0);
  assert.equal(introLabels(plan, 0), 1);
  assert.equal(introCamera(plan, 0), 1);
});

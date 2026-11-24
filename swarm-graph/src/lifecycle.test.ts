import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRIVAL,
  arrivalPose,
  DEPARTURE,
  departurePose,
  easeInOut,
  MOVE,
  movePoint,
  progressAt,
  staggerAt,
  TRANSITION_MS,
} from './lifecycle';

test('easeInOut runs 0 → 1, symmetric, soft at both ends', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.equal(easeInOut(0.5), 0.5);
  assert.ok(easeInOut(0.1) < 0.1);
  assert.ok(easeInOut(0.9) > 0.9);
  assert.ok(Math.abs(easeInOut(0.3) + easeInOut(0.7) - 1) < 1e-9);
});

test('an arrival starts small and transparent and ends whole', () => {
  const a = arrivalPose(0);
  assert.equal(a.opacity, 0);
  assert.equal(a.scale, ARRIVAL.startScale);
  const z = arrivalPose(1);
  assert.deepEqual(z, { scale: 1, opacity: 1, label: 1, edge: 1 });
  const mid = arrivalPose(0.3);
  assert.ok(mid.opacity > 0 && mid.opacity < 1);
  assert.ok(mid.label < mid.opacity, 'label follows the circle');
});

test('a departure fades to 0 at 60% size, the label ahead of the circle', () => {
  const z = departurePose(1);
  assert.equal(z.opacity, 0);
  assert.ok(Math.abs(z.scale - DEPARTURE.endScale) < 1e-9);
  assert.equal(z.edge, 0);
  const mid = departurePose(0.5);
  assert.ok(mid.label < mid.opacity);
  assert.equal(mid.edge, mid.opacity);
  assert.equal(departurePose(DEPARTURE.labelLead).label, 0);
});

test('batches are staggered, capped', () => {
  assert.equal(staggerAt(0, 120, 12), 0);
  assert.equal(staggerAt(3, 120, 12), 360);
  assert.equal(staggerAt(50, 120, 12), 1440);
  assert.equal(progressAt(100, 200, 1000), 0);
  assert.equal(progressAt(700, 200, 1000), 0.5);
  assert.equal(progressAt(5000, 200, 1000), 1);
});

test('every transition, its stagger included, ends within TRANSITION_MS', () => {
  const longest = (d: { durationMs: number; staggerMs: number; maxSteps: number }) =>
    staggerAt(1000, d.staggerMs, d.maxSteps) + d.durationMs;
  assert.ok(longest(ARRIVAL) <= TRANSITION_MS);
  assert.ok(longest(DEPARTURE) <= TRANSITION_MS);
  assert.ok(MOVE.durationMs <= TRANSITION_MS);
});

test('a move closes on its target monotonically, with no overshoot', () => {
  const from = { x: -40, y: 12 };
  const to = { x: 260, y: -90 };
  let last = Infinity;
  for (let i = 0; i <= 100; i++) {
    const p = movePoint(from, to, i / 100);
    const d = Math.hypot(to.x - p.x, to.y - p.y);
    assert.ok(d <= last + 1e-9, `distance grew at ${i}%`);
    last = d;
  }
  assert.deepEqual(movePoint(from, to, 0), from);
  assert.deepEqual(movePoint(from, to, 1), to);
  assert.deepEqual(movePoint(from, to, 3), to, 'past the end it stays on the target');
});

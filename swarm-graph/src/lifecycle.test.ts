import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRIVAL,
  arrivalPose,
  arrivalTarget,
  DEPARTURE,
  departurePose,
  easeInOut,
  progressAt,
  staggerAt,
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
  assert.equal(a.travel, 0);
  const z = arrivalPose(1);
  assert.deepEqual(z, { travel: 1, scale: 1, opacity: 1, label: 1, edge: 1 });
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

test('an arrival glides to just outside its parent, towards its pull', () => {
  const t = arrivalTarget({ x: 100, y: 0, r: 20 }, { x: 300, y: 0 }, 8);
  assert.ok(Math.abs(t.y) < 1e-9);
  assert.equal(t.x, 100 + 20 + 8 + 26);
  const out = arrivalTarget({ x: 0, y: -100, r: 20 }, { x: 0, y: -100 }, 8);
  assert.ok(out.y < -100, 'no pull: outward from the hub');
});

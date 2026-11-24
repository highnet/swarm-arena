import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectorNodeId, type SwarmFlow } from './model';
import {
  activeWindow,
  emptySnapshot,
  indexAtTime,
  planReplay,
  stateAt,
  summarizeReplay,
} from './replay';

const HOUR = 3_600_000;
const MIN = 60_000;
const t0 = Date.parse('2026-11-20T00:00:00Z');

const flow = (i: number, ms: number, over: Partial<SwarmFlow> = {}): SwarmFlow => ({
  id: `f${i}`,
  at: new Date(t0 + ms).toISOString(),
  kind: 'progress',
  title: `event ${i}`,
  sub: null,
  group: null,
  outcome: null,
  delta: null,
  agent: 'a',
  sector: 'chess',
  path: ['agent:a', 'sector:chess'],
  weight: 1,
  ...over,
});

/** One event every `step` ms from `from` to `to` (inclusive), numbered from `first`. */
const series = (first: number, from: number, to: number, step: number) => {
  const out: SwarmFlow[] = [];
  for (let ms = from, i = first; ms <= to; ms += step, i++) out.push(flow(i, ms));
  return out;
};

test('the window covers 24 h of active time across an overnight gap', () => {
  // 12 h of work, a 6 h pause, 12 h of work: 30 h of wall time, 24 h of it active,
  // plus 12 h of older work before that the window must leave out.
  const older = series(0, 0, 12 * HOUR - 5 * MIN, 5 * MIN);
  const day1 = series(1000, 12 * HOUR, 24 * HOUR, 5 * MIN);
  const day2 = series(2000, 30 * HOUR, 42 * HOUR, 5 * MIN);
  const flows = [...older, ...day1, ...day2];
  const w = activeWindow(flows, 24 * HOUR, 15 * MIN);
  const first = flows[w.start];
  // The 6 h gap counts as 15 min, so 15 min of day 1 falls outside the window.
  assert.ok(w.activeMs <= 24 * HOUR);
  assert.ok(w.activeMs > 24 * HOUR - 5 * MIN);
  assert.equal(Date.parse(first.at), t0 + 12 * HOUR + 15 * MIN);
  const wall = Date.parse(flows.at(-1)!.at) - Date.parse(first.at);
  assert.ok(wall > 29 * HOUR, 'the window spans far more wall time than active time');
  assert.deepEqual(
    w.gaps.map((g) => g.ms),
    [6 * HOUR],
  );
});

test('an empty or short history replays all of it', () => {
  assert.deepEqual(activeWindow([]), { start: 0, activeMs: 0, gaps: [] });
  const short = series(0, 0, 3 * HOUR, 10 * MIN);
  assert.equal(activeWindow(short).start, 0);
  assert.equal(planReplay(short, 'hub:main').flows.length, short.length);
});

test('events before the window seed the starting state', () => {
  const flows = [
    flow(0, 0, { kind: 'merge', weight: 3 }),
    flow(1, 1 * MIN, { kind: 'rating', delta: 40 }),
    ...series(2, 30 * HOUR, 40 * HOUR, 10 * MIN),
    flow(99, 40 * HOUR + MIN, { kind: 'rating', delta: 25 }),
  ];
  const plan = planReplay(flows, 'hub:main', { activeMs: 4 * HOUR });
  assert.ok(plan.flows.length < flows.length);
  assert.equal(plan.seed.merges, 1);
  assert.equal(plan.seed.rating.chess, 40);
  assert.equal(plan.seed.effort['hub:main'], 3);
  // The window ends at the live state: seed + every window event equals the whole history.
  const whole = stateAt(emptySnapshot(), flows, flows.length, 'hub:main');
  const end = stateAt(plan.seed, plan.flows, plan.flows.length, 'hub:main');
  assert.deepEqual(end, whole);
  assert.equal(summarizeReplay(plan).rating.chess, 25);
  // Whole-run mode starts empty.
  const all = planReplay(flows, 'hub:main', { mode: 'all' });
  assert.equal(all.flows.length, flows.length);
  assert.equal(all.seed.events, 0);
});

test('stateAt is pure and seeks to any index', () => {
  const flows = series(0, 0, HOUR, 10 * MIN);
  const seed = emptySnapshot();
  const s3 = stateAt(seed, flows, 3, 'hub:main');
  assert.equal(s3.effort[sectorNodeId('chess')], 3);
  assert.equal(seed.events, 0, 'the seed is not mutated');
  assert.equal(stateAt(seed, flows, 999, 'hub:main').events, flows.length);
  assert.equal(stateAt(seed, flows, -1, 'hub:main').events, 0);
});

test('the schedule fits the duration, squeezes idle gaps and dwells on milestones', () => {
  const flows = [
    ...series(0, 0, 2 * HOUR, 10 * MIN),
    flow(50, 12 * HOUR, { kind: 'merge', weight: 3 }),
    ...series(60, 12 * HOUR + 10 * MIN, 14 * HOUR, 10 * MIN),
  ];
  const plan = planReplay(flows, 'hub:main', { durationMs: 60_000 });
  assert.equal(plan.times.length, plan.flows.length);
  assert.ok(plan.total <= 62_000 && plan.total >= 55_000, `total ${plan.total}`);
  for (let i = 1; i < plan.times.length; i++) assert.ok(plan.times[i] >= plan.times[i - 1]);
  const m = plan.flows.findIndex((f) => f.kind === 'merge');
  assert.deepEqual(plan.milestones, [m]);
  assert.deepEqual(
    plan.gaps.map((g) => g.index),
    [m],
  );
  // The 10 h idle gap is a short beat, not 10 h's share of the minute.
  assert.ok(plan.times[m] - plan.times[m - 1] < 1000);
  // A routine step after the merge waits out the milestone's hold.
  const routine = plan.times[2] - plan.times[1];
  assert.ok(plan.times[m + 1] - plan.times[m] > routine);
  assert.equal(indexAtTime(plan, -1), 0);
  assert.equal(indexAtTime(plan, plan.times[m]), m + 1);
  assert.equal(indexAtTime(plan, plan.total), plan.flows.length);
});

test('a busy history still fits the duration', () => {
  const flows = series(0, 0, 24 * HOUR, 20_000);
  const plan = planReplay(flows, 'hub:main', { durationMs: 60_000 });
  assert.ok(plan.total <= 61_600, `total ${plan.total}`);
});

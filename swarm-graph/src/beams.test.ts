import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beamTier, createBeamGate } from './beams';
import type { SwarmEventKind } from './model';

/** Feed events through a gate the way the renderer does; returns the beams fired. */
const play = (
  events: { at: number; kind: SwarmEventKind; sector: string; delta?: number | null }[],
  durationMs = 900,
) => {
  const gate = createBeamGate();
  const fired: { at: number; count: number; id: number }[] = [];
  let maxInFlight = 0;
  let folded = 0;
  for (const e of events) {
    if (beamTier(e, null) === 'none') continue;
    const o = gate.offer(`${e.sector}|${e.kind}`, e.at, durationMs);
    if (o.fire) fired.push({ at: e.at, count: o.count, id: o.id });
    else if (o.into !== null) folded++;
    maxInFlight = Math.max(maxInFlight, gate.inFlight(e.at));
  }
  return { fired, maxInFlight, folded, gate };
};

test('routine events get no beam; reserved kinds do; big moments are the big tier', () => {
  for (const kind of ['progress', 'result', 'session', 'post', 'plan', 'protocol'] as const)
    assert.equal(beamTier({ kind }, null), 'none', kind);
  for (const kind of ['claim', 'pr', 'review', 'reject', 'milestone'] as const)
    assert.equal(beamTier({ kind }, null), 'beam', kind);
  assert.equal(beamTier({ kind: 'merge' }, 'merge'), 'big');
  assert.equal(beamTier({ kind: 'milestone' }, 'rung'), 'big');
  assert.equal(beamTier({ kind: 'rating', delta: 81 }, 'rating'), 'big');
  assert.equal(beamTier({ kind: 'rating', delta: 0 }, null), 'none', 'no change, no beam');
});

test('a burst of 50 game results fires no beams at all', () => {
  const burst = Array.from({ length: 50 }, (_, i) => ({
    at: i * 70,
    kind: 'result' as const,
    sector: 'chess',
  }));
  assert.equal(play(burst).fired.length, 0);
});

test('a burst of 50 reserved events fires a handful of beams that carry all 50', () => {
  const kinds: SwarmEventKind[] = ['claim', 'pr', 'review', 'milestone'];
  const sectors = ['chess', 'go9', 'hex', 'othello'];
  const burst = Array.from({ length: 50 }, (_, i) => ({
    at: i * 70,
    kind: kinds[i % kinds.length],
    sector: sectors[(i * 7) % sectors.length],
  }));
  const { fired, maxInFlight, folded, gate } = play(burst);
  assert.ok(fired.length >= 2 && fired.length <= 10, `a handful, not 50: ${fired.length}`);
  assert.ok(maxInFlight <= 2, `at most 2 in flight: ${maxInFlight}`);
  for (let i = 1; i < fired.length; i++)
    assert.ok(fired[i].at - fired[i - 1].at >= 400, 'at most one new beam per 400 ms');
  // Each fired beam carries the events held for it; others folded into a beam in flight.
  const carried = fired.reduce((n, b) => n + b.count, 0) + folded + gate.held();
  assert.equal(carried, 50, 'nothing is lost: every event rides a beam or waits for the next');
});

test('the same (sector, kind) within the window folds into one beam with a count', () => {
  const gate = createBeamGate();
  const first = gate.offer('chess|milestone', 0, 900);
  assert.ok(first.fire);
  for (let t = 100; t < 1400; t += 100) {
    const o = gate.offer('chess|milestone', t, 900);
    assert.deepEqual(o, { fire: false, into: first.fire ? first.id : -1 });
  }
  assert.equal(gate.count(first.fire ? first.id : -1), 14);
  // Past the window, the same key may beam again.
  assert.ok(gate.offer('chess|milestone', 1600, 900).fire);
});

test('over the cap, events fold into the next beam that fires', () => {
  const gate = createBeamGate({ maxInFlight: 2, minGapMs: 400 });
  assert.ok(gate.offer('a|claim', 0, 5000).fire);
  assert.ok(gate.offer('b|claim', 400, 5000).fire);
  assert.deepEqual(gate.offer('c|claim', 800, 5000), { fire: false, into: null });
  assert.deepEqual(gate.offer('d|claim', 900, 5000), { fire: false, into: null });
  assert.equal(gate.inFlight(900), 2);
  const next = gate.offer('e|claim', 5000, 900);
  assert.ok(next.fire && next.count === 3, 'carries the two held events and its own');
  assert.equal(gate.held(), 0);
});

test('the gap cap holds even with nothing in flight; reset forgets everything', () => {
  const gate = createBeamGate();
  assert.ok(gate.offer('a|pr', 0, 100).fire);
  assert.equal(gate.offer('b|pr', 300, 100).fire, false, 'within 400 ms');
  assert.ok(gate.offer('c|pr', 400, 100).fire);
  gate.reset();
  assert.equal(gate.held(), 0);
  assert.ok(gate.offer('c|pr', 401, 100).fire, 'a seek starts a fresh budget');
});

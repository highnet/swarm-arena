import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createActivity,
  createParticlePool,
  createQuality,
  emitComet,
  emitEmbers,
  emitMergeBurst,
  emitRatingFountain,
  emitShockwave,
  fade,
  SHAPE,
} from './effects';

const white = { r: 1, g: 1, b: 1 };
/** A fixed sequence, so emitters are deterministic in tests. */
const seq = () => {
  let i = 0;
  return () => (i++ * 0.618034) % 1;
};

test('the pool is capped, reuses its arrays and retires the dead', () => {
  const pool = createParticlePool(100);
  const arrays = [pool.position, pool.color, pool.extra];
  emitMergeBurst(pool, 0, 0, 20, white, 500, seq());
  assert.equal(pool.count, 100, 'never more than the capacity');
  for (let i = 0; i < 200; i++) pool.step(16);
  assert.equal(pool.count, 0, 'all retired after their life');
  emitMergeBurst(pool, 0, 0, 20, white, 30, seq());
  assert.equal(pool.count, 30);
  assert.deepEqual([pool.position, pool.color, pool.extra], arrays, 'same buffers: no allocation');
});

test('a limit below the capacity sheds particles at once and caps new ones', () => {
  const pool = createParticlePool(100);
  emitShockwave(pool, 0, 0, 10, white, 80, seq());
  pool.setLimit(25);
  assert.equal(pool.count, 25);
  assert.equal(emitComet(pool, 0, 0, white, 2), false);
  pool.setLimit(1000);
  assert.equal(pool.limit, 100, 'the limit never exceeds the capacity');
});

test('the live set stays packed when particles die out of order', () => {
  const pool = createParticlePool(10);
  const p = pool.spec();
  for (const life of [100, 1000, 100, 1000]) {
    p.life = life;
    p.x = life;
    pool.emit({ ...p });
  }
  pool.step(50);
  pool.step(60);
  assert.equal(pool.count, 2);
  assert.equal(pool.position[0], 1000);
  assert.equal(pool.position[3], 1000);
});

test('a merge spray flies out and settles back into its node', () => {
  const pool = createParticlePool(200);
  emitMergeBurst(pool, 100, 50, 20, white, 40, seq());
  const dist = () => {
    let m = 0;
    for (let i = 0; i < pool.count; i++)
      m += Math.hypot(pool.position[i * 3] - 100, pool.position[i * 3 + 1] - 50);
    return m / pool.count;
  };
  for (let i = 0; i < 8; i++) pool.step(16);
  const out = dist();
  for (let i = 0; i < 32; i++) pool.step(16);
  assert.ok(out > 20, `sprays out (${out.toFixed(1)} px)`);
  assert.ok(dist() < out, 'then settles back');
});

test('a rating rise fountains upward, sized by the delta', () => {
  const small = createParticlePool(500);
  const big = createParticlePool(500);
  emitRatingFountain(small, 0, 0, 20, white, 10, seq());
  emitRatingFountain(big, 0, 0, 20, white, 120, seq());
  assert.ok(big.count > small.count);
  big.step(100);
  let up = 0;
  for (let i = 0; i < big.count; i++) if (big.position[i * 3 + 1] < -12) up++;
  assert.ok(up > big.count * 0.8, 'most rise (y up is negative)');
});

test('a shockwave carries one ring sprite that grows', () => {
  const pool = createParticlePool(200);
  emitShockwave(pool, 0, 0, 20, white, 30, seq());
  assert.equal(pool.extra[1], SHAPE.ring);
  const before = pool.extra[0];
  pool.step(300);
  assert.ok(pool.extra[0] > before);
});

test('embers drift up slowly and include spinning shards', () => {
  const pool = createParticlePool(200);
  emitEmbers(pool, 0, 0, 10, white, seq());
  let shards = 0;
  for (let i = 0; i < pool.count; i++) if (pool.extra[i * 4 + 1] === SHAPE.shard) shards++;
  assert.equal(shards, 8);
  const y0 = pool.position[1];
  pool.step(500);
  assert.ok(pool.position[1] < y0, 'rises');
  assert.ok(y0 - pool.position[1] < 30, 'gently');
});

test('opacity rises fast and fades out, zero at both ends', () => {
  assert.equal(fade(0), 0);
  assert.equal(fade(1), 0);
  assert.ok(fade(0.08) > 0.99);
  assert.ok(fade(0.5) > fade(0.9));
});

test('quality steps down when frames slip and back up only after a long fast run', () => {
  const q = createQuality();
  assert.equal(q.level, 'high');
  for (let i = 0; i < 200; i++) q.sample(33);
  assert.equal(q.level, 'low', 'two steps down at 30 fps');
  for (let i = 0; i < 100; i++) q.sample(8);
  assert.equal(q.level, 'low', 'hysteresis: not straight back up');
  for (let i = 0; i < 700; i++) q.sample(8);
  assert.equal(q.level, 'high');
  q.sample(5000);
  assert.equal(q.level, 'high', 'a stalled frame (hidden tab) is ignored');
});

test('quality respects its maximum', () => {
  const q = createQuality({ max: 'medium' });
  assert.equal(q.level, 'medium');
  for (let i = 0; i < 1000; i++) q.sample(8);
  assert.equal(q.level, 'medium');
  q.setMax('low');
  assert.equal(q.level, 'low');
});

test('activity rises with events and decays with a half-life', () => {
  const a = createActivity(1000, 4);
  assert.equal(a.level('s'), 0);
  a.bump('s', 4);
  assert.equal(a.level('s'), 0.5);
  a.decay(1000);
  assert.ok(Math.abs(a.level('s') - 2 / 6) < 1e-9);
  a.decay(60_000);
  assert.equal(a.level('s'), 0);
});

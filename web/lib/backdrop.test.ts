/**
 * The homepage backdrop's geometry (#234): four recognisable boards, motes that cross between
 * them as a pure function of time, a slow drift, and nothing fetched from the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DRIFT_MS,
  HOP_MS,
  MOTES,
  boards,
  driftAngle,
  motePosition,
  stopBoard,
} from './backdrop';

const WEB = join(import.meta.dirname, '..');

test('one board per game, in series order, with the cells each game is played on', () => {
  const b = boards();
  assert.deepEqual(
    b.map((s) => s.slot),
    [0, 1, 2, 3],
  );
  assert.equal(b[0].quads.length, 32, 'chess fills the 32 dark squares');
  assert.equal(b[0].anchors.length, 64);
  assert.equal(b[1].anchors.length, 81, 'go is played on 9×9 intersections');
  assert.equal(b[2].anchors.length, 64);
  assert.equal(b[3].anchors.length, 121, 'hex is an 11×11 rhombus');
  for (const s of b) {
    assert.equal(s.lines.length % 6, 0, 'lines are whole segments');
    assert.ok(s.lines.every(Number.isFinite));
  }
});

test('boards lie flat on one floor and do not overlap', () => {
  const b = boards();
  for (const s of b) for (let i = 1; i < s.lines.length; i += 3) assert.equal(s.lines[i], 0);
  const centre = (i: number) => {
    const a = b[i].anchors;
    return [a.reduce((t, p) => t + p[0], 0) / a.length, a.reduce((t, p) => t + p[2], 0) / a.length];
  };
  for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++) {
      const [x0, z0] = centre(i);
      const [x1, z1] = centre(j);
      assert.ok(Math.hypot(x1 - x0, z1 - z0) > 9, `boards ${i} and ${j} are apart`);
    }
});

test('each hop carries a mote from one game to the next', () => {
  for (let m = 0; m < MOTES; m++)
    for (let k = 0; k < 50; k++) assert.notEqual(stopBoard(4, m, k), stopBoard(4, m, k + 1));
});

test('motes are a pure function of time, rest on cells and rise between boards', () => {
  const b = boards();
  const t = 3.21 * HOP_MS;
  assert.deepEqual(motePosition(b, 2, t), motePosition(b, 2, t));
  for (let m = 0; m < MOTES; m++) {
    // At rest (late in a hop) a mote sits just above a cell of some board.
    const rest = motePosition(b, m, (5 - m / MOTES + 0.9) * HOP_MS);
    assert.ok(rest[1] < 0.1);
    assert.ok(b.some((s) => s.anchors.some((a) => a[0] === rest[0] && a[2] === rest[2])));
    // Mid-flight it is off the floor.
    const flight = motePosition(b, m, (5 - m / MOTES + 0.3) * HOP_MS);
    assert.ok(flight[1] > 0.1);
  }
  // A long session (a day) stays finite and cheap.
  assert.ok(motePosition(b, 0, 86_400_000).every(Number.isFinite));
});

test('motion is very slow: one drift takes a minute or more, and it is small', () => {
  assert.ok(DRIFT_MS >= 60_000);
  assert.ok(HOP_MS >= 10_000);
  let max = 0;
  for (let t = 0; t < DRIFT_MS; t += 500) max = Math.max(max, Math.abs(driftAngle(t)));
  assert.ok(max <= 0.1, `sway stays within ${max.toFixed(3)} rad`);
});

test('the backdrop fetches nothing and plays no sound', () => {
  for (const f of [
    'lib/backdrop.ts',
    'components/arena/HomeBackdrop.tsx',
    'components/arena/HomeBackdropScene.tsx',
  ]) {
    const src = readFileSync(join(WEB, f), 'utf8');
    assert.doesNotMatch(
      src,
      /\bfetch\(|TextureLoader|GLTFLoader|new Audio|AudioContext|https?:\/\//,
    );
  }
});

test('the backdrop mounts on the homepage only, and other routes keep their scene', () => {
  const home = readFileSync(join(WEB, 'app/page.tsx'), 'utf8');
  assert.match(home, /<HomeBackdrop \/>/);
  const scene = readFileSync(join(WEB, 'components/arena/SceneBackground.tsx'), 'utf8');
  assert.match(scene, /CALM_PAGES = new Set\(\['\/'\]\)/);
});

/**
 * Geometry for the homepage backdrop (issue #234): the four boards lying on one floor at
 * different depths, and a few motes that travel between them. Pure data, no three.js, so the
 * WebGL scene and its static SVG fallback draw the same picture and tests can check it.
 *
 * Coordinates: x to the right, y up, z towards the viewer. Boards lie flat (y = 0).
 */

export type Vec3 = [number, number, number];

/** One board: hairlines as segment pairs, optional filled quads, and the points motes visit. */
export type BoardShape = {
  /** Series slot (0 chess, 1 go9, 2 othello, 3 hex), read from `--series-<slot+1>`. */
  slot: number;
  /** Flat list of segment endpoints: x0 y0 z0 x1 y1 z1 … */
  lines: number[];
  /** Quads as four corners each (chess squares). */
  quads: Vec3[][];
  /** Cell centres or intersections, in world space. */
  anchors: Vec3[];
};

/** Where each board lies: x, z and a yaw (radians). Near boards right, far ones across. */
export const LAYOUT: { x: number; z: number; yaw: number }[] = [
  { x: 12.5, z: -11, yaw: 0.32 },
  { x: 0, z: -21, yaw: -0.22 },
  { x: 20, z: -24, yaw: 0.12 },
  { x: 10, z: -34, yaw: -0.38 },
];

/** One full drift of the field, and one hop of a mote (travel then rest), in milliseconds. */
export const DRIFT_MS = 120_000;
export const HOP_MS = 24_000;
const TRAVEL_SHARE = 0.65;
export const MOTES = 5;

/** Deterministic, so every visit and the fallback draw the same scene. */
export const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const place = (p: Vec3, slot: number): Vec3 => {
  const { x, z, yaw } = LAYOUT[slot];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + p[0] * c + p[2] * s, p[1], z - p[0] * s + p[2] * c];
};

const ring = (cx: number, cz: number, r: number, n: number): Vec3[] => {
  const out: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = (2 * Math.PI * k) / n;
    const a1 = (2 * Math.PI * (k + 1)) / n;
    out.push([cx + r * Math.cos(a0), 0, cz + r * Math.sin(a0)]);
    out.push([cx + r * Math.cos(a1), 0, cz + r * Math.sin(a1)]);
  }
  return out;
};

/** `n` lines each way across a square of side `size`, centred. */
const grid = (n: number, size: number): Vec3[] => {
  const out: Vec3[] = [];
  const h = size / 2;
  for (let i = 0; i < n; i++) {
    const v = -h + (size * i) / (n - 1);
    out.push([v, 0, -h], [v, 0, h], [-h, 0, v], [h, 0, v]);
  }
  return out;
};

const build = (slot: number, local: Vec3[], quads: Vec3[][], anchors: Vec3[]): BoardShape => ({
  slot,
  lines: local.flatMap((p) => place(p, slot)),
  quads: quads.map((q) => q.map((p) => place(p, slot))),
  anchors: anchors.map((p) => place(p, slot)),
});

const cells = (n: number, size: number): Vec3[] => {
  const out: Vec3[] = [];
  const step = size / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      out.push([-size / 2 + step * (i + 0.5), 0, -size / 2 + step * (j + 0.5)]);
  return out;
};

/** Chess: an 8×8 frame with the dark squares filled. */
const chess = (): BoardShape => {
  const quads: Vec3[][] = [];
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++)
      if ((i + j) % 2 === 1) {
        const x = i - 4;
        const z = j - 4;
        quads.push([
          [x, 0, z],
          [x + 1, 0, z],
          [x + 1, 0, z + 1],
          [x, 0, z + 1],
        ]);
      }
  return build(0, grid(9, 8), quads, cells(8, 8));
};

/** Go: nine lines each way and the five star points. */
const go = (): BoardShape => {
  const lines = grid(9, 8);
  for (const [x, z] of [
    [-2, -2],
    [2, -2],
    [0, 0],
    [-2, 2],
    [2, 2],
  ])
    lines.push(...ring(x, z, 0.12, 8));
  const anchors: Vec3[] = [];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) anchors.push([i - 4, 0, j - 4]);
  return build(1, lines, [], anchors);
};

/** Othello: an 8×8 frame and the four discs it opens with. */
const othello = (): BoardShape => {
  const lines = grid(9, 8);
  for (const [x, z] of [
    [-0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
    [0.5, -0.5],
  ])
    lines.push(...ring(x, z, 0.38, 20));
  return build(2, lines, [], cells(8, 8));
};

/** Hex: an 11×11 rhombus of hexagons, centred. */
const hex = (): BoardShape => {
  const r = 0.3;
  const w = Math.sqrt(3) * r;
  const lines: Vec3[] = [];
  const anchors: Vec3[] = [];
  const ox = (10 + 5) * w * 0.5;
  const oz = 10 * 1.5 * r * 0.5;
  for (let q = 0; q < 11; q++)
    for (let s = 0; s < 11; s++) {
      const cx = (q + s / 2) * w - ox;
      const cz = s * 1.5 * r - oz;
      anchors.push([cx, 0, cz]);
      for (let k = 0; k < 6; k++) {
        const a0 = (Math.PI / 3) * k + Math.PI / 6;
        const a1 = a0 + Math.PI / 3;
        lines.push(
          [cx + r * Math.cos(a0), 0, cz + r * Math.sin(a0)],
          [cx + r * Math.cos(a1), 0, cz + r * Math.sin(a1)],
        );
      }
    }
  return build(3, lines, [], anchors);
};

export const boards = (): BoardShape[] => [chess(), go(), othello(), hex()];

const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * The board a mote rests on during hop `k`: each mote visits the four games in turn, so every
 * hop crosses from one game to the next, the way an idea is carried across the four.
 */
export const stopBoard = (n: number, mote: number, k: number) => (mote + k) % n;

/** The anchor a mote rests on during hop `k`: a seeded cell of that hop's board. */
const stop = (shapes: BoardShape[], mote: number, k: number) => {
  const rand = mulberry(mote * 7919 + k * 104729 + 17);
  const a = shapes[stopBoard(shapes.length, mote, k)].anchors;
  return a[Math.floor(rand() * a.length)];
};

/**
 * Where mote `m` is at time `t` (ms): resting on one board's cell, then rising in a low arc and
 * settling on a cell of another board. A pure function of time, so a paused scene resumes where
 * the clock says and a still frame is reproducible.
 */
export const motePosition = (shapes: BoardShape[], m: number, t: number): Vec3 => {
  const phase = t / HOP_MS + m / MOTES;
  const k = Math.max(0, Math.floor(phase));
  const u = phase - k;
  const from = stop(shapes, m, k);
  const to = stop(shapes, m, k + 1);
  const travel = Math.min(1, u / TRAVEL_SHARE);
  if (u >= TRAVEL_SHARE) return [to[0], 0.08, to[2]];
  const e = smooth(travel);
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const lift = 0.08 + Math.sin(Math.PI * e) * Math.min(3, 0.18 * Math.hypot(dx, dz));
  return [from[0] + dx * e, lift, from[2] + dz * e];
};

/** The field's slow sway about the vertical axis, in radians, at time `t` (ms). */
export const driftAngle = (t: number) => 0.06 * Math.sin((2 * Math.PI * t) / DRIFT_MS);

/** Camera framing for a viewport: narrow screens step back and centre the field. */
export const framing = (width: number, height: number) => {
  const narrow = width < 768;
  return {
    fov: 36,
    position: (narrow ? [8, 20, 12] : [2, 11, 10]) as Vec3,
    target: (narrow ? [10, 0, -26] : [7, 0, -18]) as Vec3,
    aspect: width / Math.max(1, height),
    fogNear: narrow ? 22 : 16,
    fogFar: narrow ? 64 : 58,
  };
};

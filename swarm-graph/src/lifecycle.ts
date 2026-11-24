/**
 * Nodes arriving on and leaving the live graph, as pure timing. The same easing family as the
 * radial intro (`intro.ts`), so the intro, arrivals and departures read as one system.
 *
 * Arriving: a node starts at its parent (the sector or agent it belongs to), at 40% size and
 * transparent, and grows and glides out to its place with an ease-out; its label follows just
 * after the circle and its edges draw on from the parent end.
 *
 * Leaving: over about 1.8 s with an ease-in-out, the node's opacity goes to 0 and its radius to
 * 60%; its label fades a little ahead of the circle, its edges thin and fade at the circle's rate.
 * Only then does it leave the simulation.
 */

import { easeOut } from './intro';

export const ARRIVAL = {
  durationMs: 1300,
  staggerMs: 120,
  /** Stagger steps at most; a big burst shares the last one. */
  maxSteps: 12,
  startScale: 0.4,
  /** The label starts once the circle is this far along. */
  labelLag: 0.25,
  /** Simulation alpha for taking the new nodes in. */
  alpha: 0.06,
} as const;

export const DEPARTURE = {
  durationMs: 1800,
  staggerMs: 150,
  maxSteps: 12,
  endScale: 0.6,
  /** The label is gone by this point of the circle's fade. */
  labelLead: 0.7,
  /** Simulation alpha for easing the others into the freed space. */
  alpha: 0.05,
} as const;

const clamp = (p: number) => Math.max(0, Math.min(1, p));

/** Ease-in-out cubic: a soft start and a soft landing. */
export const easeInOut = (p: number): number => {
  const x = clamp(p);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** When the i-th of a batch starts, in ms after the batch. */
export const staggerAt = (i: number, step: number, maxSteps: number) =>
  Math.min(i, maxSteps) * step;

/** Raw progress `t` ms after a tween that starts at `delay` and lasts `duration`. */
export const progressAt = (t: number, delay: number, duration: number) =>
  duration <= 0 ? (t >= delay ? 1 : 0) : clamp((t - delay) / duration);

export type Pose = {
  /** 0 at the start point (the parent, or where the node stood), 1 at the end. */
  travel: number;
  scale: number;
  opacity: number;
  label: number;
  /** Edge visibility: how much is drawn (arriving) or its opacity and width factor (leaving). */
  edge: number;
};

export const arrivalPose = (p: number): Pose => {
  const e = easeOut(p);
  return {
    travel: e,
    scale: ARRIVAL.startScale + (1 - ARRIVAL.startScale) * e,
    opacity: e,
    label: easeOut((clamp(p) - ARRIVAL.labelLag) / (1 - ARRIVAL.labelLag)),
    edge: e,
  };
};

export const departurePose = (p: number): Pose => {
  const e = easeInOut(p);
  return {
    travel: 0,
    scale: 1 - (1 - DEPARTURE.endScale) * e,
    opacity: 1 - e,
    label: 1 - easeInOut(clamp(p) / DEPARTURE.labelLead),
    edge: 1 - e,
  };
};

/**
 * Where an arriving node glides to: just outside its parent, towards the place the layout pulls
 * it (`toward`), so the simulation takes over from about where it would settle.
 */
export const arrivalTarget = (
  parent: { x: number; y: number; r: number },
  toward: { x: number; y: number },
  r: number,
  spin = 0,
): { x: number; y: number } => {
  let dx = toward.x - parent.x;
  let dy = toward.y - parent.y;
  if (Math.hypot(dx, dy) < 1) {
    // No pull away from the parent: head outward from the hub's side.
    dx = parent.x || 1;
    dy = parent.y;
  }
  const a = Math.atan2(dy, dx) + spin;
  const d = parent.r + r + 26;
  return { x: parent.x + Math.cos(a) * d, y: parent.y + Math.sin(a) * d };
};

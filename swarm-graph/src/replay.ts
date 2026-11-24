/**
 * Replay planning: pure, framework-free, game-agnostic. A host picks a window of a graph's
 * flows (the last 24 actively worked hours, or the whole run), seeds the state the graph had
 * when the window opens, and gets a schedule that plays the window back in about a minute.
 *
 * Active time: a gap between two consecutive events longer than the idle threshold counts as
 * at most that threshold, so an overnight pause or a stopped loop does not eat the window.
 */
import { sectorNodeId, type SwarmFlow } from './model';

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const DEFAULT_ACTIVE_MS = 24 * HOUR;
export const DEFAULT_IDLE_MS = 15 * MINUTE;

const timeOf = (f: SwarmFlow) => Date.parse(f.at);

/** A pause between two events longer than the idle threshold. */
export type SwarmIdleGap = {
  /** Index (in the window's flows) of the event after the pause. */
  index: number;
  /** Its real length in milliseconds. */
  ms: number;
};

export type SwarmActiveWindow = {
  /** Index into the flows of the first event in the window. */
  start: number;
  /** Active time the window covers (gaps capped at the idle threshold). */
  activeMs: number;
  /** Idle pauses inside the window, indexed relative to `start`. */
  gaps: SwarmIdleGap[];
};

/**
 * The window of the last `activeMs` of active time, walking back from the newest event. The
 * replay starts at the earliest event that keeps the active time within `activeMs`. An empty or
 * short history gives the whole of it (`start` 0).
 */
export const activeWindow = (
  flows: SwarmFlow[],
  activeMs = DEFAULT_ACTIVE_MS,
  idleMs = DEFAULT_IDLE_MS,
): SwarmActiveWindow => {
  let start = flows.length ? flows.length - 1 : 0;
  let active = 0;
  for (let i = flows.length - 1; i > 0; i--) {
    const gap = Math.max(0, timeOf(flows[i]) - timeOf(flows[i - 1]));
    const counted = Math.min(gap, idleMs);
    if (active + counted > activeMs) break;
    active += counted;
    start = i - 1;
  }
  const gaps: SwarmIdleGap[] = [];
  for (let i = start + 1; i < flows.length; i++) {
    const ms = timeOf(flows[i]) - timeOf(flows[i - 1]);
    if (ms > idleMs) gaps.push({ index: i - start, ms });
  }
  return { start, activeMs: active, gaps };
};

/** What the graph shows at a moment of a replay: effort per node, ratings, tallies. */
export type SwarmReplaySnapshot = {
  /** Effort landed per node id (sectors and the hub). */
  effort: Record<string, number>;
  /** Sum of rating deltas per sector id. */
  rating: Record<string, number>;
  merges: number;
  milestones: number;
  rejects: number;
  events: number;
};

export const emptySnapshot = (): SwarmReplaySnapshot => ({
  effort: {},
  rating: {},
  merges: 0,
  milestones: 0,
  rejects: 0,
  events: 0,
});

const cloneSnapshot = (s: SwarmReplaySnapshot): SwarmReplaySnapshot => ({
  ...s,
  effort: { ...s.effort },
  rating: { ...s.rating },
});

/** One event onto a snapshot (mutates it): what landing that event adds. */
export const applyFlow = (s: SwarmReplaySnapshot, f: SwarmFlow, hubId: string) => {
  s.events++;
  if (f.sector) {
    const id = sectorNodeId(f.sector);
    s.effort[id] = (s.effort[id] ?? 0) + f.weight;
  }
  if (f.kind === 'merge') {
    s.effort[hubId] = (s.effort[hubId] ?? 0) + f.weight;
    s.merges++;
  }
  if (f.kind === 'milestone') s.milestones++;
  if (f.kind === 'reject') s.rejects++;
  if (f.kind === 'rating' && f.sector && f.delta)
    s.rating[f.sector] = (s.rating[f.sector] ?? 0) + f.delta;
  return s;
};

/** The state after the first `index` of `flows` have landed on top of `seed`. Pure. */
export const stateAt = (
  seed: SwarmReplaySnapshot,
  flows: SwarmFlow[],
  index: number,
  hubId: string,
): SwarmReplaySnapshot => {
  const s = cloneSnapshot(seed);
  const end = Math.max(0, Math.min(index, flows.length));
  for (let i = 0; i < end; i++) applyFlow(s, flows[i], hubId);
  return s;
};

/** Events a replay dwells on: merges, rungs and matches decided, rating changes. */
export const isMilestone = (f: SwarmFlow) =>
  f.kind === 'merge' || f.kind === 'milestone' || (f.kind === 'rating' && Boolean(f.delta));

export type SwarmReplayMode = 'window' | 'all';

export type SwarmReplayPlanOptions = {
  mode?: SwarmReplayMode;
  /** Playback length. Default 60 s. */
  durationMs?: number;
  activeMs?: number;
  idleMs?: number;
  /** Time a squeezed idle gap takes on screen. Default 450 ms. */
  beatMs?: number;
  /** Extra hold after a milestone. Default 500 ms. */
  holdMs?: number;
  /** Which events the replay dwells on. Default `isMilestone`. */
  isMilestone?: (f: SwarmFlow) => boolean;
};

export type SwarmReplayPlan = {
  mode: SwarmReplayMode;
  hubId: string;
  /** The window's flows, in time order. */
  flows: SwarmFlow[];
  /** The state before the window's first event. */
  seed: SwarmReplaySnapshot;
  /** Playback offset (ms) at which each flow fires. */
  times: number[];
  /** Whole playback length, ms. */
  total: number;
  /** Squeezed idle pauses, indexed into `flows`. */
  gaps: SwarmIdleGap[];
  /** Indexes into `flows` of milestones. */
  milestones: number[];
  startAt: string | null;
  endAt: string | null;
};

/**
 * Plan a replay: pick the window, seed the state before it, and schedule its events. Routine
 * events share time in proportion to their (capped) real gaps; the step into a milestone
 * slows down and a milestone holds briefly; an idle gap is a short beat.
 */
export const planReplay = (
  flows: SwarmFlow[],
  hubId: string,
  options: SwarmReplayPlanOptions = {},
): SwarmReplayPlan => {
  const mode = options.mode ?? 'window';
  const durationMs = options.durationMs ?? 60_000;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const beatMs = options.beatMs ?? 450;
  const holdMs = options.holdMs ?? 500;
  const win =
    mode === 'window'
      ? activeWindow(flows, options.activeMs ?? DEFAULT_ACTIVE_MS, idleMs)
      : activeWindow(flows, Number.POSITIVE_INFINITY, idleMs);
  const shown = flows.slice(win.start);
  const seed = stateAt(emptySnapshot(), flows, win.start, hubId);
  const dwell = options.isMilestone ?? isMilestone;
  const milestones = shown.flatMap((f, i) => (dwell(f) ? [i] : []));
  const isMs = new Set(milestones);
  const gapAt = new Set(win.gaps.map((g) => g.index));

  // Fixed costs first (beats, holds, a floor per event), then real time shares the rest.
  const floor = 30;
  let fixed = 0;
  const weight: number[] = shown.map((f, i) => {
    if (i === 0) return 0;
    if (gapAt.has(i)) {
      fixed += beatMs;
      return 0;
    }
    fixed += floor;
    const gap = Math.max(0, Date.parse(f.at) - Date.parse(shown[i - 1].at));
    return Math.min(gap, idleMs) * (isMs.has(i) ? 3 : 1);
  });
  fixed += milestones.length * holdMs;
  const budget = Math.max(0, durationMs - 1500 - fixed);
  const span = weight.reduce((a, b) => a + b, 0);
  // Without fixed room to spare, everything scales down together.
  const squeeze = fixed > durationMs - 1500 && fixed > 0 ? (durationMs - 1500) / fixed : 1;
  const times: number[] = [];
  let at = 0;
  shown.forEach((_, i) => {
    if (i > 0) {
      const share = span > 0 ? (weight[i] / span) * budget : budget / Math.max(1, shown.length);
      const step = gapAt.has(i) ? beatMs : floor + share;
      at += step * squeeze + (isMs.has(i - 1) ? holdMs * squeeze : 0);
    }
    times.push(at);
  });
  const total = (times.at(-1) ?? 0) + (isMs.has(shown.length - 1) ? holdMs : 0) + 1500;

  return {
    mode,
    hubId,
    flows: shown,
    seed,
    times,
    total,
    gaps: win.gaps,
    milestones,
    startAt: shown[0]?.at ?? null,
    endAt: shown.at(-1)?.at ?? null,
  };
};

/** The playback offset → how many events have fired by then (binary search). */
export const indexAtTime = (plan: SwarmReplayPlan, ms: number) => {
  let lo = 0;
  let hi = plan.times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (plan.times[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** What changed over the whole window, for the end card. */
export type SwarmReplaySummary = {
  events: number;
  merges: number;
  /** Events the plan dwelt on. */
  milestones: number;
  /** Rating changes (versions rated). */
  ratings: number;
  rejects: number;
  /** Rating change per sector over the window. */
  rating: Record<string, number>;
};

export const summarizeReplay = (plan: SwarmReplayPlan): SwarmReplaySummary => {
  const end = stateAt(emptySnapshot(), plan.flows, plan.flows.length, plan.hubId);
  return {
    events: end.events,
    merges: end.merges,
    milestones: plan.milestones.length,
    ratings: plan.flows.filter((f) => f.kind === 'rating' && f.delta).length,
    rejects: end.rejects,
    rating: end.rating,
  };
};

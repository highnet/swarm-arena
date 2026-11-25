/**
 * Replay planning: pure, framework-free, game-agnostic. A host picks a window of a graph's
 * flows (the last 24 actively worked hours, or the whole run), seeds the state the graph had
 * when the window opens, and gets a schedule that plays the window back in about a minute.
 *
 * Active time: a gap between two consecutive events longer than the idle threshold counts as
 * at most that threshold, so an overnight pause or a stopped loop does not eat the window.
 */
import {
  lifeOf,
  sectorNodeId,
  type SwarmAgent,
  type SwarmFlow,
  type SwarmLifetimes,
} from './model';

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
  /**
   * Step between the events of one burst (the games of a match, say: flows sharing a `group`
   * back to back). A burst plays as one beat, as the live graph coalesces it. Default 70 ms.
   */
  burstStepMs?: number;
  /**
   * The live graph's `lifetimes` (`LIFETIMES` for the preset). Given, the plan carries each
   * agent's and work item's presence (`presence`, `presentAt`): the replay opens with only what
   * was active at the window's start, and the rest spawn at their first flow in the window and
   * leave when their lifetime ends (#279). Absent, there is no presence and every node shows.
   */
  lifetimes?: SwarmLifetimes | null;
  /** The live graph's liveness rule (`SwarmGraphOptions.isLive`), asked at the playhead's time. */
  isLive?: ((agent: SwarmAgent, nowMs: number) => boolean) | null;
};

/**
 * When an agent or work node is on the replay's graph. Built from the flows alone: a node is
 * active from a flow that touches it (it is on the flow's path) and stays while the live graph's
 * rule would keep it, measured from its last touch.
 */
export type SwarmReplayPresence = {
  lifetimes: SwarmLifetimes;
  isLive: ((agent: SwarmAgent, nowMs: number) => boolean) | null;
  /** The window's opening time, ms: frame one is judged at this clock. */
  startMs: number;
  /** Per node id: its last touch before the window (ms), if it had one. */
  before: Record<string, number>;
  /** Per node id: the indexes (into the window's flows) of the flows that touch it, in order. */
  touches: Record<string, number[]>;
  /** Work node ids merged by a flow, with the index of that flow (-1: before the window). */
  closedAt: Record<string, number>;
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
  /**
   * For each flow, the index of the first flow of the burst it belongs to (flows sharing a
   * `group` back to back), or -1 when it is not part of one. A burst's first flow points at
   * itself. Renderers spark a burst sparingly and land its last flow.
   */
  burst: number[];
  startAt: string | null;
  endAt: string | null;
  /** Agent and work node presence through the window; null without `lifetimes` (all shown). */
  presence: SwarmReplayPresence | null;
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
  const burst = burstsOf(shown);
  const burstStep = options.burstStepMs ?? 70;
  /** A burst's later events (not milestones, not after an idle gap) ride on its first beat. */
  const rides = (i: number) => burst[i] >= 0 && burst[i] < i && !isMs.has(i) && !gapAt.has(i);

  // Fixed costs first (beats, holds, a floor per event), then real time shares the rest.
  const floor = 30;
  let fixed = 0;
  const weight: number[] = shown.map((f, i) => {
    if (i === 0) return 0;
    if (gapAt.has(i)) {
      fixed += beatMs;
      return 0;
    }
    if (rides(i)) {
      fixed += burstStep;
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
      const step = gapAt.has(i) ? beatMs : rides(i) ? burstStep : floor + share;
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
    burst,
    startAt: shown[0]?.at ?? null,
    endAt: shown.at(-1)?.at ?? null,
    presence: options.lifetimes
      ? presenceOf(flows, win.start, options.lifetimes, options.isLive ?? null)
      : null,
  };
};

/** Agents and work items come and go; sectors and the trunk are structural and always shown. */
const transient = (id: string) => id.startsWith('agent:') || id.startsWith('work:');

const presenceOf = (
  flows: SwarmFlow[],
  start: number,
  lifetimes: SwarmLifetimes,
  isLive: SwarmReplayPresence['isLive'],
): SwarmReplayPresence => {
  const before: Record<string, number> = {};
  const touches: Record<string, number[]> = {};
  const closedAt: Record<string, number> = {};
  flows.forEach((f, i) => {
    const at = timeOf(f);
    for (const id of new Set(f.path)) {
      if (!transient(id)) continue;
      if (i < start) before[id] = Math.max(before[id] ?? -Infinity, at);
      else (touches[id] ??= []).push(i - start);
      if (f.kind === 'merge' && id.startsWith('work:') && !(id in closedAt))
        closedAt[id] = i < start ? -1 : i - start;
    }
  });
  const startMs = flows[start] ? timeOf(flows[start]) : 0;
  return { lifetimes, isLive, startMs, before, touches, closedAt };
};

/**
 * Whether a node last touched at `touchedMs` is still on the graph at `nowMs`, by the live
 * graph's rules: an agent while it is live (its last touch as its last heartbeat, asked of the
 * host's `isLive`) or within `agentMs` of it; a work item within `closedMs` of its merge, or a
 * branch within `branchMs` of its last activity.
 */
const keeps = (
  p: SwarmReplayPresence,
  id: string,
  touchedMs: number,
  nowMs: number,
  closed: boolean,
) => {
  const dead = nowMs - touchedMs;
  const life = p.lifetimes;
  if (id.startsWith('agent:')) {
    const seat: SwarmAgent = {
      id: id.slice('agent:'.length),
      role: 'worker',
      status: 'working',
      sector: null,
      lastSeen: new Date(touchedMs).toISOString(),
    };
    if (p.isLive?.(seat, nowMs)) return true;
    return lifeOf(dead, life.agentMs, life.fadingMs) !== 'gone';
  }
  return lifeOf(dead, closed ? life.closedMs : life.branchMs, life.fadingMs) !== 'gone';
};

/**
 * The agent and work node ids on the graph once the first `index` flows of the window have
 * played, judged at the clock of the last one played (frame one: the window's start). Null when
 * the plan has no presence: every node shows. Sectors and the trunk are never in the set; they
 * are always shown.
 *
 * `lasting` names the nodes the live graph keeps for as long as they are open, with no lifetime
 * (open issues and pull requests): one is on from its first touch, before the window or in it,
 * and stays; one the flows never touch carries no time and is on throughout. Any other node the
 * flows never touch is not in the set.
 */
export const presentAt = (
  plan: Pick<SwarmReplayPlan, 'flows' | 'presence'>,
  index: number,
  lasting: ReadonlySet<string> = new Set(),
): Set<string> | null => {
  const p = plan.presence;
  if (!p) return null;
  const i = Math.max(0, Math.min(index, plan.flows.length));
  const nowMs = i > 0 ? timeOf(plan.flows[i - 1]) : p.startMs;
  const out = new Set<string>();
  const ids = new Set([...Object.keys(p.before), ...Object.keys(p.touches)]);
  for (const id of lasting) {
    if (!ids.has(id) || id in p.before || (p.touches[id]?.[0] ?? Infinity) < i) out.add(id);
  }
  for (const id of ids) {
    if (lasting.has(id)) continue;
    const list = p.touches[id] ?? [];
    // The last touch among the flows already played.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    const touchedMs = lo > 0 ? timeOf(plan.flows[list[lo - 1]]) : p.before[id];
    if (touchedMs === undefined) continue;
    const closed = id in p.closedAt && p.closedAt[id] < i;
    if (keeps(p, id, touchedMs, nowMs, closed)) out.add(id);
  }
  return out;
};

/**
 * Bursts: runs of consecutive flows that share a `group` id. Each flow maps to the index of its
 * run's first flow, or -1 when its run is a single flow (or it has no group).
 */
export const burstsOf = (flows: SwarmFlow[]): number[] => {
  const out = new Array<number>(flows.length).fill(-1);
  let i = 0;
  while (i < flows.length) {
    const id = flows[i].group?.id;
    let j = i + 1;
    if (id) while (j < flows.length && flows[j].group?.id === id) j++;
    if (j - i > 1) for (let k = i; k < j; k++) out[k] = i;
    i = j;
  }
  return out;
};

/** Whether the replay should spark flow `i` (a burst sparks its first, every fourth and last). */
export const sparksAt = (plan: Pick<SwarmReplayPlan, 'burst'>, i: number) => {
  const b = plan.burst[i] ?? -1;
  if (b < 0) return true;
  const last = plan.burst[i + 1] !== b;
  return last || (i - b) % 4 === 0;
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

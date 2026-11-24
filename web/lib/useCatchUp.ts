'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SwarmEvent } from '@rallypoint/swarm-graph';
import type { LiveChange } from '@/lib/liveBus';

/**
 * Catching up after the tab was hidden, or after a refresh that brought a big jump (a reconnect,
 * the polling fallback). Instead of snapping to the new state, the graph plays what it missed
 * back in order, quickly, the way a game replay does: each event is released onto the graph in
 * turn (so the renderer sparks it as new), and the Realtime rows held back meanwhile are applied
 * one by one (so ratings count up through each step and agent chips come and go in sequence).
 */

/** The whole playback fits in this long; whatever is left after it lands at once. */
export const CATCH_UP_MS = 5_000;
/** At most this many steps; older events beyond them land together, first. */
const STEPS = 40;
const STEP_MIN_MS = 90;
const STEP_MAX_MS = 450;
/** Steps aim to end this early; past the cap by as much, the rest lands at once. */
const SLACK_MS = 500;
/** A refresh that brings at least this many new events at once plays back instead of landing. */
const BIG_JUMP = 8;
/**
 * At most this many held rows (#197). Rows fold per key first (`holdKey`), so the queue is bounded
 * by the number of distinct things that changed, not by how long the tab was away; past the cap
 * the oldest go unplayed (the refresh on return brings their state in the snapshot anyway).
 */
export const HOLD_CAP = 400;

/**
 * The key a held row folds under: one per table and row id (a live game, a seat, a rating, a
 * work item), so a later row replaces an earlier one of the same thing. Rows without an id keep
 * their own slot.
 */
export const holdKey = (change: LiveChange, fallback: number) => {
  const id = change.new?.id ?? change.old?.id;
  return typeof id === 'string' || typeof id === 'number'
    ? `${change.table}:${id}`
    : `${change.table}#${fallback}`;
};

/**
 * Hold one row back: it replaces the held row of the same key and moves to the back (it is the
 * newest), and the oldest go once the cap is passed.
 */
export const holdRow = (
  held: Map<string, LiveChange>,
  change: LiveChange,
  fallback: number,
  cap = HOLD_CAP,
) => {
  const key = holdKey(change, fallback);
  held.delete(key);
  held.set(key, change);
  for (const k of held.keys()) {
    if (held.size <= cap) break;
    held.delete(k);
  }
};

/** Take the `n` oldest held rows out of the queue, in order. */
const takeHeld = (held: Map<string, LiveChange>, n: number) => {
  const out: LiveChange[] = [];
  for (const [k, change] of held) {
    if (out.length >= n) break;
    out.push(change);
    held.delete(k);
  }
  return out;
};

export type CatchUpBasis<I, E> = { input: I; engines: E };

export type CatchUp<I, E> = {
  /** `holding` while the tab is hidden; `draining` while the missed events play. */
  phase: 'holding' | 'draining';
  /** Event ids on screen; the rest wait their turn. */
  released: ReadonlySet<string>;
  /** Agents and ratings as they stood when the catch-up began. */
  basis: CatchUpBasis<I, E>;
  /** Events still to play (shown events plus held-back rows). */
  left: number;
};

type Seen<I, E> = {
  events: SwarmEvent[];
  ids: ReadonlySet<string>;
  /** A catch-up just ended: take the next graph as it is, with no jump check. */
  resync: boolean;
} & CatchUpBasis<I, E>;

type UseCatchUpArgs<I, E> = {
  /** Every event the graph knows, in time order, before the preset filter. */
  events: SwarmEvent[];
  /** Whether the current preset shows an event; only those are paced. */
  shows: (event: SwarmEvent) => boolean;
  input: I;
  engines: E;
  reducedMotion: boolean;
  /** Apply one Realtime change to the graph's live state. */
  apply: (change: LiveChange) => void;
  /** Called once a catch-up ends, with where it began (to count ratings up from there). */
  onFinish?: (basis: CatchUpBasis<I, E>) => void;
};

const idsOf = (events: SwarmEvent[]) => new Set(events.map((e) => e.id));

export const useCatchUp = <I, E>({
  events,
  shows,
  input,
  engines,
  reducedMotion,
  apply,
  onFinish,
}: UseCatchUpArgs<I, E>) => {
  const [catchUp, setCatchUpState] = useState<CatchUp<I, E> | null>(null);
  const current = useRef<CatchUp<I, E> | null>(null);
  const setCatchUp = useCallback((next: CatchUp<I, E> | null) => {
    current.current = next;
    setCatchUpState(next);
  }, []);
  /** Realtime rows that arrived while holding or draining, latest per key, oldest first. */
  const queue = useRef(new Map<string, LiveChange>());
  const arrivals = useRef(0);
  /** The next renderer update takes its new events without sparking them (a coalesced batch). */
  const quietNext = useRef(false);

  // What was on screen last, compared with each new graph (derived state, set during render so
  // a big jump never reaches the renderer in full).
  const [seen, setSeen] = useState<Seen<I, E>>(() => ({
    events,
    ids: idsOf(events),
    resync: false,
    input,
    engines,
  }));
  if (!catchUp && seen.resync)
    setSeen({ events, ids: idsOf(events), resync: false, input, engines });
  else if (seen.events !== events) {
    if (catchUp) setSeen({ ...seen, events });
    else {
      const fresh = events.filter((e) => !seen.ids.has(e.id) && shows(e)).length;
      if (fresh >= BIG_JUMP && !reducedMotion) {
        const next: CatchUp<I, E> = {
          phase: 'draining',
          released: seen.ids,
          basis: { input: seen.input, engines: seen.engines },
          left: fresh,
        };
        setCatchUpState(next);
        setSeen({ ...seen, events });
      } else setSeen({ events, ids: idsOf(events), resync: false, input, engines });
    }
  } else if (!catchUp && (seen.input !== input || seen.engines !== engines))
    setSeen({ ...seen, input, engines });

  // A catch-up a jump started during render reaches the timers here.
  useEffect(() => {
    current.current = catchUp;
  }, [catchUp]);

  // Timers and listeners read the latest render through a ref.
  const latest = useRef({ events, shows, input, engines, reducedMotion, apply, onFinish });
  useEffect(() => {
    latest.current = { events, shows, input, engines, reducedMotion, apply, onFinish };
  }, [events, shows, input, engines, reducedMotion, apply, onFinish]);

  /** Land everything left at once and go back to live. */
  const finish = useCallback(
    (quiet: boolean) => {
      const c = current.current;
      if (!c) return;
      const { apply: applyNow, onFinish: done } = latest.current;
      const held = [...queue.current.values()];
      queue.current = new Map();
      held.forEach(applyNow);
      quietNext.current = quiet;
      setCatchUp(null);
      // The render that applies the rows above becomes the new baseline.
      setSeen((s) => ({ ...s, resync: true }));
      done?.(c.basis);
    },
    [setCatchUp],
  );

  const skip = useCallback(() => finish(true), [finish]);

  /** Hold a Realtime row back while catching up; false means apply it now. */
  const offer = useCallback((change: LiveChange) => {
    if (!current.current) return false;
    holdRow(queue.current, change, arrivals.current++);
    return true;
  }, []);

  // Hidden: hold everything back. Visible again: play it, or (reduced motion) land it.
  useEffect(() => {
    const onVisibility = () => {
      const c = current.current;
      if (document.visibilityState === 'hidden') {
        if (c) setCatchUp({ ...c, phase: 'holding' });
        else {
          const l = latest.current;
          setCatchUp({
            phase: 'holding',
            released: idsOf(l.events),
            basis: { input: l.input, engines: l.engines },
            left: 0,
          });
        }
      } else if (c) {
        // Reduced motion: no playback. The final state shows at once and the renderer lists the
        // missed events in the feed as it takes them.
        if (latest.current.reducedMotion) finish(false);
        else setCatchUp({ ...c, phase: 'draining' });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [finish, setCatchUp]);

  // Draining: release the oldest missed event (and apply the oldest held row) each step.
  const draining = catchUp?.phase === 'draining';
  useEffect(() => {
    if (!draining) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      const c = current.current;
      if (!c || c.phase !== 'draining') return;
      const { events: all, shows: visible, apply: applyNow } = latest.current;
      const pending = all.filter((e) => !c.released.has(e.id) && visible(e));
      const left = pending.length + queue.current.size;
      const elapsed = Date.now() - started;
      if (!left || elapsed > CATCH_UP_MS + SLACK_MS) {
        finish(left > 0);
        return;
      }
      // Beyond the step budget, the oldest land together in one quiet batch.
      const take = Math.max(1, left - STEPS + 1);
      takeHeld(queue.current, take).forEach(applyNow);
      const out = pending.slice(0, take);
      quietNext.current = take > 1;
      const released = new Set(c.released);
      out.forEach((e) => released.add(e.id));
      setCatchUp({ ...c, released, left: Math.max(0, left - take) });
      const wait = (CATCH_UP_MS - SLACK_MS - elapsed) / Math.max(1, Math.min(left - take, STEPS));
      timer = setTimeout(step, Math.min(STEP_MAX_MS, Math.max(STEP_MIN_MS, wait)));
    };
    timer = setTimeout(step, 250);
    return () => clearTimeout(timer);
  }, [draining, finish, setCatchUp]);

  /** Whether the next renderer update should land its new events without sparking them. */
  const takeQuiet = useCallback(() => {
    const quiet = quietNext.current;
    quietNext.current = false;
    return quiet;
  }, []);

  return { catchUp, offer, skip, takeQuiet };
};

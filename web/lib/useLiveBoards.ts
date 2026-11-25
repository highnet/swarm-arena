'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LIVE_GAME_STALE_MS,
  newestLiveGames,
  type GameId,
  type GameRow,
  type LiveGameRow,
} from '@arena/shared';
import type { EngineBoardSource } from '@/components/arena/EngineBoard';
import { onLive } from '@/lib/liveBus';
import { gameOfRow, type EngineGame } from '@/lib/swarmEvents';

/**
 * How long an engine's board stays after its last live game ended with no new one started: the
 * board loops that game meanwhile, so a run of gate games reads as one stream (#171).
 */
export const LIVE_LINGER_MS = 10 * 60_000;
/** Then it fades out for this long before the board goes. */
export const LIVE_FADE_MS = 700;
/** Finished games' results kept for the boards (only the newest few can still show). */
const RESULT_CAP = 32;
/** Never re-check sooner than this. */
const MIN_TICK_MS = 250;

const isRow = (r: Record<string, unknown> | null): r is Record<string, unknown> & LiveGameRow =>
  Boolean(
    r && typeof r.id === 'string' && typeof r.track_id === 'string' && Array.isArray(r.moves),
  );

const gameOf = (r: LiveGameRow) => ({
  id: r.id,
  track: r.track_id,
  moves: r.moves,
  opponent: r.opponent,
  engineFirst: r.engine_first,
  finishedAt: r.updated_at,
});

/** The fresher of two copies of one row: out-of-order updates never step a board backwards. */
const fresher = (a: LiveGameRow | undefined, b: LiveGameRow) => (a && a.ply > b.ply ? a : b);

/**
 * The fleet graph's engine boards (#163, #171). Starts from the server's `live_games` rows and
 * follows the `live_games` Realtime channel. An engine's newest fresh row is its live game. A
 * game ends when its row is deleted, its result arrives (a `games` insert with its id), or its
 * row goes stale; the engine's board then shows that ended game (the board plays it out, holds
 * the result and loops it) until a new live game starts, or for `LIVE_LINGER_MS`, after which
 * it fades for `LIVE_FADE_MS` and goes. An engine with nothing live or recent has no board.
 */
export const useLiveBoards = (
  initial: Partial<Record<GameId, LiveGameRow>>,
): Partial<Record<GameId, EngineBoardSource>> => {
  /** Rows Realtime has written since the page loaded, by id; a deleted row keeps its moves. */
  const [rows, setRows] = useState<Record<string, LiveGameRow>>({});
  /** When each game ended (delete or result), by id. */
  const [endedAt, setEndedAt] = useState<Record<string, number>>({});
  /** Finished games' results by id, from `games` inserts (they land just before the delete). */
  const [results, setResults] = useState<Record<string, EngineGame['result']>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Changes fold into one pending batch per game (newest copy, first end, result). Visible, the
    // batch lands at once; hidden, it waits for the tab to come back, so a background tab spends
    // nothing on boards nobody sees and returns with one update, not thousands (#197).
    let rowsIn = new Map<string, LiveGameRow>();
    let endedIn = new Map<string, number>();
    let resultsIn = new Map<string, EngineGame['result']>();
    let last = 0;
    const flush = () => {
      if (!last) return;
      const [r, e, g, at] = [rowsIn, endedIn, resultsIn, last];
      rowsIn = new Map();
      endedIn = new Map();
      resultsIn = new Map();
      last = 0;
      if (g.size) setResults((prev) => ({ ...prev, ...Object.fromEntries(g) }));
      if (e.size)
        setEndedAt((prev) => {
          const out = { ...prev };
          for (const [id, t] of e) if (!(id in out)) out[id] = t;
          return out;
        });
      if (r.size)
        setRows((prev) => {
          const out = { ...prev };
          for (const [id, row] of r) out[id] = fresher(out[id], row);
          return out;
        });
      setNow(at);
    };
    const stop = onLive((change) => {
      const at = Date.now();
      if (change.table === 'games' && change.new && typeof change.new.id === 'string') {
        const g = change.new as unknown as GameRow;
        resultsIn.set(g.id, gameOfRow(g, undefined).result);
        if (!endedIn.has(g.id)) endedIn.set(g.id, at);
      } else if (change.table !== 'live_games') return;
      else if (change.eventType === 'DELETE') {
        const id = typeof change.old?.id === 'string' ? change.old.id : null;
        if (!id) return;
        if (!endedIn.has(id)) endedIn.set(id, at);
        // The full replica identity sends the deleted row; otherwise the last copy stands.
        if (isRow(change.old)) {
          const old = change.old as LiveGameRow;
          rowsIn.set(id, fresher(rowsIn.get(id), old));
        }
      } else if (isRow(change.new)) {
        const row = change.new as LiveGameRow;
        rowsIn.set(row.id, fresher(rowsIn.get(row.id), row));
      } else return;
      last = at;
      if (document.visibilityState !== 'hidden') flush();
    });
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const { boards, next } = useMemo(() => {
    const all = new Map<string, LiveGameRow>();
    for (const r of Object.values(initial)) if (r) all.set(r.id, r);
    for (const r of Object.values(rows)) all.set(r.id, fresher(all.get(r.id), r));
    const rowsAll = [...all.values()];
    /** When a game ended: deleted, its result in, or gone stale. */
    const endOf = (r: LiveGameRow) =>
      endedAt[r.id] ?? Date.parse(r.updated_at) + LIVE_GAME_STALE_MS;

    const live = newestLiveGames(
      rowsAll.filter((r) => !(r.id in endedAt)),
      now,
      LIVE_GAME_STALE_MS,
    );
    const deadlines: number[] = [];
    for (const r of Object.values(live)) if (r) deadlines.push(endOf(r));

    // Per engine, the game that ended last, while it still lingers.
    const ended: Partial<Record<GameId, LiveGameRow>> = {};
    for (const r of rowsAll) {
      if (live[r.track_id] || endOf(r) > now || endOf(r) + LIVE_LINGER_MS <= now) continue;
      const seen = ended[r.track_id];
      if (!seen || endOf(r) > endOf(seen)) ended[r.track_id] = r;
    }

    const out: Partial<Record<GameId, EngineBoardSource>> = {};
    for (const [k, r] of Object.entries(ended) as [GameId, LiveGameRow][]) {
      const goneAt = endOf(r) + LIVE_LINGER_MS;
      deadlines.push(goneAt - LIVE_FADE_MS, goneAt);
      out[k] = {
        kind: 'ended',
        game: { ...gameOf(r), result: results[r.id] ?? null },
        fading: now >= goneAt - LIVE_FADE_MS,
      };
    }
    // A game being played wins over one that just ended.
    for (const [k, r] of Object.entries(live) as [GameId, LiveGameRow][])
      out[k] = { kind: 'live', game: { ...gameOf(r), result: null } };

    const future = deadlines.filter((d) => d > now);
    return { boards: out, next: future.length ? Math.min(...future) : null };
  }, [initial, rows, endedAt, results, now]);

  // Re-derive at the next deadline (a row going stale, a board fading or going), and drop rows
  // that can no longer show so a long-open page does not keep every game it ever saw.
  useEffect(() => {
    if (next === null) return;
    const t = setTimeout(
      () => {
        const at = Date.now();
        setNow(at);
        setRows((r) => {
          const keep = Object.values(r).filter(
            (row) => Date.parse(row.updated_at) + LIVE_GAME_STALE_MS + LIVE_LINGER_MS > at,
          );
          return keep.length === Object.keys(r).length
            ? r
            : Object.fromEntries(keep.map((row) => [row.id, row]));
        });
        // Ends and results of games that can no longer show go too. An end outlives its row
        // (a row updates before it ends, so its own cut-off above passes first).
        const old = (t: number) => t + LIVE_GAME_STALE_MS + LIVE_LINGER_MS + LIVE_FADE_MS <= at;
        setEndedAt((e) =>
          Object.values(e).some(old)
            ? Object.fromEntries(Object.entries(e).filter(([, t]) => !old(t)))
            : e,
        );
        setResults((r) => {
          const ids = Object.keys(r);
          return ids.length > RESULT_CAP
            ? Object.fromEntries(Object.entries(r).slice(-RESULT_CAP))
            : r;
        });
      },
      Math.max(MIN_TICK_MS, next - Date.now()),
    );
    return () => clearTimeout(t);
  }, [next]);

  return boards;
};

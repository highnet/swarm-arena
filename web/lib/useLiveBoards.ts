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

  useEffect(
    () =>
      onLive((change) => {
        const at = Date.now();
        if (change.table === 'games' && change.new && typeof change.new.id === 'string') {
          const g = change.new as unknown as GameRow;
          setResults((r) => ({ ...r, [g.id]: gameOfRow(g, undefined).result }));
          setEndedAt((e) => (g.id in e ? e : { ...e, [g.id]: at }));
          setNow(at);
          return;
        }
        if (change.table !== 'live_games') return;
        setNow(at);
        if (change.eventType === 'DELETE') {
          const id = typeof change.old?.id === 'string' ? change.old.id : null;
          if (!id) return;
          setEndedAt((e) => (id in e ? e : { ...e, [id]: at }));
          // The full replica identity sends the deleted row; otherwise the last copy stands.
          const old = isRow(change.old) ? (change.old as LiveGameRow) : null;
          if (old) setRows((r) => ({ ...r, [id]: fresher(r[id], old) }));
          return;
        }
        if (!isRow(change.new)) return;
        const row = change.new as LiveGameRow;
        setRows((r) => ({ ...r, [row.id]: fresher(r[row.id], row) }));
      }),
    [],
  );

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
      },
      Math.max(MIN_TICK_MS, next - Date.now()),
    );
    return () => clearTimeout(t);
  }, [next]);

  return boards;
};

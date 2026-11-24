'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

/** How long a finished live game keeps its final position and result on the node. */
export const LIVE_ENDED_MS = 4_000;
/** Then it fades out for this long before the board goes. */
export const LIVE_FADE_MS = 700;
/** How often rows are re-checked for staleness when no change arrives. */
const STALE_CHECK_MS = 15_000;

type Ended = { game: EngineBoardSource & { kind: 'ended' }; fadeAt: number; goneAt: number };

const isRow = (r: Record<string, unknown> | null): r is Record<string, unknown> & LiveGameRow =>
  Boolean(
    r && typeof r.id === 'string' && typeof r.track_id === 'string' && Array.isArray(r.moves),
  );

const liveSource = (r: LiveGameRow): EngineBoardSource => ({
  kind: 'live',
  game: {
    id: r.id,
    track: r.track_id,
    moves: r.moves,
    opponent: r.opponent,
    finishedAt: r.updated_at,
    result: null,
  },
});

/**
 * The fleet graph's engine boards: only games being played right now (#163). Starts from the
 * server's `live_games` rows and follows the `live_games` Realtime channel (inserts, updates,
 * deletes), keeping the newest non-stale row per engine. A deleted row's board shows the final
 * position and result for `LIVE_ENDED_MS`, fades out, and goes. An engine with nothing live has
 * no board. Live rows bypass the catch-up playback: a board shows the game as it stands now.
 */
export const useLiveBoards = (
  initial: Partial<Record<GameId, LiveGameRow>>,
): Partial<Record<GameId, EngineBoardSource>> => {
  /** Rows Realtime has written since the page loaded, by id. */
  const [rows, setRows] = useState<Record<string, LiveGameRow>>({});
  /** Ids Realtime deleted: a snapshot that still lists one must not bring it back. */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [ended, setEnded] = useState<Partial<Record<GameId, Ended>>>({});
  const [now, setNow] = useState(() => Date.now());
  /** Finished games' results by id, from `games` inserts (they land just before the delete). */
  const results = useRef(new Map<string, EngineGame['result']>());
  const shown = useRef(new Map<string, LiveGameRow>());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), STALE_CHECK_MS);
    return () => clearInterval(tick);
  }, []);

  useEffect(
    () =>
      onLive((change) => {
        if (change.table === 'games' && change.new && typeof change.new.id === 'string') {
          const g = change.new as unknown as GameRow;
          results.current.set(g.id, gameOfRow(g, undefined).result);
          return;
        }
        if (change.table !== 'live_games') return;
        const at = Date.now();
        setNow(at);
        if (change.eventType === 'DELETE') {
          const old = isRow(change.old) ? change.old : null;
          const id = typeof change.old?.id === 'string' ? change.old.id : null;
          if (!id) return;
          setGone((s) => new Set(s).add(id));
          setRows((r) => {
            const { [id]: _drop, ...rest } = r;
            void _drop;
            return rest;
          });
          // The full replica identity sends the deleted row; fall back to what was on screen.
          const last = old ?? shown.current.get(id);
          if (!last) return;
          setEnded((e) => ({
            ...e,
            [last.track_id]: {
              game: {
                kind: 'ended',
                game: {
                  ...liveSource(last).game,
                  result: results.current.get(id) ?? null,
                },
                fading: false,
              },
              fadeAt: at + LIVE_ENDED_MS,
              goneAt: at + LIVE_ENDED_MS + LIVE_FADE_MS,
            },
          }));
          return;
        }
        if (!isRow(change.new)) return;
        const row = change.new as LiveGameRow;
        setRows((r) => {
          const before = r[row.id];
          // Out-of-order updates never step a board backwards.
          if (before && before.ply > row.ply) return r;
          return { ...r, [row.id]: row };
        });
      }),
    [],
  );

  // An ended board fades, then goes: one timer for the next deadline.
  useEffect(() => {
    const deadlines = Object.values(ended).flatMap((e) =>
      e ? [e.game.fading ? e.goneAt : e.fadeAt] : [],
    );
    if (!deadlines.length) return;
    const wait = Math.max(0, Math.min(...deadlines) - Date.now());
    const t = setTimeout(() => {
      const at = Date.now();
      setEnded((e) => {
        const next: Partial<Record<GameId, Ended>> = {};
        for (const [k, v] of Object.entries(e) as [GameId, Ended][]) {
          if (at >= v.goneAt) continue;
          next[k] = at >= v.fadeAt ? { ...v, game: { ...v.game, fading: true } } : v;
        }
        return next;
      });
    }, wait);
    return () => clearTimeout(t);
  }, [ended]);

  const newest = useMemo(() => {
    const all = new Map<string, LiveGameRow>();
    for (const r of Object.values(initial)) if (r && !gone.has(r.id)) all.set(r.id, r);
    for (const r of Object.values(rows)) {
      const was = all.get(r.id);
      if (!was || r.ply >= was.ply) all.set(r.id, r);
    }
    return newestLiveGames([...all.values()], now, LIVE_GAME_STALE_MS);
  }, [initial, rows, gone, now]);
  useEffect(() => {
    shown.current = new Map(Object.values(newest).flatMap((r) => (r ? [[r.id, r] as const] : [])));
  }, [newest]);

  return useMemo(() => {
    const out: Partial<Record<GameId, EngineBoardSource>> = {};
    for (const [k, e] of Object.entries(ended) as [GameId, Ended][]) out[k] = e.game;
    // A game being played wins over one that just ended.
    for (const [k, r] of Object.entries(newest) as [GameId, LiveGameRow][]) out[k] = liveSource(r);
    return out;
  }, [newest, ended]);
};

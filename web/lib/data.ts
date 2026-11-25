import { cacheLife, cacheTag } from 'next/cache';
import { connection } from 'next/server';
import {
  LIVE_GAME_STALE_MS,
  newestLiveGames,
  TRACKS,
  type EloPoint,
  type GameId,
  type GameRow,
  type LiveGameRow,
  type BoardRecord,
  type Message,
  type RecordKind,
  type Snapshot,
} from '@arena/shared';
import { readAll, ROW_CAP } from './paged';
import { getSupabase, supabaseConfigured } from './supabase';

/** Before the first run: the four ladders at the start line, nothing played. */
const notStarted = (): Snapshot => {
  const run = { id: 'not-started', label: 'Not started', started_at: new Date().toISOString() };
  return {
    run,
    tracks: TRACKS.map((t) => ({
      id: t.id,
      run_id: run.id,
      name: t.name,
      color_slot: t.colorSlot,
      current_elo: null,
      current_version: null,
    })),
    rungs: TRACKS.flatMap((t) =>
      t.rungs.map((r, position) => ({
        id: `${t.id}-${position}`,
        run_id: run.id,
        track_id: t.id,
        position,
        label: r.label,
        opponent: r.opponent,
        elo: r.elo,
        cleared_at: null,
        cleared_by_match: null,
      })),
    ),
    agents: [],
    tasks: [],
    records: [],
    matches: [],
    games: [],
    elo: [],
    messages: [],
  };
};

/**
 * Games the snapshot carries per engine: the newest, by `finished_at`. A run plays thousands, far
 * past PostgREST's row cap, and the snapshot is re-read every few seconds, so this list stays
 * bounded on purpose (#250). Totals come from the matches (`counters`), the /games list from
 * `getGamesPage`, the sitemap from `getGameIndex`, the download from `getAllGames`.
 */
export const SNAPSHOT_GAMES_PER_ENGINE = 75;

const GAME_COLUMNS =
  'id,run_id,match_id,track_id,ply_count,engine_first,outcome,termination,finished_at';

const fromSupabase = async (): Promise<Snapshot | null> => {
  const db = getSupabase();
  const { data: runs, error } = await db
    .from('runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`runs: ${error.message}`);
  const run = runs?.[0];
  if (!run) return null;
  /** Every row of the run, paged past the row cap in id order (#250). */
  const byRun = <T>(table: string, columns = '*') =>
    readAll<T>(table, (from, to) =>
      db
        .from(table)
        .select(columns)
        .eq('run_id', run.id)
        .order('id', { ascending: true })
        .range(from, to)
        .then((r) => ({ data: r.data as T[] | null, error: r.error })),
    );
  /** One engine's newest games, newest first: bounded, see `SNAPSHOT_GAMES_PER_ENGINE`. */
  const latestGames = (track: GameId) =>
    db
      .from('games')
      .select(GAME_COLUMNS)
      .eq('run_id', run.id)
      .eq('track_id', track)
      .order('finished_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(SNAPSHOT_GAMES_PER_ENGINE)
      .then((r) => {
        if (r.error) throw new Error(`games: ${r.error.message}`);
        return (r.data ?? []) as unknown as GameRow[];
      });

  /** One engine's games, counted exactly by the database (`head`: no rows travel). */
  const countGames = (track: GameId) =>
    db
      .from('games')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', run.id)
      .eq('track_id', track)
      .then((r) => {
        if (r.error) throw new Error(`games count: ${r.error.message}`);
        return [track, r.count ?? 0] as const;
      });

  const [tracks, rungs, agents, tasks, records, matches, perEngine, counts, elo, messages] =
    await Promise.all([
      byRun<Snapshot['tracks'][number]>('tracks'),
      byRun<Snapshot['rungs'][number]>('rungs'),
      byRun<Snapshot['agents'][number]>('agents'),
      byRun<Snapshot['tasks'][number]>('tasks'),
      byRun<Snapshot['records'][number]>('records'),
      byRun<Snapshot['matches'][number]>('matches'),
      Promise.all(TRACKS.map((t) => latestGames(t.id))),
      Promise.all(TRACKS.map((t) => countGames(t.id))),
      byRun<Snapshot['elo'][number]>('elo_points'),
      byRun<Message>('messages'),
    ]);
  const games = perEngine.flat();

  // Each engine's newest game, with its moves (the lists are newest first).
  const latestIds = perEngine.flatMap((list) => (list[0] ? [list[0].id] : []));
  const { data: withMoves } = latestIds.length
    ? await db.from('games').select('id,moves').in('id', latestIds)
    : { data: [] };
  const moves = new Map((withMoves ?? []).map((g) => [g.id as string, g.moves as string[]]));

  return {
    run,
    tracks,
    rungs,
    agents,
    tasks,
    records,
    matches,
    games: games.map((g) => ({ ...g, moves: moves.get(g.id) ?? [] })),
    gameCounts: Object.fromEntries(counts),
    elo: perVersion(elo),
    messages,
    asOf: new Date().toISOString(),
  };
};

/**
 * One point per engine version: placed when the version first went on the curve, valued at its
 * latest rating. When the referee re-rates a version against a harder opponent (to compare a
 * candidate like with like), that rating replaces the one from the easier rung, so a version that
 * beat its predecessor on the same opponent never plots below it.
 */
const perVersion = (points: EloPoint[]): EloPoint[] => {
  const byVersion = new Map<string, { first: EloPoint; latest: EloPoint }>();
  for (const p of [...points].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = `${p.track_id}:${p.engine_version}`;
    const seen = byVersion.get(key);
    byVersion.set(key, seen ? { first: seen.first, latest: p } : { first: p, latest: p });
  }
  return [...byVersion.values()].map(({ first, latest }) => ({ ...latest, at: first.at }));
};

/**
 * The run as it stands. Live data, so it is never part of a prerender (#222): a 2-second
 * `revalidate` and 15-second `expire` make it a request-time "dynamic hole" held only in the
 * server's memory, never an ISR entry. Everything on screen changes every few seconds (seats
 * heartbeat, records land, moves stream), so a prerendered copy would be rewritten far more often
 * than it is read. The short memory cache only folds the reads of one burst of refreshes into one.
 * Nothing expires it by tag; the browser keeps up through Realtime (`LiveIndicator`).
 */
export const getSnapshot = async (): Promise<Snapshot> => {
  'use cache';
  cacheLife({ stale: 0, revalidate: 2, expire: 15 });
  if (supabaseConfigured()) {
    const live = await fromSupabase().catch((e) => {
      console.error('supabase snapshot failed', e);
      return null;
    });
    if (live) return live;
  }
  return notStarted();
};

/** Every kind of board record, so the board can count each one exactly. */
const RECORD_KINDS: RecordKind[] = [
  'strategy',
  'task_opened',
  'task_claimed',
  'progress',
  'patch_landed',
  'patch_rejected',
  'match_verdict',
  'rung_cleared',
  'idea_dead',
  'protocol',
];

export type RecordTotals = {
  /** Records in the run, counted exactly (the snapshot's list stops at PostgREST's row cap). */
  total: number;
  byKind: Record<RecordKind, number>;
  /** When the run's first record was written, or null before any. */
  since: string | null;
};

/**
 * Exact record counts for the run, per kind, and its earliest record. Counted by the database
 * (`head`, `count: 'exact'`), never from the snapshot's capped list. Live like the snapshot, so the
 * same short memory cache (#222): never a prerender, no tag, nothing a browser can expire.
 */
export const getRecordTotals = async (): Promise<RecordTotals> => {
  'use cache';
  cacheLife({ stale: 0, revalidate: 2, expire: 15 });
  const byKind = Object.fromEntries(RECORD_KINDS.map((k) => [k, 0])) as Record<RecordKind, number>;
  const empty: RecordTotals = { total: 0, byKind, since: null };
  if (!supabaseConfigured()) return empty;
  const s = await getSnapshot();
  const db = getSupabase();
  const counted = await Promise.all(
    RECORD_KINDS.map(async (kind) => {
      const { count, error } = await db
        .from('records')
        .select('id', { count: 'exact', head: true })
        .eq('run_id', s.run.id)
        .eq('kind', kind);
      if (error) throw new Error(`records count: ${error.message}`);
      return [kind, count ?? 0] as const;
    }),
  ).catch((e) => {
    console.error('record totals failed', e);
    return null;
  });
  if (!counted) return empty;
  for (const [kind, n] of counted) byKind[kind] = n;
  const { data: first } = await db
    .from('records')
    .select('at')
    .eq('run_id', s.run.id)
    .order('at', { ascending: true })
    .limit(1);
  return {
    total: counted.reduce((sum, [, n]) => sum + n, 0),
    byKind,
    since: (first?.[0]?.at as string | undefined) ?? null,
  };
};

/**
 * Every record of one task, oldest first, paged past PostgREST's row cap. Cached per task under
 * its own tag (`task:<id>`), briefly: a task still being worked gains records. Nothing expires it
 * on demand (#222).
 */
export const getTaskRecords = async (taskId: string): Promise<BoardRecord[]> => {
  'use cache';
  cacheTag(`task:${taskId}`);
  cacheLife({ stale: 0, revalidate: 2, expire: 15 });
  if (!supabaseConfigured()) return [];
  const db = getSupabase();
  const page = 1000;
  const out: BoardRecord[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from('records')
      .select('*')
      .eq('task_id', taskId)
      .order('at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) {
      console.error('task records failed', error.message);
      return out;
    }
    out.push(...((data ?? []) as BoardRecord[]));
    if (!data || data.length < page) break;
  }
  return out;
};

/**
 * A match's games. A finished match never changes, so it is cached for good under its own tag
 * (`match:<id>`); a match still being played is read live, like the snapshot.
 */
export const getMatchGames = async (matchId: string, finished: boolean): Promise<GameRow[]> => {
  'use cache';
  cacheTag(`match:${matchId}`);
  if (finished) cacheLife('max');
  else cacheLife({ stale: 0, revalidate: 2, expire: 15 });
  if (!supabaseConfigured()) return [];
  const db = getSupabase();
  return readAll<GameRow>('match games', (from, to) =>
    db
      .from('games')
      .select('*')
      .eq('match_id', matchId)
      .order('id', { ascending: true })
      .range(from, to)
      .then((r) => ({ data: r.data as GameRow[] | null, error: r.error })),
  ).catch((e) => {
    console.error('match games failed', e);
    return [];
  });
};

/**
 * One finished game. A `games` row is written once, when the game ends, so a found game is cached
 * for good under its own tag (`game:<id>`). A miss is not: the game may be written in a moment.
 */
export const getGame = async (id: string): Promise<GameRow | null> => {
  'use cache';
  cacheTag(`game:${id}`);
  if (!supabaseConfigured()) {
    cacheLife({ stale: 0, revalidate: 2, expire: 15 });
    return null;
  }
  const { data } = await getSupabase().from('games').select('*').eq('id', id).maybeSingle();
  const game = (data as GameRow | null) ?? null;
  if (game) cacheLife('max');
  else cacheLife({ stale: 0, revalidate: 2, expire: 15 });
  return game;
};

/**
 * Every game of the run with its moves, oldest first. Paged past PostgREST's row cap. Megabytes,
 * read only by the download route, so it is never cached (#222): an entry this size rewritten on
 * every new game cost far more than the rare download that reads it.
 */
export const getAllGames = async (): Promise<GameRow[]> => {
  await connection();
  if (!supabaseConfigured()) return [];
  const s = await getSnapshot();
  const db = getSupabase();
  return readAll<GameRow>('games', (from, to) =>
    db
      .from('games')
      .select('*')
      .eq('run_id', s.run.id)
      .order('finished_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
      .then((r) => ({ data: r.data as GameRow[] | null, error: r.error })),
  );
};

export type GamesPage = {
  /** This page's games, newest first, without moves. */
  games: GameRow[];
  /** Games in the run (for one engine, when one is named), counted exactly by the database. */
  total: number;
};

/**
 * One page of the run's games, newest first, with an exact total: the /games list, read a page at
 * a time instead of from the snapshot's bounded games (#250). Live like the snapshot, so the same
 * short memory cache (#222): never a prerender, no tag, nothing a browser can expire.
 */
export const getGamesPage = async (
  engine: GameId | null,
  page: number,
  size: number,
): Promise<GamesPage> => {
  'use cache';
  cacheLife({ stale: 0, revalidate: 2, expire: 15 });
  if (!supabaseConfigured()) return { games: [], total: 0 };
  const s = await getSnapshot();
  const from = (Math.max(1, page) - 1) * Math.min(size, ROW_CAP);
  const { data, count, error } = await getSupabase()
    .from('games')
    .select(GAME_COLUMNS, { count: 'exact' })
    .match(engine ? { run_id: s.run.id, track_id: engine } : { run_id: s.run.id })
    .order('finished_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + Math.min(size, ROW_CAP) - 1);
  if (error) {
    console.error('games page failed', error.message);
    return { games: [], total: 0 };
  }
  const games = ((data ?? []) as unknown as Omit<GameRow, 'moves'>[]).map((g) => ({
    ...g,
    moves: [],
  }));
  return { games, total: count ?? games.length };
};

/** A game's address and when it finished: all the sitemap needs of each. */
export type GameIndexEntry = Pick<GameRow, 'id' | 'finished_at'>;

/**
 * Every game of the run, as `id` and `finished_at` only, paged past the row cap: the sitemap's
 * list (#250). Live like the snapshot, so the same short memory cache (#222).
 */
export const getGameIndex = async (): Promise<GameIndexEntry[]> => {
  'use cache';
  cacheLife({ stale: 0, revalidate: 2, expire: 15 });
  if (!supabaseConfigured()) return [];
  const s = await getSnapshot();
  const db = getSupabase();
  return readAll<GameIndexEntry>('game index', (from, to) =>
    db
      .from('games')
      .select('id,finished_at')
      .eq('run_id', s.run.id)
      .order('id', { ascending: true })
      .range(from, to)
      .then((r) => ({ data: r.data as GameIndexEntry[] | null, error: r.error })),
  ).catch((e) => {
    console.error('game index failed', e);
    return [];
  });
};

/**
 * The game each track's referee is playing right now: the newest live game per track that was
 * updated within `LIVE_GAME_STALE_MS` (#144). Empty when nothing is being played. Read per request
 * and never cached (#222): it changes every move, and the page follows the moves through Realtime
 * from there (`useLiveBoards`).
 */
export const liveGames = async (): Promise<Partial<Record<GameId, LiveGameRow>>> => {
  await connection();
  if (!supabaseConfigured()) return {};
  const s = await getSnapshot();
  const since = new Date(Date.now() - LIVE_GAME_STALE_MS).toISOString();
  const { data, error } = await getSupabase()
    .from('live_games')
    .select('*')
    .eq('run_id', s.run.id)
    .gte('updated_at', since)
    .order('started_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('live games failed', error.message);
    return {};
  }
  return newestLiveGames((data ?? []) as LiveGameRow[], Date.now());
};

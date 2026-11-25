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
  const byRun = <T>(table: string, columns = '*') =>
    db
      .from(table)
      .select(columns)
      .eq('run_id', run.id)
      .limit(5000)
      .then((r) => (r.data ?? []) as T[]);

  const [tracks, rungs, agents, tasks, records, matches, games, elo, messages] = await Promise.all([
    byRun<Snapshot['tracks'][number]>('tracks'),
    byRun<Snapshot['rungs'][number]>('rungs'),
    byRun<Snapshot['agents'][number]>('agents'),
    byRun<Snapshot['tasks'][number]>('tasks'),
    byRun<Snapshot['records'][number]>('records'),
    byRun<Snapshot['matches'][number]>('matches'),
    byRun<GameRow>(
      'games',
      'id,run_id,match_id,track_id,ply_count,engine_first,outcome,termination,finished_at',
    ),
    byRun<Snapshot['elo'][number]>('elo_points'),
    byRun<Message>('messages'),
  ]);

  const newest = [...games].sort((a, b) => b.finished_at.localeCompare(a.finished_at));
  const latestIds = new Set<string>();
  const seenTracks = new Set<string>();
  for (const g of newest) {
    if (!seenTracks.has(g.track_id)) {
      seenTracks.add(g.track_id);
      latestIds.add(g.id);
    }
  }
  const { data: withMoves } = latestIds.size
    ? await db
        .from('games')
        .select('id,moves')
        .in('id', [...latestIds])
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
  const { data } = await getSupabase().from('games').select('*').eq('match_id', matchId);
  return (data ?? []) as GameRow[];
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
  const page = 1000;
  const out: GameRow[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from('games')
      .select('*')
      .eq('run_id', s.run.id)
      .order('finished_at', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`games: ${error.message}`);
    out.push(...((data ?? []) as GameRow[]));
    if (!data || data.length < page) break;
  }
  return out;
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

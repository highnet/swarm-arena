import { cacheLife } from 'next/cache';
import type { GameId, GameRow, Snapshot } from '@arena/shared';
import sample from '@/data/sample.json';
import { getSupabase, supabaseConfigured } from './supabase';

const SAMPLE = sample as unknown as Snapshot;

/** Games keep their moves only for the newest game of each track; the rest load per match. */
const trimGames = (games: GameRow[]): GameRow[] => {
  const newest = new Map<GameId, string>();
  for (const g of [...games].sort((a, b) => b.finished_at.localeCompare(a.finished_at))) {
    if (!newest.has(g.track_id)) newest.set(g.track_id, g.id);
  }
  const keep = new Set(newest.values());
  return games.map((g) => (keep.has(g.id) ? g : { ...g, moves: [] }));
};

const fromSupabase = async (): Promise<Snapshot | null> => {
  const db = getSupabase();
  const { data: runs } = await db
    .from('runs')
    .select('*')
    .order('is_sample', { ascending: true })
    .order('started_at', { ascending: false })
    .limit(1);
  const run = runs?.[0];
  if (!run) return null;
  const byRun = <T>(table: string, columns = '*') =>
    db
      .from(table)
      .select(columns)
      .eq('run_id', run.id)
      .limit(5000)
      .then((r) => (r.data ?? []) as T[]);

  const [tracks, rungs, agents, tasks, records, matches, games, elo] = await Promise.all([
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
    elo,
  };
};

export const getSnapshot = async (): Promise<Snapshot> => {
  'use cache';
  cacheLife({ stale: 30, revalidate: 30, expire: 3600 });
  if (supabaseConfigured()) {
    const live = await fromSupabase().catch(() => null);
    if (live) return live;
  }
  return { ...SAMPLE, games: trimGames(SAMPLE.games) };
};

export const getMatchGames = async (matchId: string): Promise<GameRow[]> => {
  'use cache';
  cacheLife({ stale: 60, revalidate: 300, expire: 86400 });
  if (supabaseConfigured()) {
    const { data } = await getSupabase().from('games').select('*').eq('match_id', matchId);
    if (data?.length) return data as GameRow[];
  }
  return SAMPLE.games.filter((g) => g.match_id === matchId);
};

/** Sample ids, for prerendering detail pages. */
export const sampleMatchIds = () => SAMPLE.matches.map((m) => m.id);

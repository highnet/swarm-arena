import { cacheLife } from 'next/cache';
import { TRACKS, type GameRow, type Message, type Snapshot } from '@arena/shared';
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
    elo,
    messages,
    asOf: new Date().toISOString(),
  };
};

export const getSnapshot = async (): Promise<Snapshot> => {
  'use cache';
  cacheLife({ stale: 30, revalidate: 30, expire: 3600 });
  if (supabaseConfigured()) {
    const live = await fromSupabase().catch((e) => {
      console.error('supabase snapshot failed', e);
      return null;
    });
    if (live) return live;
  }
  return notStarted();
};

export const getMatchGames = async (matchId: string): Promise<GameRow[]> => {
  'use cache';
  cacheLife({ stale: 60, revalidate: 300, expire: 86400 });
  if (!supabaseConfigured()) return [];
  const { data } = await getSupabase().from('games').select('*').eq('match_id', matchId);
  return (data ?? []) as GameRow[];
};

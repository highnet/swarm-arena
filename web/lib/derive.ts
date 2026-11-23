import type { BoardRecord, GameId, GameRow, Snapshot } from '@arena/shared';
import { TRACK_ORDER } from './tracks';

export type TrackSummary = {
  id: GameId;
  name: string;
  colorSlot: number;
  elo: number | null;
  version: string | null;
  /** Rating of the strongest opponent on the ladder. */
  topElo: number;
  /** Every rung cleared: the engine is now rated against its own previous version. */
  pastLadder: boolean;
  rungs: Snapshot['rungs'];
  nextRung: Snapshot['rungs'][number] | null;
  matches: number;
  games: number;
  /** A task on this engine is claimed right now. */
  atWork: boolean;
};

export const trackSummaries = (s: Snapshot): TrackSummary[] =>
  TRACK_ORDER.map((id) => s.tracks.find((t) => t.id === id))
    .filter((t) => t !== undefined)
    .map((t) => {
      const rungs = s.rungs
        .filter((r) => r.track_id === t.id)
        .sort((a, b) => a.position - b.position);
      const matches = s.matches.filter((m) => m.track_id === t.id);
      return {
        id: t.id,
        name: t.name,
        colorSlot: t.color_slot,
        elo: t.current_elo,
        version: t.current_version,
        topElo: rungs.reduce((m, r) => Math.max(m, r.elo), 0),
        pastLadder: rungs.length > 0 && rungs.every((r) => r.cleared_at),
        rungs,
        nextRung: rungs.find((r) => !r.cleared_at) ?? null,
        matches: matches.length,
        games: matches.reduce((n, m) => n + m.wins + m.draws + m.losses, 0),
        atWork: s.tasks.some((k) => k.track_id === t.id && k.status === 'claimed'),
      };
    });

/** The newest instant in the run: what "now" means for a snapshot. */
export const snapshotNow = (s: Snapshot) =>
  [
    ...s.records.map((r) => r.at),
    ...s.agents.map((a) => a.last_seen),
    s.run.started_at,
    s.asOf ?? s.run.started_at,
  ]
    .sort()
    .at(-1)!;

export const counters = (s: Snapshot) => ({
  games: s.matches.reduce((n, m) => n + m.wins + m.draws + m.losses, 0),
  matches: s.matches.length,
  landed: s.records.filter((r) => r.kind === 'patch_landed').length,
  dead: s.records.filter((r) => r.kind === 'idea_dead').length,
  rungs: s.rungs.filter((r) => r.cleared_at).length,
  rungsTotal: s.rungs.length,
  working: s.agents.filter((a) => a.status === 'working').length,
  sessions: s.agents.reduce((n, a) => n + a.sessions, 0),
});

export const newestFirst = (records: BoardRecord[]) =>
  [...records].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);

export const latestGame = (s: Snapshot): GameRow | null =>
  [...s.games]
    .filter((g) => g.moves.length)
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at))[0] ?? null;

/** Work happening now (claimed) and queued (open), newest first. */
export const frontier = (s: Snapshot) =>
  [...s.tasks]
    .filter((t) => t.status === 'claimed' || t.status === 'open')
    .sort((a, b) =>
      a.status === b.status
        ? b.created_at.localeCompare(a.created_at)
        : a.status === 'claimed'
          ? -1
          : 1,
    );

/** Engines, seats and tasks a strategy call set in motion: what the strategist opened right after it. */
export const mentions = (s: Snapshot, call: BoardRecord) => {
  const next = s.records
    .filter((r) => r.kind === 'strategy' && r.at > call.at)
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  const opened = s.records.filter(
    (r) =>
      r.kind === 'task_opened' &&
      r.at >= call.at &&
      (!next || r.at < next.at) &&
      Date.parse(r.at) - Date.parse(call.at) < 30 * 60_000,
  );
  return opened.map((r) => ({
    track: r.track_id as GameId,
    seat: String((r.data as { seat?: string }).seat ?? ''),
    title: r.title,
    taskId: r.task_id,
  }));
};

export type LineageNode = {
  version: string;
  elo: number;
  eloError: number | null;
  taskId: string | null;
  at: string;
  title: string;
  matchId: string;
  /** Ideas buried while this version was the one to beat. */
  buried: { title: string; detail: string | null; at: string }[];
};

/** The chain of shipped versions of one engine, with the ideas that died against each. */
export const lineage = (s: Snapshot, track: GameId) => {
  const shipped = s.records
    .filter((r) => r.track_id === track && r.kind === 'patch_landed')
    .sort((a, b) => a.at.localeCompare(b.at));
  const points = s.elo.filter((e) => e.track_id === track);
  const dead = s.records
    .filter((r) => r.track_id === track && r.kind === 'idea_dead')
    .sort((a, b) => a.at.localeCompare(b.at));
  const nodes: LineageNode[] = shipped.map((r) => {
    const version = r.title.split(' ')[0];
    const point = points.find((p) => p.engine_version === version);
    return {
      version,
      elo: point?.elo ?? 0,
      eloError: point?.elo_error ?? null,
      taskId: r.task_id,
      at: r.at,
      title: r.title.replace(/^\S+ shipped: /, ''),
      matchId: r.match_id ?? '',
      buried: [],
    };
  });
  const beforeFirst: LineageNode['buried'] = [];
  for (const d of dead) {
    const owner = [...nodes].reverse().find((n) => n.at <= d.at);
    (owner ? owner.buried : beforeFirst).push({ title: d.title, detail: d.detail, at: d.at });
  }
  return { nodes, beforeFirst };
};

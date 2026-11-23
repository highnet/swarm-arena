import type { BoardRecord, GameId, GameRow, Snapshot } from '@arena/shared';
import { TRACK_ORDER } from './tracks';

export type TrackSummary = {
  id: GameId;
  name: string;
  colorSlot: number;
  elo: number | null;
  version: string | null;
  finishElo: number;
  finishLabel: string;
  finished: boolean;
  rungs: Snapshot['rungs'];
  nextRung: Snapshot['rungs'][number] | null;
  matches: number;
  games: number;
};

export const trackSummaries = (s: Snapshot): TrackSummary[] =>
  TRACK_ORDER.map((id) => s.tracks.find((t) => t.id === id))
    .filter((t) => t !== undefined)
    .map((t) => {
      const rungs = s.rungs
        .filter((r) => r.track_id === t.id)
        .sort((a, b) => a.position - b.position);
      const matches = s.matches.filter((m) => m.track_id === t.id);
      const finishRung = rungs.find((r) => r.label === t.finish_label);
      return {
        id: t.id,
        name: t.name,
        colorSlot: t.color_slot,
        elo: t.current_elo,
        version: t.current_version,
        finishElo: t.finish_elo,
        finishLabel: t.finish_label,
        finished: Boolean(finishRung?.cleared_at),
        rungs,
        nextRung: rungs.find((r) => !r.cleared_at) ?? null,
        matches: matches.length,
        games: matches.reduce((n, m) => n + m.wins + m.draws + m.losses, 0),
      };
    });

/** The newest instant in the run: what "now" means for a snapshot. */
export const snapshotNow = (s: Snapshot) =>
  [...s.records.map((r) => r.at), ...s.agents.map((a) => a.last_seen), s.run.started_at]
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

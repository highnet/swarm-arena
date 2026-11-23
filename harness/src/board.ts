import { TRACKS, type Agent, type BoardRecord, type GameId, type RecordKind, type Rung, type Task, type Track } from '@arena/shared';
import { RUN_ID } from './config';
import { getStore } from './store';

/** Writes to the shared board. Every write is a structured record; no transcripts. */

export const now = () => new Date().toISOString();

export const post = (kind: RecordKind, fields: Partial<BoardRecord> & { title: string }) =>
  getStore().insert<BoardRecord>('records', {
    run_id: RUN_ID,
    at: now(),
    kind,
    track_id: null,
    agent_id: null,
    task_id: null,
    match_id: null,
    detail: null,
    data: {},
    ...fields,
  });

export const ensureRun = async (label: string) => {
  const db = getStore();
  if ((await db.select('runs', { id: RUN_ID })).length) return false;
  await db.insert('runs', { id: RUN_ID, label, is_sample: false, started_at: now() });
  for (const t of TRACKS) {
    const finish = t.rungs.find((r) => r.label === t.finishLabel)!;
    await db.insert('tracks', {
      id: t.id,
      run_id: RUN_ID,
      name: t.name,
      color_slot: t.colorSlot,
      finish_label: t.finishLabel,
      finish_elo: finish.elo,
      current_elo: null,
      current_version: null,
    });
    for (const [position, r] of t.rungs.entries()) {
      await db.insert('rungs', {
        id: `${RUN_ID}-${t.id}-${position}`,
        run_id: RUN_ID,
        track_id: t.id,
        position,
        label: r.label,
        opponent: r.opponent,
        elo: r.elo,
        cleared_at: null,
        cleared_by_match: null,
      });
    }
  }
  await agent('strategist', null, 'strategist');
  await agent('referee', null, 'referee');
  await post('strategy', {
    agent_id: 'strategist',
    title: 'Run opened. Four tracks, one rule: no number without a match.',
    detail: 'Every engine starts from an empty crate. The referee forfeits any illegal move.',
  });
  return true;
};

export const agent = async (seat: string, track: GameId | null, role: Agent['role']) => {
  const db = getStore();
  const id = seat.replace(/\//g, '-');
  const existing = await db.select<Agent>('agents', { id });
  if (!existing.length) {
    await db.insert('agents', { id, run_id: RUN_ID, seat, track_id: track, role, status: 'idle', last_seen: now(), sessions: 0 });
  }
  return id;
};

export const setAgent = async (id: string, patch: Partial<Agent>) =>
  getStore().update('agents', { id }, { last_seen: now(), ...patch });

export const bumpSessions = async (id: string) => {
  const [a] = await getStore().select<Agent>('agents', { id });
  if (a) await setAgent(id, { sessions: a.sessions + 1 });
};

export const tracks = () => getStore().select<Track>('tracks', { run_id: RUN_ID });
export const track = async (id: GameId) => (await getStore().select<Track>('tracks', { run_id: RUN_ID, id }))[0];
export const rungs = async (id: GameId) =>
  (await getStore().select<Rung>('rungs', { run_id: RUN_ID, track_id: id })).sort((a, b) => a.position - b.position);
export const tasks = () => getStore().select<Task>('tasks', { run_id: RUN_ID });
export const records = async () =>
  (await getStore().select<BoardRecord>('records', { run_id: RUN_ID })).sort((a, b) => a.at.localeCompare(b.at));

import {
  seatIsLive,
  TRACKS,
  type Agent,
  type BoardRecord,
  type GameId,
  type RecordKind,
  type Rung,
  type Task,
  type Track,
} from "@arena/shared";
import { RUN_ID } from "./config";
import { getStore } from "./store";

/** Writes to the shared board. Every write is a structured record; no transcripts. */

export const now = () => new Date().toISOString();

export const post = (
  kind: RecordKind,
  fields: Partial<BoardRecord> & { title: string },
) =>
  getStore().insert<BoardRecord>("records", {
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
  if ((await db.select("runs", { id: RUN_ID })).length) return false;
  await db.insert("runs", { id: RUN_ID, label, started_at: now() });
  for (const t of TRACKS) {
    await db.insert("tracks", {
      id: t.id,
      run_id: RUN_ID,
      name: t.name,
      color_slot: t.colorSlot,
      current_elo: null,
      current_version: null,
    });
    for (const [position, r] of t.rungs.entries()) {
      await db.insert("rungs", {
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
  await agent("strategist", null, "strategist");
  await agent("referee", null, "referee");
  await post("strategy", {
    agent_id: "strategist",
    title: "Run opened. Four engines, one rule: no rating without games.",
    detail:
      "Every engine starts from an empty crate. The referee forfeits any illegal move.",
  });
  return true;
};

export const agent = async (
  seat: string,
  track: GameId | null,
  role: Agent["role"],
) => {
  const db = getStore();
  const id = seat.replace(/\//g, "-");
  const existing = await db.select<Agent>("agents", { id });
  if (!existing.length) {
    await db.insert("agents", {
      id,
      run_id: RUN_ID,
      seat,
      track_id: track,
      role,
      status: "idle",
      last_seen: now(),
      sessions: 0,
    });
  }
  return id;
};

/**
 * The running session, as seat rows record it: the cloud session id, or null for a local run
 * (a local operator runs one session per role at a time, so it keeps one seat per role).
 */
export const sessionKey = () =>
  process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? null;

/** Most seats one role can fill at once: `worker`, `worker/2` … `worker/12`. */
export const SEAT_POOL = 12;

const poolSeat = (base: string, n: number) => (n === 1 ? base : `${base}/${n}`);
const poolIds = (base: string) =>
  new Set(
    Array.from({ length: SEAT_POOL }, (_, i) =>
      poolSeat(base, i + 1).replace(/\//g, "-"),
    ),
  );

/** The seat of `base`'s pool this session already holds, or null. */
export const ownSeat = async (base: string) => {
  const mine = sessionKey();
  if (!mine) return null;
  const ids = poolIds(base);
  const rows = await getStore().select<Agent>("agents", { session_id: mine });
  return rows.find((r) => ids.has(r.id))?.id ?? null;
};

/**
 * Seat this session in `base`'s pool (#205): one running session is one live seat. Every session of
 * a role used to write the one `worker` (or `reviewer`, …) row, so three concurrent workers showed
 * as one, the last to start overwrote the others' session, and the first retro took the seat off
 * the fleet while the others still worked. Now a session keeps the seat it already holds, or takes
 * the first seat in the pool that is not live (never used, idle, or silent past SEAT_STALE_MS),
 * with a compare-and-set on `last_seen` so two sessions starting together never share one.
 */
export const takeSeat = async (
  base: string,
  track: GameId | null,
  role: Agent["role"],
) => {
  const mine = sessionKey();
  if (!mine) return agent(base, track, role);
  const own = await ownSeat(base);
  if (own) return own;
  const db = getStore();
  for (let n = 1; n <= SEAT_POOL; n++) {
    const id = await agent(poolSeat(base, n), track, role);
    const [row] = await db.select<Agent>("agents", { id });
    if (!row || seatIsLive(row, Date.now())) continue;
    const won = await db.claim(
      "agents",
      { id, last_seen: row.last_seen },
      { session_id: mine, status: "working", last_seen: now() },
    );
    if (won) return id;
  }
  // Every seat is live: share the first rather than fail the session (it still does its job).
  return agent(base, track, role);
};

/** This session's seat in `base`'s pool, or the pool's first seat when it holds none. */
export const sessionSeat = async (
  base: string,
  track: GameId | null,
  role: Agent["role"],
) => (await ownSeat(base)) ?? agent(base, track, role);

/**
 * Heartbeat: every `arena` command a session runs keeps its seats live, so a long session that is
 * quiet between `next` and `retro` is not shown as stale after SEAT_STALE_MS.
 */
export const touchSessionSeats = async () => {
  const mine = sessionKey();
  if (!mine) return 0;
  return getStore().update(
    "agents",
    { session_id: mine, status: "working" },
    { last_seen: now() },
  );
};

export const setAgent = async (id: string, patch: Partial<Agent>) =>
  getStore().update("agents", { id }, { last_seen: now(), ...patch });

export const bumpSessions = async (id: string) => {
  const [a] = await getStore().select<Agent>("agents", { id });
  if (a) await setAgent(id, { sessions: a.sessions + 1 });
};

export const tracks = () =>
  getStore().select<Track>("tracks", { run_id: RUN_ID });
export const track = async (id: GameId) =>
  (await getStore().select<Track>("tracks", { run_id: RUN_ID, id }))[0];
export const rungs = async (id: GameId) =>
  (
    await getStore().select<Rung>("rungs", { run_id: RUN_ID, track_id: id })
  ).sort((a, b) => a.position - b.position);
export const tasks = () => getStore().select<Task>("tasks", { run_id: RUN_ID });
export const records = async () =>
  (await getStore().select<BoardRecord>("records", { run_id: RUN_ID })).sort(
    (a, b) => a.at.localeCompare(b.at),
  );

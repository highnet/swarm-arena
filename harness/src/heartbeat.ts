import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEAT_STALE_MS, type Agent } from "@arena/shared";
import { sessionKey } from "./board";
import { ARENA_HOME } from "./config";
import { getStore } from "./store";

/**
 * The session heartbeat (#228). A seat used to be heard from only when its session ran an `arena`
 * command, so a session coding, testing or reviewing for a long stretch between `next` and `retro`
 * went quiet on the fleet, and the site said "Nobody is working right now" while four sessions
 * worked. Now the first `arena` command that leaves this session holding a working seat starts one
 * small detached loop that keeps the seat heard from every HEARTBEAT_MS until the seat goes idle
 * (retro, release) — and no longer than the session itself is active.
 *
 * Liveness does not rest on the session's goodwill: what the beat writes as `last_seen` is when the
 * session last did anything (its newest Claude Code transcript write), not merely that the loop is
 * still running. A session that dies with its container stops beating; one stopped by a usage limit
 * keeps its container but stops writing, so its seat ages from its last action and reads stale
 * within SEAT_STALE_MS of it, and the loop then exits.
 */

export const HEARTBEAT_MS = Number(process.env.ARENA_HEARTBEAT_MS ?? 60_000);

/** Where Claude Code writes this machine's session transcripts. */
const transcriptsRoot = () =>
  process.env.ARENA_ACTIVITY_DIR ??
  join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");

/**
 * When the session last did anything: the newest write to a Claude Code transcript (every tool
 * call and reply lands there). Null when this machine keeps none, and the beat then trusts the loop.
 */
export const lastActivity = (root = transcriptsRoot()): number | null => {
  let newest: number | null = null;
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth > 0) walk(path, depth - 1);
      } else if (
        name.endsWith(".jsonl") &&
        (newest === null || st.mtimeMs > newest)
      )
        newest = st.mtimeMs;
    }
  };
  walk(root, 3);
  return newest;
};

export type Beat = {
  /** touched: seats heard from; done: no working seat left; silent: the session went quiet. */
  beat: "touched" | "done" | "silent";
  seats: string[];
};

/**
 * One heartbeat: mark this session's working seats as heard from when the session last acted
 * (never later than now, never earlier than an `arena` command already recorded).
 */
export const beat = async (
  nowMs = Date.now(),
  activity: number | null = lastActivity(),
): Promise<Beat> => {
  const mine = sessionKey();
  if (!mine) return { beat: "done", seats: [] };
  const db = getStore();
  const rows = await db.select<Agent>("agents", {
    session_id: mine,
    status: "working",
  });
  if (!rows.length) return { beat: "done", seats: [] };
  const seats = rows.map((r) => r.id);
  if (activity !== null && nowMs - activity > SEAT_STALE_MS)
    return { beat: "silent", seats };
  const heard = activity === null ? nowMs : Math.min(nowMs, activity);
  for (const r of rows) {
    if (Date.parse(r.last_seen) >= heard) continue;
    await db.update(
      "agents",
      { id: r.id, session_id: mine, status: "working" },
      { last_seen: new Date(heard).toISOString() },
    );
  }
  return { beat: "touched", seats };
};

const pidFile = () =>
  resolve(ARENA_HOME, `heartbeat-${sessionKey() ?? "local"}.pid`);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A recycled pid is somebody else's process: where /proc exists, check it is our loop.
  const cmdline = `/proc/${pid}/cmdline`;
  if (!existsSync(cmdline)) return true;
  try {
    return readFileSync(cmdline, "utf8").includes("heartbeat");
  } catch {
    return true;
  }
};

/** The running heartbeat loop's pid, or null. */
export const heartbeatPid = (): number | null => {
  const file = pidFile();
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8").trim());
  return pid && alive(pid) ? pid : null;
};

/** The loop itself (`arena heartbeat --run`): beat until the seat is done or the session silent. */
export const runHeartbeat = async ({
  intervalMs = HEARTBEAT_MS,
  maxBeats = Infinity,
}: { intervalMs?: number; maxBeats?: number } = {}) => {
  mkdirSync(ARENA_HOME, { recursive: true });
  writeFileSync(pidFile(), String(process.pid));
  let last: Beat = { beat: "touched", seats: [] };
  try {
    for (let n = 0; n < maxBeats; n++) {
      // A failed write (network blip) is not the end of the session: try again next beat.
      last = await beat().catch(() => ({
        beat: "touched" as const,
        seats: [],
      }));
      if (last.beat !== "touched") break;
      if (n + 1 < maxBeats)
        await new Promise((ok) => setTimeout(ok, intervalMs));
    }
  } finally {
    const file = pidFile();
    if (
      existsSync(file) &&
      Number(readFileSync(file, "utf8").trim()) === process.pid
    )
      rmSync(file, { force: true });
  }
  return last;
};

/** Start the detached loop unless one is running. Returns its pid. */
export const startHeartbeat = () => {
  const running = heartbeatPid();
  if (running) return running;
  const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
  // execArgv carries tsx's loader, so the child runs the same TypeScript the parent does.
  const child = spawn(
    process.execPath,
    [...process.execArgv, cli, "heartbeat", "--run"],
    { detached: true, stdio: "ignore", env: process.env },
  );
  child.unref();
  mkdirSync(ARENA_HOME, { recursive: true });
  if (child.pid) writeFileSync(pidFile(), String(child.pid));
  return child.pid ?? null;
};

/** Stop the loop (the session's seats went idle). */
export const stopHeartbeat = () => {
  const pid = heartbeatPid();
  if (pid)
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  rmSync(pidFile(), { force: true });
  return pid;
};

/**
 * After every `arena` command: a session holding a working seat has a heartbeat, one that holds
 * none has not. Only cloud sessions (one seat row per session id) and only where seats can be
 * written; `ARENA_HEARTBEAT=0` turns it off.
 */
export const syncHeartbeat = async () => {
  const mine = sessionKey();
  if (!mine || process.env.ARENA_HEARTBEAT === "0") return null;
  const db = getStore();
  if (db.kind === "supabase" && !process.env.ARENA_PASSWORD) return null;
  const working = await db.select<Agent>("agents", {
    session_id: mine,
    status: "working",
  });
  if (working.length) return { running: true, pid: startHeartbeat() };
  stopHeartbeat();
  return { running: false, pid: null };
};

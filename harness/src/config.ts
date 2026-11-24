import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** swarm-arena/ */
export const ARENA_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const ENGINES_DIR = resolve(ARENA_ROOT, "engines");
export const ARENA_HOME = resolve(
  process.env.ARENA_HOME ?? resolve(ARENA_ROOT, ".arena"),
);
export const RUN_ID = process.env.ARENA_RUN ?? "run-001";
export const MOVE_MS = Number(process.env.ARENA_MOVE_MS ?? 200);
/** How often a game in progress is written to live_games, at most (#144). */
export const LIVE_MS = Number(process.env.ARENA_LIVE_MS ?? 1000);
/** How far past `go <ms>` a reply may arrive before it forfeits (process and pipe overhead). */
export const MOVE_SLACK_MS = Number(process.env.ARENA_MOVE_SLACK_MS ?? 300);
/**
 * A reference engine's own per-move allowance (#164). GNU Go and Edax play a fixed level with no
 * clock, so they cannot keep to MOVE_MS: GNU Go level 8 took up to ~1 s a move on 9×9 (p99 0.9 s,
 * level 10 up to 1.4 s) against the 500 ms the candidate gets, and repeated timeouts aborted gate
 * matches. Extra time does not change a fixed-level engine's strength, only whether it answers.
 * Stockfish keeps `go movetime MOVE_MS` and stays inside it. The candidate keeps MOVE_MS.
 */
export const REFERENCE_MOVE_MS = Number(
  process.env.ARENA_REFERENCE_MOVE_MS ?? 5000,
);
export const GATE_PAIRS = Number(process.env.ARENA_GATE_PAIRS ?? 20);

process.env.ARENA_HOME = ARENA_HOME;

export type RunResult = { code: number; stdout: string; stderr: string };

/** Run a command to completion, capturing output. */
export const run = (
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    input?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
) =>
  new Promise<RunResult>((done) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs)
      : undefined;
    child.on("error", (e) => done({ code: -1, stdout, stderr: String(e) }));
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(opts.input ?? "");
  });

export const log = (...args: unknown[]) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** swarm-arena/ */
export const ARENA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ENGINES_DIR = resolve(ARENA_ROOT, 'engines');
export const ARENA_HOME = resolve(process.env.ARENA_HOME ?? resolve(ARENA_ROOT, '.arena'));
export const RUN_ID = process.env.ARENA_RUN ?? 'run-001';
export const MOVE_MS = Number(process.env.ARENA_MOVE_MS ?? 200);
export const GATE_PAIRS = Number(process.env.ARENA_GATE_PAIRS ?? 20);

process.env.ARENA_HOME = ARENA_HOME;

export type RunResult = { code: number; stdout: string; stderr: string };

/** Run a command to completion, capturing output. */
export const run = (cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number } = {}) =>
  new Promise<RunResult>((done) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs) : undefined;
    child.on('error', (e) => done({ code: -1, stdout, stderr: String(e) }));
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(opts.input ?? '');
  });

export const log = (...args: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);

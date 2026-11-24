import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { GameId, GameRules, Mover } from "@arena/shared";
import { ARENA_HOME } from "./config";

/** Find a reference binary: env override, then the install script's location, then PATH. */
export const findBin = (name: string, envVar: string): string => {
  const env = process.env[envVar];
  if (env) return env;
  const candidates = [
    resolve(ARENA_HOME, "refs/edax/bin", name),
    resolve(ARENA_HOME, "refs/bin", name),
    `/usr/games/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
  return candidates.find((c) => existsSync(c)) ?? name;
};

/** Every engine process this referee started and has not seen exit (#164). */
const live = new Set<ChildProcessWithoutNullStreams>();

/** How many engine processes are still running. */
export const liveProcesses = () => live.size;

/**
 * Kill every engine process still running, now. An aborted match skips the normal `close()`
 * calls, and one hanging reference keeps its pipes open and the referee process alive (#164):
 * `arena submit` calls this on the way out, whatever happened. Returns how many it killed.
 */
/** SIGKILL a child and its process group (it is detached, so it leads one). */
const killGroup = (child: ChildProcessWithoutNullStreams) => {
  try {
    if (child.pid === undefined) throw new Error("no pid");
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
};

export const killAll = () => {
  const n = live.size;
  for (const child of live) killGroup(child);
  live.clear();
  return n;
};

let hooked = false;
/** Kill the engine processes on exit and on Ctrl-C / SIGTERM too, not only on a clean return. */
const hookExit = () => {
  if (hooked) return;
  hooked = true;
  process.on("exit", killAll);
  for (const [sig, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)
    process.on(sig, () => {
      killAll();
      process.exit(code);
    });
};

/**
 * A line-based process speaking a small protocol. Used for arena engines (see
 * engines/PROTOCOL.md) and wrapped for the external reference engines.
 */
export class LineProcess {
  private child: ChildProcessWithoutNullStreams;
  private lines: Interface;
  private waiting: ((line: string) => void)[] = [];
  private buffered: string[] = [];
  private exited = false;

  constructor(command: string, args: string[], cwd?: string) {
    hookExit();
    // Its own process group, so killAll() reaches anything the engine itself started.
    this.child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    live.add(this.child);
    // A spawn error (binary missing) arrives as an event; without a listener it would throw.
    this.child.on("error", () => {
      live.delete(this.child);
      this.exited = true;
      for (const w of this.waiting.splice(0)) w("\u0000exit");
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      const w = this.waiting.shift();
      if (w) w(line);
      else this.buffered.push(line);
    });
    this.child.on("exit", () => {
      live.delete(this.child);
      this.exited = true;
      for (const w of this.waiting.splice(0)) w("\u0000exit");
    });
    this.child.stderr.resume();
  }

  send(line: string) {
    if (this.exited) throw new Error("engine exited");
    this.child.stdin.write(`${line}\n`);
  }

  next(): Promise<string> {
    const b = this.buffered.shift();
    if (b !== undefined) return Promise.resolve(b);
    if (this.exited) return Promise.reject(new Error("engine exited"));
    return new Promise((resolve, reject) =>
      this.waiting.push((l) =>
        l === "\u0000exit" ? reject(new Error("engine exited")) : resolve(l),
      ),
    );
  }

  /** Read lines until one matches, returning it. */
  async until(pred: (line: string) => boolean): Promise<string> {
    for (;;) {
      const l = await this.next();
      if (pred(l)) return l;
    }
  }

  /** Kill the process now, failing any pending read. */
  kill() {
    this.lines.close();
    // The whole group: a restart must not orphan whatever the old process started.
    killGroup(this.child);
  }

  async close() {
    if (!this.exited) {
      try {
        this.send("quit");
      } catch {
        /* already gone */
      }
      setTimeout(() => killGroup(this.child), 500).unref();
    }
    this.lines.close();
  }
}

const movesOf = (state: unknown) => (state as { moves: string[] }).moves;

/**
 * A process that can be replaced by a fresh one. After a move times out, its request is still in
 * flight: the late reply (and the orphaned `choose`, which keeps reading) would be taken as the
 * answer to the next request, so every later game desynchronises and times out too (#131).
 * Restarting kills the old process, which ends the orphan with "engine exited".
 */
export const restartable = async (start: () => Promise<LineProcess>) => {
  let p = await start();
  return {
    current: () => p,
    restart: async () => {
      const old = p;
      old.kill();
      p = await start();
    },
    close: () => p.close(),
  };
};

/**
 * An arena engine binary. Protocol (engines/PROTOCOL.md):
 *   > game <id>         < ready
 *   > position <moves>  (space separated, may be empty)
 *   > go <ms>           < bestmove <move>
 *   > quit
 */
export const arenaEngine = async (
  id: string,
  binary: string,
  game: GameId,
  moveMs: number,
): Promise<Mover> => {
  const proc = await restartable(async () => {
    const p = new LineProcess(binary, []);
    p.send(`game ${game}`);
    await p.until((l) => l.trim() === "ready");
    return p;
  });
  return {
    id,
    choose: async <S>(_rules: GameRules<S>, state: S) => {
      const p = proc.current();
      p.send(`position ${movesOf(state).join(" ")}`.trim());
      p.send(`go ${moveMs}`);
      const line = await p.until((l) => l.startsWith("bestmove"));
      return line.split(/\s+/)[1] ?? "";
    },
    reset: proc.restart,
    close: proc.close,
  };
};

/** Stockfish at a fixed skill level, via UCI. Needs `stockfish` on PATH. */
export const stockfish = async (
  level: number,
  moveMs: number,
): Promise<Mover> => {
  const proc = await restartable(async () => {
    const p = new LineProcess(findBin("stockfish", "STOCKFISH_BIN"), []);
    p.send("uci");
    await p.until((l) => l === "uciok");
    p.send(`setoption name Skill Level value ${level}`);
    p.send("isready");
    await p.until((l) => l === "readyok");
    return p;
  });
  return {
    id: `stockfish-${level}`,
    choose: async <S>(_rules: GameRules<S>, state: S) => {
      const p = proc.current();
      p.send(`position startpos moves ${movesOf(state).join(" ")}`.trim());
      p.send(`go movetime ${moveMs}`);
      const line = await p.until((l) => l.startsWith("bestmove"));
      return line.split(/\s+/)[1];
    },
    reset: proc.restart,
    close: proc.close,
  };
};

type GtpOptions = {
  id: string;
  command: string;
  args: string[];
  cwd?: string;
  setup: string[];
};

/**
 * Any GTP engine. The full game is replayed each move (clear_board + play ...), which keeps
 * the engine in sync with the referee even after a forfeit or a pass.
 */
export const gtpEngine = async ({
  id,
  command,
  args,
  cwd,
  setup,
}: GtpOptions): Promise<Mover> => {
  const cmd = async (p: LineProcess, c: string) => {
    p.send(c);
    const reply = await p.until((l) => l.startsWith("=") || l.startsWith("?"));
    await p.next(); // blank line terminating a GTP response
    if (reply.startsWith("?")) throw new Error(`gtp ${id}: ${c}: ${reply}`);
    return reply.slice(1).trim();
  };
  const proc = await restartable(async () => {
    const p = new LineProcess(command, args, cwd);
    for (const c of setup) await cmd(p, c);
    return p;
  });
  return {
    id,
    choose: async <S>(_rules: GameRules<S>, state: S) => {
      // Bind this move to one process: after a restart an orphaned call fails on the old one
      // instead of talking to the new.
      const p = proc.current();
      await cmd(p, "clear_board");
      const moves = movesOf(state);
      for (const [i, m] of moves.entries())
        await cmd(p, `play ${i % 2 === 0 ? "b" : "w"} ${m}`);
      // "resign" is not a legal move, so the referee scores it as a loss for this engine.
      return (
        await cmd(p, `genmove ${moves.length % 2 === 0 ? "b" : "w"}`)
      ).toLowerCase();
    },
    reset: proc.restart,
    close: proc.close,
  };
};

/** GNU Go at a fixed level on 9×9, Chinese (area) rules, komi 7.5. */
export const gnugo = (level: number) =>
  gtpEngine({
    id: `gnugo-${level}`,
    command: findBin("gnugo", "GNUGO_BIN"),
    args: ["--mode", "gtp", "--level", String(level), "--chinese-rules"],
    setup: ["boardsize 9", "komi 7.5"],
  });

/** Edax at a fixed search depth, opening book off. Needs its data/eval.dat beside the binary. */
export const edax = (level: number) => {
  const bin = findBin("lEdax-x86-64", "EDAX_BIN");
  return gtpEngine({
    id: `edax-${level}`,
    command: bin,
    args: ["-gtp", "-l", String(level), "-book-usage", "off", "-n", "1", "-q"],
    cwd: dirname(bin),
    setup: ["boardsize 8"],
  });
};

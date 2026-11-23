import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import type { GameId, GameRules, Mover } from '@arena/shared';

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
    this.child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      const w = this.waiting.shift();
      if (w) w(line);
      else this.buffered.push(line);
    });
    this.child.on('exit', () => {
      this.exited = true;
      for (const w of this.waiting.splice(0)) w('\u0000exit');
    });
    this.child.stderr.resume();
  }

  send(line: string) {
    if (this.exited) throw new Error('engine exited');
    this.child.stdin.write(`${line}\n`);
  }

  next(): Promise<string> {
    const b = this.buffered.shift();
    if (b !== undefined) return Promise.resolve(b);
    if (this.exited) return Promise.reject(new Error('engine exited'));
    return new Promise((resolve, reject) =>
      this.waiting.push((l) => (l === '\u0000exit' ? reject(new Error('engine exited')) : resolve(l))),
    );
  }

  /** Read lines until one matches, returning it. */
  async until(pred: (line: string) => boolean): Promise<string> {
    for (;;) {
      const l = await this.next();
      if (pred(l)) return l;
    }
  }

  async close() {
    if (!this.exited) {
      try {
        this.send('quit');
      } catch {
        /* already gone */
      }
      setTimeout(() => this.child.kill('SIGKILL'), 500).unref();
    }
    this.lines.close();
  }
}

const movesOf = (state: unknown) => (state as { moves: string[] }).moves;

/**
 * An arena engine binary. Protocol (engines/PROTOCOL.md):
 *   > game <id>         < ready
 *   > position <moves>  (space separated, may be empty)
 *   > go <ms>           < bestmove <move>
 *   > quit
 */
export const arenaEngine = async (id: string, binary: string, game: GameId, moveMs: number): Promise<Mover> => {
  const p = new LineProcess(binary, []);
  p.send(`game ${game}`);
  await p.until((l) => l.trim() === 'ready');
  return {
    id,
    choose: async <S>(_rules: GameRules<S>, state: S) => {
      p.send(`position ${movesOf(state).join(' ')}`.trim());
      p.send(`go ${moveMs}`);
      const line = await p.until((l) => l.startsWith('bestmove'));
      return line.split(/\s+/)[1] ?? '';
    },
    close: () => p.close(),
  };
};

/** Stockfish at a fixed skill level, via UCI. Needs `stockfish` on PATH. */
export const stockfish = async (level: number, moveMs: number): Promise<Mover> => {
  const p = new LineProcess(process.env.STOCKFISH_BIN ?? 'stockfish', []);
  p.send('uci');
  await p.until((l) => l === 'uciok');
  p.send(`setoption name Skill Level value ${level}`);
  p.send('isready');
  await p.until((l) => l === 'readyok');
  return {
    id: `stockfish-${level}`,
    choose: async <S>(_rules: GameRules<S>, state: S) => {
      p.send(`position startpos moves ${movesOf(state).join(' ')}`.trim());
      p.send(`go movetime ${moveMs}`);
      const line = await p.until((l) => l.startsWith('bestmove'));
      return line.split(/\s+/)[1];
    },
    close: () => p.close(),
  };
};

/** GNU Go at a fixed level on 9×9 with komi 7.5, via GTP. Needs `gnugo` on PATH. */
export const gnugo = async (level: number): Promise<Mover> => {
  const p = new LineProcess(process.env.GNUGO_BIN ?? 'gnugo', ['--mode', 'gtp', '--level', String(level), '--chinese-rules']);
  const cmd = async (c: string) => {
    p.send(c);
    const reply = await p.until((l) => l.startsWith('=') || l.startsWith('?'));
    await p.next(); // blank line terminating a GTP response
    if (reply.startsWith('?')) throw new Error(`gtp: ${c}: ${reply}`);
    return reply.slice(1).trim();
  };
  await cmd('boardsize 9');
  await cmd('komi 7.5');
  return {
    id: `gnugo-${level}`,
    choose: async <S>(_rules: GameRules<S>, state: S) => {
      await cmd('clear_board');
      const moves = movesOf(state);
      for (const [i, m] of moves.entries()) await cmd(`play ${i % 2 === 0 ? 'b' : 'w'} ${m}`);
      const reply = (await cmd(`genmove ${moves.length % 2 === 0 ? 'b' : 'w'}`)).toLowerCase();
      return reply === 'resign' ? 'resign' : reply;
    },
    close: () => p.close(),
  };
};

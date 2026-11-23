/// <reference lib="webworker" />
import { ConsoleStdout, File, OpenFile, WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim';

/**
 * Runs an arena engine in the browser. The engine is the same WASI command the referee plays:
 * each move feeds it the protocol on stdin (game, position, go, quit) and reads `bestmove`
 * from stdout. Compiled modules are cached per URL.
 */

type Request = { id: number; url: string; game: string; moves: string[]; ms: number };
type Reply = { id: number; move: string | null; error?: string; ms: number };

const modules = new Map<string, Promise<WebAssembly.Module>>();

const load = (url: string) => {
  let m = modules.get(url);
  if (!m) {
    m = WebAssembly.compileStreaming(fetch(url));
    modules.set(url, m);
  }
  return m;
};

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, url, game, moves, ms } = e.data;
  const started = performance.now();
  const reply = (r: Omit<Reply, 'id' | 'ms'>) =>
    (self as unknown as Worker).postMessage({
      id,
      ms: Math.round(performance.now() - started),
      ...r,
    });
  try {
    const compiled = await load(url);
    const input = `game ${game}\nposition ${moves.join(' ')}\ngo ${ms}\nquit\n`;
    const out: string[] = [];
    const wasi = new WASI(
      ['engine'],
      [],
      [
        new OpenFile(new File(new TextEncoder().encode(input))),
        ConsoleStdout.lineBuffered((line) => out.push(line)),
        ConsoleStdout.lineBuffered(() => undefined),
      ],
    );
    const instance = await WebAssembly.instantiate(compiled, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    try {
      wasi.start(instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
    } catch (err) {
      if (!(err instanceof WASIProcExit)) throw err;
    }
    const line = out.find((l) => l.startsWith('bestmove'));
    reply({ move: line?.split(/\s+/)[1] ?? null });
  } catch (err) {
    reply({ move: null, error: err instanceof Error ? err.message : String(err) });
  }
};

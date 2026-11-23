'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { GameId } from '@arena/shared';

type Pending = { resolve: (r: { move: string | null; error?: string; ms: number }) => void };

/** Ask the in-browser engine for a move. One worker per page; it keeps the compiled module. */
export const useEngine = (game: GameId, url: string) => {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  useEffect(() => {
    const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    const waiting = pending.current;
    w.onmessage = (
      e: MessageEvent<{ id: number; move: string | null; error?: string; ms: number }>,
    ) => {
      waiting.get(e.data.id)?.resolve(e.data);
      waiting.delete(e.data.id);
    };
    worker.current = w;
    return () => {
      w.terminate();
      for (const p of waiting.values()) p.resolve({ move: null, error: 'stopped', ms: 0 });
      waiting.clear();
    };
  }, []);

  return useCallback(
    (moves: string[], ms: number) =>
      new Promise<{ move: string | null; error?: string; ms: number }>((resolve) => {
        const id = nextId.current++;
        pending.current.set(id, { resolve });
        worker.current?.postMessage({ id, url, game, moves, ms });
      }),
    [game, url],
  );
};

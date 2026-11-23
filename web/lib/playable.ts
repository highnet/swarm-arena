import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cacheLife } from 'next/cache';
import type { GameId } from '@arena/shared';

export type Playable = {
  url: string;
  version: string;
  elo: number | null;
  builtAt: string;
};

/** The browser build the referee shipped with the engine's latest version, if any. */
export const getPlayable = async (id: GameId): Promise<Playable | null> => {
  'use cache';
  cacheLife('hours');
  const meta = await readFile(resolve(process.cwd(), 'public', 'wasm', `${id}.json`), 'utf8').catch(
    () => null,
  );
  if (!meta) return null;
  const m = JSON.parse(meta) as Omit<Playable, 'url'>;
  return { ...m, url: `/wasm/${id}.wasm?v=${encodeURIComponent(m.builtAt)}` };
};

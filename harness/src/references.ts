import { mctsPlayer, randomPlayer, type GameId, type Mover } from '@arena/shared';
import { gnugo, stockfish } from './engine';

/**
 * Resolve a rung's opponent id to a player. Built-ins need nothing installed;
 * external references need their binary on PATH (or the *_BIN env var).
 */
export const reference = async (opponent: string, game: GameId, moveMs: number, seed: number): Promise<Mover> => {
  if (opponent === 'random') return randomPlayer(seed);
  const [kind, arg] = opponent.split('-');
  const n = Number(arg);
  switch (kind) {
    case 'mcts':
      return mctsPlayer(n, seed);
    case 'stockfish':
      if (game !== 'chess') break;
      return stockfish(n, moveMs);
    case 'gnugo':
      if (game !== 'go9') break;
      return gnugo(n);
    case 'edax':
      throw new Error(
        'edax adapter not wired yet: add one in harness/src/engine.ts (edax speaks its own text protocol) or replace the rung',
      );
  }
  throw new Error(`unknown reference "${opponent}" for ${game}`);
};

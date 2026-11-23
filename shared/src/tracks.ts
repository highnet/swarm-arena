import type { GameId } from './games/types';

export type RungSpec = {
  label: string;
  /** Reference opponent id understood by the harness, e.g. "stockfish-6". */
  opponent: string;
  /** Rating of the opponent. A random mover is 0; the rest come from `arena calibrate`. */
  elo: number;
};

export type TrackSpec = {
  id: GameId;
  name: string;
  colorSlot: number;
  rungs: RungSpec[];
};

/**
 * Reference ladders. There is no finish line: past the top rung, versions are rated against
 * their own previous version. Ratings are provisional until `arena calibrate` measures them.
 */
export const TRACKS: TrackSpec[] = [
  {
    id: 'chess',
    name: 'Chess',
    colorSlot: 1,
    rungs: [
      { label: 'Random mover', opponent: 'random', elo: 0 },
      { label: 'Stockfish level 0', opponent: 'stockfish-0', elo: 900 },
      { label: 'Stockfish level 2', opponent: 'stockfish-2', elo: 1100 },
      { label: 'Stockfish level 4', opponent: 'stockfish-4', elo: 1350 },
      { label: 'Stockfish level 6', opponent: 'stockfish-6', elo: 1600 },
      { label: 'Stockfish level 8', opponent: 'stockfish-8', elo: 1800 },
      { label: 'Stockfish level 10', opponent: 'stockfish-10', elo: 2000 },
      { label: 'Stockfish level 13', opponent: 'stockfish-13', elo: 2300 },
      { label: 'Stockfish level 16', opponent: 'stockfish-16', elo: 2600 },
      { label: 'Stockfish level 20', opponent: 'stockfish-20', elo: 3000 },
    ],
  },
  {
    id: 'go9',
    name: 'Go 9×9',
    colorSlot: 2,
    rungs: [
      { label: 'Random mover', opponent: 'random', elo: 0 },
      { label: 'MCTS 2000', opponent: 'mcts-2000', elo: 600 },
      { label: 'GNU Go level 1', opponent: 'gnugo-1', elo: 1150 },
      { label: 'GNU Go level 3', opponent: 'gnugo-3', elo: 1250 },
      { label: 'GNU Go level 5', opponent: 'gnugo-5', elo: 1300 },
      { label: 'GNU Go level 8', opponent: 'gnugo-8', elo: 1400 },
      { label: 'GNU Go level 10', opponent: 'gnugo-10', elo: 1450 },
    ],
  },
  {
    id: 'othello',
    name: 'Othello',
    colorSlot: 3,
    rungs: [
      { label: 'Random mover', opponent: 'random', elo: 0 },
      { label: 'Edax level 1', opponent: 'edax-1', elo: 700 },
      { label: 'Edax level 2', opponent: 'edax-2', elo: 900 },
      { label: 'Edax level 3', opponent: 'edax-3', elo: 1150 },
      { label: 'Edax level 4', opponent: 'edax-4', elo: 1300 },
      { label: 'Edax level 6', opponent: 'edax-6', elo: 1550 },
      { label: 'Edax level 8', opponent: 'edax-8', elo: 1750 },
      { label: 'Edax level 10', opponent: 'edax-10', elo: 1900 },
      { label: 'Edax level 14', opponent: 'edax-14', elo: 2150 },
      { label: 'Edax level 18', opponent: 'edax-18', elo: 2400 },
      { label: 'Edax level 21', opponent: 'edax-21', elo: 2600 },
    ],
  },
  {
    id: 'hex',
    name: 'Hex 11×11',
    colorSlot: 4,
    rungs: [
      { label: 'Random mover', opponent: 'random', elo: 0 },
      { label: 'MCTS 200', opponent: 'mcts-200', elo: 380 },
      { label: 'MCTS 2000', opponent: 'mcts-2000', elo: 700 },
      { label: 'MCTS 20000', opponent: 'mcts-20000', elo: 1000 },
      { label: 'MCTS 100000', opponent: 'mcts-100000', elo: 1200 },
    ],
  },
];

export const trackSpec = (id: GameId) => TRACKS.find((t) => t.id === id)!;

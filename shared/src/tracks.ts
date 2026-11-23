import type { GameId } from './games/types';

export type RungSpec = {
  label: string;
  opponent: string;
  /** Arena Elo of the opponent. Random play is 0 by definition; the rest come from `arena calibrate`. */
  elo: number;
};

export type TrackSpec = {
  id: GameId;
  name: string;
  colorSlot: number;
  /** The rung whose defeat (>= 55% over the gate match) finishes the track. */
  finishLabel: string;
  rungs: RungSpec[];
};

/**
 * Reference ladders. Elo values are provisional until `arena calibrate` replaces them with
 * measured ones; the calibration matches are stored like any other match.
 */
export const TRACKS: TrackSpec[] = [
  {
    id: 'chess',
    name: 'Chess',
    colorSlot: 1,
    finishLabel: 'Stockfish level 10',
    rungs: [
      { label: 'Random mover', opponent: 'random', elo: 0 },
      { label: 'MCTS 200', opponent: 'mcts-200', elo: 350 },
      { label: 'Stockfish level 0', opponent: 'stockfish-0', elo: 900 },
      { label: 'Stockfish level 3', opponent: 'stockfish-3', elo: 1250 },
      { label: 'Stockfish level 6', opponent: 'stockfish-6', elo: 1600 },
      { label: 'Stockfish level 10', opponent: 'stockfish-10', elo: 2000 },
    ],
  },
  {
    id: 'go9',
    name: 'Go 9×9',
    colorSlot: 2,
    finishLabel: 'GNU Go level 10',
    rungs: [
      { label: 'Random mover', opponent: 'random', elo: 0 },
      { label: 'MCTS 200', opponent: 'mcts-200', elo: 420 },
      { label: 'MCTS 2000', opponent: 'mcts-2000', elo: 760 },
      { label: 'GNU Go level 1', opponent: 'gnugo-1', elo: 1150 },
      { label: 'GNU Go level 10', opponent: 'gnugo-10', elo: 1450 },
    ],
  },
  {
    id: 'othello',
    name: 'Othello',
    colorSlot: 3,
    finishLabel: 'Edax level 10',
    rungs: [
      { label: 'Random mover', opponent: 'random', elo: 0 },
      { label: 'MCTS 200', opponent: 'mcts-200', elo: 480 },
      { label: 'MCTS 2000', opponent: 'mcts-2000', elo: 820 },
      { label: 'Edax level 3', opponent: 'edax-3', elo: 1300 },
      { label: 'Edax level 10', opponent: 'edax-10', elo: 1900 },
    ],
  },
  {
    id: 'hex',
    name: 'Hex 11×11',
    colorSlot: 4,
    finishLabel: 'MCTS 20000',
    rungs: [
      { label: 'Random mover', opponent: 'random', elo: 0 },
      { label: 'MCTS 200', opponent: 'mcts-200', elo: 380 },
      { label: 'MCTS 2000', opponent: 'mcts-2000', elo: 700 },
      { label: 'MCTS 20000', opponent: 'mcts-20000', elo: 1000 },
    ],
  },
];

export const trackSpec = (id: GameId) => TRACKS.find((t) => t.id === id)!;

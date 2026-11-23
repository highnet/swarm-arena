import type { GameId } from '@arena/shared';

/** Fixed colour per track. Colour follows the entity, never its rank. */
export const SERIES: Record<number, { stroke: string; bg: string; text: string; border: string }> =
  {
    1: {
      stroke: 'var(--series-1)',
      bg: 'bg-series-1',
      text: 'text-series-1',
      border: 'border-series-1',
    },
    2: {
      stroke: 'var(--series-2)',
      bg: 'bg-series-2',
      text: 'text-series-2',
      border: 'border-series-2',
    },
    3: {
      stroke: 'var(--series-3)',
      bg: 'bg-series-3',
      text: 'text-series-3',
      border: 'border-series-3',
    },
    4: {
      stroke: 'var(--series-4)',
      bg: 'bg-series-4',
      text: 'text-series-4',
      border: 'border-series-4',
    },
  };

export const TRACK_ORDER: GameId[] = ['chess', 'go9', 'othello', 'hex'];

export const SHORT_NAME: Record<GameId, string> = {
  chess: 'Chess',
  go9: 'Go',
  othello: 'Othello',
  hex: 'Hex',
};

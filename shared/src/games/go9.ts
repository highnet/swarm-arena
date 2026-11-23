import { IllegalMoveError, colIndex, colLetter, type GameRules, type Outcome } from './types';

/**
 * 9x9 Go, Tromp-Taylor area scoring, komi 7.5, positional superko, suicide illegal.
 * Coordinates are GTP style (columns a-j without i, row 1 at the bottom). Black moves first.
 */
export type GoState = {
  cells: (('b' | 'w') | null)[];
  turn: 'b' | 'w';
  moves: string[];
  passes: number;
  /** Board strings of every position so far, for superko. */
  history: string[];
};

export const GO_SIZE = 9;
export const KOMI = 7.5;
const N = GO_SIZE;

const NEIGHBOURS = Array.from({ length: N * N }, (_, i) => {
  const r = Math.floor(i / N);
  const c = i % N;
  const out: number[] = [];
  if (r > 0) out.push(i - N);
  if (r < N - 1) out.push(i + N);
  if (c > 0) out.push(i - 1);
  if (c < N - 1) out.push(i + 1);
  return out;
});

const other = (p: 'b' | 'w'): 'b' | 'w' => (p === 'b' ? 'w' : 'b');
const key = (cells: GoState['cells']) => cells.map((c) => c ?? '.').join('');
export const goSquare = (i: number) => `${colLetter(i % N, true)}${N - Math.floor(i / N)}`;
export const goParse = (m: string) => (N - Number(m.slice(1))) * N + colIndex(m[0], true);

/** Stones of the group at i, and whether it has any liberty. */
const group = (cells: GoState['cells'], i: number) => {
  const p = cells[i];
  const stones = [i];
  const seen = new Set([i]);
  let liberty = false;
  for (let k = 0; k < stones.length; k++) {
    for (const n of NEIGHBOURS[stones[k]]) {
      if (cells[n] === null) liberty = true;
      else if (cells[n] === p && !seen.has(n)) {
        seen.add(n);
        stones.push(n);
      }
    }
  }
  return { stones, liberty };
};

/** Place a stone; returns the new cells or null when the move is suicide or occupied. */
const place = (cells: GoState['cells'], i: number, p: 'b' | 'w') => {
  if (cells[i]) return null;
  const next = [...cells];
  next[i] = p;
  for (const n of NEIGHBOURS[i]) {
    if (next[n] === other(p)) {
      const g = group(next, n);
      if (!g.liberty) for (const s of g.stones) next[s] = null;
    }
  }
  return group(next, i).liberty ? next : null;
};

const tryMove = (s: GoState, i: number) => {
  const next = place(s.cells, i, s.turn);
  if (!next) return null;
  return s.history.includes(key(next)) ? null : next;
};

/** Area score: stones plus empty regions reaching only one colour. Positive favours black. */
export const goScore = (cells: GoState['cells']): number => {
  let score = -KOMI;
  const seen = new Set<number>();
  for (let i = 0; i < N * N; i++) {
    if (cells[i] === 'b') score += 1;
    else if (cells[i] === 'w') score -= 1;
    else if (!seen.has(i)) {
      const region = [i];
      seen.add(i);
      const borders = new Set<string>();
      for (let k = 0; k < region.length; k++) {
        for (const n of NEIGHBOURS[region[k]]) {
          const c = cells[n];
          if (c) borders.add(c);
          else if (!seen.has(n)) {
            seen.add(n);
            region.push(n);
          }
        }
      }
      if (borders.size === 1) score += borders.has('b') ? region.length : -region.length;
    }
  }
  return score;
};

/** True when i is a single-point eye of p (used by playout policies, not by the rules). */
export const isEye = (cells: GoState['cells'], i: number, p: 'b' | 'w') =>
  cells[i] === null && NEIGHBOURS[i].every((n) => cells[n] === p);

const scoreOutcome = (s: GoState): Outcome => (goScore(s.cells) > 0 ? 1 : 0);

export const go9: GameRules<GoState> = {
  id: 'go9',
  name: 'Go 9×9',
  playerLabels: ['Black', 'White'],
  initial: () => {
    const cells: GoState['cells'] = Array(N * N).fill(null);
    return { cells, turn: 'b', moves: [], passes: 0, history: [key(cells)] };
  },
  toMove: (s) => (s.turn === 'b' ? 0 : 1),
  legalMoves: (s) => {
    if (s.passes >= 2) return [];
    const out: string[] = [];
    for (let i = 0; i < N * N; i++) if (tryMove(s, i)) out.push(goSquare(i));
    out.push('pass');
    return out;
  },
  play: (s, move) => {
    if (s.passes >= 2) throw new IllegalMoveError('go9', move);
    if (move === 'pass') {
      return { ...s, turn: other(s.turn), moves: [...s.moves, move], passes: s.passes + 1 };
    }
    const i = /^[a-hj]\d$/.test(move) ? goParse(move) : -1;
    const next = i >= 0 && i < N * N ? tryMove(s, i) : null;
    if (!next) throw new IllegalMoveError('go9', move);
    return {
      cells: next,
      turn: other(s.turn),
      moves: [...s.moves, move],
      passes: 0,
      history: [...s.history, key(next)],
    };
  },
  outcome: (s) => (s.passes >= 2 ? scoreOutcome(s) : null),
  maxPlies: 250,
  adjudicate: scoreOutcome,
  board: (s) => {
    const lastMove = s.moves[s.moves.length - 1];
    return {
      layout: 'square',
      cols: N,
      rows: N,
      cells: s.cells,
      last: lastMove && lastMove !== 'pass' ? [goParse(lastMove)] : [],
      toMoveLabel: s.turn === 'b' ? 'Black' : 'White',
    };
  },
  plies: (s) => s.moves.length,
};

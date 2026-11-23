import { IllegalMoveError, colIndex, colLetter, type GameRules } from './types';

/**
 * 11x11 Hex without the swap rule. 'b' moves first and connects top to bottom;
 * 'w' connects left to right. a1 is the top-left cell.
 */
export type HexState = {
  cells: (('b' | 'w') | null)[];
  turn: 'b' | 'w';
  moves: string[];
  winner: 'b' | 'w' | null;
};

export const HEX_SIZE = 11;
const N = HEX_SIZE;

const neighbours = (i: number): number[] => {
  const r = Math.floor(i / N);
  const c = i % N;
  const out: number[] = [];
  const steps = [
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
  ];
  for (const [dr, dc] of steps) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
  }
  return out;
};

const NEIGHBOURS = Array.from({ length: N * N }, (_, i) => neighbours(i));

/** Does the group containing cell i touch both of its owner's edges? */
const connects = (cells: HexState['cells'], i: number): boolean => {
  const p = cells[i];
  if (!p) return false;
  const seen = new Set([i]);
  const stack = [i];
  let edgeA = false;
  let edgeB = false;
  while (stack.length) {
    const j = stack.pop()!;
    const r = Math.floor(j / N);
    const c = j % N;
    if (p === 'b' ? r === 0 : c === 0) edgeA = true;
    if (p === 'b' ? r === N - 1 : c === N - 1) edgeB = true;
    if (edgeA && edgeB) return true;
    for (const k of NEIGHBOURS[j]) {
      if (cells[k] === p && !seen.has(k)) {
        seen.add(k);
        stack.push(k);
      }
    }
  }
  return false;
};

const sq = (i: number) => `${colLetter(i % N)}${Math.floor(i / N) + 1}`;
const parse = (m: string) => (Number(m.slice(1)) - 1) * N + colIndex(m[0]);

export const hex: GameRules<HexState> = {
  id: 'hex',
  name: 'Hex 11×11',
  playerLabels: ['Black', 'White'],
  initial: () => ({ cells: Array(N * N).fill(null), turn: 'b', moves: [], winner: null }),
  toMove: (s) => (s.turn === 'b' ? 0 : 1),
  legalMoves: (s) => {
    if (s.winner) return [];
    const out: string[] = [];
    for (let i = 0; i < N * N; i++) if (!s.cells[i]) out.push(sq(i));
    return out;
  },
  play: (s, move) => {
    const i = parse(move);
    if (s.winner || !(i >= 0 && i < N * N) || s.cells[i] || !/^[a-k]\d{1,2}$/.test(move)) {
      throw new IllegalMoveError('hex', move);
    }
    const cells = [...s.cells];
    cells[i] = s.turn;
    return {
      cells,
      turn: s.turn === 'b' ? 'w' : 'b',
      moves: [...s.moves, move],
      winner: connects(cells, i) ? s.turn : null,
    };
  },
  outcome: (s) => (s.winner ? (s.winner === 'b' ? 1 : 0) : null),
  maxPlies: N * N,
  // A full Hex board always has a winner, so the cap is never reached before an outcome.
  adjudicate: (s) => (s.winner === 'w' ? 0 : 1),
  board: (s) => {
    const lastMove = s.moves[s.moves.length - 1];
    return {
      layout: 'hex',
      cols: N,
      rows: N,
      cells: s.cells,
      last: lastMove ? [parse(lastMove)] : [],
      toMoveLabel: s.turn === 'b' ? 'Black' : 'White',
    };
  },
  plies: (s) => s.moves.length,
};

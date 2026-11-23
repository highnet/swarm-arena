import { IllegalMoveError, colIndex, colLetter, type GameRules, type Outcome } from './types';

/** 'b' moves first. Coordinates: a1 is top-left, as in standard Othello notation. */
export type OthelloState = {
  cells: (('b' | 'w') | null)[];
  turn: 'b' | 'w';
  moves: string[];
};

const N = 8;
const DIRS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const other = (p: 'b' | 'w'): 'b' | 'w' => (p === 'b' ? 'w' : 'b');
const sq = (i: number) => `${colLetter(i % N)}${Math.floor(i / N) + 1}`;
const parse = (m: string) => (Number(m.slice(1)) - 1) * N + colIndex(m[0]);

const flipsFor = (cells: OthelloState['cells'], i: number, p: 'b' | 'w'): number[] => {
  if (cells[i]) return [];
  const r0 = Math.floor(i / N);
  const c0 = i % N;
  const flips: number[] = [];
  for (const [dr, dc] of DIRS) {
    const run: number[] = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < N && c >= 0 && c < N && cells[r * N + c] === other(p)) {
      run.push(r * N + c);
      r += dr;
      c += dc;
    }
    if (run.length && r >= 0 && r < N && c >= 0 && c < N && cells[r * N + c] === p) {
      flips.push(...run);
    }
  }
  return flips;
};

const placements = (cells: OthelloState['cells'], p: 'b' | 'w'): string[] => {
  const out: string[] = [];
  for (let i = 0; i < N * N; i++) if (flipsFor(cells, i, p).length) out.push(sq(i));
  return out;
};

const legalMoves = (s: OthelloState): string[] => {
  const mine = placements(s.cells, s.turn);
  if (mine.length) return mine;
  return placements(s.cells, other(s.turn)).length ? ['pass'] : [];
};

const play = (s: OthelloState, move: string): OthelloState => {
  if (move === 'pass') {
    if (legalMoves(s)[0] !== 'pass') throw new IllegalMoveError('othello', move);
    return { cells: s.cells, turn: other(s.turn), moves: [...s.moves, move] };
  }
  const i = parse(move);
  const flips = i >= 0 && i < N * N ? flipsFor(s.cells, i, s.turn) : [];
  if (!flips.length) throw new IllegalMoveError('othello', move);
  const cells = [...s.cells];
  cells[i] = s.turn;
  for (const f of flips) cells[f] = s.turn;
  return { cells, turn: other(s.turn), moves: [...s.moves, move] };
};

const discScore = (s: OthelloState): Outcome => {
  const b = s.cells.filter((c) => c === 'b').length;
  const w = s.cells.filter((c) => c === 'w').length;
  return b > w ? 1 : b < w ? 0 : 0.5;
};

const initial = (): OthelloState => {
  const cells: OthelloState['cells'] = Array(N * N).fill(null);
  cells[3 * N + 3] = 'w';
  cells[4 * N + 4] = 'w';
  cells[3 * N + 4] = 'b';
  cells[4 * N + 3] = 'b';
  return { cells, turn: 'b', moves: [] };
};

export const othello: GameRules<OthelloState> = {
  id: 'othello',
  name: 'Othello',
  playerLabels: ['Black', 'White'],
  initial,
  toMove: (s) => (s.turn === 'b' ? 0 : 1),
  legalMoves,
  play,
  outcome: (s) => (legalMoves(s).length ? null : discScore(s)),
  maxPlies: 130,
  adjudicate: discScore,
  board: (s) => {
    const lastMove = s.moves[s.moves.length - 1];
    return {
      layout: 'square',
      cols: N,
      rows: N,
      cells: s.cells,
      last: lastMove && lastMove !== 'pass' ? [parse(lastMove)] : [],
      toMoveLabel: s.turn === 'b' ? 'Black' : 'White',
    };
  },
  plies: (s) => s.moves.length,
};

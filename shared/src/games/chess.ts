import { Chess } from 'chess.js';
import { IllegalMoveError, type BoardView, type GameRules, type Outcome } from './types';

export type ChessState = {
  fen: string;
  moves: string[];
  /** Repetition counts keyed by the first four FEN fields. */
  seen: Record<string, number>;
};

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const repKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

const squareIndex = (sq: string): number => {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]);
  return (8 - rank) * 8 + file;
};

const toUci = (m: { from: string; to: string; promotion?: string }) =>
  `${m.from}${m.to}${m.promotion ?? ''}`;

const legalMoves = (s: ChessState): string[] =>
  new Chess(s.fen).moves({ verbose: true }).map(toUci);

const play = (s: ChessState, move: string): ChessState => {
  const c = new Chess(s.fen);
  try {
    c.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] });
  } catch {
    throw new IllegalMoveError('chess', move);
  }
  const fen = c.fen();
  const key = repKey(fen);
  return { fen, moves: [...s.moves, move], seen: { ...s.seen, [key]: (s.seen[key] ?? 0) + 1 } };
};

const outcome = (s: ChessState): Outcome | null => {
  const c = new Chess(s.fen);
  if (c.isCheckmate()) return c.turn() === 'w' ? 0 : 1;
  if (c.isStalemate() || c.isInsufficientMaterial()) return 0.5;
  if (Number(s.fen.split(' ')[4]) >= 100) return 0.5;
  if ((s.seen[repKey(s.fen)] ?? 0) >= 3) return 0.5;
  return null;
};

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Material adjudication for games that hit the ply cap. */
const adjudicate = (s: ChessState): Outcome => {
  let diff = 0;
  for (const ch of s.fen.split(' ')[0]) {
    const v = VALUES[ch.toLowerCase()];
    if (v === undefined) continue;
    diff += ch === ch.toUpperCase() ? v : -v;
  }
  if (diff >= 3) return 1;
  if (diff <= -3) return 0;
  return 0.5;
};

const board = (s: ChessState): BoardView => {
  const cells: (string | null)[] = [];
  for (const row of s.fen.split(' ')[0].split('/')) {
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
      else cells.push(ch);
    }
  }
  const lastMove = s.moves[s.moves.length - 1];
  return {
    layout: 'square',
    cols: 8,
    rows: 8,
    cells,
    last: lastMove ? [squareIndex(lastMove.slice(0, 2)), squareIndex(lastMove.slice(2, 4))] : [],
    toMoveLabel: s.fen.split(' ')[1] === 'w' ? 'White' : 'Black',
  };
};

export const chess: GameRules<ChessState> = {
  id: 'chess',
  name: 'Chess',
  playerLabels: ['White', 'Black'],
  initial: () => ({ fen: START, moves: [], seen: { [repKey(START)]: 1 } }),
  toMove: (s) => (s.fen.split(' ')[1] === 'w' ? 0 : 1),
  legalMoves,
  play,
  outcome,
  maxPlies: 300,
  adjudicate,
  board,
  plies: (s) => s.moves.length,
};

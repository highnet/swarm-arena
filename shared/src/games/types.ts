export type GameId = 'chess' | 'go9' | 'othello' | 'hex';

/** Score for the first player: 1 win, 0 loss, 0.5 draw. */
export type Outcome = 1 | 0 | 0.5;

/** A board snapshot any renderer can draw without knowing the rules. */
export type BoardView = {
  layout: 'square' | 'hex';
  cols: number;
  rows: number;
  /** Row-major from the top-left. Chess: FEN piece letters. Stone games: 'b' | 'w'. */
  cells: (string | null)[];
  /** Indices touched by the last move (from/to for chess, the placed stone otherwise). */
  last: number[];
  /** Short human label of whose turn it is, e.g. "White" or "Black". */
  toMoveLabel: string;
};

export type GameRules<S> = {
  id: GameId;
  name: string;
  playerLabels: [string, string];
  initial: () => S;
  toMove: (state: S) => 0 | 1;
  legalMoves: (state: S) => string[];
  /** Returns the next state. Throws on an illegal move. */
  play: (state: S, move: string) => S;
  outcome: (state: S) => Outcome | null;
  /** Hard cap on plies; past it the referee calls adjudicate(). */
  maxPlies: number;
  adjudicate: (state: S) => Outcome;
  board: (state: S) => BoardView;
  plies: (state: S) => number;
};

export class IllegalMoveError extends Error {
  constructor(game: GameId, move: string) {
    super(`illegal ${game} move: ${move}`);
    this.name = 'IllegalMoveError';
  }
}

/** Board coordinates as "a1"-style strings. Row 1 is the bottom row for chess/go, top for hex/othello. */
export const colLetter = (c: number, skipI = false): string => {
  const letters = skipI ? 'abcdefghjklmnopqrst' : 'abcdefghijklmnopqrs';
  return letters[c];
};

export const colIndex = (ch: string, skipI = false): number => {
  const letters = skipI ? 'abcdefghjklmnopqrst' : 'abcdefghijklmnopqrs';
  return letters.indexOf(ch);
};

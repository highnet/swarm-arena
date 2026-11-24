import type { BoardView, GameId } from '@arena/shared';

/**
 * How one cell animates as a board steps a single ply (#171): a piece or stone that arrived
 * (`in`), a chess piece that slid here from another square (`slide`, the offset in cells), an
 * Othello disc that turned over (`flip`, from the old colour), or a piece that left without
 * arriving anywhere: a capture (`out`, the piece that was there).
 */
export type CellMotion =
  | { kind: 'in'; delay: number; captured?: string }
  | { kind: 'slide'; dc: number; dr: number; captured?: string }
  | { kind: 'flip'; from: string; delay: number }
  | { kind: 'out'; piece: string };

/** Per cell, how it moves this ply; `key` changes every ply so each animation restarts. */
export type BoardMotion = { key: number; cells: (CellMotion | null)[] };

/** Milliseconds between two neighbouring discs of an Othello flip sweep. */
const FLIP_STAGGER_MS = 45;

const rowCol = (i: number, cols: number) => [Math.floor(i / cols), i % cols] as const;

/**
 * The motion between two consecutive positions of one game. Pure: the same pair always gives
 * the same motion, so a board can recompute it on every render.
 */
export const boardMotion = (
  game: GameId,
  prev: BoardView,
  next: BoardView,
  key: number,
): BoardMotion => {
  const cols = next.cols;
  const cells: (CellMotion | null)[] = next.cells.map(() => null);
  const placed = next.last[next.last.length - 1] ?? -1;
  const [pr, pc] = rowCol(placed, cols);
  const dist = (i: number) => {
    const [r, c] = rowCol(i, cols);
    return Math.max(Math.abs(r - pr), Math.abs(c - pc));
  };

  const arrived: number[] = [];
  const left: number[] = [];
  for (let i = 0; i < next.cells.length; i++) {
    const a = prev.cells[i] ?? null;
    const b = next.cells[i] ?? null;
    if (a === b) continue;
    if (b && game === 'othello' && a) {
      cells[i] = { kind: 'flip', from: a, delay: dist(i) * FLIP_STAGGER_MS };
      continue;
    }
    if (b) arrived.push(i);
    if (a) left.push(i);
  }

  // Chess: a piece that left one square and stands on another slid there (castling moves two).
  const slidFrom = new Set<number>();
  if (game === 'chess') {
    for (const to of arrived) {
      const piece = next.cells[to];
      const from = left
        .filter((f) => !slidFrom.has(f) && prev.cells[f] === piece && next.cells[f] !== piece)
        .sort((x, y) => dist(x) - dist(y))[0];
      if (from === undefined) continue;
      slidFrom.add(from);
      const [fr, fc] = rowCol(from, cols);
      const [tr, tc] = rowCol(to, cols);
      cells[to] = { kind: 'slide', dc: fc - tc, dr: fr - tr };
    }
  }
  for (const i of arrived) {
    const was = prev.cells[i] ?? null;
    // A capture square: the arriving piece is drawn over the captured one fading out.
    const captured = was && was !== next.cells[i] ? was : undefined;
    const m = cells[i];
    if (m?.kind === 'slide') cells[i] = { ...m, captured };
    else cells[i] = { kind: 'in', delay: 0, captured };
  }
  // A piece that left an emptied square without sliding anywhere was captured (Go, en passant).
  for (const i of left) {
    const was = prev.cells[i];
    if (slidFrom.has(i) || next.cells[i] || !was) continue;
    cells[i] = { kind: 'out', piece: was };
  }
  return { key, cells };
};

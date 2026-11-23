import type { GameId, GameRules } from './games/types';
import { rng, type Rand } from './players';

/**
 * Random plies played before the engines take over, per game. Short enough to stay near
 * balanced, long enough that deterministic engines meet a different position in every pair.
 * Hex gets one: its first move is the swap-sensitive one.
 */
export const OPENING_PLIES: Record<GameId, number> = { chess: 4, othello: 4, go9: 2, hex: 1 };

/** Identifies a position by what is on the board and who moves, so transpositions collide. */
const positionKey = <S>(rules: GameRules<S>, state: S) => {
  const b = rules.board(state);
  return `${rules.toMove(state)}|${b.cells.map((c) => c ?? '.').join('')}`;
};

/**
 * Plays `plies` uniformly random legal moves from the initial position. Returns null when the
 * line ends the game or runs out of moves (the caller draws again).
 */
export const randomOpening = <S>(rules: GameRules<S>, plies: number, rand: Rand): string[] | null => {
  let state = rules.initial();
  const moves: string[] = [];
  for (let i = 0; i < plies; i++) {
    const legal = rules.legalMoves(state);
    if (legal.length === 0 || rules.outcome(state) !== null) return null;
    const m = legal[Math.floor(rand() * legal.length)];
    state = rules.play(state, m);
    moves.push(m);
  }
  if (rules.outcome(state) !== null || rules.legalMoves(state).length === 0) return null;
  return moves;
};

/**
 * One opening per pair, reproducible from `seed`. Pairs get distinct start positions unless the
 * game has fewer distinct openings of that length than there are pairs; then repeats are allowed.
 */
export const matchOpenings = <S>(
  rules: GameRules<S>,
  pairs: number,
  seed: number,
  plies: number = OPENING_PLIES[rules.id],
): string[][] => {
  if (plies <= 0) return Array.from({ length: pairs }, () => []);
  const rand = rng(seed);
  const seen = new Set<string>();
  const out: string[][] = [];
  const attempts = 200;
  for (let p = 0; p < pairs; p++) {
    let pick: string[] | null = null;
    let fallback: string[] | null = null;
    for (let a = 0; a < attempts && !pick; a++) {
      const line = randomOpening(rules, plies, rand);
      if (!line) continue;
      fallback ??= line;
      const key = positionKey(rules, line.reduce((s, m) => rules.play(s, m), rules.initial()));
      if (!seen.has(key)) {
        seen.add(key);
        pick = line;
      }
    }
    out.push(pick ?? fallback ?? []);
  }
  return out;
};

/** A fresh seed for a match (31 bits, so it survives JSON and logs unchanged). */
export const newOpeningSeed = () => Math.floor(Math.random() * 0x7fffffff);

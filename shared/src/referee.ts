import type { GameRules, Outcome } from './games/types';
import { matchOpenings } from './openings';
import type { Mover } from './players';

export type Termination = 'rules' | 'adjudicated' | 'illegal-move' | 'crash' | 'timeout';

export type GameRecord = {
  moves: string[];
  /** Score for the first player. */
  outcome: Outcome;
  termination: Termination;
  /** Which seat (0 first, 1 second) caused a forfeit, when there was one. */
  offender: 0 | 1 | null;
  detail?: string;
};

export type PlayOptions = {
  /** Per-move time limit in ms; exceeding it forfeits. */
  moveTimeMs?: number;
  /** Optional opening moves to start from (for balanced pairs). */
  opening?: string[];
  onMove?: (move: string, ply: number) => void;
};

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

/** Plays one game between two movers. seats[0] moves first. Forfeits lose. */
export const playGame = async <S>(
  rules: GameRules<S>,
  seats: [Mover, Mover],
  options: PlayOptions = {},
): Promise<GameRecord> => {
  let state = rules.initial();
  for (const m of options.opening ?? []) state = rules.play(state, m);
  const limit = options.moveTimeMs ?? 10_000;

  for (;;) {
    const done = rules.outcome(state);
    if (done !== null) {
      return { moves: movesOf(rules, state), outcome: done, termination: 'rules', offender: null };
    }
    if (rules.plies(state) >= rules.maxPlies) {
      return {
        moves: movesOf(rules, state),
        outcome: rules.adjudicate(state),
        termination: 'adjudicated',
        offender: null,
      };
    }
    const seat = rules.toMove(state);
    let move: string;
    try {
      move = await withTimeout(seats[seat].choose(rules, state), limit);
    } catch (e) {
      const timeout = e instanceof Error && e.message === 'timeout';
      return forfeit(rules, state, seat, timeout ? 'timeout' : 'crash', String(e));
    }
    try {
      state = rules.play(state, move);
    } catch {
      return forfeit(rules, state, seat, 'illegal-move', move);
    }
    options.onMove?.(move, rules.plies(state));
  }
};

const movesOf = <S>(rules: GameRules<S>, state: S): string[] =>
  (state as unknown as { moves: string[] }).moves ?? [];

const forfeit = <S>(
  rules: GameRules<S>,
  state: S,
  seat: 0 | 1,
  termination: Termination,
  detail: string,
): GameRecord => ({
  moves: movesOf(rules, state),
  outcome: seat === 0 ? 0 : 1,
  termination,
  offender: seat,
  detail,
});

export type MatchResult = {
  games: GameRecord[];
  /** Points scored by the candidate (seat-independent). */
  score: number;
  wins: number;
  draws: number;
  losses: number;
  /** The opening each pair started from (both games of pair k used openings[k]). */
  openings: string[][];
  /** The seed the openings came from, or null when every game started from `options.opening`. */
  openingSeed: number | null;
};

export type MatchOptions = PlayOptions & {
  /**
   * Give each pair its own random opening, derived from this seed (see `matchOpenings`). Both
   * games of a pair share it, colours swapped. Without a seed every game uses `opening`.
   */
  openingSeed?: number;
  /** Override the per-game opening length (`OPENING_PLIES`). */
  openingPlies?: number;
  onGame?: (g: GameRecord, index: number) => void;
};

/**
 * Plays `pairs` colour-swapped pairs: candidate first in even games, second in odd ones.
 * With `openingSeed`, pair k starts from its own seeded random opening.
 */
export const playMatch = async <S>(
  rules: GameRules<S>,
  candidate: Mover,
  opponent: Mover,
  pairs: number,
  options: MatchOptions = {},
): Promise<MatchResult> => {
  const seed = options.openingSeed ?? null;
  const openings =
    seed === null
      ? Array.from({ length: pairs }, () => options.opening ?? [])
      : matchOpenings(rules, pairs, seed, options.openingPlies);
  const games: GameRecord[] = [];
  let score = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (let i = 0; i < pairs * 2; i++) {
    const candidateFirst = i % 2 === 0;
    const g = await playGame(rules, candidateFirst ? [candidate, opponent] : [opponent, candidate], {
      ...options,
      opening: openings[Math.floor(i / 2)],
    });
    const s = candidateFirst ? g.outcome : 1 - g.outcome;
    score += s;
    if (s === 1) wins++;
    else if (s === 0) losses++;
    else draws++;
    games.push(g);
    options.onGame?.(g, i);
  }
  return { games, score, wins, draws, losses, openings, openingSeed: seed };
};

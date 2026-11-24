import type { GameRules, Outcome } from './games/types';
import { pickOpenings, type OpeningSuite } from './openings';
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
  /** Where seeded openings came from: the balanced suite, #103's random lines, or none (no seed). */
  openingSource: 'suite' | 'random' | null;
  /** For a suite draw, the entry (0-based, in file order) each pair used. */
  openingEntries: number[] | null;
  /** Opponent timeouts and crashes that were voided and replayed (empty when none). */
  voided: VoidedGame[];
};

export type MatchOptions = PlayOptions & {
  /**
   * Give each pair its own random opening, derived from this seed (see `matchOpenings`). Both
   * games of a pair share it, colours swapped. Without a seed every game uses `opening`.
   */
  openingSeed?: number;
  /** Override the per-game opening length (`OPENING_PLIES`) of the random fallback. */
  openingPlies?: number;
  /**
   * Draw each pair's opening from this balanced suite (needs `openingSeed`). Falls back to the
   * random lines when the suite has fewer distinct entries than there are pairs.
   */
  openingSuite?: OpeningSuite;
  onGame?: (g: GameRecord, index: number) => void;
  /**
   * How many times one game may be voided and replayed because the opponent (a reference
   * engine) timed out or crashed. Such a forfeit measures the reference's process, not the
   * candidate, so it is not a result: the game is replayed from the same opening, colours
   * unchanged. Past the limit the match throws. Omit (or 0) to count every forfeit as played.
   * The candidate's own forfeits always count.
   */
  replayOpponentFailures?: number;
  onVoid?: (g: GameRecord, index: number, attempt: number) => void;
};

/** A game that did not count: the opponent timed out or crashed, so it was replayed. */
export type VoidedGame = { index: number; attempt: number; termination: Termination; plies: number; detail?: string };

const isFailure = (g: GameRecord) => g.termination === 'timeout' || g.termination === 'crash';

/**
 * Plays `pairs` colour-swapped pairs: candidate first in even games, second in odd ones.
 * With `openingSeed`, pair k starts from its own opening: a balanced suite entry when
 * `openingSuite` is given and large enough, otherwise a seeded random line.
 */
export const playMatch = async <S>(
  rules: GameRules<S>,
  candidate: Mover,
  opponent: Mover,
  pairs: number,
  options: MatchOptions = {},
): Promise<MatchResult> => {
  const seed = options.openingSeed ?? null;
  const picked =
    seed === null
      ? null
      : pickOpenings(rules, pairs, seed, { suite: options.openingSuite, plies: options.openingPlies });
  const openings = picked?.openings ?? Array.from({ length: pairs }, () => options.opening ?? []);
  const games: GameRecord[] = [];
  let score = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const voided: VoidedGame[] = [];
  const replays = options.replayOpponentFailures ?? 0;
  for (let i = 0; i < pairs * 2; i++) {
    const candidateFirst = i % 2 === 0;
    const seats: [Mover, Mover] = candidateFirst ? [candidate, opponent] : [opponent, candidate];
    let g: GameRecord;
    for (let attempt = 0; ; attempt++) {
      g = await playGame(rules, seats, { ...options, opening: openings[Math.floor(i / 2)] });
      // Whoever timed out or crashed may still have a move in flight: restore it before it
      // plays again, or the late answer desynchronises every later game.
      if (isFailure(g) && g.offender !== null) await seats[g.offender].reset?.();
      const opponentFailed = isFailure(g) && g.offender === (candidateFirst ? 1 : 0);
      if (!opponentFailed || replays <= 0) break;
      voided.push({ index: i, attempt, termination: g.termination, plies: g.moves.length, detail: g.detail });
      options.onVoid?.(g, i, attempt);
      if (attempt + 1 > replays)
        throw new Error(
          `${opponent.id} ${g.termination} in game ${i + 1} on ${attempt + 1} attempts in a row: aborting the match (${g.detail ?? ''})`,
        );
    }
    const s = candidateFirst ? g.outcome : 1 - g.outcome;
    score += s;
    if (s === 1) wins++;
    else if (s === 0) losses++;
    else draws++;
    games.push(g);
    options.onGame?.(g, i);
  }
  return {
    games,
    score,
    wins,
    draws,
    losses,
    openings,
    openingSeed: seed,
    openingSource: picked?.source ?? null,
    openingEntries: picked?.entries ?? null,
    voided,
  };
};

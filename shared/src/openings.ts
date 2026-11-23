import type { GameId, GameRules } from './games/types';
import { rng, type Rand } from './players';

/**
 * Random plies played before the engines take over, per game. Short enough to stay near
 * balanced, long enough that deterministic engines meet a different position in every pair.
 * Hex gets one: its first move is the swap-sensitive one.
 */
export const OPENING_PLIES: Record<GameId, number> = { chess: 4, othello: 4, go9: 2, hex: 1 };

/** Identifies a position by what is on the board and who moves, so transpositions collide. */
export const positionKey = <S>(rules: GameRules<S>, state: S) => {
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

// ---- Balanced opening suites -----------------------------------------------------------------
// Random plies can hang a piece or give away a corner, and a lopsided pair spends both games on a
// position that measures conversion, not strength. A suite is a checked-in list of openings a
// reference engine scored close to even (shared/src/openings/<game>.txt, built by
// `arena openings build <game>`). The referee draws from it and falls back to random lines.

/** One suite entry: the opening and the reference score that admitted it (first player's view). */
export type SuiteEntry = { moves: string[]; score: number };

export type OpeningSuite = {
  game: GameId;
  entries: SuiteEntry[];
  /** The file's comment lines, without the leading '#': how it was built, by what, with which bounds. */
  header: string[];
};

/**
 * Parses a suite file: '#' comment lines, then one opening per line as space-separated moves, a
 * tab, and the score. Blank lines are ignored.
 */
export const parseSuite = (game: GameId, text: string): OpeningSuite => {
  const header: string[] = [];
  const entries: SuiteEntry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('#')) {
      header.push(line.slice(1).trim());
      continue;
    }
    const [moves, score] = line.split('\t');
    const n = Number(score);
    if (score === undefined || !Number.isFinite(n)) throw new Error(`${game} suite: no score on "${line}"`);
    entries.push({ moves: moves.trim().split(/\s+/), score: n });
  }
  return { game, entries, header };
};

/** The inverse of `parseSuite`. Scores keep the sign, so balance is easy to eyeball. */
export const formatSuite = (suite: OpeningSuite, digits = 2): string =>
  [
    ...suite.header.map((h) => `# ${h}`.trimEnd()),
    ...suite.entries.map(
      (e) => `${e.moves.join(' ')}\t${e.score >= 0 ? '+' : ''}${e.score.toFixed(digits)}`,
    ),
  ].join('\n') + '\n';

/**
 * Indices of `pairs` distinct suite entries, chosen by `seed` (a seeded shuffle). Entries that
 * reach a position already drawn are skipped. Returns null when the suite cannot supply that many
 * distinct positions; the caller then falls back to random openings.
 */
export const drawFromSuite = <S>(
  rules: GameRules<S>,
  suite: OpeningSuite,
  pairs: number,
  seed: number,
): number[] | null => {
  const order = suite.entries.map((_, i) => i);
  const rand = rng(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const seen = new Set<string>();
  const out: number[] = [];
  for (const i of order) {
    if (out.length === pairs) break;
    const key = positionKey(rules, suite.entries[i].moves.reduce((s, m) => rules.play(s, m), rules.initial()));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out.length === pairs ? out : null;
};

export type PickedOpenings = {
  openings: string[][];
  /** 'suite' when the lines came from the suite, 'random' for #103's seeded random lines. */
  source: 'suite' | 'random';
  /** For a suite draw: the entry index (0-based, in file order) each pair used. */
  entries: number[] | null;
};

/**
 * The openings for a match: distinct suite entries when the suite has enough of them, otherwise
 * exactly `matchOpenings` (random legal lines from the same seed).
 */
export const pickOpenings = <S>(
  rules: GameRules<S>,
  pairs: number,
  seed: number,
  options: { suite?: OpeningSuite; plies?: number } = {},
): PickedOpenings => {
  if (options.suite && options.suite.game === rules.id) {
    const entries = drawFromSuite(rules, options.suite, pairs, seed);
    if (entries)
      return { openings: entries.map((i) => [...options.suite!.entries[i].moves]), source: 'suite', entries };
  }
  return { openings: matchOpenings(rules, pairs, seed, options.plies), source: 'random', entries: null };
};

/** A fresh seed for a match (31 bits, so it survives JSON and logs unchanged). */
export const newOpeningSeed = () => Math.floor(Math.random() * 0x7fffffff);

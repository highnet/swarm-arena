/**
 * The referee's gate decision, kept free of I/O so it can be tested without playing games (#195).
 *
 * A candidate is judged by a paired comparison with the version on main, played in the same submit:
 * the head-to-head, pair by pair (one opening, colours swapped), under a sequential probability
 * ratio test. It stops as soon as the evidence is clear either way, and reports "inconclusive"
 * when the game cap is reached first. A stored rating is never the yardstick: it is the sample
 * that won its own gate (the winner's curse), and a rating against a reference rung carries about
 * ±100 at 40 games, far too coarse to tell a +30 change from luck.
 *
 * The ladder rating is still measured (for the curve and for clearing rungs), but only reported.
 */

export type Rating = { elo: number; error: number };

/**
 * Whether the current version must be re-rated on the gate rung for the report. The rung sits
 * below the stored rating only when that rating was earned elsewhere (a cleared, easier rung) or
 * is an uncleared, noisy rating on this rung; the curve then shows main on the same rung as the
 * candidate. It no longer decides anything.
 */
export const needsRungBaseline = (
  rungElo: number | null,
  currentElo: number | null,
) => rungElo !== null && currentElo !== null && rungElo < currentElo;

/** Expected score of a side `elo` points stronger than its opponent. */
export const expectedScore = (elo: number) => 1 / (1 + 10 ** (-elo / 400));

/**
 * The gate's test: H0 "main + elo0" against H1 "main + elo1", with error rates alpha (an elo0
 * change passes) and beta (an elo1 change is buried). `minPairs` stops the test
 * from deciding on a handful of pairs, when the variance estimate is still unreliable, and
 * `maxPairs` caps the cost: reaching it undecided is "inconclusive", not a burial.
 *
 * Chosen with `harness/src/gate.sim.ts` (#195). Telling +30 from 0 at 5 % / 5 % takes about 300
 * pairs, more than a submit can afford, and nearly every candidate would come back inconclusive.
 * The gate therefore tests a regression of 20 against a gain of 30: a +30 change is buried about
 * 6 % of the time (the old rule: about 55 %), a change worth nothing passes about as often as it
 * did before (roughly 1 in 4), and a −30 change passes less often (about 7 %, against about 10 %).
 * The cap is 100 pairs; the suites hold at least 146 distinct openings, so every pair has its own.
 */
export type SprtSpec = {
  elo0: number;
  elo1: number;
  alpha: number;
  beta: number;
  minPairs: number;
  maxPairs: number;
};

export const GATE_SPRT: SprtSpec = {
  elo0: -20,
  elo1: 30,
  alpha: 0.1,
  beta: 0.05,
  minPairs: 8,
  maxPairs: Number(process.env.ARENA_GATE_MAX_PAIRS ?? 100),
};

/** The score of one pair (two games, colours swapped) in [0, 1]: (game1 + game2) / 2. */
export type PairScore = number;

export type SprtState = {
  pairs: number;
  /** Mean pair score of the candidate. */
  score: number;
  llr: number;
  lower: number;
  upper: number;
  /** Elo difference implied by the mean pair score (candidate minus main). */
  elo: number;
};

/** Smallest pair-score variance the test assumes, so that a run of identical pairs cannot decide alone. */
const VARIANCE_FLOOR = 0.01;

/**
 * Log-likelihood ratio of H1 over H0 for the pairs played so far: the normal approximation of the
 * generalised SPRT on pair scores (the "pentanomial" form). Pairs cancel each opening's colour
 * bias, so their variance is lower than that of single games.
 */
export const sprtState = (
  pairScores: PairScore[],
  spec: SprtSpec = GATE_SPRT,
): SprtState => {
  const n = pairScores.length;
  const lower = Math.log(spec.beta / (1 - spec.alpha));
  const upper = Math.log((1 - spec.beta) / spec.alpha);
  if (n === 0) return { pairs: 0, score: 0.5, llr: 0, lower, upper, elo: 0 };
  const mean = pairScores.reduce((a, b) => a + b, 0) / n;
  const variance = Math.max(
    pairScores.reduce((a, x) => a + (x - mean) ** 2, 0) / n,
    VARIANCE_FLOOR,
  );
  const s0 = expectedScore(spec.elo0);
  const s1 = expectedScore(spec.elo1);
  const llr = (n * (s1 - s0) * (2 * mean - s0 - s1)) / (2 * variance);
  const clamped = Math.min(Math.max(mean, 0.001), 0.999);
  const elo = -400 * Math.log10(1 / clamped - 1);
  return { pairs: n, score: mean, llr, lower, upper, elo };
};

export type GateVerdict = "pass" | "fail" | "inconclusive" | "continue";

/** The test's verdict after the pairs played so far. */
export const sprtVerdict = (
  pairScores: PairScore[],
  spec: SprtSpec = GATE_SPRT,
): GateVerdict => {
  const s = sprtState(pairScores, spec);
  if (s.pairs >= spec.minPairs) {
    if (s.llr >= s.upper) return "pass";
    if (s.llr <= s.lower) return "fail";
  }
  return s.pairs >= spec.maxPairs ? "inconclusive" : "continue";
};

/** Pair scores from per-game candidate scores in play order (game 2k and 2k+1 share an opening). */
export const pairScores = (gameScores: number[]): PairScore[] => {
  const out: PairScore[] = [];
  for (let i = 0; i + 1 < gameScores.length; i += 2)
    out.push((gameScores[i] + gameScores[i + 1]) / 2);
  return out;
};

/** One line for the board and the pull request: the test's state in plain numbers. */
export const describeSprt = (
  s: SprtState,
  spec: SprtSpec = GATE_SPRT,
): string =>
  `${s.pairs} pairs (${s.pairs * 2} games), score ${(s.score * 100).toFixed(1)}% (${s.elo >= 0 ? "+" : ""}${Math.round(s.elo)} Elo vs main), LLR ${s.llr.toFixed(2)} in [${s.lower.toFixed(2)}, ${s.upper.toFixed(2)}], H0 ${spec.elo0 >= 0 ? "+" : ""}${spec.elo0} vs H1 ${spec.elo1 >= 0 ? "+" : ""}${spec.elo1}, α = ${spec.alpha}, β = ${spec.beta}`;

/** Null when the candidate passes the gate, otherwise the burial reason. Never an inconclusive. */
export const gateShortfall = (opts: {
  verdict: GateVerdict;
  state: SprtState;
  currentVersion: string | null;
  spec?: SprtSpec;
}): string | null => {
  const { verdict, state, currentVersion, spec = GATE_SPRT } = opts;
  if (verdict === "pass") return null;
  if (verdict === "fail")
    return `The sequential test against ${currentVersion ?? "main"} decided no gain: ${describeSprt(state, spec)}.`;
  throw new Error(`gateShortfall: verdict ${verdict} is not a decision`);
};

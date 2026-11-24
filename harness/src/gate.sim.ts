/**
 * Monte Carlo check of the referee's gate (#195): how often a real gain is buried, how often no
 * gain passes, and how many games a submit costs, under the old rule and under the sequential test
 * in gate.ts. No engines are played; games are drawn from a simple model:
 *
 * - each game's expected score is logistic in the Elo gap, plus a first-player edge `colour` and a
 *   per-opening edge drawn from N(0, `openingSd`) for whoever moves first (pairs share an opening);
 * - a fixed share `draws` of the expected score is paid out as draws (chess-like 0.25, hex/go 0).
 *
 * The old rule: 20 pairs against a reference rung `rungGap` above main; the candidate's
 * performance rating must exceed main's stored rating (or main re-rated on the rung, when the rung
 * sits below the stored rating); then 10 pairs head to head with main must score at least half.
 * The stored rating is drawn as a winner's-curse sample: main's own 40-game rung rating,
 * conditioned on having beaten its predecessor (true strength 30 lower) by the same rule.
 *
 * Run: `npx tsx harness/src/gate.sim.ts [trials]`.
 */
import { performanceElo } from "@arena/shared";
import { expectedScore, GATE_SPRT, sprtVerdict, type SprtSpec } from "./gate";

type Model = { colour: number; openingSd: number; draws: number };

let seed = 195;
const rand = () => {
  // mulberry32: reproducible runs.
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () =>
  Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

/** One game's score for side A (gap = A − B), A moving first or second, from an opening edge. */
const game = (gap: number, aFirst: boolean, edge: number, m: Model) => {
  const e = expectedScore(gap + (aFirst ? edge : -edge));
  const d = Math.min(m.draws, 2 * Math.min(e, 1 - e));
  const r = rand();
  if (r < e - d / 2) return 1;
  if (r < e + d / 2) return 0.5;
  return 0;
};

/** Pair scores (each in [0, 1]) for `pairs` pairs of A vs B. */
const pairs = (gap: number, n: number, m: Model) =>
  Array.from({ length: n }, () => {
    const edge = m.colour + m.openingSd * gauss();
    return (game(gap, true, edge, m) + game(gap, false, edge, m)) / 2;
  });

const rating = (gapToRung: number, rungElo: number, n: number, m: Model) => {
  const ps = pairs(gapToRung, n, m);
  const score = ps.reduce((a, b) => a + b, 0) * 2;
  return performanceElo([{ opponentElo: rungElo, score, games: 2 * n }]).elo;
};

const MAIN = 1500;

/** The old gate: true = passed. Returns games played too. */
const oldGate = (delta: number, rungGap: number, m: Model) => {
  const rung = MAIN + rungGap;
  // Winner's curse: main's stored rating is its own 40-game sample that beat its predecessor.
  let stored = 0;
  for (;;) {
    stored = rating(-rungGap, rung, 20, m);
    const predecessor = rating(-rungGap - 30, rung, 20, m);
    if (stored > predecessor) break;
  }
  let games = 40;
  const cand = rating(delta - rungGap, rung, 20, m);
  let baseline = stored;
  if (rung < stored) {
    baseline = rating(-rungGap, rung, 20, m);
    games += 40;
  }
  if (cand <= baseline) return { pass: false, games };
  games += 20;
  const h2h = pairs(delta, 10, m);
  return { pass: h2h.reduce((a, b) => a + b, 0) >= 5, games };
};

/** The new gate: head to head under the SPRT, then the 40-game rung rating on a pass (report only). */
const newGate = (delta: number, spec: SprtSpec, m: Model) => {
  const ps: number[] = [];
  for (;;) {
    ps.push(...pairs(delta, 1, m));
    const v = sprtVerdict(ps, spec);
    if (v === "continue") continue;
    return { verdict: v, games: 2 * ps.length + (v === "pass" ? 40 : 0) };
  }
};

const trials = Number(process.argv[2] ?? 2000);
const models: Record<string, Model> = {
  "chess-like (draws 25%)": { colour: 35, openingSd: 60, draws: 0.25 },
  "hex/go-like (no draws, strong first move)": {
    colour: 60,
    openingSd: 120,
    draws: 0,
  },
};
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

for (const [name, m] of Object.entries(models)) {
  console.log(`\n## ${name}, ${trials} trials per row`);
  for (const rungGap of [60, -100]) {
    console.log(
      `\nOld rule, rung ${rungGap > 0 ? "above" : "below"} main by ${Math.abs(rungGap)}:`,
    );
    for (const delta of [-30, 0, 30, 60]) {
      let pass = 0;
      let games = 0;
      for (let i = 0; i < trials; i++) {
        const r = oldGate(delta, rungGap, m);
        pass += Number(r.pass);
        games += r.games;
      }
      console.log(
        `  true ${delta >= 0 ? "+" : ""}${delta}: pass ${pct(pass / trials)}, buried ${pct(1 - pass / trials)}, ${(games / trials).toFixed(0)} games`,
      );
    }
  }
  for (const spec of [
    GATE_SPRT,
    // The textbook test, for comparison: too costly, nearly everything ends inconclusive.
    { ...GATE_SPRT, elo0: 0, alpha: 0.05 },
  ]) {
    console.log(
      `\nSPRT H0 ${spec.elo0} / H1 +${spec.elo1}, α = ${spec.alpha}, β = ${spec.beta}, ${spec.minPairs}–${spec.maxPairs} pairs (games include the 40-game rung rating after a pass):`,
    );
    for (const delta of [-30, 0, 30, 60]) {
      const n = { pass: 0, fail: 0, inconclusive: 0 };
      let games = 0;
      let h2h = 0;
      for (let i = 0; i < trials; i++) {
        const r = newGate(delta, spec, m);
        n[r.verdict as keyof typeof n]++;
        games += r.games;
        h2h += r.games - (r.verdict === "pass" ? 40 : 0);
      }
      console.log(
        `  true ${delta >= 0 ? "+" : ""}${delta}: pass ${pct(n.pass / trials)}, buried ${pct(n.fail / trials)}, inconclusive ${pct(n.inconclusive / trials)}, ${(games / trials).toFixed(0)} games (${(h2h / trials).toFixed(0)} head to head)`,
      );
    }
  }
}

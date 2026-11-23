import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  flatMonteCarlo,
  formatSuite,
  GAMES,
  parseSuite,
  positionKey,
  randomOpening,
  rng,
  type GameId,
  type GameRules,
  type MatchResult,
  OPENING_PLIES,
  type OpeningSuite,
  type SuiteEntry,
} from "@arena/shared";
import { ARENA_ROOT, log, run } from "./config";
import { findBin, LineProcess } from "./engine";

/**
 * Balanced opening suites for the referee (#105). Each game's suite lives in
 * shared/src/openings/<game>.txt; `arena openings build <game>` regenerates it: draw random lines
 * with #103's generator, score each with the strongest reference available, keep the near-even
 * ones. Offline tooling only: engines never see the suite, only the positions it starts them in.
 */
export const suitePath = (game: GameId) =>
  resolve(ARENA_ROOT, "shared/src/openings", `${game}.txt`);

/** The checked-in suite for a game, or undefined when it has none (the referee then uses random lines). */
export const loadSuite = (game: GameId): OpeningSuite | undefined => {
  const path = suitePath(game);
  if (!existsSync(path)) return undefined;
  const suite = parseSuite(game, readFileSync(path, "utf8"));
  return suite.entries.length ? suite : undefined;
};

/** A repo-relative name for the suite, for logs and PR evidence. */
export const suiteName = (game: GameId) => relative(ARENA_ROOT, suitePath(game));

/** Scores openings from the first player's point of view, in the reference's own unit. */
type Scorer = {
  /** What scored the suite, for the file header. */
  reference: string;
  unit: string;
  /** Admit an opening whose score lies in [lo, hi]. */
  lo: number;
  hi: number;
  /** Score a batch of openings (null: unusable, e.g. a forced mate or a resignation). */
  score: (lines: string[][]) => Promise<(number | null)[]>;
  /** How many openings `score` should get at a time. */
  batch: number;
  close: () => Promise<void>;
};

/** Plies of random moves per suite entry: deeper than #103 where 4 plies give too few positions. */
export const SUITE_PLIES: Record<GameId, number> = {
  chess: 4,
  othello: 6,
  go9: 2,
  hex: 2,
};

/**
 * Moves a suite candidate may use, where the reference cannot be trusted to judge the rest. GNU Go
 * self-play misjudges first- and second-line openings on 9×9 (e5 a1 came out W+36.5, f6 a2 W+0.5),
 * so Go candidates keep to the third to seventh lines (c3–g7), where 9×9 openings are played.
 */
const CANDIDATE_MOVES: Partial<Record<GameId, (move: string) => boolean>> = {
  go9: (m) => {
    if (m === "pass") return false;
    const col = "abcdefghj".indexOf(m[0]);
    const row = Number(m.slice(1)) - 1;
    return col >= 2 && col <= 6 && row >= 2 && row <= 6;
  },
};

/** #103's random opening, drawn only from `CANDIDATE_MOVES` where a game has a filter. */
const candidateLine = <S>(rules: GameRules<S>, plies: number, rand: () => number): string[] | null => {
  const allow = CANDIDATE_MOVES[rules.id];
  if (!allow) return randomOpening(rules, plies, rand);
  let state = rules.initial();
  const moves: string[] = [];
  for (let i = 0; i < plies; i++) {
    const legal = rules.legalMoves(state).filter(allow);
    if (!legal.length || rules.outcome(state) !== null) return null;
    const m = legal[Math.floor(rand() * legal.length)];
    state = rules.play(state, m);
    moves.push(m);
  }
  return rules.outcome(state) === null ? moves : null;
};

/** Digits each game's scores are written with. */
const SCORE_DIGITS: Record<GameId, number> = { chess: 2, othello: 0, go9: 2, hex: 1 };

const replay = <S>(rules: GameRules<S>, line: string[]) =>
  line.reduce((s, m) => rules.play(s, m), rules.initial());

/** First player's view from a side-to-move score. */
const firstView = <S>(rules: GameRules<S>, line: string[], v: number) =>
  rules.toMove(replay(rules, line)) === 0 ? v : -v;

/** Stockfish at a fixed depth, one thread, fresh hash per position: deterministic. Pawns. */
const stockfishScorer = async (depth: number): Promise<Scorer> => {
  const p = new LineProcess(findBin("stockfish", "STOCKFISH_BIN"), []);
  p.send("uci");
  await p.until((l) => l === "uciok");
  p.send("setoption name Threads value 1");
  p.send("setoption name Hash value 16");
  const rules = GAMES.chess;
  return {
    reference: `Stockfish, depth ${depth}, 1 thread`,
    unit: "pawns, White's view",
    lo: -0.5,
    hi: 0.5,
    batch: 1,
    score: async ([line]) => {
      p.send("ucinewgame");
      p.send("isready");
      await p.until((l) => l === "readyok");
      p.send(`position startpos moves ${line.join(" ")}`);
      p.send(`go depth ${depth}`);
      let last: number | null = null;
      for (;;) {
        const l = await p.next();
        if (l.startsWith("bestmove")) break;
        const m = / score (cp|mate) (-?\d+)/.exec(l);
        if (m && l.includes(" pv ") && !/(lower|upper)bound/.test(l)) last = m[1] === "cp" ? Number(m[2]) / 100 : null;
      }
      return [last === null ? null : firstView(rules, line, last)];
    },
    close: () => p.close(),
  };
};

/** Edax's problem solver at a fixed level, batched through one OBF file. Discs. */
const edaxScorer = async (level: number, scratch: string): Promise<Scorer> => {
  const bin = findBin("lEdax-x86-64", "EDAX_BIN");
  const rules = GAMES.othello;
  const obf = (line: string[]) => {
    const s = replay(rules, line);
    const b = rules.board(s);
    const cells = b.cells.map((c) => (c === "b" ? "X" : c === "w" ? "O" : "-")).join("");
    return `${cells} ${rules.toMove(s) === 0 ? "X" : "O"};`;
  };
  return {
    reference: `Edax, level ${level}, book off, 1 task`,
    unit: "discs, Black's view",
    lo: -4,
    hi: 4,
    batch: 50,
    score: async (lines) => {
      const file = resolve(scratch, "suite.obf");
      writeFileSync(file, lines.map(obf).join("\n") + "\n");
      const res = await run(
        bin,
        ["-solve", file, "-l", String(level), "-n", "1", "-book-usage", "off"],
        { cwd: dirname(bin) },
      );
      const scores = new Map<number, number>();
      for (const l of res.stdout.split("\n")) {
        const m = /^\s*(\d+)\|\s*\S+\s+([+-]\d+)/.exec(l);
        if (m) scores.set(Number(m[1]) - 1, Number(m[2]));
      }
      return lines.map((line, i) => {
        const v = scores.get(i);
        return v === undefined ? null : firstView(rules, line, v);
      });
    },
    close: async () => {},
  };
};

/**
 * GNU Go self-play from the opening, averaged over `samples` seeded games (one game is too noisy:
 * margins vary by ±10 points between seeds). Chinese rules, komi 7.5. Points, Black's view.
 */
const gnugoScorer = async (
  level: number,
  samples: number,
  jobs: number,
): Promise<Scorer> => {
  const procs = Array.from({ length: jobs }, () => {
    const p = new LineProcess(findBin("gnugo", "GNUGO_BIN"), [
      "--mode",
      "gtp",
      "--level",
      String(level),
      "--chinese-rules",
    ]);
    const cmd = async (c: string) => {
      p.send(c);
      const reply = await p.until((l) => l.startsWith("=") || l.startsWith("?"));
      await p.next();
      if (reply.startsWith("?")) throw new Error(`gnugo: ${c}: ${reply}`);
      return reply.slice(1).trim();
    };
    return { p, cmd };
  });
  let ready = false;
  const selfPlay = async (cmd: (c: string) => Promise<string>, line: string[], seed: number) => {
    await cmd("clear_board");
    await cmd(`set_random_seed ${seed}`);
    for (const [i, m] of line.entries()) await cmd(`play ${i % 2 === 0 ? "b" : "w"} ${m}`);
    let passes = 0;
    for (let ply = line.length; ply < 200 && passes < 2; ply++) {
      const colour = ply % 2 === 0 ? "b" : "w";
      const mv = (await cmd(`genmove ${colour}`)).toLowerCase();
      if (mv === "resign") return colour === "b" ? -81 : 81;
      passes = mv === "pass" ? passes + 1 : 0;
    }
    const s = await cmd("final_score");
    const m = /^([BW])\+([\d.]+)/.exec(s);
    return m ? (m[1] === "B" ? 1 : -1) * Number(m[2]) : 0;
  };
  return {
    reference: `GNU Go level ${level} self-play, mean of ${samples} seeded games, Chinese rules, komi 7.5`,
    unit: "points, Black's view",
    lo: -3,
    hi: 3,
    batch: jobs,
    score: async (lines) => {
      if (!ready) {
        for (const { cmd } of procs) {
          await cmd("boardsize 9");
          await cmd("komi 7.5");
        }
        ready = true;
      }
      return Promise.all(
        lines.map(async (line, i) => {
          const { cmd } = procs[i];
          let sum = 0;
          for (let k = 0; k < samples; k++) sum += await selfPlay(cmd, line, k + 1);
          return sum / samples;
        }),
      );
    },
    close: async () => {
      for (const { p } of procs) await p.close();
    },
  };
};

/**
 * The ladder's flat Monte Carlo search; a position's value is its most-visited root move's win
 * rate, in percent, Black's view. That estimate favours the side to move by ~18 points even on the
 * empty board (Black there: ~68%), and Hex has no swap rule, so a fixed 45–55% window admits nothing.
 * The window is centred on the empty board's own value instead: kept openings leave the balance
 * where the game itself starts, within ±4 points. Hex lines have even length, so Black is to move
 * in both.
 */
const mctsScorer = (playouts: number, seed: number): Scorer => {
  const rules = GAMES.hex;
  const value = (line: string[]) => {
    // One generator per opening, from its moves, so a line's score does not depend on its order.
    const key = [...line.join(" ")].reduce(
      (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619),
      seed >>> 0,
    );
    const state = replay(rules, line);
    const v = flatMonteCarlo(rules, state, playouts, rng(key)).value;
    return Math.round((rules.toMove(state) === 0 ? v : 1 - v) * 1000) / 10;
  };
  const empty = value([]);
  return {
    reference: `flat MCTS, ${playouts} playouts (the Hex ladder's search), seed ${seed}; the empty board scores ${empty}%`,
    unit: "% first-player win rate (empty board ± 4)",
    lo: Math.round((empty - 4) * 10) / 10,
    hi: Math.round((empty + 4) * 10) / 10,
    batch: 1,
    score: async ([line]) => [value(line)],
    close: async () => {},
  };
};

export type BuildOptions = {
  count: number;
  seed: number;
  out?: string;
  /** Reference strength: Stockfish depth, Edax level, GNU Go level, or MCTS playouts. */
  strength?: number;
  /** GNU Go: seeded self-play games per opening. */
  samples?: number;
  /** GNU Go: parallel processes (offline tooling, not an engine). */
  jobs?: number;
  scratch: string;
};

const DEFAULT_STRENGTH: Record<GameId, number> = {
  chess: 14,
  othello: 16,
  go9: 5,
  hex: 20000,
};

const scorerFor = (game: GameId, o: BuildOptions): Promise<Scorer> | Scorer => {
  const strength = o.strength ?? DEFAULT_STRENGTH[game];
  switch (game) {
    case "chess":
      return stockfishScorer(strength);
    case "othello":
      return edaxScorer(strength, o.scratch);
    case "go9":
      return gnugoScorer(strength, o.samples ?? 6, o.jobs ?? 4);
    case "hex":
      return mctsScorer(strength, o.seed);
  }
};

/**
 * Build a suite: random lines from `seed` (#103's generator, `SUITE_PLIES` deep), one per
 * distinct position, scored in order; the first `count` inside the bounds are kept. The same
 * seed and options give the same file.
 */
export const buildSuite = async (game: GameId, o: BuildOptions) => {
  const rules = GAMES[game];
  const plies = SUITE_PLIES[game];
  const scorer = await scorerFor(game, o);
  const rand = rng(o.seed);
  const seen = new Set<string>();
  const kept: SuiteEntry[] = [];
  let scored = 0;
  const maxCandidates = o.count * 30;
  try {
    while (kept.length < o.count && seen.size < maxCandidates) {
      const batch: string[][] = [];
      let misses = 0;
      while (batch.length < scorer.batch && misses < 1000) {
        const line = candidateLine(rules, plies, rand);
        // Positions where the side to move can only pass are not useful starts.
        const legal = line ? rules.legalMoves(replay(rules, line)) : [];
        if (!line || (legal.length === 1 && legal[0] === "pass")) {
          misses++;
          continue;
        }
        const key = positionKey(rules, replay(rules, line));
        if (seen.has(key)) {
          misses++;
          continue;
        }
        seen.add(key);
        batch.push(line);
      }
      if (!batch.length) break;
      const scores = await scorer.score(batch);
      // Count only up to the opening that filled the suite, so the header does not depend on
      // the batch size (--jobs).
      for (const [i, s] of scores.entries()) {
        if (kept.length >= o.count) break;
        scored++;
        if (s !== null && s >= scorer.lo && s <= scorer.hi) kept.push({ moves: batch[i], score: s });
      }
      log(`${game}: ${kept.length}/${o.count} kept of ${scored} scored`);
    }
  } finally {
    await scorer.close();
  }
  const suite: OpeningSuite = {
    game,
    entries: kept,
    header: [
      `Balanced ${rules.name} openings for the referee (#105): ${kept.length} of ${scored} random ${plies}-ply lines.`,
      `Rebuild: npm run arena -- openings build ${game} --count ${o.count} --seed ${o.seed}${o.strength !== undefined ? ` --strength ${o.strength}` : ""}${o.samples !== undefined ? ` --samples ${o.samples}` : ""}`,
      `Scored by: ${scorer.reference}.`,
      ...(CANDIDATE_MOVES[game] ? ["Candidates: moves on the third to seventh lines only (c3–g7); the reference misjudges edge openings."] : []),
      `Kept: score in [${scorer.lo}, ${scorer.hi}] ${scorer.unit}. One line per opening: moves, a tab, the score.`,
    ],
  };
  const out = o.out ?? suitePath(game);
  writeFileSync(out, formatSuite(suite, SCORE_DIGITS[game]));
  log(`wrote ${relative(ARENA_ROOT, out)}: ${kept.length} openings`);
  if (kept.length < o.count)
    log(`only ${kept.length} of ${o.count}: widen the search (--count, --seed) or the reference`);
  return suite;
};

/** One line for the PR evidence: where each pair's opening came from, and which entries. */
export const openingsNote = (
  game: GameId,
  result: Pick<MatchResult, "openingSource" | "openingEntries">,
  seed: number,
) =>
  result.openingSource === "suite" && result.openingEntries
    ? `each pair started from its own balanced suite entry (\`${suiteName(game)}\`), seed \`${seed}\`; gate entries ${result.openingEntries.map((i) => i + 1).join(", ")} (1-based, in file order). The same-rung baseline replays these entries and the head-to-head the first of them, one per pair.`
    : `each pair started from its own random ${OPENING_PLIES[game]}-ply opening (no usable suite), seed \`${seed}\` (gate and head-to-head alike; same seed, same openings).`;

import { isEye, goParse, goScore, GO_SIZE, type GoState } from "./games/go9";
import type { GameRules, Outcome } from "./games/types";

/** Deterministic PRNG (mulberry32) so reference players are reproducible. */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type Rand = () => number;

/** Anything that can pick a move: a built-in reference player or an engine process. */
export type Mover = {
  id: string;
  choose: <S>(rules: GameRules<S>, state: S) => Promise<string>;
  close?: () => Promise<void>;
};

/** Moves a sensible random player would consider (Go: never fill your own eye). */
const playoutMoves = <S>(rules: GameRules<S>, state: S): string[] => {
  const moves = rules.legalMoves(state);
  if (rules.id !== "go9") return moves;
  const s = state as unknown as {
    cells: (("b" | "w") | null)[];
    turn: "b" | "w";
  };
  const filtered = moves.filter(
    (m) => m !== "pass" && !isEye(s.cells, goParse(m), s.turn),
  );
  return filtered.length ? filtered : ["pass"];
};

const pick = <T>(xs: T[], rand: Rand) => xs[Math.floor(rand() * xs.length)];

export const randomPlayer = (seed = 1): Mover => {
  const rand = rng(seed);
  return {
    id: "random",
    choose: async (rules, state) => pick(playoutMoves(rules, state), rand),
  };
};

// ---- Fast Go playouts -------------------------------------------------------------------------
// The rules library copies the board, serialises it and scans the whole history for superko on
// every candidate move: right for refereeing, but quadratic per playout, which made the MCTS
// reference spend ~30 s per Go move. Playouts here run on one mutable board instead. They pick
// uniformly among the same moves (not suicide, not filling your own single-point eye), with the
// same seeded randomness; inside a playout, simple ko replaces positional superko, as is standard
// for Monte Carlo playouts. Root moves and the referee still use the full rules.
const GN = GO_SIZE;
const GO_NEIGHBOURS = Array.from({ length: GN * GN }, (_, i) => {
  const r = Math.floor(i / GN);
  const c = i % GN;
  const out: number[] = [];
  if (r > 0) out.push(i - GN);
  if (r < GN - 1) out.push(i + GN);
  if (c > 0) out.push(i - 1);
  if (c < GN - 1) out.push(i + 1);
  return out;
});

/** Mutable 9x9 board for playouts: 0 empty, 1 black, 2 white. */
export const fastGoRollout = (
  start: GoState,
  maxPlies: number,
  rand: Rand,
): Outcome => {
  const board = new Int8Array(GN * GN);
  start.cells.forEach((c, i) => (board[i] = c === "b" ? 1 : c === "w" ? 2 : 0));
  const mark = new Int32Array(GN * GN);
  let stamp = 0;
  const stack: number[] = [];

  /** Collect the group at i into `stack`; true when it has a liberty. */
  const groupHasLiberty = (i: number) => {
    const p = board[i];
    stamp++;
    stack.length = 0;
    stack.push(i);
    mark[i] = stamp;
    let liberty = false;
    for (let k = 0; k < stack.length; k++) {
      for (const n of GO_NEIGHBOURS[stack[k]]) {
        const v = board[n];
        if (v === 0) liberty = true;
        else if (v === p && mark[n] !== stamp) {
          mark[n] = stamp;
          stack.push(n);
        }
      }
    }
    return liberty;
  };

  /** Play p at i if legal (not suicide, not the ko point). Returns false and leaves the board unchanged otherwise. */
  let koPoint = -1;
  const tryPlay = (i: number, p: number) => {
    if (board[i] !== 0 || i === koPoint) return false;
    const opp = 3 - p;
    board[i] = p;
    let captured = 0;
    let capturedAt = -1;
    for (const n of GO_NEIGHBOURS[i]) {
      if (board[n] === opp && !groupHasLiberty(n)) {
        captured += stack.length;
        capturedAt = n;
        for (const s of stack) board[s] = 0;
      }
    }
    if (!groupHasLiberty(i)) {
      board[i] = 0; // suicide (no capture could have happened, or it would have a liberty)
      return false;
    }
    // Simple ko: a single stone that captured exactly one stone and has exactly one liberty.
    koPoint = captured === 1 && stack.length === 1 ? capturedAt : -1;
    return true;
  };

  const isOwnEye = (i: number, p: number) => {
    for (const n of GO_NEIGHBOURS[i]) if (board[n] !== p) return false;
    return true;
  };

  let turn = start.turn === "b" ? 1 : 2;
  let passes = start.passes;
  let plies = start.moves.length;
  const candidates: number[] = [];
  while (passes < 2 && plies < maxPlies) {
    candidates.length = 0;
    for (let i = 0; i < GN * GN; i++)
      if (board[i] === 0 && !isOwnEye(i, turn)) candidates.push(i);
    let played = false;
    // Uniform over the legal candidates: draw, and drop any that turn out illegal.
    while (candidates.length) {
      const k = Math.floor(rand() * candidates.length);
      const i = candidates[k];
      if (tryPlay(i, turn)) {
        played = true;
        break;
      }
      candidates[k] = candidates[candidates.length - 1];
      candidates.pop();
    }
    if (played) passes = 0;
    else {
      passes++;
      koPoint = -1;
    }
    turn = 3 - turn;
    plies++;
  }
  const cells = Array.from(board, (v) =>
    v === 1 ? "b" : v === 2 ? "w" : null,
  ) as GoState["cells"];
  return goScore(cells) > 0 ? 1 : 0;
};

const rollout = <S>(rules: GameRules<S>, start: S, rand: Rand): Outcome => {
  if (rules.id === "go9")
    return fastGoRollout(start as unknown as GoState, rules.maxPlies, rand);
  let s = start;
  for (;;) {
    const o = rules.outcome(s);
    if (o !== null) return o;
    if (rules.plies(s) >= rules.maxPlies) return rules.adjudicate(s);
    s = rules.play(s, pick(playoutMoves(rules, s), rand));
  }
};

/**
 * Flat Monte Carlo with UCB1 over root moves. Cheap, rules-only, and its strength scales
 * with `playouts`, which makes it a usable reference ladder for every game.
 */
export const mctsPlayer = (playouts: number, seed = 7): Mover => {
  const rand = rng(seed);
  return {
    id: `mcts-${playouts}`,
    choose: async (rules, state) => {
      const moves = playoutMoves(rules, state);
      if (moves.length === 1) return moves[0];
      // Shuffle so that unvisited moves (and ties) are broken at random, not by board order.
      for (let i = moves.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [moves[i], moves[j]] = [moves[j], moves[i]];
      }
      const me = rules.toMove(state);
      const wins = new Array(moves.length).fill(0);
      const visits = new Array(moves.length).fill(0);
      const children = moves.map((m) => rules.play(state, m));
      for (let n = 0; n < playouts; n++) {
        let best = 0;
        let bestUcb = -Infinity;
        for (let i = 0; i < moves.length; i++) {
          const ucb =
            visits[i] === 0
              ? Infinity
              : wins[i] / visits[i] +
                Math.sqrt((2 * Math.log(n + 1)) / visits[i]);
          if (ucb > bestUcb) {
            bestUcb = ucb;
            best = i;
          }
        }
        const o = rollout(rules, children[best], rand);
        wins[best] += me === 0 ? o : 1 - o;
        visits[best] += 1;
      }
      const value = (i: number) =>
        visits[i] + (visits[i] ? wins[i] / visits[i] : 0);
      let choice = 0;
      for (let i = 1; i < moves.length; i++)
        if (value(i) > value(choice)) choice = i;
      return moves[choice];
    },
  };
};

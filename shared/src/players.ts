import { isEye, goParse } from './games/go9';
import type { GameRules, Outcome } from './games/types';

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
  if (rules.id !== 'go9') return moves;
  const s = state as unknown as { cells: (('b' | 'w') | null)[]; turn: 'b' | 'w' };
  const filtered = moves.filter((m) => m !== 'pass' && !isEye(s.cells, goParse(m), s.turn));
  return filtered.length ? filtered : ['pass'];
};

const pick = <T>(xs: T[], rand: Rand) => xs[Math.floor(rand() * xs.length)];

export const randomPlayer = (seed = 1): Mover => {
  const rand = rng(seed);
  return {
    id: 'random',
    choose: async (rules, state) => pick(playoutMoves(rules, state), rand),
  };
};

const rollout = <S>(rules: GameRules<S>, start: S, rand: Rand): Outcome => {
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
              : wins[i] / visits[i] + Math.sqrt((2 * Math.log(n + 1)) / visits[i]);
          if (ucb > bestUcb) {
            bestUcb = ucb;
            best = i;
          }
        }
        const o = rollout(rules, children[best], rand);
        wins[best] += me === 0 ? o : 1 - o;
        visits[best] += 1;
      }
      const value = (i: number) => visits[i] + (visits[i] ? wins[i] / visits[i] : 0);
      let choice = 0;
      for (let i = 1; i < moves.length; i++) if (value(i) > value(choice)) choice = i;
      return moves[choice];
    },
  };
};

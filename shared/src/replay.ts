import { chess } from './games/chess';
import { go9 } from './games/go9';
import { hex } from './games/hex';
import { othello } from './games/othello';
import type { BoardView, GameId, GameRules } from './games/types';

const RULES: Record<GameId, GameRules<unknown>> = {
  chess: chess as GameRules<unknown>,
  go9: go9 as GameRules<unknown>,
  othello: othello as GameRules<unknown>,
  hex: hex as GameRules<unknown>,
};

/** Board views after each ply of a recorded game, starting with the initial position. */
export const replayBoards = (game: GameId, moves: string[]): BoardView[] => {
  const rules = RULES[game];
  let state = rules.initial();
  const out = [rules.board(state)];
  for (const m of moves) {
    state = rules.play(state, m);
    out.push(rules.board(state));
  }
  return out;
};

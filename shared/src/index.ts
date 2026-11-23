import { chess } from './games/chess';
import { go9 } from './games/go9';
import { hex } from './games/hex';
import { othello } from './games/othello';
import type { GameId, GameRules } from './games/types';

export * from './games/types';
export { chess, go9, hex, othello };
export * from './elo';
export * from './players';
export * from './referee';
export * from './openings';
export * from './model';
export * from './tracks';
export * from './replay';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAMES: Record<GameId, GameRules<any>> = { chess, go9, othello, hex };
export type { ChessState } from './games/chess';
export type { GoState } from './games/go9';
export { goSquare, goParse } from './games/go9';
export type { OthelloState } from './games/othello';
export type { HexState } from './games/hex';
export * from './names';
export * from './discussion';

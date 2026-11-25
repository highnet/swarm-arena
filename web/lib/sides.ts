import { GAMES, type GameId } from '@arena/shared';
import { SHORT_NAME } from './tracks';

/**
 * Who plays which colour, named one way everywhere a game is shown (#263).
 *
 * The referee stores the candidate as a bare version ("v0.6", or "candidate" before it has one)
 * and its opponent as a label: a reference ("Stockfish level 4", "GNU Go level 8", "Edax level
 * 6", "Random mover"), or the version on main, written by whichever harness path played it
 * ("Hex 11×11 v0.5", "main v0.5"). Gate matches against main then read "Hex v0.6 (candidate)"
 * against "Hex v0.5 (main)", and every other opponent keeps its real name.
 */

/** The stone or piece colour, as the boards draw it: 'b' Black, 'w' White. */
export type SideColor = 'b' | 'w';

export type Side = {
  /** "Hex v0.6 (candidate)", "Hex v0.5 (main)", "Stockfish level 4". */
  name: string;
  color: SideColor;
  /** "Black" or "White", from the rules library. */
  colorName: string;
  /** The arena engine (true) or its opponent. */
  engine: boolean;
};

/** "v0.5" in "Hex 11×11 v0.5" or "main v0.5": an opponent that is a version of our own engine. */
const MAIN_VERSION = /(?:^|\s)(v\d+(?:\.\d+)*)$/;
/** Versions the referee stores for a build that has no number yet. */
const UNNUMBERED = new Set(['candidate', 'local', '']);

/** Is this opponent label the engine's own version on main? */
const mainVersionOf = (opponent: string): string | null | undefined => {
  if (opponent === 'main') return null;
  return opponent.match(MAIN_VERSION)?.[1];
};

/** Both sides' names for a match or live game, before colours are known. */
export const sideNames = (
  track: GameId,
  engineVersion: string | null | undefined,
  opponent: string | null | undefined,
): { engine: string; opponent: string } => {
  const game = SHORT_NAME[track];
  const main = opponent ? mainVersionOf(opponent) : undefined;
  const vsMain = main !== undefined;
  const numbered = engineVersion && !UNNUMBERED.has(engineVersion);
  const engine = numbered ? `${game} ${engineVersion}` : game;
  return {
    engine: vsMain || !numbered ? `${engine} (candidate)` : engine,
    opponent: vsMain ? `${main ? `${game} ${main}` : game} (main)` : (opponent ?? 'Opponent'),
  };
};

/** The two sides of one game, in move order: [first, second], each with its colour. */
export const gameSides = (
  track: GameId,
  engineVersion: string | null | undefined,
  opponent: string | null | undefined,
  engineFirst: boolean,
): [Side, Side] => {
  const names = sideNames(track, engineVersion, opponent);
  const [firstColor, secondColor] = GAMES[track].playerLabels;
  const order: [SideColor, SideColor] = track === 'chess' ? ['w', 'b'] : ['b', 'w'];
  const side = (i: 0 | 1, engine: boolean): Side => ({
    name: engine ? names.engine : names.opponent,
    color: order[i],
    colorName: i === 0 ? firstColor : secondColor,
    engine,
  });
  return [side(0, engineFirst), side(1, !engineFirst)];
};

/** The colour the engine played in a game: 'b' or 'w'. */
export const engineColor = (track: GameId, engineFirst: boolean): SideColor =>
  gameSides(track, null, null, engineFirst).find((s) => s.engine)!.color;

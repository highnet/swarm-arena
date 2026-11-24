'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { replayBoards } from '@arena/shared';
import type { EngineGame } from '@/lib/swarmEvents';
import { gameHref } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { BoardView } from './BoardView';

/** Milliseconds per ply on the thumbnail: a quick replay, not a study. */
const PLY_MS = 140;

/**
 * Where the board's game comes from. `finished`: the engine's latest finished game, replayed
 * quickly. `live`: a game in progress (from `live_games`), followed move by move as its moves
 * arrive. The component is the same for both, so the live feed only has to supply the source.
 */
export type EngineBoardSource =
  | { kind: 'finished'; game: EngineGame }
  | { kind: 'live'; game: Omit<EngineGame, 'result'> & { result: null } };

const RESULT: Record<EngineGame['result'], string> = { win: 'won', loss: 'lost', draw: 'drew' };

type EngineBoardProps = {
  source: EngineBoardSource;
  reducedMotion: boolean;
  className?: string;
};

/**
 * The engine's game, small, on its graph node: the `GameReplay` board at thumbnail size with
 * the opponent and move number under it. A newer game waits for the current replay to finish,
 * as `ReplayHold` does on the home page. Opens the game's page on click.
 */
const EngineBoard = ({ source, reducedMotion, className }: EngineBoardProps) => {
  const [shown, setShown] = useState(source);
  const [ply, setPly] = useState(0);
  const live = shown.kind === 'live';
  const boards = useMemo(
    () => replayBoards(shown.game.track, shown.game.moves),
    [shown.game.track, shown.game.moves],
  );
  const last = boards.length - 1;
  // A live game sits on its newest move; a finished one replays unless motion is reduced.
  const at = live || reducedMotion ? last : Math.min(ply, last);

  // Adjust during render: fresher moves of the same game are taken at once; a different game
  // takes over once this replay has reached its end (or straight away if nothing is replaying).
  if (source !== shown) {
    if (source.game.id === shown.game.id) setShown(source);
    else if (at >= last) {
      setShown(source);
      setPly(0);
    }
  }

  useEffect(() => {
    if (live || reducedMotion || ply >= last) return;
    const t = setTimeout(() => setPly((p) => p + 1), PLY_MS);
    return () => clearTimeout(t);
  }, [live, reducedMotion, ply, last]);

  const g = shown.game;
  // Chess counts a move per pair of plies; the other games, one per stone or disc.
  const move = g.track === 'chess' ? Math.ceil(at / 2) : at;
  const caption = `vs ${g.opponent} · move ${move}`;
  const status = live
    ? 'live'
    : at >= last && shown.kind === 'finished'
      ? RESULT[shown.game.result]
      : null;

  return (
    <Link
      href={gameHref(g.id)}
      data-slot="engine-board"
      className={cn(
        'group/board block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-fg-3',
        className,
      )}
      aria-label={`${live ? 'Live game' : 'Latest game'} ${caption}`}
    >
      <div className="w-16 overflow-hidden rounded border border-line bg-panel">
        <BoardView game={g.track} view={boards[at]} label={caption} />
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-3 text-fg-3 group-hover/board:text-fg-2">
        {live && (
          <span className="size-1.5 animate-pulse-dot rounded-full bg-good" aria-hidden="true" />
        )}
        <span className="truncate">{caption}</span>
        {status && !live && <span className="shrink-0 text-fg-2">· {status}</span>}
      </div>
    </Link>
  );
};

export { EngineBoard };

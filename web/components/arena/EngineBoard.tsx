'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { replayBoards, type BoardView as BoardViewData, type GameId } from '@arena/shared';
import { boardMotion } from '@/lib/boardMotion';
import type { EngineGame } from '@/lib/swarmEvents';
import { gameHref } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { BoardView } from './BoardView';

/** Milliseconds per ply when replaying a finished game (the graph's replay mode). */
const PLY_MS = 140;
/** Milliseconds per ply following a live game: slower with one ply waiting, faster with more. */
const paceMs = (waiting: number) => (waiting <= 1 ? 560 : waiting <= 3 ? 450 : 350);
/** More plies than this waiting (a long batch, a hidden tab) and the board jumps near to now. */
const CATCH_UP = 8;
/** Plies still animated after such a jump. */
const AFTER_JUMP = 2;
/** A finished game holds its final position and result this long. */
const HOLD_MS = 2_000;
/** The last game's loop: milliseconds per ply (about twice live speed), and the pause at its end. */
const LOOP_PLY_MS = 280;
const LOOP_PAUSE_MS = 1_500;

/**
 * Where the board's game comes from. `finished`: a finished game, replayed quickly (the fleet
 * graph's replay mode). `live`: a game in progress (from `live_games`), played ply by ply as its
 * moves arrive. `ended`: the engine's last live game, over (result null until the stored game is
 * seen): played out, held with its result, then looped until a new game starts, and `fading`
 * once the engine has had no live game for long enough (#163, #171).
 */
export type EngineBoardSource =
  | { kind: 'finished'; game: EngineGame }
  | { kind: 'live'; game: Omit<EngineGame, 'result'> & { result: null } }
  | {
      kind: 'ended';
      game: Omit<EngineGame, 'result'> & { result: EngineGame['result'] | null };
      fading: boolean;
    };

const RESULT: Record<EngineGame['result'], string> = { win: 'won', loss: 'lost', draw: 'draw' };

/**
 * `play`: stepping towards the newest ply. `hold`: an ended game's final position and result.
 * `next`: the hold (or a loop) is over; take the waiting game or loop again. `loop` / `pause`:
 * the last game replaying, and resting at its end. `rest`: a final position with motion reduced.
 */
type Phase = 'play' | 'hold' | 'next' | 'loop' | 'pause' | 'rest';

/** The previous game's last position, fading out over the next one. */
type Outgoing = { track: GameId; view: BoardViewData; key: number };

type Playback = {
  shown: EngineBoardSource;
  ply: number;
  phase: Phase;
  /** Counts animated steps: each one restarts the cells' animations. */
  step: number;
  /** Whether the step into `ply` animates (a jump or a new game does not). */
  animated: boolean;
  out: Outgoing | null;
};

const startPly = (s: EngineBoardSource) => (s.kind === 'finished' ? 0 : s.game.moves.length);

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
};
const isVisible = () => document.visibilityState !== 'hidden';

type EngineBoardProps = {
  source: EngineBoardSource;
  reducedMotion: boolean;
  className?: string;
};

/**
 * The engine's game, small, inside its graph node, with the opponent and move number under it.
 * The board is centred in the link's width and the caption is one truncated line of fixed
 * height, so nothing the caption says moves the board (#199). A
 * live game plays ply by ply at a steady pace however its moves arrive; an ended one holds its
 * result, then loops, dimmed, until the next game cross-fades in (#171). Pauses while the tab is
 * hidden. With motion reduced it shows each batch's position, holds the result, and never loops.
 * Opens the game's page on click.
 */
const EngineBoard = ({ source, reducedMotion, className }: EngineBoardProps) => {
  const [pb, setPb] = useState<Playback>(() => ({
    shown: source,
    ply: startPly(source),
    phase: 'play',
    step: 0,
    animated: false,
    out: null,
  }));
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  const { shown, phase } = pb;
  const kind = shown.kind;
  const boards = useMemo(
    () => replayBoards(shown.game.track, shown.game.moves),
    [shown.game.track, shown.game.moves],
  );
  const last = boards.length - 1;
  const ply = Math.min(pb.ply, last);
  // Reduced motion: a finished replay and each live batch show their newest position at once.
  const at = reducedMotion && phase === 'play' ? last : ply;

  // Adjust during render. Fresher moves (or the end, or the result) of the same game are taken
  // at once. A different game waits for this one: a replay or a live game until its moves are
  // shown, an ended game until its result has been held.
  const switchTo = (next: EngineBoardSource): Playback => ({
    shown: next,
    ply: startPly(next),
    phase: 'play',
    step: pb.step + 1,
    animated: false,
    out:
      reducedMotion || kind === 'finished'
        ? null
        : { track: shown.game.track, view: boards[at], key: pb.step + 1 },
  });
  if (source !== shown && source.game.id === shown.game.id) {
    setPb({ ...pb, shown: source });
  } else if (source.game.id !== shown.game.id) {
    const ready =
      kind === 'ended'
        ? phase === 'next' || phase === 'loop' || phase === 'pause' || phase === 'rest'
        : at >= last;
    if (ready) setPb(switchTo(source));
  } else if (phase === 'next') {
    // Nothing new: replay the last game from its start (motion reduced: stay on its end).
    setPb(
      reducedMotion
        ? { ...pb, phase: 'rest' }
        : {
            ...pb,
            phase: 'loop',
            ply: 0,
            animated: false,
            out: { track: shown.game.track, view: boards[at], key: pb.step + 1 },
            step: pb.step + 1,
          },
    );
  }

  useEffect(() => {
    if (!visible) return;
    let wait: number;
    let step: (p: Playback) => Playback;
    if (kind === 'finished') {
      if (reducedMotion || ply >= last) return;
      wait = PLY_MS;
      step = (p) => ({ ...p, ply: p.ply + 1, animated: false });
    } else if (phase === 'play') {
      if (ply < last && !reducedMotion) {
        const waiting = last - ply;
        wait = paceMs(waiting);
        step = (p) =>
          waiting > CATCH_UP
            ? { ...p, ply: last - AFTER_JUMP, animated: false }
            : { ...p, ply: p.ply + 1, animated: true, step: p.step + 1 };
      } else if (kind === 'ended') {
        wait = 0;
        step = (p) => ({ ...p, ply: last, phase: 'hold' });
      } else return;
    } else if (phase === 'hold') {
      wait = HOLD_MS;
      step = (p) => ({ ...p, phase: 'next' });
    } else if (phase === 'loop') {
      wait = LOOP_PLY_MS;
      step = (p) =>
        p.ply >= last
          ? { ...p, phase: 'pause' }
          : { ...p, ply: p.ply + 1, animated: true, step: p.step + 1 };
    } else if (phase === 'pause') {
      wait = LOOP_PAUSE_MS;
      step = (p) => ({ ...p, phase: 'next' });
    } else return;
    const t = setTimeout(() => setPb(step), wait);
    return () => clearTimeout(t);
  }, [visible, kind, phase, ply, last, reducedMotion]);

  const motion = useMemo(
    () =>
      pb.animated && !reducedMotion && at > 0 && kind !== 'finished'
        ? boardMotion(shown.game.track, boards[at - 1], boards[at], pb.step)
        : null,
    [pb.animated, pb.step, reducedMotion, at, kind, shown.game.track, boards],
  );

  const g = shown.game;
  const looping = phase === 'loop' || phase === 'pause' || phase === 'next';
  const live = kind === 'live' || (kind === 'ended' && phase === 'play');
  // Chess counts a move per pair of plies; the other games, one per stone or disc.
  const move = g.track === 'chess' ? Math.ceil(at / 2) : at;
  const caption = `vs ${g.opponent} · move ${move}`;
  const result = g.result ? RESULT[g.result] : null;
  const status = live
    ? 'live'
    : looping
      ? 'last game'
      : kind === 'ended'
        ? (result ?? 'ended')
        : at >= last
          ? result
          : null;

  return (
    <Link
      href={gameHref(g.id)}
      data-slot="engine-board"
      data-board={kind}
      data-phase={kind === 'finished' ? undefined : phase}
      data-ply={at}
      className={cn(
        'group/board block rounded-md outline-none transition-opacity duration-700 focus-visible:ring-2 focus-visible:ring-fg-3',
        kind === 'ended' && shown.fading && 'opacity-0',
        className,
      )}
      aria-label={`${live ? 'Live game' : looping ? 'Last game, replaying' : kind === 'ended' ? 'Finished game' : 'Latest game'} ${caption}${status && !live && result ? `, ${result}` : ''}`}
    >
      <div className="relative mx-auto w-16 overflow-hidden rounded border border-line bg-panel">
        <div className={cn('transition-opacity duration-500', looping && 'opacity-70')}>
          <BoardView game={g.track} view={boards[at]} label={caption} motion={motion} />
        </div>
        {pb.out && (
          <div
            key={pb.out.key}
            data-slot="engine-board-outgoing"
            className="pointer-events-none absolute inset-0 animate-board-out bg-panel"
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) setPb((p) => ({ ...p, out: null }));
            }}
            aria-hidden="true"
          >
            <BoardView game={pb.out.track} view={pb.out.view} label="" />
          </div>
        )}
      </div>
      <div
        data-slot="engine-board-caption"
        className="mt-0.5 flex h-3 items-center justify-center gap-1 overflow-hidden text-[10px] leading-3 whitespace-nowrap tabular text-fg-3 group-hover/board:text-fg-2"
      >
        {live && (
          <span
            className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-good"
            aria-hidden="true"
          />
        )}
        {/* The opponent gives way first, so the move number stays readable in a narrow node. */}
        <span className="min-w-0 shrink-[10] truncate">vs {g.opponent}</span>
        <span className="shrink-0">· move {move}</span>
        {status && !live && (
          <span className="min-w-0 truncate text-fg-2">
            · {status}
            {looping && result && ` · ${result}`}
          </span>
        )}
      </div>
    </Link>
  );
};

export { EngineBoard };

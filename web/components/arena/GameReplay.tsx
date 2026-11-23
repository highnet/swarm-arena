'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { replayBoards, type GameId } from '@arena/shared';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { cn } from '@/lib/utils';
import { BoardView } from './BoardView';

type GameReplayProps = {
  game: GameId;
  moves: string[];
  /** Start playing on mount. */
  autoplay?: boolean;
  /** Milliseconds per ply while playing. */
  speed?: number;
  label: string;
  /** How each move reads to a player; when given, a clickable move list sits beside the board. */
  notation?: string[];
  /** Who moved first and second, to head the move list's columns. */
  sides?: [string, string];
};

const GameReplay = ({
  game,
  moves,
  autoplay = false,
  speed = 450,
  label,
  notation,
  sides,
}: GameReplayProps) => {
  const boards = useMemo(() => replayBoards(game, moves), [game, moves]);
  const last = boards.length - 1;
  const [ply, setPly] = useState(autoplay ? 0 : last);
  const [playing, setPlaying] = useState(autoplay);

  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(
      () => {
        if (ply >= last) {
          setPlaying(false);
          return;
        }
        setPly((p) => Math.min(p + 1, last));
      },
      ply >= last ? 0 : speed,
    );
    return () => clearTimeout(id);
  }, [playing, ply, last, speed]);

  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !current) return;
    const top = current.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + current.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }, [ply]);

  const view = boards[Math.min(ply, last)];
  const move = ply > 0 ? (notation?.[ply - 1] ?? moves[ply - 1]) : null;
  const goTo = (p: number) => {
    setPlaying(false);
    setPly(Math.max(0, Math.min(last, p)));
  };

  const togglePlay = () => {
    if (!playing && ply >= last) setPly(0);
    setPlaying((p) => !p);
  };

  const replay = (
    <div
      data-slot="game-replay"
      className="flex min-w-0 flex-col gap-3"
      tabIndex={notation ? 0 : undefined}
      onKeyDown={
        notation
          ? (e) => {
              if (e.key === 'ArrowLeft') goTo(ply - 1);
              else if (e.key === 'ArrowRight') goTo(ply + 1);
              else if (e.key === 'Home') goTo(0);
              else if (e.key === 'End') goTo(last);
              else return;
              e.preventDefault();
            }
          : undefined
      }
    >
      <BoardView game={game} view={view} label={`${label}, position after ply ${ply}`} />
      <div className="flex items-center gap-2">
        <Button
          variant="icon"
          size="icon"
          aria-label="Previous move"
          onClick={() => {
            setPlaying(false);
            setPly((p) => Math.max(0, p - 1));
          }}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="icon"
          size="icon"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={togglePlay}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <Button
          variant="icon"
          size="icon"
          aria-label="Next move"
          onClick={() => {
            setPlaying(false);
            setPly((p) => Math.min(last, p + 1));
          }}
        >
          <ChevronRight className="size-4" />
        </Button>
        <input
          type="range"
          min={0}
          max={last}
          value={ply}
          aria-label="Ply"
          onChange={(e) => {
            setPlaying(false);
            setPly(Number(e.target.value));
          }}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-fg"
        />
        <Typography variant="data" as="span" className="shrink-0 text-right text-fg-2">
          {ply}/{last}
          {move ? ` ${move}` : ''}
        </Typography>
      </div>
    </div>
  );

  if (!notation) return replay;

  const rows = Math.ceil(notation.length / 2);
  const cell = (i: number) =>
    i < notation.length ? (
      <Button
        variant="segment"
        size="xs"
        aria-current={ply === i + 1 ? 'step' : undefined}
        onClick={() => goTo(i + 1)}
        className={cn(
          'w-full justify-start font-mono tabular',
          ply === i + 1 && 'bg-panel-raised text-fg',
        )}
      >
        {notation[i]}
      </Button>
    ) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
      {replay}
      <div className="min-w-0 rounded-lg border border-line">
        <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-1 border-b border-line px-2 py-1.5 text-xs text-fg-3">
          <span>#</span>
          <span className="truncate">{sides?.[0] ?? 'First'}</span>
          <span className="truncate">{sides?.[1] ?? 'Second'}</span>
        </div>
        {rows === 0 ? (
          <Typography variant="small" className="px-3 py-4">
            No moves stored.
          </Typography>
        ) : (
          <ol
            ref={listRef}
            aria-label="Moves"
            className="max-h-96 overflow-y-auto p-1 md:max-h-[32rem]"
          >
            {Array.from({ length: rows }, (_, r) => (
              <li key={r} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-1">
                <span className="pl-1 font-mono text-xs tabular text-fg-3">{r + 1}.</span>
                {cell(2 * r)}
                {cell(2 * r + 1)}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

export { GameReplay };

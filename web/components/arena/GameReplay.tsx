'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { replayBoards, type GameId } from '@arena/shared';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { BoardView } from './BoardView';

type GameReplayProps = {
  game: GameId;
  moves: string[];
  /** Start playing on mount. */
  autoplay?: boolean;
  /** Milliseconds per ply while playing. */
  speed?: number;
  label: string;
};

const GameReplay = ({ game, moves, autoplay = false, speed = 450, label }: GameReplayProps) => {
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

  const view = boards[Math.min(ply, last)];
  const move = ply > 0 ? moves[ply - 1] : null;

  const togglePlay = () => {
    if (!playing && ply >= last) setPly(0);
    setPlaying((p) => !p);
  };

  return (
    <div data-slot="game-replay" className="flex flex-col gap-3">
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
};

export { GameReplay };

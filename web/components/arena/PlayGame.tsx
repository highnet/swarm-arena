'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { RotateCcw } from 'lucide-react';
import { GAMES, goParse, goSquare, type ChessState, type GameId } from '@arena/shared';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Typography } from '@/components/ui/Typography';
import { useEngine } from '@/lib/useEngine';
import { cn } from '@/lib/utils';
import { BoardView } from './BoardView';
import { ChessPlayBoard } from './ChessPlayBoard';

const LETTERS = 'abcdefghijk';

const toMove = (game: GameId, i: number, cols: number) =>
  game === 'go9' ? goSquare(i) : `${LETTERS[i % cols]}${Math.floor(i / cols) + 1}`;

const toIndex = (game: GameId, m: string, cols: number) =>
  game === 'go9' ? goParse(m) : (Number(m.slice(1)) - 1) * cols + LETTERS.indexOf(m[0]);

const THINK = [
  { ms: 500, label: '0.5s' },
  { ms: 1000, label: '1s' },
  { ms: 3000, label: '3s' },
];

type PlayGameProps = {
  game: GameId;
  wasmUrl: string;
  engineLabel: string;
};

type Ending = { text: string; tone: 'good' | 'critical' | 'neutral' };

/** You against the engine, in the browser. The referee's rules judge both sides. */
const PlayGame = ({ game, wasmUrl, engineLabel }: PlayGameProps) => {
  const rules = GAMES[game];
  const ask = useEngine(game, wasmUrl);
  const [moves, setMoves] = useState<string[]>([]);
  const [human, setHuman] = useState<0 | 1>(0);
  const [think, setThink] = useState(1000);
  const [thinking, setThinking] = useState(false);
  const [forfeit, setForfeit] = useState<string | null>(null);
  const [lastThink, setLastThink] = useState<number | null>(null);
  const [gameNo, setGameNo] = useState(0);
  /** The position the engine was last asked about, and the one on the board now. */
  const asked = useRef('');
  const latest = useRef('');

  const state = useMemo(() => {
    let st = rules.initial();
    for (const m of moves) st = rules.play(st, m);
    return st;
  }, [rules, moves]);

  const view = rules.board(state);
  const legal = useMemo<string[]>(() => rules.legalMoves(state), [rules, state]);
  const outcome =
    rules.outcome(state) ?? (rules.plies(state) >= rules.maxPlies ? rules.adjudicate(state) : null);
  const toMoveSeat = rules.toMove(state);
  const over = outcome !== null || forfeit !== null;
  const yourTurn = !over && toMoveSeat === human;

  const ending: Ending | null = forfeit
    ? { text: forfeit, tone: 'good' }
    : outcome === null
      ? null
      : outcome === 0.5
        ? { text: 'Draw.', tone: 'neutral' }
        : (outcome === 1) === (human === 0)
          ? { text: 'You won.', tone: 'good' }
          : { text: `${engineLabel} won.`, tone: 'critical' };

  const key = `${gameNo}|${human}|${moves.join(' ')}`;

  useEffect(() => {
    latest.current = key;
  }, [key]);

  // Ask the engine once per position; a reply for a position no longer on the board is dropped.
  useEffect(() => {
    if (over || toMoveSeat === human || asked.current === key) return;
    asked.current = key;
    const thinkingStarted = setTimeout(() => setThinking(true), 0);
    ask(moves, think).then(({ move, error, ms }) => {
      clearTimeout(thinkingStarted);
      if (latest.current !== key) return;
      setThinking(false);
      setLastThink(ms);
      if (move && legal.includes(move)) setMoves((m) => [...m, move]);
      else
        setForfeit(
          error
            ? `The engine crashed (${error}). You win.`
            : `The engine played an illegal move (${move ?? 'none'}). You win.`,
        );
    });
  }, [over, toMoveSeat, human, key, moves, think, ask, legal]);

  const play = (m: string) => {
    if (!yourTurn || !legal.includes(m)) return;
    setMoves((prev) => [...prev, m]);
  };

  const restart = (side: 0 | 1) => {
    setHuman(side);
    setMoves([]);
    setForfeit(null);
    setThinking(false);
    setLastThink(null);
    setGameNo((n) => n + 1);
  };

  const [firstLabel, secondLabel] = rules.playerLabels;
  const chess = game === 'chess' ? (state as unknown as ChessState) : null;

  return (
    <div data-slot="play-game" className="grid gap-6 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
      {/* Clip sideways only: chessground sets its file labels a hair past the board's edge. */}
      <div className="min-w-0 overflow-x-clip">
        {chess ? (
          <ChessPlayBoard
            fen={chess.fen}
            legal={legal}
            orientation={human === 0 ? 'white' : 'black'}
            movable={yourTurn ? (human === 0 ? 'white' : 'black') : null}
            lastMove={moves.at(-1) ?? null}
            check={new Chess(chess.fen).inCheck()}
            onMove={play}
          />
        ) : (
          <BoardView
            game={game}
            view={view}
            label={`${rules.name} board`}
            onCell={yourTurn ? (i) => play(toMove(game, i, view.cols)) : undefined}
            targets={
              yourTurn
                ? legal.filter((m) => m !== 'pass').map((m) => toIndex(game, m, view.cols))
                : []
            }
          />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-lg border border-line bg-panel p-4">
          <Typography variant="label" as="h2">
            Status
          </Typography>
          <p
            aria-live="polite"
            className={cn(
              'mt-1 text-[15px] font-medium',
              ending?.tone === 'good' && 'text-good-text',
              ending?.tone === 'critical' && 'text-critical-text',
              !ending && 'text-fg',
            )}
          >
            {ending
              ? ending.text
              : thinking
                ? `${engineLabel} is thinking…`
                : yourTurn
                  ? `Your move (${human === 0 ? firstLabel : secondLabel}).`
                  : 'Waiting…'}
          </p>
          <p className="mt-1 text-xs text-fg-3">
            {moves.length} plies
            {lastThink !== null && ` · last engine move took ${(lastThink / 1000).toFixed(1)}s`}
          </p>
          {yourTurn && legal.includes('pass') && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => play('pass')}>
              Pass
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-line bg-panel p-4">
          <Typography variant="label" as="h2">
            New game
          </Typography>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant={human === 0 ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => restart(0)}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Play {firstLabel}
            </Button>
            <Button
              variant={human === 1 ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => restart(1)}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Play {secondLabel}
            </Button>
          </div>
          <Typography variant="label" as="h3" className="mt-4">
            Engine thinking time
          </Typography>
          <Segmented label="Engine thinking time" className="mt-2">
            {THINK.map((t) => (
              <Button
                key={t.ms}
                variant="segment"
                size="xs"
                aria-pressed={think === t.ms}
                onClick={() => setThink(t.ms)}
              >
                {t.label}
              </Button>
            ))}
          </Segmented>
        </div>

        {moves.length > 0 && (
          <div className="rounded-lg border border-line bg-panel p-4">
            <Typography variant="label" as="h2">
              Moves
            </Typography>
            <p className="mt-2 max-h-40 overflow-y-auto font-mono text-xs leading-6 text-fg-2">
              {moves.map((m, i) => (
                <span key={i} className="mr-2 inline-block">
                  {i % 2 === 0 && <span className="text-fg-3">{i / 2 + 1}.</span>} {m}
                </span>
              ))}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export { PlayGame };

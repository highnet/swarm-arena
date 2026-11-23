'use client';

import { useEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';

type ChessPlayBoardProps = {
  fen: string;
  /** Legal moves in UCI, for the side to move. */
  legal: string[];
  orientation: 'white' | 'black';
  /** Which colour the human may move right now; null while the engine thinks or after the end. */
  movable: 'white' | 'black' | null;
  lastMove: string | null;
  check: boolean;
  onMove: (uci: string) => void;
};

/** chessground (lichess's open-source board) driven by the referee's legal moves. */
const ChessPlayBoard = ({
  fen,
  legal,
  orientation,
  movable,
  lastMove,
  check,
  onMove,
}: ChessPlayBoardProps) => {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      movable: { free: false, showDests: true },
      premovable: { enabled: false },
      draggable: { enabled: true },
    });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    const dests = new Map<Key, Key[]>();
    for (const m of legal) {
      const from = m.slice(0, 2) as Key;
      const to = m.slice(2, 4) as Key;
      dests.set(from, [...(dests.get(from) ?? []), to]);
    }
    api.current?.set({
      fen: fen.split(' ')[0],
      orientation,
      turnColor: fen.split(' ')[1] === 'w' ? 'white' : 'black',
      check,
      lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : undefined,
      movable: {
        color: movable ?? undefined,
        dests: movable ? dests : new Map(),
        events: {
          after: (orig, dest) => {
            // Promotions go to a queen; the referee's move list decides legality.
            const uci = `${orig}${dest}`;
            onMoveRef.current(legal.includes(uci) ? uci : `${uci}q`);
          },
        },
      },
    });
  }, [fen, legal, orientation, movable, lastMove, check]);

  return <div ref={el} className="chess-play aspect-square w-full" data-slot="chess-play-board" />;
};

export { ChessPlayBoard };

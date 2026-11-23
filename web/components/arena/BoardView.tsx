import type { BoardView as BoardViewData, GameId } from '@arena/shared';
import { cn } from '@/lib/utils';
import { ChessPiece } from './ChessPiece';

const FILES = 'abcdefgh';
const GO_COLS = 'abcdefghj';

type StoneProps = {
  c: string;
  x: number;
  y: number;
  r: number;
};

const Stone = ({ c, x, y, r }: StoneProps) => (
  <circle
    cx={x}
    cy={y}
    r={r}
    fill={c === 'b' ? 'var(--stone-black)' : 'var(--stone-white)'}
    stroke={c === 'b' ? 'oklch(0.45 0.008 265)' : 'oklch(0.7 0.006 265)'}
    strokeWidth={1}
  />
);

type LastMarkProps = {
  x: number;
  y: number;
  r: number;
  onBlack: boolean;
};

const LastMark = ({ x, y, r, onBlack }: LastMarkProps) => (
  <circle cx={x} cy={y} r={r} fill={onBlack ? 'var(--stone-white)' : 'var(--stone-black)'} />
);

type ChessBoardProps = {
  view: BoardViewData;
};

const ChessBoard = ({ view }: ChessBoardProps) => {
  const s = 40;
  return (
    <svg viewBox={`0 0 ${8 * s + 16} ${8 * s + 16}`} className="block h-auto w-full">
      {view.cells.map((cell, i) => {
        const r = Math.floor(i / 8);
        const c = i % 8;
        const dark = (r + c) % 2 === 1;
        const last = view.last.includes(i);
        return (
          <g key={i}>
            <rect
              x={c * s + 16}
              y={r * s}
              width={s}
              height={s}
              fill={dark ? 'var(--square-dark)' : 'var(--square-light)'}
            />
            {last && <rect x={c * s + 16} y={r * s} width={s} height={s} fill="var(--highlight)" />}
            {cell && <ChessPiece piece={cell} x={c * s + 16 + 1} y={r * s + 1} size={s - 2} />}
          </g>
        );
      })}
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i} className="fill-fg-3 font-mono text-[10px]">
          <text x={6} y={i * s + s / 2 + 3.5} textAnchor="middle">
            {8 - i}
          </text>
          <text x={i * s + 16 + s / 2} y={8 * s + 12} textAnchor="middle">
            {FILES[i]}
          </text>
        </g>
      ))}
    </svg>
  );
};

type GoBoardProps = {
  view: BoardViewData;
};

const GoBoard = ({ view }: GoBoardProps) => {
  const n = view.cols;
  const s = 34;
  const pad = 26;
  const size = (n - 1) * s + pad * 2;
  const stars = [2 * n + 2, 2 * n + 6, 4 * n + 4, 6 * n + 2, 6 * n + 6];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block h-auto w-full">
      <rect x={0} y={0} width={size} height={size} rx={6} fill="var(--square-light)" />
      {Array.from({ length: n }, (_, i) => (
        <g key={i} stroke="oklch(0.22 0.006 265)" strokeWidth={1}>
          <line x1={pad} y1={pad + i * s} x2={pad + (n - 1) * s} y2={pad + i * s} />
          <line x1={pad + i * s} y1={pad} x2={pad + i * s} y2={pad + (n - 1) * s} />
        </g>
      ))}
      {stars.map((i) => (
        <circle
          key={i}
          cx={pad + (i % n) * s}
          cy={pad + Math.floor(i / n) * s}
          r={2.5}
          fill="oklch(0.22 0.006 265)"
        />
      ))}
      {view.cells.map((c, i) =>
        c ? (
          <Stone key={i} c={c} x={pad + (i % n) * s} y={pad + Math.floor(i / n) * s} r={s * 0.46} />
        ) : null,
      )}
      {view.last.map((i) => (
        <LastMark
          key={i}
          x={pad + (i % n) * s}
          y={pad + Math.floor(i / n) * s}
          r={4}
          onBlack={view.cells[i] === 'b'}
        />
      ))}
      {Array.from({ length: n }, (_, i) => (
        <g key={i} className="fill-fg-3 font-mono text-[10px]">
          <text x={pad + i * s} y={size - 7} textAnchor="middle">
            {GO_COLS[i]}
          </text>
          <text x={9} y={pad + i * s + 3.5} textAnchor="middle">
            {n - i}
          </text>
        </g>
      ))}
    </svg>
  );
};

type OthelloBoardProps = {
  view: BoardViewData;
};

const OthelloBoard = ({ view }: OthelloBoardProps) => {
  const s = 40;
  const pad = 16;
  return (
    <svg viewBox={`0 0 ${8 * s + pad} ${8 * s + pad}`} className="block h-auto w-full">
      <rect x={pad} y={0} width={8 * s} height={8 * s} rx={4} fill="var(--square-light)" />
      {Array.from({ length: 9 }, (_, i) => (
        <g key={i} stroke="oklch(0.25 0.006 265)" strokeWidth={1}>
          <line x1={pad} y1={i * s} x2={pad + 8 * s} y2={i * s} />
          <line x1={pad + i * s} y1={0} x2={pad + i * s} y2={8 * s} />
        </g>
      ))}
      {view.cells.map((c, i) =>
        c ? (
          <Stone
            key={i}
            c={c}
            x={pad + (i % 8) * s + s / 2}
            y={Math.floor(i / 8) * s + s / 2}
            r={s * 0.4}
          />
        ) : null,
      )}
      {view.last.map((i) => (
        <LastMark
          key={i}
          x={pad + (i % 8) * s + s / 2}
          y={Math.floor(i / 8) * s + s / 2}
          r={4}
          onBlack={view.cells[i] === 'b'}
        />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i} className="fill-fg-3 font-mono text-[10px]">
          <text x={6} y={i * s + s / 2 + 3.5} textAnchor="middle">
            {i + 1}
          </text>
          <text x={pad + i * s + s / 2} y={8 * s + 12} textAnchor="middle">
            {FILES[i]}
          </text>
        </g>
      ))}
    </svg>
  );
};

type HexBoardProps = {
  view: BoardViewData;
};

const HexBoard = ({ view }: HexBoardProps) => {
  const n = view.cols;
  const r = 13;
  const w = Math.sqrt(3) * r;
  const pad = 20;
  const cx = (row: number, col: number) => pad + w * (col + row / 2) + w / 2;
  const cy = (row: number) => pad + r + row * r * 1.5;
  const width = cx(n - 1, n - 1) + w / 2 + pad;
  const height = cy(n - 1) + r + pad;
  const hexPath = (x: number, y: number) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 180) * (60 * k - 90);
      return `${k ? 'L' : 'M'}${(x + r * Math.cos(a)).toFixed(2)} ${(y + r * Math.sin(a)).toFixed(2)}`;
    }).join('') + 'Z';
  const edge = 5;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full">
      {/* Black connects top-bottom, White connects left-right. */}
      <line
        x1={cx(0, 0) - w / 2}
        y1={cy(0) - r - edge}
        x2={cx(0, n - 1) + w / 2}
        y2={cy(0) - r - edge}
        stroke="var(--stone-black)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1={cx(n - 1, 0) - w / 2}
        y1={cy(n - 1) + r + edge}
        x2={cx(n - 1, n - 1) + w / 2}
        y2={cy(n - 1) + r + edge}
        stroke="var(--stone-black)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1={cx(0, 0) - w / 2 - edge}
        y1={cy(0) - r / 2}
        x2={cx(n - 1, 0) - w / 2 - edge}
        y2={cy(n - 1) + r / 2}
        stroke="var(--stone-white)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <line
        x1={cx(0, n - 1) + w / 2 + edge}
        y1={cy(0) - r / 2}
        x2={cx(n - 1, n - 1) + w / 2 + edge}
        y2={cy(n - 1) + r / 2}
        stroke="var(--stone-white)"
        strokeWidth={4}
        strokeLinecap="round"
      />
      {view.cells.map((c, i) => {
        const row = Math.floor(i / n);
        const col = i % n;
        const x = cx(row, col);
        const y = cy(row);
        return (
          <g key={i}>
            <path
              d={hexPath(x, y)}
              fill={
                c === 'b'
                  ? 'var(--stone-black)'
                  : c === 'w'
                    ? 'var(--stone-white)'
                    : 'var(--square-light)'
              }
              stroke="var(--panel)"
              strokeWidth={1.5}
            />
            {view.last.includes(i) && <LastMark x={x} y={y} r={3.5} onBlack={c === 'b'} />}
          </g>
        );
      })}
    </svg>
  );
};

type BoardViewProps = {
  game: GameId;
  view: BoardViewData;
  className?: string;
  label: string;
};

/** Pure SVG renderer for every arena game. */
const BoardView = ({ game, view, className, label }: BoardViewProps) => (
  <figure
    data-slot="board"
    role="img"
    aria-label={label}
    className={cn('mx-auto w-full', className)}
  >
    {game === 'chess' && <ChessBoard view={view} />}
    {game === 'go9' && <GoBoard view={view} />}
    {game === 'othello' && <OthelloBoard view={view} />}
    {game === 'hex' && <HexBoard view={view} />}
  </figure>
);

export { BoardView };

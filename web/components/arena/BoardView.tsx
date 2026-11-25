import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { BoardView as BoardViewData, GameId } from '@arena/shared';
import type { BoardMotion, CellMotion } from '@/lib/boardMotion';
import { cn } from '@/lib/utils';
import { ChessPiece } from './ChessPiece';

const FILES = 'abcdefgh';
const GO_COLS = 'abcdefghj';

/** Scales an element about its own centre (stones, discs, pieces). */
const ABOUT_CENTRE = 'origin-center transform-fill';
const POP = cn(ABOUT_CENTRE, 'animate-stone-in');
const FADE_OUT = cn(ABOUT_CENTRE, 'animate-piece-out');

/** How a cell moves this ply, when the board animates its moves (#171). */
const fxAt = (motion: BoardMotion | null | undefined, i: number): CellMotion | null =>
  motion?.cells[i] ?? null;
/** A moving cell gets a fresh key each ply, so its animation plays again. */
const fxKey = (motion: BoardMotion | null | undefined, i: number) =>
  motion?.cells[i] ? `${i}:${motion.key}` : `${i}`;
const delayed = (ms: number): CSSProperties | undefined =>
  ms ? { animationDelay: `${ms}ms` } : undefined;

type GlideProps = {
  x: number;
  y: number;
  glide: boolean;
  children: ReactNode;
};

/** Places its children at (x, y); eases there from the last place when `glide` is on. */
const Glide = ({ x, y, glide, children }: GlideProps) => (
  <g
    className={cn(glide && 'transition-transform duration-300 ease-out')}
    style={{ transform: `translate(${x}px, ${y}px)` }}
  >
    {children}
  </g>
);

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
    stroke={c === 'b' ? 'var(--stone-black)' : 'var(--stone-rim)'}
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
  motion?: BoardMotion | null;
};

const ChessBoard = ({ view, motion }: ChessBoardProps) => {
  const s = 40;
  const x = (i: number) => (i % 8) * s + 16;
  const y = (i: number) => Math.floor(i / 8) * s;
  return (
    <svg viewBox={`0 0 ${8 * s + 16} ${8 * s + 16}`} className="block h-auto w-full">
      {view.cells.map((_, i) => (
        <rect
          key={i}
          x={x(i)}
          y={y(i)}
          width={s}
          height={s}
          fill={
            (Math.floor(i / 8) + (i % 8)) % 2 === 1 ? 'var(--square-dark)' : 'var(--square-light)'
          }
        />
      ))}
      {view.last.map((i, k) => (
        <Glide key={k} x={x(i)} y={y(i)} glide={motion != null}>
          <rect width={s} height={s} fill="var(--highlight)" />
        </Glide>
      ))}
      {view.cells.map((cell, i) => {
        const m = fxAt(motion, i);
        const gone =
          m?.kind === 'out'
            ? m.piece
            : m?.kind === 'in' || m?.kind === 'slide'
              ? m.captured
              : undefined;
        const piece = cell && <ChessPiece piece={cell} x={x(i) + 1} y={y(i) + 1} size={s - 2} />;
        return (
          <Fragment key={fxKey(motion, i)}>
            {gone && (
              <g className={FADE_OUT}>
                <ChessPiece piece={gone} x={x(i) + 1} y={y(i) + 1} size={s - 2} />
              </g>
            )}
            {piece && m?.kind === 'slide' ? (
              <g
                className="animate-piece-slide"
                style={{ '--dx': `${m.dc * s}px`, '--dy': `${m.dr * s}px` } as CSSProperties}
              >
                {piece}
              </g>
            ) : piece && m?.kind === 'in' ? (
              <g className={POP}>{piece}</g>
            ) : (
              piece
            )}
          </Fragment>
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

type Interaction = {
  /** Called with the cell index when a playable cell is clicked. */
  onCell?: (index: number) => void;
  /** Cells where a move is legal right now. */
  targets?: number[];
};

type HitProps = {
  i: number;
  x: number;
  y: number;
  r: number;
  interaction: Interaction;
  label: string;
};

/** An invisible, keyboard-reachable hit target with a quiet dot on legal cells. */
const Hit = ({ i, x, y, r, interaction, label }: HitProps) => {
  const { onCell, targets } = interaction;
  if (!onCell || !targets?.includes(i)) return null;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      className="group cursor-pointer outline-none"
      onClick={() => onCell(i)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCell(i);
        }
      }}
    >
      <circle cx={x} cy={y} r={r} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={r * 0.28}
        className="fill-fg/25 transition-[r,fill] group-hover:fill-fg/60 group-focus-visible:fill-fg"
      />
    </g>
  );
};

type GoBoardProps = {
  view: BoardViewData;
  motion?: BoardMotion | null;
} & Interaction;

const GoBoard = ({ view, motion, ...interaction }: GoBoardProps) => {
  const n = view.cols;
  const s = 34;
  const pad = 32;
  /** The ground stops short of the coordinates, so they sit on the panel, not the board. */
  const inset = 14;
  const size = (n - 1) * s + pad * 2;
  const stars = [2 * n + 2, 2 * n + 6, 4 * n + 4, 6 * n + 2, 6 * n + 6];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block h-auto w-full">
      <rect
        x={inset}
        y={inset}
        width={size - 2 * inset}
        height={size - 2 * inset}
        rx={6}
        fill="var(--square-light)"
      />
      {Array.from({ length: n }, (_, i) => (
        <g key={i} stroke="var(--board-line)" strokeWidth={1}>
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
          fill="var(--board-line)"
        />
      ))}
      {view.cells.map((c, i) => {
        const m = fxAt(motion, i);
        const at = { x: pad + (i % n) * s, y: pad + Math.floor(i / n) * s, r: s * 0.46 };
        if (m?.kind === 'out')
          return (
            <g key={fxKey(motion, i)} className={FADE_OUT}>
              <Stone c={m.piece} {...at} />
            </g>
          );
        if (!c) return null;
        return m?.kind === 'in' ? (
          <g key={fxKey(motion, i)} className={POP}>
            <Stone c={c} {...at} />
          </g>
        ) : (
          <Stone key={i} c={c} {...at} />
        );
      })}
      {view.last.map((i, k) => (
        <Glide key={k} x={pad + (i % n) * s} y={pad + Math.floor(i / n) * s} glide={motion != null}>
          <LastMark x={0} y={0} r={4} onBlack={view.cells[i] === 'b'} />
        </Glide>
      ))}
      {view.cells.map((_, i) => (
        <Hit
          key={`hit-${i}`}
          i={i}
          x={pad + (i % n) * s}
          y={pad + Math.floor(i / n) * s}
          r={s / 2}
          interaction={interaction}
          label={`Play ${GO_COLS[i % n]}${n - Math.floor(i / n)}`}
        />
      ))}
      {Array.from({ length: n }, (_, i) => (
        <g key={i} className="fill-fg-3 font-mono text-[10px]">
          <text x={pad + i * s} y={size - 4} textAnchor="middle">
            {GO_COLS[i]}
          </text>
          <text x={7} y={pad + i * s + 3.5} textAnchor="middle">
            {n - i}
          </text>
        </g>
      ))}
    </svg>
  );
};

type OthelloBoardProps = {
  view: BoardViewData;
  motion?: BoardMotion | null;
} & Interaction;

const OthelloBoard = ({ view, motion, ...interaction }: OthelloBoardProps) => {
  const s = 40;
  const pad = 16;
  return (
    <svg viewBox={`0 0 ${8 * s + pad} ${8 * s + pad}`} className="block h-auto w-full">
      <rect x={pad} y={0} width={8 * s} height={8 * s} rx={4} fill="var(--square-light)" />
      {Array.from({ length: 9 }, (_, i) => (
        <g key={i} stroke="var(--board-line)" strokeWidth={1}>
          <line x1={pad} y1={i * s} x2={pad + 8 * s} y2={i * s} />
          <line x1={pad + i * s} y1={0} x2={pad + i * s} y2={8 * s} />
        </g>
      ))}
      {view.cells.map((c, i) => {
        if (!c) return null;
        const m = fxAt(motion, i);
        const at = { x: pad + (i % 8) * s + s / 2, y: Math.floor(i / 8) * s + s / 2, r: s * 0.4 };
        if (m?.kind === 'flip')
          return (
            <g key={fxKey(motion, i)}>
              <g className={cn(ABOUT_CENTRE, 'animate-disc-flip-out')} style={delayed(m.delay)}>
                <Stone c={m.from} {...at} />
              </g>
              <g className={cn(ABOUT_CENTRE, 'animate-disc-flip-in')} style={delayed(m.delay)}>
                <Stone c={c} {...at} />
              </g>
            </g>
          );
        return m?.kind === 'in' ? (
          <g key={fxKey(motion, i)} className={POP}>
            <Stone c={c} {...at} />
          </g>
        ) : (
          <Stone key={i} c={c} {...at} />
        );
      })}
      {view.last.map((i, k) => (
        <Glide
          key={k}
          x={pad + (i % 8) * s + s / 2}
          y={Math.floor(i / 8) * s + s / 2}
          glide={motion != null}
        >
          <LastMark x={0} y={0} r={4} onBlack={view.cells[i] === 'b'} />
        </Glide>
      ))}
      {view.cells.map((_, i) => (
        <Hit
          key={`hit-${i}`}
          i={i}
          x={pad + (i % 8) * s + s / 2}
          y={Math.floor(i / 8) * s + s / 2}
          r={s / 2}
          interaction={interaction}
          label={`Play ${FILES[i % 8]}${Math.floor(i / 8) + 1}`}
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
  motion?: BoardMotion | null;
} & Interaction;

const HexBoard = ({ view, motion, ...interaction }: HexBoardProps) => {
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
  // The rhombus the cells fill, and a ground around it wide enough to hold each side's goal edge.
  const ground = [
    [cx(0, 0) - w / 2, cy(0) - r / 2],
    [cx(0, n - 1) + w / 2, cy(0) - r / 2],
    [cx(n - 1, n - 1) + w / 2, cy(n - 1) + r / 2],
    [cx(n - 1, 0) - w / 2, cy(n - 1) + r / 2],
  ]
    .map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`)
    .join(' ');
  // Black connects top and bottom, White left and right (rules library, #263): each goal edge in
  // its own side's colour, on the board's ground so both colours stand out.
  const goals: { side: 'b' | 'w'; x1: number; y1: number; x2: number; y2: number }[] = [
    {
      side: 'b',
      x1: cx(0, 0) - w / 2,
      y1: cy(0) - r - edge,
      x2: cx(0, n - 1) + w / 2,
      y2: cy(0) - r - edge,
    },
    {
      side: 'b',
      x1: cx(n - 1, 0) - w / 2,
      y1: cy(n - 1) + r + edge,
      x2: cx(n - 1, n - 1) + w / 2,
      y2: cy(n - 1) + r + edge,
    },
    {
      side: 'w',
      x1: cx(0, 0) - w / 2 - edge,
      y1: cy(0) - r / 2,
      x2: cx(n - 1, 0) - w / 2 - edge,
      y2: cy(n - 1) + r / 2,
    },
    {
      side: 'w',
      x1: cx(0, n - 1) + w / 2 + edge,
      y1: cy(0) - r / 2,
      x2: cx(n - 1, n - 1) + w / 2 + edge,
      y2: cy(n - 1) + r / 2,
    },
  ];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full">
      <polygon
        points={ground}
        fill="var(--square-dark)"
        stroke="var(--square-dark)"
        strokeWidth={2 * (r + edge)}
        strokeLinejoin="round"
      />
      {goals.map((g, k) => (
        <line
          key={k}
          data-goal={g.side}
          x1={g.x1}
          y1={g.y1}
          x2={g.x2}
          y2={g.y2}
          stroke={g.side === 'b' ? 'var(--stone-black)' : 'var(--stone-white)'}
          strokeWidth={4}
          strokeLinecap="round"
        />
      ))}
      {view.cells.map((c, i) => {
        const row = Math.floor(i / n);
        const col = i % n;
        const x = cx(row, col);
        const y = cy(row);
        const stone = c === 'b' ? 'var(--stone-black)' : c === 'w' ? 'var(--stone-white)' : null;
        const pops = Boolean(stone) && fxAt(motion, i)?.kind === 'in';
        return (
          <g key={i}>
            <path
              d={hexPath(x, y)}
              fill={(!pops && stone) || 'var(--square-light)'}
              stroke="var(--square-dark)"
              strokeWidth={1.5}
            />
            {pops && stone && (
              <path
                key={fxKey(motion, i)}
                d={hexPath(x, y)}
                fill={stone}
                stroke="var(--square-dark)"
                strokeWidth={1.5}
                className={POP}
              />
            )}
            <Hit
              i={i}
              x={x}
              y={y}
              r={r * 0.9}
              interaction={interaction}
              label={`Play ${'abcdefghijk'[col]}${row + 1}`}
            />
          </g>
        );
      })}
      {view.last.map((i, k) => (
        <Glide
          key={k}
          x={cx(Math.floor(i / n), i % n)}
          y={cy(Math.floor(i / n))}
          glide={motion != null}
        >
          <LastMark x={0} y={0} r={3.5} onBlack={view.cells[i] === 'b'} />
        </Glide>
      ))}
    </svg>
  );
};

type BoardViewProps = {
  game: GameId;
  view: BoardViewData;
  className?: string;
  label: string;
  /**
   * Animate the step into `view`: stones and pieces arrive, slide, flip and fade, and the
   * last-move marker eases along (#171). Omitted, the board just draws the position.
   */
  motion?: BoardMotion | null;
} & Interaction;

/** Pure SVG renderer for every arena game. */
const BoardView = ({ game, view, className, label, onCell, targets, motion }: BoardViewProps) => (
  <figure
    data-slot="board"
    role={onCell ? 'group' : 'img'}
    aria-label={label}
    className={cn('mx-auto w-full', className)}
  >
    {game === 'chess' && <ChessBoard view={view} motion={motion} />}
    {game === 'go9' && <GoBoard view={view} motion={motion} onCell={onCell} targets={targets} />}
    {game === 'othello' && (
      <OthelloBoard view={view} motion={motion} onCell={onCell} targets={targets} />
    )}
    {game === 'hex' && <HexBoard view={view} motion={motion} onCell={onCell} targets={targets} />}
  </figure>
);

export { BoardView };

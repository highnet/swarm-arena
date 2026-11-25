import type { GameId } from '@arena/shared';
import type { Side, SideColor } from '@/lib/sides';
import { cn } from '@/lib/utils';
import { ChessPiece } from './ChessPiece';

/** A regular hexagon, point up, inside the 16-unit tile. */
const HEX = 'M8 2.5 12.76 5.25V10.75L8 13.5 3.24 10.75V5.25Z';

type SideSwatchProps = {
  game: GameId;
  color: SideColor;
  className?: string;
};

/**
 * The side's own stone, disc or piece on a tile of board ground, drawn from the board tokens
 * (#263): it reads exactly as it does on the board, on any surface and in either theme.
 */
const SideSwatch = ({ game, color, className }: SideSwatchProps) => {
  const fill = color === 'b' ? 'var(--stone-black)' : 'var(--stone-white)';
  const rim = color === 'b' ? 'var(--stone-black)' : 'var(--stone-rim)';
  return (
    <svg
      viewBox="0 0 16 16"
      data-slot="side-swatch"
      data-color={color}
      className={cn('inline-block size-4 shrink-0', className)}
      aria-hidden="true"
    >
      <rect width={16} height={16} rx={3} fill="var(--square-light)" />
      {game === 'chess' ? (
        <ChessPiece piece={color === 'w' ? 'P' : 'p'} x={-2.5} y={-3.5} size={21} />
      ) : game === 'hex' ? (
        <path d={HEX} fill={fill} stroke={rim} strokeWidth={0.75} />
      ) : (
        <circle cx={8} cy={8} r={5.5} fill={fill} stroke={rim} strokeWidth={0.75} />
      )}
    </svg>
  );
};

type SideLabelProps = {
  game: GameId;
  side: Side;
  /** Say the colour in words before the name ("Black · Hex v0.6"). */
  withColor?: boolean;
  className?: string;
};

/** A swatch and the name of the engine that played it; the name wraps rather than truncates. */
const SideLabel = ({ game, side, withColor = true, className }: SideLabelProps) => (
  <span
    data-slot="side-label"
    className={cn('inline-flex min-w-0 items-start gap-1.5 [overflow-wrap:anywhere]', className)}
  >
    <SideSwatch game={game} color={side.color} className="mt-[0.1em]" />
    <span className="min-w-0">
      {withColor && <span className="text-fg-3">{side.colorName} · </span>}
      {side.name}
    </span>
  </span>
);

type SidesLegendProps = {
  game: GameId;
  sides: [Side, Side];
  className?: string;
};

/** Who played which colour: both sides, first mover first, each with its swatch. */
const SidesLegend = ({ game, sides, className }: SidesLegendProps) => (
  <ul
    data-slot="sides-legend"
    aria-label="Sides"
    className={cn('flex flex-wrap gap-x-6 gap-y-1.5', className)}
  >
    {sides.map((side) => (
      <li key={side.color} className="min-w-0">
        <SideLabel game={game} side={side} />
      </li>
    ))}
  </ul>
);

export { SideLabel, SideSwatch, SidesLegend };

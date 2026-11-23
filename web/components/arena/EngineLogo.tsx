import { ChessKnight } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { cn } from '@/lib/utils';
import { SERIES } from '@/lib/tracks';

type MarkProps = {
  className?: string;
};

/** Lucide-style marks (24 grid, 2px round strokes) for the games Lucide has no icon for. */
const GoMark = ({ className }: MarkProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M4 8h16M4 16h16M8 4v16M16 4v16" opacity="0.55" />
    <circle cx="8" cy="8" r="3" fill="currentColor" />
    <circle cx="16" cy="16" r="3" />
  </svg>
);

const OthelloMark = ({ className }: MarkProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 0 0 16Z" fill="currentColor" />
  </svg>
);

const HexMark = ({ className }: MarkProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="m7.5 4 3 1.75v3.5l-3 1.75-3-1.75v-3.5Z" fill="currentColor" />
    <path d="m16.5 4 3 1.75v3.5l-3 1.75-3-1.75v-3.5Z" />
    <path d="m12 12 3 1.75v3.5L12 19l-3-1.75v-3.5Z" />
  </svg>
);

const MARKS = {
  chess: ChessKnight,
  go9: GoMark,
  othello: OthelloMark,
  hex: HexMark,
} as const;

type EngineMarkProps = {
  game: GameId;
  className?: string;
};

/** The bare mark, for inline use beside text. */
const EngineMark = ({ game, className }: EngineMarkProps) => {
  const Mark = MARKS[game];
  return <Mark className={cn('size-4', className)} aria-hidden="true" />;
};

type EngineLogoProps = {
  game: GameId;
  slot: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const TILE = { sm: 'size-6 rounded-md', md: 'size-9 rounded-lg', lg: 'size-12 rounded-xl' };
const GLYPH = { sm: 'size-3.5', md: 'size-5', lg: 'size-7' };

/** The engine's logo: its mark on a tile tinted with the engine's colour. */
const EngineLogo = ({ game, slot, size = 'md', className }: EngineLogoProps) => (
  <span
    data-slot="engine-logo"
    className={cn(
      'inline-flex shrink-0 items-center justify-center border bg-panel-raised',
      TILE[size],
      SERIES[slot].text,
      'border-current/30',
      className,
    )}
  >
    <EngineMark game={game} className={GLYPH[size]} />
  </span>
);

export { EngineLogo, EngineMark };

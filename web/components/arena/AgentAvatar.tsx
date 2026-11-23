import { agentName, hashSeed, rng } from '@arena/shared';
import { cn } from '@/lib/utils';

type AgentAvatarProps = {
  /** Agent id or seat; the same value always draws the same portrait. */
  id: string;
  size?: number;
  className?: string;
};

const oklch = (l: number, c: number, h: number) => `oklch(${l} ${c} ${h})`;

/**
 * A deterministic abstract portrait: a two-tone ground, an offset disc, a quarter-circle and a
 * band, all placed and coloured from the agent's id. Bauhaus by way of a seeded random walk.
 */
const AgentAvatar = ({ id, size = 24, className }: AgentAvatarProps) => {
  const seed = hashSeed(id.replace(/\//g, '-'));
  const r = rng(seed);
  const hue = Math.floor(r() * 360);
  const turn = 90 + Math.floor(r() * 180); // complementary-ish second hue
  const hue2 = (hue + turn) % 360;
  const gid = `av-${seed.toString(36)}`;
  const disc = { x: 8 + r() * 16, y: 8 + r() * 16, r: 7 + r() * 6 };
  const corner = Math.floor(r() * 4);
  const cornerXY = [
    [0, 0],
    [32, 0],
    [32, 32],
    [0, 32],
  ][corner];
  const bandAngle = Math.floor(r() * 4) * 45;
  const dot = { x: 6 + r() * 20, y: 6 + r() * 20 };
  const special = id === 'strategist' || id === 'referee';

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full', className)}
      role="img"
      aria-label={`Portrait of ${agentName(id)}`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={oklch(0.42, 0.09, hue)} />
          <stop offset="1" stopColor={oklch(0.26, 0.06, hue2)} />
        </linearGradient>
        <clipPath id={`${gid}-clip`}>
          <circle cx="16" cy="16" r="16" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${gid}-clip)`}>
        <rect width="32" height="32" fill={`url(#${gid})`} />
        <circle
          cx={cornerXY[0]}
          cy={cornerXY[1]}
          r="15"
          fill={oklch(0.7, 0.13, hue2)}
          opacity="0.85"
        />
        <rect
          x="-4"
          y="13"
          width="40"
          height="5"
          fill={oklch(0.88, 0.05, hue)}
          opacity="0.35"
          transform={`rotate(${bandAngle} 16 16)`}
        />
        <circle cx={disc.x} cy={disc.y} r={disc.r} fill={oklch(0.78, 0.14, hue)} opacity="0.9" />
        <circle
          cx={dot.x}
          cy={dot.y}
          r="2.2"
          fill={special ? oklch(0.97, 0.01, hue) : oklch(0.2, 0.03, hue2)}
        />
      </g>
      {special && (
        <circle
          cx="16"
          cy="16"
          r="15"
          fill="none"
          stroke={oklch(0.97, 0.01, hue)}
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
};

type AgentTagProps = {
  id: string;
  seat?: string;
  size?: number;
  className?: string;
};

/** Portrait, name and seat, the way an agent is shown anywhere on the site. */
const AgentTag = ({ id, seat, size = 20, className }: AgentTagProps) => (
  <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
    <AgentAvatar id={id} size={size} />
    <span className="truncate text-fg">{agentName(id)}</span>
    {seat && seat !== id && (
      <span className="truncate font-mono text-[11px] text-fg-3">{seat}</span>
    )}
  </span>
);

export { AgentAvatar, AgentTag };

import { agentName, hashSeed } from '@arena/shared';
import { ANIMAL_VIEWBOX, animalOf } from '@arena/shared/animals';
import { cn } from '@/lib/utils';

type AgentAvatarProps = {
  /** Agent id or seat; the same value always draws the same animal. */
  id: string;
  size?: number;
  className?: string;
};

const oklch = (l: number, c: number, h: number) => `oklch(${l} ${c} ${h})`;

/**
 * The agent's own animal (#200), the same one its node shows on the fleet graph: a game-icons.net
 * silhouette (CC BY 3.0, credited in the site footer) on a ground tinted from the id. Pale on deep in both
 * themes, so it reads at 16 px and at 96 px alike.
 */
const AgentAvatar = ({ id, size = 24, className }: AgentAvatarProps) => {
  const animal = animalOf(id);
  const hue = hashSeed(id.replace(/\//g, '-')) % 360;
  const special = id === 'strategist' || id === 'referee';
  const pad = ANIMAL_VIEWBOX * 0.2;
  const box = ANIMAL_VIEWBOX + pad * 2;

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${box} ${box}`}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full', className)}
      role="img"
      aria-label={`${agentName(id)}, ${animal.name.toLowerCase()}`}
    >
      <title>{`${agentName(id)} · ${animal.name}`}</title>
      <circle
        cx={ANIMAL_VIEWBOX / 2}
        cy={ANIMAL_VIEWBOX / 2}
        r={box / 2}
        fill={oklch(0.36, 0.07, hue)}
      />
      <path d={animal.d} fill={oklch(0.95, 0.04, hue)} />
      {special && (
        <circle
          cx={ANIMAL_VIEWBOX / 2}
          cy={ANIMAL_VIEWBOX / 2}
          r={box / 2 - 20}
          fill="none"
          stroke={oklch(0.97, 0.01, hue)}
          strokeWidth="24"
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
    {seat && seat !== id && <span className="truncate font-mono text-xs text-fg-3">{seat}</span>}
  </span>
);

export { AgentAvatar, AgentTag };

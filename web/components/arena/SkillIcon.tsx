import { BookOpen, Bot, Compass } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { TRACK_ORDER } from '@/lib/tracks';
import { EngineLogo } from './EngineLogo';

type SkillIconProps = {
  name: string;
  slots: Partial<Record<GameId, number>>;
};

/** Role skills get a Lucide icon; each game's playbook wears its engine's logo. */
const SkillIcon = ({ name, slots }: SkillIconProps) => {
  const game = name.replace(/-playbook$/, '') as GameId;
  if (name.endsWith('-playbook') && TRACK_ORDER.includes(game)) {
    return <EngineLogo game={game} slot={slots[game] ?? 1} size="md" />;
  }
  const Icon = name === 'swarm-agent' ? Bot : name === 'swarm-strategist' ? Compass : BookOpen;
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-raised text-fg-2">
      <Icon className="size-5" aria-hidden="true" />
    </span>
  );
};

export { SkillIcon };

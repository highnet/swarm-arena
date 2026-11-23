import {
  Blocks,
  Dices,
  FlaskConical,
  Gauge,
  GitFork,
  Scale,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { TaskType } from '@arena/shared';
import { Badge } from '@/components/ui/Badge';
import { formatElo } from '@/lib/format';
import { cn } from '@/lib/utils';

export const TASK_TYPE_META: Record<TaskType, { label: string; icon: LucideIcon; hint: string }> = {
  foundation: { label: 'Foundation', icon: Blocks, hint: 'Protocol, rules wiring, legality' },
  search: { label: 'Search', icon: GitFork, hint: 'How the engine looks ahead' },
  evaluation: { label: 'Evaluation', icon: Scale, hint: 'How the engine judges a position' },
  playout: { label: 'Playout', icon: Dices, hint: 'Simulation policy for tree search' },
  time: { label: 'Time', icon: Timer, hint: 'Spending the clock' },
  speed: { label: 'Speed', icon: Gauge, hint: 'Raw positions per second' },
  tuning: { label: 'Tuning', icon: SlidersHorizontal, hint: 'Constants and weights' },
  novel: { label: 'Novel', icon: Sparkles, hint: 'An idea no engine is known for' },
  fix: { label: 'Fix', icon: Wrench, hint: 'A bug, forfeit or timeout' },
  experiment: { label: 'Experiment', icon: FlaskConical, hint: 'Anything else worth measuring' },
};

/** The kind of work a task is. Neutral on purpose: types are identity, not status. */
const TaskTypeChip = ({
  type,
  className,
}: {
  type: TaskType | null | undefined;
  className?: string;
}) => {
  const meta = TASK_TYPE_META[type ?? 'experiment'] ?? TASK_TYPE_META.experiment;
  const Icon = meta.icon;
  return (
    <Badge tone="neutral" title={meta.hint} className={className}>
      <Icon className="size-3 text-fg-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
};

type VersionChipProps = {
  version: string;
  elo: number | null | undefined;
  error?: number | null;
  className?: string;
};

/** A shipped version and the rating it earned in the games that shipped it. */
const VersionChip = ({ version, elo, error, className }: VersionChipProps) => (
  <span
    className={cn(
      'inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap rounded-[5px] border border-line bg-panel-raised px-1.5 font-mono text-[11px] leading-5 tabular',
      className,
    )}
    title={error ? `Rated ${formatElo(elo ?? null)} ± ${Math.round(error)} (95%)` : undefined}
  >
    <span className="text-fg">{version}</span>
    <span className="text-fg-2">
      {elo === null || elo === undefined ? 'unrated' : `${formatElo(elo)} Elo`}
      {error ? <span className="text-fg-3"> ±{Math.round(error)}</span> : null}
    </span>
  </span>
);

export { TaskTypeChip, VersionChip };

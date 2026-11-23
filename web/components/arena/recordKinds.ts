import {
  CircleDot,
  CirclePlus,
  CircleSlash,
  Compass,
  Flag,
  GitMerge,
  Swords,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { RecordKind } from '@arena/shared';

export type KindMeta = {
  label: string;
  icon: LucideIcon;
  /** Tone of the icon. Status colours only where the record is a verdict. */
  tone: 'neutral' | 'good' | 'critical' | 'strong';
};

export const KINDS: Record<RecordKind, KindMeta> = {
  strategy: { label: 'Strategy', icon: Compass, tone: 'strong' },
  task_opened: { label: 'Task opened', icon: CirclePlus, tone: 'neutral' },
  task_claimed: { label: 'Claimed', icon: CircleDot, tone: 'neutral' },
  patch_landed: { label: 'Landed', icon: GitMerge, tone: 'good' },
  patch_rejected: { label: 'Rejected', icon: Undo2, tone: 'critical' },
  match_verdict: { label: 'Match', icon: Swords, tone: 'strong' },
  rung_cleared: { label: 'Rung cleared', icon: Flag, tone: 'good' },
  idea_dead: { label: 'Ruled dead', icon: CircleSlash, tone: 'critical' },
};

export const TONE_CLASS: Record<KindMeta['tone'], string> = {
  neutral: 'text-fg-3',
  strong: 'text-fg-2',
  good: 'text-good-text',
  critical: 'text-critical-text',
};

/** Filter groups shown above the board. */
export const KIND_FILTERS: { id: string; label: string; kinds: RecordKind[] | null }[] = [
  { id: 'all', label: 'All', kinds: null },
  {
    id: 'verdicts',
    label: 'Verdicts',
    kinds: ['match_verdict', 'patch_landed', 'patch_rejected', 'rung_cleared'],
  },
  { id: 'tasks', label: 'Tasks', kinds: ['task_opened', 'task_claimed'] },
  { id: 'strategy', label: 'Strategy', kinds: ['strategy'] },
  { id: 'dead', label: 'Dead', kinds: ['idea_dead'] },
];

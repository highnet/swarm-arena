import {
  CircleCheck,
  CircleHelp,
  CircleSlash,
  Gavel,
  Handshake,
  Lightbulb,
  MessageCircle,
  RefreshCcw,
  Reply,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKind, MessageStatus } from '@arena/shared';

export const MESSAGE_KIND: Record<MessageKind, { label: string; icon: LucideIcon; tone: string }> =
  {
    note: { label: 'Note', icon: StickyNote, tone: 'text-fg-3' },
    question: { label: 'Question', icon: CircleHelp, tone: 'text-warning' },
    proposal: { label: 'Proposal', icon: Lightbulb, tone: 'text-fg-2' },
    answer: { label: 'Answer', icon: Reply, tone: 'text-good-text' },
    handoff: { label: 'Hand-off', icon: Handshake, tone: 'text-fg-2' },
    retro: { label: 'Retro', icon: RefreshCcw, tone: 'text-fg-2' },
    comment: { label: 'Comment', icon: MessageCircle, tone: 'text-fg-3' },
    decision: { label: 'Decision', icon: Gavel, tone: 'text-good-text' },
  };

export const MESSAGE_STATUS: Record<
  MessageStatus,
  { label: string; icon: LucideIcon; tone: 'neutral' | 'good' | 'outline' }
> = {
  open: { label: 'Open', icon: CircleHelp, tone: 'outline' },
  resolved: { label: 'Resolved', icon: CircleCheck, tone: 'good' },
  closed: { label: 'Closed', icon: CircleSlash, tone: 'neutral' },
};

'use client';

import { useState } from 'react';
import {
  CircleHelp,
  Handshake,
  Lightbulb,
  MessagesSquare,
  RefreshCcw,
  Reply,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import type { GameId, Message, MessageKind } from '@arena/shared';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatTime } from '@/lib/format';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { AgentTag } from './AgentAvatar';
import { EngineLogo } from './EngineLogo';

const KIND: Record<MessageKind, { label: string; icon: LucideIcon; tone: string }> = {
  note: { label: 'Note', icon: StickyNote, tone: 'text-fg-3' },
  question: { label: 'Question', icon: CircleHelp, tone: 'text-warning' },
  proposal: { label: 'Proposal', icon: Lightbulb, tone: 'text-fg-2' },
  answer: { label: 'Answer', icon: Reply, tone: 'text-good-text' },
  handoff: { label: 'Hand-off', icon: Handshake, tone: 'text-fg-2' },
  retro: { label: 'Retro', icon: RefreshCcw, tone: 'text-fg-2' },
};

type MessageItemProps = {
  m: Message;
  seats: Record<string, string>;
  slots: Partial<Record<GameId, number>>;
  replies: Message[];
};

const MessageItem = ({ m, seats, slots, replies }: MessageItemProps) => {
  const kind = KIND[m.kind] ?? KIND.note;
  const Icon = kind.icon;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Icon className={cn('size-3.5 shrink-0', kind.tone)} aria-hidden="true" />
        <span className={cn('font-medium', kind.tone)}>{kind.label}</span>
        {m.agent_id ? (
          <AgentTag id={m.agent_id} seat={seats[m.agent_id]} size={18} />
        ) : (
          <span className="text-fg-3">unknown</span>
        )}
        {m.track_id && (
          <span className="inline-flex items-center gap-1 text-fg-2">
            <EngineLogo
              game={m.track_id}
              slot={slots[m.track_id] ?? 1}
              size="sm"
              className="size-4 rounded"
            />
            {SHORT_NAME[m.track_id]}
          </span>
        )}
        <time dateTime={m.at} className="ml-auto font-mono tabular text-fg-3">
          {formatDay(m.at)} {formatTime(m.at)}
        </time>
      </div>
      <p className="mt-1.5 max-w-prose whitespace-pre-wrap text-[14px] leading-6 text-fg-2 text-pretty">
        {m.body}
      </p>
      {replies.length > 0 && (
        <ol className="mt-3 space-y-3 border-l border-line-strong pl-4">
          {replies.map((r) => {
            const rk = KIND[r.kind] ?? KIND.answer;
            const RIcon = rk.icon;
            return (
              <li key={r.id}>
                <div className="flex flex-wrap items-center gap-x-2 text-xs">
                  <RIcon className={cn('size-3.5', rk.tone)} aria-hidden="true" />
                  {r.agent_id ? (
                    <AgentTag id={r.agent_id} seat={seats[r.agent_id]} size={16} />
                  ) : (
                    <span className="text-fg-3">unknown</span>
                  )}
                  <time dateTime={r.at} className="font-mono tabular text-fg-3">
                    {formatTime(r.at)}
                  </time>
                </div>
                <p className="mt-1 max-w-prose whitespace-pre-wrap text-[13px] leading-6 text-fg-2">
                  {r.body}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
};

type MessageBoardProps = {
  messages: Message[];
  seats: Record<string, string>;
  slots: Partial<Record<GameId, number>>;
  limit?: number;
};

/** Agents talking to agents: questions, proposals and hand-offs, threaded by replies. */
const MessageBoard = ({ messages, seats, slots, limit }: MessageBoardProps) => {
  const [track, setTrack] = useState<GameId | 'all'>('all');
  const byParent = new Map<number, Message[]>();
  for (const m of messages) {
    if (m.reply_to) byParent.set(m.reply_to, [...(byParent.get(m.reply_to) ?? []), m]);
  }
  const threads = messages
    .filter((m) => !m.reply_to && (track === 'all' || m.track_id === track || m.track_id === null))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);

  return (
    <div data-slot="message-board">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div role="group" aria-label="Engine" className="flex gap-0.5 rounded-md bg-bg p-0.5">
          <Button
            variant="segment"
            size="xs"
            aria-pressed={track === 'all'}
            onClick={() => setTrack('all')}
          >
            All engines
          </Button>
          {TRACK_ORDER.map((t) => (
            <Button
              key={t}
              variant="segment"
              size="xs"
              aria-pressed={track === t}
              onClick={() => setTrack(t)}
            >
              {SHORT_NAME[t]}
            </Button>
          ))}
        </div>
      </div>
      {threads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <MessagesSquare className="size-6 text-fg-3" aria-hidden="true" />
          <Typography variant="small">
            No messages yet. Agents post here when they ask, propose or hand off.
          </Typography>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {threads.map((m) => (
            <MessageItem
              key={m.id}
              m={m}
              seats={seats}
              slots={slots}
              replies={(byParent.get(m.id) ?? []).sort((a, b) => a.at.localeCompare(b.at))}
            />
          ))}
        </ol>
      )}
    </div>
  );
};

export { MessageBoard };

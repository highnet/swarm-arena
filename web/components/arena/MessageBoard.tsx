'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Link2, MessageCircle, MessagesSquare } from 'lucide-react';
import {
  buildThreads,
  formatRef,
  replyState,
  rootOf,
  type GameId,
  type Message,
  type MessageStatus,
  type Thread,
} from '@arena/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatTime } from '@/lib/format';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { AgentTag } from './AgentAvatar';
import { EngineLogo } from './EngineLogo';
import { MESSAGE_KIND, MESSAGE_STATUS, REPLY_STATE } from './messageKinds';
import { RichText } from './RichText';

const STATUS_FILTERS: { id: MessageStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
];

type ThreadItemProps = {
  t: Thread;
  seats: Record<string, string>;
  slots: Partial<Record<GameId, number>>;
  threadOf: (id: number) => number | undefined;
  onTag: (tag: string) => void;
  activeTag: string | null;
  compact: boolean;
};

const ThreadItem = ({ t, seats, slots, threadOf, onTag, activeTag, compact }: ThreadItemProps) => {
  const m = t.root;
  const kind = MESSAGE_KIND[m.kind] ?? MESSAGE_KIND.note;
  const Icon = kind.icon;
  const status = MESSAGE_STATUS[m.status ?? 'open'];
  const latest = t.comments.at(-1);
  const waits = replyState(t);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Icon className={cn('size-3.5 shrink-0', kind.tone)} aria-hidden="true" />
        <span className={cn('font-medium', kind.tone)}>{kind.label}</span>
        {((m.status ?? 'open') !== 'open' || m.kind === 'question' || m.kind === 'proposal') && (
          <Badge tone={status.tone}>{status.label}</Badge>
        )}
        {waits && (
          <Badge tone="waiting" title={REPLY_STATE[waits].title}>
            {REPLY_STATE[waits].label}
          </Badge>
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
        <time dateTime={t.lastAt} className="ml-auto font-mono tabular text-fg-3">
          {formatDay(t.lastAt)} {formatTime(t.lastAt)}
        </time>
      </div>
      {m.title && (
        <Link
          href={`/messages/${m.id}`}
          className="mt-1.5 block text-[15px] font-medium leading-6 text-fg text-pretty hover:underline"
        >
          {m.title}
        </Link>
      )}
      <RichText
        text={m.body}
        threadOf={threadOf}
        variant="small"
        className={cn(
          'max-w-[34em]',
          m.title ? 'mt-1' : 'mt-1.5 text-fg',
          compact ? 'line-clamp-2' : 'line-clamp-4',
        )}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-3">
        {m.agent_id ? (
          <AgentTag id={m.agent_id} seat={seats[m.agent_id]} size={16} />
        ) : (
          <span>unknown</span>
        )}
        <Link href={`/messages/${m.id}`} className="inline-flex items-center gap-1 hover:text-fg">
          <MessageCircle className="size-3" aria-hidden="true" />
          {t.comments.length} comment{t.comments.length === 1 ? '' : 's'}
          <span className="font-mono">· msg#{m.id}</span>
        </Link>
        {t.refs.length > 0 && (
          <span className="inline-flex items-center gap-1" title="References">
            <Link2 className="size-3" aria-hidden="true" />
            {t.refs.slice(0, 4).map(formatRef).join(' ')}
            {t.refs.length > 4 && ` +${t.refs.length - 4}`}
          </span>
        )}
        {t.backlinks.length > 0 && (
          <span title="Threads that reference this one">
            ← {t.backlinks.length} backlink{t.backlinks.length === 1 ? '' : 's'}
          </span>
        )}
        {(m.tags ?? []).map((tag) => (
          <Button
            key={tag}
            variant="segment"
            size="xs"
            className="h-5 px-1.5 font-mono text-[11px]"
            aria-pressed={activeTag === tag}
            onClick={() => onTag(tag)}
          >
            #{tag}
          </Button>
        ))}
      </div>
      {!compact && latest && (
        <div className="mt-2 border-l border-line-strong pl-3">
          <div className="flex flex-wrap items-center gap-x-2 text-xs">
            {latest.agent_id && (
              <AgentTag id={latest.agent_id} seat={seats[latest.agent_id]} size={14} />
            )}
            <span className="text-fg-3">
              {(MESSAGE_KIND[latest.kind] ?? MESSAGE_KIND.comment).label.toLowerCase()}
            </span>
            <time dateTime={latest.at} className="font-mono tabular text-fg-3">
              {formatTime(latest.at)}
            </time>
          </div>
          <RichText
            text={latest.body}
            threadOf={threadOf}
            variant="small"
            className="mt-0.5 line-clamp-2 max-w-[34em]"
          />
          {t.comments.length > 1 && (
            <Link
              href={`/messages/${m.id}`}
              className="mt-1 inline-flex items-center gap-0.5 text-xs text-fg-2 hover:text-fg"
            >
              All {t.comments.length} comments
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </li>
  );
};

type MessageBoardProps = {
  messages: Message[];
  seats: Record<string, string>;
  slots: Partial<Record<GameId, number>>;
  /** Show only this many threads, compactly, with no filters but the engine (the home page). */
  limit?: number;
  /**
   * Show this many threads at first and the rest a page at a time behind "Show more", so a long
   * board does not render hundreds of threads at once. Filters apply to the whole board.
   */
  pageSize?: number;
};

/** Agents talking to agents: threads with comments, tags, status and cross-references. */
const MessageBoard = ({ messages, seats, slots, limit, pageSize }: MessageBoardProps) => {
  const [track, setTrack] = useState<GameId | 'all'>('all');
  const [status, setStatus] = useState<MessageStatus | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const compact = limit !== undefined;

  const { threads, threadOf, tagCounts } = useMemo(() => {
    const byId = new Map(messages.map((m) => [m.id, m]));
    const counts = new Map<string, number>();
    for (const m of messages)
      if (!m.reply_to) for (const t of m.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return {
      threads: buildThreads(messages),
      threadOf: (id: number) => (byId.has(id) ? rootOf(id, byId) : undefined),
      tagCounts: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    };
  }, [messages]);

  const matching = threads
    .filter((t) => track === 'all' || t.root.track_id === track || t.root.track_id === null)
    .filter((t) => status === 'all' || (t.root.status ?? 'open') === status)
    .filter((t) => !tag || (t.root.tags ?? []).includes(tag));
  const shown = matching.slice(0, limit ?? (pageSize ? pageSize * pages : undefined));
  const hidden = matching.length - shown.length;

  const toggleTag = (t: string) => setTag((cur) => (cur === t ? null : t));

  return (
    <div data-slot="message-board">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <Segmented label="Engine" wrap>
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
        </Segmented>
        {!compact && (
          <Segmented label="Status">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.id}
                variant="segment"
                size="xs"
                aria-pressed={status === f.id}
                onClick={() => setStatus(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </Segmented>
        )}
      </div>
      {!compact && tagCounts.length > 0 && (
        <div
          role="group"
          aria-label="Tags"
          className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2"
        >
          <Typography variant="label" as="span" className="mr-1">
            Tags
          </Typography>
          {tagCounts.slice(0, 24).map(([t, n]) => (
            <Button
              key={t}
              variant="segment"
              size="xs"
              className="font-mono"
              aria-pressed={tag === t}
              onClick={() => toggleTag(t)}
            >
              #{t} <span className="tabular text-fg-3">{n}</span>
            </Button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <MessagesSquare className="size-6 text-fg-3" aria-hidden="true" />
          <Typography variant="small">
            {threads.length === 0
              ? 'No threads yet. Agents open one when they ask, propose or hand off.'
              : 'No threads match these filters.'}
          </Typography>
        </div>
      ) : (
        <ol className="divide-y divide-line">
          {shown.map((t) => (
            <ThreadItem
              key={t.root.id}
              t={t}
              seats={seats}
              slots={slots}
              threadOf={threadOf}
              onTag={toggleTag}
              activeTag={tag}
              compact={compact}
            />
          ))}
        </ol>
      )}
      {pageSize && !compact && hidden > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          <Typography variant="meta" as="p">
            Showing {shown.length} of {matching.length} threads
          </Typography>
          <Button variant="ghost" size="sm" onClick={() => setPages((p) => p + 1)}>
            Show {Math.min(pageSize, hidden)} more
          </Button>
        </div>
      )}
    </div>
  );
};

export { MessageBoard };

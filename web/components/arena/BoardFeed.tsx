'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { agentName, type BoardRecord, type GameId } from '@arena/shared';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatTime } from '@/lib/format';
import { matchHref, recordHref, taskHref } from '@/lib/routes';
import { SERIES, SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { AgentTag } from './AgentAvatar';
import { KINDS, KIND_FILTERS, TONE_CLASS } from './recordKinds';

type BoardFeedProps = {
  records: BoardRecord[];
  slots: Partial<Record<GameId, number>>;
  seats: Record<string, string>;
  pageSize?: number;
  /** Hide the track filter (engine pages are already scoped). */
  scoped?: boolean;
  /** Text search over titles, details and seats. */
  query?: string;
  /** Initial record-type filter id (see KIND_FILTERS). */
  initialKind?: string;
};

type RecordRowProps = {
  record: BoardRecord;
  fresh: boolean;
  slot: number | undefined;
  seat: string | undefined;
};

const RecordRow = ({ record, fresh, slot, seat }: RecordRowProps) => {
  const meta = KINDS[record.kind];
  const Icon = meta.icon;
  return (
    <li
      className={cn(
        'grid grid-cols-[3rem_1.25rem_1fr] gap-x-2.5 px-4 py-2.5 sm:grid-cols-[3.25rem_1.25rem_1fr_auto]',
        fresh && 'animate-record-in',
      )}
    >
      <time dateTime={record.at} className="pt-px font-mono text-xs tabular text-fg-3">
        {formatTime(record.at)}
      </time>
      <Icon className={cn('mt-0.5 size-4', TONE_CLASS[meta.tone])} aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cn('text-xs font-medium', TONE_CLASS[meta.tone])}>{meta.label}</span>
          {record.track_id && slot && (
            <span className="inline-flex items-center gap-1 text-xs text-fg-2">
              <span className={cn('size-1.5 rounded-full', SERIES[slot].bg)} />
              {SHORT_NAME[record.track_id]}
            </span>
          )}
          {record.agent_id && (
            <AgentTag id={record.agent_id} seat={seat} size={16} className="text-[11px]" />
          )}
        </div>
        <Link href={recordHref(record)} className="mt-0.5 block hover:underline">
          <Typography variant="small" color="primary" as="span" className="text-pretty">
            {record.title}
          </Typography>
        </Link>
        {record.detail && (
          <Typography variant="meta" as="p" className="mt-0.5 max-w-prose text-pretty">
            {record.detail}
          </Typography>
        )}
      </div>
      {record.match_id || record.task_id ? (
        <div className="col-start-3 mt-1 flex gap-3 self-start text-xs sm:col-start-auto sm:mt-0">
          {record.task_id && (
            <Link
              href={taskHref(record.task_id)}
              className="inline-flex items-center gap-0.5 text-fg-2 hover:text-fg"
            >
              Task
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          )}
          {record.match_id && (
            <Link
              href={matchHref(record.match_id)}
              className="inline-flex items-center gap-0.5 text-fg-2 hover:text-fg"
            >
              Games
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : (
        <span className="hidden sm:block" />
      )}
    </li>
  );
};

const BoardFeed = ({
  records,
  slots,
  seats,
  pageSize = 30,
  scoped = false,
  query = '',
  initialKind = 'all',
}: BoardFeedProps) => {
  const [kind, setKind] = useState(initialKind);
  const [track, setTrack] = useState<GameId | 'all'>('all');
  const [limit, setLimit] = useState(pageSize);
  // Records present on first render are history; anything after that arrived live.
  const [seen] = useState(() => new Set(records.map((r) => r.id)));

  const kinds = KIND_FILTERS.find((f) => f.id === kind)?.kinds ?? null;
  const needle = query.trim().toLowerCase();
  const visible = records.filter(
    (r) =>
      (!kinds || kinds.includes(r.kind)) &&
      (track === 'all' || r.track_id === track) &&
      (!needle ||
        `${r.title} ${r.detail ?? ''} ${r.agent_id ? `${seats[r.agent_id]} ${agentName(r.agent_id)}` : ''}`
          .toLowerCase()
          .includes(needle)),
  );
  const shown = visible.slice(0, limit);

  const groups: { day: string; items: BoardRecord[] }[] = [];
  for (const r of shown) {
    const day = formatDay(r.at);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(r);
  }

  return (
    <div data-slot="board-feed">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2">
        <div role="group" aria-label="Record type" className="flex gap-0.5 rounded-md bg-bg p-0.5">
          {KIND_FILTERS.map((f) => (
            <Button
              key={f.id}
              variant="segment"
              size="xs"
              aria-pressed={kind === f.id}
              onClick={() => setKind(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {!scoped && (
          <div role="group" aria-label="Track" className="flex gap-0.5 rounded-md bg-bg p-0.5">
            <Button
              variant="segment"
              size="xs"
              aria-pressed={track === 'all'}
              onClick={() => setTrack('all')}
            >
              All tracks
            </Button>
            {TRACK_ORDER.filter((t) => slots[t]).map((t) => (
              <Button
                key={t}
                variant="segment"
                size="xs"
                aria-pressed={track === t}
                onClick={() => setTrack(t)}
              >
                <span className={cn('size-1.5 rounded-full', SERIES[slots[t]!].bg)} />
                {SHORT_NAME[t]}
              </Button>
            ))}
          </div>
        )}
      </div>

      {groups.length === 0 && (
        <Typography variant="small" className="px-4 py-8 text-center">
          Nothing on the record for this filter yet.
        </Typography>
      )}

      {groups.map((g) => (
        <div key={g.day}>
          <div className="z-1 lg:sticky lg:top-[5.25rem] border-b border-line bg-panel/95 px-4 py-1.5 text-xs font-medium text-fg-3">
            {g.day}
          </div>
          <ol className="divide-y divide-line">
            {g.items.map((r) => (
              <RecordRow
                key={r.id}
                record={r}
                fresh={!seen.has(r.id)}
                slot={r.track_id ? slots[r.track_id] : undefined}
                seat={r.agent_id ? seats[r.agent_id] : undefined}
              />
            ))}
          </ol>
        </div>
      ))}

      {visible.length > limit && (
        <div className="border-t border-line p-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + pageSize)}>
            Show {Math.min(pageSize, visible.length - limit)} older records
          </Button>
        </div>
      )}
    </div>
  );
};

export { BoardFeed };

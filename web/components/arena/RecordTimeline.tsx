import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { BoardRecord } from '@arena/shared';
import { formatDay, formatTime } from '@/lib/format';
import { matchHref, recordHref, taskHref } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { AgentTag } from './AgentAvatar';
import { KINDS, TONE_CLASS } from './recordKinds';

type RecordTimelineProps = {
  records: BoardRecord[];
  /** Task titles by id, to name the task a record belongs to (left out when the page is the task). */
  taskTitles?: Map<string, string>;
  /** Name the agent behind each record (a task's timeline); a seat's own page leaves it out. */
  showAgent?: boolean;
  className?: string;
};

/**
 * An editorial list of board records (web/DESIGN.md, "Record timeline"): one hairline row each,
 * with the day and time in a mono column on the left and, on the right, the kind (icon and word in
 * its tone), the title at 15px and the detail at a reading measure. No panel around it.
 */
const RecordTimeline = ({ records, taskTitles, showAgent, className }: RecordTimelineProps) => (
  <ol
    data-slot="record-timeline"
    className={cn('divide-y divide-line border-y border-line', className)}
  >
    {records.map((r) => {
      const meta = KINDS[r.kind];
      const Icon = meta.icon;
      const task = r.task_id && taskTitles ? taskTitles.get(r.task_id) : undefined;
      return (
        <li key={r.id} className="grid gap-x-10 gap-y-2 py-6 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <time dateTime={r.at} className="font-mono text-[13px] leading-6 tabular text-fg-3">
            {formatDay(r.at)} {formatTime(r.at)}
          </time>
          <div className="min-w-0 max-w-2xl">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <Icon className={cn('size-4 shrink-0', TONE_CLASS[meta.tone])} aria-hidden="true" />
              <span className={cn('font-medium', TONE_CLASS[meta.tone])}>{meta.label}</span>
              {showAgent && r.agent_id && <AgentTag id={r.agent_id} size={16} />}
            </p>
            <Link
              href={recordHref(r)}
              className="mt-1.5 block text-[15px] leading-6 text-fg text-pretty underline-offset-4 hover:underline"
            >
              {r.title}
            </Link>
            {r.detail && (
              <p className="mt-1.5 max-w-[54ch] text-[13px] leading-6 text-fg-2 text-pretty">
                {r.detail}
              </p>
            )}
            {(task || r.match_id) && (
              <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                {task && r.task_id && (
                  <Link
                    href={taskHref(r.task_id)}
                    className="text-fg-2 underline-offset-4 hover:text-fg hover:underline"
                  >
                    {task}
                  </Link>
                )}
                {r.match_id && (
                  <Link
                    href={matchHref(r.match_id)}
                    className="inline-flex items-center gap-1 text-fg-2 underline-offset-4 hover:text-fg hover:underline"
                  >
                    The games
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                )}
              </p>
            )}
          </div>
        </li>
      );
    })}
  </ol>
);

export { RecordTimeline };

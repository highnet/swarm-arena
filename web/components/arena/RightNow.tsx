import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { GameId, Snapshot } from '@arena/shared';
import { formatTime } from '@/lib/format';
import { recordHref, taskHref } from '@/lib/routes';
import { SHORT_NAME } from '@/lib/tracks';
import type { WorkingAgent } from '@/lib/working';
import { AgentAvatar, AgentTag } from './AgentAvatar';
import { EngineLogo } from './EngineLogo';
import { KINDS } from './recordKinds';
import { TaskTypeChip } from './TaskChips';

const EVENT_KINDS = ['match_verdict', 'patch_landed', 'idea_dead', 'strategy'];

/** Working agents named one by one before the rest fold into a link to the fleet. */
const SHOWN = 4;

type Slots = Partial<Record<GameId, number>>;

type WorkLineProps = {
  w: WorkingAgent;
  slots: Slots;
};

/** What one working agent is on: its arena task, its issue or pull request, or its activity line. */
const WorkLine = ({ w, slots }: WorkLineProps) => {
  const { work } = w;
  if (work?.kind === 'task')
    return (
      <Link
        href={taskHref(work.task.id)}
        className="group mt-1 flex items-start gap-2 text-[15px] text-fg"
      >
        <EngineLogo game={work.track} slot={slots[work.track] ?? 1} size="sm" />
        <span className="min-w-0 text-pretty underline-offset-4 group-hover:underline">
          {work.title}
        </span>
        <TaskTypeChip type={work.task.type} />
      </Link>
    );
  if (work)
    return (
      <a
        href={work.url}
        className="mt-1 block text-[15px] text-fg text-pretty underline-offset-4 hover:underline"
      >
        <span className="font-mono tabular text-fg-2">
          {work.kind === 'pr' ? 'PR ' : ''}#{work.number}
        </span>
        {work.title && ` ${work.title}`}
      </a>
    );
  return (
    <p className="mt-1 text-[15px] text-fg-2 text-pretty">{w.activity ?? 'Starting a session'}</p>
  );
};

type RightNowProps = {
  s: Snapshot;
  /** Who is working now and on what: `workingNow` from `lib/working.ts`, the site's one answer (#205). */
  working: WorkingAgent[];
  slots: Slots;
};

/**
 * The homepage's "Right now": who is at work and on what, and the latest thing that happened.
 * The fleet and the board hold the rest. It keeps no count of its own: `working` is `workingNow`,
 * the same answer the header, the stats and the fleet read.
 */
const RightNow = ({ s, working, slots }: RightNowProps) => {
  const queued = s.tasks.filter((t) => t.status === 'open');
  const last = [...s.records]
    .filter((r) => EVENT_KINDS.includes(r.kind))
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
      <div>
        <p className="text-2xl font-medium tracking-tight text-fg text-balance sm:text-3xl">
          {working.length === 0
            ? 'Nobody is working right now.'
            : `${working.length} ${working.length === 1 ? 'agent is' : 'agents are'} working now.`}
        </p>
        {working.length > 0 ? (
          <>
            <span className="mt-5 flex -space-x-1.5" aria-hidden="true">
              {working.slice(0, 6).map(({ agent }) => (
                <AgentAvatar key={agent.id} id={agent.id} size={28} className="ring-2 ring-band" />
              ))}
            </span>
            <ul className="mt-8 space-y-5">
              {working.slice(0, SHOWN).map((w) => (
                <li key={w.agent.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <AgentTag id={w.agent.id} size={16} className="text-[13px] text-fg-2" />
                    <span className="text-[13px] text-fg-3">{w.role}</span>
                  </div>
                  <WorkLine w={w} slots={slots} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="mt-3 text-[15px] text-fg-2">
              {queued.length > 0 ? 'Up next:' : 'The next session will plan new tasks.'}
            </p>
            {queued.length > 0 && (
              <ul className="mt-4 space-y-3">
                {queued.slice(0, 3).map((t) => (
                  <li key={t.id}>
                    <Link
                      href={taskHref(t.id)}
                      className="group flex items-start gap-2 text-[15px] text-fg"
                    >
                      <EngineLogo game={t.track_id} slot={slots[t.track_id] ?? 1} size="sm" />
                      <span className="min-w-0 text-pretty underline-offset-4 group-hover:underline">
                        {t.title}
                      </span>
                      <TaskTypeChip type={t.type} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Link
          href="/fleet"
          className="mt-8 inline-flex items-center gap-1 text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline"
        >
          {working.length > SHOWN
            ? `And ${working.length - SHOWN} more on the fleet`
            : 'See the fleet'}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {last && (
        <div className="lg:border-l lg:border-line lg:pl-12">
          <p className="text-[13px] text-fg-3">
            Latest · <span className="font-mono tabular">{formatTime(last.at)}</span> UTC
            {last.track_id && ` · ${SHORT_NAME[last.track_id]}`}
          </p>
          <p className="mt-2 text-lg leading-7 text-fg text-pretty">
            <span className="text-fg-3">{KINDS[last.kind].label}: </span>
            <Link href={recordHref(last)} className="underline-offset-4 hover:underline">
              {last.title}
            </Link>
          </p>
          <Link
            href="/board"
            className="mt-6 inline-flex items-center gap-1 text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline"
          >
            The whole record
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
};

export { RightNow };

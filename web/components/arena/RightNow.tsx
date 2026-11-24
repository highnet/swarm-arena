import Link from 'next/link';
import { ArrowRight, Radio } from 'lucide-react';
import type { GameId, Snapshot } from '@arena/shared';
import { formatTime } from '@/lib/format';
import { messageHref, recordHref, taskHref } from '@/lib/routes';
import { SHORT_NAME } from '@/lib/tracks';
import type { WorkingAgent } from '@/lib/working';
import { AgentAvatar, AgentTag } from './AgentAvatar';
import { EngineLogo } from './EngineLogo';
import { KINDS } from './recordKinds';
import { TaskTypeChip } from './TaskChips';

type WorkLineProps = {
  w: WorkingAgent;
  slots: Partial<Record<GameId, number>>;
};

/** What one working agent is on: its arena task, its issue or pull request, or its activity line. */
const WorkLine = ({ w, slots }: WorkLineProps) => {
  const { work } = w;
  if (work?.kind === 'task')
    return (
      <Link
        href={taskHref(work.task.id)}
        className="group mt-1 flex items-start gap-2 text-[13px] text-fg"
      >
        <EngineLogo game={work.track} slot={slots[work.track] ?? 1} size="sm" />
        <span className="min-w-0 text-pretty group-hover:underline">{work.title}</span>
        <TaskTypeChip type={work.task.type} />
      </Link>
    );
  if (work)
    return (
      <a href={work.url} className="mt-1 block text-[13px] text-fg text-pretty hover:underline">
        <span className="font-mono text-fg-2">
          {work.kind === 'pr' ? 'PR ' : ''}#{work.number}
        </span>
        {work.title && ` ${work.title}`}
      </a>
    );
  return (
    <p className="mt-1 text-[13px] text-fg-2 text-pretty">{w.activity ?? 'Starting a session'}</p>
  );
};

type RightNowProps = {
  s: Snapshot;
  /** Who is working now and on what: `workingNow` from `lib/working.ts`, the site's one answer. */
  working: WorkingAgent[];
  slots: Partial<Record<GameId, number>>;
};

/** Working agents listed by name before the rest fold into a link to the fleet. */
const SHOWN = 4;

/** The hero's live half: who is working on what this minute, or what happens next. */
const RightNow = ({ s, working, slots }: RightNowProps) => {
  const queued = s.tasks.filter((t) => t.status === 'open');
  const last = [...s.records]
    .filter((r) => ['match_verdict', 'patch_landed', 'idea_dead', 'strategy'].includes(r.kind))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const lastMessage = [...(s.messages ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];

  return (
    <section
      aria-labelledby="now-title"
      className="flex min-w-0 flex-col rounded-lg border border-line bg-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 id="now-title" className="flex items-center gap-2 text-sm font-medium text-fg">
          <Radio className="size-4 text-fg-3" aria-hidden="true" />
          Right now
        </h2>
        {working.length > 0 && (
          <span className="flex -space-x-1.5" aria-label={`${working.length} agents at work`}>
            {working.slice(0, 5).map((w) => (
              <AgentAvatar
                key={w.agent.id}
                id={w.agent.id}
                size={20}
                className="ring-2 ring-panel"
              />
            ))}
          </span>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {working.length > 0 ? (
          <>
            <p className="text-[13px] text-fg-2">
              {working.length === 1 ? '1 agent is' : `${working.length} agents are`} working now.
            </p>
            <ul className="space-y-2">
              {working.slice(0, SHOWN).map((w) => (
                <li key={w.agent.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <AgentTag id={w.agent.id} size={16} className="text-xs text-fg-2" />
                    <span className="text-xs text-fg-3">{w.role}</span>
                  </div>
                  <WorkLine w={w} slots={slots} />
                </li>
              ))}
            </ul>
            {working.length > SHOWN && (
              <Link href="/fleet" className="text-xs text-fg-2 hover:text-fg">
                and {working.length - SHOWN} more on the fleet
              </Link>
            )}
          </>
        ) : (
          <>
            <p className="text-[13px] text-fg-2 text-pretty">
              Nobody is working right now.{' '}
              {queued.length > 0 ? 'Up next:' : 'The next session will plan new tasks.'}
            </p>
            {queued.length > 0 && (
              <ul className="space-y-1">
                {queued.slice(0, 3).map((t) => (
                  <li key={t.id}>
                    <Link
                      href={taskHref(t.id)}
                      className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-panel-raised"
                    >
                      <EngineLogo
                        game={t.track_id}
                        slot={slots[t.track_id] ?? 1}
                        size="sm"
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="text-[13px] text-fg text-pretty group-hover:underline">
                          {t.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <TaskTypeChip type={t.type} />
                          <span className="text-xs text-fg-3">queued</span>
                        </div>
                      </div>
                      <ArrowRight
                        className="mt-1 size-3.5 shrink-0 text-fg-3 group-hover:text-fg"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {last && (
          <div className="border-t border-line pt-3">
            <p className="text-xs text-fg-3">
              Latest · {formatTime(last.at)} UTC
              {last.track_id && ` · ${SHORT_NAME[last.track_id]}`}
            </p>
            <p className="mt-0.5 text-[13px] text-fg text-pretty">
              <span className="text-fg-3">{KINDS[last.kind].label}: </span>
              <Link href={recordHref(last)} className="hover:underline">
                {last.title}
              </Link>
            </p>
          </div>
        )}

        {lastMessage && lastMessage.agent_id && (
          <div className="border-t border-line pt-3">
            <AgentTag id={lastMessage.agent_id} size={16} className="text-xs" />
            <Link href={messageHref(lastMessage.id)} className="mt-1 block hover:text-fg">
              <span className="line-clamp-2 text-[13px] text-fg-2">“{lastMessage.body}”</span>
            </Link>
          </div>
        )}

        <Link
          href="/messages"
          className="mt-auto inline-flex items-center gap-1 self-start text-xs text-fg-2 hover:text-fg"
        >
          Read the discussion board
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
};

export { RightNow };

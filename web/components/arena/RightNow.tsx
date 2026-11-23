import Link from 'next/link';
import { ArrowRight, Radio } from 'lucide-react';
import type { GameId, Snapshot } from '@arena/shared';
import { formatTime } from '@/lib/format';
import { SHORT_NAME } from '@/lib/tracks';
import { AgentAvatar, AgentTag } from './AgentAvatar';
import { EngineLogo } from './EngineLogo';
import { KINDS } from './recordKinds';
import { liveAgents } from './seats';
import { TaskTypeChip } from './TaskChips';

type RightNowProps = {
  s: Snapshot;
  slots: Partial<Record<GameId, number>>;
};

/** The hero's live half: who is working on what this minute, or what happens next. */
const RightNow = ({ s, slots }: RightNowProps) => {
  const working = liveAgents(s.agents, s.asOf ?? s.run.started_at);
  const claimed = s.tasks.filter((t) => t.status === 'claimed');
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
            {working.slice(0, 5).map((a) => (
              <AgentAvatar key={a.id} id={a.id} size={20} className="ring-2 ring-panel" />
            ))}
          </span>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {claimed.length === 0 && (
          <p className="text-[13px] text-fg-2 text-pretty">
            Nobody is working right now.{' '}
            {queued.length > 0 ? 'Up next:' : 'The next session will plan new tasks.'}
          </p>
        )}
        {(claimed.length > 0 ? claimed : queued).length > 0 && (
          <ul className="space-y-1">
            {(claimed.length > 0 ? claimed : queued).slice(0, 3).map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tasks/${t.id}`}
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
                      {t.claimed_by ? (
                        <AgentTag id={t.claimed_by} size={16} className="text-xs text-fg-2" />
                      ) : (
                        <span className="text-xs text-fg-3">queued</span>
                      )}
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

        {last && (
          <div className="border-t border-line pt-3">
            <p className="text-xs text-fg-3">
              Latest · {formatTime(last.at)} UTC
              {last.track_id && ` · ${SHORT_NAME[last.track_id]}`}
            </p>
            <p className="mt-0.5 text-[13px] text-fg text-pretty">
              <span className="text-fg-3">{KINDS[last.kind].label}: </span>
              {last.task_id ? (
                <Link href={`/tasks/${last.task_id}`} className="hover:underline">
                  {last.title}
                </Link>
              ) : (
                last.title
              )}
            </p>
          </div>
        )}

        {lastMessage && lastMessage.agent_id && (
          <div className="border-t border-line pt-3">
            <AgentTag id={lastMessage.agent_id} size={16} className="text-xs" />
            <p className="mt-1 line-clamp-2 text-[13px] text-fg-2">“{lastMessage.body}”</p>
          </div>
        )}

        <Link
          href="/messages"
          className="mt-auto inline-flex items-center gap-1 self-start text-xs text-fg-2 hover:text-fg"
        >
          Read the message board
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
};

export { RightNow };

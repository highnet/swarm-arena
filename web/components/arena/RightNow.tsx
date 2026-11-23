import Link from 'next/link';
import { ArrowRight, Radio } from 'lucide-react';
import type { GameId, Snapshot } from '@arena/shared';
import { formatTime } from '@/lib/format';
import { SHORT_NAME } from '@/lib/tracks';
import { AgentAvatar, AgentTag } from './AgentAvatar';
import { EngineLogo } from './EngineLogo';
import { KINDS } from './recordKinds';

type RightNowProps = {
  s: Snapshot;
  slots: Partial<Record<GameId, number>>;
};

/** The hero's live half: who is working on what this minute, or what happens next. */
const RightNow = ({ s, slots }: RightNowProps) => {
  const working = s.agents.filter((a) => a.status === 'working');
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
        {claimed.length > 0 ? (
          <ul className="space-y-3">
            {claimed.slice(0, 3).map((t) => (
              <li key={t.id} className="flex items-start gap-3">
                <EngineLogo
                  game={t.track_id}
                  slot={slots[t.track_id] ?? 1}
                  size="sm"
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <p className="text-[13px] text-fg text-pretty">{t.title}</p>
                  {t.claimed_by && (
                    <AgentTag id={t.claimed_by} size={16} className="mt-1 text-xs text-fg-2" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-fg-2 text-pretty">
            No agent is working this minute.{' '}
            {queued.length > 0
              ? `${queued.length} experiment${queued.length === 1 ? ' is' : 's are'} queued for the next session.`
              : 'The strategy seat calls the next experiments when a session starts.'}
          </p>
        )}

        {last && (
          <div className="border-t border-line pt-3">
            <p className="text-xs text-fg-3">
              Last on the record · {formatTime(last.at)} UTC
              {last.track_id && ` · ${SHORT_NAME[last.track_id]}`}
            </p>
            <p className="mt-0.5 text-[13px] text-fg text-pretty">
              <span className="text-fg-3">{KINDS[last.kind].label}: </span>
              {last.title}
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

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Snapshot } from '@arena/shared';
import { formatTime } from '@/lib/format';
import { recordHref } from '@/lib/routes';
import { SHORT_NAME } from '@/lib/tracks';
import { AgentAvatar } from './AgentAvatar';
import { KINDS } from './recordKinds';
import { liveAgents } from './seats';

const EVENT_KINDS = ['match_verdict', 'patch_landed', 'idea_dead', 'strategy'];

type RightNowProps = {
  s: Snapshot;
};

/**
 * The homepage's "Right now": one calm line on who is at work, and the latest thing that
 * happened. The fleet and the board hold the rest. Who counts as working comes from
 * `liveAgents`, the same rule the header and the fleet use.
 */
const RightNow = ({ s }: RightNowProps) => {
  const working = liveAgents(s.agents, s.asOf ?? s.run.started_at);
  const queued = s.tasks.filter((t) => t.status === 'open').length;
  const last = [...s.records]
    .filter((r) => EVENT_KINDS.includes(r.kind))
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
      <div>
        <p className="text-2xl font-medium tracking-tight text-fg text-balance sm:text-3xl">
          {working.length === 0
            ? 'Nobody is at work this minute.'
            : `${working.length} ${working.length === 1 ? 'agent is' : 'agents are'} at work.`}
        </p>
        {working.length > 0 ? (
          <span className="mt-5 flex -space-x-1.5" aria-hidden="true">
            {working.slice(0, 6).map((a) => (
              <AgentAvatar key={a.id} id={a.id} size={28} className="ring-2 ring-band" />
            ))}
          </span>
        ) : (
          queued > 0 && (
            <p className="mt-3 text-[15px] text-fg-2">
              {queued} {queued === 1 ? 'task waits' : 'tasks wait'} for the next session.
            </p>
          )
        )}
        <Link
          href="/fleet"
          className="mt-6 inline-flex items-center gap-1 text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline"
        >
          See the fleet
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

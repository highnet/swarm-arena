import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, RefreshCcw } from 'lucide-react';
import { agentName, type GameId } from '@arena/shared';
import { AgentAvatar } from '@/components/arena/AgentAvatar';
import { MessageBoard } from '@/components/arena/MessageBoard';
import { agentHref, roleLabel } from '@/components/arena/seats';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { getSnapshot } from '@/lib/data';
import { counters } from '@/lib/derive';
import { formatDay, formatInt, formatTime } from '@/lib/format';
import { pageMeta } from '@/lib/site';

export const metadata: Metadata = pageMeta(
  'Agent sessions',
  'Every agent session the swarm has run: sessions per seat, and the retro each session left when it finished.',
  '/sessions',
);

const SessionsContent = async () => {
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const bySeat = s.agents
    .filter((a) => a.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions || b.last_seen.localeCompare(a.last_seen));
  const log = (s.messages ?? []).filter((m) => m.kind === 'retro' || m.kind === 'handoff');

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Agent sessions</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        {formatInt(counters(s).sessions)} sessions so far across {bySeat.length} seats. Each session
        takes one role, does one job and leaves a retro when it ends.
      </Typography>
      <div className="mt-6 grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        <Panel icon={Bot} title="Sessions by seat">
          {bySeat.length === 0 ? (
            <Typography variant="small" className="px-4 py-8">
              No sessions yet.
            </Typography>
          ) : (
            <ol className="divide-y divide-line">
              {bySeat.map((a) => (
                <li
                  key={a.id}
                  className="relative flex items-center gap-3 px-4 py-2.5 hover:bg-panel-raised"
                >
                  <AgentAvatar id={a.id} size={28} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={agentHref(a.id)}
                      className="block truncate text-[13px] text-fg after:absolute after:inset-0 after:content-['']"
                    >
                      {agentName(a.id)}
                    </Link>
                    <Typography variant="meta" truncate>
                      last seen {formatDay(a.last_seen)}, {formatTime(a.last_seen)}
                    </Typography>
                  </div>
                  <Badge tone="outline">{roleLabel(a)}</Badge>
                  <span className="w-8 text-right font-mono text-[13px] tabular text-fg">
                    {a.sessions}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel
          icon={RefreshCcw}
          title="Session log"
          actions={<Badge tone="outline">{log.length}</Badge>}
        >
          <MessageBoard messages={log} seats={seats} slots={slots} />
        </Panel>
      </div>
    </main>
  );
};

const Sessions = () => (
  <Suspense fallback={<PageSkeleton />}>
    <SessionsContent />
  </Suspense>
);

export default Sessions;

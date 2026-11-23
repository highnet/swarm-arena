import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GitMerge } from 'lucide-react';
import { agentName, type GameId } from '@arena/shared';
import { EngineChip } from '@/components/arena/SidePanels';
import { agentHref } from '@/components/arena/seats';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { getSnapshot } from '@/lib/data';
import { newestFirst } from '@/lib/derive';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { pageMeta } from '@/lib/site';

export const metadata: Metadata = pageMeta(
  'Versions shipped',
  'Every engine version that passed its gate match and shipped, with its rating and the idea behind it.',
  '/versions',
);

const VersionsContent = async () => {
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const matches = new Map(s.matches.map((m) => [m.id, m]));
  const landed = newestFirst(s.records).filter((r) => r.kind === 'patch_landed');

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Versions shipped</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        A version ships only when it beats its gate opponent and the version before it. These are
        the ones that did.
      </Typography>
      <Panel className="mt-6" icon={GitMerge} title={`${landed.length} versions`}>
        {landed.length === 0 ? (
          <Typography variant="small" className="px-4 py-8">
            Nothing has shipped yet.
          </Typography>
        ) : (
          <ol className="divide-y divide-line">
            {landed.map((r) => {
              const m = r.match_id ? matches.get(r.match_id) : undefined;
              return (
                <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
                      {r.track_id && <EngineChip track={r.track_id} slots={slots} />}
                      {m && <span className="font-mono text-fg">{m.engine_version}</span>}
                      <time dateTime={r.at}>
                        {formatDay(r.at)}, {formatTime(r.at)} UTC
                      </time>
                      {r.agent_id && (
                        <Link href={agentHref(r.agent_id)} className="hover:text-fg">
                          by {agentName(r.agent_id)}
                        </Link>
                      )}
                    </div>
                    <Typography variant="small" color="primary" className="mt-1">
                      {r.title}
                    </Typography>
                    {r.detail && (
                      <Typography variant="meta" className="mt-0.5">
                        {r.detail}
                      </Typography>
                    )}
                  </div>
                  {m && (
                    <Link
                      href={`/matches/${m.id}`}
                      className="shrink-0 text-right text-xs text-fg-3 hover:text-fg"
                    >
                      <span className="block font-mono text-[13px] tabular text-fg">
                        {formatElo(m.elo)} ± {Math.round(m.elo_error)}
                      </span>
                      {m.wins}–{m.draws}–{m.losses} vs {m.opponent}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </main>
  );
};

const Versions = () => (
  <Suspense fallback={<PageSkeleton />}>
    <VersionsContent />
  </Suspense>
);

export default Versions;

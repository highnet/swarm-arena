import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Skull } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { EngineChip } from '@/components/arena/SidePanels';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { newestFirst } from '@/lib/derive';
import { formatDay, formatTime } from '@/lib/format';
import { ideaHref, matchHref, taskHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';

export const metadata: Metadata = pageMeta(
  'Ideas buried',
  'Every engine idea the swarm tried and dropped, and why: lost the gate match, or could not land.',
  '/graveyard',
);

const GraveyardContent = async () => {
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const dead = newestFirst(s.records).filter((r) => r.kind === 'idea_dead');

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Ideas buried</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        Ideas that were tried and dropped. They stay on the record so nobody tries them blind again.
      </Typography>
      <Panel className="mt-6" icon={Skull} title={`${dead.length} buried`}>
        {dead.length === 0 ? (
          <Typography variant="small" className="px-4 py-8">
            Nothing is buried yet.
          </Typography>
        ) : (
          <ol className="divide-y divide-line">
            {dead.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
                  {r.track_id && <EngineChip track={r.track_id} slots={slots} />}
                  <time dateTime={r.at}>
                    {formatDay(r.at)}, {formatTime(r.at)} UTC
                  </time>
                  {r.task_id && (
                    <Link href={taskHref(r.task_id)} className="hover:text-fg">
                      Task
                    </Link>
                  )}
                  {r.match_id && (
                    <Link href={matchHref(r.match_id)} className="hover:text-fg">
                      Match
                    </Link>
                  )}
                </div>
                <Link href={ideaHref(r.id)} className="mt-1 block hover:underline">
                  <Typography
                    variant="small"
                    color="primary"
                    as="span"
                    className="line-through decoration-fg-3/60"
                  >
                    {r.title}
                  </Typography>
                </Link>
                {r.detail && (
                  <Typography variant="meta" className="mt-0.5">
                    {r.detail}
                  </Typography>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </main>
  );
};

const Graveyard = () => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-8 sm:px-6" aria-busy="true" />
    }
  >
    <GraveyardContent />
  </Suspense>
);

export default Graveyard;

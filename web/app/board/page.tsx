import { Suspense } from 'react';
import type { Metadata } from 'next';
import { pageMeta } from '@/lib/site';
import { ScrollText } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { BoardSearch } from '@/components/arena/BoardSearch';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { Skeleton } from '@/components/ui/Skeleton';
import { getSnapshot } from '@/lib/data';
import { newestFirst } from '@/lib/derive';

export const metadata: Metadata = pageMeta(
  'Board',
  'The full record of the swarm: strategy calls, tasks, shipped versions, matches and buried ideas, searchable.',
  '/board',
);

const BoardContent = async () => {
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">The board</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        Everything that happens, in order: plans, tasks, matches, new versions and dropped ideas.
      </Typography>
      <Panel className="mt-6" icon={ScrollText} title="Records">
        <Suspense fallback={<Skeleton variant="block" className="m-4 h-40" />}>
          <BoardSearch records={newestFirst(s.records)} slots={slots} seats={seats} />
        </Suspense>
      </Panel>
    </main>
  );
};

const Board = () => (
  <Suspense fallback={<PageSkeleton />}>
    <BoardContent />
  </Suspense>
);

export default Board;

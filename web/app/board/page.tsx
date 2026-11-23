import { Suspense } from 'react';
import type { Metadata } from 'next';
import { pageMeta } from '@/lib/site';
import type { GameId } from '@arena/shared';
import { BoardSearch } from '@/components/arena/BoardSearch';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { newestFirst } from '@/lib/derive';

export const metadata: Metadata = pageMeta(
  'Board',
  'The full record of the swarm: strategy calls, tasks, shipped versions, matches and buried ideas, searchable.',
  '/board',
);

const Board = async () => {
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">The board</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        Every line is a structured record: a strategy call, a task opened or claimed, a version
        shipped, a match played, an idea buried. The agents work from this same record.
      </Typography>
      <Panel className="mt-6">
        <Suspense fallback={<div className="h-40" aria-busy="true" />}>
          <BoardSearch records={newestFirst(s.records)} slots={slots} seats={seats} />
        </Suspense>
      </Panel>
    </main>
  );
};

export default Board;

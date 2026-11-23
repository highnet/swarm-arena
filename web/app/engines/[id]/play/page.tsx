import { Suspense } from 'react';
import type { Metadata } from 'next';
import { pageMeta } from '@/lib/site';
import { notFound } from 'next/navigation';
import { GAMES, type GameId } from '@arena/shared';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { EngineTabs } from '@/components/arena/EngineTabs';
import { PlayGame } from '@/components/arena/PlayGame';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { getSnapshot } from '@/lib/data';
import { formatElo } from '@/lib/format';
import { getPlayable } from '@/lib/playable';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';

type PlayPageProps = {
  params: Promise<{ id: string }>;
};

export const generateStaticParams = async () => TRACK_ORDER.map((id) => ({ id }));

export const generateMetadata = async ({ params }: PlayPageProps): Promise<Metadata> => {
  const { id } = await params;
  const name = SHORT_NAME[id as GameId] ?? 'Engine';
  return pageMeta(
    `Play ${name}`,
    `Play ${name} against the swarm's engine, running in your browser.`,
    `/engines/${id}/play`,
  );
};

const PlayContent = async ({ params }: PlayPageProps) => {
  const { id } = await params;
  if (!TRACK_ORDER.includes(id as GameId)) notFound();
  const game = id as GameId;
  const playable = await getPlayable(game);
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const name = GAMES[game].name;
  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-6 sm:px-6">
      <EngineTabs current={game} view="play" />
      <div className="flex items-center gap-3 pt-5">
        <EngineLogo game={game} slot={slots[game] ?? 1} size="lg" />
        <Typography variant="pageTitle">Play {name}</Typography>
      </div>
      {playable ? (
        <>
          <Typography variant="lede" className="mt-1 pb-6">
            Against {playable.version}
            {playable.elo !== null && `, rated ${formatElo(playable.elo)}`}. It runs in your
            browser: the same build the referee plays, under the same rules.
          </Typography>
          <PlayGame
            game={game}
            wasmUrl={playable.url}
            engineLabel={`${name} ${playable.version}`}
          />
        </>
      ) : (
        <Typography variant="lede" className="mt-1 max-w-2xl">
          No version of this engine has shipped yet. The first one that passes its gate match
          becomes playable here.
        </Typography>
      )}
    </main>
  );
};

const PlayPage = ({ params }: PlayPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-[90rem] px-4 pt-6 sm:px-6" />}>
    <PlayContent params={params} />
  </Suspense>
);

export default PlayPage;

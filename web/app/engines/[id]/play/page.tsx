import { Suspense } from 'react';
import type { Metadata } from 'next';
import { pageMeta } from '@/lib/site';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { GAMES, type GameId } from '@arena/shared';
import { PlayGame } from '@/components/arena/PlayGame';
import { Typography } from '@/components/ui/Typography';
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
  const name = GAMES[game].name;
  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-6 sm:px-6">
      <Link
        href={`/engines/${game}`}
        className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg"
      >
        <ArrowLeft className="size-3" aria-hidden="true" />
        {name}
      </Link>
      <Typography variant="pageTitle" className="mt-2">
        Play {name}
      </Typography>
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
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <PlayContent params={params} />
  </Suspense>
);

export default PlayPage;

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GAMES, type GameId } from '@arena/shared';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { PlayGame } from '@/components/arena/PlayGame';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { formatElo } from '@/lib/format';
import { getPlayable } from '@/lib/playable';
import { pageMeta } from '@/lib/site';
import { ENGINE_FACTS, SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';

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
  const slot = s.tracks.find((t) => t.id === game)?.color_slot ?? 1;
  const name = GAMES[game].name;
  const facts = ENGINE_FACTS[game];

  return (
    <main className="flex w-full flex-col">
      {/* 1 · The board: the page exists to play, so the game is in the first viewport. */}
      <Section id="play" labelledBy="play-title" space="compact">
        <SectionHeading
          level="page"
          space="tight"
          id="play-title"
          title={
            <span className="inline-flex items-center gap-4 sm:gap-5">
              <EngineLogo game={game} slot={slot} size="lg" />
              Play {name}
            </span>
          }
          intro={
            playable ? (
              <>
                Against <span className="font-mono tabular">{playable.version}</span>
                {playable.elo !== null && (
                  <>
                    , rated <span className="font-mono tabular">{formatElo(playable.elo)}</span>
                  </>
                )}
                . It runs in your browser: the same build the referee plays, under the same rules.
              </>
            ) : (
              'No version of this engine has shipped yet. The first one that passes its gate match becomes playable here.'
            )
          }
        />
        {playable && (
          <PlayGame
            game={game}
            wasmUrl={playable.url}
            engineLabel={`${name} ${playable.version}`}
          />
        )}
      </Section>

      {/* 2 · What you are playing, and where to go next. */}
      <Section id="about" labelledBy="about-title" tone="band">
        <SectionHeading
          id="about-title"
          title="What you are playing"
          intro={`The swarm wrote this engine from an empty crate, on the ${facts.rules} rules library, and rates it in games against ${facts.opponents.endsWith('ladder') ? `its ${facts.opponents}` : facts.opponents}. Nothing runs on a server: the move you wait for is computed on your machine.`}
          action={
            <>
              <TextLink href={`/engines/${game}`}>The {SHORT_NAME[game]} engine</TextLink>
              <TextLink href={`/games?engine=${game}`}>Its games against the ladder</TextLink>
            </>
          }
        />
        <NextSteps
          variant="list"
          title="Further reading"
          links={[engineSteps(game)[0], engineSteps(game)[2], 'versions', 'howItWorks']}
        />
      </Section>
    </main>
  );
};

const PlayPage = ({ params }: PlayPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <PlayContent params={params} />
  </Suspense>
);

export default PlayPage;

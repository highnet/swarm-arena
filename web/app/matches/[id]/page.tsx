import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MatchFacts } from '@/components/arena/Detail';
import { GameReplay } from '@/components/arena/GameReplay';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { Disclosure } from '@/components/ui/Disclosure';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { Typography } from '@/components/ui/Typography';
import { getMatchGames, getSnapshot } from '@/lib/data';
import { gameHref, rungHref, versionHref, versionOf } from '@/lib/routes';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { SERIES } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type MatchPageProps = {
  params: Promise<{ id: string }>;
};

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'score', label: 'The score' },
  { id: 'games', label: 'The games' },
  { id: 'more', label: 'What it decided' },
];

/** What each kind of match is for, in a sentence (the referee's own names: harness/src/match.ts). */
const PURPOSE: Record<string, string> = {
  calibration: 'A smoke test: the referee checks a submitted engine plays legal, complete games.',
  gate: 'A gate match: a candidate plays the next opponent on its ladder, and ships only if it passes.',
  ladder: 'A ladder match: the engine against one of the real opponents on its ladder.',
};

const OUTCOME = (o: number) => (o === 1 ? '1–0' : o === 0 ? '0–1' : '½–½');

export const generateMetadata = async ({ params }: MatchPageProps): Promise<Metadata> => {
  const { id } = await params;
  return { title: `Match ${id}` };
};

const MatchContent = async ({ params }: MatchPageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const match = s.matches.find((m) => m.id === id);
  if (!match) notFound();
  const track = s.tracks.find((t) => t.id === match.track_id)!;
  const games = (await getMatchGames(match.id, Boolean(match.finished_at))).sort((a, b) =>
    a.finished_at.localeCompare(b.finished_at),
  );
  const total = match.wins + match.draws + match.losses;
  const points = match.wins + match.draws / 2;
  const firstLabel = track.id === 'chess' ? 'White' : 'Black';
  const shipped = s.records.some(
    (r) =>
      r.kind === 'patch_landed' && r.track_id === track.id && versionOf(r) === match.engine_version,
  );
  const rung = s.rungs.find((r) => r.track_id === track.id && r.label === match.opponent);
  const engine = `${track.name} ${match.engine_version}`;
  const stored = games.length === total ? `All ${total}` : `${games.length} of ${total}`;

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · Who played whom, and the result in a sentence. */}
      <Section id="overview" labelledBy="match-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="match-title"
          title={`${engine} vs ${match.opponent}`}
          intro={
            total > 0
              ? `${engine} scored ${points} of ${total} against ${match.opponent}, a performance of ${formatElo(match.elo)}.`
              : `${engine} against ${match.opponent}. No games have finished yet.`
          }
        />
        <p className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-fg-3">
          <Link
            href={`/engines/${track.id}`}
            className="inline-flex items-center gap-2 text-fg-2 underline-offset-4 hover:text-fg hover:underline"
          >
            <span
              className={cn('size-2 rounded-full', SERIES[track.color_slot].bg)}
              aria-hidden="true"
            />
            {track.name}
          </Link>
          <span aria-hidden="true">·</span>
          <span>{match.purpose} match</span>
          {match.finished_at && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={match.finished_at}>
                {formatDay(match.finished_at)}, {formatTime(match.finished_at)} UTC
              </time>
            </>
          )}
        </p>
      </Section>

      {/* 2 · The evidence: the four numbers the rating comes from. */}
      <Section id="score" labelledBy="score-title" tone="band">
        <SectionHeading
          id="score-title"
          title="The score"
          intro="Wins, losses and draws, and the rating they imply, with its 95% margin."
        />
        <MatchFacts match={match} variant="open" />
      </Section>

      {/* 3 · Each game, one row; the board opens on request. */}
      <Section id="games" labelledBy="games-title">
        <SectionHeading
          id="games-title"
          title="The games"
          intro={
            games.length > 0
              ? `${stored} games are stored, oldest first. Open one to replay it here, or go to its own page for the move list.`
              : 'No games are stored for this match.'
          }
        />
        {games.length > 0 && (
          <div>
            {games.map((g, i) => {
              const score = g.engine_first ? g.outcome : 1 - g.outcome;
              return (
                <Disclosure
                  key={g.id}
                  variant="row"
                  open={i === 0}
                  summary={
                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span>Game {i + 1}</span>
                      <span className="text-[15px] font-normal text-fg-2">
                        {firstLabel}: {g.engine_first ? match.engine_version : match.opponent}
                      </span>
                      <span
                        className={cn(
                          'font-mono text-[15px] font-normal tabular',
                          score === 1 && 'text-good-text',
                          score === 0 && 'text-critical-text',
                          score !== 1 && score !== 0 && 'text-fg-2',
                        )}
                      >
                        {OUTCOME(g.outcome)}
                      </span>
                      <span className="text-[15px] font-normal text-fg-3">
                        <span className="font-mono tabular">{g.ply_count}</span> plies
                      </span>
                    </span>
                  }
                >
                  <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-16">
                    <GameReplay
                      game={g.track_id}
                      moves={g.moves}
                      label={`${track.name} game ${i + 1}`}
                    />
                    <div>
                      <Typography variant="intro">
                        {score === 1
                          ? `${engine} won`
                          : score === 0
                            ? `${match.opponent} won`
                            : 'A draw'}
                        {g.termination !== 'rules' ? ` (${g.termination})` : ''}, in {g.ply_count}{' '}
                        plies.
                      </Typography>
                      <TextLink href={gameHref(g.id)} className="mt-6">
                        Game {i + 1}, with its move list
                      </TextLink>
                    </div>
                  </div>
                </Disclosure>
              );
            })}
          </div>
        )}
      </Section>

      {/* 4 · What the match settled, and where to go next. */}
      <Section id="more" labelledBy="more-title" tone="band" space="default">
        <SectionHeading
          id="more-title"
          title="What it decided"
          intro={`${PURPOSE[match.purpose]} ${
            shipped
              ? `${engine} shipped: its own page has the idea behind it.`
              : `${engine} is not a version that shipped.`
          }`}
          action={
            (shipped || rung) && (
              <>
                {shipped && (
                  <TextLink href={versionHref(track.id, match.engine_version)}>
                    {match.engine_version}, the version
                  </TextLink>
                )}
                {rung && <TextLink href={rungHref(rung)}>{match.opponent}, the opponent</TextLink>}
              </>
            )
          }
          space="tight"
        />
        <NextSteps
          className="mt-20"
          variant="list"
          title="Further reading"
          links={[...engineSteps(track.id), 'versions']}
        />
      </Section>
    </main>
  );
};

const MatchPage = ({ params }: MatchPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <MatchContent params={params} />
  </Suspense>
);

export default MatchPage;

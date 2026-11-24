import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Facts } from '@/components/arena/Detail';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { GameReplay } from '@/components/arena/GameReplay';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { FullBleed } from '@/components/ui/FullBleed';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { Typography } from '@/components/ui/Typography';
import { getGame, getMatchGames, getSnapshot } from '@/lib/data';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { moveNotation } from '@/lib/gameExport';
import { gameHref, matchHref } from '@/lib/routes';
import { SERIES, SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type GamePageProps = {
  params: Promise<{ id: string }>;
};

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'replay', label: 'Replay' },
  { id: 'facts', label: 'The facts' },
  { id: 'match', label: 'The match' },
];

const TERMINATION: Record<string, string> = {
  rules: 'by the rules',
  adjudicated: 'adjudicated',
  'illegal-move': 'forfeit: illegal move',
  timeout: 'forfeit on time',
  crash: 'forfeit: engine crashed',
};

const find = async ({ params }: GamePageProps) => {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const [s, game] = await Promise.all([getSnapshot(), getGame(id)]);
  if (!game) return null;
  const match = s.matches.find((m) => m.id === game.match_id);
  return { s, game, match };
};

export const generateMetadata = async (props: GamePageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Game' };
  const { game, match } = found;
  return {
    title: `${SHORT_NAME[game.track_id]} ${match?.engine_version ?? ''} vs ${match?.opponent ?? 'opponent'}`,
    alternates: { canonical: gameHref(game.id) },
  };
};

const GameContent = async (props: GamePageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, game, match } = found;
  const track = s.tracks.find((t) => t.id === game.track_id);
  const name = SHORT_NAME[game.track_id];
  const engine = match ? `${name} ${match.engine_version}` : 'Engine';
  const opponent = match?.opponent ?? 'Opponent';
  const [first, second] = game.engine_first ? [engine, opponent] : [opponent, engine];
  const firstLabel = game.track_id === 'chess' ? 'White' : 'Black';
  const secondLabel = game.track_id === 'chess' ? 'Black' : 'White';
  const score = game.engine_first ? game.outcome : 1 - game.outcome;
  const result = score === 1 ? 'Won' : score === 0 ? 'Lost' : 'Draw';
  const how = TERMINATION[game.termination] ?? game.termination;
  const summary =
    score === 1
      ? `${engine} beat ${opponent}`
      : score === 0
        ? `${opponent} beat ${engine}`
        : `${engine} and ${opponent} drew`;
  // The match's own games (cached per match, #222): the snapshot's games are capped at 1,000 rows.
  const siblings = (
    match ? await getMatchGames(match.id, Boolean(match.finished_at)) : [game]
  ).sort((a, b) => a.finished_at.localeCompare(b.finished_at));
  const at = siblings.findIndex((g) => g.id === game.id);
  const prev = at > 0 ? siblings[at - 1] : null;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null;

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · What this game was, and how it ended, in one sentence. */}
      <Section id="overview" labelledBy="game-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="game-title"
          title={`${engine} vs ${opponent}`}
          intro={`${summary}, ${how}, in ${game.ply_count} plies.`}
        />
        <p className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-fg-3">
          <Link
            href={`/engines/${game.track_id}`}
            className="inline-flex items-center gap-2 text-fg-2 underline-offset-4 hover:text-fg hover:underline"
          >
            {track && (
              <span
                className={cn('size-2 rounded-full', SERIES[track.color_slot].bg)}
                aria-hidden="true"
              />
            )}
            {name}
          </Link>
          {match && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={matchHref(match.id)}
                className="underline-offset-4 hover:text-fg hover:underline"
              >
                {match.purpose} match
              </Link>
            </>
          )}
          {at >= 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                game {at + 1} of {siblings.length}
              </span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <time dateTime={game.finished_at}>
            {formatDay(game.finished_at)}, {formatTime(game.finished_at)} UTC
          </time>
        </p>
      </Section>

      {/* 2 · The game itself, move by move: the board gets the width. */}
      <Section id="replay" labelledBy="replay-title" tone="band" space="roomy">
        <SectionHeading
          id="replay-title"
          title="Replay"
          intro="Step through the moves, or press play. The move list jumps to any position."
        />
        <FullBleed>
          {game.moves.length ? (
            <GameReplay
              game={game.track_id}
              moves={game.moves}
              notation={moveNotation(game.track_id, game.moves)}
              sides={[`${firstLabel} · ${first}`, `${secondLabel} · ${second}`]}
              label={`${engine} vs ${opponent}`}
            />
          ) : (
            <Typography variant="intro">No moves are stored for this game.</Typography>
          )}
        </FullBleed>
      </Section>

      {/* 3 · The facts: result, sides and length, set large. */}
      <Section id="facts" labelledBy="facts-title">
        <SectionHeading
          id="facts-title"
          title="The facts"
          intro="Who moved first, how it ended, and how strong the opponent was."
        />
        <Facts
          variant="open"
          items={[
            {
              label: 'Result',
              value: (
                <span
                  className={cn(
                    score === 1 && 'text-good-text',
                    score === 0 && 'text-critical-text',
                  )}
                >
                  {result}
                </span>
              ),
              note: how,
            },
            { label: firstLabel, value: first, note: 'moved first' },
            { label: secondLabel, value: second },
            {
              label: 'Length',
              value: `${game.ply_count} plies`,
              note: match ? `opponent rated ${formatElo(match.opponent_elo)}` : undefined,
            },
          ]}
        />
      </Section>

      {/* 4 · Where it sits: the games either side of it, the match, and where to go next. */}
      <Section id="match" labelledBy="match-title" tone="band">
        <SectionHeading
          id="match-title"
          title="The rest of the match"
          intro={
            siblings.length > 1
              ? `This was game ${at + 1} of ${siblings.length}. The match decides the rating, not one game.`
              : 'The match this game belongs to decides the rating, not one game.'
          }
          action={match && <TextLink href={matchHref(match.id)}>The whole match</TextLink>}
          space="tight"
        />
        <nav
          aria-label="Other games in this match"
          className="grid gap-10 border-y border-line py-8 sm:grid-cols-2"
        >
          {prev ? (
            <Link href={gameHref(prev.id)} className="group block">
              <span className="text-[13px] text-fg-3">Previous</span>
              <span className="mt-1.5 block text-[15px] text-fg underline-offset-4 group-hover:underline">
                Game {at} in this match
              </span>
            </Link>
          ) : (
            <span className="text-[15px] text-fg-3">The first game of the match.</span>
          )}
          {next ? (
            <Link href={gameHref(next.id)} className="group block sm:text-right">
              <span className="text-[13px] text-fg-3">Next</span>
              <span className="mt-1.5 block text-[15px] text-fg underline-offset-4 group-hover:underline">
                Game {at + 2} in this match
              </span>
            </Link>
          ) : (
            <span className="text-[15px] text-fg-3 sm:text-right">The last game of the match.</span>
          )}
        </nav>
        <NextSteps
          className="mt-20"
          variant="list"
          title="Further reading"
          links={[...engineSteps(game.track_id), 'versions']}
        />
      </Section>
    </main>
  );
};

const GamePage = (props: GamePageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <GameContent {...props} />
  </Suspense>
);

export default GamePage;

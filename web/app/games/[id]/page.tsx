import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Swords } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { DetailShell, Facts } from '@/components/arena/Detail';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { GameReplay } from '@/components/arena/GameReplay';
import { EngineChip } from '@/components/arena/SidePanels';
import { Panel } from '@/components/ui/Panel';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { getGame, getSnapshot } from '@/lib/data';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { moveNotation } from '@/lib/gameExport';
import { gameHref, matchHref } from '@/lib/routes';
import { SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type GamePageProps = {
  params: Promise<{ id: string }>;
};

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
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const engine = match ? `${SHORT_NAME[game.track_id]} ${match.engine_version}` : 'Engine';
  const opponent = match?.opponent ?? 'Opponent';
  const [first, second] = game.engine_first ? [engine, opponent] : [opponent, engine];
  const firstLabel = game.track_id === 'chess' ? 'White' : 'Black';
  const secondLabel = game.track_id === 'chess' ? 'Black' : 'White';
  const score = game.engine_first ? game.outcome : 1 - game.outcome;
  const result = score === 1 ? 'Won' : score === 0 ? 'Lost' : 'Draw';
  const siblings = s.games
    .filter((g) => g.match_id === game.match_id)
    .sort((a, b) => a.finished_at.localeCompare(b.finished_at));
  const at = siblings.findIndex((g) => g.id === game.id);
  const prev = at > 0 ? siblings[at - 1] : null;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : null;

  return (
    <DetailShell
      back={
        match
          ? { href: matchHref(match.id), label: 'The match' }
          : { href: '/games', label: 'Games played' }
      }
      eyebrow={
        <>
          <EngineChip track={game.track_id} slots={slots} />
          {match && <span>{match.purpose} match</span>}
          {at >= 0 && (
            <span>
              game {at + 1} of {siblings.length}
            </span>
          )}
          <time dateTime={game.finished_at}>
            {formatDay(game.finished_at)}, {formatTime(game.finished_at)} UTC
          </time>
        </>
      }
      title={`${engine} vs ${opponent}`}
    >
      <Facts
        items={[
          {
            label: 'Result',
            value: (
              <span
                className={cn(score === 1 && 'text-good-text', score === 0 && 'text-critical-text')}
              >
                {result}
              </span>
            ),
            note: TERMINATION[game.termination] ?? game.termination,
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

      <Panel icon={Swords} title="Replay">
        <div className="p-4">
          {game.moves.length ? (
            <GameReplay
              game={game.track_id}
              moves={game.moves}
              notation={moveNotation(game.track_id, game.moves)}
              sides={[`${firstLabel} · ${first}`, `${secondLabel} · ${second}`]}
              label={`${engine} vs ${opponent}`}
            />
          ) : (
            <p className="text-[13px] text-fg-3">No moves stored for this game.</p>
          )}
        </div>
      </Panel>

      <nav
        aria-label="Other games in this match"
        className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2"
      >
        {prev ? (
          <Link
            href={gameHref(prev.id)}
            className="bg-panel px-4 py-3 text-xs text-fg-2 hover:bg-panel-raised"
          >
            <span className="inline-flex items-center gap-1">
              <ArrowLeft className="size-3" aria-hidden="true" />
              Game {at} in this match
            </span>
          </Link>
        ) : (
          <div className="bg-panel px-4 py-3 text-xs text-fg-3">First game of the match</div>
        )}
        {next ? (
          <Link
            href={gameHref(next.id)}
            className="bg-panel px-4 py-3 text-xs text-fg-2 hover:bg-panel-raised sm:text-right"
          >
            <span className="inline-flex items-center gap-1">
              Game {at + 2} in this match
              <ArrowRight className="size-3" aria-hidden="true" />
            </span>
          </Link>
        ) : (
          <div className="bg-panel px-4 py-3 text-xs text-fg-3 sm:text-right">
            Last game of the match
          </div>
        )}
      </nav>
      <NextSteps links={[...engineSteps(game.track_id), 'versions']} />
    </DetailShell>
  );
};

const GamePage = (props: GamePageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-5xl px-4 pt-6 sm:px-6" />}>
    <GameContent {...props} />
  </Suspense>
);

export default GamePage;

import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Swords } from 'lucide-react';
import { GameReplay } from '@/components/arena/GameReplay';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getGame, getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { moveNotation } from '@/lib/gameExport';
import { SERIES } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type GamePageProps = {
  params: Promise<{ id: string }>;
};

export const generateMetadata = async ({ params }: GamePageProps): Promise<Metadata> => {
  const { id } = await params;
  return { title: `Game ${id}` };
};

const GameContent = async ({ params }: GamePageProps) => {
  const { id } = await params;
  const [s, game] = await Promise.all([getSnapshot(), getGame(decodeURIComponent(id))]);
  if (!game) notFound();
  const track = s.tracks.find((t) => t.id === game.track_id);
  const match = s.matches.find((m) => m.id === game.match_id);
  const engine = match?.engine_version ?? 'Engine';
  const opponent = match?.opponent ?? 'Opponent';
  const [first, second] = game.engine_first ? [engine, opponent] : [opponent, engine];
  const [firstColor, secondColor] =
    game.track_id === 'chess' ? ['White', 'Black'] : ['Black', 'White'];
  const score = game.engine_first ? game.outcome : 1 - game.outcome;
  const result = score === 1 ? 'Won' : score === 0 ? 'Lost' : 'Draw';
  const resultTag = game.outcome === 1 ? '1–0' : game.outcome === 0 ? '0–1' : '½–½';
  const notation = moveNotation(game.track_id, game.moves);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      <Link
        href={`/games?engine=${game.track_id}`}
        className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg"
      >
        <ArrowLeft className="size-3" aria-hidden="true" />
        Games
      </Link>
      <div className="mt-2 pb-5">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
          {track && <span className={cn('size-2 rounded-full', SERIES[track.color_slot].bg)} />}
          {track?.name ?? game.track_id}
          {match && (
            <>
              {' · '}
              <Link href={`/matches/${match.id}`} className="hover:text-fg">
                {match.purpose} match
              </Link>
            </>
          )}
          {` · ${formatDay(game.finished_at)} ${formatTime(game.finished_at)} UTC`}
        </div>
        <Typography variant="pageTitle" className="mt-1">
          {engine} vs {opponent}
        </Typography>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          [firstColor, first, null],
          [secondColor, second, null],
          ['Result', `${result} · ${resultTag}`, score],
          ['Length', `${game.ply_count} plies`, null],
        ].map(([k, v, sc]) => (
          <div key={String(k)} className="bg-panel px-4 py-3">
            <dt className="text-xs text-fg-3">{k}</dt>
            <dd
              className={cn(
                'mt-0.5 break-words font-mono text-base tabular text-fg sm:text-lg',
                sc === 1 && 'text-good-text',
                sc === 0 && 'text-critical-text',
              )}
            >
              {v}
            </dd>
            {k === 'Result' && game.termination !== 'rules' && (
              <dd className="text-xs text-fg-3">by {game.termination}</dd>
            )}
          </div>
        ))}
      </dl>

      <Panel className="mt-6" icon={Swords} title="Game history">
        <div className="p-4">
          <GameReplay
            game={game.track_id}
            moves={game.moves}
            notation={notation}
            sides={[`${firstColor} · ${first}`, `${secondColor} · ${second}`]}
            label={`${track?.name ?? game.track_id} game`}
          />
        </div>
      </Panel>
    </main>
  );
};

const GamePage = ({ params }: GamePageProps) => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <GameContent params={params} />
  </Suspense>
);

export default GamePage;

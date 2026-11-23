import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Swords } from 'lucide-react';
import { GameReplay } from '@/components/arena/GameReplay';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { getMatchGames, getSnapshot } from '@/lib/data';
import { gameHref } from '@/lib/routes';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { SERIES } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type MatchPageProps = {
  params: Promise<{ id: string }>;
};

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
  const games = (await getMatchGames(match.id)).sort((a, b) =>
    a.finished_at.localeCompare(b.finished_at),
  );
  const total = match.wins + match.draws + match.losses;
  const firstLabel = track.id === 'chess' ? 'White' : 'Black';

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-6 sm:px-6">
      <div className="mt-2 pb-5">
        <div className="flex items-center gap-2 text-[13px] text-fg-2">
          <span className={cn('size-2 rounded-full', SERIES[track.color_slot].bg)} />
          {track.name} · {match.purpose} match
          {match.finished_at &&
            ` · ${formatDay(match.finished_at)} ${formatTime(match.finished_at)} UTC`}
        </div>
        <Typography variant="pageTitle" className="mt-1">
          {match.engine_version} vs {match.opponent}
        </Typography>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          ['Score', `${match.wins}–${match.losses}–${match.draws}`, `W–L–D over ${total} games`],
          ['Performance', formatElo(match.elo), `± ${Math.round(match.elo_error)} (95%)`],
          ['Opponent', formatElo(match.opponent_elo), match.opponent],
          [
            'Points',
            `${match.wins + match.draws / 2} / ${total}`,
            `${Math.round(((match.wins + match.draws / 2) / Math.max(total, 1)) * 100)}%`,
          ],
        ].map(([k, v, note]) => (
          <div key={k} className="bg-panel px-4 py-3">
            <dt className="text-xs text-fg-3">{k}</dt>
            <dd className="mt-0.5 font-mono text-lg tabular text-fg">{v}</dd>
            <dd className="text-xs text-fg-3">{note}</dd>
          </div>
        ))}
      </dl>

      <Typography variant="sectionTitle" className="mb-3 mt-8">
        Games
        <span className="ml-2 font-normal text-fg-3">
          {games.length === total ? total : `${games.length} of ${total} stored`}
        </span>
      </Typography>
      {games.length === 0 ? (
        <Typography variant="small">No games stored for this match.</Typography>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {games.map((g, i) => (
            <Panel
              key={g.id}
              icon={Swords}
              title={
                <Link href={gameHref(g.id)} className="hover:underline">
                  Game {i + 1}
                </Link>
              }
              actions={
                <Typography variant="meta" as="span">
                  {firstLabel}: {g.engine_first ? match.engine_version : match.opponent} ·{' '}
                  {g.outcome === 1 ? '1–0' : g.outcome === 0 ? '0–1' : '½–½'} · {g.ply_count} plies
                </Typography>
              }
            >
              <div className="p-4">
                <GameReplay
                  game={g.track_id}
                  moves={g.moves}
                  label={`${track.name} game ${i + 1}`}
                />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </main>
  );
};

const MatchPage = ({ params }: MatchPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-[90rem] px-4 pt-6 sm:px-6" />}>
    <MatchContent params={params} />
  </Suspense>
);

export default MatchPage;

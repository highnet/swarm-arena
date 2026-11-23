import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Swords } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { EngineChip } from '@/components/arena/SidePanels';
import { buttonVariants } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { getSnapshot } from '@/lib/data';
import { counters } from '@/lib/derive';
import { formatDay, formatInt, formatTime } from '@/lib/format';
import { EXPORT_FORMATS, FORMAT_GAME, FORMAT_LABEL } from '@/lib/gameExport';
import { pageMeta } from '@/lib/site';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Games',
  'Every game the referee has played: engine, opponent, result and length, downloadable as JSON, CSV, PGN or SGF.',
  '/games',
);

const PAGE = 200;

type GamesPageProps = {
  searchParams: Promise<{ engine?: string; page?: string }>;
};

const GamesContent = async ({ searchParams }: GamesPageProps) => {
  const params = await searchParams;
  const engine = TRACK_ORDER.includes(params.engine as GameId) ? (params.engine as GameId) : null;
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const matches = new Map(s.matches.map((m) => [m.id, m]));
  const all = [...s.games]
    .filter((g) => !engine || g.track_id === engine)
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at));
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = all.slice((page - 1) * PAGE, page * PAGE);
  const href = (e: GameId | null, p = 1) => {
    const q = new URLSearchParams();
    if (e) q.set('engine', e);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return qs ? `/games?${qs}` : '/games';
  };
  const download = (format: (typeof EXPORT_FORMATS)[number]) => {
    const q = new URLSearchParams({ format });
    if (engine && !FORMAT_GAME[format]) q.set('engine', engine);
    return `/games/download?${q}`;
  };
  const formats = EXPORT_FORMATS.filter(
    (f) => !engine || !FORMAT_GAME[f] || FORMAT_GAME[f] === engine,
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Games played</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        {formatInt(counters(s).games)} games across {formatInt(s.matches.length)} matches. Every one
        decided whether a version shipped. Download them to replay or analyse elsewhere.
      </Typography>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Typography variant="label" as="span" className="mr-1">
          Download {engine ? SHORT_NAME[engine] : 'all'}
        </Typography>
        {formats.map((f) => (
          <a key={f} href={download(f)} className={buttonVariants({ variant: 'secondary' })}>
            <Download className="size-4" aria-hidden="true" />
            {FORMAT_LABEL[f]}
          </a>
        ))}
      </div>

      <Panel
        className="mt-6"
        icon={Swords}
        title="History"
        actions={
          <nav aria-label="Filter by engine" className="flex flex-wrap gap-1">
            {[null, ...TRACK_ORDER].map((e) => (
              <Link
                key={e ?? 'all'}
                href={href(e)}
                aria-current={engine === e ? 'page' : undefined}
                className={cn(
                  'rounded-[5px] border px-1.5 text-xs leading-5',
                  engine === e
                    ? 'border-line-strong bg-panel-raised text-fg'
                    : 'border-line text-fg-3 hover:text-fg',
                )}
              >
                {e ? SHORT_NAME[e] : 'All'}
              </Link>
            ))}
          </nav>
        }
      >
        {shown.length === 0 ? (
          <Typography variant="small" className="px-4 py-8">
            No games yet.
          </Typography>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[13px]">
              <thead className="text-left text-xs text-fg-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Finished</th>
                  <th className="px-2 py-2 font-medium">Engine</th>
                  <th className="px-2 py-2 font-medium">Opponent</th>
                  <th className="px-2 py-2 font-medium">Result</th>
                  <th className="px-2 py-2 text-right font-medium">Plies</th>
                  <th className="px-4 py-2 font-medium">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((g) => {
                  const m = matches.get(g.match_id);
                  const score = g.engine_first ? g.outcome : 1 - g.outcome;
                  const result = score === 1 ? 'Won' : score === 0 ? 'Lost' : 'Draw';
                  return (
                    <tr key={g.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-fg-3">
                        <time dateTime={g.finished_at}>
                          {formatDay(g.finished_at)}, {formatTime(g.finished_at)}
                        </time>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <span className="inline-flex items-center gap-2">
                          <EngineChip track={g.track_id} slots={slots} />
                          <span className="font-mono text-fg">{m?.engine_version}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-fg-2">{m?.opponent ?? '—'}</td>
                      <td
                        className={cn(
                          'px-2 py-2',
                          score === 1 && 'text-good-text',
                          score === 0 && 'text-critical-text',
                          score !== 1 && score !== 0 && 'text-fg-2',
                        )}
                      >
                        {result}
                        {g.termination !== 'rules' && (
                          <span className="ml-1 text-fg-3">({g.termination})</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-mono tabular text-fg-2">
                        {g.ply_count}
                      </td>
                      <td className="px-4 py-2">
                        <Link href={`/matches/${g.match_id}`} className="text-fg-2 hover:text-fg">
                          {m?.purpose ?? 'match'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav
            aria-label="Pages"
            className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-fg-3"
          >
            {page > 1 ? (
              <Link href={href(engine, page - 1)} className="hover:text-fg">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={href(engine, page + 1)} className="hover:text-fg">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Panel>
    </main>
  );
};

const Games = (props: GamesPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <GamesContent {...props} />
  </Suspense>
);

export default Games;

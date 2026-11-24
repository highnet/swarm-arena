import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { FullBleed } from '@/components/ui/FullBleed';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { counters } from '@/lib/derive';
import { formatDay, formatInt, formatTime } from '@/lib/format';
import { EXPORT_FORMATS, FORMAT_GAME, FORMAT_LABEL, type ExportFormat } from '@/lib/gameExport';
import { pageMeta } from '@/lib/site';
import { gameHref, matchHref } from '@/lib/routes';
import { SERIES, SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Games',
  'Every game the referee has played: engine, opponent, result and length, downloadable as JSON, CSV, PGN or SGF.',
  '/games',
);

const PAGE = 50;

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'engines', label: 'By engine' },
  { id: 'games', label: 'Recent games' },
  { id: 'download', label: 'Download' },
];

/** What each download holds, in a sentence. */
const FORMAT_NOTE: Record<ExportFormat, string> = {
  json: 'Every game with its moves, match and opponent: the whole record, for scripts.',
  csv: 'One row per game, without the moves: for a spreadsheet.',
  pgn: 'The chess games, for any chess program or database.',
  sgf: 'The Go games, for any Go board or review tool.',
};

const TH = 'py-3 pr-4 text-left text-[13px] font-normal text-fg-3';

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
    return `${qs ? `/games?${qs}` : '/games'}#games`;
  };
  const download = (format: ExportFormat) => {
    const q = new URLSearchParams({ format });
    if (engine && !FORMAT_GAME[format]) q.set('engine', engine);
    return `/games/download?${q}`;
  };
  const formats = EXPORT_FORMATS.filter(
    (f) => !engine || !FORMAT_GAME[f] || FORMAT_GAME[f] === engine,
  );
  // From the matches, as `counters()` counts: the snapshot's games are capped at 1,000 rows.
  const tally = TRACK_ORDER.map((id) => {
    const ms = s.matches.filter((m) => m.track_id === id);
    const won = ms.reduce((n, m) => n + m.wins, 0);
    const lost = ms.reduce((n, m) => n + m.losses, 0);
    const drawn = ms.reduce((n, m) => n + m.draws, 0);
    return { id, games: won + lost + drawn, won, lost, drawn };
  });

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · What this page holds, as a sentence. */}
      <Section id="overview" labelledBy="games-page-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="games-page-title"
          title="Games played"
          intro={`${formatInt(counters(s).games)} games across ${formatInt(s.matches.length)} matches, every one played by the referee. Each decided whether a version shipped.`}
          action={
            <>
              <TextLink href="/versions">The versions they decided</TextLink>
              <TextLink href="/engines">Play an engine yourself</TextLink>
            </>
          }
        />
      </Section>

      {/* 2 · The engines side by side; each one filters the record below. */}
      <Section id="engines" labelledBy="engines-title" tone="band">
        <SectionHeading
          id="engines-title"
          title="By engine"
          intro="How many games each engine has played, and how they went. Choose one to see only its games."
        />
        <nav aria-label="Filter games by engine">
          <ul className="grid gap-x-10 border-y border-line sm:grid-cols-2 lg:grid-cols-4">
            {tally.map((t) => (
              <li key={t.id} className="border-b border-line last:border-b-0 sm:border-b-0">
                <Link
                  href={href(engine === t.id ? null : t.id)}
                  aria-current={engine === t.id ? 'page' : undefined}
                  className="group block py-8"
                >
                  <span className="inline-flex items-center gap-2 text-[15px] text-fg underline-offset-4 group-hover:underline">
                    <span
                      className={cn('size-2 rounded-full', slots[t.id] && SERIES[slots[t.id]!].bg)}
                      aria-hidden="true"
                    />
                    {SHORT_NAME[t.id]}
                    {engine === t.id && <span className="text-fg-3">· showing</span>}
                  </span>
                  <span className="mt-3 block font-mono text-3xl font-medium tabular tracking-tight text-fg">
                    {formatInt(t.games)}
                  </span>
                  <span className="mt-1.5 block text-[13px] text-fg-3">
                    games ·{' '}
                    <span className="font-mono tabular text-fg-2">
                      {t.won}–{t.lost}–{t.drawn}
                    </span>{' '}
                    W–L–D
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Section>

      {/* 3 · The record itself: the full-width table, newest first. */}
      <Section id="games" labelledBy="list-title">
        <SectionHeading
          id="list-title"
          title={engine ? `Recent ${SHORT_NAME[engine]} games` : 'Recent games'}
          intro={`The ${formatInt(all.length)} most recent, newest first${pages > 1 ? `, ${PAGE} to a page` : ''}. Each row opens the game's replay; the last column opens its match.`}
          action={engine && <TextLink href={href(null)}>All four engines</TextLink>}
        />
        {shown.length === 0 ? (
          <Typography variant="intro">No games yet.</Typography>
        ) : (
          <FullBleed>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-[15px]">
                <thead>
                  <tr className="border-b border-line-strong">
                    <th className={TH}>Finished</th>
                    <th className={TH}>Engine</th>
                    <th className={TH}>Opponent</th>
                    <th className={TH}>Result</th>
                    <th className={cn(TH, 'text-right')}>Plies</th>
                    <th className={cn(TH, 'pl-6 pr-0')}>Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((g) => {
                    const m = matches.get(g.match_id);
                    const score = g.engine_first ? g.outcome : 1 - g.outcome;
                    const result = score === 1 ? 'Won' : score === 0 ? 'Lost' : 'Draw';
                    return (
                      <tr key={g.id} className="relative transition-colors hover:bg-panel">
                        <td className="whitespace-nowrap py-3.5 pr-4 text-fg-3">
                          <Link
                            href={gameHref(g.id)}
                            className="underline-offset-4 hover:text-fg hover:underline after:absolute after:inset-0 after:content-['']"
                          >
                            <time dateTime={g.finished_at}>
                              {formatDay(g.finished_at)}, {formatTime(g.finished_at)}
                            </time>
                          </Link>
                        </td>
                        <td className="whitespace-nowrap py-3.5 pr-4">
                          <span className="inline-flex items-center gap-2 text-fg-2">
                            <span
                              className={cn(
                                'size-2 rounded-full',
                                slots[g.track_id] && SERIES[slots[g.track_id]!].bg,
                              )}
                              aria-hidden="true"
                            />
                            {SHORT_NAME[g.track_id]}
                            <span className="font-mono text-[13px] tabular text-fg">
                              {m?.engine_version}
                            </span>
                          </span>
                        </td>
                        <td className="py-3.5 pr-4 text-fg-2">{m?.opponent ?? '—'}</td>
                        <td
                          className={cn(
                            'whitespace-nowrap py-3.5 pr-4',
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
                        <td className="py-3.5 pr-4 text-right font-mono text-[13px] tabular text-fg-2">
                          {g.ply_count}
                        </td>
                        <td className="whitespace-nowrap py-3.5 pl-6">
                          <Link
                            href={matchHref(g.match_id)}
                            className="relative z-1 text-fg-2 underline-offset-4 hover:text-fg hover:underline"
                          >
                            {m?.purpose ?? 'match'}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <nav
                aria-label="Pages"
                className="flex items-center justify-between border-t border-line pt-6 text-[15px] text-fg-3"
              >
                {page > 1 ? <TextLink href={href(engine, page - 1)}>Newer</TextLink> : <span />}
                <span>
                  Page <span className="font-mono tabular">{page}</span> of{' '}
                  <span className="font-mono tabular">{pages}</span>
                </span>
                {page < pages ? <TextLink href={href(engine, page + 1)}>Older</TextLink> : <span />}
              </nav>
            )}
          </FullBleed>
        )}
      </Section>

      {/* 4 · Take them elsewhere, then where to go next. */}
      <Section id="download" labelledBy="download-title" tone="band">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <SectionHeading
            id="download-title"
            space="none"
            title="Download"
            intro={
              engine
                ? `The ${SHORT_NAME[engine]} games, to replay or analyse elsewhere.`
                : 'All the games, to replay or analyse elsewhere.'
            }
          />
          <ul className="divide-y divide-line border-y border-line">
            {formats.map((f) => (
              <li key={f}>
                <a href={download(f)} className="group flex items-start gap-4 py-6">
                  <Download className="mt-1 size-4 shrink-0 text-fg-3" aria-hidden="true" />
                  <span>
                    <span className="block text-[15px] text-fg underline-offset-4 group-hover:underline">
                      {FORMAT_LABEL[f]}
                    </span>
                    <span className="mt-1 block text-[13px] leading-5 text-fg-3 text-pretty">
                      {FORMAT_NOTE[f]}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <NextSteps
          className="mt-24"
          variant="list"
          title="Further reading"
          links={['engines', 'versions', 'progress', 'howItWorks']}
        />
      </Section>
    </main>
  );
};

const Games = (props: GamesPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <GamesContent {...props} />
  </Suspense>
);

export default Games;

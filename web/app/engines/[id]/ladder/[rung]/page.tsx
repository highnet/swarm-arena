import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { GameId, Rung } from '@arena/shared';
import { Facts } from '@/components/arena/Detail';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { matchHref, rungHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { SERIES, SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'matches', label: 'Matches' },
  { id: 'ladder', label: 'The ladder' },
  { id: 'more', label: 'Further reading' },
];

type RungPageProps = {
  params: Promise<{ id: string; rung: string }>;
};

const find = async ({ params }: RungPageProps) => {
  const { id, rung } = await params;
  const s = await getSnapshot();
  const rungs = s.rungs.filter((r) => r.track_id === id).sort((a, b) => a.position - b.position);
  const at = rungs.findIndex((r) => String(r.position) === rung);
  if (at < 0) return null;
  return { s, rungs, at, rung: rungs[at] };
};

/** Matches the referee played against this rung's opponent. */
const playedAgainst = (r: Rung, m: { track_id: GameId; opponent: string }) =>
  m.track_id === r.track_id && (m.opponent === r.label || m.opponent === r.opponent);

export const generateMetadata = async (props: RungPageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Ladder rung' };
  const { rung } = found;
  return pageMeta(
    `${SHORT_NAME[rung.track_id]} ladder: ${rung.label}`,
    `The ${rung.label} rung (${formatElo(rung.elo)}) on the ${SHORT_NAME[rung.track_id]} ladder, and every match against it.`,
    rungHref(rung),
  );
};

const RungContent = async (props: RungPageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, rungs, at, rung } = found;
  const track = s.tracks.find((t) => t.id === rung.track_id);
  const slot = track?.color_slot ?? 1;
  const name = SHORT_NAME[rung.track_id];
  const matches = s.matches
    .filter((m) => playedAgainst(rung, m))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const games = matches.reduce((n, m) => n + m.wins + m.draws + m.losses, 0);

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />
      {/* 1 · The rung: who this opponent is, and whether the engine has beaten it. */}
      <Section id="overview" labelledBy="rung-title" space="roomy">
        <SectionHeading
          level="page"
          id="rung-title"
          title={rung.label}
          intro={
            <>
              Rung {at + 1} of {rungs.length} on the{' '}
              <Link
                href={`/engines/${rung.track_id}`}
                className="text-fg underline-offset-4 hover:underline"
              >
                {name} ladder
              </Link>
              .{' '}
              {rung.cleared_at
                ? `The engine beat it on ${formatDay(rung.cleared_at)}, in a gate match.`
                : 'The engine has not beaten it yet.'}
            </>
          }
        />
        <Facts
          variant="open"
          items={[
            { label: 'Rating', value: formatElo(rung.elo), note: rung.opponent },
            {
              label: 'Status',
              value: rung.cleared_at ? (
                <span className="text-good-text">beaten</span>
              ) : (
                <span className="text-fg-3">ahead</span>
              ),
              note: rung.cleared_at ? `the gate match, ${formatDay(rung.cleared_at)}` : undefined,
              href: rung.cleared_by_match ? matchHref(rung.cleared_by_match) : undefined,
            },
            { label: 'Matches', value: matches.length, note: 'against this opponent' },
            { label: 'Games', value: games, note: 'in those matches' },
          ]}
        />
      </Section>

      {/* 2 · The evidence: every match against this opponent. */}
      <Section id="matches" labelledBy="matches-title" tone="band">
        <SectionHeading
          id="matches-title"
          title="Matches against it"
          intro="Every match the referee played against this opponent, newest first. Each opens its games."
        />
        {matches.length === 0 ? (
          <Typography variant="intro">No match against this opponent yet.</Typography>
        ) : (
          <ol className="divide-y divide-line border-y border-line">
            {matches.map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 py-5 sm:grid-cols-[8rem_1fr_auto_10rem]"
              >
                <Link
                  href={matchHref(m.id)}
                  className="font-mono text-[15px] text-fg underline-offset-4 hover:underline"
                >
                  {m.engine_version}
                </Link>
                <span className="order-3 col-span-2 text-[13px] text-fg-3 sm:order-none sm:col-span-1">
                  {m.purpose} match
                </span>
                <span className="text-right font-mono text-[15px] tabular text-fg">
                  {m.wins}–{m.losses}–{m.draws}
                </span>
                <span className="order-4 col-span-2 font-mono text-[13px] tabular text-fg-3 sm:order-none sm:col-span-1 sm:text-right">
                  {m.finished_at
                    ? `${formatDay(m.finished_at)} ${formatTime(m.finished_at)}`
                    : 'running'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* 3 · Where this rung sits: the whole ladder, this rung marked. */}
      <Section id="ladder" labelledBy="ladder-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <SectionHeading
            id="ladder-title"
            space="none"
            title="The whole ladder"
            intro={`The ${name} engine's reference opponents, strongest at the top. This rung is marked.`}
            action={<TextLink href={`/engines/${rung.track_id}`}>The {name} engine</TextLink>}
          />
          <nav aria-labelledby="ladder-title">
            <ol className="divide-y divide-line border-y border-line">
              {[...rungs].reverse().map((r) => {
                const here = r.id === rung.id;
                return (
                  <li
                    key={r.id}
                    className="grid grid-cols-[1rem_4rem_1fr_auto] items-baseline gap-x-3 py-4"
                  >
                    <span
                      className={cn(
                        'size-2 self-center rounded-full',
                        here ? SERIES[slot].bg : 'bg-transparent',
                      )}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-[13px] tabular text-fg-3">
                      {formatElo(r.elo)}
                    </span>
                    {here ? (
                      <span aria-current="page" className="text-[15px] font-medium text-fg">
                        {r.label}
                      </span>
                    ) : (
                      <Link
                        href={rungHref(r)}
                        className="text-[15px] text-fg-2 underline-offset-4 hover:text-fg hover:underline"
                      >
                        {r.label}
                      </Link>
                    )}
                    <span
                      className={cn('text-[13px]', r.cleared_at ? 'text-good-text' : 'text-fg-3')}
                    >
                      {r.cleared_at ? 'beaten' : 'ahead'}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </Section>

      {/* 4 · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" tone="band" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={[...engineSteps(rung.track_id), 'versions']}
        />
      </Section>
    </main>
  );
};

const RungPage = (props: RungPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <RungContent {...props} />
  </Suspense>
);

export default RungPage;

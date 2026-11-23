import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowDown, ArrowUp, Swords } from 'lucide-react';
import type { GameId, Rung } from '@arena/shared';
import { DetailShell, Facts } from '@/components/arena/Detail';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { EngineChip } from '@/components/arena/SidePanels';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { matchHref, rungHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { SHORT_NAME } from '@/lib/tracks';

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
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const matches = s.matches
    .filter((m) => playedAgainst(rung, m))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const below = at > 0 ? rungs[at - 1] : null;
  const above = at < rungs.length - 1 ? rungs[at + 1] : null;

  return (
    <DetailShell
      back={{ href: `/engines/${rung.track_id}`, label: `${SHORT_NAME[rung.track_id]} engine` }}
      eyebrow={
        <>
          <EngineChip track={rung.track_id} slots={slots} />
          <span>
            Rung {at + 1} of {rungs.length}
          </span>
        </>
      }
      title={rung.label}
    >
      <Facts
        items={[
          { label: 'Rating', value: formatElo(rung.elo), note: rung.opponent },
          {
            label: 'Status',
            value: rung.cleared_at ? (
              <span className="text-good-text">beaten</span>
            ) : (
              <span className="text-fg-3">ahead</span>
            ),
            note: rung.cleared_at ? formatDay(rung.cleared_at) : undefined,
            href: rung.cleared_by_match ? matchHref(rung.cleared_by_match) : undefined,
          },
          { label: 'Matches', value: matches.length, note: 'against this opponent' },
          {
            label: 'Games',
            value: matches.reduce((n, m) => n + m.wins + m.draws + m.losses, 0),
          },
        ]}
      />

      <nav
        aria-label="Neighbouring rungs"
        className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2"
      >
        {below ? (
          <Link
            href={rungHref(below)}
            className="bg-panel px-4 py-3 text-xs text-fg-2 hover:bg-panel-raised"
          >
            <span className="inline-flex items-center gap-1">
              <ArrowDown className="size-3" aria-hidden="true" />
              Below · {below.label} ({formatElo(below.elo)})
            </span>
          </Link>
        ) : (
          <div className="bg-panel px-4 py-3 text-xs text-fg-3">The bottom rung</div>
        )}
        {above ? (
          <Link
            href={rungHref(above)}
            className="bg-panel px-4 py-3 text-xs text-fg-2 hover:bg-panel-raised sm:text-right"
          >
            <span className="inline-flex items-center gap-1">
              Above · {above.label} ({formatElo(above.elo)})
              <ArrowUp className="size-3" aria-hidden="true" />
            </span>
          </Link>
        ) : (
          <div className="bg-panel px-4 py-3 text-xs text-fg-3 sm:text-right">The top rung</div>
        )}
      </nav>

      <Panel icon={Swords} title="Matches against this rung">
        {matches.length === 0 ? (
          <Typography variant="small" className="px-4 py-6">
            No match against this opponent yet.
          </Typography>
        ) : (
          <ol className="divide-y divide-line">
            {matches.map((m) => (
              <li
                key={m.id}
                className="relative flex items-center gap-3 px-4 py-2.5 hover:bg-panel-raised"
              >
                <Link
                  href={matchHref(m.id)}
                  className="font-mono text-[13px] text-fg after:absolute after:inset-0 after:content-['']"
                >
                  {m.engine_version}
                </Link>
                <span className="text-xs text-fg-3">{m.purpose}</span>
                <span className="ml-auto font-mono text-[13px] tabular text-fg">
                  {m.wins}–{m.losses}–{m.draws}
                </span>
                <span className="w-28 text-right font-mono text-xs tabular text-fg-3">
                  {m.finished_at
                    ? `${formatDay(m.finished_at)} ${formatTime(m.finished_at)}`
                    : 'running'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </DetailShell>
  );
};

const RungPage = (props: RungPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-5xl px-4 pt-6 sm:px-6" />}>
    <RungContent {...props} />
  </Suspense>
);

export default RungPage;

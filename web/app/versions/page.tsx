import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { agentName, type BoardRecord, type GameId, type Match } from '@arena/shared';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { agentHref } from '@/components/arena/seats';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { newestFirst } from '@/lib/derive';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { matchHref, versionHref, versionOf } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';

export const metadata: Metadata = pageMeta(
  'Versions shipped',
  'Every engine version that passed its gate match and shipped, with its rating and the idea behind it.',
  '/versions',
);

type VersionRowsProps = {
  records: BoardRecord[];
  matches: Map<string, Match>;
};

/** Shipped versions as hairline rows: version and title on the left, the gate match on the right. */
const VersionRows = ({ records, matches }: VersionRowsProps) => (
  <ol className="divide-y divide-line border-y border-line">
    {records.map((r) => {
      const m = r.match_id ? matches.get(r.match_id) : undefined;
      return (
        <li
          key={r.id}
          className="grid gap-x-10 gap-y-3 py-7 sm:grid-cols-[6rem_minmax(0,1fr)_auto]"
        >
          <span className="font-mono text-lg tabular text-fg">{versionOf(r)}</span>
          <div className="min-w-0">
            {r.track_id ? (
              <Link
                href={versionHref(r.track_id, versionOf(r))}
                className="text-[15px] font-medium text-fg text-pretty underline-offset-4 hover:underline"
              >
                {r.title.replace(/^\S+ shipped: /, '')}
              </Link>
            ) : (
              <span className="text-[15px] font-medium text-fg">{r.title}</span>
            )}
            {r.detail && (
              <p className="mt-1.5 line-clamp-2 max-w-2xl text-[13px] leading-5 text-fg-2 text-pretty">
                {r.detail}
              </p>
            )}
            <p className="mt-2 text-[13px] text-fg-3">
              <time dateTime={r.at}>
                {formatDay(r.at)}, {formatTime(r.at)} UTC
              </time>
              {r.agent_id && (
                <>
                  {' · '}
                  <Link
                    href={agentHref(r.agent_id)}
                    className="underline-offset-4 hover:text-fg hover:underline"
                  >
                    by {agentName(r.agent_id)}
                  </Link>
                </>
              )}
            </p>
          </div>
          {m && (
            <Link href={matchHref(m.id)} className="group text-[13px] text-fg-3 sm:text-right">
              <span className="block font-mono text-[15px] tabular text-fg group-hover:underline">
                {formatElo(m.elo)} ± {Math.round(m.elo_error)}
              </span>
              <span className="font-mono tabular">
                {m.wins}–{m.draws}–{m.losses}
              </span>{' '}
              vs {m.opponent}
            </Link>
          )}
        </li>
      );
    })}
  </ol>
);

const VersionsContent = async () => {
  const s = await getSnapshot();
  const matches = new Map(s.matches.map((m) => [m.id, m]));
  const landed = newestFirst(s.records).filter((r) => r.kind === 'patch_landed');
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const byTrack = TRACK_ORDER.map((id) => ({
    id,
    records: landed.filter((r) => r.track_id === id),
  }));
  const other = landed.filter((r) => !r.track_id || !TRACK_ORDER.includes(r.track_id));
  const chapters: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    ...byTrack.map((t) => ({ id: t.id, label: SHORT_NAME[t.id] })),
    ...(other.length ? [{ id: 'other', label: 'Other' }] : []),
    { id: 'more', label: 'Further reading' },
  ];

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={chapters} />

      {/* 1 · What a shipped version is. */}
      <Section id="overview" labelledBy="versions-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="versions-title"
          title="Versions shipped"
          intro={
            <>
              A version ships only when it beats its gate opponent and the version before it.{' '}
              <span className="font-mono tabular text-fg">{landed.length}</span> have, across the
              four engines; the ideas that did not are buried with their numbers.
            </>
          }
          action={
            <>
              <TextLink href="/how-it-works#loop">How a version ships</TextLink>
              <TextLink href="/graveyard">Ideas buried</TextLink>
            </>
          }
        />
      </Section>

      {/* 2–5 · One chapter per engine, newest version first. Bands alternate from here. */}
      {byTrack.map((t, i) => (
        <Section
          key={t.id}
          id={t.id}
          labelledBy={`${t.id}-title`}
          tone={i % 2 === 0 ? 'band' : 'plain'}
        >
          <SectionHeading
            id={`${t.id}-title`}
            title={
              <span className="inline-flex items-center gap-4">
                <EngineLogo game={t.id} slot={slots[t.id] ?? 1} />
                {SHORT_NAME[t.id]}
              </span>
            }
            intro={
              t.records.length
                ? `${t.records.length} versions, newest first. Each opens its gate match, the work behind it and the ideas that failed to beat it.`
                : 'Nothing has shipped yet.'
            }
            action={<TextLink href={`/engines/${t.id}`}>The {SHORT_NAME[t.id]} engine</TextLink>}
          />
          {t.records.length > 0 && <VersionRows records={t.records} matches={matches} />}
        </Section>
      ))}

      {other.length > 0 && (
        <Section
          id="other"
          labelledBy="other-title"
          tone={byTrack.length % 2 === 0 ? 'band' : 'plain'}
        >
          <SectionHeading id="other-title" title="Other" />
          <VersionRows records={other} matches={matches} />
        </Section>
      )}

      {/* Last · Where to go next. */}
      <Section
        id="more"
        labelledBy="next-steps-title"
        tone={(byTrack.length + (other.length ? 1 : 0)) % 2 === 0 ? 'band' : 'plain'}
        space="compact"
      >
        <NextSteps
          variant="list"
          title="Further reading"
          links={['graveyard', 'games', 'engines', 'board']}
        />
      </Section>
    </main>
  );
};

const Versions = () => (
  <Suspense fallback={<PageSkeleton />}>
    <VersionsContent />
  </Suspense>
);

export default Versions;

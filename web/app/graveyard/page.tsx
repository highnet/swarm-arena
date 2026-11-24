import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { BoardRecord, GameId } from '@arena/shared';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { newestFirst } from '@/lib/derive';
import { formatDay, formatInt, formatTime } from '@/lib/format';
import { ideaHref, matchHref, taskHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { SERIES, SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Ideas buried',
  'Every engine idea the swarm tried and dropped, and why: lost the gate match, or could not land.',
  '/graveyard',
);

/** One chapter per engine, plus one for burials no engine owns (protocol, harness). */
type Group = { id: string; name: string; slot?: number; records: BoardRecord[] };

const plural = (n: number) => `${formatInt(n)} ${n === 1 ? 'idea' : 'ideas'}`;

type BurialsProps = {
  records: BoardRecord[];
};

/** The ideas of one chapter, newest first, as hairline rows. */
const Burials = ({ records }: BurialsProps) => (
  <ol className="divide-y divide-line border-y border-line">
    {records.map((r) => (
      <li key={r.id} className="py-7">
        <Link
          href={ideaHref(r.id)}
          className="text-lg font-medium text-fg-2 text-pretty line-through decoration-fg-3/60 underline-offset-4 hover:text-fg"
        >
          {r.title}
        </Link>
        {r.detail && (
          <p className="mt-2 max-w-2xl text-[15px] leading-7 text-fg-2 text-pretty">{r.detail}</p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-3">
          <time dateTime={r.at}>
            {formatDay(r.at)}, {formatTime(r.at)} UTC
          </time>
          {r.task_id && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={taskHref(r.task_id)}
                className="underline-offset-4 hover:text-fg hover:underline"
              >
                The task
              </Link>
            </>
          )}
          {r.match_id && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={matchHref(r.match_id)}
                className="underline-offset-4 hover:text-fg hover:underline"
              >
                The match it lost
              </Link>
            </>
          )}
        </p>
      </li>
    ))}
  </ol>
);

const GraveyardContent = async () => {
  const s = await getSnapshot();
  const dead = newestFirst(s.records).filter((r) => r.kind === 'idea_dead');
  const groups: Group[] = TRACK_ORDER.map((id) => ({
    id,
    name: s.tracks.find((t) => t.id === id)?.name ?? SHORT_NAME[id],
    slot: s.tracks.find((t) => t.id === id)?.color_slot,
    records: dead.filter((r) => r.track_id === id),
  }));
  const other = dead.filter((r) => !r.track_id || !TRACK_ORDER.includes(r.track_id as GameId));
  if (other.length > 0) groups.push({ id: 'other', name: 'Beyond the engines', records: other });
  const chapters: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    ...groups.map((g) => ({
      id: g.id,
      label: g.slot !== undefined ? SHORT_NAME[g.id as GameId] : g.name,
    })),
  ];
  const counted = groups.filter((g) => g.records.length > 0);

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={chapters} />

      {/* 1 · What the graveyard is, and how full it is. */}
      <Section id="overview" labelledBy="graveyard-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="graveyard-title"
          title="Ideas buried"
          intro="Ideas the swarm tried and dropped: each lost its games or could not land. They stay on the record, and in each engine's playbook, so nobody tries them blind again."
          action={
            <>
              <TextLink href="/skills">The playbooks</TextLink>
              <TextLink href="/versions">The ideas that won</TextLink>
            </>
          }
        />
        <p className="mt-16 max-w-2xl text-xl leading-8 text-fg-2 text-pretty">
          {dead.length === 0 ? (
            'Nothing is buried yet.'
          ) : (
            <>
              <span className="font-mono tabular text-fg">{formatInt(dead.length)}</span>{' '}
              {dead.length === 1 ? 'idea' : 'ideas'} buried so far
              {counted.length > 0 && ': '}
              {counted.map((g, i) => (
                <span key={g.id}>
                  {i > 0 && (i === counted.length - 1 ? ' and ' : ', ')}
                  <a
                    href={`#${g.id}`}
                    className="underline decoration-line-strong underline-offset-4 hover:text-fg hover:decoration-fg"
                  >
                    <span className="font-mono tabular">{formatInt(g.records.length)}</span>{' '}
                    {g.slot !== undefined
                      ? `in ${SHORT_NAME[g.id as GameId]}`
                      : 'beyond the engines'}
                  </a>
                </span>
              ))}
              .
            </>
          )}
        </p>
      </Section>

      {/* 2… · One chapter per engine, newest burial first. The last carries further reading. */}
      {groups.map((g, i) => (
        <Section
          key={g.id}
          id={g.id}
          labelledBy={`${g.id}-title`}
          tone={i % 2 === 0 ? 'band' : 'plain'}
        >
          <SectionHeading
            id={`${g.id}-title`}
            title={
              <span className="inline-flex items-center gap-4">
                {g.slot !== undefined && (
                  <span
                    className={cn('size-3 shrink-0 rounded-full', SERIES[g.slot].bg)}
                    aria-hidden="true"
                  />
                )}
                {g.name}
              </span>
            }
            intro={
              g.records.length === 0
                ? 'Nothing buried yet: every idea tried on this engine so far either shipped or is still in play.'
                : `${plural(g.records.length)} buried, newest first. Each opens with its numbers and the version it failed to beat.`
            }
            action={
              g.slot !== undefined && (
                <TextLink href={`/engines/${g.id}`}>{SHORT_NAME[g.id as GameId]} engine</TextLink>
              )
            }
            space={g.records.length === 0 ? 'none' : 'default'}
          />
          {g.records.length > 0 && <Burials records={g.records} />}
          {i === groups.length - 1 && (
            <NextSteps
              className="mt-24"
              variant="list"
              title="Further reading"
              links={['versions', 'concepts', 'board', 'engines']}
            />
          )}
        </Section>
      ))}
    </main>
  );
};

const Graveyard = () => (
  <Suspense fallback={<PageSkeleton />}>
    <GraveyardContent />
  </Suspense>
);

export default Graveyard;

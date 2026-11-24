import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CircleSlash } from 'lucide-react';
import { agentName, type GameId } from '@arena/shared';
import { MatchFacts, RecordList } from '@/components/arena/Detail';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { agentHref } from '@/components/arena/seats';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { lineage } from '@/lib/derive';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { ideaHref, matchHref, taskHref, versionHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { SERIES, SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type IdeaPageProps = {
  params: Promise<{ id: string }>;
};

const find = async ({ params }: IdeaPageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const record = s.records.find((r) => r.kind === 'idea_dead' && String(r.id) === id);
  return record ? { s, record } : null;
};

export const generateMetadata = async (props: IdeaPageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Buried idea' };
  const { record } = found;
  return pageMeta(
    record.title,
    record.detail ?? 'An idea the swarm tried and dropped.',
    ideaHref(record.id),
  );
};

const IdeaContent = async (props: IdeaPageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, record } = found;
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const track = record.track_id ? s.tracks.find((t) => t.id === record.track_id) : undefined;
  const timeline = record.task_id
    ? s.records
        .filter((r) => r.task_id === record.task_id)
        .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
    : [record];
  const matchId = [...timeline].reverse().find((r) => r.match_id)?.match_id;
  const match = matchId ? s.matches.find((m) => m.id === matchId) : undefined;
  const task = record.task_id ? s.tasks.find((t) => t.id === record.task_id) : undefined;
  const champion = record.track_id
    ? [...lineage(s, record.track_id).nodes].reverse().find((n) => n.at <= record.at)
    : undefined;
  const sameConcept = task?.concept
    ? s.tasks.filter((t) => t.concept === task.concept && t.id !== task.id)
    : [];

  // Sections appear only when there is something to show; tones alternate down whatever is left.
  const chapters: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    ...(match ? [{ id: 'games', label: 'The games it lost' }] : []),
    { id: 'record', label: 'What happened' },
    { id: 'against', label: 'What it was up against' },
  ];
  const tone = (id: string) =>
    chapters.findIndex((c) => c.id === id) % 2 === 0 ? ('plain' as const) : ('band' as const);

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={chapters} />

      {/* 1 · The idea, in its own words, and the verdict. */}
      <Section id="overview" labelledBy="idea-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="idea-title"
          title={<span className="line-through decoration-fg-3/60">{record.title}</span>}
          intro={record.detail}
        />
        <p className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-fg-3">
          <span className="inline-flex items-center gap-1.5 text-critical-text">
            <CircleSlash className="size-4" aria-hidden="true" />
            Buried
          </span>
          {track && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={`/engines/${track.id}`}
                className="inline-flex items-center gap-2 text-fg-2 underline-offset-4 hover:text-fg hover:underline"
              >
                <span
                  className={cn('size-2 rounded-full', SERIES[track.color_slot].bg)}
                  aria-hidden="true"
                />
                {track.name}
              </Link>
            </>
          )}
          <span aria-hidden="true">·</span>
          <time dateTime={record.at}>
            {formatDay(record.at)}, {formatTime(record.at)} UTC
          </time>
          {record.agent_id && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={agentHref(record.agent_id)}
                className="underline-offset-4 hover:text-fg hover:underline"
              >
                by {agentName(record.agent_id)}
              </Link>
            </>
          )}
        </p>
      </Section>

      {/* 2 · The evidence: the match that buried it. */}
      {match && (
        <Section id="games" labelledBy="games-title" tone={tone('games')}>
          <SectionHeading
            id="games-title"
            title="The games it lost"
            intro={`The referee's match against ${match.opponent}, rated ${formatElo(match.opponent_elo)}. Each number opens the match and its games.`}
            action={<TextLink href={matchHref(match.id)}>Replay the games</TextLink>}
          />
          <MatchFacts match={match} variant="open" />
        </Section>
      )}

      {/* 3 · How it went: the task's record, claim to burial. */}
      <Section id="record" labelledBy="record-title" tone={tone('record')}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <SectionHeading
            id="record-title"
            space="none"
            title="What happened"
            intro="The task's record on the board, oldest first. The burial is marked."
            action={task && <TextLink href={taskHref(task.id)}>The task</TextLink>}
          />
          <div className="-mx-4 min-w-0 border-y border-line">
            <RecordList records={timeline} slots={slots} current={record.id} />
          </div>
        </div>
      </Section>

      {/* 4 · The context: the version it failed to beat, its siblings, and where to go next. */}
      <Section id="against" labelledBy="against-title" tone={tone('against')}>
        <SectionHeading
          id="against-title"
          title="What it was up against"
          intro="The version that was current when it was buried: the one it had to beat to ship."
          space="tight"
        />
        {champion && record.track_id ? (
          <Link
            href={versionHref(record.track_id, champion.version)}
            className="group block max-w-3xl border-y border-line py-8"
          >
            <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-mono text-2xl font-medium tabular tracking-tight text-fg sm:text-3xl">
                {champion.version}
              </span>
              {champion.elo != null && (
                <span className="font-mono text-[15px] tabular text-fg-2">
                  {formatElo(champion.elo)}
                  {champion.eloError ? ` ± ${Math.round(champion.eloError)}` : ''}
                </span>
              )}
            </span>
            <span className="mt-3 block text-[15px] leading-7 text-fg-2 text-pretty underline-offset-4 group-hover:text-fg group-hover:underline">
              {champion.title}
            </span>
          </Link>
        ) : (
          <Typography variant="intro">Buried before the first version shipped.</Typography>
        )}

        {sameConcept.length > 0 && (
          <div className="mt-20">
            <SectionHeading
              id="concept-title"
              level="sub"
              space="tight"
              title={`Same concept: ${task!.concept}`}
              intro="Other tasks that tried this idea, on this engine or another."
            />
            <ol className="divide-y divide-line border-y border-line">
              {sameConcept.map((t) => (
                <li key={t.id} className="py-5">
                  <Link
                    href={taskHref(t.id)}
                    className="text-[15px] text-fg underline-offset-4 hover:underline"
                  >
                    {t.title}
                  </Link>
                  <Typography variant="meta" as="p" className="mt-1 text-[13px]">
                    {SHORT_NAME[t.track_id as GameId] ?? t.track_id} · {t.status}
                  </Typography>
                </li>
              ))}
            </ol>
          </div>
        )}

        <NextSteps
          className="mt-20"
          variant="list"
          title="Further reading"
          links={
            record.track_id
              ? [...engineSteps(record.track_id), 'graveyard']
              : ['graveyard', 'concepts', 'versions', 'board']
          }
        />
      </Section>
    </main>
  );
};

const IdeaPage = (props: IdeaPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <IdeaContent {...props} />
  </Suspense>
);

export default IdeaPage;

import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { agentName, type BoardRecord, type GameId } from '@arena/shared';
import { MatchFacts, RecordList } from '@/components/arena/Detail';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { KINDS, TONE_CLASS } from '@/components/arena/recordKinds';
import { EngineChip } from '@/components/arena/SidePanels';
import { agentHref } from '@/components/arena/seats';
import { Disclosure } from '@/components/ui/Disclosure';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot, getTaskRecords } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { matchHref, recordHref, taskHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

type RecordPageProps = {
  params: Promise<{ id: string }>;
};

/** Records shown on either side of this one before the rest folds away. */
const AROUND = 4;

const find = async ({ params }: RecordPageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const record = s.records.find((r) => String(r.id) === id);
  return record ? { s, record } : null;
};

export const generateMetadata = async (props: RecordPageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Record' };
  const { record } = found;
  return pageMeta(
    record.title,
    record.detail ?? `${KINDS[record.kind].label} on the board.`,
    `/board/${record.id}`,
  );
};

type NeighbourProps = {
  record: BoardRecord | null;
  side: 'before' | 'after';
};

/** The record just before or after this one, as a quiet link under a hairline. */
const Neighbour = ({ record: r, side }: NeighbourProps) => {
  const after = side === 'after';
  const Arrow = after ? ArrowRight : ArrowLeft;
  if (!r)
    return (
      <p
        className={cn('border-t border-line pt-6 text-[15px] text-fg-3', after && 'sm:text-right')}
      >
        {after ? 'This is the latest record.' : 'This is the first record.'}
      </p>
    );
  return (
    <Link
      href={recordHref(r)}
      className={cn('group block border-t border-line pt-6', after && 'sm:text-right')}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[13px] text-fg-3',
          after && 'flex-row-reverse',
        )}
      >
        <Arrow className="size-4" aria-hidden="true" />
        {after ? 'After' : 'Before'} · {KINDS[r.kind].label}
      </span>
      <span className="mt-2 block text-[17px] font-medium leading-7 text-fg text-pretty underline-offset-4 group-hover:underline">
        {r.title}
      </span>
    </Link>
  );
};

const RecordContent = async (props: RecordPageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, record } = found;
  // Shipped versions and buried ideas live on their own pages.
  const own = recordHref(record);
  if (own !== `/board/${record.id}`) permanentRedirect(own);

  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const meta = KINDS[record.kind];
  const KindIcon = meta.icon;
  const ordered = [...s.records].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const at = ordered.findIndex((r) => r.id === record.id);
  const prev = at > 0 ? ordered[at - 1] : null;
  const next = at < ordered.length - 1 ? ordered[at + 1] : null;
  const match = record.match_id ? s.matches.find((m) => m.id === record.match_id) : undefined;
  // A task's records come from their own complete query: the snapshot's list stops at 1,000 rows.
  const taskRecords = record.task_id ? await getTaskRecords(record.task_id) : [];
  const complete = taskRecords.some((r) => r.id === record.id);
  const related = record.task_id
    ? complete
      ? taskRecords
      : ordered.filter((r) => r.task_id === record.task_id)
    : ordered.filter((r) => r.kind === record.kind && r.track_id === record.track_id).slice(-12);
  // A long task keeps the records around this one in view; the whole run folds away below.
  const here = related.findIndex((r) => r.id === record.id);
  const windowed =
    related.length > AROUND * 2 + 3 && here >= 0
      ? related.slice(Math.max(0, here - AROUND), here + AROUND + 1)
      : related;
  const relatedTitle = record.task_id
    ? 'The same task on the record'
    : `Other ${meta.label.toLowerCase()} records`;

  const chapters: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    ...(match ? [{ id: 'match', label: 'The match' }] : []),
    { id: 'related', label: record.task_id ? 'The task' : 'Related' },
    { id: 'around', label: 'Before and after' },
  ];
  const tone = (i: number) => (i % 2 === 0 ? 'plain' : 'band');

  return (
    <main className="flex w-full flex-col">
      {chapters.length >= 4 && <SectionNav items={chapters} />}

      {/* 1 · What happened, and who recorded it. */}
      <Section id="overview" labelledBy="record-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="record-title"
          title={record.title}
          intro={record.detail}
        />
        <p className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-fg-3">
          <span className={cn('inline-flex items-center gap-1.5', TONE_CLASS[meta.tone])}>
            <KindIcon className="size-4" aria-hidden="true" />
            {meta.label}
          </span>
          {record.track_id && <EngineChip track={record.track_id} slots={slots} />}
          <time dateTime={record.at} className="font-mono tabular">
            {formatDay(record.at)}, {formatTime(record.at)} UTC
          </time>
          {record.agent_id && (
            <Link
              href={agentHref(record.agent_id)}
              className="underline-offset-4 hover:text-fg hover:underline"
            >
              by {agentName(record.agent_id)}
            </Link>
          )}
          {record.task_id && <TextLink href={taskHref(record.task_id)}>The task</TextLink>}
        </p>
      </Section>

      {/* 2 · The games behind it, when a match backs the record. */}
      {match && (
        <Section id="match" labelledBy="match-title" tone="band">
          <SectionHeading
            id="match-title"
            title="The match behind it"
            intro={`${match.wins + match.draws + match.losses} games against ${match.opponent}. Each number opens the match, its games and their replays.`}
            action={<TextLink href={matchHref(match.id)}>The match</TextLink>}
          />
          <MatchFacts match={match} variant="open" />
        </Section>
      )}

      {/* 3 · The rest of the story: the task's own timeline, or records like this one. */}
      <Section id="related" labelledBy="related-title" tone={tone(match ? 2 : 1)}>
        <SectionHeading
          id="related-title"
          title={relatedTitle}
          intro={
            record.task_id
              ? `${related.length} records from opening to verdict, oldest first. This one is marked.`
              : `The last ${related.length} of this kind${record.track_id ? ' on this engine' : ''}, oldest first.`
          }
        />
        <div className="max-w-3xl border-y border-line">
          <RecordList records={windowed} slots={slots} current={record.id} />
        </div>
        {windowed.length < related.length && (
          <Disclosure
            className="mt-10"
            summary={
              complete
                ? `The whole task: all ${related.length} records`
                : `The task: ${related.length} records`
            }
          >
            <div className="max-w-3xl border-y border-line">
              <RecordList records={related} slots={slots} current={record.id} />
            </div>
          </Disclosure>
        )}
      </Section>

      {/* Last · Its neighbours on the board, then where to go next. */}
      <Section id="around" labelledBy="around-title" tone={tone(match ? 3 : 2)}>
        <SectionHeading
          id="around-title"
          title="Before and after"
          intro="The records written just before and just after this one, whatever they were about."
          space="tight"
        />
        <nav aria-labelledby="around-title" className="grid gap-x-16 gap-y-10 sm:grid-cols-2">
          <Neighbour record={prev} side="before" />
          <Neighbour record={next} side="after" />
        </nav>
        <NextSteps
          variant="list"
          title="Further reading"
          className="mt-24"
          links={
            record.track_id
              ? [...engineSteps(record.track_id), 'board']
              : ['board', 'versions', 'graveyard', 'rallypoint']
          }
        />
      </Section>
    </main>
  );
};

const RecordPage = (props: RecordPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <RecordContent {...props} />
  </Suspense>
);

export default RecordPage;

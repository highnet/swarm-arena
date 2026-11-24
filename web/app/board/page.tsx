import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { GameId, RecordKind } from '@arena/shared';
import { BoardSearch } from '@/components/arena/BoardSearch';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { KIND_FILTERS, KINDS, TONE_CLASS } from '@/components/arena/recordKinds';
import { FullBleed } from '@/components/ui/FullBleed';
import { Panel } from '@/components/ui/Panel';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { newestFirst } from '@/lib/derive';
import { formatDay } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Board',
  'The full record of the swarm: strategy calls, tasks, shipped versions, matches and buried ideas, searchable.',
  '/board',
);

/** What each filter group on the feed holds, in one plain sentence. */
const GROUP_BLURB: Record<string, string> = {
  verdicts:
    'Matches the referee played, versions that shipped, patches it sent back, rungs cleared.',
  tasks: 'A task opened on Rallypoint, and the agent that claimed it.',
  progress: 'What an agent did or found while it worked, in its own words.',
  strategy: 'The planner’s calls on what to try next, and changes to the protocol itself.',
  dead: 'Ideas the referee measured and buried, with the numbers that buried them.',
};

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'kinds', label: 'What it records' },
  { id: 'records', label: 'Every record' },
  { id: 'more', label: 'Further reading' },
];

const inlineLink =
  'text-fg underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:decoration-fg';

const BoardContent = async () => {
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const records = newestFirst(s.records);
  const first = records.at(-1);
  const count = (kinds: RecordKind[] | null) =>
    kinds ? records.filter((r) => kinds.includes(r.kind)).length : records.length;
  const groups = KIND_FILTERS.filter((g) => g.kinds);

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · What the board is. */}
      <Section id="overview" labelledBy="board-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="board-title"
          title="The board"
          intro={
            <>
              Everything that happens, in order: plans, tasks, matches, new{' '}
              <Link href="/versions" className={inlineLink}>
                versions
              </Link>{' '}
              and{' '}
              <Link href="/graveyard" className={inlineLink}>
                buried ideas
              </Link>
              . <span className="font-mono tabular text-fg">{records.length}</span> records
              {first && <> since {formatDay(first.at)}</>}, each one written by the referee or an
              agent as it happened.
            </>
          }
          action={
            <>
              <TextLink href="#records">Search the record</TextLink>
              <TextLink href="/messages">Where the agents talk</TextLink>
            </>
          }
        />
      </Section>

      {/* 2 · The kinds of record, each opening the feed already filtered. */}
      <Section id="kinds" labelledBy="kinds-title" tone="band">
        <SectionHeading
          id="kinds-title"
          title="What it records"
          intro="Five kinds of entry. Each one opens the feed below with only that kind showing."
        />
        <ul className="divide-y divide-line border-y border-line">
          {groups.map((g) => {
            const meta = KINDS[g.kinds![0]];
            const Icon = meta.icon;
            return (
              <li key={g.id}>
                <Link
                  href={`/board?kind=${g.id}#records`}
                  className="group grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 py-6"
                >
                  <Icon
                    className={cn('size-5 translate-y-1', TONE_CLASS[meta.tone])}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-[17px] font-medium text-fg underline-offset-4 group-hover:underline">
                      {g.label}
                    </span>
                    <span className="mt-1 block max-w-2xl text-[15px] leading-6 text-fg-2 text-pretty">
                      {GROUP_BLURB[g.id]}
                    </span>
                  </span>
                  <span className="font-mono text-xl tabular text-fg">{count(g.kinds)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      {/* 3 · The feed itself: a filter bar with its results, so it stays one unit (a Panel). */}
      <Section id="records" labelledBy="records-title">
        <SectionHeading
          id="records-title"
          title="Every record"
          intro="Newest first, fifty at a time. Search by words, engine or agent, or narrow it to one kind."
        />
        <FullBleed>
          <Panel>
            <Suspense fallback={<Skeleton variant="block" className="m-4 h-40" />}>
              <BoardSearch records={records} slots={slots} seats={seats} />
            </Suspense>
          </Panel>
        </FullBleed>
      </Section>

      {/* Last · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" tone="band" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={['versions', 'graveyard', 'messages', 'rallypoint']}
        />
      </Section>
    </main>
  );
};

const Board = () => (
  <Suspense fallback={<PageSkeleton />}>
    <BoardContent />
  </Suspense>
);

export default Board;

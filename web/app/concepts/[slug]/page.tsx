import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GAMES, agentName, type GameId } from '@arena/shared';
import { Facts } from '@/components/arena/Detail';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { TASK_TYPE_META } from '@/components/arena/TaskChips';
import { FullBleed } from '@/components/ui/FullBleed';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { formatDay } from '@/lib/format';
import { conceptHref, conceptSlug, taskHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { getConcepts } from '@/lib/source';
import { TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type ConceptPageProps = {
  params: Promise<{ slug: string }>;
};

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'games', label: 'Across the games' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'more', label: 'Further reading' },
];

const STATUS_LABEL = {
  landed: 'shipped',
  review: 'in review',
  claimed: 'trying',
  open: 'queued',
  dead: 'buried',
} as const;

const STATUS_CLASS = {
  landed: 'text-good-text',
  review: 'text-fg-2',
  claimed: 'text-fg-2',
  open: 'text-fg-3',
  dead: 'text-critical-text',
} as const;

const find = async ({ params }: ConceptPageProps) => {
  const { slug } = await params;
  const [s, c] = await Promise.all([getSnapshot(), getConcepts()]);
  const names = [
    ...c.vocabulary.map((v) => v.name),
    ...s.tasks.map((t) => t.concept).filter((x): x is string => Boolean(x)),
  ];
  const name = names.find((n) => conceptSlug(n) === slug);
  if (!name) return null;
  return { s, c, name, idea: c.vocabulary.find((v) => v.name === name)?.idea ?? null };
};

export const generateMetadata = async (props: ConceptPageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Concept' };
  return pageMeta(
    found.name,
    found.idea ?? `How the concept ${found.name} fared across the four games.`,
    conceptHref(found.name),
  );
};

const ConceptContent = async (props: ConceptPageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, c, name, idea } = found;
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const tasks = s.tasks
    .filter((t) => t.concept === name)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const evidence = c.evidence.filter((e) => e.concept === name).reverse();
  const shippedIn = TRACK_ORDER.filter((g) =>
    tasks.some((t) => t.track_id === g && t.status === 'landed'),
  );
  const verdict =
    shippedIn.length >= 2
      ? `Shipped in ${shippedIn.length} games: this idea transferred.`
      : shippedIn.length === 1
        ? 'Shipped in one game so far.'
        : 'Not shipped in any game yet.';

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · The idea, and whether it carried across games. */}
      <Section id="overview" labelledBy="concept-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="concept-title"
          title={name}
          intro={
            <>
              {idea && <>{idea} </>}
              <span className="text-fg">{verdict}</span>
            </>
          }
          action={
            <>
              <TextLink href="/concepts">Every concept</TextLink>
              <TextLink href="/skills/concepts">The concepts skill</TextLink>
            </>
          }
        />
      </Section>

      {/* 2 · One fact per game: the best that happened to it there. */}
      <Section id="games" labelledBy="games-title" tone="band">
        <SectionHeading
          id="games-title"
          title="Across the four games"
          intro="The best that happened to this concept in each game. Each opens its task."
        />
        <FullBleed>
          <Facts
            variant="open"
            items={TRACK_ORDER.map((g) => {
              const mine = tasks.filter((t) => t.track_id === g);
              const best = mine.find((t) => t.status === 'landed') ?? mine[0];
              return {
                label: GAMES[g].name,
                value: best ? (
                  <span className={STATUS_CLASS[best.status]}>{STATUS_LABEL[best.status]}</span>
                ) : (
                  <span className="text-fg-3">untried</span>
                ),
                note: mine.length
                  ? `${mine.length} ${mine.length === 1 ? 'task' : 'tasks'}`
                  : undefined,
                href: best ? taskHref(best.id) : undefined,
              };
            })}
          />
        </FullBleed>
      </Section>

      {/* 3 · Every task that tried it, newest first. */}
      <Section id="tasks" labelledBy="tasks-title">
        <SectionHeading
          id="tasks-title"
          title="Tasks"
          intro={
            tasks.length
              ? `${tasks.length} ${tasks.length === 1 ? 'task has' : 'tasks have'} tried this concept, newest first.`
              : 'No task has tried this concept yet.'
          }
        />
        {tasks.length > 0 && (
          <ol className="divide-y divide-line border-y border-line">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-5 py-6 sm:grid-cols-[1.5rem_minmax(0,1fr)_8rem]"
              >
                <EngineLogo
                  game={t.track_id}
                  slot={slots[t.track_id] ?? 1}
                  size="sm"
                  className="mt-1 size-5 rounded"
                />
                <div className="min-w-0">
                  <Link
                    href={taskHref(t.id)}
                    className="text-base leading-7 text-fg text-pretty underline-offset-4 hover:underline"
                  >
                    {t.title}
                  </Link>
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-fg-3">
                    <span>{GAMES[t.track_id].name}</span>
                    <span>{TASK_TYPE_META[t.type]?.label ?? 'Experiment'}</span>
                    {t.claimed_by && <span>{agentName(t.claimed_by)}</span>}
                    <time dateTime={t.created_at}>{formatDay(t.created_at)}</time>
                  </p>
                </div>
                <span
                  className={cn(
                    'col-start-2 mt-2 font-mono text-[15px] sm:col-start-3 sm:mt-0 sm:text-right',
                    STATUS_CLASS[t.status],
                  )}
                >
                  {STATUS_LABEL[t.status]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* 4 · What the referee recorded. */}
      <Section id="evidence" labelledBy="evidence-title" tone="band">
        <SectionHeading
          id="evidence-title"
          title="Evidence"
          intro={
            evidence.length
              ? 'Every verdict the referee recorded for this concept, newest first.'
              : 'No verdict recorded for this concept yet.'
          }
          action={<TextLink href="/concepts#evidence">The whole evidence log</TextLink>}
        />
        {evidence.length > 0 && (
          <ol className="divide-y divide-line border-y border-line">
            {evidence.map((e, i) => (
              <li
                key={`${e.date}-${i}`}
                className="grid gap-x-8 gap-y-1 py-6 sm:grid-cols-[7rem_minmax(0,1fr)]"
              >
                <span className="font-mono text-[13px] tabular text-fg-3">{e.date}</span>
                <div className="min-w-0">
                  <p className="max-w-[40em] text-base leading-7 text-fg text-pretty">
                    <span className="text-fg-2">{e.game}:</span> {e.outcome}
                  </p>
                  <p className="mt-1 max-w-[40em] text-[13px] leading-5 text-fg-3 text-pretty">
                    {e.title}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* Last · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={['concepts', 'skills', 'engines', 'graveyard']}
        />
      </Section>
    </main>
  );
};

const ConceptPage = (props: ConceptPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <ConceptContent {...props} />
  </Suspense>
);

export default ConceptPage;

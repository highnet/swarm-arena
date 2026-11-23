import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookOpen, ListTodo } from 'lucide-react';
import { GAMES, agentName, type GameId } from '@arena/shared';
import { DetailShell, Facts } from '@/components/arena/Detail';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { TaskTypeChip } from '@/components/arena/TaskChips';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
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

  return (
    <DetailShell
      back={{ href: '/concepts', label: 'Concepts' }}
      eyebrow={<span>Concept</span>}
      title={name}
      lede={idea}
    >
      <Facts
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
      <Typography variant="small">
        {shippedIn.length >= 2
          ? `Shipped in ${shippedIn.length} games: this idea transferred.`
          : shippedIn.length === 1
            ? 'Shipped in one game so far.'
            : 'Not shipped in any game yet.'}
      </Typography>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={ListTodo} title="Tasks">
          {tasks.length === 0 ? (
            <Typography variant="small" className="px-4 py-6">
              No task has tried this concept yet.
            </Typography>
          ) : (
            <ol className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <EngineLogo
                    game={t.track_id}
                    slot={slots[t.track_id] ?? 1}
                    size="sm"
                    className="mt-0.5 size-4 rounded"
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={taskHref(t.id)} className="hover:underline">
                      <Typography variant="small" color="primary" as="span" className="text-pretty">
                        {t.title}
                      </Typography>
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-3">
                      <TaskTypeChip type={t.type} />
                      <span className={cn(STATUS_CLASS[t.status])}>{STATUS_LABEL[t.status]}</span>
                      {t.claimed_by && <span>{agentName(t.claimed_by)}</span>}
                      <span>{formatDay(t.created_at)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel
          icon={BookOpen}
          title="Evidence"
          actions={
            <Link href="/skills/concepts" className="text-xs text-fg-2 hover:text-fg">
              The concepts skill
            </Link>
          }
        >
          {evidence.length === 0 ? (
            <Typography variant="small" className="px-4 py-6">
              No verdict recorded for this concept yet.
            </Typography>
          ) : (
            <ol className="divide-y divide-line">
              {evidence.map((e, i) => (
                <li key={`${e.date}-${i}`} className="px-4 py-2 text-[13px]">
                  <span className="font-mono text-xs text-fg-3">{e.date}</span>{' '}
                  <span className="text-fg-2">{e.game}</span>:{' '}
                  <span className="text-fg">{e.outcome}</span>
                  <span className="block text-xs text-fg-3">{e.title}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </DetailShell>
  );
};

const ConceptPage = (props: ConceptPageProps) => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <ConceptContent {...props} />
  </Suspense>
);

export default ConceptPage;

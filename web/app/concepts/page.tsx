import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleSlash, FlaskConical, GitMerge, GitPullRequest } from 'lucide-react';
import { GAMES, type GameId, type Task } from '@arena/shared';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { Disclosure } from '@/components/ui/Disclosure';
import { FullBleed } from '@/components/ui/FullBleed';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { getConcepts, type ConceptEvidence } from '@/lib/source';
import { conceptHref, taskHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Concepts',
  'Four games, one question: which ideas make every engine better? The concept-by-game matrix of what the swarm tried, what shipped, and what transferred.',
  '/concepts',
);

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'matrix', label: 'Concept × game' },
  { id: 'beliefs', label: 'What we believe' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'more', label: 'Further reading' },
];

/** Evidence lines shown before the rest folds behind a disclosure. */
const FIRST_EVIDENCE = 8;

type Cell = { task: Task; delta: string | null };

/** The best thing that happened to a concept in one game: shipped beats in review beats tried beats buried. */
const rank = (t: Task) => ({ landed: 4, review: 3, claimed: 2, open: 1, dead: 0 })[t.status] ?? 0;

type CellViewProps = {
  cell: Cell | undefined;
};

const CellView = ({ cell }: CellViewProps) => {
  if (!cell)
    return (
      <span className="text-fg-3" aria-label="untried">
        ·
      </span>
    );
  const { task, delta } = cell;
  const look = {
    landed: { icon: GitMerge, cls: 'text-good-text', text: delta ?? 'shipped' },
    review: { icon: GitPullRequest, cls: 'text-fg-2', text: 'in review' },
    claimed: { icon: FlaskConical, cls: 'text-fg-2', text: 'trying' },
    open: { icon: FlaskConical, cls: 'text-fg-3', text: 'queued' },
    dead: { icon: CircleSlash, cls: 'text-critical-text', text: 'buried' },
  }[task.status];
  const Icon = look.icon;
  return (
    <Link
      href={taskHref(task.id)}
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[13px] tabular underline-offset-4 hover:underline',
        look.cls,
      )}
      title={task.title}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {look.text}
    </Link>
  );
};

type EvidenceRowsProps = {
  lines: ConceptEvidence[];
};

/** Referee verdicts as hairline rows: date, concept and game, then the outcome. */
const EvidenceRows = ({ lines }: EvidenceRowsProps) => (
  <ol className="divide-y divide-line border-y border-line">
    {lines.map((e, i) => (
      <li
        key={`${e.date}-${e.concept}-${i}`}
        className="grid gap-x-8 gap-y-1 py-5 sm:grid-cols-[7rem_minmax(0,1fr)]"
      >
        <span className="font-mono text-[13px] tabular text-fg-3">{e.date}</span>
        <p className="max-w-[40em] text-[15px] leading-7 text-fg-2 text-pretty">
          <Link
            href={conceptHref(e.concept)}
            className="font-medium text-fg underline underline-offset-4 decoration-line-strong hover:decoration-fg"
          >
            {e.concept}
          </Link>{' '}
          in {e.game}: {e.outcome}
        </p>
      </li>
    ))}
  </ol>
);

const ConceptsContent = async () => {
  const [s, c] = await Promise.all([getSnapshot(), getConcepts()]);
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const cells = new Map<string, Cell>();
  for (const t of s.tasks.filter((t) => t.concept)) {
    const key = `${t.concept}|${t.track_id}`;
    const prev = cells.get(key);
    if (prev && rank(prev.task) >= rank(t)) continue;
    const delta = (t.result as { delta?: string } | null)?.delta ?? null;
    cells.set(key, { task: t, delta });
  }
  const tried = [...new Set(s.tasks.map((t) => t.concept).filter((x): x is string => Boolean(x)))];
  const names = [...new Set([...tried, ...c.vocabulary.map((v) => v.name)])];
  const idea = new Map(c.vocabulary.map((v) => [v.name, v.idea]));
  const games = (n: string) => TRACK_ORDER.filter((g) => cells.has(`${n}|${g}`)).length;
  const rows = names.sort((a, b) => games(b) - games(a) || a.localeCompare(b));
  const transferred = rows.filter(
    (n) => TRACK_ORDER.filter((g) => cells.get(`${n}|${g}`)?.task.status === 'landed').length >= 2,
  );
  const evidence = [...c.evidence].reverse();

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · The question the four games ask, and how far the answer has got. */}
      <Section id="overview" labelledBy="concepts-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="concepts-title"
          title="Concepts"
          intro={
            <>
              The four games test the same ideas. When an idea helps one engine, the swarm tries it
              on the other three. So far{' '}
              <span className="font-mono tabular text-fg">{tried.length}</span> concepts have been
              tried, <span className="font-mono tabular text-fg">{transferred.length}</span> have
              shipped in two or more games, and the referee has written{' '}
              <span className="font-mono tabular text-fg">{c.evidence.length}</span> lines of
              evidence.
            </>
          }
          action={
            <>
              <TextLink href="#matrix">What transferred</TextLink>
              <TextLink href="/skills/concepts">The concepts skill</TextLink>
            </>
          }
        />
      </Section>

      {/* 2 · The matrix, given the full width it needs. */}
      <Section id="matrix" labelledBy="matrix-title" tone="band">
        <SectionHeading
          id="matrix-title"
          title="Concept × game"
          intro="Each cell is the best that happened to a concept in one game: shipped, in review, being tried, queued or buried. Each opens its task."
        />
        <FullBleed>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left">
              <caption className="sr-only">
                Concepts by game, most widely tried first. A dot means not tried in that game.
              </caption>
              <thead>
                <tr className="border-b border-line-strong text-[13px] text-fg-3">
                  <th scope="col" className="py-3 pr-6 font-normal">
                    Concept
                  </th>
                  {TRACK_ORDER.map((g) => (
                    <th key={g} scope="col" className="px-3 py-3 font-normal">
                      <span className="inline-flex items-center gap-1.5">
                        <EngineLogo
                          game={g}
                          slot={slots[g] ?? 1}
                          size="sm"
                          className="size-4 rounded"
                        />
                        {GAMES[g].name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((n) => (
                  <tr key={n}>
                    <th scope="row" className="max-w-sm py-4 pr-6 align-top font-normal">
                      <Link
                        href={conceptHref(n)}
                        className={cn(
                          'text-[15px] underline-offset-4 hover:underline',
                          games(n) ? 'font-medium text-fg' : 'text-fg-2',
                        )}
                      >
                        {n}
                      </Link>
                      {idea.get(n) && (
                        <span className="mt-1 block text-[13px] leading-5 text-fg-3 text-pretty">
                          {idea.get(n)}
                        </span>
                      )}
                    </th>
                    {TRACK_ORDER.map((g) => (
                      <td key={g} className="px-3 py-4 align-top">
                        <CellView cell={cells.get(`${n}|${g}`)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FullBleed>
      </Section>

      {/* 3 · What the evidence adds up to so far. */}
      <Section id="beliefs" labelledBy="beliefs-title">
        <SectionHeading
          id="beliefs-title"
          title="What we believe"
          intro="The swarm's working conclusions, as the concepts skill states them. They change when the evidence does."
        />
        <div
          className="playbook playbook-read"
          dangerouslySetInnerHTML={{ __html: c.beliefsHtml }}
        />
      </Section>

      {/* 4 · The referee's verdicts, newest first. */}
      <Section id="evidence" labelledBy="evidence-title" tone="band">
        <SectionHeading
          id="evidence-title"
          title="Evidence log"
          intro="The referee adds a line here for every verdict on a task with a concept. Newest first."
        />
        {evidence.length === 0 ? (
          <p className="border-t border-line pt-5 text-[15px] text-fg-2">
            No verdict recorded yet.
          </p>
        ) : (
          <>
            <EvidenceRows lines={evidence.slice(0, FIRST_EVIDENCE)} />
            {evidence.length > FIRST_EVIDENCE && (
              <Disclosure
                className="mt-4"
                summary={`${evidence.length - FIRST_EVIDENCE} earlier verdicts`}
              >
                <EvidenceRows lines={evidence.slice(FIRST_EVIDENCE)} />
              </Disclosure>
            )}
          </>
        )}
      </Section>

      {/* Last · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={['skills', 'engines', 'graveyard', 'versions']}
        />
      </Section>
    </main>
  );
};

const Concepts = () => (
  <Suspense fallback={<PageSkeleton />}>
    <ConceptsContent />
  </Suspense>
);

export default Concepts;

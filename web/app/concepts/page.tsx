import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BookOpen,
  CircleSlash,
  FlaskConical,
  GitMerge,
  GitPullRequest,
  Grid3x3,
  Lightbulb,
} from 'lucide-react';
import { GAMES, type GameId, type Task } from '@arena/shared';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { getSnapshot } from '@/lib/data';
import { getConcepts } from '@/lib/source';
import { pageMeta } from '@/lib/site';
import { TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Concepts',
  'Four games, one question: which ideas make every engine better? The concept-by-game matrix of what the swarm tried, what shipped, and what transferred.',
  '/concepts',
);

type Cell = { task: Task; delta: string | null };

/** The best thing that happened to a concept in one game: shipped beats in review beats tried beats buried. */
const rank = (t: Task) => ({ landed: 4, review: 3, claimed: 2, open: 1, dead: 0 })[t.status] ?? 0;

const CellView = ({ cell }: { cell: Cell | undefined }) => {
  if (!cell) return <span className="text-fg-3">·</span>;
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
      href={`/tasks/${task.id}`}
      className={cn(
        'inline-flex items-center gap-1 font-mono text-xs tabular hover:underline',
        look.cls,
      )}
      title={task.title}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {look.text}
    </Link>
  );
};

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

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Concepts</Typography>
      <Typography variant="lede" className="mt-2 max-w-3xl">
        The four games test the same ideas. When an idea helps one engine, the swarm tries it on the
        other three.
      </Typography>

      <dl className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line sm:max-w-xl">
        {[
          ['Concepts tried', tried.length],
          ['Shipped in 2+ games', transferred.length],
          ['Evidence lines', c.evidence.length],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel px-4 py-3">
            <dd className="font-mono text-2xl tabular text-fg">{v}</dd>
            <dt className="text-xs text-fg-3">{k}</dt>
          </div>
        ))}
      </dl>

      <Panel className="mt-6" icon={Grid3x3} title="Concept × game" bodyClassName="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left">
          <thead>
            <tr className="border-b border-line text-xs text-fg-3">
              <th scope="col" className="px-4 py-2 font-normal">
                Concept
              </th>
              {TRACK_ORDER.map((g) => (
                <th key={g} scope="col" className="px-3 py-2 font-normal">
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
              <tr key={n} className={cn(!games(n) && 'opacity-60')}>
                <th scope="row" className="px-4 py-2 align-top font-normal">
                  <span className="text-[13px] text-fg">{n}</span>
                  {idea.get(n) && <span className="block text-xs text-fg-3">{idea.get(n)}</span>}
                </th>
                {TRACK_ORDER.map((g) => (
                  <td key={g} className="px-3 py-2 align-top">
                    <CellView cell={cells.get(`${n}|${g}`)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel icon={Lightbulb} title="What we believe">
          <div
            className="playbook px-4 py-3 text-[13px]"
            dangerouslySetInnerHTML={{ __html: c.beliefsHtml }}
          />
        </Panel>
        <Panel
          icon={BookOpen}
          title="Evidence log"
          actions={
            <Link href="/skills/concepts" className="text-xs text-fg-2 hover:text-fg">
              The concepts skill
            </Link>
          }
        >
          {c.evidence.length === 0 ? (
            <Typography variant="small" className="px-4 py-6">
              The referee adds a line here for every verdict on a task with a concept.
            </Typography>
          ) : (
            <ol className="divide-y divide-line">
              {[...c.evidence]
                .reverse()
                .slice(0, 20)
                .map((e, i) => (
                  <li key={`${e.date}-${i}`} className="px-4 py-2 text-[13px]">
                    <span className="font-mono text-xs text-fg-3">{e.date}</span>{' '}
                    <span className="text-fg">{e.concept}</span>{' '}
                    <span className="text-fg-3">in</span>{' '}
                    <span className="text-fg-2">{e.game}</span>:{' '}
                    <span className="text-fg-2">{e.outcome}</span>
                  </li>
                ))}
            </ol>
          )}
        </Panel>
      </div>
    </main>
  );
};

const Concepts = () => (
  <Suspense fallback={<PageSkeleton />}>
    <ConceptsContent />
  </Suspense>
);

export default Concepts;

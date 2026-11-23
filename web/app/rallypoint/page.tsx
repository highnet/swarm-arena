import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowUpRight,
  CircleDashed,
  CircleDot,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Hand,
  RefreshCcw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { TASK_TYPES, type GameId, type TaskType } from '@arena/shared';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { TaskTypeChip } from '@/components/arena/TaskChips';
import { Badge } from '@/components/ui/Badge';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { NextSteps } from '@/components/arena/NextSteps';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { getRallypoint, REPO_URL, STAGES, stageOf, type RpItem, type RpStage } from '@/lib/github';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Rallypoint',
  'The coordination layer under the swarm: every task a GitHub issue, every change one pull request, judged by an independent reviewer and landed by a merger.',
  '/rallypoint',
);

const STAGE_ICON: Record<RpStage, LucideIcon> = {
  backlog: CircleDashed,
  claimed: CircleDot,
  held: Hand,
  review: GitPullRequestDraft,
  changes: RefreshCcw,
  approved: ShieldCheck,
  merged: GitMerge,
  closed: CircleDashed,
};

const ENGINES: GameId[] = ['chess', 'go9', 'othello', 'hex'];

const RpCard = ({ item, slots }: { item: RpItem; slots: Partial<Record<GameId, number>> }) => {
  const engine = ENGINES.find((e) => item.labels.includes(`engine:${e}`));
  const type = TASK_TYPES.find((t) => item.labels.includes(`type:${t}`)) as TaskType | undefined;
  const Icon = item.isPR ? (item.merged ? GitMerge : GitPullRequest) : CircleDot;
  return (
    <li className="rounded-md border border-line bg-panel px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-fg-3">
        <Icon className="size-3.5" aria-hidden="true" />
        <a
          href={item.url}
          className="font-mono tabular hover:text-fg"
          target="_blank"
          rel="noreferrer"
        >
          #{item.number}
        </a>
        {item.closes && <span>closes #{item.closes}</span>}
        <span className="ml-auto">{formatDay(item.updatedAt)}</span>
      </div>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block text-[13px] leading-5 text-fg text-pretty hover:underline"
      >
        {item.title}
      </a>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {engine && (
          <EngineLogo game={engine} slot={slots[engine] ?? 1} size="sm" className="size-5" />
        )}
        {type && <TaskTypeChip type={type} />}
        {item.labels.includes('loop:improvement') && <Badge tone="neutral">Protocol</Badge>}
        {item.labels.includes('arena:referee-passed') && <Badge tone="good">Referee passed</Badge>}
        {item.labels.includes('arena:lesson') && <Badge tone="outline">Lesson</Badge>}
        {item.arenaTask && (
          <Link
            href={`/tasks/${item.arenaTask}`}
            className="ml-auto text-xs text-fg-2 hover:text-fg"
          >
            Task
          </Link>
        )}
      </div>
    </li>
  );
};

const RallypointContent = async () => {
  const [rp, s] = await Promise.all([getRallypoint(), getSnapshot()]);
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const byStage = new Map<RpStage, RpItem[]>();
  for (const i of rp.items) {
    const st = stageOf(i);
    byStage.set(st, [...(byStage.get(st) ?? []), i]);
  }
  const count = (st: RpStage) => byStage.get(st)?.length ?? 0;
  const retros = (s.messages ?? []).filter((m) => m.kind === 'retro');
  const lastProtocol = s.records.filter((r) => r.kind === 'protocol').at(-1);
  const pendingRetros = retros.filter((m) => !lastProtocol || m.at > lastProtocol.at).length;
  // Mirrors `arena next`: finishing work beats starting it.
  const nextRole = count('approved')
    ? 'merger'
    : count('changes')
      ? 'fixer'
      : count('review')
        ? 'reviewer'
        : pendingRetros >= 3
          ? 'improver'
          : count('backlog')
            ? 'worker'
            : 'planner';

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Typography variant="pageTitle">Rallypoint</Typography>
          <Typography variant="lede" className="mt-2 max-w-3xl">
            The swarm works through GitHub. Each task is an issue and each change is a pull request.
            Another agent reviews it, then a merger merges it.
          </Typography>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-fg-2">
            Next session: <span className="font-medium text-fg">{nextRole}</span>
          </span>
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-fg-2 hover:text-fg"
          >
            Issues on GitHub
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
          <a
            href={`${REPO_URL}/pulls`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2.5 py-1.5 text-fg-2 hover:text-fg"
          >
            Pull requests
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 lg:grid-cols-7">
        {STAGES.map((st) => {
          const Icon = STAGE_ICON[st.id];
          return (
            <div key={st.id} className="bg-panel px-4 py-3" title={st.hint}>
              <dd className="font-mono text-2xl tabular text-fg">{count(st.id)}</dd>
              <dt className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-3">
                <Icon className="size-3.5" aria-hidden="true" />
                {st.label}
              </dt>
            </div>
          );
        })}
      </dl>

      {rp.error && (
        <Typography variant="small" className="mt-4">
          {rp.error}. Showing what was last read; GitHub is the source of truth.
        </Typography>
      )}

      <div className="mt-6 flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {STAGES.map((st) => {
          const items = (byStage.get(st.id) ?? []).slice(0, st.id === 'merged' ? 12 : 30);
          const Icon = STAGE_ICON[st.id];
          return (
            <section
              key={st.id}
              aria-labelledby={`stage-${st.id}`}
              className="flex w-[17rem] shrink-0 flex-col rounded-lg border border-line bg-bg/60"
            >
              <header className="flex items-center gap-2 border-b border-line px-3 py-2">
                <Icon className="size-4 text-fg-3" aria-hidden="true" />
                <h2 id={`stage-${st.id}`} className="text-[13px] font-medium text-fg">
                  {st.label}
                </h2>
                <span className="ml-auto font-mono text-xs tabular text-fg-3">{count(st.id)}</span>
              </header>
              <p className="px-3 pt-2 text-xs text-fg-3">{st.hint}</p>
              {items.length ? (
                <ul className="space-y-2 p-3">
                  {items.map((i) => (
                    <RpCard key={i.number} item={i} slots={slots} />
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-6 text-center text-xs text-fg-3">Empty</p>
              )}
            </section>
          );
        })}
      </div>

      <p className={cn('mt-4 text-xs text-fg-3')}>
        Read from GitHub {formatDay(rp.asOf)} {formatTime(rp.asOf)} UTC · refreshes every two
        minutes ·{' '}
        <Link href="/protocol" className="text-fg-2 hover:text-fg">
          How the protocol works
        </Link>
      </p>
      <NextSteps links={['fleet', 'protocol', 'board', 'messages']} />
    </main>
  );
};

const Rallypoint = () => (
  <Suspense fallback={<PageSkeleton />}>
    <RallypointContent />
  </Suspense>
);

export default Rallypoint;

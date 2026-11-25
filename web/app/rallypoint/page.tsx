import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
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
import { GAMES, TASK_TYPES, type GameId, type TaskType } from '@arena/shared';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { TASK_TYPE_META } from '@/components/arena/TaskChips';
import { Disclosure } from '@/components/ui/Disclosure';
import { FullBleed } from '@/components/ui/FullBleed';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
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

/** The board read top to bottom: what waits on a verdict, what is being worked, what is next, what landed. */
const CHAPTERS: { id: string; title: string; intro: string; stages: RpStage[] }[] = [
  {
    id: 'verdicts',
    title: 'Waiting on a verdict',
    intro:
      'Pull requests an independent reviewer has to judge, those sent back for a fix, and those approved for a merger.',
    stages: ['review', 'changes', 'approved'],
  },
  {
    id: 'worked',
    title: 'Being worked',
    intro:
      'Issues a worker has claimed, and those on hold: blocked by another issue, deferred, or waiting on a human.',
    stages: ['claimed', 'held'],
  },
  {
    id: 'next',
    title: 'Up next',
    intro: 'Open issues that any worker may claim. The highest priority goes first.',
    stages: ['backlog'],
  },
  {
    id: 'landed',
    title: 'Landed lately',
    intro: 'The latest pull requests merged to main.',
    stages: ['merged'],
  },
];

/** Items shown before the rest of a stage folds behind a disclosure. */
const FIRST = 6;
/** How many of each stage the page holds: the newest 30, and 12 merged. The rest is on GitHub. */
const cap = (st: RpStage) => (st === 'merged' ? 12 : 30);

/** Where GitHub lists the whole of a stage, for a list this page caps. */
const STAGE_QUERY: Record<RpStage, string> = {
  backlog:
    'is:issue is:open -label:status:claimed -label:status:blocked -label:status:deferred -label:needs:human',
  claimed: 'is:issue is:open label:status:claimed',
  held: 'is:issue is:open label:status:blocked,status:deferred,needs:human',
  review: 'is:pr is:open -label:review:approved -label:status:changes-requested',
  changes: 'is:pr is:open label:status:changes-requested',
  approved: 'is:pr is:open label:review:approved',
  merged: 'is:pr is:merged',
  closed: 'is:closed',
};
const stageHref = (st: RpStage) =>
  `${REPO_URL}/${st === 'backlog' || st === 'claimed' || st === 'held' ? 'issues' : 'pulls'}?q=${encodeURIComponent(STAGE_QUERY[st])}`;

const ENGINES: GameId[] = ['chess', 'go9', 'othello', 'hex'];

type RpRowProps = {
  item: RpItem;
  slots: Partial<Record<GameId, number>>;
};

/** One issue or pull request as a hairline row: number, title, what it is about, its task. */
const RpRow = ({ item, slots }: RpRowProps) => {
  const engine = ENGINES.find((e) => item.labels.includes(`engine:${e}`));
  const type = TASK_TYPES.find((t) => item.labels.includes(`type:${t}`)) as TaskType | undefined;
  const Icon = item.isPR ? (item.merged ? GitMerge : GitPullRequest) : CircleDot;
  const marks = [
    item.labels.includes('loop:improvement') && 'Protocol',
    item.labels.includes('arena:lesson') && 'Lesson',
  ].filter((x): x is string => Boolean(x));
  return (
    <li className="grid gap-x-8 gap-y-2 py-5 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
      <span className="inline-flex items-center gap-1.5 font-mono text-[15px] tabular text-fg-3">
        <Icon className="size-4" aria-label={item.isPR ? 'Pull request' : 'Issue'} />
        <a
          href={item.url}
          className="underline-offset-4 hover:text-fg hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          #{item.number}
        </a>
      </span>
      <div className="min-w-0">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="text-base leading-6 text-fg text-pretty break-words underline-offset-4 hover:underline"
        >
          {item.title}
        </a>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-3">
          {engine && (
            <span className="inline-flex items-center gap-1.5">
              <EngineLogo
                game={engine}
                slot={slots[engine] ?? 1}
                size="sm"
                className="size-4 rounded"
              />
              {GAMES[engine].name}
            </span>
          )}
          {type && <span>{TASK_TYPE_META[type].label}</span>}
          {marks.map((m) => (
            <span key={m}>{m}</span>
          ))}
          {item.labels.includes('arena:referee-passed') && (
            <span className="text-good-text">Referee passed</span>
          )}
          {item.closes && <span>closes #{item.closes}</span>}
          <time dateTime={item.updatedAt}>updated {formatDay(item.updatedAt)}</time>
        </p>
      </div>
      {item.arenaTask && (
        <TextLink href={`/tasks/${item.arenaTask}`} size="small" className="sm:self-start">
          The task
        </TextLink>
      )}
    </li>
  );
};

type StageListProps = {
  stage: (typeof STAGES)[number];
  items: RpItem[];
  total: number;
  /** The total is a floor: only a recent window was read. */
  atLeast?: boolean;
  slots: Partial<Record<GameId, number>>;
};

/** One stage under its chapter: a sub-heading with the count, the first rows, the rest folded. */
const StageList = ({ stage, items, total, atLeast, slots }: StageListProps) => {
  const Icon = STAGE_ICON[stage.id];
  return (
    <div id={`stage-${stage.id}`} className="scroll-mt-sticky">
      <SectionHeading
        id={`stage-${stage.id}-title`}
        level="sub"
        space="tight"
        title={
          <span className="inline-flex items-center gap-3">
            <Icon className="size-6 text-fg-3" aria-hidden="true" />
            {stage.label}
            <span className="font-mono text-xl font-normal tabular text-fg-3">{total}</span>
          </span>
        }
        intro={stage.hint}
      />
      {items.length < total && (
        <p className="mb-5 text-[13px] text-fg-3">
          Showing the latest <span className="font-mono tabular">{items.length}</span> of{' '}
          {atLeast && 'at least '}
          <span className="font-mono tabular">{total}</span>.{' '}
          <TextLink href={stageHref(stage.id)} external>
            All {stage.label.toLowerCase()} on GitHub
          </TextLink>
        </p>
      )}
      {items.length === 0 ? (
        <p className="border-t border-line pt-5 text-[15px] text-fg-3">Nothing here right now.</p>
      ) : (
        <>
          <ol className="divide-y divide-line border-y border-line">
            {items.slice(0, FIRST).map((i) => (
              <RpRow key={i.number} item={i} slots={slots} />
            ))}
          </ol>
          {items.length > FIRST && (
            <Disclosure
              className="mt-4"
              summary={`${items.length - FIRST} more ${stage.label.toLowerCase()}`}
            >
              <ol className="divide-y divide-line border-y border-line">
                {items.slice(FIRST).map((i) => (
                  <RpRow key={i.number} item={i} slots={slots} />
                ))}
              </ol>
            </Disclosure>
          )}
        </>
      )}
    </div>
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
  // Open stages are read in full. Merged is read only recently, so its total is GitHub's all-time count.
  const count = (st: RpStage) =>
    st === 'merged' && rp.mergedTotal !== null
      ? Math.max(rp.mergedTotal, byStage.get(st)?.length ?? 0)
      : (byStage.get(st)?.length ?? 0);
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
  const open = count('backlog') + count('claimed') + count('held');
  const prs = count('review') + count('changes') + count('approved');

  const nav: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'stages', label: 'Where it stands' },
    ...CHAPTERS.map((c) => ({ id: c.id, label: c.title })),
    { id: 'more', label: 'Further reading' },
  ];

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={nav} />

      {/* 1 · What Rallypoint is, and what the swarm would do next. */}
      <Section id="overview" labelledBy="rp-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="rp-title"
          title="Rallypoint"
          intro={
            <>
              The swarm works through GitHub. Each task is an issue and each change is a pull
              request. Another agent reviews it, then a merger merges it. Right now{' '}
              <span className="font-mono tabular text-fg">{open}</span>{' '}
              {open === 1 ? 'issue is' : 'issues are'} open and{' '}
              <span className="font-mono tabular text-fg">{prs}</span>{' '}
              {prs === 1 ? 'pull request is' : 'pull requests are'} in flight; the next session
              would be a <span className="font-medium text-fg">{nextRole}</span>.
            </>
          }
          action={
            <>
              <TextLink href={`${REPO_URL}/issues`} external>
                Issues on GitHub
              </TextLink>
              <TextLink href={`${REPO_URL}/pulls`} external>
                Pull requests
              </TextLink>
              <TextLink href="/protocol">How the protocol works</TextLink>
            </>
          }
        />
        {rp.error && (
          <p className="mt-10 max-w-2xl text-[15px] text-fg-2">
            {rp.error}. Showing what was last read; GitHub is the source of truth.
          </p>
        )}
      </Section>

      {/* 2 · Every stage at a glance, each count jumping to its list. */}
      <Section id="stages" labelledBy="stages-title" tone="band" space="compact">
        <SectionHeading
          id="stages-title"
          title="Where it stands"
          intro="Every task moves left to right: claimed, reviewed, approved, merged."
          space="tight"
        />
        <FullBleed>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-10 border-t border-line pt-8 sm:grid-cols-4 lg:grid-cols-7">
            {STAGES.map((st) => {
              const Icon = STAGE_ICON[st.id];
              return (
                <div key={st.id} className="flex min-w-0 flex-col">
                  <dt className="order-2 mt-2 flex items-center gap-1.5 text-[13px] text-fg-3">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {st.label}
                  </dt>
                  <dd className="order-1">
                    <Link
                      href={`#stage-${st.id}`}
                      className="font-mono text-3xl font-medium tabular tracking-tight text-fg underline-offset-4 hover:underline"
                    >
                      {count(st.id)}
                    </Link>
                  </dd>
                </div>
              );
            })}
          </dl>
        </FullBleed>
      </Section>

      {/* 3–6 · The board, one chapter per question, read top to bottom. */}
      {CHAPTERS.map((c, ci) => (
        <Section
          key={c.id}
          id={c.id}
          labelledBy={`${c.id}-title`}
          tone={ci % 2 === 0 ? 'plain' : 'band'}
        >
          <SectionHeading id={`${c.id}-title`} title={c.title} intro={c.intro} />
          <div className={cn('grid gap-y-20', c.stages.length > 1 && 'gap-y-24')}>
            {c.stages.map((id) => {
              const stage = STAGES.find((x) => x.id === id)!;
              return (
                <StageList
                  key={id}
                  stage={stage}
                  items={(byStage.get(id) ?? []).slice(0, cap(id))}
                  total={count(id)}
                  atLeast={id === 'merged' && rp.mergedTotal === null}
                  slots={slots}
                />
              );
            })}
          </div>
        </Section>
      ))}

      {/* Last · Where the reading came from, and where to go next. */}
      <Section id="more" labelledBy="next-steps-title" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={['fleet', 'protocol', 'board', 'messages']}
        />
        <p className="mt-16 text-[13px] text-fg-3">
          Read from GitHub{' '}
          <time dateTime={rp.asOf}>
            {formatDay(rp.asOf)} {formatTime(rp.asOf)} UTC
          </time>{' '}
          · refreshes every two minutes.
        </p>
      </Section>
    </main>
  );
};

const Rallypoint = () => (
  <Suspense fallback={<PageSkeleton />}>
    <RallypointContent />
  </Suspense>
);

export default Rallypoint;

import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  GitPullRequest,
  Swords,
} from 'lucide-react';
import { refsOf, rootOf, type Task } from '@arena/shared';
import { AgentTag } from '@/components/arena/AgentAvatar';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { MESSAGE_KIND } from '@/components/arena/messageKinds';
import { RecordTimeline } from '@/components/arena/RecordTimeline';
import { TASK_TYPE_META } from '@/components/arena/TaskChips';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { NextSteps } from '@/components/arena/NextSteps';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { REPO_URL } from '@/lib/github';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { matchHref, versionHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

type TaskPageProps = {
  params: Promise<{ id: string }>;
};

export const generateMetadata = async ({ params }: TaskPageProps): Promise<Metadata> => {
  const { id } = await params;
  const s = await getSnapshot();
  const task = s.tasks.find((t) => t.id === id);
  if (!task) return { title: 'Task' };
  return pageMeta(task.title, task.spec.slice(0, 160), `/tasks/${id}`);
};

/** Status as an icon and a word in a readable tone, never a tinted badge (web/DESIGN.md). */
const STATUS: Record<Task['status'], { label: string; icon: typeof CircleDot; tone: string }> = {
  open: { label: 'Queued', icon: CircleDashed, tone: 'text-fg-2' },
  claimed: { label: 'In progress', icon: CircleDot, tone: 'text-fg' },
  review: { label: 'In review', icon: GitPullRequest, tone: 'text-fg' },
  landed: { label: 'Shipped', icon: CircleCheck, tone: 'text-good-text' },
  dead: { label: 'Buried', icon: CircleSlash, tone: 'text-critical-text' },
};

const linkClass =
  'text-fg underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:decoration-fg';

type FactProps = {
  label: string;
  children: ReactNode;
};

/** One labelled fact of the task, on the section ground under the overview's hairline. */
const Fact = ({ label, children }: FactProps) => (
  <div className="min-w-0">
    <dt className="text-[13px] text-fg-3">{label}</dt>
    <dd className="mt-2 text-[15px] leading-6 text-fg text-pretty">{children}</dd>
  </div>
);

const TaskContent = async ({ params }: TaskPageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const task = s.tasks.find((t) => t.id === id);
  if (!task) notFound();
  const track = s.tracks.find((t) => t.id === task.track_id)!;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const timeline = s.records
    .filter((r) => r.task_id === task.id)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const matchIds = new Set(timeline.map((r) => r.match_id).filter(Boolean));
  const matches = s.matches
    .filter((m) => matchIds.has(m.id))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const live = matches.find((m) => !m.finished_at);
  const landed = timeline.find((r) => r.kind === 'patch_landed');
  const version = landed?.title.split(' ')[0];
  const point = version
    ? s.elo.find((e) => e.track_id === task.track_id && e.engine_version === version)
    : undefined;
  const numbers = [task.issue, task.pr].filter((x): x is number => Boolean(x));
  const talk = (s.messages ?? [])
    .filter(
      (m) =>
        refsOf(m).some((r) => r.kind !== 'message' && numbers.includes(r.n)) ||
        (m.track_id === task.track_id &&
          m.agent_id === task.claimed_by &&
          m.at >= task.created_at &&
          (!task.closed_at ||
            m.at <= new Date(Date.parse(task.closed_at) + 3_600_000).toISOString())),
    )
    .sort((a, b) => a.at.localeCompare(b.at));
  const byId = new Map((s.messages ?? []).map((m) => [m.id, m]));
  const threadOf = (id: number) => rootOf(id, byId);
  const status = STATUS[task.status];
  const StatusIcon = status.icon;
  const type = TASK_TYPE_META[task.type ?? 'experiment'] ?? TASK_TYPE_META.experiment;
  const TypeIcon = type.icon;

  // Bands alternate down the page; the discussion section is there only when there is talk.
  const chapters: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'progress', label: 'Progress' },
    { id: 'games', label: 'Games' },
    ...(talk.length > 0 ? [{ id: 'talk', label: 'Discussion' }] : []),
    { id: 'further', label: 'Further' },
  ];
  const tone = (sectionId: string) =>
    chapters.findIndex((c) => c.id === sectionId) % 2 === 0 ? 'plain' : 'band';

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={chapters} />

      {/* 1 · Overview: what the task asks, and where it stands. */}
      <Section id="overview" labelledBy="task-title">
        <SectionHeading
          level="page"
          space="none"
          id="task-title"
          title={task.title}
          intro={task.spec}
        />
        {live && (
          <div className="mt-10 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <p className="inline-flex items-center gap-2 text-lg text-fg">
              <Swords className="size-5 text-fg-2" aria-hidden="true" />
              Playing now: {live.engine_version} vs {live.opponent},{' '}
              <span className="font-mono tabular">
                {live.wins}–{live.losses}–{live.draws}
              </span>
            </p>
            <TextLink href={matchHref(live.id)}>Watch the games</TextLink>
          </div>
        )}
        <dl className="mt-14 grid grid-cols-2 gap-x-8 gap-y-8 border-t border-line pt-8 lg:grid-cols-4">
          <Fact label="Status">
            <span className={cn('inline-flex items-center gap-1.5', status.tone)}>
              <StatusIcon className="size-4 shrink-0" aria-hidden="true" />
              {status.label}
            </span>
          </Fact>
          <Fact label="Engine">
            <Link
              href={`/engines/${track.id}`}
              className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
            >
              <EngineLogo
                game={track.id}
                slot={track.color_slot}
                size="sm"
                className="size-5 rounded"
              />
              {track.name}
            </Link>
          </Fact>
          <Fact label="Kind of work">
            <span className="inline-flex items-center gap-1.5" title={type.hint}>
              <TypeIcon className="size-4 shrink-0 text-fg-3" aria-hidden="true" />
              {type.label}
            </span>
          </Fact>
          <Fact label="Claimed by">
            {task.claimed_by ? (
              <AgentTag id={task.claimed_by} seat={seats[task.claimed_by]} size={20} />
            ) : (
              <span className="text-fg-2">Not claimed yet</span>
            )}
          </Fact>
          <Fact label="Opened">
            <span className="font-mono tabular">
              {formatDay(task.created_at)} {formatTime(task.created_at)}
            </span>
          </Fact>
          {task.closed_at && (
            <Fact label="Closed">
              <span className="font-mono tabular">
                {formatDay(task.closed_at)} {formatTime(task.closed_at)}
              </span>
            </Fact>
          )}
          {version && (
            <Fact label="Shipped as">
              <Link
                href={versionHref(track.id, version)}
                className={cn('font-mono tabular', linkClass)}
              >
                {version}
              </Link>
              {point && (
                <span className="block font-mono text-[13px] tabular text-fg-2">
                  {formatElo(point.elo)} Elo
                  {point.elo_error ? ` ± ${Math.round(point.elo_error)}` : ''}
                </span>
              )}
            </Fact>
          )}
          {(task.issue || task.pr) && (
            <Fact label="On GitHub">
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {task.issue && (
                  <a href={`${REPO_URL}/issues/${task.issue}`} className={linkClass}>
                    Issue <span className="font-mono tabular">#{task.issue}</span>
                  </a>
                )}
                {task.pr && (
                  <a href={`${REPO_URL}/pull/${task.pr}`} className={linkClass}>
                    Pull request <span className="font-mono tabular">#{task.pr}</span>
                  </a>
                )}
              </span>
            </Fact>
          )}
          {task.concept && (
            <Fact label="Concept">
              <Link href="/concepts" className={linkClass}>
                {task.concept}
              </Link>
            </Fact>
          )}
        </dl>
      </Section>

      {/* 2 · Progress: every step, in order. */}
      <Section id="progress" labelledBy="progress-title" tone={tone('progress')}>
        <SectionHeading
          id="progress-title"
          title="How it went"
          intro={
            timeline.length === 0
              ? 'Nothing logged yet.'
              : 'Every step on the board, oldest first: the claim, the measurements, the review and the verdict.'
          }
        />
        {timeline.length > 0 && <RecordTimeline records={timeline} showAgent />}
      </Section>

      {/* 3 · The games that judged it. */}
      <Section id="games" labelledBy="games-title" tone={tone('games')}>
        <SectionHeading
          id="games-title"
          title="The games"
          intro={
            matches.length === 0
              ? 'No games yet. The referee plays them when the agent submits.'
              : 'Each match the referee played for this task: a smoke test first, then the gate against the engine it must beat.'
          }
        />
        {matches.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {matches.map((m) => (
              <li key={m.id}>
                <Link
                  href={matchHref(m.id)}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-8 gap-y-1 py-6 sm:grid-cols-[12rem_minmax(0,1fr)_auto]"
                >
                  <span className="text-[13px] text-fg-3">
                    {m.purpose === 'calibration' ? 'Smoke test' : 'Gate'}
                  </span>
                  <span className="col-start-1 truncate text-lg text-fg underline-offset-4 group-hover:underline sm:col-start-2">
                    {m.engine_version} vs {m.opponent}
                  </span>
                  <span className="row-span-2 row-start-1 text-right sm:row-span-1 sm:col-start-3">
                    <span className="block font-mono text-xl font-medium tabular text-fg">
                      {m.wins}–{m.losses}–{m.draws}
                    </span>
                    <span className="block font-mono text-[13px] tabular text-fg-3">
                      {m.finished_at
                        ? `${formatElo(m.elo)} ± ${Math.round(m.elo_error)}`
                        : 'in progress'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 4 · What the agents said about it. */}
      {talk.length > 0 && (
        <Section id="talk" labelledBy="talk-title" tone={tone('talk')}>
          <SectionHeading
            id="talk-title"
            title="On the discussion board"
            intro="Threads that name this task's issue or pull request, and what its agent posted while it held the claim."
          />
          <ol className="divide-y divide-line border-y border-line">
            {talk.map((m) => {
              const kind = MESSAGE_KIND[m.kind] ?? MESSAGE_KIND.note;
              const root = threadOf(m.id);
              return (
                <li key={m.id}>
                  <Link
                    href={`/messages/${root}${root === m.id ? '' : `#msg-${m.id}`}`}
                    className="group grid gap-x-10 gap-y-2 py-6 sm:grid-cols-[9rem_minmax(0,1fr)]"
                  >
                    <time
                      dateTime={m.at}
                      className="font-mono text-[13px] leading-6 tabular text-fg-3"
                    >
                      {formatDay(m.at)} {formatTime(m.at)}
                    </time>
                    <span className="block min-w-0 max-w-2xl">
                      <span className="flex flex-wrap items-center gap-x-3 text-[13px]">
                        <span className={cn('font-medium', kind.tone)}>{kind.label}</span>
                        {m.agent_id && <AgentTag id={m.agent_id} size={16} />}
                      </span>
                      <span className="mt-1.5 line-clamp-3 block max-w-[54ch] whitespace-pre-wrap text-[15px] leading-7 text-fg-2 text-pretty group-hover:text-fg">
                        {m.title ? `${m.title}: ${m.body}` : m.body}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      {/* 5 · Further reading. */}
      <Section id="further" labelledBy="next-steps-title" tone={tone('further')} space="compact">
        <NextSteps
          variant="list"
          title="Further"
          links={['rallypoint', 'board', 'fleet', 'versions']}
        />
      </Section>
    </main>
  );
};

const TaskPage = ({ params }: TaskPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-5xl px-4 pt-6 sm:px-6" />}>
    <TaskContent params={params} />
  </Suspense>
);

export default TaskPage;

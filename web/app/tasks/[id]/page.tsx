import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  ListChecks,
  MessagesSquare,
  Swords,
} from 'lucide-react';
import type { Task } from '@arena/shared';
import { AgentTag } from '@/components/arena/AgentAvatar';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { KINDS, TONE_CLASS } from '@/components/arena/recordKinds';
import { TaskTypeChip, VersionChip } from '@/components/arena/TaskChips';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatElo, formatTime } from '@/lib/format';
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

const STATUS: Record<
  Task['status'],
  { label: string; icon: typeof CircleDot; tone: 'neutral' | 'good' | 'critical' | 'outline' }
> = {
  open: { label: 'Queued', icon: CircleDashed, tone: 'outline' },
  claimed: { label: 'In progress', icon: CircleDot, tone: 'neutral' },
  landed: { label: 'Shipped', icon: CircleCheck, tone: 'good' },
  dead: { label: 'Buried', icon: CircleSlash, tone: 'critical' },
};

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
  const talk = (s.messages ?? [])
    .filter(
      (m) =>
        m.track_id === task.track_id &&
        m.agent_id === task.claimed_by &&
        m.at >= task.created_at &&
        (!task.closed_at || m.at <= new Date(Date.parse(task.closed_at) + 3_600_000).toISOString()),
    )
    .sort((a, b) => a.at.localeCompare(b.at));
  const status = STATUS[task.status];
  const StatusIcon = status.icon;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <Link
        href={`/engines/${track.id}`}
        className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg"
      >
        <ArrowLeft className="size-3" aria-hidden="true" />
        {track.name}
      </Link>

      <header className="mt-3 flex items-start gap-3">
        <EngineLogo game={track.id} slot={track.color_slot} size="lg" className="mt-1" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskTypeChip type={task.type} />
            <Badge tone={status.tone}>
              <StatusIcon
                className={cn(
                  'size-3',
                  task.status === 'claimed' && 'animate-pulse-dot text-good-text',
                )}
                aria-hidden="true"
              />
              {status.label}
            </Badge>
            {version && <VersionChip version={version} elo={point?.elo} error={point?.elo_error} />}
          </div>
          <Typography variant="pageTitle" className="mt-2 text-balance">
            {task.title}
          </Typography>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
            {task.claimed_by ? (
              <AgentTag
                id={task.claimed_by}
                seat={seats[task.claimed_by]}
                size={18}
                className="text-[13px]"
              />
            ) : (
              <span>Not claimed yet</span>
            )}
            <span>
              Opened {formatDay(task.created_at)} {formatTime(task.created_at)} UTC
            </span>
            {task.closed_at && (
              <span>
                Closed {formatDay(task.closed_at)} {formatTime(task.closed_at)} UTC
              </span>
            )}
          </div>
        </div>
      </header>

      <Typography variant="body" className="mt-5 max-w-prose text-pretty">
        {task.spec}
      </Typography>

      {live && (
        <Link
          href={`/matches/${live.id}`}
          className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-panel px-4 py-3 hover:border-line-strong"
        >
          <Swords className="size-4 text-fg-2" aria-hidden="true" />
          <span className="text-[13px] text-fg">
            Playing now: {live.engine_version} vs {live.opponent}
          </span>
          <span className="font-mono text-[13px] tabular text-fg-2">
            {live.wins}–{live.losses}–{live.draws}
          </span>
          <span className="ml-auto inline-flex items-center gap-0.5 text-xs text-fg-2">
            Watch the games
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </span>
        </Link>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel icon={ListChecks} title="Progress">
          {timeline.length === 0 ? (
            <Typography variant="small" className="px-4 py-6">
              Nothing logged yet.
            </Typography>
          ) : (
            <ol className="px-4 py-3">
              {timeline.map((r, i) => {
                const meta = KINDS[r.kind];
                const Icon = meta.icon;
                return (
                  <li
                    key={r.id}
                    className="relative grid grid-cols-[1.25rem_1fr] gap-x-3 pb-4 last:pb-1"
                  >
                    {i < timeline.length - 1 && (
                      <span
                        className="absolute left-[9px] top-6 bottom-0 w-px bg-line-strong"
                        aria-hidden="true"
                      />
                    )}
                    <Icon
                      className={cn('mt-0.5 size-4', TONE_CLASS[meta.tone])}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className={cn('font-medium', TONE_CLASS[meta.tone])}>
                          {meta.label}
                        </span>
                        {r.agent_id && (
                          <AgentTag id={r.agent_id} size={14} className="text-[11px]" />
                        )}
                        <time dateTime={r.at} className="font-mono tabular text-fg-3">
                          {formatTime(r.at)}
                        </time>
                      </div>
                      <Typography variant="small" color="primary" className="mt-0.5 text-pretty">
                        {r.title}
                      </Typography>
                      {r.detail && (
                        <Typography
                          variant="meta"
                          as="p"
                          className="mt-0.5 max-w-prose text-pretty"
                        >
                          {r.detail}
                        </Typography>
                      )}
                      {r.match_id && (
                        <Link
                          href={`/matches/${r.match_id}`}
                          className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-fg-2 hover:text-fg"
                        >
                          Games
                          <ArrowUpRight className="size-3" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel icon={Swords} title="Matches">
            {matches.length === 0 ? (
              <Typography variant="small" className="px-4 py-6">
                No games yet. The referee plays them when the agent submits.
              </Typography>
            ) : (
              <ul className="divide-y divide-line">
                {matches.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/matches/${m.id}`}
                      className="block px-4 py-2.5 hover:bg-panel-raised"
                    >
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate text-fg">vs {m.opponent}</span>
                        <span className="font-mono tabular text-fg-2">
                          {m.wins}–{m.losses}–{m.draws}
                        </span>
                      </div>
                      <div className="text-xs text-fg-3">
                        {m.purpose === 'calibration' ? 'Smoke test' : 'Gate'} ·{' '}
                        {m.finished_at
                          ? `${formatElo(m.elo)} ± ${Math.round(m.elo_error)}`
                          : 'in progress'}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {talk.length > 0 && (
            <Panel icon={MessagesSquare} title="From the agent">
              <ul className="divide-y divide-line">
                {talk.map((m) => (
                  <li key={m.id} className="px-4 py-2.5">
                    <div className="text-xs text-fg-3">
                      {m.kind} · {formatTime(m.at)}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-6 text-fg-2">
                      {m.body}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </main>
  );
};

const TaskPage = ({ params }: TaskPageProps) => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <TaskContent params={params} />
  </Suspense>
);

export default TaskPage;

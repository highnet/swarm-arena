import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, GitPullRequest, Moon, Radio, Users } from 'lucide-react';
import { agentName, type Agent, type GameId } from '@arena/shared';
import { AgentAvatar } from '@/components/arena/AgentAvatar';
import { Elapsed } from '@/components/arena/Elapsed';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { KINDS, TONE_CLASS } from '@/components/arena/recordKinds';
import { Badge } from '@/components/ui/Badge';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { REPO_URL } from '@/lib/github';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Fleet',
  'Every agent seat in the swarm, live: its Rallypoint role, what it is doing this minute, the task and pull request it holds, and its latest steps.',
  '/fleet',
);

/** A seat that says it is working but has not been heard from in this long is shown as stale. */
const STALE_MS = 45 * 60 * 1000;

const ROLE_LABEL: Record<string, string> = {
  worker: 'Worker',
  reviewer: 'Reviewer',
  merger: 'Merger',
  fixer: 'Fixer',
  improver: 'Improver',
  planner: 'Planner',
  strategist: 'Planner',
  builder: 'Worker',
  referee: 'Referee',
};

const SeatCard = ({
  a,
  asOf,
  slots,
  steps,
  taskTitle,
}: {
  a: Agent;
  asOf: string;
  slots: Partial<Record<GameId, number>>;
  steps: {
    id: number;
    kind: keyof typeof KINDS;
    title: string;
    at: string;
    task_id: string | null;
  }[];
  taskTitle: string | null;
}) => {
  const stale = a.status === 'working' && Date.parse(asOf) - Date.parse(a.last_seen) > STALE_MS;
  const live = a.status === 'working' && !stale;
  const role = ROLE_LABEL[a.rp_role ?? a.role] ?? a.role;
  return (
    <li
      className={cn(
        'flex flex-col rounded-lg border bg-panel',
        live ? 'border-line-strong' : 'border-line',
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <div className="relative">
          <AgentAvatar id={a.id} size={44} />
          {live && (
            <span
              className="absolute -bottom-0.5 -right-0.5 size-3 animate-pulse-dot rounded-full bg-good ring-2 ring-panel"
              aria-hidden="true"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-fg">{agentName(a.id)}</span>
            <Badge tone="neutral">{role}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-3">
            <span className="font-mono">{a.seat}</span>
            {a.track_id && (
              <EngineLogo
                game={a.track_id}
                slot={slots[a.track_id] ?? 1}
                size="sm"
                className="size-4 rounded"
              />
            )}
            <span>
              {a.sessions} session{a.sessions === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right text-xs">
          {live ? (
            <span className="inline-flex items-center gap-1 text-good-text">
              <Radio className="size-3.5" aria-hidden="true" />
              {a.started_at ? <Elapsed since={a.started_at} asOf={asOf} /> : 'working'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-fg-3">
              <Moon className="size-3.5" aria-hidden="true" />
              {stale ? 'not heard from' : 'idle'}
            </span>
          )}
          <div className="mt-0.5 text-fg-3">
            seen {formatDay(a.last_seen)} {formatTime(a.last_seen)}
          </div>
        </div>
      </div>

      {(live || a.activity) && (
        <div className="border-t border-line px-4 py-2.5">
          <p className={cn('text-[13px] text-pretty', live ? 'text-fg' : 'text-fg-3')}>
            {live ? (a.activity ?? 'Working') : `Last: ${a.activity}`}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
            {a.task_id && (
              <Link href={`/tasks/${a.task_id}`} className="text-fg-2 hover:text-fg">
                {taskTitle ?? 'Task'}
              </Link>
            )}
            {a.pr && (
              <a
                href={`${REPO_URL}/pull/${a.pr}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-fg-2 hover:text-fg"
              >
                <GitPullRequest className="size-3.5" aria-hidden="true" />#{a.pr}
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      )}

      {steps.length > 0 && (
        <ol className="mt-auto space-y-1.5 border-t border-line px-4 py-3">
          {steps.map((r) => {
            const meta = KINDS[r.kind];
            const Icon = meta.icon;
            return (
              <li key={r.id} className="flex items-start gap-2 text-xs">
                <Icon
                  className={cn('mt-px size-3.5 shrink-0', TONE_CLASS[meta.tone])}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-fg-2 text-pretty">{r.title}</span>
                <time dateTime={r.at} className="font-mono tabular text-fg-3">
                  {formatTime(r.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
};

const Fleet = async () => {
  const s = await getSnapshot();
  const asOf = s.asOf ?? new Date().toISOString();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const titles = new Map(s.tasks.map((t) => [t.id, t.title]));
  const stepsOf = (id: string) =>
    s.records
      .filter((r) => r.agent_id === id && r.kind !== 'task_opened')
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 4);
  const seats = [...s.agents].sort(
    (a, b) =>
      Number(b.status === 'working') - Number(a.status === 'working') ||
      b.last_seen.localeCompare(a.last_seen),
  );
  const working = seats.filter(
    (a) => a.status === 'working' && Date.parse(asOf) - Date.parse(a.last_seen) <= STALE_MS,
  );

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Typography variant="pageTitle">Fleet</Typography>
          <Typography variant="lede" className="mt-2 max-w-3xl">
            The agents working right now, and what each one is doing.
          </Typography>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-[13px]">
          <Users className="size-4 text-fg-3" aria-hidden="true" />
          <span className="font-mono tabular text-fg">{working.length}</span>
          <span className="text-fg-2">working now</span>
        </div>
      </div>

      {working.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-line bg-panel px-6 py-14 text-center">
          <Moon className="size-6 text-fg-3" aria-hidden="true" />
          <p className="text-[15px] text-fg">Nobody is working right now.</p>
          <p className="max-w-md text-[13px] text-fg-2">
            Agents appear here the moment a session starts, and leave when it ends.
          </p>
          <Link
            href="/protocol#prompts"
            className="mt-1 rounded-md border border-line px-3 py-1.5 text-[13px] text-fg-2 hover:border-line-strong hover:text-fg"
          >
            Start an agent
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {working.map((a) => (
            <SeatCard
              key={a.id}
              a={a}
              asOf={asOf}
              slots={slots}
              steps={stepsOf(a.id)}
              taskTitle={a.task_id ? (titles.get(a.task_id) ?? null) : null}
            />
          ))}
        </ul>
      )}
    </main>
  );
};

export default Fleet;

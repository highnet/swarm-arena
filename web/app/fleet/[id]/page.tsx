import { Suspense } from 'react';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, GitPullRequest, ListChecks, Moon, Radio } from 'lucide-react';
import { agentName } from '@arena/shared';
import { AgentAvatar } from '@/components/arena/AgentAvatar';
import { Elapsed } from '@/components/arena/Elapsed';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { KINDS, TONE_CLASS } from '@/components/arena/recordKinds';
import { agentHref, isLive, isStale, roleLabel } from '@/components/arena/seats';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { NextSteps } from '@/components/arena/NextSteps';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { recordHref } from '@/lib/routes';
import { REPO_URL } from '@/lib/github';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

/** How many of the seat's latest steps the page lists. */
const STEP_LIMIT = 100;

type AgentPageProps = {
  params: Promise<{ id: string }>;
};

export const generateMetadata = async ({ params }: AgentPageProps): Promise<Metadata> => {
  const id = decodeURIComponent((await params).id);
  return pageMeta(
    agentName(id),
    `What ${agentName(id)} is doing in the swarm, and every step it has logged.`,
    agentHref(id),
  );
};

const AgentContent = async ({ params }: AgentPageProps) => {
  // Live by nature, like the fleet itself.
  await connection();
  const id = decodeURIComponent((await params).id);
  const s = await getSnapshot();
  const a = s.agents.find((x) => x.id === id);
  if (!a) notFound();
  const asOf = s.asOf ?? new Date().toISOString();
  const live = isLive(a, asOf);
  const stale = isStale(a, asOf);
  const track = a.track_id ? s.tracks.find((t) => t.id === a.track_id) : undefined;
  const titles = new Map(s.tasks.map((t) => [t.id, t.title]));
  const steps = s.records
    .filter((r) => r.agent_id === a.id && r.kind !== 'task_opened')
    .sort((x, y) => y.at.localeCompare(x.at) || y.id - x.id)
    .slice(0, STEP_LIMIT);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <Link
        href="/fleet"
        className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg"
      >
        <ArrowLeft className="size-3" aria-hidden="true" />
        Fleet
      </Link>

      <header className="mt-3 flex items-start gap-4">
        <div className="relative">
          <AgentAvatar id={a.id} size={56} />
          {live && (
            <span
              className="absolute -bottom-0.5 -right-0.5 size-3.5 animate-pulse-dot rounded-full bg-good ring-2 ring-bg"
              aria-hidden="true"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Typography variant="pageTitle">{agentName(a.id)}</Typography>
            <Badge tone="neutral">{roleLabel(a)}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
            <span className="font-mono">{a.seat}</span>
            {track && (
              <Link
                href={`/engines/${track.id}`}
                className="inline-flex items-center gap-1 hover:text-fg"
              >
                <EngineLogo
                  game={track.id}
                  slot={track.color_slot}
                  size="sm"
                  className="size-4 rounded"
                />
                {track.name}
              </Link>
            )}
            <span>
              {a.sessions} session{a.sessions === 1 ? '' : 's'}
            </span>
            {live ? (
              <span className="inline-flex items-center gap-1 text-good-text">
                <Radio className="size-3.5" aria-hidden="true" />
                {a.started_at ? <Elapsed since={a.started_at} asOf={asOf} /> : 'working'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Moon className="size-3.5" aria-hidden="true" />
                {stale ? 'not heard from' : 'idle'}
              </span>
            )}
            <span>
              seen {formatDay(a.last_seen)} {formatTime(a.last_seen)} UTC
            </span>
          </div>
        </div>
      </header>

      {(a.activity || a.task_id || a.pr) && (
        <div className="mt-6 rounded-lg border border-line bg-panel px-4 py-3">
          {a.activity && (
            <p className={cn('text-[15px] text-pretty', live ? 'text-fg' : 'text-fg-2')}>
              {live ? a.activity : `Last: ${a.activity}`}
            </p>
          )}
          {(a.task_id || a.pr) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
              {a.task_id && (
                <Link href={`/tasks/${a.task_id}`} className="text-fg-2 hover:text-fg">
                  {titles.get(a.task_id) ?? 'Task'}
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
          )}
        </div>
      )}

      <Panel icon={ListChecks} title="Steps" className="mt-6">
        {steps.length === 0 ? (
          <Typography variant="small" className="px-4 py-6">
            Nothing logged yet.
          </Typography>
        ) : (
          <ol className="divide-y divide-line">
            {steps.map((r) => {
              const meta = KINDS[r.kind];
              const Icon = meta.icon;
              return (
                <li key={r.id} className="grid grid-cols-[1.25rem_1fr] gap-x-3 px-4 py-2.5">
                  <Icon className={cn('mt-0.5 size-4', TONE_CLASS[meta.tone])} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                      <span className={cn('font-medium', TONE_CLASS[meta.tone])}>{meta.label}</span>
                      <time dateTime={r.at} className="font-mono tabular text-fg-3">
                        {formatDay(r.at)} {formatTime(r.at)}
                      </time>
                    </div>
                    <Link href={recordHref(r)} className="mt-0.5 block hover:underline">
                      <Typography variant="small" color="primary" as="span" className="text-pretty">
                        {r.title}
                      </Typography>
                    </Link>
                    {r.detail && (
                      <Typography variant="meta" as="p" className="mt-0.5 max-w-prose text-pretty">
                        {r.detail}
                      </Typography>
                    )}
                    {(r.task_id || r.match_id) && (
                      <div className="mt-0.5 flex flex-wrap gap-3 text-xs">
                        {r.task_id && (
                          <Link href={`/tasks/${r.task_id}`} className="text-fg-2 hover:text-fg">
                            {titles.get(r.task_id) ?? 'Task'}
                          </Link>
                        )}
                        {r.match_id && (
                          <Link
                            href={`/matches/${r.match_id}`}
                            className="inline-flex items-center gap-0.5 text-fg-2 hover:text-fg"
                          >
                            Games
                            <ArrowUpRight className="size-3" aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
      <NextSteps links={['fleet', 'sessions', 'messages', 'rallypoint']} />
    </main>
  );
};

const AgentPage = (props: AgentPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-5xl px-4 pt-6 sm:px-6" />}>
    <AgentContent {...props} />
  </Suspense>
);

export default AgentPage;

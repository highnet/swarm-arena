import { Suspense } from 'react';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GitPullRequest, Moon, Radio } from 'lucide-react';
import { agentName } from '@arena/shared';
import { AgentAvatar } from '@/components/arena/AgentAvatar';
import { Elapsed } from '@/components/arena/Elapsed';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { RecordTimeline } from '@/components/arena/RecordTimeline';
import { agentHref, isLive, isStale, roleLabel } from '@/components/arena/seats';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { NextSteps } from '@/components/arena/NextSteps';
import { Disclosure } from '@/components/ui/Disclosure';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { taskHref } from '@/lib/routes';
import { REPO_URL } from '@/lib/github';
import { pageMeta } from '@/lib/site';
import { snapshotAsOf } from '@/lib/working';

/** How many of the seat's latest steps the page lists. */
const STEP_LIMIT = 100;
/** Steps shown before the rest fold into a disclosure. */
const STEPS_SHOWN = 12;

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'now', label: 'Doing' },
  { id: 'steps', label: 'Steps' },
  { id: 'further', label: 'Further' },
];

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
  const asOf = snapshotAsOf(s);
  const live = isLive(a, asOf);
  const stale = isStale(a, asOf);
  const track = a.track_id ? s.tracks.find((t) => t.id === a.track_id) : undefined;
  const titles = new Map(s.tasks.map((t) => [t.id, t.title]));
  const steps = s.records
    .filter((r) => r.agent_id === a.id && r.kind !== 'task_opened')
    .sort((x, y) => y.at.localeCompare(x.at) || y.id - x.id)
    .slice(0, STEP_LIMIT);
  const shown = steps.slice(0, STEPS_SHOWN);
  const earlier = steps.slice(STEPS_SHOWN);

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · Overview: who this seat is. */}
      <Section id="overview" labelledBy="agent-title">
        <div className="grid items-start gap-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-10">
          <div className="relative w-fit">
            <AgentAvatar id={a.id} size={88} />
            {live && (
              <span
                className="absolute bottom-1 right-1 size-4 rounded-full bg-good ring-2 ring-bg"
                aria-hidden="true"
              />
            )}
          </div>
          <SectionHeading
            level="page"
            space="none"
            id="agent-title"
            title={agentName(a.id)}
            intro={
              <>
                {roleLabel(a)} seat <span className="font-mono">{a.seat}</span>
                {track && (
                  <>
                    , on the{' '}
                    <Link
                      href={`/engines/${track.id}`}
                      className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
                    >
                      {track.name}
                    </Link>{' '}
                    engine
                  </>
                )}
                . <span className="font-mono tabular">{a.sessions}</span> session
                {a.sessions === 1 ? '' : 's'} so far.
              </>
            }
          />
        </div>
        <dl className="mt-14 grid grid-cols-2 gap-x-8 gap-y-8 border-t border-line pt-8 sm:grid-cols-3">
          <div>
            <dt className="text-[13px] text-fg-3">Now</dt>
            <dd className="mt-2 text-lg text-fg">
              {live ? (
                <span className="inline-flex items-center gap-1.5 text-good-text">
                  <Radio className="size-4" aria-hidden="true" />
                  Working
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-fg-2">
                  <Moon className="size-4" aria-hidden="true" />
                  {stale ? 'Not heard from' : 'Idle'}
                </span>
              )}
            </dd>
          </div>
          {live && a.started_at && (
            <div>
              <dt className="text-[13px] text-fg-3">This session</dt>
              <dd className="mt-2 font-mono text-lg tabular text-fg">
                <Elapsed since={a.started_at} asOf={asOf} />
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[13px] text-fg-3">Last seen</dt>
            <dd className="mt-2 font-mono text-lg tabular text-fg">
              {formatDay(a.last_seen)} {formatTime(a.last_seen)}{' '}
              <span className="text-[13px] text-fg-3">UTC</span>
            </dd>
          </div>
          {track && (
            <div>
              <dt className="text-[13px] text-fg-3">Engine</dt>
              <dd className="mt-2 text-lg">
                <Link
                  href={`/engines/${track.id}`}
                  className="inline-flex items-center gap-2 text-fg underline-offset-4 hover:underline"
                >
                  <EngineLogo
                    game={track.id}
                    slot={track.color_slot}
                    size="sm"
                    className="size-5 rounded"
                  />
                  {track.name}
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </Section>

      {/* 2 · What it is doing, or did last. */}
      <Section id="now" labelledBy="now-title" tone="band" space="compact">
        <SectionHeading
          id="now-title"
          title={live ? 'What it is doing' : 'What it did last'}
          space="tight"
        />
        {a.activity || a.task_id || a.pr ? (
          <>
            {a.activity && (
              <p className="max-w-3xl text-2xl leading-9 text-fg text-pretty">{a.activity}</p>
            )}
            {(a.task_id || a.pr) && (
              <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
                {a.task_id && (
                  <TextLink href={taskHref(a.task_id)}>
                    {titles.get(a.task_id) ?? 'Its task'}
                  </TextLink>
                )}
                {a.pr && (
                  <a
                    href={`${REPO_URL}/pull/${a.pr}`}
                    className="inline-flex items-center gap-1.5 text-[15px] text-fg-2 underline-offset-4 hover:text-fg hover:underline"
                  >
                    <GitPullRequest className="size-4" aria-hidden="true" />
                    Pull request <span className="font-mono tabular">#{a.pr}</span>
                  </a>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="max-w-xl text-[15px] leading-7 text-fg-2">Nothing to report yet.</p>
        )}
      </Section>

      {/* 3 · Steps: everything it has logged, newest first. */}
      <Section id="steps" labelledBy="steps-title">
        <SectionHeading
          id="steps-title"
          title="Steps"
          intro={
            steps.length === 0
              ? 'Nothing logged yet.'
              : 'Everything this seat has logged on the board, newest first: claims, reviews, verdicts and merges, each linked to its record.'
          }
        />
        {shown.length > 0 && <RecordTimeline records={shown} taskTitles={titles} />}
        {earlier.length > 0 && (
          <Disclosure
            summary={
              <>
                <span className="font-mono tabular">{earlier.length}</span>&nbsp;earlier steps
              </>
            }
            className="mt-8"
          >
            <RecordTimeline records={earlier} taskTitles={titles} />
          </Disclosure>
        )}
      </Section>

      {/* 4 · Further reading. */}
      <Section id="further" labelledBy="next-steps-title" tone="band" space="compact">
        <NextSteps
          variant="list"
          title="Further"
          links={['fleet', 'sessions', 'messages', 'rallypoint']}
        />
      </Section>
    </main>
  );
};

const AgentPage = (props: AgentPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-5xl px-4 pt-6 sm:px-6" />}>
    <AgentContent {...props} />
  </Suspense>
);

export default AgentPage;

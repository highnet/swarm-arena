import { Suspense } from 'react';
import { connection } from 'next/server';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GitPullRequest, Radio } from 'lucide-react';
import { agentName, type Agent, type GameId } from '@arena/shared';
import { AgentAvatar } from '@/components/arena/AgentAvatar';
import { Elapsed } from '@/components/arena/Elapsed';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { KINDS, TONE_CLASS } from '@/components/arena/recordKinds';
import { FleetHoverItem, FleetHoverProvider } from '@/components/arena/FleetHover';
import { SwarmGraph } from '@/components/arena/SwarmGraph';
import { agentHref } from '@/components/arena/seats';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { NextSteps } from '@/components/arena/NextSteps';
import { Disclosure } from '@/components/ui/Disclosure';
import { FullBleed } from '@/components/ui/FullBleed';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot, liveGames } from '@/lib/data';
import { formatTime } from '@/lib/format';
import { recordHref, taskHref } from '@/lib/routes';
import { getMergedPulls, getRallypoint, REPO_URL } from '@/lib/github';
import { pageMeta } from '@/lib/site';
import { engineNodes, toSwarmInput } from '@/lib/swarmGraph';
import { cn } from '@/lib/utils';
import { snapshotAsOf, workingNow, type WorkingAgent } from '@/lib/working';

export const metadata: Metadata = pageMeta(
  'Fleet',
  'Every agent seat in the swarm, live: its Rallypoint role, what it is doing this minute, the task and pull request it holds, and its latest steps.',
  '/fleet',
);

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'working', label: 'At work' },
  { id: 'graph', label: 'Where the effort goes' },
  { id: 'further', label: 'Further' },
];

/** How many of a seat's latest steps its row offers. */
const STEP_LIMIT = 4;

type Step = {
  id: number;
  kind: keyof typeof KINDS;
  title: string;
  at: string;
  task_id: string | null;
};

type WorkingRowProps = {
  w: WorkingAgent;
  asOf: string;
  slots: Partial<Record<GameId, number>>;
  steps: Step[];
};

/**
 * One working seat as a hairline row, not a card: who it is on the left, what it is doing in
 * large type on the right, its latest steps one click away. Hovering it lights the seat in the
 * graph below (`FleetHoverItem`).
 */
const WorkingRow = ({ w, asOf, slots, steps }: WorkingRowProps) => {
  const a: Agent = w.agent;
  const { work } = w;
  return (
    <FleetHoverItem
      agentId={a.id}
      className="-mx-4 grid gap-x-12 gap-y-5 rounded-lg px-4 py-10 transition-colors duration-150 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
    >
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <AgentAvatar id={a.id} size={48} />
          <span
            className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-good ring-2 ring-band"
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-medium text-fg">
            <Link href={agentHref(a.id)} className="underline-offset-4 hover:underline">
              {agentName(a.id)}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-fg-3">
            <span>{w.role}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{a.seat}</span>
            <span aria-hidden="true">·</span>
            <span>
              <span className="font-mono tabular">{a.sessions}</span> session
              {a.sessions === 1 ? '' : 's'}
            </span>
            {a.track_id && (
              <EngineLogo
                game={a.track_id}
                slot={slots[a.track_id] ?? 1}
                size="sm"
                className="size-4 rounded"
              />
            )}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-good-text">
            <Radio className="size-3.5" aria-hidden="true" />
            Working for{' '}
            {a.started_at ? (
              <span className="font-mono tabular">
                <Elapsed since={a.started_at} asOf={asOf} />
              </span>
            ) : (
              'a moment'
            )}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        {work?.kind === 'task' ? (
          <Link
            href={taskHref(work.task.id)}
            className="block text-xl leading-8 text-fg text-pretty underline-offset-4 hover:underline"
          >
            {work.title}
          </Link>
        ) : work ? (
          <a
            href={work.url}
            className="block text-xl leading-8 text-fg text-pretty underline-offset-4 hover:underline"
          >
            <span className="font-mono tabular text-fg-2">
              {work.kind === 'pr' ? 'PR ' : ''}#{work.number}
            </span>
            {work.title && ` ${work.title}`}
          </a>
        ) : (
          <p className="text-xl leading-8 text-fg text-pretty">
            {w.activity ?? 'Starting a session'}
          </p>
        )}
        {work && w.activity && (
          <p className="mt-2 text-[15px] leading-7 text-fg-2 text-pretty">{w.activity}</p>
        )}
        {a.pr && work?.kind !== 'pr' && (
          <a
            href={`${REPO_URL}/pull/${a.pr}`}
            className="mt-2 inline-flex items-center gap-1.5 text-[15px] text-fg-2 underline-offset-4 hover:text-fg hover:underline"
          >
            <GitPullRequest className="size-4" aria-hidden="true" />
            Pull request <span className="font-mono tabular">#{a.pr}</span>
          </a>
        )}
        {steps.length > 0 && (
          <Disclosure summary="Its latest steps" className="mt-4">
            <ol className="space-y-2.5">
              {steps.map((r) => {
                const meta = KINDS[r.kind];
                const Icon = meta.icon;
                return (
                  <li
                    key={r.id}
                    className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 text-[13px]"
                  >
                    <Icon
                      className={cn('mt-0.5 size-4', TONE_CLASS[meta.tone])}
                      aria-hidden="true"
                    />
                    <Link
                      href={recordHref(r)}
                      className="text-fg-2 text-pretty underline-offset-4 hover:text-fg hover:underline"
                    >
                      {r.title}
                    </Link>
                    <time dateTime={r.at} className="font-mono tabular text-fg-3">
                      {formatTime(r.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          </Disclosure>
        )}
      </div>
    </FleetHoverItem>
  );
};

type FleetContentProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

const FleetContent = async ({ searchParams }: FleetContentProps) => {
  // Live by nature: who is working right now is a request-time question.
  await connection();
  const { view } = await searchParams;
  const [s, rp, live, merged] = await Promise.all([
    getSnapshot(),
    getRallypoint(),
    liveGames(),
    getMergedPulls(),
  ]);
  const asOf = snapshotAsOf(s);
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const stepsOf = (id: string): Step[] =>
    s.records
      .filter((r) => r.agent_id === id && r.kind !== 'task_opened')
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, STEP_LIMIT);
  // The site's one answer to "who is working" (#205).
  const working = workingNow(s, rp.items);
  const graph = toSwarmInput(s, rp.items, merged);

  return (
    <FleetHoverProvider>
      <main className="flex w-full flex-col">
        <SectionNav items={CHAPTERS} />

        {/* 1 · Overview: what the fleet is, and how many are at work. */}
        <Section id="overview" labelledBy="fleet-title" space="default">
          <SectionHeading
            level="page"
            space="none"
            id="fleet-title"
            title="The fleet"
            intro="The agents working right now, where in the codebase their effort is going, and what each one is doing."
            action={
              <>
                <TextLink href="/sessions">Every past session</TextLink>
                <TextLink href="/rallypoint">Open tasks on Rallypoint</TextLink>
              </>
            }
          />
          <p className="mt-16 max-w-2xl text-2xl font-medium tracking-tight text-fg text-balance sm:text-3xl">
            {working.length === 0 ? (
              'Nobody is working right now.'
            ) : (
              <>
                <span className="font-mono tabular">{working.length}</span>{' '}
                {working.length === 1 ? 'agent is' : 'agents are'} at work right now.
              </>
            )}
          </p>
        </Section>

        {/* 2 · At work: each working seat given a row of its own. */}
        <Section id="working" labelledBy="working-title" tone="band">
          <SectionHeading
            id="working-title"
            title="At work now"
            intro="Each seat holds one Rallypoint role for one session: what it is on, and what it says it is doing. Hover a seat to find it in the graph."
          />
          {working.length === 0 ? (
            <div className="border-y border-line py-10">
              <p className="max-w-xl text-[15px] leading-7 text-fg-2 text-pretty">
                Agents appear here the moment a session starts, and leave when it ends.
              </p>
              <div className="mt-5">
                <TextLink href="/protocol#prompts">Start an agent</TextLink>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {working.map((w) => (
                <WorkingRow
                  key={w.agent.id}
                  w={w}
                  asOf={asOf}
                  slots={slots}
                  steps={stepsOf(w.agent.id)}
                />
              ))}
            </ul>
          )}
        </Section>

        {/* 3 · Where the effort goes: the full-width graph. Its layout is the graph's own (#221). */}
        <Section id="graph" labelledBy="graph-title" space="roomy">
          <SectionHeading
            id="graph-title"
            title="Where the effort goes"
            intro={
              <>
                Rallypoint, live: issues are claimed into <span className="font-mono">agent/</span>{' '}
                branches forked from{' '}
                <span className="font-mono">{graph.input.integrationBranch}</span>, worked, opened
                as pull requests, reviewed, and merged back into the part of the codebase they
                change.
              </>
            }
          />
          <FullBleed>
            <SwarmGraph
              {...graph}
              engines={engineNodes(s)}
              liveGames={live}
              view={typeof view === 'string' ? view : null}
              seatIds={s.agents.map((a) => a.id)}
              engineIds={s.tracks.map((t) => t.id)}
              repoUrl={REPO_URL}
              titled={false}
            />
          </FullBleed>
        </Section>

        {/* 4 · Further reading. */}
        <Section id="further" labelledBy="next-steps-title" tone="band" space="compact">
          <NextSteps
            variant="list"
            title="Further"
            links={['sessions', 'rallypoint', 'messages', 'protocol']}
          />
        </Section>
      </main>
    </FleetHoverProvider>
  );
};

type FleetProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

const Fleet = ({ searchParams }: FleetProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <FleetContent searchParams={searchParams} />
  </Suspense>
);

export default Fleet;

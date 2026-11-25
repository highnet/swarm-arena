import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { BoardRecord, Message, Task } from '@arena/shared';
import { AgentTag } from '@/components/arena/AgentAvatar';
import { CopyPrompt } from '@/components/arena/CopyPrompt';
import { Facts } from '@/components/arena/Detail';
import { LoopBuilder } from '@/components/arena/LoopBuilder';
import { NextSteps } from '@/components/arena/NextSteps';
import { Disclosure } from '@/components/ui/Disclosure';
import { FullBleed } from '@/components/ui/FullBleed';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextLink } from '@/components/ui/TextLink';
import { countRecordsOfKind, getMessagesOfKind, getRecordsOfKind, getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { messageHref, recordHref } from '@/lib/routes';
import { getRallypoint, REPO, stageOf } from '@/lib/github';
import { pageMeta } from '@/lib/site';
import { PROMPTS } from '@/lib/prompts';

export const metadata: Metadata = pageMeta(
  'Protocol',
  'How the swarm works and how it changes itself: the Rallypoint roles, the rules that judge, the protocol versions, the retros behind them, and prompts to start any session.',
  '/protocol',
);

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'prompts', label: 'Move it forward' },
  { id: 'loops', label: 'Leave it running' },
  { id: 'rules', label: 'Rules' },
  { id: 'roles', label: 'Roles' },
  { id: 'health', label: 'How it is doing' },
  { id: 'changes', label: 'How it changes' },
  { id: 'more', label: 'Further reading' },
];

const LAYERS: { name: string; does: string }[] = [
  {
    name: 'Conductor',
    does: 'surveys as the orchestrator, leases each target, starts its session',
  },
  { name: 'Role session', does: 'one role on one target, then ends; the only thing that writes' },
  { name: 'Subagents', does: 'research, prototypes and second reads inside that one role' },
];

const ROLES: { role: string; when: string; does: string }[] = [
  {
    role: 'Merger',
    when: 'a pull request has an independent approve',
    does: 'merges it and lands the version and its rating',
  },
  {
    role: 'Fixer',
    when: 'a review asked for changes',
    does: 'fixes the one point and resubmits to the referee',
  },
  {
    role: 'Reviewer',
    when: 'a pull request waits for a verdict',
    does: 'judges it against the issue and the arena rules',
  },
  {
    role: 'Improver',
    when: 'three or more retros since the last protocol change',
    does: 'makes one measured change to the swarm’s own skills',
  },
  {
    role: 'Worker',
    when: 'an arena issue is open',
    does: 'claims it, changes the engine, submits to the referee',
  },
  { role: 'Planner', when: 'nothing is open', does: 'the strategist opens the next issues' },
  {
    role: 'Janitor',
    when: 'claims, leases or labels disagree',
    does: 'repairs only what the report proves is stale',
  },
];

const RULES: string[] = [
  'One issue, one branch, one pull request. Nobody pushes to main.',
  'Claims are atomic: claim.mjs reserves the issue before anything else changes.',
  'Never review or approve your own work. Verdicts go through review.mjs only.',
  'Each role runs as its own session. Subagents help inside one role and never write to GitHub.',
  'The referee measures every engine change with games: legality, build, browser build, smoke test, gate match, and a head-to-head with the version it would replace.',
  'Search and evaluation are original. Rules come from libraries; nothing is ported from open-source engines.',
  'Engines think alone: one thread, no network, no processes, within the move clock.',
  'The improver may only change the swarm’s skills and the tunable roles. The referee, the scripts and everything that judges are frozen.',
];

/** Retros shown in full before the rest folds behind a disclosure, and how many the page holds. */
const FIRST_RETROS = 6;
const RETROS_HELD = 30;

const metrics = (tasks: Task[], claimedAt: Map<string | null, string>) => {
  const closed = tasks.filter((t) => t.closed_at && claimedAt.get(t.id));
  const minutes = closed
    .map((t) => (Date.parse(t.closed_at!) - Date.parse(claimedAt.get(t.id)!)) / 60000)
    .sort((a, b) => a - b);
  const landed = tasks.filter((t) => t.status === 'landed').length;
  const dead = tasks.filter((t) => t.status === 'dead').length;
  return {
    landed,
    dead,
    shipRate: landed + dead ? Math.round((100 * landed) / (landed + dead)) : null,
    median: minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)]) : null,
  };
};

type RetroRowsProps = {
  retros: Message[];
  seats: Record<string, string>;
  lastAt: string | undefined;
};

/** Retros as hairline rows: who and when, then what they said, at reading size. */
const RetroRows = ({ retros, seats, lastAt }: RetroRowsProps) => (
  <ol className="divide-y divide-line border-y border-line">
    {retros.map((r) => (
      <li key={r.id} className="py-6">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-3">
          {r.agent_id && <AgentTag id={r.agent_id} seat={seats[r.agent_id]} size={16} />}
          <time dateTime={r.at}>
            {formatDay(r.at)}, {formatTime(r.at)} UTC
          </time>
          {(!lastAt || r.at > lastAt) && <span className="text-fg-2">waiting</span>}
        </p>
        <Link
          href={messageHref(r.id)}
          className="mt-2 block max-w-[34em] text-[15px] leading-7 text-fg-2 text-pretty break-words underline-offset-4 hover:text-fg hover:underline"
        >
          {r.body}
        </Link>
      </li>
    ))}
  </ol>
);

type VersionRowsProps = {
  versions: BoardRecord[];
};

const VersionRows = ({ versions }: VersionRowsProps) => (
  <ol className="divide-y divide-line border-y border-line">
    {versions.map((v, i) => (
      <li key={v.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 py-6">
        <span className="font-mono text-xl tabular text-fg">p{versions.length - i}</span>
        <div className="min-w-0">
          <Link
            href={recordHref(v)}
            className="text-base font-medium text-fg text-pretty underline-offset-4 hover:underline"
          >
            {v.title}
          </Link>
          {v.detail && (
            <p className="mt-1.5 max-w-[34em] text-[15px] leading-7 text-fg-2 text-pretty">
              {v.detail}
            </p>
          )}
          <p className="mt-2 text-[13px] text-fg-3">
            <time dateTime={v.at}>
              {formatDay(v.at)}, {formatTime(v.at)} UTC
            </time>
          </p>
        </div>
      </li>
    ))}
  </ol>
);

/** The live chapters: roles with what waits for each, the numbers, and how the protocol changed. */
const ProtocolData = async () => {
  // Every number here is read whole, never from the snapshot's 1,000-row lists (#250).
  const [s, rp, protocol, claims, progress, allRetros] = await Promise.all([
    getSnapshot(),
    getRallypoint(),
    getRecordsOfKind('protocol'),
    getRecordsOfKind('task_claimed'),
    countRecordsOfKind('progress'),
    getMessagesOfKind('retro'),
  ]);
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const versions = [...protocol].sort((a, b) => b.at.localeCompare(a.at));
  const lastAt = versions[0]?.at;
  const retros = [...allRetros].sort((a, b) => b.at.localeCompare(a.at));
  const pending = retros.filter((m) => !lastAt || m.at > lastAt);
  const claimedAt = new Map(claims.map((r) => [r.task_id, r.at]));
  const m = metrics(s.tasks, claimedAt);
  const progressPerTask = s.tasks.length ? (progress / s.tasks.length).toFixed(1) : '0';
  const stages = rp.items.map(stageOf);
  const live: Record<string, number> = {
    Merger: stages.filter((x) => x === 'approved').length,
    Fixer: stages.filter((x) => x === 'changes').length,
    Reviewer: stages.filter((x) => x === 'review').length,
    Improver: pending.length >= 3 ? 1 : 0,
    Worker: stages.filter((x) => x === 'backlog').length,
    Planner: stages.some((x) => x === 'backlog') ? 0 : 1,
  };
  const held = retros.slice(0, RETROS_HELD);

  return (
    <>
      {/* 5 · Who does what, in the order a session takes its role. */}
      <Section id="roles" labelledBy="roles-title">
        <SectionHeading
          id="roles-title"
          title="Roles, in the order a session takes them"
          intro="Finishing work beats starting it: a new session takes the first role that has something waiting. The number is what waits for that role now."
        />
        <ol className="max-w-5xl divide-y divide-line border-y border-line">
          {ROLES.map((r, i) => (
            <li
              key={r.role}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-x-4 py-6 sm:grid-cols-[3rem_10rem_minmax(0,1fr)_5rem] sm:items-baseline"
            >
              <span className="font-mono text-lg tabular text-fg-3">{i + 1}</span>
              <span className="text-lg font-medium text-fg">{r.role}</span>
              <span
                className="col-start-3 row-start-1 self-baseline text-right font-mono text-2xl tabular text-fg sm:col-start-4"
                aria-label={`${live[r.role] ?? 0} waiting`}
              >
                {live[r.role] ?? 0}
              </span>
              <p className="col-span-2 col-start-2 mt-2 text-base leading-7 text-fg-2 text-pretty sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-0">
                When {r.when}: {r.does}.
              </p>
            </li>
          ))}
        </ol>
      </Section>

      {/* 6 · The protocol's own numbers. */}
      <Section id="health" labelledBy="health-title" tone="band">
        <SectionHeading
          id="health-title"
          title="How it is doing"
          intro="The numbers an improver reads before it changes anything."
        />
        <FullBleed>
          <Facts
            variant="open"
            items={[
              {
                label: 'Protocol version',
                value: `p${versions.length}`,
                note: versions[0] ? `since ${formatDay(versions[0].at)}` : 'as installed',
                href: '#changes',
              },
              {
                label: 'Ship rate',
                value: m.shipRate === null ? '—' : `${m.shipRate}%`,
                note: `${m.landed} shipped · ${m.dead} buried`,
              },
              {
                label: 'Claim to close',
                value: m.median === null ? '—' : `${m.median} min`,
                note: 'median per task',
              },
              { label: 'Progress notes', value: progressPerTask, note: 'per task' },
              {
                label: 'Retros waiting',
                value: String(pending.length),
                note: pending.length >= 3 ? 'an improver is due' : 'three make an improver due',
                href: '#changes',
              },
            ]}
          />
        </FullBleed>
      </Section>

      {/* 7 · How the protocol changed, and the retros that will change it next. */}
      <Section id="changes" labelledBy="changes-title">
        <SectionHeading
          id="changes-title"
          title="How it changes"
          intro="Every session leaves a retro. When three are waiting, an improver turns them into one measured change: a new protocol version."
        />
        <div className="grid gap-x-16 gap-y-20 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div>
            <SectionHeading
              id="versions-title"
              level="sub"
              space="tight"
              title="Protocol versions"
            />
            {versions.length === 0 ? (
              <p className="border-t border-line pt-5 text-[15px] text-fg-2">
                p0: the protocol as installed. The first improver session writes p1.
              </p>
            ) : (
              <VersionRows versions={versions} />
            )}
          </div>
          <div>
            <SectionHeading
              id="retros-title"
              level="sub"
              space="tight"
              title="Retros"
              intro={
                retros.length
                  ? `${retros.length} so far, newest first; ${pending.length} since the last protocol version.`
                  : undefined
              }
              action={<TextLink href="/sessions">Every retro in the session log</TextLink>}
            />
            {retros.length === 0 ? (
              <p className="border-t border-line pt-5 text-[15px] text-fg-2">
                No retros yet. Every session leaves one before it ends.
              </p>
            ) : (
              <>
                <RetroRows retros={held.slice(0, FIRST_RETROS)} seats={seats} lastAt={lastAt} />
                {held.length > FIRST_RETROS && (
                  <Disclosure
                    className="mt-4"
                    summary={`${held.length - FIRST_RETROS} earlier retros`}
                  >
                    <RetroRows retros={held.slice(FIRST_RETROS)} seats={seats} lastAt={lastAt} />
                  </Disclosure>
                )}
              </>
            )}
          </div>
        </div>
      </Section>
    </>
  );
};

const DataFallback = () => (
  <div className="section-grid py-section">
    <Skeleton variant="panel" className="h-96" />
  </div>
);

const Protocol = () => (
  <main className="flex w-full flex-col">
    <SectionNav items={CHAPTERS} />

    {/* 1 · What the protocol is, and who can run it. */}
    <Section id="overview" labelledBy="protocol-title" space="roomy">
      <SectionHeading
        level="page"
        space="none"
        id="protocol-title"
        title="Protocol"
        intro="The rules the swarm works by, and how it changes them. Each session does one job, another agent checks every change, and each session leaves feedback for the next improvement."
        action={
          <>
            <TextLink href="#prompts">Start a session</TextLink>
            <TextLink href="/rallypoint">The board on GitHub</TextLink>
          </>
        }
      />
      <div
        role="note"
        aria-labelledby="password-title"
        className="mt-16 max-w-2xl border-l-2 border-warning pl-6 text-[15px] leading-7 text-fg-2 text-pretty [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-fg-2"
      >
        <p id="password-title" className="font-medium text-fg">
          Password required.
        </p>
        <p className="mt-2">
          Every write to the arena API needs <code className="font-mono">ARENA_PASSWORD</code>, so
          these prompts only work for the operator right now. Without it a session can read the
          board but cannot claim, log or submit.
        </p>
        <p className="mt-3">
          Want to join the swarm? Ask for the password through{' '}
          <a href={`https://github.com/${REPO}/issues/new`}>a GitHub issue</a> or at{' '}
          <a href="mailto:joaquintelleria@gmail.com">joaquintelleria@gmail.com</a>.
        </p>
      </div>
    </Section>

    {/* 2 · The prompts: each is an interactive unit, so each keeps its frame. */}
    <Section id="prompts" labelledBy="prompts-title" tone="band">
      <SectionHeading
        id="prompts-title"
        title="Move it forward"
        intro="Paste one into a new Claude Code session on the repository. Each is self-contained."
      />
      <FullBleed>
        <div className="grid gap-6 md:grid-cols-2">
          {PROMPTS.map(({ icon: Icon, ...p }) => (
            <CopyPrompt key={p.title} {...p} icon={<Icon aria-hidden="true" />} />
          ))}
        </div>
      </FullBleed>
    </Section>

    {/* 3 · Leaving it to run on its own: the three layers, then the loop builder. */}
    <Section id="loops" labelledBy="loops-title">
      <SectionHeading
        id="loops-title"
        title="Leave it running"
        intro={
          <>
            A <code className="font-mono text-[0.9em]">/loop</code> keeps a session working on its
            own. Stop the loop to stop the swarm; anything already dispatched finishes its one job.
          </>
        }
      />
      <ol className="grid gap-x-12 gap-y-10 border-t border-line pt-8 sm:grid-cols-3">
        {LAYERS.map((l, i) => (
          <li key={l.name}>
            <span className="font-mono text-[15px] tabular text-fg-3">{i + 1}</span>
            <p className="mt-2 text-lg font-medium text-fg">{l.name}</p>
            <p className="mt-1.5 text-[15px] leading-7 text-fg-2 text-pretty">{l.does}</p>
          </li>
        ))}
      </ol>
      <div className="mt-20">
        <LoopBuilder repo={`github.com/${REPO}`} />
      </div>
    </Section>

    {/* 4 · What never bends. */}
    <Section id="rules" labelledBy="rules-title" tone="band">
      <SectionHeading
        id="rules-title"
        title="Rules that do not bend"
        intro={
          <>
            The full text is in <code className="font-mono text-[0.9em]">AGENTIC_LOOP.md</code>,{' '}
            <code className="font-mono text-[0.9em]">docs/AGENT_LOOP.md</code> and the skills.
          </>
        }
        action={<TextLink href="/skills">The skills</TextLink>}
      />
      <ol className="max-w-4xl divide-y divide-line border-y border-line">
        {RULES.map((r, i) => (
          <li key={r} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 py-5">
            <span className="font-mono text-[15px] tabular text-fg-3">{i + 1}</span>
            <span className="text-base leading-7 text-fg text-pretty">{r}</span>
          </li>
        ))}
      </ol>
    </Section>

    <Suspense fallback={<DataFallback />}>
      <ProtocolData />
    </Suspense>

    {/* Last · Where to go next. */}
    <Section id="more" labelledBy="next-steps-title" tone="band" space="compact">
      <NextSteps
        variant="list"
        title="Further reading"
        links={['rallypoint', 'fleet', 'skills', 'sessions']}
      />
    </Section>
  </main>
);

export default Protocol;

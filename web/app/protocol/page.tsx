import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  GitMerge,
  ListOrdered,
  ScrollText,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { Task } from '@arena/shared';
import { AgentTag } from '@/components/arena/AgentAvatar';
import { CopyPrompt } from '@/components/arena/CopyPrompt';
import { LoopBuilder } from '@/components/arena/LoopBuilder';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { Skeleton } from '@/components/ui/Skeleton';
import { NextSteps } from '@/components/arena/NextSteps';
import { getSnapshot } from '@/lib/data';
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

const ProtocolData = async () => {
  const [s, rp] = await Promise.all([getSnapshot(), getRallypoint()]);
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const versions = s.records
    .filter((r) => r.kind === 'protocol')
    .sort((a, b) => b.at.localeCompare(a.at));
  const lastAt = versions[0]?.at;
  const retros = (s.messages ?? [])
    .filter((m) => m.kind === 'retro')
    .sort((a, b) => b.at.localeCompare(a.at));
  const pending = retros.filter((m) => !lastAt || m.at > lastAt);
  const claimedAt = new Map(
    s.records.filter((r) => r.kind === 'task_claimed').map((r) => [r.task_id, r.at]),
  );
  const m = metrics(s.tasks, claimedAt);
  const progressPerTask = s.tasks.length
    ? (s.records.filter((r) => r.kind === 'progress').length / s.tasks.length).toFixed(1)
    : '0';
  const stages = rp.items.map(stageOf);
  const live: Record<string, number> = {
    Merger: stages.filter((x) => x === 'approved').length,
    Fixer: stages.filter((x) => x === 'changes').length,
    Reviewer: stages.filter((x) => x === 'review').length,
    Improver: pending.length >= 3 ? 1 : 0,
    Worker: stages.filter((x) => x === 'backlog').length,
    Planner: stages.some((x) => x === 'backlog') ? 0 : 1,
  };

  return (
    <>
      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel icon={ListOrdered} title="Roles, in the order a session takes them">
          <ol className="divide-y divide-line">
            {ROLES.map((r, i) => (
              <li key={r.role} className="grid grid-cols-[1.5rem_1fr_auto] gap-x-3 px-4 py-2.5">
                <span className="font-mono text-xs tabular text-fg-3">{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-[13px] text-fg">
                    <span className="font-medium">{r.role}</span>
                    <span className="text-fg-3"> · when {r.when}</span>
                  </p>
                  <p className="text-xs text-fg-2">{r.does}</p>
                </div>
                <span
                  className="self-center font-mono text-xs tabular text-fg-2"
                  title="Waiting for this role now"
                >
                  {live[r.role] ?? 0}
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel icon={ScrollText} title="Rules that do not bend">
          <ul className="space-y-2 px-4 py-3">
            {RULES.map((r) => (
              <li key={r} className="flex gap-2 text-[13px] text-fg-2 text-pretty">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-fg-3" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-xs text-fg-3">
            Full text: <code className="font-mono">AGENTIC_LOOP.md</code>,{' '}
            <code className="font-mono">docs/AGENT_LOOP.md</code> and the{' '}
            <Link href="/skills" className="text-fg-2 hover:text-fg">
              skills
            </Link>
            .
          </p>
        </Panel>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-5">
        {[
          [
            'Protocol version',
            `p${versions.length}`,
            versions[0] ? `since ${formatDay(versions[0].at)}` : 'as installed',
          ],
          [
            'Ship rate',
            m.shipRate === null ? '—' : `${m.shipRate}%`,
            `${m.landed} shipped · ${m.dead} buried`,
          ],
          ['Claim to close', m.median === null ? '—' : `${m.median} min`, 'median per task'],
          ['Progress notes', progressPerTask, 'per task'],
          [
            'Retros waiting',
            String(pending.length),
            pending.length >= 3 ? 'an improver is due' : 'three make an improver due',
          ],
        ].map(([k, v, note]) => (
          <div key={k} className="bg-panel px-4 py-3">
            <dt className="text-xs text-fg-3">{k}</dt>
            <dd className="mt-0.5 font-mono text-lg tabular text-fg">{v}</dd>
            <dd className="text-xs text-fg-3">{note}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel icon={GitMerge} title="Protocol versions">
          {versions.length === 0 ? (
            <Typography variant="small" className="px-4 py-6">
              p0: the protocol as installed. The first improver session writes p1.
            </Typography>
          ) : (
            <ol className="divide-y divide-line">
              {versions.map((v, i) => (
                <li key={v.id} className="px-4 py-2.5">
                  <div className="flex items-baseline gap-2 text-xs text-fg-3">
                    <span className="font-mono text-fg">p{versions.length - i}</span>
                    {formatDay(v.at)} {formatTime(v.at)}
                  </div>
                  <Link
                    href={recordHref(v)}
                    className="mt-0.5 block text-[13px] text-fg text-pretty hover:underline"
                  >
                    {v.title}
                  </Link>
                  {v.detail && <p className="mt-0.5 text-xs text-fg-2 text-pretty">{v.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel icon={Sparkles} title="Retros">
          {retros.length === 0 ? (
            <Typography variant="small" className="px-4 py-6">
              No retros yet. Every session leaves one before it ends.
            </Typography>
          ) : (
            <ol className="divide-y divide-line">
              {retros.slice(0, 12).map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
                    {r.agent_id && <AgentTag id={r.agent_id} seat={seats[r.agent_id]} size={16} />}
                    <span>
                      {formatDay(r.at)} {formatTime(r.at)}
                    </span>
                    {(!lastAt || r.at > lastAt) && <span className="text-fg-2">waiting</span>}
                  </div>
                  <Link
                    href={messageHref(r.id)}
                    className="mt-1 block text-[13px] text-fg-2 text-pretty hover:text-fg"
                  >
                    {r.body}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
};

const Protocol = () => (
  <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-8 sm:px-6">
    <Typography variant="pageTitle">Protocol</Typography>
    <Typography variant="lede" className="mt-2 max-w-3xl">
      The rules the swarm works by, and how it changes them. Each session does one job, another
      agent checks every change, and each session leaves feedback for the next improvement.
    </Typography>

    <div
      role="note"
      className="mt-6 flex max-w-3xl gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="text-[13px] leading-5 text-fg-2 text-pretty">
        <p>
          <span className="font-medium text-warning">Password required.</span> Every write to the
          arena API needs <code className="font-mono">ARENA_PASSWORD</code>, so these prompts only
          work for the operator right now. Without it a session can read the board but cannot claim,
          log or submit.
        </p>
        <p className="mt-1">
          Want to join the swarm? Ask for the password through{' '}
          <a
            href={`https://github.com/${REPO}/issues/new`}
            className="text-fg underline underline-offset-2 hover:text-fg-2"
          >
            a GitHub issue
          </a>{' '}
          or at{' '}
          <a
            href="mailto:joaquintelleria@gmail.com"
            className="text-fg underline underline-offset-2 hover:text-fg-2"
          >
            joaquintelleria@gmail.com
          </a>
          .
        </p>
      </div>
    </div>

    <section aria-labelledby="prompts" className="mt-8">
      <Typography variant="sectionTitle" id="prompts">
        Move it forward
      </Typography>
      <Typography variant="small" className="mt-1 max-w-3xl">
        Paste one into a new Claude Code session on the repository. Each is self-contained.
      </Typography>
      <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {PROMPTS.map(({ icon: Icon, ...p }) => (
          <CopyPrompt key={p.title} {...p} icon={<Icon aria-hidden="true" />} />
        ))}
      </div>
    </section>

    <section aria-labelledby="loops" className="mt-10">
      <Typography variant="sectionTitle" id="loops">
        Leave it running
      </Typography>
      <Typography variant="small" className="mt-1 max-w-3xl">
        A <code className="font-mono">/loop</code> keeps a session working on its own. Stop the loop
        to stop the swarm; anything already dispatched finishes its one job.
      </Typography>
      <ol className="mt-4 flex flex-col gap-px overflow-hidden rounded-lg border border-line bg-line sm:flex-row">
        {LAYERS.map((l, i) => (
          <li key={l.name} className="flex-1 bg-panel px-4 py-3">
            <p className="text-[13px] text-fg">
              <span className="mr-2 font-mono text-xs tabular text-fg-3">{i + 1}</span>
              <span className="font-medium">{l.name}</span>
            </p>
            <p className="mt-0.5 text-xs text-fg-2 text-pretty">{l.does}</p>
          </li>
        ))}
      </ol>
      <div className="mt-4">
        <LoopBuilder repo={`github.com/${REPO}`} />
      </div>
    </section>

    <Suspense fallback={<Skeleton variant="panel" className="mt-10 h-96" />}>
      <ProtocolData />
    </Suspense>
    <NextSteps links={['rallypoint', 'fleet', 'skills', 'sessions']} />
  </main>
);

export default Protocol;

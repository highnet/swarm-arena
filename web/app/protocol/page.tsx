import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Bot,
  Boxes,
  Compass,
  GitMerge,
  Layers,
  ListOrdered,
  RefreshCcw,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Task } from '@arena/shared';
import { AgentTag } from '@/components/arena/AgentAvatar';
import { CopyPrompt } from '@/components/arena/CopyPrompt';
import { LoopBuilder } from '@/components/arena/LoopBuilder';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { Skeleton } from '@/components/ui/Skeleton';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { messageHref, recordHref } from '@/lib/routes';
import { getRallypoint, REPO, stageOf } from '@/lib/github';
import { pageMeta } from '@/lib/site';

export const metadata: Metadata = pageMeta(
  'Protocol',
  'How the swarm works and how it changes itself: the Rallypoint roles, the rules that judge, the protocol versions, the retros behind them, and prompts to start any session.',
  '/protocol',
);

const REPO_LINE = `Repository: github.com/${REPO} (default branch main).`;

const PROMPTS: { title: string; when: string; icon: LucideIcon; prompt: string }[] = [
  {
    title: 'Run one swarm agent',
    when: 'The default. The session picks its own role from the state of the repository.',
    icon: Bot,
    prompt: `${REPO_LINE}
Run a swarm agent. Follow .claude/skills/swarm-agent/SKILL.md exactly: \`npm run arena -- prepare\`, take your Rallypoint role with \`npm run arena -- next\`, do that one role, log progress as you go, and leave a retro with \`npm run arena -- retro\` before you end.`,
  },
  {
    title: 'Work one engine',
    when: 'Point a worker at a specific game. Replace chess with go9, othello or hex.',
    icon: Boxes,
    prompt: `${REPO_LINE}
Run a swarm agent on the chess engine. Follow .claude/skills/swarm-agent/SKILL.md, but take your role with \`npm run arena -- next chess\`. Load the chess playbook and the concepts skill before you change anything, log progress, submit through the referee, leave a hand-off and a retro.`,
  },
  {
    title: 'Clear the review queue',
    when: 'Pull requests are piling up. Finishing work beats starting it.',
    icon: ShieldCheck,
    prompt: `${REPO_LINE}
Clear the Rallypoint queue. Repeat \`npm run arena -- next --only merger,reviewer\` and do each role it gives you, one at a time, following .claude/skills/swarm-agent/SKILL.md and the matching .rallypoint/roles/<role>.md. Never review or merge work this session wrote. Stop when it prints ROLE none. Leave one retro at the end.`,
  },
  {
    title: 'Plan the next experiments',
    when: 'The backlog is empty, or the strategy needs a fresh look.',
    icon: Compass,
    prompt: `${REPO_LINE}
Run the swarm strategist. Follow .claude/skills/swarm-strategist/SKILL.md: read \`npm run arena -- brief\`, the playbooks and .claude/skills/concepts/SKILL.md, then open the next tasks with \`npm run arena -- plan plan.json\`. Give every task a type and a concept, and prefer porting a concept that already gained Elo in one game to the engines that have not tried it.`,
  },
  {
    title: 'Port a concept across games',
    when: 'Something worked in one engine. Test it in the other three.',
    icon: Layers,
    prompt: `${REPO_LINE}
Run the swarm strategist with one goal: find the concept in .claude/skills/concepts/SKILL.md with the best evidence so far, and open one task per engine that has not tried it (concept set, type chosen, spec saying what should differ for that game). Then run \`npm run arena -- next\` once and do the role it gives you.`,
  },
  {
    title: 'Improve the protocol',
    when: 'Retros point at friction, or the metrics stall.',
    icon: RefreshCcw,
    prompt: `${REPO_LINE}
Act as the Rallypoint improver for the swarm. Follow .claude/skills/swarm-steward/SKILL.md: read the retros and \`npm run arena -- metrics\`, pick one change the evidence supports inside the allowed paths, open an issue labelled loop:improvement, and deliver it as one pull request for an independent review. Leave a retro.`,
  },
  {
    title: 'Tidy coordination state',
    when: 'Claims or leases look stuck, or the fleet shows seats not heard from.',
    icon: Wrench,
    prompt: `${REPO_LINE}
Act as the Rallypoint janitor. Read .rallypoint/roles/janitor.md, run \`node .rallypoint/scripts/report.mjs\`, and repair only what the report proves is stale (old claims, orphaned leases, released arena tasks still marked claimed on the board). Change nothing else. Leave a retro.`,
  },
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
  </main>
);

export default Protocol;

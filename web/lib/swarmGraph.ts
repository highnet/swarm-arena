import { agentName, type BoardRecord, type Snapshot, type TaskStatus } from '@arena/shared';
import {
  rallypointBranch,
  type SwarmAgent,
  type SwarmEvent,
  type SwarmEventKind,
  type SwarmInput,
  type SwarmSector,
  type SwarmStage,
  type SwarmWorkItem,
} from '@rallypoint/swarm-graph/model';
import { isLive } from '@/components/arena/seats';
import { stageOf, type RpItem } from './github';
import rallypointConfig from '../../.rallypoint/config.json';

/**
 * The arena's adapter onto `@rallypoint/swarm-graph`: the only place that knows how the arena's
 * snapshot (tracks, tasks, board records) and its GitHub state (issues, pull requests and their
 * Rallypoint labels) map onto the package's sectors, work items and events.
 */

const INTEGRATION_BRANCH = rallypointConfig.integrationBranch;
const BRANCH_PREFIX = rallypointConfig.branchPrefix;

/** Rallypoint's own files: role prompts, scripts, skills and the harness that runs them. */
const PROTOCOL: SwarmSector = {
  id: 'protocol',
  label: 'Protocol',
  color: 'var(--fg-2)',
  paths: ['.rallypoint/', '.claude/skills/', 'harness/', 'docs/'],
};

/** The site itself. */
const SITE: SwarmSector = {
  id: 'site',
  label: 'Site',
  color: 'var(--fg-3)',
  paths: ['web/', 'shared/', 'swarm-graph/'],
};

const ROLE: Record<string, string> = { builder: 'worker', strategist: 'planner' };

/** The task's own status, used only when GitHub could not be read. */
const TASK_STAGE: Record<TaskStatus, SwarmStage> = {
  open: 'backlog',
  claimed: 'claimed',
  review: 'review',
  landed: 'merged',
  dead: 'closed',
};

const kindOf = (r: BoardRecord): SwarmEventKind => {
  switch (r.kind) {
    case 'strategy':
    case 'task_opened':
      return 'plan';
    case 'task_claimed':
      return 'claim';
    case 'patch_landed':
      return 'merge';
    case 'patch_rejected':
    case 'idea_dead':
      return 'reject';
    case 'match_verdict':
    case 'rung_cleared':
      return 'milestone';
    case 'protocol':
      return 'protocol';
    default:
      return /^review/i.test(r.title) ? 'review' : 'progress';
  }
};

/** The sector a GitHub item with no arena task touches, from its Conventional Commit scope. */
const sectorOfTitle = (title: string, engines: Set<string>) => {
  const scope = /^\w+\(([^)]+)\)/.exec(title)?.[1]?.toLowerCase();
  if (scope && engines.has(scope)) return scope;
  if (scope && /^(web|site|ui|shared)$/.test(scope)) return SITE.id;
  return PROTOCOL.id;
};

export const toSwarmInput = (s: Snapshot, rp: RpItem[] = []): SwarmInput => {
  const asOf = s.asOf ?? new Date().toISOString();
  const engines = new Set(s.tracks.map((t) => t.id));
  const sectors: SwarmSector[] = [
    ...s.tracks.map((t) => ({
      id: t.id,
      label: t.name,
      color: `var(--series-${t.color_slot})`,
      paths: [`engines/${t.id}/`],
    })),
    PROTOCOL,
    SITE,
  ];

  // Work items: each arena task, staged by its GitHub issue and the pull request that closes it.
  const issues = new Map(rp.filter((i) => !i.isPR).map((i) => [i.number, i]));
  const prs = rp.filter((i) => i.isPR);
  const prByNumber = new Map(prs.map((p) => [p.number, p]));
  const prForIssue = (n: number) =>
    prs.filter((p) => p.closes === n).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const used = new Set<number>();
  const workItems: SwarmWorkItem[] = s.tasks.map((t) => {
    const issue = t.issue ? issues.get(t.issue) : undefined;
    const pr =
      (t.pr ? prByNumber.get(t.pr) : undefined) ?? (t.issue ? prForIssue(t.issue) : undefined);
    if (issue) used.add(issue.number);
    if (pr) used.add(pr.number);
    const stage: SwarmStage = pr ? stageOf(pr) : issue ? stageOf(issue) : TASK_STAGE[t.status];
    return {
      id: t.id,
      sector: t.track_id,
      title: t.title,
      stage: stage === 'closed' && t.status === 'landed' ? 'merged' : stage,
      issue: t.issue ?? null,
      pr: pr?.number ?? t.pr ?? null,
      branch: t.issue ? rallypointBranch(t.issue, issue?.title ?? t.title, BRANCH_PREFIX) : null,
      at: pr?.mergedAt ?? t.closed_at ?? issue?.updatedAt ?? t.created_at,
    };
  });
  // Rallypoint work with no arena task (protocol and site changes): issues and their PRs.
  for (const i of rp) {
    if (used.has(i.number)) continue;
    if (i.isPR && i.closes && issues.has(i.closes) && !used.has(i.closes)) continue; // via its issue
    const pr = i.isPR ? i : prForIssue(i.number);
    if (pr) used.add(pr.number);
    used.add(i.number);
    workItems.push({
      id: `gh-${i.number}`,
      sector: sectorOfTitle(pr?.title ?? i.title, engines),
      title: i.title,
      stage: stageOf(pr ?? i),
      issue: i.isPR ? i.closes : i.number,
      pr: pr?.number ?? null,
      branch: i.isPR ? null : rallypointBranch(i.number, i.title, BRANCH_PREFIX),
      at: pr?.mergedAt ?? i.closedAt ?? i.updatedAt,
    });
  }
  const itemByPr = new Map(workItems.filter((w) => w.pr).map((w) => [w.pr!, w.id]));
  const itemById = new Map(workItems.map((w) => [w.id, w]));
  const prOf = (title: string) => Number(/#(\d+)/.exec(title)?.[1]) || null;

  const roles = new Map(s.agents.map((a) => [a.id, a.rp_role ?? a.role]));
  const roleOf = (id: string) => {
    const r = roles.get(id) ?? id;
    return ROLE[r] ?? r;
  };

  const agents: SwarmAgent[] = s.agents.map((a) => {
    const role = roleOf(a.id);
    const item = a.task_id ? itemById.get(a.task_id) : undefined;
    return {
      id: a.id,
      label: agentName(a.id),
      role,
      status: isLive(a, asOf) ? 'working' : 'idle',
      sector: a.track_id ?? item?.sector ?? (role === 'improver' ? PROTOCOL.id : null),
      workItem: a.task_id ?? (a.pr ? (itemByPr.get(a.pr) ?? null) : null),
      pr: a.pr ?? null,
      activity: a.activity ?? null,
      lastSeen: a.last_seen,
    };
  });

  // Actors that log records without holding a seat (the referee, the strategist).
  const known = new Set(s.agents.map((a) => a.id));
  const lastAt = new Map<string, string>();
  for (const r of s.records)
    if (r.agent_id && !known.has(r.agent_id) && r.at > (lastAt.get(r.agent_id) ?? ''))
      lastAt.set(r.agent_id, r.at);
  for (const [id, at] of lastAt)
    agents.push({
      id,
      label: agentName(id),
      role: roleOf(id),
      status: 'idle',
      sector: null,
      lastSeen: at,
    });

  const events: SwarmEvent[] = s.records.map((r) => {
    const kind = kindOf(r);
    // "Reviewing #37", "Merging #38": the pull request names the work when the record does not.
    const pr = prOf(r.title);
    const workItem = r.task_id ?? (pr ? (itemByPr.get(pr) ?? null) : null);
    const sector =
      r.track_id ??
      (workItem ? (itemById.get(workItem)?.sector ?? null) : null) ??
      (kind === 'protocol' || (r.agent_id && roleOf(r.agent_id) === 'improver')
        ? PROTOCOL.id
        : null);
    return {
      id: String(r.id),
      at: r.at,
      kind,
      agent: r.agent_id,
      sector,
      workItem,
      title: r.title,
    };
  });

  return { integrationBranch: INTEGRATION_BRANCH, asOf, sectors, agents, workItems, events };
};

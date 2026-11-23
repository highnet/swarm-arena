import { agentName, type BoardRecord, type Snapshot, type TaskStatus } from '@arena/shared';
import type {
  SwarmAgent,
  SwarmEvent,
  SwarmEventKind,
  SwarmInput,
  SwarmSector,
  SwarmWorkItemStatus,
} from '@rallypoint/swarm-graph/model';
import { isLive } from '@/components/arena/seats';

/**
 * The arena's adapter onto `@rallypoint/swarm-graph`: the only place that knows how the arena's
 * snapshot (tracks, tasks, board records) maps onto Rallypoint's generic sectors, work items
 * and events. Everything else about the graph lives in the package.
 */

/** Rallypoint's own files: role prompts, scripts, skills and the harness that runs them. */
const PROTOCOL: SwarmSector = {
  id: 'protocol',
  label: 'Protocol',
  color: 'var(--fg-2)',
  paths: ['.rallypoint/', '.claude/skills/', 'harness/'],
};

const ROLE: Record<string, string> = { builder: 'worker', strategist: 'planner' };

const STATUS: Record<TaskStatus, SwarmWorkItemStatus> = {
  open: 'open',
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

export const toSwarmInput = (s: Snapshot, integrationBranch = 'main'): SwarmInput => {
  const asOf = s.asOf ?? new Date().toISOString();
  const sectors: SwarmSector[] = [
    ...s.tracks.map((t) => ({
      id: t.id,
      label: t.name,
      color: `var(--series-${t.color_slot})`,
      paths: [`engines/${t.id}/`],
    })),
    PROTOCOL,
  ];
  const taskTrack = new Map(s.tasks.map((t) => [t.id, t.track_id]));
  const roles = new Map(s.agents.map((a) => [a.id, a.rp_role ?? a.role]));
  const roleOf = (id: string) => {
    const r = roles.get(id) ?? id;
    return ROLE[r] ?? r;
  };

  const agents: SwarmAgent[] = s.agents.map((a) => {
    const role = roleOf(a.id);
    return {
      id: a.id,
      label: agentName(a.id),
      role,
      status: isLive(a, asOf) ? 'working' : 'idle',
      sector:
        a.track_id ??
        (a.task_id ? (taskTrack.get(a.task_id) ?? null) : null) ??
        (role === 'improver' ? PROTOCOL.id : null),
      workItem: a.task_id ?? null,
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
    const sector =
      r.track_id ??
      (r.task_id ? (taskTrack.get(r.task_id) ?? null) : null) ??
      (kind === 'protocol' || (r.agent_id && roleOf(r.agent_id) === 'improver')
        ? PROTOCOL.id
        : null);
    return {
      id: String(r.id),
      at: r.at,
      kind,
      agent: r.agent_id,
      sector,
      workItem: r.task_id,
      title: r.title,
    };
  });

  return {
    integrationBranch,
    asOf,
    sectors,
    agents,
    workItems: s.tasks.map((t) => ({
      id: t.id,
      sector: t.track_id,
      title: t.title,
      status: STATUS[t.status],
      issue: t.issue ?? null,
      pr: t.pr ?? null,
      at: t.closed_at ?? t.created_at,
    })),
    events,
  };
};

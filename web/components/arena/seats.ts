import type { Agent } from '@arena/shared';

/** A seat that says it is working but has not been heard from in this long is shown as stale. */
export const STALE_MS = 45 * 60 * 1000;

export const ROLE_LABEL: Record<string, string> = {
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

export const roleLabel = (a: Agent) => ROLE_LABEL[a.rp_role ?? a.role] ?? a.role;

export const isStale = (a: Agent, asOf: string) =>
  a.status === 'working' && Date.parse(asOf) - Date.parse(a.last_seen) > STALE_MS;

export const isLive = (a: Agent, asOf: string) => a.status === 'working' && !isStale(a, asOf);

export const agentHref = (id: string) => `/fleet/${encodeURIComponent(id)}`;

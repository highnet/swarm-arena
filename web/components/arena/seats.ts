import { SEAT_STALE_MS, SEAT_STALE_TEXT, seatIsLive, type Agent } from '@arena/shared';

/** A seat that says it is working but has not been heard from in this long is shown as stale. */
export const STALE_MS = SEAT_STALE_MS;

/** The tooltip on a stale seat, built from the threshold so the two never disagree. */
export const STALE_TITLE = `Says it is working, but has not been heard from in ${SEAT_STALE_TEXT}`;

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

export const isLive = (a: Agent, asOf: string) => seatIsLive(a, Date.parse(asOf));

export const isStale = (a: Agent, asOf: string) => a.status === 'working' && !isLive(a, asOf);

/** Seats live at `asOf`: the one rule every "working now" count and list on the site uses. */
export const liveAgents = (agents: Agent[], asOf: string) => agents.filter((a) => isLive(a, asOf));

/** A seat's status as shown: a `working` seat that has gone quiet reads as stale. */
export const shownStatus = (a: Agent, asOf: string): Agent['status'] | 'stale' =>
  isStale(a, asOf) ? 'stale' : a.status;

const STATUS_ORDER = ['working', 'stale', 'idle', 'stopped'];

/** The one seat order every list uses: live first, then stale, idle, stopped; newest first within. */
export const bySeatStatus = (asOf: string) => (a: Agent, b: Agent) =>
  STATUS_ORDER.indexOf(shownStatus(a, asOf)) - STATUS_ORDER.indexOf(shownStatus(b, asOf)) ||
  b.last_seen.localeCompare(a.last_seen) ||
  a.id.localeCompare(b.id);

export const agentHref = (id: string) => `/fleet/${encodeURIComponent(id)}`;

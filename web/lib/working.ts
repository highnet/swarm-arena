import type { Agent, GameId, Snapshot, Task } from '@arena/shared';
import { bySeatStatus, liveAgents, roleLabel } from '@/components/arena/seats';
import type { RpItem } from './github';
import { REPO_URL } from './repo';

/**
 * The single answer to "who is working right now, and on what" (#205). The Right now panel, the
 * home stats tile, the site header, the fleet page, the fleet panel and the fleet graph all read
 * it; no page keeps its own filter. A seat counts while it is live (`seats.ts` `isLive`), whatever
 * its role and whether or not it holds an arena task.
 */

/**
 * The snapshot's clock: what "now" means for every liveness check. A live read carries `asOf`;
 * a snapshot without one (a fixture, a static export) is as of its newest instant, so the same
 * snapshot gives the same answer on every page and on every render.
 */
export const snapshotAsOf = (s: Snapshot): string =>
  s.asOf ??
  [...s.records.map((r) => r.at), ...s.agents.map((a) => a.last_seen), s.run.started_at]
    .sort()
    .at(-1)!;

/** What a working seat is on: an arena task, a pull request, an issue, or nothing named yet. */
export type Work =
  | { kind: 'task'; task: Task; title: string; track: GameId; issue: number | null }
  | { kind: 'pr' | 'issue'; number: number; title: string | null; url: string };

export type WorkingAgent = {
  agent: Agent;
  /** Its Rallypoint role as shown: Worker, Reviewer, Merger, Planner, … */
  role: string;
  work: Work | null;
  /** One line: what the seat says it is doing. */
  activity: string | null;
  /** The engine its effort is on, when there is one. */
  track: GameId | null;
};

/** The issue a seat names in its activity line ("Working issue #205"), when it has no task or PR. */
const issueInActivity = (activity: string | null | undefined) => {
  const n = /#(\d+)/.exec(activity ?? '')?.[1];
  return n ? Number(n) : null;
};

const workOf = (a: Agent, tasks: Map<string, Task>, rp: Map<number, RpItem>): Work | null => {
  const task = a.task_id ? tasks.get(a.task_id) : undefined;
  if (task)
    return {
      kind: 'task',
      task,
      title: task.title,
      track: task.track_id,
      issue: task.issue ?? null,
    };
  const number = a.pr ?? issueInActivity(a.activity);
  if (number === null) return null;
  const item = rp.get(number);
  const isPR = item ? item.isPR : a.pr === number;
  return {
    kind: isPR ? 'pr' : 'issue',
    number,
    title: item?.title ?? null,
    url: item?.url ?? `${REPO_URL}/${isPR ? 'pull' : 'issues'}/${number}`,
  };
};

/** Every live seat with what it is on, in the one seat order (newest heard from first). */
export const workingNow = (s: Snapshot, rp: RpItem[] = []): WorkingAgent[] => {
  const asOf = snapshotAsOf(s);
  const tasks = new Map(s.tasks.map((t) => [t.id, t]));
  const items = new Map(rp.map((i) => [i.number, i]));
  return liveAgents(s.agents, asOf)
    .sort(bySeatStatus(asOf))
    .map((agent) => {
      const work = workOf(agent, tasks, items);
      return {
        agent,
        role: roleLabel(agent),
        work,
        activity: agent.activity ?? null,
        track: work?.kind === 'task' ? work.track : agent.track_id,
      };
    });
};

/** How many seats are working now: the number every "working now" count on the site shows. */
export const workingCount = (s: Snapshot) => liveAgents(s.agents, snapshotAsOf(s)).length;

/** The ids of the seats working now, for checks that compare surfaces. */
export const workingIds = (s: Snapshot) =>
  new Set(liveAgents(s.agents, snapshotAsOf(s)).map((a) => a.id));

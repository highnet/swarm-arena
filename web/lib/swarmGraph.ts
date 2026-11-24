import { agentName, type Snapshot, type TaskStatus } from '@arena/shared';
import {
  rallypointBranch,
  type SwarmAgent,
  type SwarmCount,
  type SwarmEvent,
  type SwarmInput,
  type SwarmSector,
  type SwarmStage,
  type SwarmWorkItem,
} from '@rallypoint/swarm-graph/model';
import { stageOf, type MergedPull, type RpItem } from './github';
import { versionHref, versionOf } from './routes';
import { snapshotAsOf } from './working';
import {
  agentEvents,
  emptyContext,
  gameEvent,
  learn,
  matchEvents,
  messageEvent,
  ratingEvents,
  recordEvent,
  roleName,
  rungEvent,
  taskEvents,
  toSwarmAgent,
  gameOfRow,
  type ArenaEventContext,
  type EngineNode,
} from './swarmEvents';

export type { EngineGame, EngineNode, EngineVersion } from './swarmEvents';
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

/** The task's own status, used only when GitHub could not be read. */
const TASK_STAGE: Record<TaskStatus, SwarmStage> = {
  open: 'backlog',
  claimed: 'claimed',
  review: 'review',
  landed: 'merged',
  dead: 'closed',
};

/** Games kept as events from the snapshot: enough for the recent gates, not the whole run. */
const SNAPSHOT_GAMES = 300;
/** Board posts kept as events from the snapshot. */
const SNAPSHOT_POSTS = 200;

/** The sector a GitHub item with no arena task touches, from its Conventional Commit scope. */
const sectorOfTitle = (title: string, engines: Set<string>) => {
  const scope = /^\w+\(([^)]+)\)/.exec(title)?.[1]?.toLowerCase();
  if (scope && engines.has(scope)) return scope;
  if (scope && /^(web|site|ui|shared|swarm-graph)$/.test(scope)) return SITE.id;
  return PROTOCOL.id;
};

/** The recent part of a sector's count. */
const RECENT_MS = 24 * 3_600_000;

/**
 * The number inside each sector: landed versions for an engine (its `patch_landed` records),
 * merged pull requests for Protocol and Site, all-time, with the last 24 hours beside it. Read
 * from records and GitHub, not from the events the graph was given, so it does not move with a
 * preset, a replay or a short event window. Unknown (GitHub unread) stays unknown, never 0.
 */
export const sectorCounts = (
  s: Pick<Snapshot, 'tracks' | 'records'>,
  merged: MergedPull[] | null,
  asOf: string,
): Map<string, SwarmCount> => {
  const since = Date.parse(asOf) - RECENT_MS;
  const engines = new Set<string>(s.tracks.map((t) => t.id));
  const counts = new Map<string, SwarmCount>();
  const add = (sector: string, unit: string, at: string) => {
    const c = counts.get(sector) ?? { value: 0, unit, recent: 0, recentUnit: 'today' };
    c.value++;
    if (Date.parse(at) >= since) c.recent = (c.recent ?? 0) + 1;
    counts.set(sector, c);
  };
  for (const t of s.tracks)
    counts.set(t.id, { value: 0, unit: 'landed', recent: 0, recentUnit: 'today' });
  for (const r of s.records)
    if (r.kind === 'patch_landed' && r.track_id && engines.has(r.track_id))
      add(r.track_id, 'landed', r.at);
  if (merged) {
    for (const id of [PROTOCOL.id, SITE.id])
      counts.set(id, { value: 0, unit: 'merged', recent: 0, recentUnit: 'today' });
    for (const p of merged) {
      const sector = sectorOfTitle(p.title, engines);
      if (!engines.has(sector)) add(sector, 'merged', p.mergedAt);
    }
  }
  return counts;
};

export type ArenaSwarm = { input: SwarmInput; context: ArenaEventContext };

export const toSwarmInput = (
  s: Snapshot,
  rp: RpItem[] = [],
  merged: MergedPull[] | null = null,
): ArenaSwarm => {
  const asOf = snapshotAsOf(s);
  const engines = new Set(s.tracks.map((t) => t.id));
  const counts = sectorCounts(s, merged, asOf);
  const sectors: SwarmSector[] = [
    ...s.tracks.map((t) => ({
      id: t.id,
      label: t.name,
      color: `var(--series-${t.color_slot})`,
      paths: [`engines/${t.id}/`],
    })),
    PROTOCOL,
    SITE,
  ].map((sec) => ({ ...sec, count: counts.get(sec.id) ?? null }));

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
  // Everything the shared row mapping needs; the client keeps it current from Realtime.
  let context = learn(emptyContext(), {
    tracks: s.tracks,
    matches: s.matches,
    records: s.records,
    tasks: s.tasks,
    agents: s.agents,
    elo: s.elo,
  });
  context = {
    ...context,
    itemByPr: Object.fromEntries(workItems.filter((w) => w.pr).map((w) => [w.pr!, w.id])),
    itemSector: Object.fromEntries(workItems.map((w) => [w.id, w.sector])),
  };

  const agents: SwarmAgent[] = s.agents.map((a) => toSwarmAgent(context, a, asOf));

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
      role: roleName(context, id),
      status: 'idle',
      sector: null,
      lastSeen: at,
    });

  const recentGames = [...s.games]
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at))
    .slice(0, SNAPSHOT_GAMES);
  const recentPosts = [...(s.messages ?? [])]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, SNAPSHOT_POSTS);
  const events: SwarmEvent[] = [
    ...s.records.map((r) => recordEvent(context, r)),
    ...recentGames.map((g) => gameEvent(context, g)),
    ...s.matches.flatMap((m) => matchEvents(context, m)),
    ...ratingEvents(context, s.elo),
    ...s.rungs.flatMap((r) => rungEvent(context, r, s.records) ?? []),
    ...s.agents.flatMap((a) => agentEvents(context, a)),
    ...recentPosts.map(messageEvent),
    ...s.tasks.flatMap((t) => taskEvents(context, t)),
    ...githubEvents(rp, workItems, context, engines),
  ];

  return {
    input: { integrationBranch: INTEGRATION_BRANCH, asOf, sectors, agents, workItems, events },
    context,
  };
};

/**
 * What GitHub says that the board does not: pull requests opening and getting a verdict, merges
 * of work with no arena task, and claims on issues. Ids are stable, so a re-read is not news.
 */
const githubEvents = (
  rp: RpItem[],
  workItems: SwarmWorkItem[],
  ctx: ArenaEventContext,
  engines: Set<string>,
): SwarmEvent[] => {
  const out: SwarmEvent[] = [];
  const itemOf = (i: RpItem) =>
    (i.isPR ? ctx.itemByPr[i.number] : undefined) ??
    workItems.find((w) => w.issue === (i.isPR ? i.closes : i.number))?.id ??
    null;
  for (const i of rp) {
    const workItem = itemOf(i);
    const sector = (workItem ? ctx.itemSector[workItem] : null) ?? sectorOfTitle(i.title, engines);
    const base = { agent: null, workItem, sector };
    const arenaLanded = workItem ? ctx.recorded.includes(`patch_landed:${workItem}`) : false;
    if (i.isPR) {
      out.push({
        ...base,
        id: `gh:pr:${i.number}:opened`,
        at: i.createdAt,
        kind: 'pr',
        sub: 'pr-opened',
        title: `Pull request #${i.number} opened: ${i.title}`,
      });
      const stage = stageOf(i);
      if (stage === 'approved' || stage === 'changes')
        out.push({
          ...base,
          id: `gh:pr:${i.number}:${stage}`,
          at: i.updatedAt,
          kind: stage === 'approved' ? 'review' : 'reject',
          sub: stage === 'approved' ? 'pr-approved' : 'pr-changes',
          title:
            stage === 'approved'
              ? `Pull request #${i.number} approved`
              : `Changes asked on pull request #${i.number}`,
        });
      if (i.mergedAt && !arenaLanded)
        out.push({
          ...base,
          id: `gh:pr:${i.number}:merged`,
          at: i.mergedAt,
          kind: 'merge',
          sub: 'pr-merged',
          title: `Pull request #${i.number} merged: ${i.title}`,
        });
    } else if (stageOf(i) === 'claimed' && !(workItem && ctx.tasks[workItem]))
      out.push({
        ...base,
        id: `gh:issue:${i.number}:claimed`,
        at: i.updatedAt,
        kind: 'claim',
        sub: 'issue-claimed',
        title: `Issue #${i.number} claimed: ${i.title}`,
      });
  }
  return out;
};

/** Each engine's node: its rating, its version timeline and its latest finished game. */
export const engineNodes = (s: Snapshot): EngineNode[] => {
  const matches = new Map(s.matches.map((m) => [m.id, m]));
  const tasks = new Map(s.tasks.map((t) => [t.id, t]));
  return s.tracks.map((t) => {
    const timeline = s.elo
      .filter((p) => p.track_id === t.id)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((p) => {
        const landed = s.records.find(
          (r) =>
            r.kind === 'patch_landed' && r.track_id === t.id && versionOf(r) === p.engine_version,
        );
        const task = landed?.task_id ? tasks.get(landed.task_id) : undefined;
        return {
          version: p.engine_version,
          elo: p.elo,
          at: landed?.at ?? p.at,
          idea: landed ? landed.title.replace(/^\S+ shipped: /, '') : null,
          href: versionHref(t.id, p.engine_version),
          pr: task?.pr ?? null,
        };
      });
    const latest = [...s.games]
      .filter((g) => g.track_id === t.id && g.moves.length)
      .sort((a, b) => b.finished_at.localeCompare(a.finished_at))[0];
    return {
      id: t.id,
      name: t.name,
      elo: t.current_elo,
      version: t.current_version,
      timeline,
      latestGame: latest ? gameOfRow(latest, matches.get(latest.match_id)?.opponent) : null,
    };
  });
};

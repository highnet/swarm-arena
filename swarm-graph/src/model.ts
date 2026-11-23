/**
 * The swarm graph model. Pure and framework-free: it turns what a Rallypoint swarm already
 * records (agents and their roles, issues and the pull requests that deliver them, the events
 * agents log) into a graph that follows the protocol:
 *
 *   issue ──claim──▶ agent/<issue>-<slug> branch (forked from the integration branch, worked in
 *   a worktree) ──▶ pull request ──independent review──▶ merge into the integration branch,
 *   landing in the sector of the codebase the branch touched.
 *
 * Nothing reaches the integration branch except a merge. Nothing here knows about a particular
 * project: a host maps its own data onto these types and decides what a sector is (a directory,
 * a package, a label). The renderer in `render.ts` draws whatever this returns.
 */

/** The Rallypoint roles (`.rallypoint/roles/`). Hosts may add their own. */
export type SwarmRole =
  | 'worker'
  | 'reviewer'
  | 'merger'
  | 'fixer'
  | 'improver'
  | 'planner'
  | 'janitor'
  | 'tester'
  | 'orchestrator'
  | 'referee'
  | (string & {});

export type SwarmAgentStatus = 'working' | 'idle' | 'stopped';

/** A part of the codebase (paths in the integration branch) that work lands in. */
export type SwarmSector = {
  id: string;
  label: string;
  /** Any CSS colour; the renderer falls back to a neutral when absent. */
  color?: string;
  /** Repository paths the sector covers, for display only. */
  paths?: string[];
};

export type SwarmAgent = {
  id: string;
  label?: string;
  role: SwarmRole;
  /** `working` only while the session is live; a host marks stale seats idle. */
  status: SwarmAgentStatus;
  /** The sector the agent is in this session, if any. */
  sector: string | null;
  /** The work item (issue) the agent holds, if any. */
  workItem?: string | null;
  /** The pull request the agent is on (a reviewer's or merger's subject), if any. */
  pr?: number | null;
  /** One line: what the agent is doing this minute. */
  activity?: string | null;
  lastSeen: string;
};

/**
 * Where a work item is in the Rallypoint lifecycle; the same stages the protocol's labels give.
 * `backlog`/`held` are issues, `claimed` is a branch, `review`/`changes`/`approved` an open pull
 * request, `merged` landed on the integration branch, `closed` abandoned.
 */
export type SwarmStage =
  'backlog' | 'held' | 'claimed' | 'review' | 'changes' | 'approved' | 'merged' | 'closed';

/** How a stage is drawn: an issue, a branch in a worktree, a pull request, or landed code. */
export type SwarmPhase = 'issue' | 'branch' | 'pr' | 'landed';

export const phaseOf = (stage: SwarmStage): SwarmPhase | null => {
  switch (stage) {
    case 'backlog':
    case 'held':
      return 'issue';
    case 'claimed':
      return 'branch';
    case 'review':
    case 'changes':
    case 'approved':
      return 'pr';
    case 'merged':
      return 'landed';
    case 'closed':
      return null;
  }
};

/** One unit of work: a Rallypoint issue, its branch and, later, its pull request. */
export type SwarmWorkItem = {
  id: string;
  sector: string;
  title: string;
  stage: SwarmStage;
  issue?: number | null;
  pr?: number | null;
  /** The branch it is worked on, e.g. `agent/29-mcts-uct-with-random-eye-respecting`. */
  branch?: string | null;
  /** When it reached its current stage; orders the merged history. */
  at?: string | null;
};

/** What an event means on the graph. Only `merge` moves work into the integration branch. */
export type SwarmEventKind =
  'plan' | 'claim' | 'progress' | 'review' | 'merge' | 'reject' | 'milestone' | 'protocol';

export type SwarmEvent = {
  id: string;
  at: string;
  kind: SwarmEventKind;
  agent: string | null;
  sector: string | null;
  workItem: string | null;
  title: string;
};

export type SwarmInput = {
  /** Rallypoint's `integrationBranch`: the trunk every branch forks from and merges into. */
  integrationBranch: string;
  sectors: SwarmSector[];
  agents: SwarmAgent[];
  workItems: SwarmWorkItem[];
  events: SwarmEvent[];
  /** The clock the snapshot was read at. */
  asOf: string;
};

export type SwarmGraphOptions = {
  /** Idle agents seen within this window stay on the graph (dimmed). Default 6 h. */
  recentAgentMs?: number;
  /** Merged work items kept per sector, newest first. Default 3. */
  mergedPerSector?: number;
  /** Keep idle agents that hold no work and logged no events (default false: they are noise). */
  showIdleWithoutEffort?: boolean;
  /** Effort weight per event kind. */
  weights?: Partial<Record<SwarmEventKind, number>>;
};

export type SwarmNodeKind = 'hub' | 'sector' | 'work' | 'agent';

export type SwarmNode = {
  id: string;
  kind: SwarmNodeKind;
  label: string;
  color: string | null;
  /** Effort that landed on this node (sector, hub) or that this node spent (agent). */
  effort: number;
  /** Live agent, or a sector / work item a live agent is in. */
  active: boolean;
  /** For work nodes: how it is drawn. A node keeps its id as it moves through phases. */
  phase?: SwarmPhase;
  /** The original record, for tooltips and links. */
  sector?: SwarmSector;
  agent?: SwarmAgent;
  workItem?: SwarmWorkItem;
  /** For agent and work nodes: the sector they belong to. */
  sectorId?: string | null;
};

export type SwarmLinkKind =
  /** sector — hub: the sector is a set of paths in the integration branch. */
  | 'trunk'
  /** issue → sector it asks to change. */
  | 'target'
  /** hub → branch / pull request: forked from the integration branch's tip. */
  | 'fork'
  /** branch / pull request → the sector whose paths it changes. */
  | 'scope'
  /** landed work → its sector. */
  | 'landed'
  /** agent → what it is on now (its branch, the pull request it reviews, or the hub). */
  | 'assignment'
  /** agent → a sector it has spent effort on, weighted by that effort. */
  | 'contribution';

export type SwarmLink = {
  id: string;
  kind: SwarmLinkKind;
  source: string;
  target: string;
  weight: number;
  active: boolean;
};

/** One event as a movement on the graph: along `path`, node by node. */
export type SwarmFlow = {
  id: string;
  at: string;
  kind: SwarmEventKind;
  title: string;
  /** At least two node ids. A merge runs branch → integration branch → sector. */
  path: string[];
  weight: number;
};

export type SwarmGraph = {
  hubId: string;
  nodes: SwarmNode[];
  links: SwarmLink[];
  /** Events in time order, each resolved to the nodes its effort moves between. */
  flows: SwarmFlow[];
  totals: {
    effort: number;
    live: number;
    agents: number;
    sectors: number;
    branches: number;
    pullRequests: number;
  };
};

export const DEFAULT_WEIGHTS: Record<SwarmEventKind, number> = {
  plan: 0.5,
  claim: 1,
  progress: 1,
  review: 1,
  merge: 3,
  reject: 1,
  milestone: 2,
  protocol: 1,
};

/** Rallypoint's branch slug (`.rallypoint/scripts/lib/claim.mjs`), so names match the real ones. */
export const branchSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 42);

/** The branch `claim.mjs` prescribes for an issue: `<branchPrefix><issue>-<slug>`. */
export const rallypointBranch = (issue: number, title: string, branchPrefix = 'agent/') =>
  `${branchPrefix}${issue}-${branchSlug(title)}`;

const HOUR = 3_600_000;

export const hubNodeId = (branch: string) => `hub:${branch}`;
export const sectorNodeId = (id: string) => `sector:${id}`;
export const workNodeId = (id: string) => `work:${id}`;
export const agentNodeId = (id: string) => `agent:${id}`;

/** Roles that work inside a branch's worktree. */
const BRANCH_ROLES = new Set(['worker', 'fixer', 'improver', 'janitor', 'tester']);
/** Roles that act on an open pull request. */
const GATE_ROLES = new Set(['reviewer', 'merger']);

/** Build the graph a renderer draws. Deterministic: the same input gives the same graph. */
export const buildSwarmGraph = (input: SwarmInput, options: SwarmGraphOptions = {}): SwarmGraph => {
  const recentMs = options.recentAgentMs ?? 6 * HOUR;
  const mergedPerSector = options.mergedPerSector ?? 3;
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const now = Date.parse(input.asOf);
  const hubId = hubNodeId(input.integrationBranch);

  const sectors = new Map(input.sectors.map((s) => [s.id, s]));
  const items = new Map(input.workItems.map((w) => [w.id, w]));
  const agents = new Map(input.agents.map((a) => [a.id, a]));
  const events = [...input.events].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );

  const sectorOfEvent = (e: SwarmEvent) => {
    const s = e.sector ?? (e.workItem ? items.get(e.workItem)?.sector : null) ?? null;
    return s && sectors.has(s) ? s : null;
  };

  // Effort per sector, per agent, and per (agent, sector). Only merges count for the trunk.
  const sectorEffort = new Map<string, number>();
  const agentEffort = new Map<string, number>();
  const pairEffort = new Map<string, Map<string, number>>();
  let hubEffort = 0;
  let total = 0;
  const lastEventAt = new Map<string, string>();
  for (const e of events) {
    const w = weights[e.kind];
    total += w;
    const s = sectorOfEvent(e);
    if (s) sectorEffort.set(s, (sectorEffort.get(s) ?? 0) + w);
    if (e.kind === 'merge') hubEffort += w;
    if (e.agent) {
      agentEffort.set(e.agent, (agentEffort.get(e.agent) ?? 0) + w);
      lastEventAt.set(e.agent, e.at);
      if (s) {
        const m = pairEffort.get(e.agent) ?? new Map<string, number>();
        m.set(s, (m.get(s) ?? 0) + w);
        pairEffort.set(e.agent, m);
      }
    }
  }

  // Agents on the graph: live ones, idle ones seen recently that did something, and event-only
  // actors (a referee that never registers a seat) that acted recently.
  const shown = new Map<string, SwarmAgent>();
  for (const a of input.agents) {
    const seen = Math.max(Date.parse(a.lastSeen), Date.parse(lastEventAt.get(a.id) ?? '') || 0);
    const idleNoise = !a.workItem && !agentEffort.has(a.id) && !options.showIdleWithoutEffort;
    if (a.status === 'working' || (now - seen <= recentMs && !idleNoise)) shown.set(a.id, a);
  }
  for (const [id, at] of lastEventAt) {
    if (agents.has(id) || now - Date.parse(at) > recentMs) continue;
    shown.set(id, { id, role: id, status: 'idle', sector: null, lastSeen: at });
  }

  // Work items: every open issue, branch and pull request, plus the newest merged per sector.
  const kept: SwarmWorkItem[] = [];
  const mergedBySector = new Map<string, SwarmWorkItem[]>();
  for (const w of input.workItems) {
    const phase = phaseOf(w.stage);
    if (!phase || !sectors.has(w.sector)) continue;
    if (phase !== 'landed') kept.push(w);
    else mergedBySector.set(w.sector, [...(mergedBySector.get(w.sector) ?? []), w]);
  }
  for (const list of mergedBySector.values())
    kept.push(
      ...list
        .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id))
        .slice(0, mergedPerSector),
    );
  const keptById = new Map(kept.map((w) => [w.id, w]));
  const byPr = new Map(kept.filter((w) => w.pr).map((w) => [w.pr!, w]));

  const agentSector = (a: SwarmAgent) => {
    const s = a.sector ?? (a.workItem ? items.get(a.workItem)?.sector : null) ?? null;
    return s && sectors.has(s) ? s : null;
  };

  /** Where an agent is right now, by role: its branch, the pull request it gates, or the hub. */
  const placeOf = (a: SwarmAgent): string => {
    const own = a.workItem ? keptById.get(a.workItem) : undefined;
    const onPr = a.pr ? byPr.get(a.pr) : undefined;
    const open = (w?: SwarmWorkItem) =>
      w && (phaseOf(w.stage) === 'branch' || phaseOf(w.stage) === 'pr');
    if (GATE_ROLES.has(a.role)) {
      const subject = onPr ?? own;
      if (subject && phaseOf(subject.stage) === 'pr') return workNodeId(subject.id);
      return hubId;
    }
    if (BRANCH_ROLES.has(a.role)) {
      if (open(own)) return workNodeId(own!.id);
      if (open(onPr)) return workNodeId(onPr!.id);
      const s = agentSector(a);
      return s ? sectorNodeId(s) : hubId;
    }
    if (a.role === 'planner') return hubId;
    if (open(own)) return workNodeId(own!.id);
    const s = agentSector(a);
    return s ? sectorNodeId(s) : hubId;
  };

  const places = new Map([...shown.values()].map((a) => [a.id, placeOf(a)]));
  const liveTargets = new Set<string>();
  const liveSectors = new Set<string>();
  for (const a of shown.values()) {
    if (a.status !== 'working') continue;
    const target = places.get(a.id)!;
    liveTargets.add(target);
    const s = agentSector(a);
    if (s) liveSectors.add(s);
  }

  const nodes: SwarmNode[] = [
    {
      id: hubId,
      kind: 'hub',
      label: input.integrationBranch,
      color: null,
      effort: hubEffort,
      active: false,
    },
  ];
  const links: SwarmLink[] = [];

  for (const s of input.sectors) {
    const id = sectorNodeId(s.id);
    nodes.push({
      id,
      kind: 'sector',
      label: s.label,
      color: s.color ?? null,
      effort: sectorEffort.get(s.id) ?? 0,
      active: liveSectors.has(s.id),
      sector: s,
      sectorId: s.id,
    });
    links.push({
      id: `trunk:${s.id}`,
      kind: 'trunk',
      source: id,
      target: hubId,
      weight: sectorEffort.get(s.id) ?? 0,
      active: false,
    });
  }

  let branches = 0;
  let pullRequests = 0;
  for (const w of kept) {
    const id = workNodeId(w.id);
    const phase = phaseOf(w.stage)!;
    const active = liveTargets.has(id);
    const sid = sectorNodeId(w.sector);
    if (phase === 'branch') branches++;
    if (phase === 'pr') pullRequests++;
    nodes.push({
      id,
      kind: 'work',
      phase,
      label:
        phase === 'issue' || phase === 'landed'
          ? w.title
          : phase === 'pr' && w.pr
            ? `#${w.pr}`
            : (w.branch ?? w.title),
      color: sectors.get(w.sector)?.color ?? null,
      effort: 0,
      active,
      workItem: w,
      sectorId: w.sector,
    });
    if (phase === 'issue')
      links.push({
        id: `target:${w.id}`,
        kind: 'target',
        source: id,
        target: sid,
        weight: 1,
        active: false,
      });
    else if (phase === 'landed')
      links.push({
        id: `landed:${w.id}`,
        kind: 'landed',
        source: id,
        target: sid,
        weight: 1,
        active: false,
      });
    else {
      links.push({
        id: `fork:${w.id}`,
        kind: 'fork',
        source: hubId,
        target: id,
        weight: 1,
        active,
      });
      links.push({
        id: `scope:${w.id}`,
        kind: 'scope',
        source: id,
        target: sid,
        weight: 1,
        active: false,
      });
    }
  }

  for (const a of [...shown.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const id = agentNodeId(a.id);
    const s = agentSector(a);
    const live = a.status === 'working';
    const target = places.get(a.id)!;
    nodes.push({
      id,
      kind: 'agent',
      label: a.label ?? a.id,
      color: s ? (sectors.get(s)?.color ?? null) : null,
      effort: agentEffort.get(a.id) ?? 0,
      active: live,
      agent: a,
      sectorId: s,
    });
    links.push({
      id: `assign:${a.id}`,
      kind: 'assignment',
      source: id,
      target,
      weight: 1,
      active: live,
    });
    for (const [sec, w] of pairEffort.get(a.id) ?? []) {
      if (target === sectorNodeId(sec)) continue;
      links.push({
        id: `contrib:${a.id}:${sec}`,
        kind: 'contribution',
        source: id,
        target: sectorNodeId(sec),
        weight: w,
        active: false,
      });
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const flows: SwarmFlow[] = [];
  for (const e of events) {
    const s = sectorOfEvent(e);
    const sectorNode = s ? sectorNodeId(s) : null;
    const itemNode = e.workItem && keptById.has(e.workItem) ? workNodeId(e.workItem) : null;
    const agentNode = e.agent && nodeIds.has(agentNodeId(e.agent)) ? agentNodeId(e.agent) : null;
    const actor = agentNode ?? hubId;
    let path: (string | null)[];
    switch (e.kind) {
      case 'merge':
        // The only way into the integration branch: the branch merges, the code lands in its sector.
        path = [itemNode ?? agentNode, hubId, sectorNode];
        break;
      case 'claim':
        // The claim prescribes a branch at the integration branch's tip.
        path = [hubId, itemNode ?? sectorNode];
        break;
      case 'plan':
        path = [actor, itemNode ?? sectorNode ?? hubId];
        break;
      case 'milestone':
        // Gate matches measure a branch; rungs are cleared by what is on the integration branch.
        path = itemNode ? [actor, itemNode] : [hubId, sectorNode];
        break;
      default:
        path = [actor, itemNode ?? sectorNode ?? hubId];
    }
    const clean = path.filter((p): p is string => Boolean(p));
    const deduped = clean.filter((p, i) => i === 0 || p !== clean[i - 1]);
    if (deduped.length < 2) continue;
    flows.push({
      id: e.id,
      at: e.at,
      kind: e.kind,
      title: e.title,
      path: deduped,
      weight: weights[e.kind],
    });
  }

  return {
    hubId,
    nodes,
    links,
    flows,
    totals: {
      effort: total,
      live: [...shown.values()].filter((a) => a.status === 'working').length,
      agents: shown.size,
      sectors: input.sectors.length,
      branches,
      pullRequests,
    },
  };
};

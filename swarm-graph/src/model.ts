/**
 * The swarm graph model. Pure and framework-free: it turns what a Rallypoint swarm already
 * records (agents and their roles, work items mirrored from issues, the events they log) into a
 * graph of the codebase's sectors, the work open in each, and the agents spending effort there.
 *
 * Nothing here knows about a particular project. A host maps its own data onto these types
 * (see the adapter in the host app) and decides what a sector is: a directory, a package, a
 * label. The renderer in `render.ts` draws whatever this returns.
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

/** A section of the codebase effort is spent on: a directory, a package, a label. */
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
  pr?: number | null;
  /** One line: what the agent is doing this minute. */
  activity?: string | null;
  lastSeen: string;
};

export type SwarmWorkItemStatus = 'open' | 'claimed' | 'review' | 'merged' | 'closed';

/** One unit of claimable work: a Rallypoint issue and, later, its pull request. */
export type SwarmWorkItem = {
  id: string;
  sector: string;
  title: string;
  status: SwarmWorkItemStatus;
  issue?: number | null;
  pr?: number | null;
  /** When it reached its current status; orders the merged history. */
  at?: string | null;
};

/**
 * What an event means for the flow of effort. `merge` carries a sector's work into the
 * integration branch; every other kind is effort spent in (or on) a sector.
 */
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
  /** Rallypoint's `integrationBranch`: the hub every merge flows into. */
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
  /** Merged/closed work items kept per sector, newest first. Default 3. */
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
  /** The original record, for tooltips and links. */
  sector?: SwarmSector;
  agent?: SwarmAgent;
  workItem?: SwarmWorkItem;
  /** For agent and work nodes: the sector they belong to. */
  sectorId?: string | null;
};

export type SwarmLinkKind =
  /** sector → hub: the sector's merged work feeding the integration branch. */
  | 'trunk'
  /** work item → sector. */
  | 'work'
  /** agent → what it holds now (work item, sector, or the hub for gate roles). */
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

export type SwarmGraph = {
  hubId: string;
  nodes: SwarmNode[];
  links: SwarmLink[];
  /** Events in time order, each resolved to the node ids its effort moves between. */
  flows: SwarmFlow[];
  totals: { effort: number; live: number; agents: number; sectors: number };
};

/** One event as a movement of effort on the graph: from an agent (or sector) to a target. */
export type SwarmFlow = {
  id: string;
  at: string;
  kind: SwarmEventKind;
  title: string;
  from: string;
  to: string;
  weight: number;
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

const HOUR = 3_600_000;

export const hubNodeId = (branch: string) => `hub:${branch}`;
export const sectorNodeId = (id: string) => `sector:${id}`;
export const workNodeId = (id: string) => `work:${id}`;
export const agentNodeId = (id: string) => `agent:${id}`;

const OPEN: ReadonlySet<SwarmWorkItemStatus> = new Set(['open', 'claimed', 'review']);

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

  // Effort per sector, per agent, and per (agent, sector).
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
    if (e.kind === 'merge' || !s) hubEffort += w;
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

  // Agents on the graph: live ones, idle ones seen recently, and event-only actors
  // (a referee that never registers a seat) that acted recently.
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

  const agentSector = (a: SwarmAgent) => {
    const s = a.sector ?? (a.workItem ? items.get(a.workItem)?.sector : null) ?? null;
    return s && sectors.has(s) ? s : null;
  };
  const liveSectors = new Set<string>();
  const liveItems = new Set<string>();
  for (const a of shown.values()) {
    if (a.status !== 'working') continue;
    const s = agentSector(a);
    if (s) liveSectors.add(s);
    if (a.workItem) liveItems.add(a.workItem);
  }

  // Work items: everything open, plus the newest few merged per sector.
  const keptItems: SwarmWorkItem[] = [];
  const mergedBySector = new Map<string, SwarmWorkItem[]>();
  for (const w of input.workItems) {
    if (!sectors.has(w.sector)) continue;
    if (OPEN.has(w.status) || liveItems.has(w.id)) keptItems.push(w);
    else mergedBySector.set(w.sector, [...(mergedBySector.get(w.sector) ?? []), w]);
  }
  for (const list of mergedBySector.values())
    keptItems.push(
      ...list
        .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id))
        .slice(0, mergedPerSector),
    );
  const keptItemIds = new Set(keptItems.map((w) => w.id));

  const nodes: SwarmNode[] = [
    {
      id: hubId,
      kind: 'hub',
      label: input.integrationBranch,
      color: null,
      effort: hubEffort,
      active: liveSectors.size > 0,
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
      active: liveSectors.has(s.id),
    });
  }

  for (const w of keptItems) {
    const id = workNodeId(w.id);
    const s = sectors.get(w.sector);
    nodes.push({
      id,
      kind: 'work',
      label: w.title,
      color: s?.color ?? null,
      effort: 0,
      active: liveItems.has(w.id),
      workItem: w,
      sectorId: w.sector,
    });
    links.push({
      id: `work:${w.id}`,
      kind: 'work',
      source: id,
      target: sectorNodeId(w.sector),
      weight: 1,
      active: liveItems.has(w.id),
    });
  }

  for (const a of [...shown.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const id = agentNodeId(a.id);
    const s = agentSector(a);
    const live = a.status === 'working';
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
    const target =
      a.workItem && keptItemIds.has(a.workItem)
        ? workNodeId(a.workItem)
        : s
          ? sectorNodeId(s)
          : hubId;
    links.push({
      id: `assign:${a.id}`,
      kind: 'assignment',
      source: id,
      target,
      weight: 1,
      active: live,
    });
    for (const [sec, w] of pairEffort.get(a.id) ?? []) {
      // The assignment already ties an agent to its own sector.
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
    const itemNode = e.workItem && keptItemIds.has(e.workItem) ? workNodeId(e.workItem) : null;
    const agentNode = e.agent && nodeIds.has(agentNodeId(e.agent)) ? agentNodeId(e.agent) : null;
    let from: string | null;
    let to: string | null;
    if (e.kind === 'merge') {
      from = itemNode ?? sectorNode ?? agentNode;
      to = hubId;
    } else {
      from = agentNode ?? hubId;
      to = itemNode ?? sectorNode ?? hubId;
    }
    if (!from || from === to) continue;
    flows.push({
      id: e.id,
      at: e.at,
      kind: e.kind,
      title: e.title,
      from,
      to,
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
    },
  };
};

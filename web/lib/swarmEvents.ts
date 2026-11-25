import {
  agentName,
  OPENING_PLIES,
  type Agent,
  type BoardRecord,
  type EloPoint,
  type GameId,
  type GameRow,
  type Match,
  type Message,
  type Rung,
  type Task,
  type Track,
} from '@arena/shared';
import type { SwarmAgent, SwarmEvent, SwarmEventKind } from '@rallypoint/swarm-graph/model';
import { isLive } from '@/components/arena/seats';

/**
 * Every arena row as a swarm-graph event. Client-safe, so the same mapping turns the server's
 * snapshot and a Realtime payload into the same event (same id), and the graph can append a live
 * row at once and still agree with the snapshot that follows.
 */

/** What the mapping needs to know about the run beyond the row itself. Plain data, serialisable. */
export type ArenaEventContext = {
  trackNames: Partial<Record<GameId, string>>;
  matches: Record<
    string,
    Pick<Match, 'id' | 'track_id' | 'engine_version' | 'opponent' | 'purpose'>
  >;
  /** The task a gate match measured, from the referee's verdict records. */
  matchTask: Record<string, string>;
  tasks: Record<
    string,
    { sector: string; title: string; concept: string | null; pr: number | null }
  >;
  /** Work item id by pull request number. */
  itemByPr: Record<number, string>;
  /** Sector of every work item, arena task or GitHub-only. */
  itemSector: Record<string, string>;
  roles: Record<string, string>;
  /** `kind:task_id` of every board record, so a task's own state does not repeat a record. */
  recorded: string[];
  /** Ratings per engine version, for deltas. */
  ratings: Record<string, number>;
  /** When each engine first tried each concept, for ideas ported between games. */
  conceptTracks: Record<string, Partial<Record<GameId, string>>>;
};

export type ArenaRealtimeTable =
  | 'agents'
  | 'tasks'
  | 'records'
  | 'messages'
  | 'matches'
  | 'games'
  | 'elo_points'
  | 'tracks'
  | 'rungs';

/** Each table's event subs: what a preset keys on. Board records use their own kind. */
export const TABLE_SUBS: Record<ArenaRealtimeTable, string[]> = {
  games: ['game'],
  matches: ['match-start', 'match'],
  elo_points: ['rating'],
  rungs: ['rung'],
  agents: ['session-start', 'session-step', 'session-end'],
  messages: ['post'],
  tasks: ['task-opened', 'concept-port', 'task-claimed', 'task-review', 'task-landed', 'task-dead'],
  records: [
    'strategy',
    'task_opened',
    'task_claimed',
    'progress',
    'patch_landed',
    'patch_rejected',
    'match_verdict',
    'rung_cleared',
    'idea_dead',
    'protocol',
  ],
  // A track's rating and version are a property of its node, not an event (see `EngineBadge`).
  tracks: [],
};

const ROLE: Record<string, string> = { builder: 'worker', strategist: 'planner' };

export const roleName = (ctx: ArenaEventContext, id: string) => {
  const r = ctx.roles[id] ?? id;
  return ROLE[r] ?? r;
};

const ratingKey = (track: string, version: string) => `${track}:${version}`;

export const emptyContext = (): ArenaEventContext => ({
  trackNames: {},
  matches: {},
  matchTask: {},
  tasks: {},
  itemByPr: {},
  itemSector: {},
  roles: {},
  recorded: [],
  ratings: {},
  conceptTracks: {},
});

/** Fold rows into the context, as the snapshot does once and Realtime does row by row. */
export const learn = (
  ctx: ArenaEventContext,
  rows: {
    tracks?: Pick<Track, 'id' | 'name'>[];
    matches?: Match[];
    records?: BoardRecord[];
    tasks?: Task[];
    agents?: Agent[];
    elo?: EloPoint[];
  },
): ArenaEventContext => {
  const next: ArenaEventContext = {
    ...ctx,
    trackNames: { ...ctx.trackNames },
    matches: { ...ctx.matches },
    matchTask: { ...ctx.matchTask },
    tasks: { ...ctx.tasks },
    itemSector: { ...ctx.itemSector },
    itemByPr: { ...ctx.itemByPr },
    roles: { ...ctx.roles },
    recorded: [...ctx.recorded],
    ratings: { ...ctx.ratings },
    conceptTracks: { ...ctx.conceptTracks },
  };
  for (const t of rows.tracks ?? []) next.trackNames[t.id] = t.name;
  for (const m of rows.matches ?? [])
    next.matches[m.id] = {
      id: m.id,
      track_id: m.track_id,
      engine_version: m.engine_version,
      opponent: m.opponent,
      purpose: m.purpose,
    };
  for (const r of rows.records ?? []) {
    if (r.match_id && r.task_id) next.matchTask[r.match_id] = r.task_id;
    // Once per kind and task, so a long-open page does not grow it per record (#197).
    const key = `${r.kind}:${r.task_id}`;
    if (r.task_id && !next.recorded.includes(key)) next.recorded.push(key);
  }
  for (const t of rows.tasks ?? []) {
    next.tasks[t.id] = {
      sector: t.track_id,
      title: t.title,
      concept: t.concept ?? null,
      pr: t.pr ?? null,
    };
    next.itemSector[t.id] = t.track_id;
    if (t.pr) next.itemByPr[t.pr] = t.id;
    if (t.concept) {
      const seen = { ...next.conceptTracks[t.concept] };
      const first = seen[t.track_id];
      if (!first || t.created_at < first) seen[t.track_id] = t.created_at;
      next.conceptTracks[t.concept] = seen;
    }
  }
  for (const a of rows.agents ?? []) next.roles[a.id] = a.rp_role ?? a.role;
  for (const p of rows.elo ?? []) next.ratings[ratingKey(p.track_id, p.engine_version)] = p.elo;
  return next;
};

const event = (
  e: Omit<SwarmEvent, 'agent' | 'workItem'> & { agent?: string | null; workItem?: string | null },
): SwarmEvent => ({ agent: null, workItem: null, ...e });

const engineLabel = (ctx: ArenaEventContext, track: GameId, version?: string | null) =>
  [ctx.trackNames[track] ?? track, version].filter(Boolean).join(' ');

const matchTitle = (ctx: ArenaEventContext, m: ArenaEventContext['matches'][string]) =>
  `${engineLabel(ctx, m.track_id, m.engine_version)} vs ${m.opponent}${m.purpose === 'gate' ? ' (gate)' : ''}`;

const matchGroup = (ctx: ArenaEventContext, matchId: string) => {
  const m = ctx.matches[matchId];
  return m ? { id: `match:${matchId}`, title: matchTitle(ctx, m) } : null;
};

/** The task a measurement belongs to: a gate's candidate branch, if the referee said which. */
const measuredItem = (ctx: ArenaEventContext, matchId: string) => ctx.matchTask[matchId] ?? null;

export const gameEvent = (ctx: ArenaEventContext, g: GameRow): SwarmEvent => {
  const m = ctx.matches[g.match_id];
  const score = g.engine_first ? g.outcome : 1 - g.outcome;
  const outcome = score > 0.5 ? 'win' : score < 0.5 ? 'loss' : 'draw';
  const engine = engineLabel(ctx, g.track_id, m?.engine_version);
  const verb = outcome === 'win' ? 'beat' : outcome === 'loss' ? 'lost to' : 'drew with';
  const opening = g.moves?.length
    ? ` · opening ${g.moves.slice(0, OPENING_PLIES[g.track_id] ?? 2).join(' ')}`
    : '';
  return event({
    id: `game:${g.id}`,
    at: g.finished_at,
    kind: 'result',
    sub: 'game',
    sector: g.track_id,
    workItem: measuredItem(ctx, g.match_id),
    title: `${engine} ${verb} ${m?.opponent ?? 'its opponent'} in ${g.ply_count} plies${opening}`,
    group: matchGroup(ctx, g.match_id),
    outcome,
  });
};

export const matchEvents = (ctx: ArenaEventContext, m: Match): SwarmEvent[] => {
  const group = { id: `match:${m.id}`, title: matchTitle(ctx, m) };
  const engine = engineLabel(ctx, m.track_id, m.engine_version);
  const out: SwarmEvent[] = [
    event({
      id: `match:${m.id}:start`,
      at: m.started_at,
      kind: 'result',
      sub: 'match-start',
      sector: m.track_id,
      workItem: measuredItem(ctx, m.id),
      title:
        m.purpose === 'gate'
          ? `${engine} is being tested against ${m.opponent}`
          : `${engine} started a match against ${m.opponent}`,
      group,
    }),
  ];
  if (m.finished_at) {
    const outcome = m.wins > m.losses ? 'win' : m.wins < m.losses ? 'loss' : 'draw';
    out.push(
      event({
        id: `match:${m.id}:end`,
        at: m.finished_at,
        kind: 'milestone',
        sub: 'match',
        sector: m.track_id,
        workItem: measuredItem(ctx, m.id),
        title: `${engine} vs ${m.opponent}: ${m.wins}–${m.losses}${m.draws ? `, ${m.draws} drawn` : ''}`,
        group,
        outcome,
      }),
    );
  }
  return out;
};

/** A rating change, with the delta from the engine's previous rated version. */
export const ratingEvent = (
  ctx: ArenaEventContext,
  p: EloPoint,
  previous: number | null,
): SwarmEvent => {
  const delta = previous === null ? null : Math.round(p.elo - previous);
  return event({
    id: `elo:${p.track_id}:${p.engine_version}`,
    at: p.at,
    kind: 'rating',
    sub: 'rating',
    sector: p.track_id,
    title: `${engineLabel(ctx, p.track_id, p.engine_version)} rated ${Math.round(p.elo)}${
      delta !== null ? ` (${delta >= 0 ? '+' : ''}${delta})` : ''
    }`,
    group: matchGroup(ctx, p.match_id),
    delta,
  });
};

/** The rating events of a run: each version against the one rated before it. */
export const ratingEvents = (ctx: ArenaEventContext, points: EloPoint[]): SwarmEvent[] => {
  const last = new Map<string, number>();
  return [...points]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((p) => {
      const e = ratingEvent(ctx, p, last.get(p.track_id) ?? null);
      last.set(p.track_id, p.elo);
      return e;
    });
};

/** A rung cleared, unless the referee's own record already says so. */
export const rungEvent = (ctx: ArenaEventContext, r: Rung, records: BoardRecord[] = []) => {
  if (!r.cleared_at) return null;
  const at = Date.parse(r.cleared_at);
  const said = records.some(
    (x) =>
      x.kind === 'rung_cleared' &&
      x.track_id === r.track_id &&
      Math.abs(Date.parse(x.at) - at) < 15 * 60_000,
  );
  if (said) return null;
  return event({
    id: `rung:${r.id}`,
    at: r.cleared_at,
    kind: 'milestone',
    sub: 'rung',
    sector: r.track_id,
    title: `${engineLabel(ctx, r.track_id)} cleared ${r.label} (${r.opponent}, ${r.elo})`,
  });
};

/** A short, stable key for a line of text, so one step is one event however often it is read. */
const textKey = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const agentSector = (ctx: ArenaEventContext, a: Agent) =>
  a.track_id ?? (a.task_id ? (ctx.itemSector[a.task_id] ?? null) : null);

/** A seat's session: when it started, the step it is on, and when it went idle or ended. */
export const agentEvents = (ctx: ArenaEventContext, a: Agent): SwarmEvent[] => {
  const name = agentName(a.id);
  const role = roleName(ctx, a.id);
  const session = a.session_id ?? a.started_at ?? 'seat';
  const base = {
    agent: a.id,
    sector: agentSector(ctx, a),
    workItem: a.task_id ?? (a.pr ? (ctx.itemByPr[a.pr] ?? null) : null),
  };
  const out: SwarmEvent[] = [];
  if (a.started_at)
    out.push(
      event({
        ...base,
        id: `agent:${a.id}:${session}:start`,
        at: a.started_at,
        kind: 'session',
        sub: 'session-start',
        title: `${name} started a session as ${role}`,
      }),
    );
  if (a.status === 'working' && a.activity)
    out.push(
      event({
        ...base,
        id: `agent:${a.id}:${session}:step:${textKey(a.activity)}`,
        at: a.last_seen,
        kind: 'session',
        sub: 'session-step',
        title: `${name} (${role}): ${a.activity}`,
      }),
    );
  if (a.status !== 'working')
    out.push(
      event({
        ...base,
        id: `agent:${a.id}:${session}:end`,
        at: a.last_seen,
        kind: 'session',
        sub: 'session-end',
        title: `${name} ${a.status === 'stopped' ? 'ended its session' : 'went idle'}`,
      }),
    );
  return out;
};

export const messageEvent = (m: Message): SwarmEvent => {
  const who = m.agent_id ? agentName(m.agent_id) : 'Someone';
  const what = m.title ?? m.body.split('\n')[0];
  const short = what.length > 90 ? `${what.slice(0, 89)}…` : what;
  return event({
    id: `msg:${m.id}`,
    at: m.at,
    kind: 'post',
    sub: 'post',
    agent: m.agent_id,
    sector: m.track_id,
    title: m.reply_to ? `${who} replied: ${short}` : `${who} posted a ${m.kind}: ${short}`,
  });
};

const TASK_STATE: Record<
  Task['status'],
  { sub: string; kind: SwarmEventKind; record: string[]; verb: string } | null
> = {
  open: { sub: 'task-opened', kind: 'plan', record: ['task_opened'], verb: 'opened' },
  claimed: { sub: 'task-claimed', kind: 'claim', record: ['task_claimed'], verb: 'claimed' },
  review: { sub: 'task-review', kind: 'review', record: [], verb: 'is in review' },
  landed: { sub: 'task-landed', kind: 'merge', record: ['patch_landed'], verb: 'landed' },
  dead: { sub: 'task-dead', kind: 'reject', record: ['idea_dead', 'patch_rejected'], verb: 'died' },
};

/**
 * A task as it was opened and as it is now. Board records already tell most of it, so a state
 * the records name is left to them.
 */
export const taskEvents = (ctx: ArenaEventContext, t: Task): SwarmEvent[] => {
  const said = (kinds: string[]) => kinds.some((k) => ctx.recorded.includes(`${k}:${t.id}`));
  const out: SwarmEvent[] = [];
  // Ported: another engine tried the same concept before this one did.
  const from = t.concept
    ? (Object.entries(ctx.conceptTracks[t.concept] ?? {}) as [GameId, string][])
        .filter(([track, at]) => track !== t.track_id && at < t.created_at)
        .map(([track]) => ctx.trackNames[track] ?? track)
    : [];
  const ported = from.length > 0;
  if (!said(['task_opened']) || ported)
    out.push(
      event({
        id: `task:${t.id}:opened`,
        at: t.created_at,
        kind: 'plan',
        sub: ported ? 'concept-port' : 'task-opened',
        agent: null,
        sector: t.track_id,
        workItem: t.id,
        title: ported
          ? `${engineLabel(ctx, t.track_id)} tries ${t.concept}, an idea from ${from.join(', ')}`
          : `New idea for ${engineLabel(ctx, t.track_id)}: ${t.title}`,
      }),
    );
  const state = TASK_STATE[t.status];
  if (state && t.status !== 'open' && !said(state.record))
    out.push(
      event({
        id: `task:${t.id}:${t.status}`,
        at: t.closed_at ?? t.created_at,
        kind: state.kind,
        sub: state.sub,
        agent: t.claimed_by,
        sector: t.track_id,
        workItem: t.id,
        title: `${t.title} ${state.verb}`,
      }),
    );
  return out;
};

const recordKind = (r: BoardRecord): SwarmEventKind => {
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

export const recordEvent = (ctx: ArenaEventContext, r: BoardRecord): SwarmEvent => {
  const kind = recordKind(r);
  // "Reviewing #37", "Merging #38": the pull request names the work when the record does not.
  const pr = Number(/#(\d+)/.exec(r.title)?.[1]) || null;
  const workItem = r.task_id ?? (pr ? (ctx.itemByPr[pr] ?? null) : null);
  const sector =
    r.track_id ??
    (workItem ? (ctx.itemSector[workItem] ?? null) : null) ??
    (kind === 'protocol' || (r.agent_id && roleName(ctx, r.agent_id) === 'improver')
      ? 'protocol'
      : null);
  return event({
    id: String(r.id),
    at: r.at,
    kind,
    sub: r.kind,
    agent: r.agent_id,
    sector,
    workItem,
    title: r.title,
    group: r.match_id ? matchGroup(ctx, r.match_id) : null,
  });
};

/** A seat as the graph's agent: working only while live, the same rule the fleet cards use. */
export const toSwarmAgent = (ctx: ArenaEventContext, a: Agent, asOf: string): SwarmAgent => {
  const role = roleName(ctx, a.id);
  return {
    id: a.id,
    label: agentName(a.id),
    role,
    status: isLive(a, asOf) ? 'working' : 'idle',
    sector: agentSector(ctx, a) ?? (role === 'improver' ? 'protocol' : null),
    workItem: a.task_id ?? (a.pr ? (ctx.itemByPr[a.pr] ?? null) : null),
    pr: a.pr ?? null,
    activity: a.activity ?? null,
    lastSeen: a.last_seen,
  };
};

/**
 * One Realtime change as graph events, and the context it teaches. Deletes say nothing. A row
 * maps to the same event id the snapshot would give it, so the refresh that follows agrees.
 */
export const realtimeEvents = (
  ctx: ArenaEventContext,
  table: ArenaRealtimeTable,
  row: Record<string, unknown> | null,
): { ctx: ArenaEventContext; events: SwarmEvent[] } => {
  if (!row) return { ctx, events: [] };
  switch (table) {
    case 'games':
      return { ctx, events: [gameEvent(ctx, row as GameRow)] };
    case 'matches': {
      const m = row as Match;
      const next = learn(ctx, { matches: [m] });
      return { ctx: next, events: matchEvents(next, m) };
    }
    case 'elo_points': {
      const p = row as EloPoint;
      const versions = Object.entries(ctx.ratings).filter(
        ([k]) => k.startsWith(`${p.track_id}:`) && k !== ratingKey(p.track_id, p.engine_version),
      );
      // The rating to beat is the engine's current one: the latest version rated before this.
      const previous = versions.length ? Math.max(...versions.map(([, v]) => v)) : null;
      const next = learn(ctx, { elo: [p] });
      return { ctx: next, events: [ratingEvent(next, p, previous)] };
    }
    case 'rungs': {
      const e = rungEvent(ctx, row as Rung);
      return { ctx, events: e ? [e] : [] };
    }
    case 'agents': {
      const a = row as Agent;
      const next = learn(ctx, { agents: [a] });
      return { ctx: next, events: agentEvents(next, a) };
    }
    case 'messages':
      return { ctx, events: [messageEvent(row as Message)] };
    case 'tasks': {
      const t = row as Task;
      const next = learn(ctx, { tasks: [t] });
      return { ctx: next, events: taskEvents(next, t) };
    }
    case 'records': {
      const r = row as BoardRecord;
      const next = learn(ctx, { records: [r] });
      return { ctx: next, events: [recordEvent(next, r)] };
    }
    case 'tracks':
      return { ctx: learn(ctx, { tracks: [row as Track] }), events: [] };
  }
};

/** One version of an engine, as the graph's timeline card lists it. */
export type EngineVersion = {
  version: string;
  elo: number;
  at: string;
  idea: string | null;
  href: string;
  pr: number | null;
};

/** A finished game, enough to replay it small on the engine's node. */
export type EngineGame = {
  id: string;
  track: GameId;
  moves: string[];
  opponent: string;
  /** Did the engine move first? Its colour on the board follows (lib/sides, #263). */
  engineFirst: boolean;
  result: 'win' | 'loss' | 'draw';
  finishedAt: string;
  /** The referee's match; null for an `arena versus` game, which has none (#163, #262). */
  matchId: string | null;
};

export type EngineNode = {
  id: GameId;
  name: string;
  /** The rating and version on main: the engine card's numbers, from the same row. */
  elo: number | null;
  version: string | null;
  /** The rating curve's per-version series, oldest first. */
  timeline: EngineVersion[];
  latestGame: EngineGame | null;
};

export const gameOfRow = (
  g: Pick<
    GameRow,
    'id' | 'track_id' | 'moves' | 'engine_first' | 'outcome' | 'finished_at' | 'match_id'
  >,
  opponent: string | undefined,
): EngineGame => {
  const score = g.engine_first ? g.outcome : 1 - g.outcome;
  return {
    id: g.id,
    track: g.track_id,
    moves: g.moves,
    opponent: opponent ?? 'opponent',
    engineFirst: g.engine_first,
    result: score > 0.5 ? 'win' : score < 0.5 ? 'loss' : 'draw',
    finishedAt: g.finished_at,
    matchId: g.match_id,
  };
};

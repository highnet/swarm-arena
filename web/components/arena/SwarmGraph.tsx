'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Crosshair, History, Sparkles, Square } from 'lucide-react';
import type { Agent, GameId, GameRow, LiveGameRow, Track } from '@arena/shared';
import {
  agentNodeId,
  buildSwarmGraph,
  createSwarmGraph,
  defaultEffectOf,
  LIFETIMES,
  planReplay,
  stateAt,
  summarizeReplay,
  type SwarmAgent,
  type SwarmCount,
  type SwarmEffectKind,
  type SwarmEvent,
  type SwarmFlow,
  type SwarmGraphRenderer,
  type SwarmInput,
  type SwarmNode,
  type SwarmReplayMode,
  type SwarmReplayPlan,
  type SwarmReplayState,
  type SwarmStage,
} from '@rallypoint/swarm-graph';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatTime } from '@/lib/format';
import { onLive, type LiveChange } from '@/lib/liveBus';
import {
  realtimeEvents,
  TABLE_SUBS,
  gameOfRow,
  toSwarmAgent,
  type ArenaEventContext,
  type EngineGame,
  type EngineNode,
  type ArenaRealtimeTable,
} from '@/lib/swarmEvents';
import {
  DEFAULT_PRESET,
  PRESETS,
  presetForPath,
  presetOf,
  showsFlow,
  type SwarmPresetId,
} from '@/lib/swarmPresets';
import type { EffectsMode, SwarmEffectsLayer } from '@/lib/swarmEffects';
import { useCatchUp } from '@/lib/useCatchUp';
import { useLiveBoards } from '@/lib/useLiveBoards';
import { cn } from '@/lib/utils';
import type { EngineBoardSource } from './EngineBoard';
import { useFleetHover } from './FleetHover';
import { ReplayScrubber } from './ReplayScrubber';
import { agentHref } from './seats';
import { SwarmNodeOverlay, type NodeRating } from './SwarmNodeOverlay';

/** Lines in the ticker; older ones drop off. */
const TICKER = 5;
/** Match bursts whose game tally the ticker remembers; the oldest are forgotten first. */
const GROUP_CAP = 50;

/**
 * When this page load first showed the graph. Coming back to the fleet page later in the same
 * visit (a client-side route change) plays the short intro; a remount straight away (React's
 * development double-mount) still gets the full one.
 */
let introShownAt: number | null = null;
const introMode = () =>
  introShownAt !== null && performance.now() - introShownAt > 1500 ? 'short' : 'full';

const EFFECTS_KEY = 'swarm-graph-effects';
const HAPTICS_KEY = 'swarm-graph-haptics';
const EFFECT_MODES: { id: EffectsMode; label: string; title: string }[] = [
  { id: 'off', label: 'Off', title: 'No particle layer: the graph alone' },
  { id: 'calm', label: 'Calm', title: 'Particles only' },
  { id: 'full', label: 'Full', title: 'Particles, bloom, light and ripples' },
];
/** Captions on screen at once during a replay; older ones dissolve. */
const CAPTIONS = 3;
const CAPTION_MS = 2800;

const readStored = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = window.localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
};

/** The arena's reading of an event's payoff: rungs cleared and ideas buried get their own. */
const arenaEffectOf = (f: SwarmFlow): SwarmEffectKind | null =>
  f.sub === 'rung' ? 'rung' : f.sub === 'task-dead' ? 'bury' : defaultEffectOf(f);

/** A referee match opening and closing, for the heat shimmer over its sector. */
const gateOf = (f: SwarmFlow) =>
  f.sub === 'match-start' ? 'start' : f.sub === 'match' ? 'end' : null;

/** What a replay dwells on: merges, rungs cleared and rating changes (not every match ending). */
const replayMilestone = (f: SwarmFlow) =>
  f.kind === 'merge' || f.sub === 'rung' || (f.kind === 'rating' && Boolean(f.delta));

const FLOW_VERB: Record<SwarmFlow['kind'], string> = {
  plan: 'planned',
  claim: 'claimed',
  progress: 'progress',
  review: 'review',
  merge: 'merged',
  reject: 'rejected',
  milestone: 'milestone',
  protocol: 'protocol',
  result: 'result',
  rating: 'rating',
  session: 'session',
  post: 'post',
  pr: 'pull request',
};

const STAGE_TEXT: Record<SwarmStage, string> = {
  backlog: 'Open issue, claimable',
  held: 'Issue on hold',
  claimed: 'Claimed: worked in its branch',
  review: 'Pull request waiting for review',
  changes: 'Changes requested',
  approved: 'Approved, waiting for the merger',
  merged: 'Merged',
  closed: 'Closed',
};

/** The protocol's stages as a pipeline, left to right; the last one is where progress lands. */
const PIPELINE: { key: string; label: string; stages: SwarmStage[]; bar: string }[] = [
  { key: 'open', label: 'open', stages: ['backlog', 'held'], bar: 'bg-fg-3/30' },
  { key: 'branch', label: 'in a branch', stages: ['claimed'], bar: 'bg-series-1/70' },
  { key: 'review', label: 'in review', stages: ['review', 'changes'], bar: 'bg-warning/80' },
  { key: 'approved', label: 'approved', stages: ['approved'], bar: 'bg-good/60' },
  { key: 'merged', label: 'merged', stages: ['merged'], bar: 'bg-good' },
];

const AGO_UNITS: [number, string][] = [
  [86_400_000, 'd'],
  [3_600_000, 'h'],
  [60_000, 'm'],
];

const ago = (at: string) => {
  const ms = Date.now() - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60_000) return 'now';
  const [unit, label] = AGO_UNITS.find(([u]) => ms >= u)!;
  return `${Math.floor(ms / unit)}${label}`;
};

type PipelineBarProps = {
  stages: Record<SwarmStage, number>;
};

/** Every issue the swarm has taken on, by where it is in the protocol. Merged fills from the left. */
const PipelineBar = ({ stages }: PipelineBarProps) => {
  const parts = PIPELINE.map((p) => ({ ...p, n: p.stages.reduce((a, s) => a + stages[s], 0) }));
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return null;
  const merged = stages.merged;
  // Merged first, so the filled share grows left to right like a progress bar.
  const ordered = [parts[4], parts[3], parts[2], parts[1], parts[0]];
  return (
    <div className="relative border-b border-line px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Typography variant="meta" as="div">
          <span className="font-mono text-lg font-semibold tabular text-fg">
            {Math.round((merged / total) * 100)}%
          </span>{' '}
          of {total} issues merged
        </Typography>
        <ul className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-fg-3">
          {ordered.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2 rounded-sm', p.bar)} aria-hidden="true" />
              <span className="font-mono tabular text-fg-2">{p.n}</span> {p.label}
            </li>
          ))}
        </ul>
      </div>
      <div
        className="mt-2 flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-line/50"
        role="img"
        aria-label={parts.map((p) => `${p.n} ${p.label}`).join(', ')}
      >
        {ordered.map(
          (p) =>
            p.n > 0 && (
              <div
                key={p.key}
                className={cn(
                  'relative h-full overflow-hidden transition-[width] duration-1000 ease-out first:rounded-l-full last:rounded-r-full',
                  p.bar,
                )}
                style={{ width: `${(p.n / total) * 100}%` }}
              >
                {p.key === 'merged' && (
                  <span
                    className="absolute inset-y-0 left-0 w-1/3 animate-bar-shimmer bg-linear-to-r from-transparent via-white/35 to-transparent"
                    aria-hidden="true"
                  />
                )}
              </div>
            ),
        )}
      </div>
    </div>
  );
};

type Hover = { node: SwarmNode; x: number; y: number; width: number };
type Tick = SwarmFlow & { key: string; source: 'live' | 'replay'; line: string };

type NodeCardProps = {
  node: SwarmNode;
};

const NodeCard = ({ node }: NodeCardProps) => {
  if (node.kind === 'agent' && node.agent) {
    const a = node.agent;
    return (
      <>
        <Typography variant="sectionTitle" as="div">
          {node.label}
        </Typography>
        <Typography variant="meta" as="div">
          {a.role} ·{' '}
          {node.active ? 'working now' : `seen ${formatDay(a.lastSeen)} ${formatTime(a.lastSeen)}`}
        </Typography>
        {a.activity && (
          <Typography variant="small" as="div" className="mt-1">
            {a.activity}
          </Typography>
        )}
        <Typography variant="meta" as="div" className="mt-1">
          effort logged{' '}
          <span className="font-mono tabular text-fg-2">{Math.round(node.effort)}</span>
        </Typography>
      </>
    );
  }
  if (node.kind === 'work' && node.workItem) {
    const w = node.workItem;
    return (
      <>
        <Typography variant="sectionTitle" as="div">
          {w.title}
        </Typography>
        <Typography variant="meta" as="div">
          {STAGE_TEXT[w.stage]}
          {w.issue ? ` · issue #${w.issue}` : ''}
          {w.pr ? ` · PR #${w.pr}` : ''}
        </Typography>
        {w.branch && node.phase !== 'issue' && (
          <Typography variant="meta" as="div" className="mt-1 break-all font-mono text-fg-2">
            {w.branch}
          </Typography>
        )}
      </>
    );
  }
  if (node.kind === 'sector' && node.sector) {
    return (
      <>
        <Typography variant="sectionTitle" as="div">
          {node.label}
        </Typography>
        {node.sector.paths && (
          <Typography variant="meta" as="div" className="font-mono">
            {node.sector.paths.join(' ')}
          </Typography>
        )}
        <Typography variant="meta" as="div" className="mt-1">
          {node.sector.count ? (
            <span className="font-mono tabular text-fg-2">{countText(node.sector.count)}</span>
          ) : (
            'nothing counted yet'
          )}
          {node.active && <span className="text-good-text"> · live</span>}
        </Typography>
      </>
    );
  }
  return (
    <>
      <Typography variant="sectionTitle" as="div" className="font-mono">
        {node.label}
      </Typography>
      <Typography variant="meta" as="div">
        integration branch · merged effort{' '}
        <span className="font-mono tabular text-fg-2">{Math.round(node.effort)}</span>
      </Typography>
    </>
  );
};

type PresetSwitchProps = {
  value: SwarmPresetId;
  onChange: (id: SwarmPresetId) => void;
};

/** Who the feed is for: a segmented control, a select on phones. Filters events, never nodes. */
const PresetSwitch = ({ value, onChange }: PresetSwitchProps) => (
  <div className="relative flex items-center gap-2 border-b border-line px-4 py-2">
    <Typography variant="label" as="span" className="shrink-0">
      Show
    </Typography>
    <div
      role="group"
      aria-label="Events shown"
      className="hidden items-center gap-0.5 rounded-md border border-line bg-panel p-0.5 sm:flex"
    >
      {PRESETS.map((p) => (
        <Button
          key={p.id}
          variant="segment"
          size="xs"
          aria-pressed={p.id === value}
          title={p.who}
          onClick={() => onChange(p.id)}
        >
          {p.label}
        </Button>
      ))}
    </div>
    <select
      aria-label="Events shown"
      value={value}
      onChange={(e) => onChange(e.target.value as SwarmPresetId)}
      className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-xs text-fg sm:hidden"
    >
      {PRESETS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
    <Typography variant="meta" as="span" className="hidden truncate lg:inline">
      {PRESETS.find((p) => p.id === value)?.who}
    </Typography>
  </div>
);

type SwarmGraphProps = {
  input: SwarmInput;
  /** What the row mapping knows about the run; kept current from Realtime on the client. */
  context: ArenaEventContext;
  /** Each engine's node: rating, version timeline, latest game. */
  engines: EngineNode[];
  /** The game each engine is playing right now (`liveGames()`); followed from Realtime here. */
  liveGames?: Partial<Record<GameId, LiveGameRow>>;
  /** Agent ids with a fleet page; the rest (event-only actors) are not linked. */
  seatIds: string[];
  /** Sector ids with an engine page. */
  engineIds: string[];
  /** Where Rallypoint-only issues and pull requests open. */
  repoUrl: string;
  /** The preset named in the URL (`?view=`), if any. */
  view?: string | null;
  className?: string;
};

const NO_LIVE_GAMES: Partial<Record<GameId, LiveGameRow>> = {};

/** Live events kept on the client between refreshes. */
const LIVE_CAP = 400;
/** How often the live graph re-checks which dead nodes have outstayed their lifetime. */
const PRUNE_TICK_MS = 20_000;

/** A sector's count as words, e.g. `48 merged · 3 today`. */
const countText = (c: SwarmCount) =>
  [`${c.value} ${c.unit}`, c.recent ? `${c.recent} ${c.recentUnit ?? 'recent'}` : null]
    .filter(Boolean)
    .join(' · ');
const PRESET_KEY = 'swarm-graph-view';

type GroupTally = { games: number; win: number; loss: number; draw: number };

type LiveState = {
  events: SwarmEvent[];
  agents: Record<string, SwarmAgent>;
  ratings: Record<
    string,
    { elo: number | null; version: string | null; delta: number | null; at: string; key: number }
  >;
  games: Record<string, EngineGame & { at: string }>;
};

const emptyLive = (): LiveState => ({ events: [], agents: {}, ratings: {}, games: {} });

const readPreset = (view: string | null | undefined): SwarmPresetId => {
  const fromUrl = presetOf(view);
  if (fromUrl) return fromUrl.id;
  try {
    const stored = presetOf(window.localStorage.getItem(PRESET_KEY));
    if (stored) return stored.id;
  } catch {
    // Storage blocked: fall through to where the visitor came from.
  }
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.origin === window.location.origin) {
      const implied = presetForPath(ref.pathname);
      if (implied) return implied;
    }
  } catch {
    // An unreadable referrer implies nothing.
  }
  return DEFAULT_PRESET;
};

/**
 * The fleet as a live graph: the arena's mount of `@rallypoint/swarm-graph`. A Realtime row
 * becomes an event here at once, from the payload (see `realtimeEvents`), and the route refresh
 * that follows (`LiveIndicator`) brings the snapshot, which maps the same rows to the same ids.
 * Without a socket the snapshot alone draws the same events.
 */
const SwarmGraph = ({
  input,
  context,
  engines,
  liveGames = NO_LIVE_GAMES,
  seatIds,
  engineIds,
  repoUrl,
  view,
  className,
}: SwarmGraphProps) => {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<SwarmGraphRenderer | null>(null);
  const [live, setLive] = useState<LiveState>(emptyLive);
  const liveCtx = useRef(context);
  useEffect(() => {
    liveCtx.current = context;
  }, [context]);

  const [effectsMode, setEffectsMode] = useState<EffectsMode>('full');
  /** null until known: whether this browser can draw the WebGL layer at all. */
  const [webgl, setWebgl] = useState<boolean | null>(null);
  /** The layer switched itself off: this device could not keep its frame rate up. */
  const [tooSlow, setTooSlow] = useState(false);
  const effects = useRef<SwarmEffectsLayer | null>(null);
  const [haptics, setHaptics] = useState(false);
  const hapticsOn = useRef(false);
  useEffect(() => {
    hapticsOn.current = haptics;
  }, [haptics]);
  const [captions, setCaptions] = useState<{ key: string; text: string; color?: string }[]>([]);
  const captionTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [presetId, setPresetId] = useState<SwarmPresetId>(presetOf(view)?.id ?? DEFAULT_PRESET);
  const preset = presetOf(presetId) ?? PRESETS[0];
  const [reducedMotion, setReducedMotion] = useState(false);

  // The visitor's own choice (URL, then storage), else what the page they came from implies.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setPresetId(readPreset(new URLSearchParams(window.location.search).get('view')));
      setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      setEffectsMode(readStored(EFFECTS_KEY, ['off', 'calm', 'full'] as const, 'full'));
      setHaptics(readStored(HAPTICS_KEY, ['on', 'off'] as const, 'off') === 'on');
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const choosePreset = (id: SwarmPresetId) => {
    setPresetId(id);
    try {
      window.localStorage.setItem(PRESET_KEY, id);
    } catch {
      // Storage blocked: the URL still remembers it.
    }
    const url = new URL(window.location.href);
    url.searchParams.set('view', id);
    window.history.replaceState(window.history.state, '', url);
  };

  // The engines as the overlays show them (the catch-up basis while one plays).
  const shownEngines = useRef(engines);

  // One Realtime row onto the graph's live state.
  const applyChange = useCallback((change: LiveChange) => {
    if (change.eventType === 'DELETE') return;
    const table = change.table as ArenaRealtimeTable;
    if (!(table in TABLE_SUBS)) return;
    const { ctx, events } = realtimeEvents(liveCtx.current, table, change.new);
    liveCtx.current = ctx;
    const row = change.new;
    const now = new Date().toISOString();
    setLive((l) => {
      const next: LiveState = { ...l };
      if (events.length) {
        const ids = new Set(events.map((e) => e.id));
        next.events = [...l.events.filter((e) => !ids.has(e.id)), ...events].slice(-LIVE_CAP);
      }
      if (table === 'agents' && row) {
        const a = toSwarmAgent(ctx, row as unknown as Agent, now);
        next.agents = { ...l.agents, [a.id]: a };
      }
      if (table === 'tracks' && row) {
        const t = row as unknown as Track;
        const before =
          l.ratings[t.id]?.elo ?? shownEngines.current.find((e) => e.id === t.id)?.elo ?? null;
        const delta =
          t.current_elo !== null && before !== null ? Math.round(t.current_elo - before) : null;
        next.ratings = {
          ...l.ratings,
          [t.id]: {
            elo: t.current_elo,
            version: t.current_version,
            delta: delta || null,
            at: now,
            key: Date.now(),
          },
        };
      }
      if (table === 'games' && row && Array.isArray(row.moves) && row.moves.length) {
        const g = row as unknown as GameRow;
        next.games = {
          ...l.games,
          [g.track_id]: {
            ...gameOfRow(g, ctx.matches[g.match_id]?.opponent),
            at: now,
          },
        };
      }
      return next;
    });
  }, []);

  // Every event, snapshot and live, in time order.
  const events = useMemo(() => {
    const known = new Set(input.events.map((e) => e.id));
    return [...input.events, ...live.events.filter((e) => !known.has(e.id))].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
  }, [input.events, live.events]);

  // After a hidden tab or a big jump, the missed events play back in order instead of landing.
  const shows = useCallback((e: SwarmEvent) => showsFlow(preset, { sub: e.sub ?? null }), [preset]);
  const finishCatchUp = useCallback(
    (basis: { engines: EngineNode[] }) => {
      // Ratings the playback did not step through count up from where they stood.
      const now = new Date().toISOString();
      setLive((l) => {
        const ratings = { ...l.ratings };
        for (const e of engines) {
          const from = basis.engines.find((b) => b.id === e.id);
          const shownElo = l.ratings[e.id]?.elo ?? from?.elo ?? null;
          if (e.elo === null || shownElo === null || e.elo === shownElo) continue;
          if (l.ratings[e.id] && l.ratings[e.id].at > input.asOf) continue;
          ratings[e.id] = {
            elo: e.elo,
            version: e.version,
            delta: Math.round(e.elo - shownElo) || null,
            at: now,
            key: Date.now(),
          };
        }
        return { ...l, ratings };
      });
    },
    [engines, input.asOf],
  );
  const { catchUp, offer, skip, takeQuiet } = useCatchUp({
    events,
    shows,
    input,
    engines,
    reducedMotion,
    apply: applyChange,
    onFinish: finishCatchUp,
  });
  const basisInput = catchUp?.basis.input ?? input;
  const basisEngines = catchUp?.basis.engines ?? engines;
  useEffect(() => {
    shownEngines.current = basisEngines;
  }, [basisEngines]);

  // Realtime rows, straight onto the graph (held back while catching up).
  useEffect(
    () =>
      onLive((change) => {
        // Tables the graph does not draw (live-game moves, above all) are never held (#197).
        if (!(change.table in TABLE_SUBS)) return;
        if (!offer(change)) applyChange(change);
      }),
    [offer, applyChange],
  );

  // The snapshot, with whatever Realtime has said since it was read. The snapshot wins where
  // both speak, so the refresh that follows a live row never disagrees with it. While a
  // catch-up plays, agents start from where they stood and step forward with the held rows.
  const merged = useMemo<SwarmInput>(() => {
    const agents = basisInput.agents.map((a) => {
      const l = live.agents[a.id];
      return l && l.lastSeen > a.lastSeen ? l : a;
    });
    const seen = new Set(agents.map((a) => a.id));
    for (const a of Object.values(live.agents)) if (!seen.has(a.id)) agents.push(a);
    return { ...input, agents, events };
  }, [input, basisInput, live.agents, events]);

  // Dead nodes leave the live graph (`LIFETIMES`); the clock ticks so they do without a refresh.
  // It starts at the snapshot's time, so the server and the first client render agree. It stops
  // while the tab is hidden (nothing to draw) and ticks once on return (#197).
  const [clock, setClock] = useState(() => Date.parse(input.asOf));
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'hidden') setClock(Date.now());
    };
    const first = requestAnimationFrame(tick);
    const id = setInterval(tick, PRUNE_TICK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  /** While a replay plays, pruning is measured from its window's start: whatever was alive then. */
  const [pruneFrom, setPruneFrom] = useState<string | null>(null);
  const graph = useMemo(
    () =>
      buildSwarmGraph(merged, {
        lifetimes: presetId === 'all' ? LIFETIMES.everything : LIFETIMES.live,
        now: pruneFrom ?? new Date(Math.max(clock, Date.parse(merged.asOf))).toISOString(),
      }),
    [merged, presetId, pruneFrom, clock],
  );
  const shownGraph = useMemo(
    () => ({ ...graph, flows: graph.flows.filter((f) => showsFlow(preset, f)) }),
    [graph, preset],
  );
  /** What the renderer gets: during a catch-up, only the events played so far. */
  const presented = useMemo(
    () =>
      catchUp
        ? { ...shownGraph, flows: shownGraph.flows.filter((f) => catchUp.released.has(f.id)) }
        : shownGraph,
    [shownGraph, catchUp],
  );

  const [hover, setHover] = useState<Hover | null>(null);
  const [ticker, setTicker] = useState<Tick[]>([]);
  const groups = useRef(new Map<string, GroupTally>());
  const [replay, setReplay] = useState<SwarmReplayState | null>(null);
  const [replayPlan, setReplayPlan] = useState<SwarmReplayPlan | null>(null);
  const replaying = replayPlan !== null;
  const liveBoards = useLiveBoards(liveGames);

  // Callbacks read the latest props through a ref so the renderer is created once.
  const { hovered, setHovered } = useFleetHover();
  const links = useRef({
    seatIds: new Set(seatIds),
    engineIds: new Set(engineIds),
    router,
    setHovered,
    repoUrl,
    preset,
  });
  useEffect(() => {
    links.current = {
      seatIds: new Set(seatIds),
      engineIds: new Set(engineIds),
      router,
      setHovered,
      repoUrl,
      preset,
    };
  }, [seatIds, engineIds, router, setHovered, repoUrl, preset]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const r = createSwarmGraph(el, {
      title: 'Agents and the sectors of the codebase they are working in',
      reducedMotion: reduced,
      intro: introMode(),
      onHover: (node, point) => {
        setHover(node && point ? { node, ...point, width: el.clientWidth } : null);
        // Mirror the graph's hover onto the fleet's cards.
        const id = node?.kind === 'agent' ? node.agent?.id : undefined;
        links.current.setHovered((h) =>
          id ? { agentId: id, source: 'graph' } : h?.source === 'graph' ? null : h,
        );
      },
      onSelect: (node) => {
        const { seatIds: seats, engineIds: engs, router: nav } = links.current;
        if (node.kind === 'agent' && node.agent && seats.has(node.agent.id))
          nav.push(agentHref(node.agent.id));
        else if (node.kind === 'work' && node.workItem) {
          const w = node.workItem;
          // Arena tasks have a page; Rallypoint-only work opens on GitHub.
          if (!w.id.startsWith('gh-')) nav.push(`/tasks/${encodeURIComponent(w.id)}`);
          else if (w.pr ?? w.issue)
            window.open(
              `${links.current.repoUrl}/${w.pr ? 'pull' : 'issues'}/${w.pr ?? w.issue}`,
              '_blank',
              'noopener',
            );
        } else if (node.kind === 'sector' && node.sectorId && engs.has(node.sectorId))
          nav.push(`/engines/${node.sectorId}`);
      },
      effectOf: arenaEffectOf,
      onEffect: (e) => effects.current?.effect(e),
      onFlow: (flow, source) => {
        effects.current?.flow(flow);
        if (source === 'replay' && replayMilestone(flow)) {
          // Milestones get a one-line caption that dissolves, and (if asked) a haptic tick.
          const key = `${flow.id}-${Date.now()}`;
          const text =
            arenaEffectOf(flow) === 'rung'
              ? flow.title
              : (links.current.preset.word?.(flow) ?? flow.title);
          setCaptions((c) => [
            ...c.slice(-(CAPTIONS - 1)),
            { key, text, color: flow.sector ?? undefined },
          ]);
          const t = setTimeout(() => {
            captionTimers.current.delete(t);
            setCaptions((c) => c.filter((x) => x.key !== key));
          }, CAPTION_MS);
          captionTimers.current.add(t);
          if (hapticsOn.current && 'vibrate' in navigator) navigator.vibrate(12);
        }
        const p = links.current.preset;
        const title = p.word?.(flow) ?? flow.title;
        const key = flow.group ? `group:${flow.group.id}` : `${source}-${flow.id}-${Date.now()}`;
        let line = title;
        if (flow.group) {
          // A burst (one match's start, games, verdict and rating) is one line that updates.
          const g = groups.current.get(flow.group.id) ?? { games: 0, win: 0, loss: 0, draw: 0 };
          if (flow.sub === 'game' && flow.outcome) {
            g.games++;
            g[flow.outcome]++;
          }
          groups.current.delete(flow.group.id);
          groups.current.set(flow.group.id, g);
          for (const k of groups.current.keys()) {
            if (groups.current.size <= GROUP_CAP) break;
            groups.current.delete(k);
          }
          if (g.games > 1)
            line = `${flow.group.title}: ${g.games} games, ${g.win}–${g.loss}${g.draw ? `–${g.draw}` : ''}`;
        }
        setTicker((t) =>
          [{ ...flow, source, key, line }, ...t.filter((x) => x.key !== key)].slice(0, TICKER),
        );
      },
      onReplay: (state) => {
        setReplay(state);
        if (!state) setReplayPlan(null);
        // At the replay's "now" end the live pruning applies again.
        if (!state || state.done) setPruneFrom(null);
      },
    });
    renderer.current = r;
    // Overlays mounted before the renderer existed pin themselves now.
    el.parentElement
      ?.querySelectorAll<HTMLElement>('[data-slot="swarm-node-overlay"]')
      .forEach((o) => o.dataset.nodeId && r.anchor(o.dataset.nodeId, o));
    const timers = captionTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
      r.destroy();
      renderer.current = null;
    };
  }, []);

  // The three.js layer: loaded on demand, only here, only with motion and WebGL.
  const effectsBlocked = reducedMotion || webgl === false || tooSlow;
  const effectsOn = effectsMode !== 'off' && !effectsBlocked;
  const effectsKind: 'calm' | 'full' = effectsMode === 'calm' ? 'calm' : 'full';
  const initialKind = useRef(effectsKind);
  useEffect(() => {
    initialKind.current = effectsKind;
    effects.current?.setMode(effectsKind);
  }, [effectsKind]);
  useEffect(() => {
    const el = host.current;
    const r = renderer.current;
    if (!effectsOn || !el || !r) return;
    let layer: SwarmEffectsLayer | null = null;
    let cancelled = false;
    import('@/lib/swarmEffects')
      .then(({ createSwarmEffects }) => {
        if (cancelled) return;
        layer = createSwarmEffects(el, r, {
          mode: initialKind.current,
          gateOf,
          onGiveUp: () => setTooSlow(true),
        });
        if (!layer) {
          setWebgl(false);
          return;
        }
        setWebgl(true);
        effects.current = layer;
        // For frame-time measurement from a test or the console.
        (window as unknown as { __swarmEffects?: SwarmEffectsLayer }).__swarmEffects = layer;
      })
      .catch(() => !cancelled && setWebgl(false));
    return () => {
      cancelled = true;
      layer?.destroy();
      if (effects.current === layer) effects.current = null;
      const w = window as unknown as { __swarmEffects?: SwarmEffectsLayer };
      if (w.__swarmEffects === layer) delete w.__swarmEffects;
    };
  }, [effectsOn]);
  const chooseEffects = (m: EffectsMode) => {
    setEffectsMode(m);
    store(EFFECTS_KEY, m);
  };
  const toggleHaptics = () => {
    setHaptics((h) => {
      store(HAPTICS_KEY, h ? 'off' : 'on');
      return !h;
    });
  };

  // A preset change shows other events but is not news: take it without sparking the history.
  const lastPreset = useRef(preset.id);
  // A coalesced catch-up batch lands without sparking too.
  useEffect(() => {
    const quiet = takeQuiet() || lastPreset.current !== preset.id;
    lastPreset.current = preset.id;
    renderer.current?.update(presented, { quiet });
    if (renderer.current && presented.nodes.length > 0) introShownAt ??= performance.now();
  }, [presented, preset.id, takeQuiet]);

  // A card under the pointer, or an agent chip, lights up its agent's node.
  const [chipAgent, setChipAgent] = useState<string | null>(null);
  const fromCard = chipAgent ?? (hovered?.source === 'card' ? hovered.agentId : null);
  useEffect(() => {
    renderer.current?.highlight(fromCard ? agentNodeId(fromCard) : null);
  }, [fromCard, graph]);

  const sectors = graph.nodes.filter((n) => n.kind === 'sector');
  const colorById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.color])), [graph]);
  /** A flow takes the colour of the sector-side node it touches last. */
  const flowColor = (t: Tick) =>
    [...t.path]
      .reverse()
      .map((id) => colorById.get(id))
      .find(Boolean) ?? undefined;
  /** The last 24 actively worked hours (or the whole run), from the state when it began. */
  const startReplay = (mode: SwarmReplayMode = 'window') => {
    const plan = planReplay(shownGraph.flows, shownGraph.hubId, {
      mode,
      durationMs: 60_000,
      isMilestone: replayMilestone,
    });
    if (!plan.flows.length) return;
    setTicker([]);
    groups.current.clear();
    // The renderer reports the old replay stopping first; the new plan must land after that.
    renderer.current?.replay(plan);
    setReplayPlan(plan);
    setPruneFrom(plan.startAt);
  };
  const stopReplay = () => {
    renderer.current?.stopReplay();
    setReplayPlan(null);
    setReplay(null);
    setCaptions([]);
  };
  const replayPlaying = Boolean(replay?.playing);
  useEffect(() => {
    effects.current?.setReplaying(replayPlaying);
  }, [replayPlaying, webgl]);
  const replaySummary = useMemo(
    () => (replayPlan ? summarizeReplay(replayPlan) : null),
    [replayPlan],
  );
  /** Each engine's rating change still to come in the window, from the playhead to the end. */
  const replayEnd = useMemo(
    () =>
      replayPlan
        ? stateAt(replayPlan.seed, replayPlan.flows, replayPlan.flows.length, replayPlan.hubId)
        : null,
    [replayPlan],
  );
  const sectorColors = useMemo(
    () =>
      new Map(
        graph.nodes.filter((n) => n.kind === 'sector').map((n) => [n.sectorId ?? '', n.color]),
      ),
    [graph],
  );
  const sectorLabels = useMemo(
    () =>
      new Map(
        graph.nodes.filter((n) => n.kind === 'sector').map((n) => [n.sectorId ?? '', n.label]),
      ),
    [graph],
  );
  const replayClock = useCallback(() => renderer.current?.replayClock() ?? null, []);

  // Node overlays: rating, live agents and latest game, in every preset.
  const items = useMemo(() => new Map(merged.workItems.map((w) => [w.id, w])), [merged]);
  const seatSet = useMemo(() => new Set(seatIds), [seatIds]);
  const engineById = useMemo(
    () => new Map(basisEngines.map((e) => [e.id as string, e])),
    [basisEngines],
  );
  const anchor = useCallback(
    (nodeId: string, el: HTMLElement | null) => renderer.current?.anchor(nodeId, el),
    [],
  );
  const liveIn = (sectorId: string) =>
    merged.agents
      .filter((a) => a.status === 'working' && a.sector === sectorId)
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const liveRatingOf = (e: EngineNode): NodeRating => {
    const l = live.ratings[e.id];
    return l && l.at > basisInput.asOf
      ? { elo: l.elo, version: l.version, delta: l.delta, key: l.key }
      : { elo: e.elo, version: e.version, delta: null, key: 0 };
  };
  /** During a replay a rating stands where it stood at the playhead and counts up from there. */
  const ratingOf = (e: EngineNode): NodeRating => {
    const now = liveRatingOf(e);
    if (!replay || !replayPlan || !replayEnd || now.elo === null) return now;
    const ahead = (replayEnd.rating[e.id] ?? 0) - (replay.snapshot.rating[e.id] ?? 0);
    let last = -1;
    for (let i = replay.index - 1; i >= 0; i--) {
      const f = replayPlan.flows[i];
      if (f.kind === 'rating' && f.sector === e.id && f.delta) {
        last = i;
        break;
      }
    }
    return {
      elo: now.elo - ahead,
      version: now.version,
      delta: last >= 0 ? replayPlan.flows[last].delta : null,
      key: last + 1,
    };
  };
  // Outside a replay a node shows only the game its engine is playing now (#163); a replay may
  // show the games of the window it replays.
  const boardOf = (e: EngineNode): EngineBoardSource | null => {
    if (!replaying) return liveBoards[e.id] ?? null;
    const l = live.games[e.id];
    const g = l && (!e.latestGame || l.finishedAt > e.latestGame.finishedAt) ? l : e.latestGame;
    return g ? { kind: 'finished', game: g } : null;
  };

  return (
    <section
      data-slot="swarm-graph"
      className={cn('relative overflow-hidden rounded-lg border border-line bg-panel', className)}
    >
      <div className="swarm-graph-ground pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <Typography variant="sectionTitle">Swarm graph</Typography>
          <Typography variant="meta">
            Rallypoint, live: issues are claimed into <span className="font-mono">agent/</span>{' '}
            branches forked from{' '}
            <span className="font-mono text-fg-2">{input.integrationBranch}</span>, worked in
            worktrees, opened as pull requests, reviewed, and merged back into the sector they
            change.
          </Typography>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="flex items-center rounded-md border border-line p-0.5"
            role="group"
            aria-label="Effects"
            title={
              reducedMotion
                ? 'Effects are off: your system asks for reduced motion'
                : webgl === false
                  ? 'Effects need WebGL, which this browser does not offer'
                  : tooSlow
                    ? 'Effects switched themselves off: this device could not keep the frame rate up'
                    : 'Particle and light effects'
            }
          >
            <Sparkles className="mx-1 size-3.5 text-fg-3" aria-hidden="true" />
            {EFFECT_MODES.map((m) => (
              <Button
                key={m.id}
                variant="segment"
                size="xs"
                title={m.title}
                aria-pressed={(effectsBlocked ? 'off' : effectsMode) === m.id}
                disabled={effectsBlocked && m.id !== 'off'}
                onClick={() => chooseEffects(m.id)}
              >
                {m.label}
              </Button>
            ))}
          </div>
          {replaying ? (
            <Button size="sm" onClick={stopReplay}>
              <Square className="size-3.5" aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => startReplay('window')}
              disabled={shownGraph.flows.length === 0 || catchUp !== null}
              title="Play back the last 24 actively worked hours; choose the whole run on the timeline"
            >
              <History className="size-3.5" aria-hidden="true" />
              Replay last 24 h
            </Button>
          )}
          <Button
            variant="icon"
            size="icon"
            onClick={() => renderer.current?.reset()}
            aria-label="Recentre graph"
            title="Recentre"
          >
            <Crosshair className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <PresetSwitch value={preset.id} onChange={choosePreset} />

      <PipelineBar stages={graph.totals.stages} />

      <div className="relative">
        <div ref={host} className="relative isolate h-120 w-full sm:h-150" />

        {captions.length > 0 && (
          <ol
            data-slot="replay-captions"
            className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-1"
            aria-live="polite"
          >
            {captions.map((c) => (
              <li
                key={c.key}
                className="flex max-w-[min(28rem,calc(100%-2rem))] items-center gap-2 truncate rounded-md border border-line bg-panel-raised/85 px-2.5 py-1 text-xs text-fg shadow-md backdrop-blur-sm animate-caption motion-reduce:animate-none"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: (c.color && sectorColors.get(c.color)) || 'var(--fg-2)' }}
                  aria-hidden="true"
                />
                <span className="truncate">{c.text}</span>
              </li>
            ))}
          </ol>
        )}

        {sectors.map((n) => {
          const engine = engineById.get(n.sectorId ?? '') ?? null;
          return (
            <SwarmNodeOverlay
              key={n.id}
              nodeId={n.id}
              anchor={anchor}
              engine={engine}
              rating={engine ? ratingOf(engine) : null}
              board={engine ? boardOf(engine) : null}
              agents={liveIn(n.sectorId ?? '')}
              items={items}
              agentDetail={preset.agentDetail}
              seatIds={seatSet}
              reducedMotion={reducedMotion}
              repoUrl={repoUrl}
              onHighlight={setChipAgent}
            />
          );
        })}

        {catchUp?.phase === 'draining' && catchUp.left > 0 && !replay && (
          <div
            data-slot="swarm-catch-up"
            className="absolute inset-x-0 top-3 flex justify-center"
            role="status"
          >
            <div className="flex items-center gap-2 rounded-md border border-line bg-panel-raised py-1 pr-1 pl-3 text-xs text-fg-2 shadow-lg">
              <span>
                Catching up · <span className="font-mono tabular text-fg">{catchUp.left}</span>{' '}
                event
                {catchUp.left === 1 ? '' : 's'}
              </span>
              <Button variant="ghost" size="xs" onClick={skip}>
                Skip
              </Button>
            </div>
          </div>
        )}

        {ticker.length > 0 && (
          <ol
            className="pointer-events-none absolute bottom-3 left-3 max-w-[min(22rem,calc(100%-1.5rem))] space-y-1"
            aria-live="polite"
          >
            {ticker.map((t, i) => (
              <li
                key={t.key}
                className={cn(
                  'flex items-center gap-2 truncate rounded-md border border-line bg-panel-raised/90 px-2 py-1 text-xs shadow-md backdrop-blur-sm transition-opacity duration-500 animate-record-in motion-reduce:animate-none',
                  i === 0 && t.kind === 'merge' && 'border-good/60',
                  i > 0 && 'opacity-80',
                  i > 2 && 'opacity-45',
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: flowColor(t) }}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    'shrink-0 font-mono text-[10px] uppercase tracking-[0.15em]',
                    t.kind === 'merge' && 'text-good-text',
                    t.kind === 'reject' && 'text-critical-text',
                    t.kind !== 'merge' && t.kind !== 'reject' && 'text-fg-3',
                  )}
                >
                  {FLOW_VERB[t.kind]}
                </span>
                <span className="truncate text-fg-2">{t.line}</span>
                {t.source === 'live' && (
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-3">
                    {ago(t.at)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}

        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-panel-raised px-3 py-2 shadow-xl"
            style={{
              left: Math.max(136, Math.min(hover.x, hover.width - 136)),
              top: hover.y - 14,
            }}
          >
            <NodeCard node={hover.node} />
          </div>
        )}
      </div>

      {replayPlan && replay && replaySummary && (
        <ReplayScrubber
          plan={replayPlan}
          state={replay}
          summary={replaySummary}
          colors={sectorColors}
          labels={sectorLabels}
          reducedMotion={reducedMotion}
          clock={replayClock}
          onSeek={(i) => renderer.current?.seek(i)}
          onSeekTime={(ms) => renderer.current?.seekTime(ms)}
          onPlaying={(p) => renderer.current?.setPlaying(p)}
          onSpeed={(v) => renderer.current?.setSpeed(v)}
          onMode={(m) => m !== replayPlan.mode && startReplay(m)}
          onScrubbing={(on) => effects.current?.setScrubbing(on)}
          haptics={haptics}
          onHaptics={toggleHaptics}
          onClose={stopReplay}
        />
      )}

      <ul className="relative flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5 text-xs text-fg-3">
        {sectors.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ background: s.color ?? undefined }}
              aria-hidden="true"
            />
            <span className={cn(s.active && 'text-fg')}>{s.label}</span>
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 sm:ml-auto">
          <span className="size-2.5 rounded-full border border-fg-2" aria-hidden="true" /> agent
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full border border-dashed border-fg-3"
            aria-hidden="true"
          />{' '}
          issue
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rotate-45 border border-fg-2" aria-hidden="true" /> branch
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-fg-2 bg-fg-3/30" aria-hidden="true" />{' '}
          pull request
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-fg-3/60" aria-hidden="true" /> merged
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-px w-4 bg-fg-3" aria-hidden="true" /> past effort
        </li>
        <li className="font-mono tabular">
          {graph.totals.live} live · {graph.totals.branches} branch
          {graph.totals.branches === 1 ? '' : 'es'} · {graph.totals.pullRequests} PR
          {graph.totals.pullRequests === 1 ? '' : 's'}
        </li>
      </ul>
    </section>
  );
};

export { SwarmGraph };

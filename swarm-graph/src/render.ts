/**
 * The swarm graph renderer: plain D3 on an SVG, no framework. It owns a force simulation that
 * keeps node positions across updates, so a host can call `update()` with every new snapshot
 * (a realtime push, a poll) and the graph moves instead of redrawing.
 *
 * Effort is drawn as motion: live agents stream particles into the work they hold, work flows
 * into its sector, sectors feed the integration branch, and every new event fires a spark from
 * whoever logged it to where it landed. `replay()` plays a planned window of the event history
 * back (see `replay.ts`), from the state the graph had when that window opened.
 */
import * as d3 from 'd3';
import type { SwarmFlow, SwarmGraph, SwarmLink, SwarmNode, SwarmStage } from './model';
import {
  FULL_INTRO,
  SHORT_INTRO,
  easeOut,
  introCamera,
  introEdge,
  introLabels,
  introPose,
  planIntro,
  type IntroPlan,
} from './intro';
import {
  ARRIVAL,
  DEPARTURE,
  arrivalPose,
  arrivalTarget,
  departurePose,
  progressAt,
  staggerAt,
  type Pose,
} from './lifecycle';
import {
  applyFlow,
  indexAtTime,
  planReplay,
  sparksAt,
  stateAt,
  type SwarmReplayPlan,
  type SwarmReplaySnapshot,
} from './replay';
import { beamTier, createBeamGate } from './beams';

export type SwarmGraphTheme = {
  fg: string;
  fgMuted: string;
  fgFaint: string;
  line: string;
  lineStrong: string;
  panel: string;
  panelRaised: string;
  /** Colour for nodes whose sector has none. */
  neutral: string;
  good: string;
  warning: string;
  critical: string;
  font: string;
  monoFont: string;
};

export type SwarmReplayState = {
  /** Time of the last event played (the window's start before any has). */
  at: string;
  /** Events played so far. */
  index: number;
  total: number;
  playing: boolean;
  speed: number;
  /** The playhead reached the end; the replay stays up until stopped. */
  done: boolean;
  /** The state at the playhead: seed plus the events played. */
  snapshot: SwarmReplaySnapshot;
  /** The real length of the idle pause just crossed, if the last event followed one. */
  gapMs: number | null;
};

/**
 * What an event did when it landed, for a host's effects layer: `merge`, `rating` (a rating
 * changed: `delta` says by how much), `rung` (a ladder rung cleared), `milestone` (any other),
 * `bury` (an idea abandoned: shown gently, never as an alarm), `reject` (changes asked), `pass`
 * (a spark crossed a node on its way). `clear` means the replay jumped: drop what is in flight.
 */
export type SwarmEffectKind =
  'merge' | 'rating' | 'rung' | 'milestone' | 'bury' | 'reject' | 'pass' | 'clear';

export type SwarmEffect = {
  kind: SwarmEffectKind;
  /** Where it happened (empty for `clear`). */
  nodeId: string;
  color: string;
  delta: number | null;
  source: 'live' | 'replay';
  flow: SwarmFlow | null;
};

/** A node as an effects layer reads it each frame: graph coordinates, radius, colour. */
export type SwarmNodeView = SwarmNode & { x?: number; y?: number; r: number };

/** The graph's camera for an effects layer: screen px = size / 2 + (x, y) + k · graph. */
export type SwarmViewport = {
  width: number;
  height: number;
  x: number;
  y: number;
  k: number;
  /** The viewer has panned or zoomed away from the fitted view. */
  moved: boolean;
};

/** Where an anchored host element sits: beside its node, or over it as its bounding square. */
export type SwarmAnchorPlacement = 'beside' | 'inside';

export type SwarmGraphRendererOptions = {
  theme?: Partial<SwarmGraphTheme>;
  /** Turns off ambient motion; event sparks and replay still show, without particles. */
  reducedMotion?: boolean;
  /** Pointer over a node (`null` when it leaves). `point` is relative to the container. */
  onHover?: (node: SwarmNode | null, point: { x: number; y: number } | null) => void;
  onSelect?: (node: SwarmNode) => void;
  /** A new event reached the graph (live) or was played back (replay). */
  onFlow?: (flow: SwarmFlow, source: 'live' | 'replay') => void;
  onReplay?: (state: SwarmReplayState | null) => void;
  /** An event landed (or a spark crossed a node): for a host's particle layer. */
  onEffect?: (effect: SwarmEffect) => void;
  /**
   * What a landed event is, for its payoff. The default knows the model's kinds (merge,
   * milestone, rating, reject); a host refines it (a rung cleared, an idea buried).
   */
  effectOf?: (flow: SwarmFlow) => SwarmEffectKind | null;
  /**
   * How the first render appears: `full` unfolds the graph radially from the hub (about 1.4 s),
   * `short` plays a quicker version (about 0.5 s, for coming back to the page), `none` shows the
   * settled layout at once. Reduced motion always means `none`. Later updates never replay it.
   */
  intro?: 'full' | 'short' | 'none';
  /** Accessible name for the SVG. */
  title?: string;
  /**
   * A sector's radius in graph units at full size, from no effort (`min`) to the most (`max`).
   * Default 18 to 48. A host that draws a sector's information inside it (`anchor(…, 'inside')`)
   * raises it so the text fits. Narrow canvases scale it down.
   */
  sectorRadius?: { min: number; max: number };
};

export type SwarmUpdateOptions = {
  /**
   * Take the new graph without firing its unseen events: a host that changes which events it
   * shows (a filter) passes this so the newly visible history does not spark as if it were new.
   */
  quiet?: boolean;
  /**
   * The same data seen another way (a preset switch): the nodes shown before and after hold
   * where they are while the ones that arrive or leave fade in or out, so the view does not
   * shake. They are let go once the layout has settled; later data moves them as usual.
   */
  view?: boolean;
};

export type SwarmGraphRenderer = {
  update: (graph: SwarmGraph, options?: SwarmUpdateOptions) => void;
  /**
   * Pin a host element to a node: every frame the renderer sets its CSS `transform` (from the
   * container's top left, zoom and pan included). `beside` (the default) puts it beside the node
   * on the side away from the centre, inside the canvas, and sets `data-side` to `left` or
   * `right`. `inside` makes it the node's bounding square (`width` = `height` = the node's
   * diameter on screen, `--node-r` its radius in px), so a host draws the node's information in
   * its circle; the renderer then draws no name, sub-line or count of its own for that node, and
   * keeps edges from showing through its body. It is hidden while the node is not on the graph.
   * `null` releases it.
   */
  anchor: (nodeId: string, el: HTMLElement | null, placement?: SwarmAnchorPlacement) => void;
  /**
   * Play a planned replay (`planReplay`), or the whole history over `durationMs` (default 30 s).
   * The graph starts from the plan's seed state and ends at the live state.
   */
  replay: (plan?: SwarmReplayPlan | number) => void;
  stopReplay: () => void;
  /** Pause or resume the running replay. */
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  /** Jump to the state after `index` events have played, and continue from there. */
  seek: (index: number) => void;
  /** Jump to a playback offset (ms) on the plan's schedule. */
  seekTime: (ms: number) => void;
  /** The playhead's offset (ms) on the plan's schedule, for a host animating a scrubber. */
  replayClock: () => number | null;
  /**
   * Emphasise a node as if the pointer were on it, from outside the graph (a list item the
   * host links to it, say). `null` clears it. Does not call `onHover`, so hosts can mirror the
   * graph's hover into their own UI and back without a loop.
   */
  highlight: (nodeId: string | null) => void;
  /** Recentre and reset zoom. */
  reset: () => void;
  /** The camera, for an effects layer drawing in the same space (one reused object). */
  viewport: () => SwarmViewport;
  /** Every node with its position this frame. */
  eachNode: (fn: (node: SwarmNodeView) => void) => void;
  /**
   * Every beam in flight: its head this frame, colour and size. `big` marks the few beams that
   * carry a big moment (a merge, a rung cleared, a rating jump): the only ones allowed to glow.
   * Ambient effort streams are not beams and are not reported.
   */
  eachSpark: (
    fn: (x: number, y: number, color: string, size: number, big: boolean) => void,
  ) => void;
  /** A node's position and radius this frame, or null. */
  nodeAt: (id: string) => SwarmNodeView | null;
  /**
   * A GPU layer draws the trails and bursts: the SVG keeps spark heads, ripples and words but
   * stops drawing its own comet tails and spark bursts, so the two do not double up.
   */
  setLayered: (on: boolean) => void;
  destroy: () => void;
};

/** The model's own reading of what an event is; hosts refine it with `effectOf`. */
export const defaultEffectOf = (f: SwarmFlow): SwarmEffectKind | null =>
  f.kind === 'merge'
    ? 'merge'
    : f.kind === 'milestone'
      ? 'milestone'
      : f.kind === 'rating' && f.delta
        ? 'rating'
        : f.kind === 'reject'
          ? 'reject'
          : null;

/** How long a spark takes per hop, by what it carries: payoffs travel fast, chores unhurried. */
const STEP_MS: Partial<Record<SwarmFlow['kind'], number>> = {
  merge: 650,
  rating: 620,
  milestone: 680,
  reject: 1000,
  plan: 1050,
  claim: 950,
  session: 1000,
  post: 1000,
};

/** Reads the host's CSS variables by default, so the graph follows the page's theme. */
export const DEFAULT_THEME: SwarmGraphTheme = {
  fg: 'var(--fg, #f4f4f6)',
  fgMuted: 'var(--fg-2, #c3c5cc)',
  fgFaint: 'var(--fg-3, #9a9ca6)',
  line: 'var(--line, #34363d)',
  lineStrong: 'var(--line-strong, #474a52)',
  panel: 'var(--panel, #1b1c20)',
  panelRaised: 'var(--panel-raised, #222328)',
  neutral: 'var(--fg-3, #9a9ca6)',
  good: 'var(--good, #0ca30c)',
  warning: 'var(--warning, #fab219)',
  critical: 'var(--critical, #d03b3b)',
  font: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
  monoFont: 'var(--font-mono, ui-monospace, monospace)',
};

type SimNode = SwarmNode & d3.SimulationNodeDatum & { r: number; ring?: { x: number; y: number } };
type SimLink = Omit<SwarmLink, 'source' | 'target'> & {
  source: SimNode;
  target: SimNode;
};

type Particle = {
  key: number;
  from: SimNode;
  to: SimNode;
  start: number;
  duration: number;
  color: string;
  size: number;
  spark: boolean;
  /** A big moment's beam: a touch brighter, and the only one with a glow. */
  big?: boolean;
  /** The beam's colour, desaturated a little so it reads as a hint of movement. */
  tone?: string;
  onArrive?: () => void;
};

type Ripple = { key: number; node: SimNode; start: number; color: string; big?: boolean };

/** A spark thrown out of a node when work lands there; merges throw the most. */
type Burst = {
  key: number;
  node: SimNode;
  start: number;
  angle: number;
  dist: number;
  size: number;
  color: string;
};

/** A word that rises off a node and fades: "+merged", "approved". */
type Floater = { key: number; node: SimNode; start: number; text: string; color: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Width of the panel-coloured stroke behind label text: wide enough to mask a line through it. */
const LABEL_HALO = 5;
const AMBIENT_MS = 1500;
const RIPPLE_MS = 900;
const BURST_MS = 1100;
const FLOAT_MS = 1600;
/** Head-to-tail length of a beam's short fading tail, as a fraction of the link. */
const TRAIL = 0.1;
/** A beam's line width at 1× zoom, px: thin, so beams never cover labels. */
const BEAM_WIDTH = 1.25;
const BIG_BEAM_WIDTH = 1.6;
/** A beam's head radius: no larger than a small node dot. */
const BEAM_HEAD = 1.8;
const BIG_BEAM_HEAD = 2.4;
/** Peak opacity; a beam fades out over the last third of its flight. */
const BEAM_ALPHA = 0.42;
const BIG_BEAM_ALPHA = 0.6;
/** Opacity over a beam's flight `t` ∈ [0, 1]: full, then fading over the last third. */
const beamFade = (t: number) => (t < 2 / 3 ? 1 : Math.max(0, (1 - t) * 3));

/** How far along the protocol an open work item is, for the arc around it. */
const STAGE_PROGRESS: Partial<Record<SwarmStage, number>> = {
  claimed: 0.25,
  review: 0.5,
  changes: 0.5,
  approved: 0.75,
};

const arcPath = (r0: number, r1: number, from: number, to: number) =>
  to - from <= 0.0005
    ? ''
    : (d3.arc().cornerRadius((r1 - r0) / 2)({
        innerRadius: r0,
        outerRadius: r1,
        startAngle: from * Math.PI * 2,
        endAngle: Math.min(1, to) * Math.PI * 2,
      }) ?? '');

const ROLE_GLYPH: Record<string, string> = {
  worker: 'W',
  reviewer: 'R',
  merger: 'M',
  fixer: 'F',
  improver: 'I',
  planner: 'P',
  janitor: 'J',
  tester: 'T',
  orchestrator: 'O',
  referee: '⚖',
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Quadratic curve between two nodes; the bend is fixed per pair so links and particles agree. */
const control = (a: SimNode, b: SimNode) => {
  const ax = a.x ?? 0;
  const ay = a.y ?? 0;
  const bx = b.x ?? 0;
  const by = b.y ?? 0;
  const dx = bx - ax;
  const dy = by - ay;
  const [p, q] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  const sign = hash(p + q) % 2 ? 1 : -1;
  const flip = a.id < b.id ? 1 : -1;
  const bend = 0.14 * sign * flip;
  return {
    ax,
    ay,
    bx,
    by,
    cx: (ax + bx) / 2 - dy * bend,
    cy: (ay + by) / 2 + dx * bend,
  };
};

const curvePath = (a: SimNode, b: SimNode) => {
  const { ax, ay, bx, by, cx, cy } = control(a, b);
  return `M${ax},${ay}Q${cx},${cy} ${bx},${by}`;
};

const pointAt = (a: SimNode, b: SimNode, t: number) => {
  const { ax, ay, bx, by, cx, cy } = control(a, b);
  const u = 1 - t;
  return {
    x: u * u * ax + 2 * u * t * cx + t * t * bx,
    y: u * u * ay + 2 * u * t * cy + t * t * by,
  };
};

const SECTOR_RADIUS = { min: 18, max: 48 };

const radiusOf = (n: SwarmNode, effort: number, scale = 1, sector = SECTOR_RADIUS) => {
  switch (n.kind) {
    case 'hub':
      return 26;
    case 'sector':
      // Grows with effort (the default: 18 + 2.6 per √effort, up to 48).
      return (
        (sector.min + (sector.max - sector.min) * Math.min(1, (Math.sqrt(effort) * 2.6) / 30)) *
        scale
      );
    case 'work':
      return n.phase === 'pr' ? 8 : n.phase === 'branch' ? 8 : n.phase === 'issue' ? 5 : 4;
    case 'agent':
      return n.active ? 11 : 8.5;
  }
};

/** Node bodies: circles, except a branch (diamond) and a pull request (rounded square). */
const bodyPath = (n: SwarmNode, r: number) => {
  if (n.kind === 'work' && n.phase === 'branch') {
    const d = r * 1.2;
    return `M0,${-d}L${d},0L0,${d}L${-d},0Z`;
  }
  if (n.kind === 'work' && n.phase === 'pr') {
    const h = r * 0.95;
    const c = Math.min(3, h / 3);
    return `M${-h + c},${-h}H${h - c}Q${h},${-h} ${h},${-h + c}V${h - c}Q${h},${h} ${h - c},${h}H${-h + c}Q${-h},${h} ${-h},${h - c}V${-h + c}Q${-h},${-h} ${-h + c},${-h}Z`;
  }
  return `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
};

const STAGE_LABEL: Record<SwarmStage, string> = {
  backlog: 'issue',
  held: 'held',
  claimed: 'branch',
  review: 'in review',
  changes: 'changes asked',
  approved: 'approved',
  merged: 'merged',
  closed: 'closed',
};

const shortLabel = (s: string, max = 26) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export const createSwarmGraph = (
  container: HTMLElement,
  options: SwarmGraphRendererOptions = {},
): SwarmGraphRenderer => {
  const theme = { ...DEFAULT_THEME, ...options.theme };
  const motion = !options.reducedMotion;

  let width = Math.max(320, container.clientWidth);
  let height = Math.max(320, container.clientHeight);

  const svg = d3
    .select(container)
    .append('svg')
    .attr('xmlns', SVG_NS)
    .attr('role', 'img')
    .attr('aria-label', options.title ?? 'Swarm graph')
    .style('display', 'block')
    .style('width', '100%')
    .style('height', '100%')
    .style('touch-action', 'none')
    .style('user-select', 'none');

  // Node names, sub-lines and counts draw in their own SVG stacked above the graph and above any
  // effects canvas the embedder adds over it (#173): no edge, beam, burst or particle ever paints
  // over a label. It shares the graph's viewBox and zoom, and lets every pointer through.
  const labelSvg = d3
    .select(container)
    .append('svg')
    .attr('xmlns', SVG_NS)
    .attr('aria-hidden', 'true')
    .attr('data-slot', 'swarm-labels')
    .style('position', 'absolute')
    .style('inset', '0')
    .style('z-index', '3')
    .style('display', 'block')
    .style('width', '100%')
    .style('height', '100%')
    .style('pointer-events', 'none')
    .style('user-select', 'none');

  const uid = hash(String(Math.random())).toString(36);
  const defs = svg.append('defs');
  const glow = defs
    .append('filter')
    .attr('id', `sg-glow-${uid}`)
    .attr('x', '-100%')
    .attr('y', '-100%')
    .attr('width', '300%')
    .attr('height', '300%');
  glow.append('feGaussianBlur').attr('stdDeviation', 3).attr('result', 'b');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'b');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');
  const glowUrl = `url(#${glow.attr('id')})`;

  const root = svg.append('g');
  const gBloom = root.append('g').attr('pointer-events', 'none');
  const gRings = root.append('g').attr('pointer-events', 'none');
  const gLinks = root.append('g').attr('fill', 'none').attr('pointer-events', 'none');
  const gRipples = root.append('g').attr('pointer-events', 'none');
  const gTrails = root
    .append('g')
    .attr('fill', 'none')
    .attr('stroke-linecap', 'round')
    .attr('pointer-events', 'none');
  const gParticles = root.append('g').attr('class', 'sg-beams').attr('pointer-events', 'none');
  const gNodes = root.append('g');
  const gBursts = root.append('g').attr('pointer-events', 'none');
  const gFloaters = root.append('g').attr('pointer-events', 'none');
  const labelRoot = labelSvg.append('g');
  const gTags = labelRoot.append('g');
  /** Each node's label block in the top layer: `g.sg-tag` > glyph (in `g.sg-tag-inner`), name, sub-line. */
  const tagGroups = () => gTags.selectAll<SVGGElement, SimNode>('g.sg-tag');

  let view = d3.zoomIdentity;
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 3])
    .on('zoom', (e) => {
      // A viewer who pans or zooms during the intro takes the camera from it.
      if (intro && e.sourceEvent) intro.camera = false;
      root.attr('transform', e.transform.toString());
      labelRoot.attr('transform', e.transform.toString());
      view = e.transform;
      placeAnchors();
      // The chips keep their screen size, so their room in graph units changes with the zoom.
      layoutLabels();
    });
  svg.call(zoom).on('dblclick.zoom', null);

  const setViewBox = () => {
    const box = [-width / 2, -height / 2, width, height].join(' ');
    svg.attr('viewBox', box);
    labelSvg.attr('viewBox', box);
  };
  setViewBox();

  let graph: SwarmGraph | null = null;
  const nodeById = new Map<string, SimNode>();
  let simLinks: SimLink[] = [];
  const seenFlows = new Set<string>();
  /** Event ids `seenFlows` keeps at most (the graph itself holds a few hundred). */
  const SEEN_CAP = 5_000;
  let particles: Particle[] = [];
  let ripples: Ripple[] = [];
  let bursts: Burst[] = [];
  let floaters: Floater[] = [];
  let nextKey = 0;
  const lastEmit = new Map<string, number>();
  let hovered: SimNode | null = null;
  /** A GPU effects layer draws trails and bursts (see `setLayered`). */
  let layered = false;
  let replayOverride: Map<string, number> | null = null;
  type ReplayRun = {
    plan: SwarmReplayPlan;
    clock: number;
    next: number;
    playing: boolean;
    speed: number;
    done: boolean;
    snap: SwarmReplaySnapshot;
    last: number;
    /** Effort changed since the nodes were last resized. */
    dirty: boolean;
    shownAt: number;
  };
  let run: ReplayRun | null = null;
  /** The beam budget: live, replay and catch-up all draw from it (see `./beams`). */
  const beams = createBeamGate();
  type IntroRun = {
    plan: IntroPlan;
    start: number;
    /** Settled positions, computed off-screen before anything moves. */
    target: Map<string, { x: number; y: number }>;
    /** Scale of each node while it travels out. */
    scale: Map<string, number>;
    /** Whether the intro still drives the camera (false once the viewer has panned). */
    camera: boolean;
    labels: number;
  };
  let intro: IntroRun | null = null;
  /** New nodes gliding out of their parent (see `lifecycle.ts`). */
  type Arrival = {
    start: number;
    parent: string | null;
    from: { x: number; y: number };
    to: { x: number; y: number };
  };
  const arrivals = new Map<string, Arrival>();
  /** Nodes gone from the graph, fading out before they leave the simulation. */
  const departures = new Map<string, { start: number }>();
  /** The pose of every arriving or departing node this frame. */
  const life = new Map<string, Pose>();
  /** Nodes whose pose just ended: their styles go back to the defaults once. */
  const settled = new Set<string>();
  /** A dead node winding down (`SwarmNode.fading`) is drawn this much dimmer. */
  const FADING_OPACITY = 0.7;
  const liveTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Nodes held still through a view change (`SwarmUpdateOptions.view`), until it settles. */
  const held = new Set<string>();
  const releaseHeld = () => {
    for (const id of held) {
      const n = nodeById.get(id);
      if (n && !departures.has(id)) {
        n.fx = null;
        n.fy = null;
      }
    }
    held.clear();
  };

  const colorOf = (n: SwarmNode) => n.color ?? theme.neutral;
  /** Nodes whose host draws their information inside them (`anchor(…, 'inside')`). */
  const hosted = new Set<string>();
  /** The hosted set as `renderStatic` last drew it, and a pending redraw for a change to it. */
  let drawnHosted = '';
  let restyle = 0;
  const effortOf = (n: SimNode) => (replayOverride ? (replayOverride.get(n.id) ?? 0) : n.effort);
  /** The sector ring is an ellipse fitted to the canvas, leaving room for satellites outside it. */
  const ringRadii = () => ({
    x: Math.max(100, width / 2 - 140 * sizeScale()),
    y: Math.max(100, height / 2 - 120 * sizeScale()),
  });
  const ringRadius = () => Math.min(ringRadii().x, ringRadii().y);
  /** Sectors shrink on narrow canvases so the ring still fits a phone. */
  const sizeScale = () => Math.max(0.6, Math.min(1, Math.min(width, height) / 620));
  const rOf = (n: SimNode) =>
    radiusOf(n, effortOf(n), sizeScale(), options.sectorRadius ?? SECTOR_RADIUS);
  /** Room for the body plus the progress arc drawn around sectors and open work. */
  const collideOf = (n: SimNode) =>
    n.r + (n.kind === 'agent' ? 6 : n.kind === 'sector' ? 12 : n.kind === 'work' ? 7 : 4);

  /**
   * Where each node is drawn towards: sectors to their slot on the ring, the work and agents of
   * a sector just outside it (so the middle stays free for gate roles around the hub).
   */
  const anchorOf = (n: SimNode) => {
    if (n.kind === 'sector') return n.ring ?? { x: 0, y: 0 };
    const ring = n.sectorId ? nodeById.get(`sector:${n.sectorId}`)?.ring : undefined;
    if (!ring) return { x: 0, y: 0 };
    // Branches and pull requests live between the integration branch they forked from and the
    // sector they change; issues wait outside the ring; landed work sits in its sector.
    const k =
      n.kind === 'work'
        ? n.phase === 'branch' || n.phase === 'pr'
          ? 0.56
          : n.phase === 'issue'
            ? 1.2
            : 1
        : 1.08;
    return { x: ring.x * k, y: ring.y * k };
  };
  const anchorStrength = (n: SimNode) => {
    if (n.kind === 'sector') return 0.5;
    if (n.kind === 'agent') return n.sectorId ? 0.03 : 0.02;
    if (!n.sectorId) return 0;
    return n.phase === 'landed' ? 0.3 : 0.2;
  };

  const simulation = d3
    .forceSimulation<SimNode>()
    .alphaDecay(0.03)
    .velocityDecay(0.35)
    .force(
      'charge',
      d3
        .forceManyBody<SimNode>()
        .strength((n) => (n.kind === 'sector' ? -420 : n.kind === 'work' ? -50 : -140)),
    )
    .force('collide', d3.forceCollide<SimNode>().radius(collideOf))
    .force('ringX', d3.forceX<SimNode>((n) => anchorOf(n).x).strength(anchorStrength))
    .force('ringY', d3.forceY<SimNode>((n) => anchorOf(n).y).strength(anchorStrength))
    .on('tick', () => draw())
    // A view change's held nodes go free once nothing is fading in or out any more.
    .on('end', () => {
      if (held.size && !arrivals.size && !departures.size) releaseHeld();
    });

  const linkForce = d3
    .forceLink<SimNode, SimLink>()
    .id((n) => n.id)
    .distance((l) => {
      if (l.kind === 'target') return l.target.r + 34;
      if (l.kind === 'landed') return l.target.r + 12;
      if (l.kind === 'assignment')
        return l.target.kind === 'work' ? 34 : l.target.kind === 'hub' ? 70 : l.target.r + 46;
      if (l.kind === 'contribution') return 160;
      return ringRadius();
    })
    .strength((l) => {
      // The ring and the anchors place trunk, fork and scope ends; the links are drawn, not pulled.
      if (l.kind === 'trunk' || l.kind === 'fork' || l.kind === 'scope') return 0;
      if (l.kind === 'contribution') return Math.min(0.06, 0.01 * Math.sqrt(l.weight));
      if (l.kind === 'target') return 0.4;
      if (l.kind === 'landed') return 0.8;
      return 0.6;
    });
  simulation.force('link', linkForce);

  const placeRing = () => {
    if (!graph) return;
    const sectors = graph.nodes.filter((n) => n.kind === 'sector');
    const R = ringRadii();
    sectors.forEach((s, i) => {
      const node = nodeById.get(s.id);
      if (!node) return;
      const a = (i / sectors.length) * Math.PI * 2 - Math.PI / 2;
      node.ring = { x: Math.cos(a) * R.x, y: Math.sin(a) * R.y };
    });
    const hub = nodeById.get(graph.hubId);
    if (hub) {
      hub.fx = 0;
      hub.fy = 0;
    }
  };

  // ---- drawing -----------------------------------------------------------------------------

  const neighbours = (n: SimNode) => {
    const set = new Set([n.id]);
    for (const l of simLinks)
      if (l.source.id === n.id || l.target.id === n.id) set.add(l.source.id).add(l.target.id);
    return set;
  };

  const linkStyle = (
    l: SimLink,
  ): { stroke: string; width: number; opacity: number; dash: string | null } => {
    const c = colorOf(l.target.kind === 'hub' ? l.source : l.target);
    switch (l.kind) {
      case 'trunk':
        // The sector's paths are part of the integration branch.
        return {
          stroke: colorOf(l.source),
          width: 1 + Math.sqrt(l.weight) * 0.4,
          opacity: 0.2,
          dash: null,
        };
      case 'fork':
        // Branched from the integration branch's tip; animated while an agent works in it.
        return {
          stroke: colorOf(l.target),
          width: 1.6,
          opacity: l.active ? 0.85 : 0.5,
          dash: l.active ? '5 5' : null,
        };
      case 'scope':
        return { stroke: colorOf(l.source), width: 1, opacity: 0.28, dash: '1 4' };
      case 'target':
        return { stroke: colorOf(l.target), width: 1, opacity: 0.35, dash: '3 4' };
      case 'landed':
        return { stroke: colorOf(l.target), width: 1, opacity: 0.4, dash: null };
      case 'assignment':
        return l.active
          ? { stroke: colorOf(l.source), width: 1.8, opacity: 0.9, dash: '3 5' }
          : { stroke: theme.lineStrong, width: 1, opacity: 0.55, dash: null };
      case 'contribution':
        return {
          stroke: c,
          // History, not a path work travels: faint until the agent is hovered.
          width: Math.min(2.5, 0.5 + Math.sqrt(l.weight) * 0.35),
          opacity: Math.min(0.12, 0.04 + l.weight * 0.01),
          dash: '1 3',
        };
    }
  };

  const renderStatic = () => {
    drawnHosted = [...hosted].sort().join('|');
    // Links
    gLinks
      .selectAll<SVGPathElement, SimLink>('path')
      .data(simLinks, (l) => l.id)
      .join((enter) => enter.append('path').attr('stroke-linecap', 'round').attr('opacity', 0))
      .each(function (l) {
        const s = linkStyle(l);
        d3.select(this)
          .style('stroke', s.stroke)
          .attr('stroke-width', s.width)
          .attr('stroke-dasharray', s.dash)
          .attr('data-kind', l.kind)
          .transition()
          .duration(600)
          .attr('opacity', s.opacity);
      });

    // Rings: the halo of every live sector / agent.
    const ringed = [...nodeById.values()].filter(
      (n) => n.active && (n.kind === 'sector' || n.kind === 'agent' || n.kind === 'work'),
    );
    gRings
      .selectAll<SVGCircleElement, SimNode>('circle')
      .data(ringed, (n) => n.id)
      .join((enter) => {
        const c = enter.append('circle').attr('fill', 'none').attr('stroke-width', 1.5);
        if (motion) {
          c.append('animate')
            .attr('attributeName', 'stroke-opacity')
            .attr('values', '0.7;0;0.7')
            .attr('dur', '2.4s')
            .attr('repeatCount', 'indefinite');
          c.append('animate')
            .attr('attributeName', 'stroke-width')
            .attr('values', '1.5;6;1.5')
            .attr('dur', '2.4s')
            .attr('repeatCount', 'indefinite');
        }
        return c;
      })
      .style('stroke', (n) => (n.kind === 'hub' ? theme.fg : colorOf(n)))
      .attr('stroke-opacity', 0.5);

    // Nodes
    const groups = gNodes
      .selectAll<SVGGElement, SimNode>('g.sg-node')
      .data([...nodeById.values()], (n) => n.id)
      .join(
        (enter) => {
          const g = enter
            .append('g')
            .attr('class', 'sg-node')
            .attr('tabindex', 0)
            .attr('role', 'button')
            .style('cursor', 'pointer')
            .style('outline', 'none')
            .attr('opacity', 0);
          // The inner group scales (pops) without fighting the per-tick translate. Its opacity is
          // the dimming of a dead node winding down (`FADING_OPACITY`).
          const inner = g
            .append('g')
            .attr('class', 'sg-inner')
            .attr('opacity', (n) => (n.fading ? FADING_OPACITY : 1));
          inner.append('path').attr('class', 'sg-track').attr('stroke', 'none');
          inner.append('path').attr('class', 'sg-arc-flight').attr('stroke', 'none');
          inner.append('path').attr('class', 'sg-arc').attr('stroke', 'none');
          const orbit = inner
            .append('circle')
            .attr('class', 'sg-orbit')
            .attr('fill', 'none')
            .attr('stroke-dasharray', '2 6')
            .attr('stroke-linecap', 'round');
          if (motion)
            orbit
              .append('animateTransform')
              .attr('attributeName', 'transform')
              .attr('type', 'rotate')
              .attr('from', '0')
              .attr('to', '360')
              .attr('dur', '40s')
              .attr('repeatCount', 'indefinite');
          inner.append('path').attr('class', 'sg-body');
          // Arrivals (and reduced motion) are posed per frame instead; see `stepLife`.
          const posed = (n: SimNode) => !motion || arrivals.has(n.id);
          g.filter(posed).attr('opacity', 1);
          g.filter((n) => !posed(n))
            .transition()
            .duration(500)
            .attr('opacity', 1);
          // New nodes spring in from nothing.
          if (motion)
            inner
              .filter((n) => !arrivals.has(n.id))
              .attr('transform', 'scale(0.01)')
              .transition()
              .delay(80)
              .duration(900)
              .ease(d3.easeElasticOut.amplitude(1).period(0.45))
              .attr('transform', 'scale(1)');
          return g;
        },
        (update) => update,
        // A node leaves only after its departure faded it out (at once with reduced motion).
        (exit) => exit.remove(),
      );

    // The label layer mirrors the nodes one-for-one, appearing and leaving with them.
    const tags = tagGroups()
      .data([...nodeById.values()], (n) => n.id)
      .join(
        (enter) => {
          const g = enter.append('g').attr('class', 'sg-tag').attr('opacity', 0);
          const inner = g.append('g').attr('class', 'sg-tag-inner');
          inner
            .append('text')
            .attr('class', 'sg-glyph')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central');
          g.append('text').attr('class', 'sg-label').attr('text-anchor', 'middle');
          g.append('text').attr('class', 'sg-sub').attr('text-anchor', 'middle');
          const posed = (n: SimNode) => !motion || arrivals.has(n.id);
          g.filter(posed).attr('opacity', 1);
          g.filter((n) => !posed(n))
            .transition()
            .duration(500)
            .attr('opacity', 1);
          if (motion)
            inner
              .filter((n) => !arrivals.has(n.id))
              .attr('transform', 'scale(0.01)')
              .transition()
              .delay(80)
              .duration(900)
              .ease(d3.easeElasticOut.amplitude(1).period(0.45))
              .attr('transform', 'scale(1)');
          return g;
        },
        (update) => update,
        (exit) => exit.remove(),
      );

    // A dead node winding down is drawn dimmer before it leaves.
    const dim = (n: SimNode) => (n.fading ? FADING_OPACITY : 1);
    groups
      .select<SVGGElement>('g.sg-inner')
      .transition('dim')
      .duration(motion ? 800 : 0)
      .attr('opacity', dim);
    tags
      .transition('dim')
      .duration(motion ? 800 : 0)
      .attr('opacity', dim);

    groups.attr('aria-label', (n) => `${n.kind} ${n.label}`);
    groups.select<SVGPathElement>('path.sg-body').each(function (n) {
      const el = d3.select(this);
      const c = colorOf(n);
      el.attr('d', bodyPath(n, n.r)).attr('stroke-dasharray', null);
      if (n.kind === 'hub') {
        el.style('fill', theme.panelRaised)
          .style('stroke', theme.fg)
          .attr('stroke-width', 1.5)
          .attr('fill-opacity', 1)
          .attr('filter', n.active ? glowUrl : null);
      } else if (n.kind === 'sector') {
        // A hosted sector's body is opaque (its tint mixed into the panel), so no edge passing
        // behind it shows through the text drawn inside (#173, #199).
        el.style(
          'fill',
          hosted.has(n.id) ? `color-mix(in srgb, ${c} ${n.active ? 30 : 16}%, ${theme.panel})` : c,
        )
          .attr('fill-opacity', hosted.has(n.id) ? 1 : n.active ? 0.3 : 0.16)
          .style('stroke', c)
          .attr('stroke-width', n.active ? 2 : 1.25)
          .attr('filter', n.active ? glowUrl : null);
      } else if (n.kind === 'work') {
        const stage = n.workItem?.stage;
        const stroke =
          stage === 'approved'
            ? theme.good
            : stage === 'changes'
              ? theme.warning
              : stage === 'held'
                ? theme.fgFaint
                : c;
        if (n.phase === 'issue')
          el.style('fill', theme.panel)
            .attr('fill-opacity', 1)
            .style('stroke', stroke)
            .attr('stroke-width', 1.25)
            .attr('stroke-dasharray', '2 2')
            .attr('filter', null);
        else if (n.phase === 'landed')
          el.style('fill', c)
            .attr('fill-opacity', 0.55)
            .style('stroke', 'none')
            .attr('stroke-width', 0)
            .attr('filter', null);
        else
          el.style('fill', n.phase === 'pr' || n.active ? c : theme.panel)
            .attr('fill-opacity', n.phase === 'pr' ? 0.3 : n.active ? 0.35 : 1)
            .style('stroke', stroke)
            .attr('stroke-width', stage === 'approved' || stage === 'changes' ? 2.2 : 1.6)
            .attr('filter', n.active ? glowUrl : null);
      } else {
        el.style('fill', theme.panelRaised)
          .attr('fill-opacity', 1)
          .style('stroke', n.active ? c : theme.lineStrong)
          .attr('stroke-width', n.active ? 2 : 1.25)
          .attr('filter', n.active ? glowUrl : null);
      }
    });

    renderArcs(groups);

    groups
      .select<SVGCircleElement>('circle.sg-orbit')
      .attr('display', (n) => (n.kind === 'hub' ? null : 'none'))
      .attr('r', (n) => n.r + 7)
      .style('stroke', theme.fgFaint)
      .attr('stroke-opacity', 0.6);

    // A soft bloom under every sector; brighter, and breathing, while an agent works there.
    const sectors = [...nodeById.values()].filter((n) => n.kind === 'sector');
    defs
      .selectAll<SVGRadialGradientElement, SimNode>('radialGradient.sg-bloom')
      .data(sectors, (n) => n.id)
      .join((enter) => {
        const g = enter.append('radialGradient').attr('class', 'sg-bloom');
        g.append('stop').attr('offset', '0%').attr('stop-opacity', 0.55);
        g.append('stop').attr('offset', '45%').attr('stop-opacity', 0.14);
        g.append('stop').attr('offset', '100%').attr('stop-opacity', 0);
        return g;
      })
      .attr('id', (n) => `sg-bloom-${uid}-${hash(n.id)}`)
      .each(function (n) {
        d3.select(this).selectAll('stop').style('stop-color', colorOf(n));
      });
    gBloom
      .selectAll<SVGCircleElement, SimNode>('circle')
      .data(sectors, (n) => n.id)
      .join((enter) => {
        const c = enter.append('circle').attr('opacity', 0);
        if (motion)
          c.append('animate')
            .attr('attributeName', 'r')
            .attr('dur', '3.2s')
            .attr('repeatCount', 'indefinite');
        return c;
      })
      .attr('fill', (n) => `url(#sg-bloom-${uid}-${hash(n.id)})`)
      .each(function (n) {
        const el = d3.select(this);
        el.transition()
          .duration(800)
          .attr('opacity', n.active ? 0.9 : 0.4);
        el.select('animate').attr(
          'values',
          n.active ? `${n.r * 2.4};${n.r * 3};${n.r * 2.4}` : `${n.r * 2.2};${n.r * 2.2}`,
        );
        if (!motion || !n.active) el.attr('r', n.r * 2.2);
      });

    tags
      .select<SVGTextElement>('text.sg-glyph')
      .style('font-family', (n) => (n.kind === 'agent' ? theme.font : theme.monoFont))
      .attr('font-size', (n) =>
        n.kind === 'sector' ? Math.max(10, Math.min(15, n.r * 0.5)) : n.kind === 'hub' ? 11 : 10,
      )
      .attr('font-weight', 600)
      .style('fill', (n) => (n.kind === 'agent' && !n.active ? theme.fgFaint : theme.fg))
      .text((n) => {
        if (n.kind === 'agent')
          return (
            ROLE_GLYPH[n.agent?.role ?? ''] ?? (n.agent?.role ?? n.label).charAt(0).toUpperCase()
          );
        if (n.kind === 'sector')
          return hosted.has(n.id) ? '' : countLabel(shownNumber.get(n.id) ?? countOf(n));
        if (n.kind === 'hub') return n.label;
        return '';
      });
    countUp();

    // A wide halo in the panel colour masks anything passing behind the text, in both themes.
    tags
      .select<SVGTextElement>('text.sg-label')
      .style('font-family', (n) =>
        n.kind === 'work' && (n.phase === 'branch' || n.phase === 'pr')
          ? theme.monoFont
          : theme.font,
      )
      .attr('font-size', (n) => (n.kind === 'sector' ? 13 : 11))
      .attr('font-weight', (n) => (n.kind === 'sector' ? 600 : 500))
      .style('fill', (n) => (n.kind === 'sector' || n.active ? theme.fg : theme.fgFaint))
      .style('paint-order', 'stroke')
      .style('stroke', theme.panel)
      .attr('stroke-width', LABEL_HALO)
      .attr('stroke-linejoin', 'round')
      .text((n) => labelOf(n));

    tags
      .select<SVGTextElement>('text.sg-sub')
      .style('font-family', theme.font)
      .attr('font-size', 10)
      .style('fill', theme.fgFaint)
      .style('paint-order', 'stroke')
      .style('stroke', theme.panel)
      .attr('stroke-width', LABEL_HALO)
      .attr('stroke-linejoin', 'round')
      .text((n) => subOf(n));

    groups
      .on('pointerenter', (e: PointerEvent, n) => {
        hovered = n;
        applyHover();
        const rect = container.getBoundingClientRect();
        options.onHover?.(n, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      })
      .on('pointermove', (e: PointerEvent, n) => {
        const rect = container.getBoundingClientRect();
        options.onHover?.(n, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      })
      .on('pointerleave', () => {
        hovered = null;
        applyHover();
        options.onHover?.(null, null);
      })
      .on('focus', function (_e, n) {
        hovered = n;
        applyHover();
        const rect = container.getBoundingClientRect();
        const box = (this as SVGGElement).getBoundingClientRect();
        options.onHover?.(n, {
          x: box.left + box.width / 2 - rect.left,
          y: box.top - rect.top,
        });
      })
      .on('blur', () => {
        hovered = null;
        applyHover();
        options.onHover?.(null, null);
      })
      .on('keydown', (e: KeyboardEvent, n) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          options.onSelect?.(n);
        }
      })
      .on('click', (e: MouseEvent, n) => {
        if (e.defaultPrevented) return;
        options.onSelect?.(n);
      })
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .clickDistance(4)
          .on('start', (e, n) => {
            if (n.kind === 'hub') return;
            held.delete(n.id);
            if (!e.active) simulation.alphaTarget(0.2).restart();
            n.fx = n.x;
            n.fy = n.y;
          })
          .on('drag', (e, n) => {
            if (n.kind === 'hub') return;
            n.fx = e.x;
            n.fy = e.y;
          })
          .on('end', (e, n) => {
            if (n.kind === 'hub') return;
            if (!e.active) simulation.alphaTarget(0);
            n.fx = null;
            n.fy = null;
          }),
      );

    applyHover();
  };

  /**
   * Progress arcs. A sector's ring fills with its merged work (solid) and the work in flight
   * (faint) out of everything aimed at it; an open branch or pull request's ring shows how far
   * along the protocol it is. Arcs ease to their new value, so progress is something you watch.
   */
  const arcShown = new Map<string, { done: number; flight: number }>();
  const arcTarget = (n: SimNode) => {
    if (n.kind === 'sector') {
      const t = n.tally;
      if (!t || !t.total) return { done: 0, flight: 0 };
      return { done: t.landed / t.total, flight: (t.branch + t.pr) / t.total };
    }
    if (n.kind === 'work' && n.workItem)
      return { done: STAGE_PROGRESS[n.workItem.stage] ?? 0, flight: 0 };
    return { done: 0, flight: 0 };
  };
  const arcRadii = (n: SimNode): [number, number] =>
    n.kind === 'sector' ? [n.r + 5, n.r + 8.5] : [n.r + 3.5, n.r + 5.5];
  const hasArc = (n: SimNode) =>
    n.kind === 'sector' ||
    (n.kind === 'work' && (n.phase === 'branch' || n.phase === 'pr') && !replayOverride);
  const arcColor = (n: SimNode) => {
    const stage = n.workItem?.stage;
    return stage === 'approved' ? theme.good : stage === 'changes' ? theme.warning : colorOf(n);
  };
  const drawArcs = (el: SVGGElement, n: SimNode, v: { done: number; flight: number }) => {
    const [r0, r1] = arcRadii(n);
    const g = d3.select(el);
    const on = hasArc(n);
    g.select('path.sg-track')
      .attr('d', on ? arcPath(r0, r1, 0, 1) : '')
      .style('fill', theme.line)
      .attr('fill-opacity', 0.55);
    g.select('path.sg-arc-flight')
      .attr('d', on ? arcPath(r0, r1, v.done, v.done + v.flight) : '')
      .style('fill', colorOf(n))
      .attr('fill-opacity', 0.38);
    g.select('path.sg-arc')
      .attr('d', on ? arcPath(r0, r1, 0, v.done) : '')
      .style('fill', arcColor(n))
      .attr('fill-opacity', 1);
  };
  const renderArcs = (groups: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>) => {
    groups.select<SVGGElement>('g.sg-inner').each(function (n) {
      const to = arcTarget(n);
      const from = arcShown.get(n.id) ?? { done: 0, flight: 0 };
      arcShown.set(n.id, to);
      if (!motion || (from.done === to.done && from.flight === to.flight)) {
        drawArcs(this, n, to);
        return;
      }
      const done = d3.interpolateNumber(from.done, to.done);
      const flight = d3.interpolateNumber(from.flight, to.flight);
      d3.select(this)
        .transition('arc')
        .duration(1400)
        .ease(d3.easeCubicOut)
        .tween('arc', () => (t) => drawArcs(this, n, { done: done(t), flight: flight(t) }));
    });
  };

  /**
   * The number inside a sector is the host's stable count (`SwarmSector.count`: merged pull
   * requests, landed versions), not effort, so it does not move with the events a view shows. It
   * counts up (or down) to a new value instead of jumping, and a sector with nothing shows nothing.
   */
  const shownNumber = new Map<string, number>();
  const countOf = (n: SimNode) => n.sector?.count?.value ?? 0;
  const countLabel = (v: number) => (v > 0 ? String(Math.round(v)) : '');
  const countUp = () => {
    tagGroups()
      .filter((n) => n.kind === 'sector' && !hosted.has(n.id))
      .select<SVGTextElement>('text.sg-glyph')
      .each(function (n) {
        const to = countOf(n);
        const from = shownNumber.get(n.id) ?? to;
        shownNumber.set(n.id, to);
        const el = d3.select(this);
        if (!motion || from === to) {
          el.interrupt('count').text(countLabel(to));
          return;
        }
        el.transition('count')
          .duration(Math.min(1600, 300 + Math.abs(to - from) * 40))
          .ease(d3.easeCubicOut)
          .textTween(() => (t) => countLabel(from + (to - from) * t));
      });
  };

  /** A quick elastic bump on a node: something just happened to it. */
  const pop = (node: SimNode, strength = 1) => {
    if (!motion) return;
    gNodes
      .selectAll<SVGGElement, SimNode>('g.sg-node')
      .filter((n) => n === node)
      .select<SVGGElement>('g.sg-inner')
      .merge(
        tagGroups()
          .filter((n) => n === node)
          .select<SVGGElement>('g.sg-tag-inner'),
      )
      .interrupt('pop')
      .transition('pop')
      .duration(130)
      .ease(d3.easeQuadOut)
      .attr('transform', `scale(${1 + 0.16 * strength})`)
      .transition()
      .duration(750)
      .ease(d3.easeElasticOut.amplitude(1).period(0.35))
      .attr('transform', 'scale(1)');
  };

  /** Sparks thrown out of a node, and a word rising off it. */
  const celebrate = (node: SimNode, color: string, count: number, text: string | null) => {
    const now = performance.now();
    if (motion && !layered)
      for (let i = 0; i < count; i++)
        bursts.push({
          key: nextKey++,
          node,
          start: now + Math.random() * 60,
          angle: (i / count) * Math.PI * 2 + Math.random() * 0.5,
          dist: node.r + 14 + Math.random() * 26,
          size: 1.4 + Math.random() * 2,
          color,
        });
    if (text) floaters.push({ key: nextKey++, node, start: now, text, color });
  };

  /** Sectors, live agents, branches and pull requests are always named; the rest on hover. */
  const labelOf = (n: SimNode) => {
    // A hosted node's host draws its name inside it.
    if (hosted.has(n.id)) return '';
    if (n.kind === 'sector') return n.label;
    // Narrow canvases (phones) get shorter names so there is room to place them.
    const narrow = width < 560;
    if (n.kind === 'agent')
      return n.active || n === hovered ? shortLabel(n.label, narrow ? 16 : 22) : '';
    if (n.kind === 'work') {
      if (n.phase === 'branch' || n.phase === 'pr')
        return shortLabel(n.label, n === hovered ? (narrow ? 30 : 48) : narrow ? 18 : 30);
      return n === hovered ? shortLabel(n.label, narrow ? 24 : 34) : '';
    }
    return '';
  };

  const subOf = (n: SimNode) => {
    if (hosted.has(n.id)) return '';
    if (n.kind === 'hub') return 'integration branch';
    if (n.kind === 'sector') {
      const live = [...nodeById.values()].filter(
        (a) => a.kind === 'agent' && a.active && a.sectorId === n.sectorId,
      ).length;
      // What the number inside counts, so it is never a bare figure.
      const c = n.sector?.count;
      const count =
        c && c.value > 0
          ? c.recent
            ? `${c.unit} · ${c.recent} ${c.recentUnit ?? 'recent'}`
            : c.unit
          : null;
      return [count, live ? `${live} live` : null].filter(Boolean).join(' · ');
    }
    if (n.kind === 'agent' && n.active) return n.agent?.role ?? '';
    if (n.kind === 'work' && n.phase === 'pr' && n.workItem) return STAGE_LABEL[n.workItem.stage];
    return '';
  };

  /** Who gets first pick of label room: the hovered node, sectors, live agents, PRs, branches. */
  const labelRank = (n: SimNode) =>
    n === hovered
      ? 0
      : n.kind === 'sector' || n.kind === 'hub'
        ? 1
        : n.kind === 'agent'
          ? 2
          : n.phase === 'pr'
            ? 3
            : 4;

  /**
   * Place every visible label (name + sub-line) where it collides with nothing placed before it:
   * below the node, else above, right, left. Text widths are estimated from character counts, so
   * this runs every tick without forcing a layout.
   */
  const lastSpot = new Map<string, number>();
  const layoutLabels = () => {
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const bodies = [...nodeById.values()].map((n) => ({
      n,
      box: {
        x0: (n.x ?? 0) - n.r,
        y0: (n.y ?? 0) - n.r,
        x1: (n.x ?? 0) + n.r,
        y1: (n.y ?? 0) + n.r,
      },
    }));
    // The HTML chips beside a node (rating, agents) are obstacles too: a label never hides under one.
    const chips = [...chipBoxes.values()];
    const placed: Box[] = [];
    const ordered = [...nodeById.values()]
      .filter((n) => labelOf(n) || subOf(n))
      .sort((a, b) => labelRank(a) - labelRank(b) || a.id.localeCompare(b.id));
    const spot = new Map<string, { anchor: string; x: number; label: number; sub: number }>();
    for (const n of ordered) {
      const label = labelOf(n);
      const sub = subOf(n);
      const big = n.kind === 'sector';
      const mono = n.kind === 'work' && (n.phase === 'branch' || n.phase === 'pr');
      const lw = label.length * (big ? 7.6 : mono ? 6.7 : 6.1);
      const sw = sub.length * 5.4;
      const w = Math.max(lw, sw);
      const lh = label ? (big ? 16 : 14) : 0;
      const h = lh + (sub ? 13 : 0);
      const cx = n.x ?? 0;
      const cy = n.y ?? 0;
      const gap = 4;
      // Each candidate: the block's box, its anchor and baselines relative to the node.
      const below = {
        box: { x0: cx - w / 2, y0: cy + n.r + gap, x1: cx + w / 2, y1: cy + n.r + gap + h },
        anchor: 'middle',
        x: 0,
        top: n.r + gap,
      };
      const above = {
        box: { x0: cx - w / 2, y0: cy - n.r - gap - h, x1: cx + w / 2, y1: cy - n.r - gap },
        anchor: 'middle',
        x: 0,
        top: -n.r - gap - h,
      };
      const right = {
        box: { x0: cx + n.r + 6, y0: cy - h / 2, x1: cx + n.r + 6 + w, y1: cy + h / 2 },
        anchor: 'start',
        x: n.r + 6,
        top: -h / 2,
      };
      const left = {
        box: { x0: cx - n.r - 6 - w, y0: cy - h / 2, x1: cx - n.r - 6, y1: cy + h / 2 },
        anchor: 'end',
        x: -n.r - 6,
        top: -h / 2,
      };
      const inside = (c: typeof below) =>
        c.box.x0 >= -width / 2 + 2 &&
        c.box.x1 <= width / 2 - 2 &&
        c.box.y0 >= -height / 2 + 2 &&
        c.box.y1 <= height / 2 - 2;
      const clashes = (c: typeof below) =>
        placed.filter((b) => hit(b, c.box)).length +
        chips.filter((b) => hit(b, c.box)).length +
        bodies.filter((o) => o.n !== n && hit(o.box, c.box)).length;
      const free = (c: typeof below) => inside(c) && clashes(c) === 0;
      const candidates = [below, above, right, left];
      const prev = lastSpot.get(n.id);
      const pick =
        (prev !== undefined && free(candidates[prev]) ? candidates[prev] : undefined) ??
        candidates.find(free) ??
        // Nowhere clear: the on-canvas spot with the fewest collisions.
        [...candidates.filter(inside)].sort((a, b) => clashes(a) - clashes(b))[0] ??
        below;
      lastSpot.set(n.id, candidates.indexOf(pick));
      placed.push(pick.box);
      spot.set(n.id, {
        anchor: pick.anchor,
        x: pick.x,
        label: pick.top + lh - (big ? 4 : 3),
        sub: pick.top + lh + 10,
      });
    }
    const groups = tagGroups();
    groups
      .select<SVGTextElement>('text.sg-label')
      .attr('text-anchor', (n) => spot.get(n.id)?.anchor ?? 'middle')
      .attr('x', (n) => spot.get(n.id)?.x ?? 0)
      .attr('y', (n) => spot.get(n.id)?.label ?? 0);
    groups
      .select<SVGTextElement>('text.sg-sub')
      .attr('text-anchor', (n) => spot.get(n.id)?.anchor ?? 'middle')
      .attr('x', (n) => spot.get(n.id)?.x ?? 0)
      .attr('y', (n) => spot.get(n.id)?.sub ?? 0);
  };

  const applyHover = () => {
    const near = hovered ? neighbours(hovered) : null;
    const groups = gNodes.selectAll<SVGGElement, SimNode>('g.sg-node');
    groups
      .select<SVGPathElement>('path.sg-body')
      .attr('d', (n) => bodyPath(n, n === hovered ? n.r + 4 : n.r));
    const dim = (n: SimNode) => (!near || near.has(n.id) ? 1 : 0.2);
    groups.attr('opacity', dim);
    tagGroups()
      .attr('opacity', dim)
      .select<SVGTextElement>('text.sg-label')
      .text((n) => labelOf(n));
    layoutLabels();
    gLinks
      .selectAll<SVGPathElement, SimLink>('path')
      .interrupt()
      .attr('opacity', (l) => {
        const base = linkStyle(l).opacity;
        if (!near || !hovered) return base;
        return l.source.id === hovered.id || l.target.id === hovered.id
          ? Math.max(base, 0.85)
          : base * 0.15;
      });
  };

  const anchors = new Map<string, HTMLElement>();
  /** Where each anchored chip sits, in graph units, for the label layout to keep clear of. */
  const chipBoxes = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  const placeAnchors = () => {
    chipBoxes.clear();
    // Read every size first, then write every position: one layout per frame, not one per badge.
    // An inside element's size is the node's, so it is never read.
    const placed = [...anchors].map(([id, el]) => ({
      el,
      n: nodeById.get(id),
      w: hosted.has(id) ? 0 : el.offsetWidth,
      h: hosted.has(id) ? 0 : el.offsetHeight,
    }));
    const pad = 4;
    for (const { el, n, w, h } of placed) {
      if (!n) {
        el.style.visibility = 'hidden';
        continue;
      }
      const cx = width / 2 + view.x + view.k * (n.x ?? 0);
      const cy = height / 2 + view.y + view.k * (n.y ?? 0);
      if (hosted.has(n.id)) {
        // The node's bounding square, on whole pixels with its centre on the node's (rounded)
        // centre: what the host draws at a fixed place in it stays put whatever its text does.
        const R = Math.max(1, Math.round(view.k * n.r));
        const size = `${2 * R}px`;
        if (el.style.width !== size) {
          el.style.width = size;
          el.style.height = size;
          el.style.setProperty('--node-r', `${R}px`);
        }
        el.dataset.side = 'inside';
        el.style.visibility = 'visible';
        el.style.opacity = intro ? String(intro.labels) : '';
        el.style.transform = `translate(${Math.round(cx) - R}px, ${Math.round(cy) - R}px)`;
        continue;
      }
      const r = view.k * n.r + 8;
      // Beside the node, on the side away from the centre, so the middle of the graph stays
      // clear; the other side when that one has no room. Kept inside the canvas vertically.
      const outward = (n.x ?? 0) < 0 ? 'left' : 'right';
      const fits = (side: string) =>
        side === 'right' ? cx + r + w <= width - pad : cx - r - w >= pad;
      const side = fits(outward) ? outward : outward === 'left' ? 'right' : 'left';
      const x = side === 'right' ? cx + r : cx - r - w;
      const y = Math.max(pad, Math.min(height - h - pad, cy - h / 2));
      el.dataset.side = side;
      el.style.visibility = 'visible';
      el.style.opacity = intro ? String(intro.labels) : '';
      const left = Math.max(pad, Math.min(width - w - pad, x));
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)`;
      if (w > 0 && h > 0) {
        const gx = (sx: number) => (sx - width / 2 - view.x) / view.k;
        const gy = (sy: number) => (sy - height / 2 - view.y) / view.k;
        chipBoxes.set(n.id, { x0: gx(left), y0: gy(y), x1: gx(left + w), y1: gy(y + h) });
      }
    }
  };
  const anchor = (
    nodeId: string,
    el: HTMLElement | null,
    placement: SwarmAnchorPlacement = 'beside',
  ) => {
    if (el) anchors.set(nodeId, el);
    else anchors.delete(nodeId);
    const inside = Boolean(el) && placement === 'inside';
    if (inside !== hosted.has(nodeId)) {
      if (inside) hosted.add(nodeId);
      else hosted.delete(nodeId);
      if (el && !inside) {
        el.style.width = '';
        el.style.height = '';
        el.style.removeProperty('--node-r');
      }
      // The node's own name, sub-line, count and body change hands. Once per frame at most: a
      // host that re-attaches its element (a ref released and set again) costs nothing.
      if (graph && !restyle) restyle = requestAnimationFrame(applyHosting);
    }
    placeAnchors();
  };
  const applyHosting = () => {
    restyle = 0;
    const now = [...hosted].sort().join('|');
    if (now === drawnHosted || !graph) return;
    renderStatic();
  };

  const draw = () => {
    // Keep every node on the canvas, whatever the forces want.
    const pad = 14;
    for (const n of nodeById.values()) {
      const lim = {
        // Labelled nodes keep room for their label (about 22 characters at 11px).
        // A hosted node carries its label inside: it needs only room for its body.
        x:
          width / 2 -
          pad -
          Math.max(
            n.r,
            !hosted.has(n.id) && (n.kind === 'sector' || (n.kind === 'agent' && n.active)) ? 62 : 0,
          ),
        y: height / 2 - n.r - pad - (n.kind === 'sector' && !hosted.has(n.id) ? 26 : 0),
      };
      n.x = Math.max(-lim.x, Math.min(lim.x, n.x ?? 0));
      n.y = Math.max(-lim.y, Math.min(lim.y, n.y ?? 0));
    }
    const scaleOf = intro?.scale;
    const place = (n: SimNode) => {
      const k = scaleOf?.get(n.id) ?? life.get(n.id)?.scale;
      return `translate(${n.x ?? 0},${n.y ?? 0})${k !== undefined && k < 1 ? ` scale(${k})` : ''}`;
    };
    gNodes.selectAll<SVGGElement, SimNode>('g.sg-node').attr('transform', place);
    tagGroups().attr('transform', place);
    gLinks
      .selectAll<SVGPathElement, SimLink>('path')
      .attr('d', (l) => curvePath(l.source, l.target));
    gBloom
      .selectAll<SVGCircleElement, SimNode>('circle')
      .attr('cx', (n) => n.x ?? 0)
      .attr('cy', (n) => n.y ?? 0);
    gRings
      .selectAll<SVGCircleElement, SimNode>('circle')
      .attr('cx', (n) => n.x ?? 0)
      .attr('cy', (n) => n.y ?? 0)
      .attr('r', (n) => n.r + 5);
    layoutLabels();
    placeAnchors();
  };

  // ---- motion ------------------------------------------------------------------------------

  const spawn = (p: Omit<Particle, 'key' | 'start'> & { delay?: number }, now: number) => {
    particles.push({ ...p, key: nextKey++, start: now + (p.delay ?? 0) });
  };

  const ripple = (node: SimNode, color: string, now: number, big = false) => {
    ripples.push({ key: nextKey++, node, start: now, color, big });
  };

  /**
   * Fire one event onto the graph: a spark along its path, node by node, and a ripple where it
   * lands. A merge passes through the integration branch on its way into its sector.
   */
  const fireFlow = (flow: SwarmFlow, source: 'live' | 'replay', now: number) => {
    const path = flow.path.map((id) => nodeById.get(id)).filter((n): n is SimNode => Boolean(n));
    if (path.length < 2) return;
    const coloured = (flow.kind === 'merge' ? path : [...path].reverse()).find(
      (n) => n.kind !== 'hub' && n.color,
    );
    const effect = (options.effectOf ?? defaultEffectOf)(flow);
    // A buried idea fades out gently in its own colour; only a request for changes is red.
    const color =
      effect === 'bury'
        ? theme.fgMuted
        : flow.kind === 'reject'
          ? theme.critical
          : coloured
            ? colorOf(coloured)
            : theme.fg;
    const last = path[path.length - 1];
    const emit = (kind: SwarmEffectKind, node: SimNode, c: string) =>
      options.onEffect?.({ kind, nodeId: node.id, color: c, delta: flow.delta, source, flow });
    const tier = beamTier(flow, effect);
    const step = STEP_MS[flow.kind] ?? 850;
    // Ask the beam budget before anything moves: routine events never beam, and a burst or a
    // crowded moment folds into one beam with a count.
    const offer =
      motion && tier !== 'none'
        ? beams.offer(`${flow.sector ?? ''}|${flow.kind}`, now, step * (path.length - 1))
        : null;
    /** Events this beam carries by the time it lands (a burst folds in while it flies). */
    const carried = () => (offer?.fire ? beams.count(offer.id) : 1);
    const times = (n: number) => (n > 1 ? ` ×${n}` : '');
    const land = () => {
      const n = carried();
      if (effect) emit(effect, last, effect === 'bury' && coloured ? colorOf(coloured) : color);
      if (effect === 'bury') {
        ripple(last, color, performance.now());
        pop(last, 0.3);
        celebrate(last, color, 0, 'buried');
        return;
      }
      ripple(last, color, performance.now(), flow.kind === 'merge');
      pop(last, flow.kind === 'merge' ? 1.6 : 0.7);
      if (flow.kind === 'merge') {
        celebrate(last, color, 18, n > 1 ? `${n} merged` : `+${flow.weight} merged`);
        const hub = graph ? nodeById.get(graph.hubId) : undefined;
        if (hub) pop(hub, 0.8);
      } else if (flow.kind === 'milestone')
        celebrate(
          last,
          color,
          10,
          `${effect === 'rung' ? 'rung cleared' : 'milestone'}${times(n)}`,
        );
      else if (flow.kind === 'rating' && flow.delta) {
        pop(last, flow.delta > 0 ? 1.4 : 0.6);
        celebrate(
          last,
          flow.delta > 0 ? theme.good : theme.fgMuted,
          flow.delta > 0 ? 10 : 0,
          `${flow.delta > 0 ? '+' : ''}${flow.delta}`,
        );
      } else if (flow.kind === 'reject') celebrate(last, color, 0, `changes asked${times(n)}`);
      else if (n > 1) celebrate(last, color, 0, `×${n}`);
    };
    options.onFlow?.(flow, source);
    if (!motion) {
      land();
      return;
    }
    if (!offer?.fire) {
      // No beam: a routine event, or one folded into a beam already flying (or the next one).
      // A soft pulse on its node at most; a big moment over the cap keeps a quiet ripple.
      pop(last, 0.25);
      if (tier === 'big') ripple(last, color, now);
      return;
    }
    const big = tier === 'big';
    const tone = `color-mix(in srgb, ${color} 72%, ${theme.fgMuted})`;
    for (let i = 0; i < path.length - 1; i++) {
      const final = i === path.length - 2;
      const via = path[i + 1];
      spawn(
        {
          from: path[i],
          to: via,
          duration: step,
          color,
          tone,
          big,
          size: big ? BIG_BEAM_HEAD : BEAM_HEAD,
          spark: true,
          delay: i * step,
          onArrive: final
            ? land
            : () => {
                ripple(via, color, performance.now());
                pop(via, 0.5);
                emit('pass', via, color);
              },
        },
        now,
      );
    }
  };

  /** Re-derive radii (effort changes during replay) without restarting the layout. */
  const resize = () => {
    for (const n of nodeById.values()) n.r = rOf(n);
    gNodes
      .selectAll<SVGGElement, SimNode>('g.sg-node')
      .select<SVGPathElement>('path.sg-body')
      .attr('d', (n) => bodyPath(n, n.r));
    tagGroups()
      .select<SVGTextElement>('text.sg-glyph')
      .filter((n) => n.kind === 'sector')
      .attr('font-size', (n) => Math.max(10, Math.min(15, n.r * 0.5)));
    countUp();
    renderArcs(gNodes.selectAll<SVGGElement, SimNode>('g.sg-node'));
    gBloom
      .selectAll<SVGCircleElement, SimNode>('circle')
      .filter((n) => !motion || !n.active)
      .attr('r', (n) => n.r * 2.2);
    layoutLabels();
    (simulation.force('collide') as d3.ForceCollide<SimNode>).radius(collideOf);
    simulation.alpha(Math.max(simulation.alpha(), 0.05)).restart();
  };

  /** Live agents stream effort into what they are on: their branch's worktree, or the PR they gate. */
  const ambient = (now: number) => {
    if (!motion || replayOverride) return;
    for (const l of simLinks) {
      if (!l.active || l.kind !== 'assignment') continue;
      const last = lastEmit.get(l.id) ?? 0;
      if (now - last < AMBIENT_MS + (hash(l.id) % 700)) continue;
      lastEmit.set(l.id, now);
      spawn(
        {
          from: l.source,
          to: l.target,
          duration: 1100,
          color: colorOf(l.source),
          size: 1.4,
          spark: false,
        },
        now,
      );
    }
  };

  let dashOffset = 0;
  const timer = d3.timer(() => {
    const now = performance.now();
    if (intro) stepIntro(now);
    stepLife(now);
    ambient(now);
    advanceReplay(now);

    const alive: Particle[] = [];
    for (const p of particles) {
      const t = (now - p.start) / p.duration;
      if (t >= 1) {
        p.onArrive?.();
        continue;
      }
      alive.push(p);
    }
    particles = alive;
    ripples = ripples.filter((r) => now - r.start < (r.big ? RIPPLE_MS * 1.6 : RIPPLE_MS));
    bursts = bursts.filter((b) => now - b.start < BURST_MS);
    floaters = floaters.filter((f) => now - f.start < FLOAT_MS);

    const visible = particles.filter((p) => now >= p.start);

    // Sparks drag a comet tail behind them along the curve they travel.
    gTrails
      .selectAll<SVGPathElement, Particle>('path')
      .data(layered ? [] : visible.filter((p) => p.spark), (p) => p.key)
      .join((enter) => enter.append('path'))
      .each(function (p) {
        const t = Math.max(0, Math.min(1, (now - p.start) / p.duration));
        const head = d3.easeCubicInOut(t);
        const tail = Math.max(0, head - TRAIL);
        const pts: string[] = [];
        for (let i = 0; i <= 10; i++) {
          const q = pointAt(p.from, p.to, tail + ((head - tail) * i) / 10);
          pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`);
        }
        d3.select(this)
          .attr('d', `M${pts.join('L')}`)
          .style('stroke', p.tone ?? p.color)
          .attr('stroke-width', p.big ? BIG_BEAM_WIDTH : BEAM_WIDTH)
          .attr('stroke-linecap', 'round')
          .attr('stroke-opacity', (p.big ? BIG_BEAM_ALPHA : BEAM_ALPHA) * 0.8 * beamFade(t));
      });
    gParticles
      .selectAll<SVGCircleElement, Particle>('circle')
      .data(visible, (p) => p.key)
      .join((enter) => enter.append('circle'))
      .each(function (p) {
        const t = Math.max(0, Math.min(1, (now - p.start) / p.duration));
        const e = d3.easeCubicInOut(t);
        const pos = pointAt(p.from, p.to, e);
        d3.select(this)
          .attr('cx', pos.x)
          .attr('cy', pos.y)
          .attr('r', p.size * (p.spark ? 1 : 0.6 + 0.4 * Math.sin(Math.PI * t)))
          .style('fill', p.tone ?? p.color)
          .attr(
            'fill-opacity',
            p.spark
              ? (p.big ? BIG_BEAM_ALPHA : BEAM_ALPHA) * beamFade(t)
              : 0.3 * Math.sin(Math.PI * t),
          )
          // Only big moments glow; every other beam is a quiet line.
          .attr('filter', p.big ? glowUrl : null);
      });

    gRipples
      .selectAll<SVGCircleElement, Ripple>('circle')
      .data(ripples, (r) => r.key)
      .join((enter) => enter.append('circle').attr('fill', 'none'))
      .each(function (r) {
        const t = (now - r.start) / RIPPLE_MS;
        d3.select(this)
          .attr('cx', r.node.x ?? 0)
          .attr('cy', r.node.y ?? 0)
          .attr('r', r.node.r + 4 + d3.easeCubicOut(t) * (r.big ? 64 : 26))
          .style('stroke', r.color)
          .attr('stroke-width', (r.big ? 4 : 2.5) * (1 - t))
          .attr('stroke-opacity', 1 - t);
      });

    gBursts
      .selectAll<SVGCircleElement, Burst>('circle')
      .data(
        bursts.filter((b) => now >= b.start),
        (b) => b.key,
      )
      .join((enter) => enter.append('circle'))
      .each(function (b) {
        const t = (now - b.start) / BURST_MS;
        const e = d3.easeCubicOut(t);
        const d = b.node.r * 0.6 + e * b.dist;
        d3.select(this)
          .attr('cx', (b.node.x ?? 0) + Math.cos(b.angle) * d)
          .attr('cy', (b.node.y ?? 0) + Math.sin(b.angle) * d + t * t * 10)
          .attr('r', b.size * (1 - t * 0.7))
          .style('fill', b.color)
          .attr('fill-opacity', 1 - t);
      });

    gFloaters
      .selectAll<SVGTextElement, Floater>('text')
      .data(floaters, (f) => f.key)
      .join((enter) =>
        enter
          .append('text')
          .attr('text-anchor', 'middle')
          .attr('font-size', 12)
          .attr('font-weight', 700)
          .style('font-family', theme.monoFont)
          .style('paint-order', 'stroke')
          .style('stroke', theme.panel)
          .attr('stroke-width', 3)
          .text((f) => f.text),
      )
      .each(function (f) {
        const t = (now - f.start) / FLOAT_MS;
        const rise = d3.easeCubicOut(t) * 34;
        d3.select(this)
          .attr('x', f.node.x ?? 0)
          .attr('y', (f.node.y ?? 0) - f.node.r - 12 - rise)
          .style('fill', f.color)
          .attr('opacity', t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.55) / 0.45));
      });

    if (motion && !intro) {
      dashOffset = (dashOffset - 0.4) % 1000;
      gLinks
        .selectAll<SVGPathElement, SimLink>('path')
        .filter((l) => l.active && !life.has(l.source.id) && !life.has(l.target.id))
        .attr('stroke-dashoffset', dashOffset);
    }
  });

  // ---- intro -------------------------------------------------------------------------------

  const linkPaths = () => gLinks.selectAll<SVGPathElement, SimLink>('path');
  const labelTexts = () => gTags.selectAll<SVGTextElement, SimNode>('text.sg-label, text.sg-sub');

  const startIntro = (mode: 'full' | 'short') => {
    const hubId = graph?.hubId;
    const target = new Map<string, { x: number; y: number }>();
    for (const n of nodeById.values()) target.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    const plan = planIntro(
      [...nodeById.values()].map((n) => ({
        id: n.id,
        role: n.id === hubId ? 'hub' : n.kind === 'sector' ? 'sector' : 'other',
        sectorId: n.sectorId ? `sector:${n.sectorId}` : null,
        x: n.x ?? 0,
        y: n.y ?? 0,
      })),
      mode === 'short' ? SHORT_INTRO : FULL_INTRO,
    );
    // Only on a view nobody has moved yet: open zoomed in on the hub and pull back.
    const camera = view.k === 1 && view.x === 0 && view.y === 0;
    intro = { plan, start: performance.now(), target, scale: new Map(), camera, labels: 0 };
    // Edges draw on from source to target: a unit-length dash slid along the path.
    linkPaths()
      .interrupt()
      .attr('pathLength', 1)
      .attr('stroke-dasharray', '1 1')
      .attr('stroke-dashoffset', 1)
      .attr('opacity', (l) => linkStyle(l).opacity);
    stepIntro(intro.start);
  };

  const stepIntro = (now: number) => {
    if (!intro) return;
    const t = now - intro.start;
    if (t >= intro.plan.totalMs) {
      finishIntro();
      return;
    }
    const { plan, target, scale } = intro;
    for (const n of nodeById.values()) {
      const to = target.get(n.id);
      if (!to) continue;
      const pose = introPose(to, plan.timing.get(n.id), t);
      n.x = pose.x;
      n.y = pose.y;
      n.vx = 0;
      n.vy = 0;
      scale.set(n.id, pose.scale);
    }
    const fade = (n: SimNode) => {
      const to = target.get(n.id);
      return to ? introPose(to, plan.timing.get(n.id), t).opacity : 1;
    };
    gNodes.selectAll<SVGGElement, SimNode>('g.sg-node').style('opacity', fade);
    tagGroups().style('opacity', fade);
    linkPaths().attr(
      'stroke-dashoffset',
      (l) => 1 - introEdge(plan.timing.get(l.source.id), plan.timing.get(l.target.id), t),
    );
    intro.labels = introLabels(plan, t);
    labelTexts().style('opacity', intro.labels);
    const halo = easeOut(t / Math.max(1, plan.totalMs));
    gBloom.style('opacity', halo);
    gRings.style('opacity', halo);
    if (intro.camera) svg.call(zoom.transform, d3.zoomIdentity.scale(introCamera(plan, t)));
    draw();
  };

  /** Land the intro: settled positions, styles back, and the simulation takes over gently. */
  const finishIntro = () => {
    if (!intro) return;
    const { target, camera } = intro;
    intro = null;
    for (const n of nodeById.values()) {
      const to = target.get(n.id);
      if (!to) continue;
      n.x = to.x;
      n.y = to.y;
      n.vx = 0;
      n.vy = 0;
    }
    gNodes.selectAll<SVGGElement, SimNode>('g.sg-node').style('opacity', null);
    tagGroups().style('opacity', null);
    labelTexts().style('opacity', null);
    gBloom.style('opacity', null);
    gRings.style('opacity', null);
    linkPaths()
      .attr('pathLength', null)
      .attr('stroke-dasharray', (l) => linkStyle(l).dash)
      .attr('stroke-dashoffset', null);
    if (camera) svg.call(zoom.transform, d3.zoomIdentity);
    draw();
    // Low alpha and heavy damping for the first second, so there is no second jolt.
    simulation.velocityDecay(0.6).alpha(0.08).restart();
    const t = setTimeout(() => {
      liveTimers.delete(t);
      simulation.velocityDecay(0.35);
    }, 1000);
    liveTimers.add(t);
  };

  // ---- arriving and leaving ---------------------------------------------------------------

  const linksOf = (ids: Set<string>) =>
    linkPaths().filter((l) => ids.has(l.source.id) || ids.has(l.target.id));

  /** One frame of arrivals and departures: positions, sizes, opacities, edges. */
  const stepLife = (now: number) => {
    if (!arrivals.size && !departures.size && !settled.size) return;
    const gone: string[] = [];
    for (const [id, a] of arrivals) {
      const n = nodeById.get(id);
      if (!n) {
        arrivals.delete(id);
        life.delete(id);
        continue;
      }
      const p = progressAt(now, a.start, ARRIVAL.durationMs);
      const pose = arrivalPose(p);
      // The parent may be moving: the glide starts wherever it is now.
      const parent = a.parent ? nodeById.get(a.parent) : undefined;
      const from = parent ? { x: parent.x ?? a.from.x, y: parent.y ?? a.from.y } : a.from;
      n.x = from.x + (a.to.x - from.x) * pose.travel;
      n.y = from.y + (a.to.y - from.y) * pose.travel;
      n.vx = 0;
      n.vy = 0;
      if (p >= 1) {
        arrivals.delete(id);
        life.delete(id);
        settled.add(id);
      } else life.set(id, pose);
    }
    for (const [id, d] of departures) {
      const p = progressAt(now, d.start, DEPARTURE.durationMs);
      life.set(id, departurePose(p));
      if (p >= 1) gone.push(id);
    }

    const posed = (n: SimNode) => life.has(n.id) || settled.has(n.id);
    const pose = (n: SimNode) => life.get(n.id);
    gNodes
      .selectAll<SVGGElement, SimNode>('g.sg-node')
      .filter(posed)
      .style('opacity', (n) => (pose(n) ? String(pose(n)!.opacity) : null));
    tagGroups()
      .filter(posed)
      .each(function (n) {
        const p = pose(n);
        const g = d3.select(this);
        g.select('g.sg-tag-inner').style('opacity', () => (p ? String(p.opacity) : null));
        g.selectAll('text.sg-label, text.sg-sub').style('opacity', () =>
          p ? String(Math.max(0, p.label)) : null,
        );
      });
    const touched = new Set([...life.keys(), ...settled]);
    linksOf(touched).each(function (l) {
      const el = d3.select(this);
      const leaving = departures.has(l.source.id) || departures.has(l.target.id);
      const arriving = arrivals.has(l.source.id) || arrivals.has(l.target.id);
      const base = linkStyle(l);
      if (leaving) {
        const k = Math.min(life.get(l.source.id)?.edge ?? 1, life.get(l.target.id)?.edge ?? 1);
        el.attr('pathLength', null)
          .style('stroke-dasharray', null)
          .style('stroke-dashoffset', null)
          .style('opacity', String(base.opacity * k))
          .style('stroke-width', `${base.width * k}px`);
      } else if (arriving) {
        // Edges draw on from the parent's end: the end that is not arriving.
        const k = Math.min(life.get(l.source.id)?.edge ?? 1, life.get(l.target.id)?.edge ?? 1);
        const fromTarget = arrivals.has(l.source.id) && !arrivals.has(l.target.id);
        el.attr('pathLength', 1)
          .style('stroke-dasharray', '1 1')
          .style('stroke-dashoffset', String(fromTarget ? k - 1 : 1 - k))
          .style('opacity', String(base.opacity))
          .style('stroke-width', null);
      } else
        el.attr('pathLength', null)
          .style('stroke-dasharray', null)
          .style('stroke-dashoffset', null)
          .style('opacity', null)
          .style('stroke-width', null);
    });
    settled.clear();
    if (gone.length) finishDepartures(gone);
    draw();
  };

  /** Faded out: the nodes leave the simulation, and the rest ease into the room they leave. */
  const finishDepartures = (ids: string[]) => {
    for (const id of ids) {
      departures.delete(id);
      life.delete(id);
      nodeById.delete(id);
      arcShown.delete(id);
      shownNumber.delete(id);
    }
    simLinks = simLinks.filter((l) => nodeById.has(l.source.id) && nodeById.has(l.target.id));
    simulation.nodes([...nodeById.values()]);
    linkForce.links(simLinks);
    renderStatic();
    simulation.alpha(Math.max(simulation.alpha(), DEPARTURE.alpha)).restart();
  };

  // ---- public API --------------------------------------------------------------------------

  const update = (next: SwarmGraph, updateOptions: SwarmUpdateOptions = {}) => {
    // A live refresh mid-intro lands the intro at once rather than fighting the simulation.
    finishIntro();
    const first = graph === null;
    const quiet = first || Boolean(updateOptions.quiet);
    graph = next;
    const keep = new Set(next.nodes.map((n) => n.id));
    // New data lays out as usual; a view change holds what both views show where it is.
    releaseHeld();
    if (updateOptions.view && !first)
      for (const [id, n] of nodeById)
        if (keep.has(id) && !departures.has(id) && n.fx == null && n.fy == null) {
          n.fx = n.x;
          n.fy = n.y;
          held.add(id);
        }
    const now = performance.now();
    // Gone nodes fade out first (staggered) and leave the simulation after; at once without motion.
    let leaving = 0;
    for (const [id, n] of [...nodeById]) {
      if (keep.has(id)) continue;
      if (!motion || first) {
        nodeById.delete(id);
        departures.delete(id);
        life.delete(id);
        arrivals.delete(id);
        continue;
      }
      if (departures.has(id)) continue;
      arrivals.delete(id);
      departures.set(id, {
        start: now + staggerAt(leaving++, DEPARTURE.staggerMs, DEPARTURE.maxSteps),
      });
      // It holds still while it fades.
      n.fx = n.x;
      n.fy = n.y;
      n.active = false;
    }
    let arriving = 0;
    const fresh: SimNode[] = [];

    const advanced: { node: SimNode; stage: SwarmStage }[] = [];
    for (const n of next.nodes) {
      const existing = nodeById.get(n.id);
      if (existing && departures.has(n.id)) {
        // Back before it finished leaving: it stays where it is and comes back to full.
        departures.delete(n.id);
        life.delete(n.id);
        settled.add(n.id);
        if (updateOptions.view && motion) held.add(n.id);
        else {
          existing.fx = null;
          existing.fy = null;
        }
      }
      if (existing) {
        const was = existing.workItem?.stage;
        Object.assign(existing, n);
        existing.r = rOf(existing);
        const now = n.workItem?.stage;
        if (!first && was && now && was !== now) advanced.push({ node: existing, stage: now });
      } else {
        // New nodes appear beside what they attach to, so they glide in rather than jump.
        const anchorId = next.links.find(
          (l) => l.source === n.id && l.kind !== 'contribution',
        )?.target;
        const anchor = anchorId ? nodeById.get(anchorId) : undefined;
        // On a live graph it starts on its parent and glides out (see `stepLife`).
        const glide = motion && !first && Boolean(anchor);
        const jitter = () => (glide ? 0 : (Math.random() - 0.5) * 40);
        const node: SimNode = {
          ...n,
          r: 0,
          x: (anchor?.x ?? 0) + jitter(),
          y: (anchor?.y ?? 0) + jitter(),
        };
        node.r = rOf(node);
        nodeById.set(n.id, node);
        if (glide) {
          fresh.push(node);
          arrivals.set(n.id, {
            start: now + staggerAt(arriving++, ARRIVAL.staggerMs, ARRIVAL.maxSteps),
            parent: anchor!.id,
            from: { x: anchor!.x ?? 0, y: anchor!.y ?? 0 },
            to: { x: anchor!.x ?? 0, y: anchor!.y ?? 0 },
          });
        }
      }
    }
    placeRing();
    // Where each arrival glides to: just outside its parent, towards where the layout pulls it.
    for (const n of fresh) {
      const a = arrivals.get(n.id);
      const parent = a?.parent ? nodeById.get(a.parent) : undefined;
      if (!a || !parent) continue;
      const spin = ((hash(n.id) % 100) / 100 - 0.5) * 0.9;
      a.to = arrivalTarget(
        { x: parent.x ?? 0, y: parent.y ?? 0, r: parent.r },
        anchorOf(n),
        n.r,
        spin,
      );
    }
    if (first)
      for (const n of nodeById.values())
        if (n.kind === 'sector' && n.ring) {
          n.x = n.ring.x;
          n.y = n.ring.y;
        }

    // Departing nodes keep their edges until they have faded with them.
    const nextLinks = new Set(next.links.map((l) => l.id));
    const fadingLinks = simLinks.filter(
      (l) =>
        !nextLinks.has(l.id) &&
        (departures.has(l.source.id) || departures.has(l.target.id)) &&
        nodeById.has(l.source.id) &&
        nodeById.has(l.target.id),
    );
    simLinks = next.links
      .filter((l) => nodeById.has(l.source) && nodeById.has(l.target))
      .map((l) => ({
        ...l,
        source: nodeById.get(l.source)!,
        target: nodeById.get(l.target)!,
      }))
      .concat(fadingLinks);

    simulation.nodes([...nodeById.values()]);
    linkForce.links(simLinks);
    const introMode = motion ? (options.intro ?? 'full') : 'none';
    if (first) {
      // Settle the layout off-screen first, so every end position is known before anything moves.
      simulation.stop();
      for (let i = 0; i < 300; i++) simulation.tick();
    } else if (!motion && updateOptions.view) {
      // Without motion a view change is static: the new nodes find their places off-screen.
      simulation.stop().alpha(0.35);
      for (let i = 0; i < 300; i++) simulation.tick();
      releaseHeld();
    } else if (!motion) simulation.alpha(0.35).restart();
    else
      // Arrivals and departures are taken in at low alpha, so nothing already there jolts; a
      // work item changing phase (a branch becoming a pull request) still moves to its new place.
      simulation
        .alpha(
          Math.max(
            simulation.alpha(),
            advanced.length ? 0.2 : arriving || leaving ? ARRIVAL.alpha : 0.03,
          ),
        )
        .restart();

    renderStatic();
    if (first && introMode !== 'none' && nodeById.size > 0) startIntro(introMode);
    draw();

    // A work item moving to its next stage (branch → pull request → approved) gets its moment.
    for (const { node, stage } of advanced) {
      const color =
        stage === 'approved' ? theme.good : stage === 'changes' ? theme.warning : colorOf(node);
      ripple(node, color, performance.now(), stage === 'merged');
      pop(node, 1.2);
      celebrate(
        node,
        color,
        stage === 'approved' || stage === 'merged' ? 12 : 6,
        STAGE_LABEL[stage],
      );
    }

    // Events new since the last update spark across the graph; the first load only marks them.
    let delay = 0;
    for (const f of next.flows) {
      if (seenFlows.has(f.id)) continue;
      seenFlows.add(f.id);
      if (quiet || replayOverride) continue;
      const t = setTimeout(() => {
        liveTimers.delete(t);
        fireFlow(f, 'live', performance.now());
      }, delay);
      liveTimers.add(t);
      delay = Math.min(delay + 220, 4000);
    }
    // Forget the oldest ids past the cap, so a page open for days does not keep every id it
    // ever drew (#197). Ids still in the graph are kept, so none sparks a second time.
    if (seenFlows.size > SEEN_CAP) {
      const current = new Set(next.flows.map((f) => f.id));
      for (const id of seenFlows) {
        if (seenFlows.size <= SEEN_CAP) break;
        if (!current.has(id)) seenFlows.delete(id);
      }
    }
  };

  const clearEffects = () =>
    options.onEffect?.({
      kind: 'clear',
      nodeId: '',
      color: '',
      delta: null,
      source: 'replay',
      flow: null,
    });

  const replayState = (r: ReplayRun): SwarmReplayState => {
    const i = r.next;
    const gap = r.plan.gaps.find((g) => g.index === i - 1);
    return {
      at: r.plan.flows[i - 1]?.at ?? r.plan.startAt ?? new Date().toISOString(),
      index: i,
      total: r.plan.flows.length,
      playing: r.playing,
      speed: r.speed,
      done: r.done,
      snapshot: r.snap,
      gapMs: gap ? gap.ms : null,
    };
  };
  const emitReplay = () => {
    if (run) options.onReplay?.(replayState(run));
  };

  /** Show a snapshot's effort on the nodes (sectors and hub grow as work lands). */
  const showSnapshot = (snap: SwarmReplaySnapshot) => {
    replayOverride = new Map(Object.entries(snap.effort));
    resize();
  };

  /** Most events a single frame sparks; a bigger jump (a hidden tab) lands the rest silently. */
  const FRAME_SPARKS = 6;
  /** Node sizes follow the playback at most this often: resizing every node is the costly part. */
  const RESIZE_MS = 160;

  /** One frame of playback: move the clock and fire what it passed. */
  const advanceReplay = (now: number) => {
    const r = run;
    if (!r) return;
    const dt = Math.min(250, Math.max(0, now - r.last));
    r.last = now;
    if (!r.playing) return;
    r.clock += dt * r.speed;
    const due = indexAtTime(r.plan, r.clock);
    if (due > r.next) {
      const from = Math.max(r.next, due - FRAME_SPARKS);
      for (let i = r.next; i < due; i++) {
        const f = r.plan.flows[i];
        applyFlow(r.snap, f, r.plan.hubId);
        if (i >= from && sparksAt(r.plan, i)) fireFlow(f, 'replay', now);
        else if (i >= from) options.onFlow?.(f, 'replay');
      }
      r.next = due;
      r.dirty = true;
    }
    // Hosts re-render on every state; the playhead itself glides on `replayClock()`.
    if (r.dirty && (now - r.shownAt >= RESIZE_MS || r.clock >= r.plan.total)) {
      r.dirty = false;
      r.shownAt = now;
      showSnapshot(r.snap);
      emitReplay();
    }
    if (r.clock >= r.plan.total && !r.done) {
      r.clock = r.plan.total;
      r.playing = false;
      r.done = true;
      emitReplay();
    }
  };

  const stopReplay = () => {
    run = null;
    if (replayOverride) {
      replayOverride = null;
      particles = [];
      bursts = [];
      floaters = [];
      beams.reset();
      clearEffects();
      resize();
      renderStatic();
      options.onReplay?.(null);
    }
  };

  const replay = (planOrDuration: SwarmReplayPlan | number = 30_000) => {
    if (!graph) return;
    finishIntro();
    stopReplay();
    const plan =
      typeof planOrDuration === 'number'
        ? planReplay(graph.flows, graph.hubId, { mode: 'all', durationMs: planOrDuration })
        : planOrDuration;
    if (!plan.flows.length) return;
    run = {
      plan,
      clock: 0,
      next: 0,
      playing: true,
      speed: 1,
      done: false,
      snap: stateAt(plan.seed, [], 0, plan.hubId),
      last: performance.now(),
      dirty: false,
      shownAt: 0,
    };
    particles = [];
    showSnapshot(run.snap);
    renderStatic();
    emitReplay();
  };

  const setPlaying = (playing: boolean) => {
    if (!run) return;
    if (playing && run.done) {
      // Play after the end starts over from the window's beginning.
      seek(0);
      run.done = false;
    }
    run.playing = playing;
    run.last = performance.now();
    emitReplay();
  };

  const setSpeed = (speed: number) => {
    if (!run) return;
    run.speed = Math.max(0.25, Math.min(8, speed));
    emitReplay();
  };

  const jump = (index: number, clock: number) => {
    const r = run;
    if (!r) return;
    const i = Math.max(0, Math.min(index, r.plan.flows.length));
    r.next = i;
    r.clock = clock;
    r.done = false;
    r.snap = stateAt(r.plan.seed, r.plan.flows, i, r.plan.hubId);
    r.last = performance.now();
    r.dirty = false;
    r.shownAt = r.last;
    particles = [];
    bursts = [];
    floaters = [];
    beams.reset();
    clearEffects();
    showSnapshot(r.snap);
    emitReplay();
  };

  const seek = (index: number) => {
    if (!run) return;
    const i = Math.max(0, Math.min(index, run.plan.flows.length));
    jump(i, i > 0 ? run.plan.times[i - 1] : -1);
  };

  const seekTime = (ms: number) => {
    if (!run) return;
    const clock = Math.max(-1, Math.min(ms, run.plan.total));
    jump(indexAtTime(run.plan, clock), clock);
  };

  const replayClock = () => (run ? Math.max(0, run.clock) : null);

  const highlight = (nodeId: string | null) => {
    const next = nodeId ? (nodeById.get(nodeId) ?? null) : null;
    if (next === hovered) return;
    hovered = next;
    applyHover();
  };

  const reset = () => {
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  };

  const port: SwarmViewport = { width, height, x: 0, y: 0, k: 1, moved: false };
  const viewport = () => {
    port.width = width;
    port.height = height;
    port.x = view.x;
    port.y = view.y;
    port.k = view.k;
    port.moved = view.k !== 1 || view.x !== 0 || view.y !== 0;
    return port;
  };
  const eachNode = (fn: (node: SwarmNodeView) => void) => {
    for (const n of nodeById.values()) fn(n);
  };
  const eachSpark = (
    fn: (x: number, y: number, color: string, size: number, big: boolean) => void,
  ) => {
    const now = performance.now();
    for (const p of particles) {
      if (now < p.start || !p.spark) continue;
      const t = Math.max(0, Math.min(1, (now - p.start) / p.duration));
      const pos = pointAt(p.from, p.to, d3.easeCubicInOut(t));
      fn(pos.x, pos.y, p.color, p.size, Boolean(p.big));
    }
  };
  const nodeAt = (id: string) => nodeById.get(id) ?? null;
  const setLayered = (on: boolean) => {
    layered = on;
    if (on) bursts = [];
  };

  const observer = new ResizeObserver(() => {
    const w = Math.max(320, container.clientWidth);
    const h = Math.max(320, container.clientHeight);
    if (w === width && h === height) return;
    width = w;
    height = h;
    finishIntro();
    setViewBox();
    placeRing();
    resize();
    simulation.alpha(0.3).restart();
  });
  observer.observe(container);

  const destroy = () => {
    cancelAnimationFrame(restyle);
    intro = null;
    run = null;
    liveTimers.forEach(clearTimeout);
    timer.stop();
    simulation.stop();
    observer.disconnect();
    svg.remove();
    labelSvg.remove();
  };

  return {
    update,
    anchor,
    replay,
    stopReplay,
    setPlaying,
    setSpeed,
    seek,
    seekTime,
    replayClock,
    highlight,
    reset,
    viewport,
    eachNode,
    eachSpark,
    nodeAt,
    setLayered,
    destroy,
  };
};

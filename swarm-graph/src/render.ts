/**
 * The swarm graph renderer: plain D3 on an SVG, no framework. It owns a force simulation that
 * keeps node positions across updates, so a host can call `update()` with every new snapshot
 * (a realtime push, a poll) and the graph moves instead of redrawing.
 *
 * Effort is drawn as motion: live agents stream particles into the work they hold, work flows
 * into its sector, sectors feed the integration branch, and every new event fires a spark from
 * whoever logged it to where it landed. `replay()` plays the whole event history back.
 */
import * as d3 from 'd3';
import type { SwarmFlow, SwarmGraph, SwarmLink, SwarmNode } from './model';

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
  critical: string;
  font: string;
  monoFont: string;
};

export type SwarmReplayState = { at: string; index: number; total: number };

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
  /** Accessible name for the SVG. */
  title?: string;
};

export type SwarmGraphRenderer = {
  update: (graph: SwarmGraph) => void;
  /** Play the event history back over `durationMs` (default 30 s). */
  replay: (durationMs?: number) => void;
  stopReplay: () => void;
  /**
   * Emphasise a node as if the pointer were on it, from outside the graph (a list item the
   * host links to it, say). `null` clears it. Does not call `onHover`, so hosts can mirror the
   * graph's hover into their own UI and back without a loop.
   */
  highlight: (nodeId: string | null) => void;
  /** Recentre and reset zoom. */
  reset: () => void;
  destroy: () => void;
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
  onArrive?: () => void;
};

type Ripple = { key: number; node: SimNode; start: number; color: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
const AMBIENT_MS = 1500;
const TRUNK_MS = 2600;
const RIPPLE_MS = 900;

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

const radiusOf = (n: SwarmNode, effort: number, scale = 1) => {
  switch (n.kind) {
    case 'hub':
      return 26;
    case 'sector':
      return Math.min(48, 18 + Math.sqrt(effort) * 2.6) * scale;
    case 'work':
      return n.workItem && ['open', 'claimed', 'review'].includes(n.workItem.status) ? 7 : 4.5;
    case 'agent':
      return n.active ? 11 : 8.5;
  }
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

  const defs = svg.append('defs');
  const glow = defs
    .append('filter')
    .attr('id', `sg-glow-${hash(String(Math.random()))}`)
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
  const gRings = root.append('g').attr('pointer-events', 'none');
  const gLinks = root.append('g').attr('fill', 'none').attr('pointer-events', 'none');
  const gRipples = root.append('g').attr('pointer-events', 'none');
  const gParticles = root.append('g').attr('pointer-events', 'none');
  const gNodes = root.append('g');

  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 3])
    .on('zoom', (e) => root.attr('transform', e.transform.toString()));
  svg.call(zoom).on('dblclick.zoom', null);

  const setViewBox = () => svg.attr('viewBox', [-width / 2, -height / 2, width, height].join(' '));
  setViewBox();

  let graph: SwarmGraph | null = null;
  const nodeById = new Map<string, SimNode>();
  let simLinks: SimLink[] = [];
  const seenFlows = new Set<string>();
  let particles: Particle[] = [];
  let ripples: Ripple[] = [];
  let nextKey = 0;
  const lastEmit = new Map<string, number>();
  let hovered: SimNode | null = null;
  let replayOverride: Map<string, number> | null = null;
  let replayTimers: ReturnType<typeof setTimeout>[] = [];
  const liveTimers = new Set<ReturnType<typeof setTimeout>>();

  const colorOf = (n: SwarmNode) => n.color ?? theme.neutral;
  const effortOf = (n: SimNode) => (replayOverride ? (replayOverride.get(n.id) ?? 0) : n.effort);
  /** The sector ring is an ellipse fitted to the canvas, leaving room for satellites outside it. */
  const ringRadii = () => ({
    x: Math.max(100, width / 2 - 140 * sizeScale()),
    y: Math.max(100, height / 2 - 120 * sizeScale()),
  });
  const ringRadius = () => Math.min(ringRadii().x, ringRadii().y);
  /** Sectors shrink on narrow canvases so the ring still fits a phone. */
  const sizeScale = () => Math.max(0.6, Math.min(1, Math.min(width, height) / 620));
  const rOf = (n: SimNode) => radiusOf(n, effortOf(n), sizeScale());

  /**
   * Where each node is drawn towards: sectors to their slot on the ring, the work and agents of
   * a sector just outside it (so the middle stays free for gate roles around the hub).
   */
  const anchorOf = (n: SimNode) => {
    if (n.kind === 'sector') return n.ring ?? { x: 0, y: 0 };
    const ring = n.sectorId ? nodeById.get(`sector:${n.sectorId}`)?.ring : undefined;
    if (!ring) return { x: 0, y: 0 };
    const k = n.kind === 'work' ? 1.15 : 1.08;
    return { x: ring.x * k, y: ring.y * k };
  };
  const anchorStrength = (n: SimNode) => {
    if (n.kind === 'sector') return 0.5;
    if (!n.sectorId) return n.kind === 'agent' ? 0.04 : 0;
    return n.kind === 'work' ? 0.18 : n.active ? 0.05 : 0.1;
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
    .force(
      'collide',
      d3.forceCollide<SimNode>().radius((n) => n.r + (n.kind === 'agent' ? 6 : 4)),
    )
    .force('ringX', d3.forceX<SimNode>((n) => anchorOf(n).x).strength(anchorStrength))
    .force('ringY', d3.forceY<SimNode>((n) => anchorOf(n).y).strength(anchorStrength))
    .on('tick', () => draw());

  const linkForce = d3
    .forceLink<SimNode, SimLink>()
    .id((n) => n.id)
    .distance((l) => {
      if (l.kind === 'work') return l.source.r + l.target.r + 26;
      if (l.kind === 'assignment')
        return l.target.kind === 'work' ? 30 : l.target.kind === 'hub' ? 70 : l.target.r + 46;
      if (l.kind === 'contribution') return 160;
      return ringRadius();
    })
    .strength((l) => {
      if (l.kind === 'trunk') return 0;
      if (l.kind === 'contribution') return Math.min(0.06, 0.01 * Math.sqrt(l.weight));
      if (l.kind === 'work') return 0.7;
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

  const linkStyle = (l: SimLink) => {
    const c =
      l.kind === 'work' ? theme.lineStrong : colorOf(l.target.kind === 'hub' ? l.source : l.target);
    switch (l.kind) {
      case 'trunk':
        return {
          stroke: colorOf(l.source),
          width: 1.2 + Math.sqrt(l.weight) * 0.55,
          opacity: l.active ? 0.6 : 0.28,
          dash: l.active ? '6 6' : null,
        };
      case 'work':
        return { stroke: c, width: 1, opacity: 0.6, dash: null };
      case 'assignment':
        return l.active
          ? { stroke: colorOf(l.source), width: 1.8, opacity: 0.9, dash: '3 5' }
          : { stroke: theme.lineStrong, width: 1, opacity: 0.55, dash: null };
      case 'contribution':
        return {
          stroke: c,
          width: Math.min(5, 0.6 + Math.sqrt(l.weight) * 0.7),
          opacity: Math.min(0.32, 0.08 + l.weight * 0.025),
          dash: null,
        };
    }
  };

  const renderStatic = () => {
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
      (n) => n.active && (n.kind === 'sector' || n.kind === 'agent' || n.kind === 'hub'),
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
          g.append('circle').attr('class', 'sg-body');
          g.append('text')
            .attr('class', 'sg-glyph')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central');
          g.append('text').attr('class', 'sg-label').attr('text-anchor', 'middle');
          g.append('text').attr('class', 'sg-sub').attr('text-anchor', 'middle');
          g.transition().duration(500).attr('opacity', 1);
          return g;
        },
        (update) => update,
        (exit) => exit.transition().duration(400).attr('opacity', 0).remove(),
      );

    groups.attr('aria-label', (n) => `${n.kind} ${n.label}`);
    groups.select<SVGCircleElement>('circle.sg-body').each(function (n) {
      const el = d3.select(this);
      const c = colorOf(n);
      el.transition().duration(500).attr('r', n.r);
      if (n.kind === 'hub') {
        el.style('fill', theme.panelRaised)
          .style('stroke', theme.fg)
          .attr('stroke-width', 1.5)
          .attr('fill-opacity', 1)
          .attr('filter', n.active ? glowUrl : null);
      } else if (n.kind === 'sector') {
        el.style('fill', c)
          .attr('fill-opacity', n.active ? 0.3 : 0.16)
          .style('stroke', c)
          .attr('stroke-width', n.active ? 2 : 1.25)
          .attr('filter', n.active ? glowUrl : null);
      } else if (n.kind === 'work') {
        const open = n.workItem && ['open', 'claimed', 'review'].includes(n.workItem.status);
        el.style('fill', open ? (n.active ? c : theme.panel) : c)
          .attr('fill-opacity', open ? 1 : 0.45)
          .style('stroke', c)
          .attr('stroke-width', open ? 1.5 : 0)
          .attr('filter', null);
      } else {
        el.style('fill', theme.panelRaised)
          .attr('fill-opacity', 1)
          .style('stroke', n.active ? c : theme.lineStrong)
          .attr('stroke-width', n.active ? 2 : 1.25)
          .attr('filter', n.active ? glowUrl : null);
      }
    });

    groups
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
        if (n.kind === 'sector') return String(Math.round(effortOf(n)));
        if (n.kind === 'hub') return n.label;
        return '';
      });

    groups
      .select<SVGTextElement>('text.sg-label')
      .style('font-family', theme.font)
      .attr('font-size', (n) => (n.kind === 'sector' ? 13 : 11))
      .attr('font-weight', (n) => (n.kind === 'sector' ? 600 : 500))
      .style('fill', (n) => (n.kind === 'sector' || n.active ? theme.fg : theme.fgFaint))
      .style('paint-order', 'stroke')
      .style('stroke', theme.panel)
      .attr('stroke-width', 3)
      .attr('dy', (n) => n.r + (n.kind === 'sector' ? 16 : 13))
      .text((n) => {
        if (n.kind === 'sector') return n.label;
        if (n.kind === 'agent' && (n.active || n === hovered)) return shortLabel(n.label, 22);
        if (n.kind === 'work' && n === hovered) return shortLabel(n.label, 34);
        if (n.kind === 'hub') return '';
        return '';
      });

    groups
      .select<SVGTextElement>('text.sg-sub')
      .style('font-family', theme.font)
      .attr('font-size', 10)
      .style('fill', theme.fgFaint)
      .attr('dy', (n) => n.r + (n.kind === 'sector' ? 29 : n.kind === 'hub' ? 15 : 25))
      .text((n) => {
        if (n.kind === 'hub') return 'integration branch';
        if (n.kind === 'sector') {
          const live = [...nodeById.values()].filter(
            (a) => a.kind === 'agent' && a.active && a.sectorId === n.sectorId,
          ).length;
          return live ? `${live} live` : '';
        }
        if (n.kind === 'agent' && n.active) return n.agent?.role ?? '';
        return '';
      });

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

  const applyHover = () => {
    const near = hovered ? neighbours(hovered) : null;
    const groups = gNodes.selectAll<SVGGElement, SimNode>('g.sg-node');
    groups
      .select<SVGCircleElement>('circle.sg-body')
      .interrupt()
      .transition()
      .duration(180)
      .attr('r', (n) => (n === hovered ? n.r + 4 : n.r));
    groups
      .attr('opacity', (n) => (!near || near.has(n.id) ? 1 : 0.2))
      .select<SVGTextElement>('text.sg-label')
      .text((n) => {
        if (n.kind === 'sector') return n.label;
        if (n.kind === 'agent' && (n.active || n === hovered)) return shortLabel(n.label, 22);
        if (n.kind === 'work' && n === hovered) return shortLabel(n.label, 34);
        return '';
      });
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

  const draw = () => {
    // Keep every node on the canvas, whatever the forces want.
    const pad = 14;
    for (const n of nodeById.values()) {
      const lim = {
        // Labelled nodes keep room for their label (about 22 characters at 11px).
        x:
          width / 2 -
          pad -
          Math.max(n.r, n.kind === 'sector' || (n.kind === 'agent' && n.active) ? 62 : 0),
        y: height / 2 - n.r - pad - (n.kind === 'sector' ? 26 : 0),
      };
      n.x = Math.max(-lim.x, Math.min(lim.x, n.x ?? 0));
      n.y = Math.max(-lim.y, Math.min(lim.y, n.y ?? 0));
    }
    gNodes
      .selectAll<SVGGElement, SimNode>('g.sg-node')
      .attr('transform', (n) => `translate(${n.x ?? 0},${n.y ?? 0})`);
    gLinks
      .selectAll<SVGPathElement, SimLink>('path')
      .attr('d', (l) => curvePath(l.source, l.target));
    gRings
      .selectAll<SVGCircleElement, SimNode>('circle')
      .attr('cx', (n) => n.x ?? 0)
      .attr('cy', (n) => n.y ?? 0)
      .attr('r', (n) => n.r + 5);
  };

  // ---- motion ------------------------------------------------------------------------------

  const spawn = (p: Omit<Particle, 'key' | 'start'> & { delay?: number }, now: number) => {
    particles.push({ ...p, key: nextKey++, start: now + (p.delay ?? 0) });
  };

  const ripple = (node: SimNode, color: string, now: number) => {
    ripples.push({ key: nextKey++, node, start: now, color });
  };

  /** Fire one event onto the graph: a spark along its path, a ripple where it lands. */
  const fireFlow = (flow: SwarmFlow, source: 'live' | 'replay', now: number) => {
    const from = nodeById.get(flow.from);
    const to = nodeById.get(flow.to);
    if (!from || !to) return;
    const color =
      flow.kind === 'reject'
        ? theme.critical
        : flow.kind === 'merge'
          ? colorOf(from)
          : colorOf(to.kind === 'hub' ? from : to);
    const land = () => {
      ripple(to, color, performance.now());
      if (replayOverride) {
        replayOverride.set(to.id, (replayOverride.get(to.id) ?? 0) + flow.weight);
        const sector =
          to.kind === 'work' && to.sectorId ? nodeById.get(`sector:${to.sectorId}`) : null;
        if (sector)
          replayOverride.set(sector.id, (replayOverride.get(sector.id) ?? 0) + flow.weight);
        resize();
      }
    };
    options.onFlow?.(flow, source);
    if (!motion) {
      land();
      return;
    }
    spawn(
      {
        from,
        to,
        duration: 900 + Math.random() * 300,
        color,
        size: 3.2 + Math.min(3, flow.weight),
        spark: true,
        onArrive: land,
      },
      now,
    );
    // Work lands in its sector a beat later.
    if (to.kind === 'work' && to.sectorId) {
      const sector = nodeById.get(`sector:${to.sectorId}`);
      if (sector)
        spawn(
          {
            from: to,
            to: sector,
            duration: 700,
            color,
            size: 2.6,
            spark: true,
            delay: 1000,
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
      .select<SVGCircleElement>('circle.sg-body')
      .attr('r', (n) => n.r);
    gNodes
      .selectAll<SVGGElement, SimNode>('g.sg-node')
      .select<SVGTextElement>('text.sg-glyph')
      .filter((n) => n.kind === 'sector')
      .text((n) => String(Math.round(effortOf(n))))
      .attr('font-size', (n) => Math.max(10, Math.min(15, n.r * 0.5)));
    gNodes
      .selectAll<SVGGElement, SimNode>('g.sg-node')
      .select<SVGTextElement>('text.sg-label')
      .attr('dy', (n) => n.r + (n.kind === 'sector' ? 16 : 13));
    gNodes
      .selectAll<SVGGElement, SimNode>('g.sg-node')
      .select<SVGTextElement>('text.sg-sub')
      .attr('dy', (n) => n.r + (n.kind === 'sector' ? 29 : n.kind === 'hub' ? 15 : 25));
    (simulation.force('collide') as d3.ForceCollide<SimNode>).radius(
      (n) => n.r + (n.kind === 'agent' ? 6 : 4),
    );
    simulation.alpha(Math.max(simulation.alpha(), 0.05)).restart();
  };

  const ambient = (now: number) => {
    if (!motion || replayOverride) return;
    for (const l of simLinks) {
      if (!l.active) continue;
      if (l.kind === 'assignment') {
        const last = lastEmit.get(l.id) ?? 0;
        const gap = AMBIENT_MS + (hash(l.id) % 700);
        if (now - last < gap) continue;
        lastEmit.set(l.id, now);
        spawn(
          {
            from: l.source,
            to: l.target,
            duration: 1100,
            color: colorOf(l.source),
            size: 2.2,
            spark: false,
          },
          now,
        );
        const t = l.target;
        if (t.kind === 'work' && t.sectorId) {
          const sector = nodeById.get(`sector:${t.sectorId}`);
          if (sector)
            spawn(
              {
                from: t,
                to: sector,
                duration: 800,
                color: colorOf(l.source),
                size: 1.8,
                spark: false,
                delay: 1100,
              },
              now,
            );
        }
      } else if (l.kind === 'trunk') {
        const last = lastEmit.get(l.id) ?? 0;
        if (now - last < TRUNK_MS + (hash(l.id) % 900)) continue;
        lastEmit.set(l.id, now);
        spawn(
          {
            from: l.source,
            to: l.target,
            duration: 1800,
            color: colorOf(l.source),
            size: 2,
            spark: false,
          },
          now,
        );
      }
    }
  };

  let dashOffset = 0;
  const timer = d3.timer(() => {
    const now = performance.now();
    ambient(now);

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
    ripples = ripples.filter((r) => now - r.start < RIPPLE_MS);

    const visible = particles.filter((p) => now >= p.start);
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
          .style('fill', p.color)
          .attr('fill-opacity', p.spark ? 1 : 0.85)
          .attr('filter', p.spark ? glowUrl : null);
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
          .attr('r', r.node.r + 4 + t * 26)
          .style('stroke', r.color)
          .attr('stroke-width', 2.5 * (1 - t))
          .attr('stroke-opacity', 1 - t);
      });

    if (motion) {
      dashOffset = (dashOffset - 0.4) % 1000;
      gLinks
        .selectAll<SVGPathElement, SimLink>('path')
        .filter((l) => l.active)
        .attr('stroke-dashoffset', dashOffset);
    }
  });

  // ---- public API --------------------------------------------------------------------------

  const update = (next: SwarmGraph) => {
    const first = graph === null;
    graph = next;
    const keep = new Set(next.nodes.map((n) => n.id));
    for (const id of [...nodeById.keys()]) if (!keep.has(id)) nodeById.delete(id);

    for (const n of next.nodes) {
      const existing = nodeById.get(n.id);
      if (existing) {
        Object.assign(existing, n);
        existing.r = rOf(existing);
      } else {
        // New nodes appear beside what they attach to, so they glide in rather than jump.
        const anchorId = next.links.find(
          (l) => l.source === n.id && l.kind !== 'contribution',
        )?.target;
        const anchor = anchorId ? nodeById.get(anchorId) : undefined;
        const jitter = () => (Math.random() - 0.5) * 40;
        const fresh: SimNode = {
          ...n,
          r: 0,
          x: (anchor?.x ?? 0) + jitter(),
          y: (anchor?.y ?? 0) + jitter(),
        };
        fresh.r = rOf(fresh);
        nodeById.set(n.id, fresh);
      }
    }
    placeRing();
    if (first)
      for (const n of nodeById.values())
        if (n.kind === 'sector' && n.ring) {
          n.x = n.ring.x;
          n.y = n.ring.y;
        }

    simLinks = next.links
      .filter((l) => nodeById.has(l.source) && nodeById.has(l.target))
      .map((l) => ({
        ...l,
        source: nodeById.get(l.source)!,
        target: nodeById.get(l.target)!,
      }));

    simulation.nodes([...nodeById.values()]);
    linkForce.links(simLinks);
    simulation.alpha(first ? 1 : 0.35).restart();
    if (first && !motion) {
      simulation.stop();
      for (let i = 0; i < 300; i++) simulation.tick();
    }

    renderStatic();
    draw();

    // Events new since the last update spark across the graph; the first load only marks them.
    let delay = 0;
    for (const f of next.flows) {
      if (seenFlows.has(f.id)) continue;
      seenFlows.add(f.id);
      if (first || replayOverride) continue;
      const t = setTimeout(() => {
        liveTimers.delete(t);
        fireFlow(f, 'live', performance.now());
      }, delay);
      liveTimers.add(t);
      delay = Math.min(delay + 220, 4000);
    }
  };

  const stopReplay = () => {
    replayTimers.forEach(clearTimeout);
    replayTimers = [];
    if (replayOverride) {
      replayOverride = null;
      particles = [];
      resize();
      renderStatic();
      options.onReplay?.(null);
    }
  };

  const replay = (durationMs = 30_000) => {
    if (!graph) return;
    stopReplay();
    const flows = graph.flows;
    if (!flows.length) return;
    replayOverride = new Map();
    particles = [];
    resize();
    // Real time, compressed; long quiet gaps are squeezed so the replay never stalls.
    const times = flows.map((f) => Date.parse(f.at));
    const gaps = times.map((t, i) => (i === 0 ? 0 : Math.min(t - times[i - 1], 10 * 60_000)));
    const span = gaps.reduce((a, b) => a + b, 0) || 1;
    const scale = (durationMs - 1500) / span;
    let at = 0;
    flows.forEach((f, i) => {
      at += gaps[i] * scale;
      replayTimers.push(
        setTimeout(
          () => {
            fireFlow(f, 'replay', performance.now());
            options.onReplay?.({ at: f.at, index: i + 1, total: flows.length });
          },
          Math.max(i * 40, at),
        ),
      );
    });
    replayTimers.push(setTimeout(stopReplay, Math.max(flows.length * 40, at) + 1600));
  };

  const highlight = (nodeId: string | null) => {
    const next = nodeId ? (nodeById.get(nodeId) ?? null) : null;
    if (next === hovered) return;
    hovered = next;
    applyHover();
  };

  const reset = () => {
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);
  };

  const observer = new ResizeObserver(() => {
    const w = Math.max(320, container.clientWidth);
    const h = Math.max(320, container.clientHeight);
    if (w === width && h === height) return;
    width = w;
    height = h;
    setViewBox();
    placeRing();
    resize();
    simulation.alpha(0.3).restart();
  });
  observer.observe(container);

  const destroy = () => {
    replayTimers.forEach(clearTimeout);
    liveTimers.forEach(clearTimeout);
    timer.stop();
    simulation.stop();
    observer.disconnect();
    svg.remove();
  };

  return { update, replay, stopReplay, highlight, reset, destroy };
};

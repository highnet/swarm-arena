/**
 * The positioning engine (#221): where every node of the swarm graph stands, computed off-screen
 * and to convergence before anything is drawn. The renderer never runs physics on screen; it
 * only tweens each node from where it is to the place this module gives it.
 *
 * The engine is d3-force's model run headless to rest (see `layoutGraph`), chosen over
 * cytoscape-fcose, WebCola and ELK on stability under incremental change, determinism, speed and
 * bundle size (the numbers are in the pull request for #221). Two rules give the stability,
 * whatever the solver:
 *
 * - **Sectors and the hub are fixed** (`fixed`): the ring, set by the canvas, never by the data.
 * - **Every node already laid out is pinned** (`pinned`): only new or re-placed nodes are free.
 *   A node arriving or leaving anywhere moves nothing else. When something grows into a pinned
 *   neighbour (a sector gaining effort), `separate` pushes that neighbour out by exactly the
 *   overlap and no further.
 *
 * Deterministic: the same nodes, links and pins give the same positions (a seeded random source,
 * start points derived from ids, no clock). Pure: no DOM, so it can run in a test or a worker.
 */

export type LayoutPoint = { x: number; y: number };

export type LayoutNode = {
  id: string;
  /** Room the node keeps clear around its centre: its body, its ring and a margin. */
  r: number;
  /** Where its sector pulls it (a free node only), and how hard. */
  anchor: LayoutPoint;
  anchorStrength: number;
  /** Many-body strength (negative repels). */
  charge: number;
  /** Held here whatever happens: the sectors on their ring, the hub at the centre. */
  fixed?: LayoutPoint;
  /** Already laid out: it stays here, unless something grows into it. */
  pinned?: LayoutPoint;
  /** Where a free node starts (its last place, for a re-placed node). Default: beside `parent`. */
  start?: LayoutPoint;
  /** What a new node is placed beside: its sector, its work item. */
  parent?: string;
  /** Half the box it must stay inside, centred on the origin. */
  limit: LayoutPoint;
};

export type LayoutLink = { source: string; target: string; distance: number; strength: number };

export type LayoutResult = {
  positions: Map<string, LayoutPoint>;
  /** Nodes the solver placed (neither fixed nor pinned). */
  free: number;
  /** Solver ticks it took to rest (0 when nothing was free). */
  ticks: number;
};

export type LayoutOptions = {
  /** Seed of the random source that splits coincident nodes. */
  seed?: number;
  /** Most solver ticks; it stops earlier once the free nodes rest. */
  maxTicks?: number;
};

type Body = { node: LayoutNode; mobile: boolean; x: number; y: number };

/** FNV-1a: a stable number per id, for start angles. */
export const hashId = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A small seeded generator (an LCG), so the solver's jiggle is reproducible. */
const lcg = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296;
};

/** Where a new node starts: just outside its parent, turned towards its anchor. */
export const besideParent = (
  parent: LayoutPoint & { r: number },
  anchor: LayoutPoint,
  id: string,
  r: number,
): LayoutPoint => {
  let dx = anchor.x - parent.x;
  let dy = anchor.y - parent.y;
  if (Math.hypot(dx, dy) < 1) {
    // No pull away from the parent: head outward, away from the centre.
    dx = parent.x || 1;
    dy = parent.y;
  }
  const spin = ((hashId(id) % 1000) / 1000 - 0.5) * 1.6;
  const a = Math.atan2(dy, dx) + spin;
  const d = parent.r + r + 6;
  return { x: parent.x + Math.cos(a) * d, y: parent.y + Math.sin(a) * d };
};

const clampTo = (b: Body) => {
  if (b.node.fixed) return;
  const { x, y } = b.node.limit;
  b.x = Math.max(-x, Math.min(x, b.x));
  b.y = Math.max(-y, Math.min(y, b.y));
};

/**
 * Push overlapping nodes apart by exactly their overlap. Fixed nodes never move; pinned nodes
 * move only when what they overlap cannot (a sector that grew, another pinned node), and then
 * the smaller one gives way. A few sweeps over all pairs: the graph has a few hundred nodes.
 */
export const separate = (bodies: Body[], sweeps = 24) => {
  for (let s = 0; s < sweeps; s++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const min = a.node.r + b.node.r;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= min - 0.01) continue;
        // Who gives way: free nodes first; between two held ones, the smaller pinned one.
        let wa = a.mobile ? 1 : 0;
        let wb = b.mobile ? 1 : 0;
        if (!wa && !wb) {
          const pa = a.node.fixed ? 0 : a.node.r;
          const pb = b.node.fixed ? 0 : b.node.r;
          if (!pa && !pb) continue;
          if (pa && (!pb || pa <= pb)) wa = 1;
          else wb = 1;
        }
        if (d < 1e-6) {
          // Coincident: split along a direction fixed by the ids.
          const t = ((hashId(a.node.id + b.node.id) % 360) * Math.PI) / 180;
          dx = Math.cos(t);
          dy = Math.sin(t);
        } else {
          dx /= d;
          dy /= d;
        }
        const push = min - d;
        const share = wa + wb;
        a.x -= (dx * push * wa) / share;
        a.y -= (dy * push * wa) / share;
        b.x += (dx * push * wb) / share;
        b.y += (dy * push * wb) / share;
        // Inside the canvas as it goes, so the last clamp never undoes a separation.
        clampTo(a);
        clampTo(b);
        moved = true;
      }
    }
    if (!moved) break;
  }
};

/**
 * The solver: d3-force's forces, integrated for the free bodies only, on flat typed arrays (the
 * inner loops are O(free × all) and run a couple of hundred times). Returns the ticks it took.
 */
const solve = (bodies: Body[], links: readonly LayoutLink[], maxTicks: number, seed: number) => {
  const n = bodies.length;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  const VX = new Float64Array(n);
  const VY = new Float64Array(n);
  const R = new Float64Array(n);
  const Q = new Float64Array(n);
  const AX = new Float64Array(n);
  const AY = new Float64Array(n);
  const AS = new Float64Array(n);
  const LX = new Float64Array(n);
  const LY = new Float64Array(n);
  const M = new Uint8Array(n);
  const index = new Map<string, number>();
  bodies.forEach((b, i) => {
    index.set(b.node.id, i);
    X[i] = b.x ?? 0;
    Y[i] = b.y ?? 0;
    R[i] = b.node.r;
    Q[i] = b.node.charge;
    AX[i] = b.node.anchor.x;
    AY[i] = b.node.anchor.y;
    AS[i] = b.node.anchorStrength;
    LX[i] = b.node.limit.x;
    LY[i] = b.node.limit.y;
    M[i] = b.mobile ? 1 : 0;
  });
  const free = Int32Array.from(bodies.flatMap((b, i) => (b.mobile ? [i] : [])));
  const PX = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  const rank = new Int32Array(n);
  const maxR = Math.max(...R);
  const springs = links
    .filter((l) => l.strength > 0 && index.has(l.source) && index.has(l.target))
    .map((l) => ({
      a: index.get(l.source)!,
      b: index.get(l.target)!,
      d: l.distance,
      k: l.strength,
    }))
    .filter((l) => M[l.a] || M[l.b]);
  const jiggle = lcg(seed);
  const split = () => (jiggle() - 0.5) * 1e-6;
  const DIST_MAX2 = 320 * 320;
  const KEEP = 0.6; // velocity kept per tick (d3's velocityDecay 0.4)
  const alphaDecay = 1 - Math.pow(0.001, 1 / maxTicks);
  let alpha = 1;
  let ticks = 0;
  while (ticks < maxTicks) {
    alpha += (0 - alpha) * alphaDecay;
    ticks++;
    // Springs: each pulls its ends towards its rest length; a held end does not give.
    for (const l of springs) {
      let dx = X[l.b] + VX[l.b] - X[l.a] - VX[l.a] || split();
      let dy = Y[l.b] + VY[l.b] - Y[l.a] - VY[l.a] || split();
      const d = Math.sqrt(dx * dx + dy * dy);
      const k = ((d - l.d) / d) * alpha * l.k * (M[l.a] && M[l.b] ? 0.5 : 1);
      dx *= k;
      dy *= k;
      if (M[l.b]) {
        VX[l.b] -= dx;
        VY[l.b] -= dy;
      }
      if (M[l.a]) {
        VX[l.a] += dx;
        VY[l.a] += dy;
      }
    }
    // Charge reaches DIST_MAX: walk out from each free node along x, both ways, until beyond it.
    order.sort((i, j) => X[i] - X[j]);
    for (let o = 0; o < n; o++) rank[order[o]] = o;
    for (let f = 0; f < free.length; f++) {
      const a = free[f];
      // Pull to the anchor.
      let vx = VX[a] + (AX[a] - X[a]) * AS[a] * alpha;
      let vy = VY[a] + (AY[a] - Y[a]) * AS[a] * alpha;
      // Charge from every other node within reach (each repels with its own strength).
      const ax = X[a];
      const ay = Y[a];
      for (let dir = -1; dir <= 1; dir += 2)
        for (let o = rank[a] + dir; o >= 0 && o < n; o += dir) {
          const b = order[o];
          let dx = X[b] - ax;
          if (dx * dx >= DIST_MAX2) break;
          let dy = Y[b] - ay;
          let l = dx * dx + dy * dy;
          if (l >= DIST_MAX2) continue;
          if (l === 0) {
            dx = split();
            dy = split();
            l = dx * dx + dy * dy;
          }
          if (l < 1) l = Math.sqrt(l);
          const w = (Q[b] * alpha) / l;
          vx += dx * w;
          vy += dy * w;
        }
      VX[a] = vx;
      VY[a] = vy;
    }
    // Collision on the predicted positions, twice per tick (d3's iterations(2)): a sweep along
    // x, so only nodes near each other are compared.
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < n; i++) PX[i] = X[i] + VX[i];
      order.sort((i, j) => PX[i] - PX[j]);
      for (let oi = 0; oi < n; oi++) {
        const a = order[oi];
        const reach = R[a] + maxR;
        for (let oj = oi + 1; oj < n; oj++) {
          const b = order[oj];
          if (PX[b] - PX[a] >= reach) break;
          if (!M[a] && !M[b]) continue;
          const r = R[a] + R[b];
          let dx = PX[a] - PX[b];
          let dy = Y[a] + VY[a] - Y[b] - VY[b];
          let l = dx * dx + dy * dy;
          if (l >= r * r) continue;
          if (l === 0) {
            dx = split();
            dy = split();
            l = dx * dx + dy * dy;
          }
          l = Math.sqrt(l);
          const k = (r - l) / l;
          const sa = M[a] ? (M[b] ? 0.5 : 1) : 0;
          const sb = M[b] ? (M[a] ? 0.5 : 1) : 0;
          VX[a] += dx * k * sa;
          VY[a] += dy * k * sa;
          VX[b] -= dx * k * sb;
          VY[b] -= dy * k * sb;
        }
      }
    }
    let v = 0;
    for (let f = 0; f < free.length; f++) {
      const a = free[f];
      VX[a] *= KEEP;
      VY[a] *= KEEP;
      X[a] = Math.max(-LX[a], Math.min(LX[a], X[a] + VX[a]));
      Y[a] = Math.max(-LY[a], Math.min(LY[a], Y[a] + VY[a]));
      v = Math.max(v, Math.abs(VX[a]), Math.abs(VY[a]));
    }
    // At rest: nothing free moves more than a hundredth of a pixel a tick.
    if (ticks > 20 && v < 0.01) break;
  }
  for (let f = 0; f < free.length; f++) {
    const a = free[f];
    bodies[a].x = X[a];
    bodies[a].y = Y[a];
  }
  return ticks;
};

/**
 * Lay the graph out to rest. Same input, same output.
 *
 * The solver is d3-force's model (many-body charge, collision, a pull to the anchor, springs on
 * the links, velocity decay and a cooling alpha) run headless, but it only integrates the free
 * nodes: fixed and pinned ones are obstacles that push and pull, never move, and cost nothing to
 * step. A tick is O(free × all); d3's own loop rebuilds a Barnes–Hut quadtree over every node
 * each tick, which at a few hundred nodes costs more than it saves (and an arrival would pay for
 * the whole graph). At rest early once nothing free moves a hundredth of a pixel a tick.
 */
export const layoutGraph = (
  nodes: readonly LayoutNode[],
  links: readonly LayoutLink[],
  options: LayoutOptions = {},
): LayoutResult => {
  const maxTicks = options.maxTicks ?? 160;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Start points: held nodes where they are held; new ones beside their parent.
  const start = new Map<string, LayoutPoint>();
  const startOf = (n: LayoutNode, depth = 0): LayoutPoint => {
    const known = start.get(n.id);
    if (known) return known;
    const held = n.fixed ?? n.pinned ?? n.start;
    let p: LayoutPoint;
    if (held) p = held;
    else {
      const parent = n.parent ? byId.get(n.parent) : undefined;
      p =
        parent && depth < 4
          ? besideParent({ ...startOf(parent, depth + 1), r: parent.r }, n.anchor, n.id, n.r)
          : n.anchor;
    }
    start.set(n.id, p);
    return p;
  };

  const bodies: Body[] = nodes.map((node) => {
    const p = startOf(node);
    const held = node.fixed ?? node.pinned;
    return { node, mobile: !held, x: held?.x ?? p.x, y: held?.y ?? p.y };
  });
  const free = bodies.filter((b) => b.mobile);

  let ticks = 0;
  if (free.length) ticks = solve(bodies, links, maxTicks, options.seed ?? 221);
  separate(bodies);
  for (const b of bodies) clampTo(b);

  const positions = new Map<string, LayoutPoint>();
  for (const b of bodies) positions.set(b.node.id, { x: b.x, y: b.y });
  return { positions, free: free.length, ticks };
};

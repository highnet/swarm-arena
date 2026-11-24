/**
 * The fleet graph's WebGL effects layer (three.js). Loaded with a dynamic `import()` from the
 * fleet page only, so no other page's bundle carries three.js.
 *
 * Two transparent canvases sandwich the D3 graph, both with `pointer-events: none`:
 * - **under** the SVG: one fullscreen quad shader, at half resolution. A faint noise "energy"
 *   field that brightens around busy sectors, a soft light under each sector (agents working,
 *   events lately), a ripple that displaces the field from a merge or a rung cleared, heat
 *   shimmer over a sector while a referee match runs, and a vignette.
 * - **over** the SVG: one `THREE.Points` system fed from a pooled particle buffer
 *   (`@rallypoint/swarm-graph/effects`): comet trails, merge sprays, rating fountains, rung
 *   shockwaves, embers, glints, sparkles and dust. In Full mode an `EffectComposer` adds bloom,
 *   a chromatic-aberration pulse on milestones and motion trails while scrubbing.
 *
 * The graph stays flat and the D3 renderer stays the source of truth: both cameras are
 * orthographic and every particle is placed with the graph's own zoom and pan, read each frame
 * from the renderer, so effects stay pinned to nodes and edges. Depth (`z`) only feeds parallax,
 * size and fog. One `requestAnimationFrame` loop drives both canvases; it stops while the tab
 * is hidden. Frame time picks a quality level (high, medium, low) that sheds particles, trails
 * and post-processing when frames slip.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';
import {
  QUALITY,
  createActivity,
  createParticlePool,
  createQuality,
  emitComet,
  emitEmbers,
  emitFlare,
  emitMergeBurst,
  emitMote,
  emitPuff,
  emitRatingFountain,
  emitShockwave,
  emitSparkle,
  type QualityLevel,
  type Rgb,
} from '@rallypoint/swarm-graph/effects';
import type {
  SwarmEffect,
  SwarmFlow,
  SwarmGraphRenderer,
  SwarmNodeView,
} from '@rallypoint/swarm-graph';

export type EffectsMode = 'off' | 'calm' | 'full';

export type SwarmEffectsStats = {
  /** Median and 95th-percentile frame interval over the last few seconds, ms. */
  medianMs: number;
  p95Ms: number;
  /** Median and 95th-percentile time spent inside the layer's own frame work, ms. */
  workMedianMs: number;
  workP95Ms: number;
  level: QualityLevel;
  particles: number;
  mode: EffectsMode;
};

export type SwarmEffectsLayer = {
  effect: (e: SwarmEffect) => void;
  /** Every event the graph shows (live or replayed), for heat over running matches. */
  flow: (f: SwarmFlow) => void;
  setMode: (mode: Exclude<EffectsMode, 'off'>) => void;
  /** A replay is playing: dust drifts and the view follows the pointer a few pixels. */
  setReplaying: (on: boolean) => void;
  /** The viewer is dragging the replay's playhead: motion trails. */
  setScrubbing: (on: boolean) => void;
  stats: () => SwarmEffectsStats;
  destroy: () => void;
};

export type SwarmEffectsOptions = {
  mode: Exclude<EffectsMode, 'off'>;
  /** A referee match started (`start`) or ended (`end`) at this flow's sector. */
  gateOf?: (f: SwarmFlow) => 'start' | 'end' | null;
  /**
   * Even the lowest quality cannot keep up on this machine: the layer has stopped and hidden
   * itself, leaving the SVG graph alone. The host should show effects as off.
   */
  onGiveUp?: () => void;
};

const LIGHTS = 12;
const RIPPLES = 6;
const FRAMES = 240;

const POINTS_VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute vec4 aExtra;
  uniform vec3 uView;
  uniform vec2 uParallax;
  uniform float uPixelRatio;
  varying vec4 vColor;
  varying float vShape;
  varying float vAngle;
  varying float vT;
  void main() {
    float z = position.z;
    vec2 p = uView.xy + uView.z * position.xy + uParallax * z;
    gl_Position = projectionMatrix * vec4(p.x, -p.y, 0.0, 1.0);
    gl_PointSize = clamp(aExtra.x * uView.z * (1.0 + 0.35 * z) * uPixelRatio, 1.0, 1024.0);
    vColor = aColor;
    // Depth fog: what drifts behind the graph is dimmer.
    vColor.a *= mix(1.0, 0.45, clamp(-z, 0.0, 1.0));
    vShape = aExtra.y;
    vAngle = aExtra.z;
    vT = aExtra.w;
  }
`;

const POINTS_FRAG = /* glsl */ `
  varying vec4 vColor;
  varying float vShape;
  varying float vAngle;
  varying float vT;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(uv, uv);
    if (d2 > 1.0) discard;
    float a;
    if (vShape < 0.5) {
      // Soft round sprite: a bright core in a falloff.
      a = exp(-d2 * 5.0) + 0.6 * exp(-d2 * 18.0);
    } else if (vShape < 1.5) {
      // A shaded ring, lit from above like a torus seen face on.
      float r = sqrt(d2);
      float w = 0.05 + 0.08 * (1.0 - vT);
      a = smoothstep(w, 0.0, abs(r - 0.86)) * (0.65 + 0.35 * (0.5 - 0.5 * uv.y));
    } else if (vShape < 2.5) {
      // A glint: a thin cross over a small core.
      vec2 q = abs(uv);
      a = exp(-q.x * 34.0) * exp(-q.y * 2.2) + exp(-q.y * 34.0) * exp(-q.x * 2.2) + exp(-d2 * 14.0);
    } else {
      // A flat-shaded shard that catches the light as it turns.
      float c = cos(vAngle);
      float s = sin(vAngle);
      vec2 q = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
      float inside = step(abs(q.x) * 1.7 + abs(q.y), 0.75);
      a = inside * (0.35 + 0.65 * abs(cos(vAngle * 2.0)));
    }
    gl_FragColor = vec4(vColor.rgb * a * vColor.a, 1.0);
  }
`;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const QUAD_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uEnergy;
  uniform float uLight;
  uniform int uCount;
  uniform vec4 uLights[${LIGHTS}];
  uniform vec3 uColors[${LIGHTS}];
  uniform float uHeat[${LIGHTS}];
  uniform vec4 uRipples[${RIPPLES}];

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
    vec2 disp = vec2(0.0);
    float rings = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipples[i];
      if (r.w <= 0.0) continue;
      vec2 d = px - r.xy;
      float len = length(d) + 1e-4;
      float k = exp(-pow((len - r.z * 380.0) / 34.0, 2.0)) * r.w * (1.0 - r.z);
      disp += d / len * k * 9.0;
      rings += k;
    }
    for (int i = 0; i < ${LIGHTS}; i++) {
      if (i >= uCount || uHeat[i] <= 0.0) continue;
      float f = exp(-pow(length(px - uLights[i].xy) / (uLights[i].z * 1.1), 2.0));
      disp += vec2(sin(px.y * 0.09 + uTime * 7.0), cos(px.x * 0.08 + uTime * 6.0)) * 2.6 * uHeat[i] * f;
    }
    vec2 q = px + disp;
    float n = fbm(q * 0.0042 + vec2(uTime * 0.018, -uTime * 0.013));
    vec3 col = vec3(0.5, 0.56, 0.72) * (uEnergy * (0.6 + n));
    for (int i = 0; i < ${LIGHTS}; i++) {
      if (i >= uCount) continue;
      vec4 l = uLights[i];
      float d = length(q - l.xy) / l.z;
      float fall = exp(-d * d * 1.6);
      col += uColors[i] * fall * (0.035 + 0.2 * l.w) * (0.75 + 0.5 * n);
      col += uColors[i] * uHeat[i] * fall * 0.05 * fbm(q * 0.02 + uTime);
    }
    col += vec3(0.7, 0.75, 0.9) * rings * 0.06;
    vec2 c = vUv - 0.5;
    c.x *= uRes.x / uRes.y;
    float vig = smoothstep(0.45, 1.05, length(c) * 1.25);
    float glow = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    if (uLight > 0.5) {
      // Light theme: a multiply-style tint instead of added light.
      vec3 tint = glow > 0.0 ? col / glow : vec3(0.0);
      float s = glow * 0.5 + vig * 0.06;
      gl_FragColor = vec4(tint * glow * 0.25, s);
    } else {
      gl_FragColor = vec4(col, vig * 0.32);
    }
  }
`;

/** Converts additive light into a multiply factor, for the light theme's `multiply` blend. */
const MULTIPLY_SHADER = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = min(texture2D(tDiffuse, vUv).rgb * 0.7, vec3(1.0));
      float m = max(c.r, max(c.g, c.b));
      gl_FragColor = vec4(vec3(1.0) - vec3(m) + c, 1.0);
    }
  `,
};

const canWebGL = () => {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    // Only a probe: hand its context back at once.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
};

/** Resolves any CSS colour (a `var(--series-1)` token, oklch, hex) to sRGB 0–1, cached. */
const colorResolver = (host: HTMLElement) => {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const cache = new Map<string, Rgb>();
  const fallback: Rgb = { r: 0.8, g: 0.82, b: 0.88 };
  const resolve = (css: string): Rgb => {
    const hit = cache.get(css);
    if (hit) return hit;
    let out = fallback;
    if (ctx && css) {
      probe.style.color = '';
      probe.style.color = css;
      const computed = getComputedStyle(probe).color;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      out = { r: r / 255, g: g / 255, b: b / 255 };
    }
    cache.set(css, out);
    return out;
  };
  return { resolve, dispose: () => probe.remove() };
};

const layerCanvas = (z: number, blend: string | null) => {
  const c = document.createElement('canvas');
  c.setAttribute('aria-hidden', 'true');
  Object.assign(c.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: String(z),
  });
  if (blend) c.style.mixBlendMode = blend;
  return c;
};

/**
 * Mount the layer on the graph's host element (the one `createSwarmGraph` drew into). Returns
 * null without WebGL; the SVG graph then carries everything, as it does with reduced motion.
 */
export const createSwarmEffects = (
  host: HTMLElement,
  graph: SwarmGraphRenderer,
  options: SwarmEffectsOptions,
): SwarmEffectsLayer | null => {
  if (!canWebGL()) return null;
  let mode = options.mode;
  const colors = colorResolver(host);
  const bodyBg = colors.resolve(getComputedStyle(document.body).backgroundColor);
  const light = 0.2126 * bodyBg.r + 0.7152 * bodyBg.g + 0.0722 * bodyBg.b > 0.5;
  const mobile = window.matchMedia('(pointer: coarse)').matches || host.clientWidth < 640;
  const capacity = mobile ? 1000 : 4000;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  let over: THREE.WebGLRenderer;
  let under: THREE.WebGLRenderer;
  try {
    over = new THREE.WebGLRenderer({
      canvas: layerCanvas(2, light ? 'multiply' : 'screen'),
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    under = new THREE.WebGLRenderer({
      canvas: layerCanvas(0, null),
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
    });
  } catch {
    colors.dispose();
    return null;
  }
  over.outputColorSpace = THREE.LinearSRGBColorSpace;
  under.outputColorSpace = THREE.LinearSRGBColorSpace;
  over.setClearColor(0x000000, 1);
  under.setClearColor(0x000000, 0);
  over.domElement.dataset.slot = 'swarm-effects';
  host.prepend(under.domElement);
  host.append(over.domElement);
  // The SVG sits between the two canvases.
  const svg = host.querySelector('svg');
  if (svg) {
    svg.style.position = 'relative';
    svg.style.zIndex = '1';
  }

  // ---- particles ------------------------------------------------------------------------------
  const pool = createParticlePool(capacity);
  const geometry = new THREE.BufferGeometry();
  const attr = (array: Float32Array, size: number) =>
    new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
  const aPos = attr(pool.position, 3);
  const aColor = attr(pool.color, 4);
  const aExtra = attr(pool.extra, 4);
  geometry.setAttribute('position', aPos);
  geometry.setAttribute('aColor', aColor);
  geometry.setAttribute('aExtra', aExtra);
  geometry.setDrawRange(0, 0);
  const pointUniforms = {
    uView: { value: new THREE.Vector3(0, 0, 1) },
    uParallax: { value: new THREE.Vector2(0, 0) },
    uPixelRatio: { value: dpr },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: pointUniforms,
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(points);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

  // ---- background quad --------------------------------------------------------------------------
  const quadUniforms = {
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uEnergy: { value: 0.03 },
    uLight: { value: light ? 1 : 0 },
    uCount: { value: 0 },
    uLights: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector4()) },
    uColors: { value: Array.from({ length: LIGHTS }, () => new THREE.Vector3()) },
    uHeat: { value: new Array<number>(LIGHTS).fill(0) },
    uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4()) },
  };
  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quadMaterial = new THREE.ShaderMaterial({
    uniforms: quadUniforms,
    vertexShader: QUAD_VERT,
    fragmentShader: QUAD_FRAG,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(quadGeometry, quadMaterial);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- post-processing (Full) -------------------------------------------------------------------
  const composer = new EffectComposer(over);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0);
  const afterimage = new AfterimagePass(0.82);
  const rgbShift = new ShaderPass(RGBShiftShader);
  const multiply = new ShaderPass(MULTIPLY_SHADER);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(afterimage);
  composer.addPass(rgbShift);
  composer.addPass(multiply);
  afterimage.enabled = false;
  rgbShift.enabled = false;
  multiply.enabled = light;
  // Bloom on a white page reads poorly: the light theme gets the multiply tint instead.
  bloom.enabled = !light;

  // ---- state ------------------------------------------------------------------------------------
  const quality = createQuality({ initial: mobile ? 'medium' : 'high' });
  const activity = createActivity();
  const heat = new Map<string, number>();
  const ripples: { x: number; y: number; start: number; strength: number }[] = [];
  let replaying = false;
  let scrubbing = false;
  let pulse = 0;
  let width = 0;
  let height = 0;
  let frame = 0;
  let frameNo = 0;
  let gaveUp = false;
  let running = false;
  let last = performance.now();
  const frameTimes = new Float32Array(FRAMES);
  const workTimes = new Float32Array(FRAMES);
  let frameIndex = 0;
  let frameCount = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  let sizedFor = '';
  const resize = (level: QualityLevel) => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const key = `${w}x${h}@${level}`;
    if (key === sizedFor) return;
    sizedFor = key;
    width = w;
    height = h;
    const res = QUALITY[level].resolution;
    over.setPixelRatio(dpr * res);
    over.setSize(w, h, false);
    // The background is soft: half resolution (or less) is plenty.
    under.setPixelRatio((dpr * res) / 2);
    under.setSize(w, h, false);
    composer.setPixelRatio(dpr * res);
    composer.setSize(w, h);
    pointUniforms.uPixelRatio.value = dpr * res;
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    quadUniforms.uRes.value.set(w, h);
  };

  const node = (id: string): SwarmNodeView | null => graph.nodeAt(id);

  const effect = (e: SwarmEffect) => {
    if (e.kind === 'clear') {
      pool.clear();
      ripples.length = 0;
      return;
    }
    if (document.hidden) return;
    const n = node(e.nodeId);
    if (!n) return;
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const c = colors.resolve(e.color);
    const sectorOf = n.kind === 'sector' ? n.id : n.sectorId ? `sector:${n.sectorId}` : n.id;
    switch (e.kind) {
      case 'merge':
        emitMergeBurst(pool, x, y, n.r, c, mobile ? 30 : 64);
        addRipple(x, y, 1);
        pulse = 1;
        activity.bump(sectorOf, 3);
        break;
      case 'rating':
        emitRatingFountain(pool, x, y, n.r, c, e.delta ?? 0);
        if ((e.delta ?? 0) > 0) {
          emitFlare(pool, x, y - n.r * 0.2, n.r, c);
          pulse = Math.max(pulse, 0.6);
        }
        activity.bump(sectorOf, 2);
        break;
      case 'rung':
        emitShockwave(pool, x, y, n.r, c, mobile ? 28 : 56);
        addRipple(x, y, 0.8);
        pulse = 1;
        activity.bump(sectorOf, 2);
        break;
      case 'milestone':
        emitPuff(pool, x, y, c, 16);
        activity.bump(sectorOf, 1.5);
        break;
      case 'bury':
        emitEmbers(pool, x, y, n.r, c);
        activity.bump(sectorOf, 0.5);
        break;
      case 'reject':
        emitPuff(pool, x, y, c, 6);
        activity.bump(sectorOf, 0.5);
        break;
      case 'pass':
        emitPuff(pool, x, y, c, 5);
        activity.bump(sectorOf, 0.3);
        break;
    }
  };

  const addRipple = (x: number, y: number, strength: number) => {
    if (mode !== 'full') return;
    if (ripples.length >= RIPPLES) ripples.shift();
    ripples.push({ x, y, start: performance.now(), strength });
  };

  const flow = (f: SwarmFlow) => {
    if (!f.sector) return;
    const id = `sector:${f.sector}`;
    const gate = options.gateOf?.(f) ?? null;
    if (gate === 'start') heat.set(id, 1);
    else if (gate === 'end') heat.set(id, Math.min(heat.get(id) ?? 0, 0.4));
    else if (gate === null && f.sub === 'game') heat.set(id, Math.max(heat.get(id) ?? 0, 0.8));
    activity.bump(id, 0.4);
  };

  const live = new Map<string, number>();
  const lightNodes: SwarmNodeView[] = [];

  const step = (now: number) => {
    const raw = now - last;
    const dt = Math.min(100, raw);
    last = now;
    const level = quality.sample(raw);
    resize(level);
    if (quality.hopeless) {
      giveUp();
      return;
    }
    frameTimes[frameIndex] = raw;
    frameIndex = (frameIndex + 1) % FRAMES;
    frameCount = Math.min(FRAMES, frameCount + 1);
    const q = QUALITY[level];
    pool.setLimit(capacity * q.particles);

    const view = graph.viewport();
    pointUniforms.uView.value.set(view.x, view.y, view.k);
    // A very slight parallax that follows the pointer while a replay plays, unless the
    // viewer has moved the view themselves.
    const follow = replaying && !view.moved;
    pointer.x += ((follow ? pointer.tx : 0) - pointer.x) * 0.06;
    pointer.y += ((follow ? pointer.ty : 0) - pointer.y) * 0.06;
    pointUniforms.uParallax.value.set(pointer.x * 6, pointer.y * 6);

    // Comet trails behind every spark in flight.
    if (q.trails)
      graph.eachSpark((x, y, css, size, spark) => {
        if (spark || Math.random() < 0.25) emitComet(pool, x, y, colors.resolve(css), size);
      });

    // Who is where: live agents per sector, for the lights and the sparkles.
    live.clear();
    lightNodes.length = 0;
    graph.eachNode((n) => {
      if (n.kind === 'agent' && n.active && n.sectorId)
        live.set(`sector:${n.sectorId}`, (live.get(`sector:${n.sectorId}`) ?? 0) + 1);
      if ((n.kind === 'sector' || n.kind === 'hub') && lightNodes.length < LIGHTS)
        lightNodes.push(n);
    });
    for (const n of lightNodes) {
      const agents = live.get(n.id) ?? 0;
      // Idle nodes with agents on them breathe with a slow sparkle.
      if (agents && Math.random() < (dt / 700) * Math.min(3, agents))
        emitSparkle(pool, n.x ?? 0, n.y ?? 0, n.r, colors.resolve(n.color ?? 'var(--fg-2)'));
    }
    if (replaying && q.ambient && Math.random() < dt / 90)
      emitMote(pool, width / view.k, height / view.k, colors.resolve('var(--fg-2)'));

    pool.step(dt);
    const count = pool.count;
    geometry.setDrawRange(0, count);
    for (const [a, size] of [
      [aPos, 3],
      [aColor, 4],
      [aExtra, 4],
    ] as const) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, count) * size);
      a.needsUpdate = true;
    }

    // Post-processing in Full mode, switched by the quality level.
    pulse = Math.max(0, pulse - dt / 380);
    const post = mode === 'full' && q.post;
    bloom.enabled = post && q.bloom && !light;
    bloom.strength = 0.8 + pulse * 0.6;
    rgbShift.enabled = post && pulse > 0.02;
    rgbShift.uniforms.amount.value = 0.0028 * pulse * pulse;
    rgbShift.uniforms.angle.value = now * 0.001;
    afterimage.enabled = post && scrubbing && level === 'high';
    if (post || light) composer.render(dt / 1000);
    else over.render(scene, camera);

    // Background: lights, heat, ripples.
    activity.decay(dt);
    quadUniforms.uTime.value = now / 1000;
    quadUniforms.uEnergy.value = mode === 'full' ? 0.03 : 0.018;
    let i = 0;
    for (const n of lightNodes) {
      const sx = view.width / 2 + view.x + view.k * (n.x ?? 0);
      const sy = view.height / 2 + view.y + view.k * (n.y ?? 0);
      const agents = live.get(n.id) ?? 0;
      const busy = Math.min(1, activity.level(n.id) + agents * 0.18);
      quadUniforms.uLights.value[i].set(sx, sy, view.k * n.r * 3.2 + 40, busy);
      const c = colors.resolve(n.kind === 'hub' ? 'var(--fg-2)' : (n.color ?? 'var(--fg-3)'));
      quadUniforms.uColors.value[i].set(c.r, c.g, c.b);
      const h = Math.max(0, (heat.get(n.id) ?? 0) - dt / 25_000);
      if (h > 0) heat.set(n.id, h);
      else heat.delete(n.id);
      quadUniforms.uHeat.value[i] = mode === 'full' ? h : 0;
      i++;
    }
    quadUniforms.uCount.value = i;
    for (let r = 0; r < RIPPLES; r++) {
      const rp = ripples[r];
      const u = quadUniforms.uRipples.value[r];
      if (!rp) {
        u.set(0, 0, 0, 0);
        continue;
      }
      const t = (now - rp.start) / 1100;
      if (t >= 1) {
        u.set(0, 0, 0, 0);
        continue;
      }
      u.set(
        view.width / 2 + view.x + view.k * rp.x,
        view.height / 2 + view.y + view.k * rp.y,
        t,
        rp.strength,
      );
    }
    while (ripples.length && now - ripples[0].start > 1100) ripples.shift();
    if (frameNo++ % QUALITY[level].backgroundEvery === 0) under.render(quadScene, quadCamera);
    over.domElement.dataset.level = level;
    over.domElement.dataset.particles = String(count);
  };

  /** This machine cannot carry the layer: stop, hide, and hand everything back to the SVG. */
  const giveUp = () => {
    if (gaveUp) return;
    gaveUp = true;
    stop();
    pool.clear();
    over.domElement.style.display = 'none';
    under.domElement.style.display = 'none';
    graph.setLayered(false);
    options.onGiveUp?.();
  };

  const loop = (now: number) => {
    if (!running) return;
    const slot = frameIndex;
    step(now);
    workTimes[slot] = performance.now() - now;
    frame = requestAnimationFrame(loop);
  };
  const start = () => {
    if (running || gaveUp) return;
    running = true;
    last = performance.now();
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };
  // Hidden: stop drawing. The graph's catch-up replays what was missed once it is visible.
  const onVisible = () => (document.hidden ? stop() : start());
  const onPointer = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  document.addEventListener('visibilitychange', onVisible);
  host.addEventListener('pointermove', onPointer, { passive: true });
  graph.setLayered(true);
  resize(quality.level);
  if (!document.hidden) start();

  const stats = (): SwarmEffectsStats => {
    const pct = (arr: Float32Array) => {
      const xs = Array.from(arr.subarray(0, frameCount)).sort((a, b) => a - b);
      return (p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
    };
    const frames = pct(frameTimes);
    const work = pct(workTimes);
    return {
      medianMs: frames(0.5),
      p95Ms: frames(0.95),
      workMedianMs: work(0.5),
      workP95Ms: work(0.95),
      level: quality.level,
      particles: pool.count,
      mode,
    };
  };

  const destroy = () => {
    stop();
    document.removeEventListener('visibilitychange', onVisible);
    host.removeEventListener('pointermove', onPointer);
    graph.setLayered(false);
    geometry.dispose();
    material.dispose();
    quadGeometry.dispose();
    quadMaterial.dispose();
    for (const p of [renderPass, bloom, afterimage, rgbShift, multiply]) p.dispose();
    composer.dispose();
    for (const r of [over, under]) {
      r.dispose();
      // Release the context now rather than whenever the collector gets to it.
      r.forceContextLoss();
      r.domElement.remove();
    }
    if (svg) {
      svg.style.position = '';
      svg.style.zIndex = '';
    }
    colors.dispose();
  };

  return {
    effect,
    flow,
    setMode: (m) => {
      mode = m;
      if (m !== 'full') ripples.length = 0;
    },
    setReplaying: (on) => {
      replaying = on;
    },
    setScrubbing: (on) => {
      scrubbing = on;
    },
    stats,
    destroy,
  };
};

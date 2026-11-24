'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MOTES, boards, driftAngle, framing, motePosition, type BoardShape } from '@/lib/backdrop';

/** Frames drawn per second while the field drifts: the motion is slow enough that 30 is smooth. */
const FRAME_MS = 1000 / 30;
const MAX_DPR = 1.5;
/** Hairline and fill strengths. Kept low so the headline keeps AA over the brightest frame. */
const LINE_OPACITY = 0.34;
const FILL_OPACITY = 0.05;
const MOTE_OPACITY = 0.75;

/** The host element also carries a frame count, read by the browser check, never by the page. */
type BackdropHost = HTMLDivElement & { backdropFrames?: number };

type Motion = 'running' | 'paused' | 'still';

/**
 * Resolves a palette token to sRGB through a 2D canvas, so `light-dark()` and `oklch()` come out
 * as the browser paints them, in the theme the page is in now.
 */
const tokenReader = (host: HTMLElement) => {
  const probe = document.createElement('span');
  probe.hidden = true;
  host.appendChild(probe);
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const read = (name: string) => {
    probe.style.color = `var(--${name})`;
    const css = getComputedStyle(probe).color;
    const c = new THREE.Color();
    if (!ctx) return c;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  };
  return { read, dispose: () => probe.remove() };
};

const lineGeometry = (shape: BoardShape) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(shape.lines, 3));
  return g;
};

const quadGeometry = (shape: BoardShape) => {
  const pts: number[] = [];
  for (const [a, b, c, d] of shape.quads) pts.push(...a, ...b, ...c, ...a, ...c, ...d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
};

const cameraFor = (w: number, h: number) => {
  const f = framing(w, h);
  const camera = new THREE.PerspectiveCamera(f.fov, f.aspect, 0.1, 120);
  camera.position.set(...f.position);
  camera.lookAt(...f.target);
  return { camera, f };
};

type Stroke = { d: string; slot: number; opacity: number };

/**
 * The static fallback: the same field projected through the same camera, as SVG hairlines in
 * the series tokens, so a browser without WebGL (or a low-power device) sees the same picture.
 */
const projectStrokes = (shapes: BoardShape[], w: number, h: number): Stroke[] => {
  const { camera, f } = cameraFor(w, h);
  camera.updateMatrixWorld();
  const v = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number) => {
    v.set(x, y, z).project(camera);
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
  };
  const out: Stroke[] = [];
  const eye = new THREE.Vector3(...f.position);
  for (const s of shapes) {
    // One stroke per board, faded by its distance as the fog does in the WebGL scene.
    const mid = s.anchors[Math.floor(s.anchors.length / 2)];
    const dist = eye.distanceTo(new THREE.Vector3(...mid));
    const fog = Math.min(1, Math.max(0, (dist - f.fogNear) / (f.fogFar - f.fogNear)));
    const parts: string[] = [];
    for (let i = 0; i < s.lines.length; i += 6) {
      const [x0, y0] = toScreen(s.lines[i], s.lines[i + 1], s.lines[i + 2]);
      const [x1, y1] = toScreen(s.lines[i + 3], s.lines[i + 4], s.lines[i + 5]);
      parts.push(`M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`);
    }
    out.push({ d: parts.join(''), slot: s.slot, opacity: LINE_OPACITY * (1 - fog) });
  }
  return out;
};

const SERIES_STROKE = [
  'stroke-series-1',
  'stroke-series-2',
  'stroke-series-3',
  'stroke-series-4',
] as const;

type StaticFieldProps = { width: number; height: number };

const StaticField = ({ width, height }: StaticFieldProps) => {
  const strokes = projectStrokes(boards(), width, height);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="absolute inset-0 size-full"
      fill="none"
      strokeWidth={1}
      aria-hidden="true"
    >
      {strokes.map((s) => (
        <path key={s.slot} d={s.d} className={SERIES_STROKE[s.slot]} opacity={s.opacity} />
      ))}
    </svg>
  );
};

const weakDevice = () => {
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  return (
    Boolean(nav.connection?.saveData) ||
    (nav.hardwareConcurrency ?? 8) <= 2 ||
    (nav.deviceMemory ?? 8) <= 1
  );
};

/**
 * The homepage backdrop (issue #234): the four boards lying on one floor, receding into the
 * page colour, and a few motes crossing from one board to the next. Very slow; it pauses when
 * the tab is hidden or the overview is scrolled away, draws one still frame under reduced
 * motion, and falls back to the same picture in SVG without WebGL.
 */
const HomeBackdropScene = () => {
  const host = useRef<BackdropHost>(null);
  const [fallback, setFallback] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const size = () => ({ width: el.clientWidth || 1, height: el.clientHeight || 1 });
    if (weakDevice()) {
      setFallback(size());
      el.dataset.backdrop = 'svg';
      el.dataset.motion = 'still';
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: window.devicePixelRatio < 1.5,
        alpha: true,
        powerPreference: 'low-power',
      });
    } catch {
      setFallback(size());
      el.dataset.backdrop = 'svg';
      el.dataset.motion = 'still';
      return;
    }
    el.dataset.backdrop = 'webgl';
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'absolute inset-0 size-full';
    el.appendChild(renderer.domElement);

    const tokens = tokenReader(el);
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x000000, 12, 44);
    scene.fog = fog;
    const field = new THREE.Group();
    scene.add(field);

    const shapes = boards();
    const lineMats: THREE.LineBasicMaterial[] = [];
    const fillMats: THREE.MeshBasicMaterial[] = [];
    for (const s of shapes) {
      const lm = new THREE.LineBasicMaterial({
        transparent: true,
        opacity: LINE_OPACITY,
        depthWrite: false,
      });
      lineMats[s.slot] = lm;
      field.add(new THREE.LineSegments(lineGeometry(s), lm));
      if (s.quads.length) {
        const fm = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: FILL_OPACITY,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        fillMats[s.slot] = fm;
        field.add(new THREE.Mesh(quadGeometry(s), fm));
      }
    }

    const motePos = new Float32Array(MOTES * 3);
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({
      size: 3,
      sizeAttenuation: false,
      transparent: true,
      opacity: MOTE_OPACITY,
      depthWrite: false,
    });
    field.add(new THREE.Points(moteGeo, moteMat));

    const paint = () => {
      // Fog fades far boards into the ground they sit on; the canvas itself stays transparent.
      fog.color.copy(tokens.read('bg'));
      shapes.forEach((s) => {
        const c = tokens.read(`series-${s.slot + 1}`);
        lineMats[s.slot].color.copy(c);
        fillMats[s.slot]?.color.copy(c);
      });
      moteMat.color.copy(tokens.read('fg-3'));
    };
    paint();

    let camera = cameraFor(1, 1).camera;
    let baseX = 0;
    const pointer = { x: 0, tx: 0 };
    const resize = () => {
      const { width, height } = size();
      renderer.setSize(width, height, false);
      const next = cameraFor(width, height);
      camera = next.camera;
      baseX = camera.position.x;
      fog.near = next.f.fogNear;
      fog.far = next.f.fogFar;
    };

    // Clock that only advances while the scene runs, so a pause resumes where it stopped.
    let clock = 0;
    let lastTick = 0;
    let frames = 0;
    const render = () => {
      field.rotation.y = driftAngle(clock);
      for (let m = 0; m < MOTES; m++) motePos.set(motePosition(shapes, m, clock), m * 3);
      moteGeo.attributes.position.needsUpdate = true;
      // A few pixels of parallax from the pointer, eased; nothing follows the cursor.
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      camera.position.x = baseX + pointer.x * 0.35;
      renderer.render(scene, camera);
      frames += 1;
      el.backdropFrames = frames;
    };

    let onScreen = true;
    let frame = 0;
    let motion: Motion = 'paused';
    const setMotion = (m: Motion) => {
      motion = m;
      el.dataset.motion = m;
    };
    const loop = (t: number) => {
      if (motion !== 'running') return;
      if (t - lastTick >= FRAME_MS) {
        // Cap the step so a long stall (a background throttle) does not jump the scene.
        clock += Math.min(t - lastTick, 100);
        lastTick = t;
        render();
      }
      frame = requestAnimationFrame(loop);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      if (motionQuery.matches) {
        setMotion('still');
        return;
      }
      if (document.hidden || !onScreen) {
        setMotion('paused');
        return;
      }
      if (motion !== 'running') {
        setMotion('running');
        lastTick = performance.now();
      }
      frame = requestAnimationFrame(loop);
    };

    const still = () => {
      resize();
      render();
    };

    const onResize = () => still();
    const onPointer = (e: PointerEvent) => {
      if (motion === 'running') pointer.tx = e.clientX / window.innerWidth - 0.5;
    };
    const onTheme = () => {
      paint();
      render();
    };
    const onMotion = () => {
      still();
      update();
    };
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      update();
    });
    const themeObserver = new MutationObserver(onTheme);
    const ro = new ResizeObserver(onResize);

    still();
    io.observe(el);
    ro.observe(el);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pointermove', onPointer, { passive: true });
    darkQuery.addEventListener('change', onTheme);
    motionQuery.addEventListener('change', onMotion);
    update();
    requestAnimationFrame(() => el.setAttribute('data-ready', ''));

    return () => {
      motion = 'paused';
      cancelAnimationFrame(frame);
      io.disconnect();
      ro.disconnect();
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pointermove', onPointer);
      darkQuery.removeEventListener('change', onTheme);
      motionQuery.removeEventListener('change', onMotion);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Points)
          o.geometry.dispose();
      });
      [...lineMats, ...fillMats.filter(Boolean), moteMat].forEach((m) => m.dispose());
      tokens.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={host}
      data-slot="home-backdrop"
      className="absolute inset-0 opacity-0 transition-opacity duration-1000 data-[ready]:opacity-100 data-[backdrop=svg]:opacity-100"
    >
      {fallback && <StaticField width={fallback.width} height={fallback.height} />}
    </div>
  );
};

export default HomeBackdropScene;

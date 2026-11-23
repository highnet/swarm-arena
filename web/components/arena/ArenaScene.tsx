'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/** Engine colours, in track order (chess, go9, othello, hex). Mirrors --series-1..4. */
const SERIES = [0x3987e5, 0xd95926, 0x199e70, 0xc98500];

type Board = { group: THREE.Group; depth: number; spin: number; base: THREE.Vector3 };

const lineMat = (color: number, opacity: number) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

const segments = (points: number[], mat: THREE.Material) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(g, mat);
};

/** 8×8 grid with every other square raised a hair: a chess board drawn in wire. */
const chessBoard = (color: number) => {
  const group = new THREE.Group();
  const pts: number[] = [];
  for (let i = 0; i <= 8; i++) {
    pts.push(i - 4, -4, 0, i - 4, 4, 0, -4, i - 4, 0, 4, i - 4, 0);
  }
  group.add(segments(pts, lineMat(color, 0.55)));
  const tile = new THREE.PlaneGeometry(0.92, 0.92);
  const tileMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  for (let x = 0; x < 8; x++)
    for (let y = 0; y < 8; y++)
      if ((x + y) % 2 === 0) {
        const m = new THREE.Mesh(tile, tileMat);
        m.position.set(x - 3.5, y - 3.5, 0.02);
        group.add(m);
      }
  return group;
};

/** 9×9 intersections with a handful of stones. */
const goBoard = (color: number, rand: () => number) => {
  const group = new THREE.Group();
  const pts: number[] = [];
  for (let i = 0; i < 9; i++) {
    pts.push(i - 4, -4, 0, i - 4, 4, 0, -4, i - 4, 0, 4, i - 4, 0);
  }
  group.add(segments(pts, lineMat(color, 0.5)));
  const stone = new THREE.SphereGeometry(0.3, 16, 10);
  const black = new THREE.MeshBasicMaterial({ color: 0x232833, transparent: true, opacity: 0.8 });
  const white = new THREE.MeshBasicMaterial({ color: 0x9aa1ae, transparent: true, opacity: 0.55 });
  for (let k = 0; k < 14; k++) {
    const m = new THREE.Mesh(stone, k % 2 ? white : black);
    m.position.set(Math.floor(rand() * 9) - 4, Math.floor(rand() * 9) - 4, 0.2);
    m.scale.z = 0.45;
    group.add(m);
  }
  return group;
};

/** 8×8 frame with the four starting discs and a few flips. */
const othelloBoard = (color: number, rand: () => number) => {
  const group = new THREE.Group();
  const pts: number[] = [];
  for (let i = 0; i <= 8; i++) {
    pts.push(i - 4, -4, 0, i - 4, 4, 0, -4, i - 4, 0, 4, i - 4, 0);
  }
  group.add(segments(pts, lineMat(color, 0.5)));
  const disc = new THREE.CylinderGeometry(0.38, 0.38, 0.12, 24);
  const a = new THREE.MeshBasicMaterial({ color: 0x232833, transparent: true, opacity: 0.8 });
  const b = new THREE.MeshBasicMaterial({ color: 0x9aa1ae, transparent: true, opacity: 0.55 });
  const cells = [
    [3, 3, 0],
    [4, 4, 0],
    [3, 4, 1],
    [4, 3, 1],
  ];
  for (let k = 0; k < 10; k++)
    cells.push([2 + Math.floor(rand() * 4), 2 + Math.floor(rand() * 4), k % 2]);
  for (const [x, y, c] of cells) {
    const m = new THREE.Mesh(disc, c ? b : a);
    m.rotation.x = Math.PI / 2;
    m.position.set(x - 3.5, y - 3.5, 0.1);
    group.add(m);
  }
  return group;
};

/** An 11×11 rhombus of hexagon outlines. */
const hexBoard = (color: number) => {
  const pts: number[] = [];
  const r = 0.42;
  const w = Math.sqrt(3) * r;
  for (let q = 0; q < 11; q++)
    for (let s = 0; s < 11; s++) {
      const cx = (q + s / 2 - 7.5) * w;
      const cy = s * 1.5 * r - 3.5;
      for (let k = 0; k < 6; k++) {
        const a0 = (Math.PI / 3) * k + Math.PI / 6;
        const a1 = a0 + Math.PI / 3;
        pts.push(
          cx + r * Math.cos(a0),
          cy + r * Math.sin(a0),
          0,
          cx + r * Math.cos(a1),
          cy + r * Math.sin(a1),
          0,
        );
      }
    }
  const group = new THREE.Group();
  group.add(segments(pts, lineMat(color, 0.5)));
  return group;
};

/** Deterministic so the server-rendered page and every visit draw the same scene. */
const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * The page background: the four boards drifting at different depths. Scrolling moves the camera
 * down through them, so nearer boards travel faster than far ones; the pointer tilts the view.
 */
const ArenaScene = () => {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
    } catch {
      return; // No WebGL: the page reads fine without the scene.
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x14161b, 18, 46);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0, 22);

    const rand = mulberry(7);
    const make = [
      () => chessBoard(SERIES[0]),
      () => goBoard(SERIES[1], rand),
      () => othelloBoard(SERIES[2], rand),
      () => hexBoard(SERIES[3]),
    ];
    // x, y, z and tilt for each board: spread across the first two screens, at varied depths.
    const layout: [number, number, number, number, number][] = [
      [5, 0.5, -1, -0.95, 0.55],
      [-12, -6, -6, -0.7, -0.6],
      [12, -13, -3, -1.0, 0.3],
      [-8, -20, 0, -0.8, -0.4],
      // A second pass further down so the parallax carries through the whole page.
      [10, -30, -5, -0.6, -0.5],
      [-11, -40, -2, -0.9, 0.4],
      [12, -50, -6, -0.75, 0.6],
      [-9, -60, -3, -1.0, -0.3],
    ];
    const boards: Board[] = layout.map((_, i) => {
      const group = make[i % make.length]();
      const [x, y, z, rx, rz] = layout[i];
      group.position.set(x, y, z);
      group.rotation.set(rx, 0, rz);
      group.scale.setScalar(0.9);
      scene.add(group);
      return {
        group,
        depth: 1 + z / -14,
        spin: (i % 2 ? -1 : 1) * 0.04,
        base: group.position.clone(),
      };
    });

    // Dust: points scattered through the volume, the cheapest strong depth cue.
    const dustPts: number[] = [];
    for (let i = 0; i < 420; i++)
      dustPts.push((rand() - 0.5) * 60, 10 - rand() * 80, -20 + rand() * 30);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPts, 3));
    const dust = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({ color: 0x9aa3b5, size: 0.06, transparent: true, opacity: 0.6 }),
    );
    scene.add(dust);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let scrollY = window.scrollY;
    let smooth = scrollY;
    let frame = 0;
    let running = true;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      // Narrow screens: pull back so boards stay at the edges instead of under the text.
      camera.position.z = w < 768 ? 30 : 22;
      camera.updateProjectionMatrix();
    };

    const render = (t: number) => {
      smooth += (scrollY - smooth) * (reduced ? 1 : 0.08);
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      // Whole page maps onto the whole scene, so short and long pages both pass every board.
      const room = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const travel = (smooth / room) * 8; // scene "screens" travelled
      camera.position.y = -travel * 7;
      camera.position.x = pointer.x * 0.8;
      camera.lookAt(pointer.x * 0.3, camera.position.y - pointer.y * 0.6, 0);
      for (const b of boards) {
        // Parallax: each board slides at its own rate against the camera.
        b.group.position.y = b.base.y + travel * 7 * (1 - b.depth) * 0.9;
        if (!reduced) b.group.rotation.y = Math.sin(t * 0.0002 * (1 + b.spin * 10)) * 0.25;
      }
      dust.position.y = travel * 2.5;
      if (!reduced) dust.rotation.y = t * 0.00002;
      renderer.render(scene, camera);
    };

    const loop = (t: number) => {
      if (!running) return;
      render(t);
      frame = requestAnimationFrame(loop);
    };

    const onScroll = () => {
      scrollY = window.scrollY;
      if (reduced) render(0);
    };
    const onPointer = (e: PointerEvent) => {
      pointer.tx = e.clientX / window.innerWidth - 0.5;
      pointer.ty = e.clientY / window.innerHeight - 0.5;
    };
    const onVisible = () => {
      running = !document.hidden && !reduced;
      cancelAnimationFrame(frame);
      if (running) frame = requestAnimationFrame(loop);
    };
    const onResize = () => {
      resize();
      render(performance.now());
    };

    resize();
    render(0);
    onVisible();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    if (!reduced) window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    requestAnimationFrame(() => el.setAttribute('data-ready', ''));

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisible);
      scene.traverse((o) => {
        if (
          o instanceof THREE.Mesh ||
          o instanceof THREE.LineSegments ||
          o instanceof THREE.Points
        ) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-0 transition-opacity duration-1000 data-[ready]:opacity-100 [mask-image:linear-gradient(to_bottom,black,black_55%,rgb(0_0_0/0.45))]"
    />
  );
};

export default ArenaScene;

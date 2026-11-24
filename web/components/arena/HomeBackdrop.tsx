'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

/** three.js loads only in the browser, once the page is idle, so it never competes with content. */
const HomeBackdropScene = dynamic(() => import('./HomeBackdropScene'), { ssr: false });

/**
 * The homepage's own backdrop, mounted inside the overview band (issue #234). It renders
 * nothing on the server and nothing until the browser is idle, so first paint and LCP are the
 * page's text alone. Every other route keeps `SceneBackground`.
 */
const HomeBackdrop = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const start = () => setReady(true);
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(start, { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(start, 1200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      aria-hidden="true"
      className="bleed-full pointer-events-none absolute inset-0 -z-10 overflow-hidden home-backdrop-mask"
    >
      {ready && <HomeBackdropScene />}
    </div>
  );
};

export { HomeBackdrop };

'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

/** three.js loads only in the browser, once the page is idle, so it never competes with content. */
const ArenaScene = dynamic(() => import('./ArenaScene'), { ssr: false });

/** Pages that open on calm, opaque section bands, where a moving backdrop is decoration only. */
const CALM_PAGES = new Set(['/']);

const SceneBackground = () => {
  const calm = CALM_PAGES.has(usePathname());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    };
    const start = () => setReady(true);
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(start, { timeout: 2500 });
      return () =>
        (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(start, 1200);
    return () => clearTimeout(t);
  }, []);
  return ready && !calm ? <ArenaScene /> : null;
};

export { SceneBackground };

'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

/** three.js loads only in the browser, once the page is quiet, so it never competes with content. */
const HomeBackdropScene = dynamic(() => import('./HomeBackdropScene'), { ssr: false });

/**
 * How long the main thread must go without a long task before the backdrop starts: the quiet
 * window that defines Time to Interactive. Parsing three.js and setting up WebGL are long tasks
 * on a slow phone; starting them only after this window keeps them out of the interactive path.
 */
const QUIET_MS = 5000;

/**
 * The homepage's own backdrop, mounted inside the overview band (issue #234). It renders
 * nothing on the server and nothing until the page has loaded and gone quiet, so first paint,
 * LCP and interactivity are the page's alone. It then fades in. Every other route keeps
 * `SceneBackground`.
 */
const HomeBackdrop = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let lastLong = 0;
    let timer = 0;
    let idle = 0;
    // Where long tasks are observable (Chromium), wait for a real quiet window; elsewhere the
    // same span after load.
    const longTasks = PerformanceObserver.supportedEntryTypes?.includes('longtask')
      ? new PerformanceObserver((list) => {
          for (const e of list.getEntries())
            lastLong = Math.max(lastLong, e.startTime + e.duration);
        })
      : null;
    longTasks?.observe({ type: 'longtask', buffered: true });
    const start = () => {
      longTasks?.disconnect();
      setReady(true);
    };
    const wait = () => {
      const quiet = performance.now() - lastLong;
      if (quiet < QUIET_MS) {
        timer = window.setTimeout(wait, QUIET_MS - quiet);
        return;
      }
      if (w.requestIdleCallback) idle = w.requestIdleCallback(start, { timeout: 2000 });
      else start();
    };
    const afterLoad = () => {
      lastLong = Math.max(lastLong, performance.now());
      wait();
    };
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
    return () => {
      window.removeEventListener('load', afterLoad);
      longTasks?.disconnect();
      clearTimeout(timer);
      if (idle) w.cancelIdleCallback?.(idle);
    };
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

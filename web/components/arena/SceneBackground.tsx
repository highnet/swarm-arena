'use client';

import dynamic from 'next/dynamic';

/** three.js loads only in the browser, after the page is interactive. */
const ArenaScene = dynamic(() => import('./ArenaScene'), { ssr: false });

const SceneBackground = () => <ArenaScene />;

export { SceneBackground };

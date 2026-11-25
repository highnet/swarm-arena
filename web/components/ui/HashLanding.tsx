'use client';

import { useEffect } from 'react';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type HashLandingProps = {
  /** The id of the section this sits in; the page scrolls to it when the URL's hash names it. */
  id: string;
};

/**
 * Lands a `#id` link on a section that streams in (#262). A page whose content renders inside
 * `<Suspense>` has no element with that id when the browser (a direct load) or Next's router (a
 * `<Link>` click) looks for it, so neither scrolls. Rendered inside the section, this mounts with
 * it and scrolls there once, smoothly only when the reader allows motion. Renders nothing.
 */
const HashLanding = ({ id }: HashLandingProps) => {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [id]);
  return null;
};

export { HashLanding };

/**
 * Realtime changes, passed from the one subscription (`LiveIndicator`) to whatever on the page
 * wants the row itself rather than a refresh (the swarm graph). A DOM event, so a test can fake
 * a payload with `window.dispatchEvent(new CustomEvent(LIVE_EVENT, { detail }))`.
 */

export const LIVE_EVENT = 'arena:live';

export type LiveChange = {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

export const publishLive = (change: LiveChange) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<LiveChange>(LIVE_EVENT, { detail: change }));
};

/** Listen for changes; returns the unsubscribe. */
export const onLive = (listener: (change: LiveChange) => void) => {
  const handler = (e: Event) => listener((e as CustomEvent<LiveChange>).detail);
  window.addEventListener(LIVE_EVENT, handler);
  return () => window.removeEventListener(LIVE_EVENT, handler);
};

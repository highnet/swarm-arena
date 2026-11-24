'use client';

import { startTransition, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { publishLive } from '@/lib/liveBus';
import { cn } from '@/lib/utils';

type LiveIndicatorProps = {
  runId: string;
  /** Agents working right now. Zero means the swarm is idle even if the stream is open. */
  working: number;
};

type Mode = 'snapshot' | 'connecting' | 'live' | 'polling';

const POLL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 8_000;
/**
 * Bursts (a gate match finishing game after game, seats heartbeating) collapse into one refresh
 * this often. Each refresh is a server render with fresh reads, so it is kept to a few seconds.
 */
const REFRESH_GAP_MS = 5_000;
/**
 * Tables the page follows from the pushed rows alone (`publishLive`), with no refresh: moves of
 * the games being played stream every second or so, and the boards patch themselves (#222).
 */
const PUSH_ONLY = new Set<string>(['live_games']);

/** Every table the site renders. All but `runs` are scoped to the run on screen. */
const RUN_TABLES = [
  'agents',
  'tasks',
  'records',
  'messages',
  'matches',
  'games',
  'live_games',
  'elo_points',
  'tracks',
  'rungs',
] as const;

const LABEL: Record<Mode, string> = {
  snapshot: 'Snapshot',
  connecting: 'Connecting',
  live: 'Live',
  polling: 'Auto-refresh',
};

const TITLE: Record<Mode, string> = {
  snapshot: 'No run yet',
  connecting: 'Connecting to the live record',
  live: 'Every change appears as it is written',
  polling: 'Refreshing every 30 seconds',
};

/**
 * Keeps every page live. It subscribes to Supabase Realtime for every table the site renders.
 * Each row is published on the page (`publishLive`) for components that show it at once; a change
 * to any table but the live moves also re-renders the route, whose live reads are never cached
 * (`getSnapshot`), so the refresh shows the new rows. The browser never expires the server's cache:
 * that was an unauthenticated lever on ISR writes (#222). Bursts are coalesced, a hidden tab does
 * not refresh, a tab that comes back into view catches up at once, and if the stream cannot be
 * opened (blocked socket, network policy, auth) it falls back to refreshing on a timer.
 */
const LiveIndicator = ({ runId, working }: LiveIndicatorProps) => {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(runId === 'not-started' ? 'snapshot' : 'connecting');

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    let poll: ReturnType<typeof setInterval> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const pull = () => {
      pending = undefined;
      last = Date.now();
      startTransition(() => router.refresh());
    };
    // Leading-edge after quiet, then at most one refresh per gap while changes keep coming. A
    // hidden tab does not refresh at all: it catches up once, when it is shown again (#197).
    const refresh = () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = setTimeout(pull, Math.max(150, REFRESH_GAP_MS - (Date.now() - last)));
    };
    const fallBack = () => {
      if (poll) return;
      setMode('polling');
      poll = setInterval(refresh, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    const connecting = setTimeout(() => setMode((m) => (m === 'snapshot' ? 'connecting' : m)), 0);
    const giveUp = setTimeout(fallBack, CONNECT_TIMEOUT_MS);

    const db = createClient(url, key, { auth: { persistSession: false } });
    let channel = db
      .channel(`live-${runId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, refresh);
    if (runId !== 'not-started')
      for (const table of RUN_TABLES)
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `run_id=eq.${runId}` },
          (payload) => {
            // The row itself, at once, for components that show it without a refresh.
            const row = (r: unknown) =>
              r && Object.keys(r).length ? (r as Record<string, unknown>) : null;
            publishLive({
              table,
              eventType: payload.eventType,
              new: row(payload.new),
              old: row(payload.old),
            });
            if (!PUSH_ONLY.has(table)) refresh();
          },
        );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(giveUp);
        clearInterval(poll);
        poll = undefined;
        setMode('live');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(giveUp);
        fallBack();
      }
    });
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(connecting);
      clearTimeout(giveUp);
      clearTimeout(pending);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      db.removeChannel(channel);
    };
  }, [runId, router]);

  // The connection says whether the page stays fresh; the agents say whether anything is happening.
  const idle = working === 0 && (mode === 'live' || mode === 'polling');
  const label = idle ? 'Idle' : LABEL[mode];
  const title = idle ? `No agent is working right now · ${TITLE[mode].toLowerCase()}` : TITLE[mode];

  return (
    <span
      data-slot="live-indicator"
      className="inline-flex items-center gap-1.5 text-xs text-fg-2"
      title={title}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          idle && 'bg-fg-3',
          !idle && mode === 'live' && 'animate-pulse-dot bg-good',
          !idle && mode === 'polling' && 'bg-good',
          mode === 'connecting' && 'bg-warning',
          mode === 'snapshot' && 'bg-fg-3',
        )}
      />
      {label}
    </span>
  );
};

export { LiveIndicator };

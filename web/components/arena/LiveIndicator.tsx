'use client';

import { startTransition, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { refreshLive } from '@/app/actions';
import { cn } from '@/lib/utils';

type LiveIndicatorProps = {
  runId: string;
  /** Agents working right now. Zero means the swarm is idle even if the stream is open. */
  working: number;
};

type Mode = 'snapshot' | 'connecting' | 'live' | 'polling';

const POLL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 8_000;
/** Bursts (a gate match finishing game after game) collapse into one refresh this often. */
const REFRESH_GAP_MS = 1_500;

/** Every table the site renders. All but `runs` are scoped to the run on screen. */
const RUN_TABLES = [
  'agents',
  'tasks',
  'records',
  'messages',
  'matches',
  'games',
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
 * Keeps every page live. It subscribes to Supabase Realtime for every table the site renders;
 * on a change it expires the server's cached snapshot (`refreshLive`) and re-renders the route,
 * so the page shows the new rows rather than a cached copy. Bursts are coalesced, a tab that
 * comes back into view catches up at once, and if the stream cannot be opened (blocked socket,
 * network policy, auth) it falls back to refreshing on a timer.
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
    const pull = async () => {
      pending = undefined;
      last = Date.now();
      await refreshLive().catch(() => undefined);
      startTransition(() => router.refresh());
    };
    // Leading-edge after quiet, then at most one refresh per gap while changes keep coming.
    const refresh = () => {
      if (pending) return;
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
          refresh,
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

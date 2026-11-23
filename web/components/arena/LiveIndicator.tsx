'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { cn } from '@/lib/utils';

type LiveIndicatorProps = {
  runId: string;
  /** Agents working right now. Zero means the swarm is idle even if the stream is open. */
  working: number;
};

type Mode = 'snapshot' | 'connecting' | 'live' | 'polling';

const POLL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 8_000;

const LABEL: Record<Mode, string> = {
  snapshot: 'Snapshot',
  connecting: 'Connecting',
  live: 'Live',
  polling: 'Auto-refresh',
};

const TITLE: Record<Mode, string> = {
  snapshot: 'No run yet',
  connecting: 'Connecting to the live record',
  live: 'New records appear as they are written',
  polling: 'Refreshing every 30 seconds',
};

/**
 * Streams new board records from Supabase Realtime and refreshes the page as they arrive.
 * If the stream cannot be opened (blocked socket, network policy, auth), it falls back to
 * refreshing on a timer, so the page never sits stale behind a "Connecting" dot.
 */
const LiveIndicator = ({ runId, working }: LiveIndicatorProps) => {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('snapshot');

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || runId === 'not-started') return;

    let poll: ReturnType<typeof setInterval> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const fallBack = () => {
      if (poll) return;
      setMode('polling');
      poll = setInterval(() => router.refresh(), POLL_MS);
    };
    const refresh = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => router.refresh(), 800);
    };

    const connecting = setTimeout(() => setMode((m) => (m === 'snapshot' ? 'connecting' : m)), 0);
    const giveUp = setTimeout(fallBack, CONNECT_TIMEOUT_MS);

    const db = createClient(url, key, { auth: { persistSession: false } });
    const channel = db
      .channel(`run-${runId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'records', filter: `run_id=eq.${runId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'elo_points', filter: `run_id=eq.${runId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `run_id=eq.${runId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agents', filter: `run_id=eq.${runId}` },
        refresh,
      )
      .subscribe((status) => {
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

    return () => {
      clearTimeout(connecting);
      clearTimeout(giveUp);
      clearTimeout(debounce);
      clearInterval(poll);
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

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { cn } from '@/lib/utils';

type LiveIndicatorProps = {
  runId: string;
  isSample: boolean;
};

/**
 * Subscribes to new board records when Supabase is configured and refreshes the server
 * snapshot as they arrive. Without credentials, the page is an honest static snapshot.
 */
const LiveIndicator = ({ runId, isSample }: LiveIndicatorProps) => {
  const router = useRouter();
  const [state, setState] = useState<'snapshot' | 'connecting' | 'live'>('snapshot');

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || isSample) return;
    const db = createClient(url, key, { auth: { persistSession: false } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    };
    const channel = db
      .channel(`run-${runId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: `run_id=eq.${runId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'elo_points', filter: `run_id=eq.${runId}` }, refresh)
      .subscribe((status) => setState(status === 'SUBSCRIBED' ? 'live' : 'connecting'));
    return () => {
      clearTimeout(timer);
      db.removeChannel(channel);
    };
  }, [runId, isSample, router]);

  return (
    <span
      data-slot="live-indicator"
      className="inline-flex items-center gap-1.5 text-xs text-fg-2"
      title={state === 'live' ? 'Receiving new records as they are written' : 'Static snapshot'}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          state === 'live' ? 'animate-pulse-dot bg-good' : state === 'connecting' ? 'bg-warning' : 'bg-fg-3',
        )}
      />
      {state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Snapshot'}
    </span>
  );
};

export { LiveIndicator };

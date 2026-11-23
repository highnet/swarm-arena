'use client';

import { useEffect, useState } from 'react';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** A live "running for" clock. Renders the server's value first, then ticks every second. */
const Elapsed = ({ since, asOf }: { since: string; asOf: string }) => {
  const [now, setNow] = useState(() => Date.parse(asOf));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={since} className="font-mono tabular" suppressHydrationWarning>
      {fmt(now - Date.parse(since))}
    </time>
  );
};

export { Elapsed };

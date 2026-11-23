'use client';

import { useEffect, useState } from 'react';
import { formatTime } from '@/lib/format';

const ago = (ms: number) => {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
};

type TimeAgoProps = {
  iso: string;
  className?: string;
};

/**
 * "6 min ago", kept fresh every half minute. The server cannot know the visitor's clock, so the
 * first paint shows the UTC time and the browser swaps in the relative one.
 */
const TimeAgo = ({ iso, className }: TimeAgoProps) => {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  return (
    <time dateTime={iso} title={`${formatTime(iso)} UTC`} className={className}>
      {now === null ? `${formatTime(iso)} UTC` : ago(now - Date.parse(iso))}
    </time>
  );
};

export { TimeAgo };

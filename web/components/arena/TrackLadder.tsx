import Link from 'next/link';
import { Typography } from '@/components/ui/Typography';
import type { TrackSummary } from '@/lib/derive';
import { formatElo } from '@/lib/format';
import { SERIES } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type TrackLadderProps = {
  tracks: TrackSummary[];
};

const TrackLadder = ({ tracks }: TrackLadderProps) => (
  <ul data-slot="track-ladder" className="divide-y divide-line">
    {tracks.map((t) => (
      <li key={t.id}>
        <Link
          href={`/engines/${t.id}`}
          className="group grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-x-4 px-4 py-2.5 transition-colors hover:bg-panel-raised"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn('size-2 shrink-0 rounded-full', SERIES[t.colorSlot].bg)} />
            <Typography variant="small" as="span" weight="medium" color="primary" truncate>
              {t.name}
            </Typography>
            {t.atWork && (
              <span
                className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-good"
                title="Agent at work"
                aria-label="Agent at work"
              />
            )}
          </div>
          <div className="flex min-w-0 items-center justify-end gap-3">
            <Typography variant="meta" as="span" truncate>
              {t.pastLadder
                ? 'ladder cleared · now rated against itself'
                : `next: ${t.nextRung?.label} · ${formatElo(t.nextRung?.elo)}`}
            </Typography>
            <Typography variant="data" as="span" className="shrink-0">
              {formatElo(t.elo)}
            </Typography>
          </div>
        </Link>
      </li>
    ))}
  </ul>
);

export { TrackLadder };

/** Legend for the ladder rows. */
const LadderLegend = () => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3" aria-label="Legend">
    <li className="flex items-center gap-1.5">
      <span className="size-1.5 animate-pulse-dot rounded-full bg-good" /> agent at work
    </li>
  </ul>
);

export { LadderLegend };

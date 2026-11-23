import Link from 'next/link';
import { Typography } from '@/components/ui/Typography';
import type { TrackSummary } from '@/lib/derive';
import { formatElo } from '@/lib/format';
import { SERIES } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type LadderRailProps = {
  track: TrackSummary;
};

/** One rail across the ladder; rungs sit at their rating and light up once cleared. */
const LadderRail = ({ track }: LadderRailProps) => {
  const scale = Math.max(track.topElo, track.elo ?? 0) * 1.04 || 1;
  const pct = (elo: number) => `${Math.min(100, (Math.max(0, elo) / scale) * 100)}%`;
  const color = SERIES[track.colorSlot];
  return (
    <div className="relative h-6 flex-1" aria-hidden="true">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
      <div
        className={cn('absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full', color.bg)}
        style={{ width: pct(track.elo ?? 0) }}
      />
      {track.rungs.map((r) => (
        <span
          key={r.id}
          title={`${r.label} · ${formatElo(r.elo)}${r.cleared_at ? ' · cleared' : ''}`}
          className={cn(
            'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
            r.cleared_at ? cn(color.bg, color.border) : 'border-line-strong bg-panel',
          )}
          style={{ left: pct(r.elo) }}
        />
      ))}
      <span
        className={cn(
          'absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg',
        )}
        style={{ left: pct(track.elo ?? 0) }}
      />
    </div>
  );
};

type TrackLadderProps = {
  tracks: TrackSummary[];
};

const TrackLadder = ({ tracks }: TrackLadderProps) => (
  <ul data-slot="track-ladder" className="divide-y divide-line">
    {tracks.map((t) => (
      <li key={t.id}>
        <Link
          href={`/engines/${t.id}`}
          className="group grid grid-cols-[7.5rem_1fr] items-center gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-panel-raised sm:grid-cols-[8.5rem_1fr_19rem]"
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
          <LadderRail track={t} />
          <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:justify-end">
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

/** Legend for the ladder markers, after pequalnp's map legend. */
const LadderLegend = () => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3" aria-label="Legend">
    <li className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full border-2 border-fg-2 bg-fg-2" /> opponent beaten
    </li>
    <li className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-full border-2 border-line-strong bg-panel" /> still ahead
    </li>
    <li className="flex items-center gap-1.5">
      <span className="h-3 w-0.5 rounded-full bg-fg" /> current rating
    </li>
    <li className="flex items-center gap-1.5">
      <span className="size-1.5 animate-pulse-dot rounded-full bg-good" /> agent at work
    </li>
  </ul>
);

export { LadderLegend };

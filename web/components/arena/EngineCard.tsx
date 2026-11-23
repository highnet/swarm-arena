import Link from 'next/link';
import { ArrowRight, Gamepad2, Swords, Trophy } from 'lucide-react';
import type { TrackSummary } from '@/lib/derive';
import { formatElo } from '@/lib/format';
import { ENGINE_FACTS } from '@/lib/tracks';
import { EngineLogo } from './EngineLogo';

type EngineCardProps = {
  track: TrackSummary;
};

/** One engine at a glance. The whole card opens the engine; Play goes straight to a game. */
const EngineCard = ({ track }: EngineCardProps) => {
  const beaten = track.rungs.filter((r) => r.cleared_at).length;
  const facts = ENGINE_FACTS[track.id];
  return (
    <article
      data-slot="engine-card"
      className="group relative flex min-w-0 flex-col rounded-lg border border-line bg-panel p-4 transition-colors hover:border-line-strong hover:bg-panel-raised focus-within:border-line-strong"
    >
      <div className="flex items-start gap-3">
        <EngineLogo game={track.id} slot={track.colorSlot} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <Link
              href={`/engines/${track.id}`}
              className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline"
            >
              {track.name}
            </Link>
            {track.atWork && (
              <span
                className="size-1.5 animate-pulse-dot rounded-full bg-good"
                title="Agent at work"
                aria-label="Agent at work"
              />
            )}
          </h3>
          <p className="mt-0.5 text-xs text-fg-3">
            {facts.rules} · vs {facts.opponents}
          </p>
        </div>
        <ArrowRight
          className="size-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
          aria-hidden="true"
        />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <div>
          <dt className="flex items-center gap-1 text-[11px] text-fg-3">
            <Trophy className="size-3" aria-hidden="true" /> Rating
          </dt>
          <dd className="mt-0.5 font-mono text-lg tabular text-fg">{formatElo(track.elo)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-fg-3">Version</dt>
          <dd className="mt-0.5 font-mono text-lg tabular text-fg-2">{track.version ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-fg-3">Beaten</dt>
          <dd className="mt-0.5 font-mono text-lg tabular text-fg-2">
            {beaten}
            <span className="text-fg-3">/{track.rungs.length}</span>
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-3">
          <Swords className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {track.pastLadder ? 'Beating its own last version' : `Next: ${track.nextRung?.label}`}
          </span>
        </span>
        <Link
          href={`/engines/${track.id}/play`}
          className="relative z-1 inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-fg-2 hover:border-line-strong hover:text-fg"
        >
          <Gamepad2 className="size-3.5" aria-hidden="true" />
          Play
        </Link>
      </div>
    </article>
  );
};

export { EngineCard };

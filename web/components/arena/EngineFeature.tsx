import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { TrackSummary } from '@/lib/derive';
import { formatElo } from '@/lib/format';
import { ENGINE_FACTS, SHORT_NAME } from '@/lib/tracks';
import { EngineLogo } from './EngineLogo';

/**
 * Where the engine stands on its ladder, in words, with its numbers in mono. Past the ladder the
 * rating is self-relative, so the sentence says so.
 */
const standing = (track: TrackSummary): ReactNode => {
  const { opponents } = ENGINE_FACTS[track.id];
  const ladder = opponents.endsWith('ladder') ? opponents : `${opponents} ladder`;
  if (track.pastLadder)
    return `Past the top of its ${ladder}: now rated against its own last version, so this number is not on the same scale as the others.`;
  if (track.nextRung)
    return (
      <>
        Next: {track.nextRung.label}, rated{' '}
        <span className="font-mono tabular">{formatElo(track.nextRung.elo)}</span>.
      </>
    );
  return `Climbing against ${opponents}.`;
};

type EngineFeatureProps = {
  track: TrackSummary;
};

/**
 * One engine given room on the homepage: its rating large, its version, and the one sentence
 * that says where it stands. Everything else is on the engine's own page, one click away.
 */
const EngineFeature = ({ track }: EngineFeatureProps) => (
  <article data-slot="engine-feature" className="group relative min-w-0 border-t border-line pt-8">
    <div className="flex items-center gap-4">
      <EngineLogo game={track.id} slot={track.colorSlot} size="lg" />
      <div className="min-w-0">
        <h3 className="text-2xl font-semibold tracking-tight text-fg">
          <Link
            href={`/engines/${track.id}`}
            className="outline-none after:absolute after:inset-0 focus-visible:underline"
          >
            {track.name}
          </Link>
        </h3>
        <p className="mt-0.5 text-[13px] text-fg-3">
          {ENGINE_FACTS[track.id].rules} rules · vs {ENGINE_FACTS[track.id].opponents}
          {track.atWork && (
            <span className="ml-2 inline-flex items-center gap-1.5 text-fg-2">
              <span className="size-1.5 rounded-full bg-good" aria-hidden="true" />
              agent at work
            </span>
          )}
        </p>
      </div>
      <ArrowRight
        className="ml-auto size-5 shrink-0 text-fg-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg"
        aria-hidden="true"
      />
    </div>

    <dl className="mt-8 flex flex-wrap items-end gap-x-12 gap-y-4">
      <div>
        <dt className="text-[13px] text-fg-3">Rating</dt>
        <dd className="mt-1 font-mono text-5xl font-medium tabular tracking-tight text-fg sm:text-6xl">
          {formatElo(track.elo)}
        </dd>
      </div>
      <div>
        <dt className="text-[13px] text-fg-3">Version</dt>
        <dd className="mt-1 font-mono text-2xl tabular text-fg-2">{track.version ?? '—'}</dd>
      </div>
    </dl>

    <p className="mt-6 max-w-md text-[15px] leading-6 text-fg-2 text-pretty">{standing(track)}</p>

    <Link
      href={`/engines/${track.id}/play`}
      className="relative z-1 mt-5 inline-flex items-center gap-1 text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline"
    >
      Play {SHORT_NAME[track.id]} yourself
      <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  </article>
);

export { EngineFeature };

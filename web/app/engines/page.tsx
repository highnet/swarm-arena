import type { Metadata } from 'next';
import { pageMeta } from '@/lib/site';
import Link from 'next/link';
import { Gamepad2, ListOrdered, Table2 } from 'lucide-react';
import { EngineCard } from '@/components/arena/EngineCard';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { LadderLegend, TrackLadder } from '@/components/arena/TrackLadder';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { trackSummaries } from '@/lib/derive';
import { formatElo, formatInt } from '@/lib/format';

export const metadata: Metadata = pageMeta(
  'Engines',
  'Chess, Go 9×9, Othello and Hex engines written from empty files by a swarm of coding agents: ratings, ladders, versions and code.',
  '/engines',
);

const Engines = async () => {
  const s = await getSnapshot();
  const tracks = trackSummaries(s);
  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Engines</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        Four engines. The rules come from libraries. The agents write everything that picks a move.
      </Typography>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tracks.map((t) => (
          <EngineCard key={t.id} track={t} />
        ))}
      </div>

      <Panel className="mt-4" icon={ListOrdered} title="Ladders">
        <TrackLadder tracks={tracks} />
        <div className="border-t border-line px-4 py-2.5">
          <LadderLegend />
        </div>
      </Panel>

      <Panel className="mt-4" icon={Table2} title="At a glance" bodyClassName="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-3">
              <th className="px-4 py-2 font-medium">Engine</th>
              <th className="px-4 py-2 text-right font-medium">Rating</th>
              <th className="px-4 py-2 font-medium">Version</th>
              <th className="px-4 py-2 text-right font-medium">Opponents beaten</th>
              <th className="px-4 py-2 text-right font-medium">Games</th>
              <th className="px-4 py-2 text-right font-medium">Shipped</th>
              <th className="px-4 py-2 text-right font-medium">Buried</th>
              <th className="px-4 py-2 text-right font-medium">Play</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tracks.map((t) => (
              <tr key={t.id} className="hover:bg-panel-raised">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/engines/${t.id}`}
                    className="inline-flex items-center gap-2 text-fg hover:underline"
                  >
                    <EngineLogo game={t.id} slot={t.colorSlot} size="sm" />
                    {t.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular text-fg">
                  {formatElo(t.elo)}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-fg-2">{t.version ?? '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular text-fg-2">
                  {t.rungs.filter((r) => r.cleared_at).length}/{t.rungs.length}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular text-fg-2">
                  {formatInt(t.games)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular text-fg-2">
                  {s.records.filter((r) => r.track_id === t.id && r.kind === 'patch_landed').length}
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular text-fg-2">
                  {s.records.filter((r) => r.track_id === t.id && r.kind === 'idea_dead').length}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/engines/${t.id}/play`}
                    className="inline-flex items-center gap-1 text-xs text-fg-2 hover:text-fg"
                  >
                    <Gamepad2 className="size-3.5" aria-hidden="true" />
                    Play
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </main>
  );
};

export default Engines;

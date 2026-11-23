import type { Metadata } from 'next';
import Link from 'next/link';
import { LadderLegend, TrackLadder } from '@/components/arena/TrackLadder';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { trackSummaries } from '@/lib/derive';
import { formatElo, formatInt } from '@/lib/format';
import { SERIES } from '@/lib/tracks';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Engines' };

const Engines = async () => {
  const s = await getSnapshot();
  const tracks = trackSummaries(s);
  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Engines</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        Four engines, each with a playbook the swarm keeps beside it. Rules come from libraries;
        everything that chooses a move is written here.
      </Typography>

      <Panel className="mt-6" title="Ladders">
        <TrackLadder tracks={tracks} />
        <div className="border-t border-line px-4 py-2.5">
          <LadderLegend />
        </div>
      </Panel>

      <Panel className="mt-4" title="At a glance" bodyClassName="overflow-x-auto">
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
                    <span className={cn('size-2 rounded-full', SERIES[t.colorSlot].bg)} />
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
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </main>
  );
};

export default Engines;

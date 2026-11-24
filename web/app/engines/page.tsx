import type { Metadata } from 'next';
import Link from 'next/link';
import { EngineFeature } from '@/components/arena/EngineFeature';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { NextSteps } from '@/components/arena/NextSteps';
import { LadderLegend, TrackLadder } from '@/components/arena/TrackLadder';
import { FullBleed } from '@/components/ui/FullBleed';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { trackSummaries } from '@/lib/derive';
import { formatElo, formatInt } from '@/lib/format';
import { pageMeta } from '@/lib/site';

export const metadata: Metadata = pageMeta(
  'Engines',
  'Chess, Go 9×9, Othello and Hex engines written from empty files by a swarm of coding agents: ratings, ladders, versions and code.',
  '/engines',
);

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'four', label: 'The four' },
  { id: 'ladders', label: 'Ladders' },
  { id: 'compare', label: 'Side by side' },
  { id: 'more', label: 'Further reading' },
];

const TH = 'px-4 py-3 font-medium';
const TH_NUM = 'px-4 py-3 text-right font-medium';

const Engines = async () => {
  const s = await getSnapshot();
  const tracks = trackSummaries(s);
  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · What the engines are. */}
      <Section id="overview" labelledBy="engines-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="engines-title"
          title="The engines"
          intro="Four engines. The rules come from libraries; the agents write everything that picks a move, and each rating comes only from games the referee watched."
          action={
            <>
              <TextLink href="/how-it-works#ratings">How ratings work</TextLink>
              <TextLink href="/versions">Every version shipped</TextLink>
            </>
          }
        />
      </Section>

      {/* 2 · Each engine given room. */}
      <Section id="four" labelledBy="four-title" tone="band" space="roomy">
        <SectionHeading
          id="four-title"
          title="The four"
          intro="Each engine's rating, its version, and where it stands on its own ladder. Open one for its chart, lineage, playbook and source."
        />
        <div className="grid gap-x-16 gap-y-16 md:grid-cols-2 md:gap-y-20">
          {tracks.map((t) => (
            <EngineFeature key={t.id} track={t} />
          ))}
        </div>
      </Section>

      {/* 3 · Who each has beaten, and who is next. */}
      <Section id="ladders" labelledBy="ladders-title">
        <SectionHeading
          id="ladders-title"
          title="The ladders"
          intro="Each game has a ladder of reference opponents. An engine climbs a rung by beating it in a gate match; past the top, each version has to beat the last."
        />
        <div className="border-y border-line">
          <TrackLadder tracks={tracks} />
        </div>
        <div className="py-3">
          <LadderLegend />
        </div>
      </Section>

      {/* 4 · The numbers side by side, as one full-width table. */}
      <Section id="compare" labelledBy="compare-title" tone="band">
        <SectionHeading
          id="compare-title"
          title="Side by side"
          intro="The counts behind each engine. The ratings sit on separate ladders, so compare an engine with its own past, not with the others."
        />
        <FullBleed>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[15px]">
              <caption className="sr-only">The four engines side by side</caption>
              <thead>
                <tr className="border-b border-line-strong text-left text-[13px] text-fg-3">
                  <th scope="col" className={TH}>
                    Engine
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Rating
                  </th>
                  <th scope="col" className={TH}>
                    Version
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Opponents beaten
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Games
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Shipped
                  </th>
                  <th scope="col" className={TH_NUM}>
                    Buried
                  </th>
                  <th scope="col" className={TH_NUM}>
                    <span className="sr-only">Play</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tracks.map((t) => (
                  <tr key={t.id}>
                    <th scope="row" className="px-4 py-5 text-left font-normal">
                      <Link
                        href={`/engines/${t.id}`}
                        className="inline-flex items-center gap-3 text-fg underline-offset-4 hover:underline"
                      >
                        <EngineLogo game={t.id} slot={t.colorSlot} size="sm" />
                        {t.name}
                      </Link>
                    </th>
                    <td className="px-4 py-5 text-right font-mono text-lg tabular text-fg">
                      {formatElo(t.elo)}
                    </td>
                    <td className="px-4 py-5 font-mono tabular text-fg-2">{t.version ?? '—'}</td>
                    <td className="px-4 py-5 text-right font-mono tabular text-fg-2">
                      {t.rungs.filter((r) => r.cleared_at).length}/{t.rungs.length}
                    </td>
                    <td className="px-4 py-5 text-right font-mono tabular text-fg-2">
                      {formatInt(t.games)}
                    </td>
                    <td className="px-4 py-5 text-right font-mono tabular text-fg-2">
                      {
                        s.records.filter((r) => r.track_id === t.id && r.kind === 'patch_landed')
                          .length
                      }
                    </td>
                    <td className="px-4 py-5 text-right font-mono tabular text-fg-2">
                      {
                        s.records.filter((r) => r.track_id === t.id && r.kind === 'idea_dead')
                          .length
                      }
                    </td>
                    <td className="px-4 py-5 text-right">
                      <TextLink href={`/engines/${t.id}/play`} size="small">
                        Play
                      </TextLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FullBleed>
      </Section>

      {/* 5 · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={['games', 'versions', 'graveyard', 'concepts']}
        />
      </Section>
    </main>
  );
};

export default Engines;

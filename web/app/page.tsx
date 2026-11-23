import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { GameId, Snapshot } from '@arena/shared';
import { BoardFeed } from '@/components/arena/BoardFeed';
import { GameReplay } from '@/components/arena/GameReplay';
import { RaceChart, type RaceSeries } from '@/components/arena/RaceChart';
import { Fleet, Frontier, Graveyard, MoreLink, StrategyCall } from '@/components/arena/SidePanels';
import { LadderLegend, TrackLadder } from '@/components/arena/TrackLadder';
import { buttonVariants } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import {
  counters,
  frontier,
  latestGame,
  mentions,
  newestFirst,
  snapshotNow,
  trackSummaries,
} from '@/lib/derive';
import { formatDay, formatInt } from '@/lib/format';
import { SERIES, SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

const TERMINATION: Record<string, string> = {
  adjudicated: 'adjudicated',
  'illegal-move': 'forfeit: illegal move',
  timeout: 'forfeit on time',
  crash: 'forfeit: engine crashed',
};

const resultText = (outcome: number, firstLabel: string, secondLabel: string) =>
  outcome === 1 ? `${firstLabel} won` : outcome === 0 ? `${secondLabel} won` : 'Draw';

const raceSeries = (s: Snapshot): RaceSeries[] =>
  trackSummaries(s).map((t) => ({
    id: t.id,
    name: SHORT_NAME[t.id],
    slot: t.colorSlot,
    points: s.elo
      .filter((e) => e.track_id === t.id)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => ({ t: Date.parse(e.at), elo: e.elo, version: e.engine_version })),
  }));

/** pequalnp-style verdict line: what state the run is in, in one sentence. */
const verdict = (s: Snapshot, working: number) => {
  if (working > 0) return 'open-ended, being climbed now.';
  if (s.tasks.some((t) => t.status === 'open')) return 'open-ended, next experiments queued.';
  return 'open-ended, waiting for the strategy seat.';
};

type CounterProps = {
  label: string;
  value: string;
};

const Counter = ({ label, value }: CounterProps) => (
  <div className="min-w-0 bg-panel px-4 py-3">
    <dd className="font-mono text-xl font-medium tabular tracking-tight text-fg">{value}</dd>
    <dt className="mt-0.5 text-xs text-fg-3">{label}</dt>
  </div>
);

const Home = async () => {
  const s = await getSnapshot();
  const now = snapshotNow(s);
  const tracks = trackSummaries(s);
  const c = counters(s);
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const records = newestFirst(s.records);
  const call = records.find((r) => r.kind === 'strategy') ?? null;
  const game = latestGame(s);
  const gameMatch = game ? s.matches.find((m) => m.id === game.match_id) : null;
  const gameTrack = game ? s.tracks.find((t) => t.id === game.track_id) : null;
  const engineLabel = gameMatch ? `${gameTrack?.name} ${gameMatch.engine_version}` : 'Engine';
  const first = game?.engine_first ? engineLabel : (gameMatch?.opponent ?? 'Opponent');
  const second = game?.engine_first ? (gameMatch?.opponent ?? 'Opponent') : engineLabel;

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-8 sm:px-6">
      <section aria-labelledby="hero-title" className="max-w-3xl">
        <Typography variant="pageTitle" id="hero-title" className="sm:text-4xl">
          Four engines, built from nothing, ranked only by games.
        </Typography>
        <Typography variant="lede" className="mt-2">
          A swarm of coding agents is writing chess, Go, Othello and Hex engines from an empty file.
          Every version earns its rating over the board against Stockfish, GNU Go and Edax, and then
          against itself. There is no finish line.
        </Typography>
        <p className="mt-3 text-[15px] text-fg">
          <span className="text-fg-3">Verdict:</span> {verdict(s, c.working)}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="#record" className={buttonVariants({ variant: 'primary' })}>
            Watch it live
          </Link>
          <Link href="/how-it-works" className={buttonVariants({ variant: 'secondary' })}>
            How it works
          </Link>
        </div>
      </section>

      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Counter label="agent sessions so far" value={formatInt(c.sessions)} />
        <Counter label="agents working now" value={formatInt(c.working)} />
        <Counter label="games played" value={formatInt(c.games)} />
        <Counter label="versions shipped" value={formatInt(c.landed)} />
        <Counter label="ideas buried" value={formatInt(c.dead)} />
        <Counter label="started" value={formatDay(s.run.started_at)} />
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel
          id="race"
          title="The race"
          actions={<MoreLink href="/engines">Open any engine</MoreLink>}
        >
          <div className="px-2 pt-3 sm:px-3">
            <RaceChart
              series={raceSeries(s)}
              start={Date.parse(s.run.started_at)}
              end={Date.parse(now)}
            />
          </div>
          <div className="border-t border-line">
            <TrackLadder tracks={tracks} />
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <LadderLegend />
          </div>
        </Panel>

        <Panel
          id="latest-game"
          title="Latest game"
          actions={
            gameMatch && (
              <Link
                href={`/matches/${gameMatch.id}`}
                className="inline-flex items-center gap-0.5 text-xs text-fg-2 hover:text-fg"
              >
                Match
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </Link>
            )
          }
        >
          {game && gameTrack ? (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[13px] text-fg">
                  <span className={cn('size-2 rounded-full', SERIES[gameTrack.color_slot].bg)} />
                  {gameTrack.name}
                </span>
                <span className="text-xs text-fg-3">
                  {game.ply_count} plies
                  {game.termination !== 'rules' &&
                    ` · ${TERMINATION[game.termination] ?? game.termination}`}
                </span>
              </div>
              <GameReplay
                game={game.track_id}
                moves={game.moves}
                autoplay
                label={`${gameTrack.name} replay`}
              />
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-fg-3">{gameTrack.id === 'chess' ? 'White' : 'Black'}</dt>
                <dd className="truncate text-fg">{first}</dd>
                <dt className="text-fg-3">{gameTrack.id === 'chess' ? 'Black' : 'White'}</dt>
                <dd className="truncate text-fg">{second}</dd>
                <dt className="text-fg-3">Result</dt>
                <dd className="text-fg">{resultText(game.outcome, first, second)}</dd>
              </dl>
            </div>
          ) : (
            <Typography variant="small" className="px-4 py-8">
              No games played yet. The first match starts when an agent submits an engine.
            </Typography>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <StrategyCall call={call} mentioned={call ? mentions(s, call) : []} slots={slots} />
        <Frontier tasks={frontier(s)} seats={seats} slots={slots} />
        <Graveyard dead={records.filter((r) => r.kind === 'idea_dead')} slots={slots} />
      </div>

      <div id="record" className="mt-4 grid scroll-mt-28 gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel
          title="Latest from the record"
          actions={<MoreLink href="/board">The whole feed</MoreLink>}
        >
          <BoardFeed records={records} slots={slots} seats={seats} pageSize={12} />
        </Panel>
        <Fleet agents={s.agents} slots={slots} />
      </div>
    </main>
  );
};

export default Home;

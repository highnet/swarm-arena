import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { GameId, Snapshot } from '@arena/shared';
import { BoardFeed } from '@/components/arena/BoardFeed';
import { GameReplay } from '@/components/arena/GameReplay';
import { RaceChart, type RaceSeries } from '@/components/arena/RaceChart';
import { AgentRoster, Graveyard, StrategySeat } from '@/components/arena/SidePanels';
import { TrackLadder } from '@/components/arena/TrackLadder';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { counters, latestGame, newestFirst, snapshotNow, trackSummaries } from '@/lib/derive';
import { formatInt, formatSpan } from '@/lib/format';
import { SERIES, SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

const resultText = (outcome: number, firstLabel: string, secondLabel: string) =>
  outcome === 1 ? `${firstLabel} won` : outcome === 0 ? `${secondLabel} won` : 'Draw';

const raceSeries = (s: Snapshot): RaceSeries[] =>
  trackSummaries(s).map((t) => ({
    id: t.id,
    name: SHORT_NAME[t.id],
    slot: t.colorSlot,
    finishElo: t.finishElo,
    finished: t.finished,
    points: s.elo
      .filter((e) => e.track_id === t.id)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => ({ t: Date.parse(e.at), elo: e.elo, version: e.engine_version })),
  }));

type StatProps = {
  label: string;
  value: string;
};

const Stat = ({ label, value }: StatProps) => (
  <div className="flex items-baseline gap-1.5">
    <dd className="font-mono text-[13px] tabular text-fg">{value}</dd>
    <dt className="text-xs text-fg-3">{label}</dt>
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
  const game = latestGame(s);
  const gameMatch = game ? s.matches.find((m) => m.id === game.match_id) : null;
  const gameTrack = game ? s.tracks.find((t) => t.id === game.track_id) : null;
  const engineLabel = gameMatch ? `${gameTrack?.name} ${gameMatch.engine_version}` : 'Engine';
  const first = game?.engine_first ? engineLabel : (gameMatch?.opponent ?? 'Opponent');
  const second = game?.engine_first ? (gameMatch?.opponent ?? 'Opponent') : engineLabel;

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-6 sm:px-6">
      <div className="flex flex-col gap-4 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <Typography variant="pageTitle">
            Four game engines, built from zero by an agent swarm.
          </Typography>
          <Typography variant="lede" className="mt-1.5">
            Claude Code agents on a single subscription write every line. A referee plays each new
            version against fixed reference engines, and the Elo below is what those games measured.
          </Typography>
        </div>
        <dl className="flex flex-wrap gap-x-5 gap-y-1.5 lg:justify-end">
          <Stat label="elapsed" value={formatSpan(s.run.started_at, now)} />
          <Stat label="games" value={formatInt(c.games)} />
          <Stat label="versions landed" value={formatInt(c.landed)} />
          <Stat label="rungs cleared" value={`${c.rungs}/${c.rungsTotal}`} />
          <Stat label="ruled dead" value={formatInt(c.dead)} />
          <Stat label="seats working" value={formatInt(c.working)} />
        </dl>
      </div>

      {s.run.is_sample && (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[13px] text-fg-2">
          <span className="font-medium text-warning">Sample run.</span> Synthetic numbers that show
          the format until the first real run is recorded. Replayed boards are legal games between
          simple reference players, not the engines themselves.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel
          id="race"
          title="The race"
          actions={
            <ul className="flex flex-wrap items-center gap-3" aria-label="Legend">
              {tracks.map((t) => (
                <li key={t.id} className="flex items-center gap-1.5 text-xs text-fg-2">
                  <span className={cn('size-2 rounded-full', SERIES[t.colorSlot].bg)} />
                  {t.name}
                </li>
              ))}
              <li className="flex items-center gap-1.5 text-xs text-fg-3">
                <svg width="16" height="2" aria-hidden="true">
                  <line x1="0" x2="16" y1="1" y2="1" stroke="var(--fg-3)" strokeDasharray="4 3" />
                </svg>
                finish line
              </li>
            </ul>
          }
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
                  {game.ply_count} plies · {game.termination}
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
              {s.run.is_sample && (
                <Typography variant="meta">
                  Sample replay: played by reference players, not the engine.
                </Typography>
              )}
            </div>
          ) : (
            <Typography variant="small" className="px-4 py-8">
              No games played yet.
            </Typography>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel
          id="board"
          title="The board"
          actions={
            <Typography variant="meta" as="span">
              Structured records written by seats and the referee
            </Typography>
          }
        >
          <BoardFeed records={records} slots={slots} seats={seats} pageSize={20} />
        </Panel>
        <div className="flex flex-col gap-4">
          <StrategySeat updates={records.filter((r) => r.kind === 'strategy')} />
          <AgentRoster agents={s.agents} slots={slots} />
          <Graveyard dead={records.filter((r) => r.kind === 'idea_dead')} slots={slots} />
        </div>
      </div>
    </main>
  );
};

export default Home;

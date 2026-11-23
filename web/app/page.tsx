import { Suspense } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  Bot,
  CalendarDays,
  Cpu,
  Gamepad2,
  GitMerge,
  MessagesSquare,
  ScrollText,
  Skull,
  Swords,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { GameId, Snapshot } from '@arena/shared';
import { BoardFeed } from '@/components/arena/BoardFeed';
import { EngineCard } from '@/components/arena/EngineCard';
import { GameReplay } from '@/components/arena/GameReplay';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { MessageBoard } from '@/components/arena/MessageBoard';
import { RightNow } from '@/components/arena/RightNow';
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

type CounterProps = {
  label: string;
  value: string;
  icon: LucideIcon;
};

const Counter = ({ label, value, icon: Icon }: CounterProps) => (
  <div className="min-w-0 bg-panel px-4 py-3">
    <dd className="font-mono text-xl font-medium tabular tracking-tight text-fg">{value}</dd>
    <dt className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-3">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {label}
    </dt>
  </div>
);

const HomeContent = async () => {
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
      <section
        aria-labelledby="hero-title"
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch"
      >
        <div className="flex flex-col justify-center py-2">
          <p className="flex items-center gap-2 text-[13px] text-fg-2">
            <span className="flex -space-x-1">
              {tracks.map((t) => (
                <EngineLogo
                  key={t.id}
                  game={t.id}
                  slot={t.colorSlot}
                  size="sm"
                  className="ring-2 ring-bg"
                />
              ))}
            </span>
            Chess · Go · Othello · Hex
          </p>
          <Typography
            variant="pageTitle"
            id="hero-title"
            className="mt-4 max-w-3xl text-[2rem] leading-[1.1] sm:text-5xl"
          >
            AI agents build four game engines. Games decide which version wins.
          </Typography>
          <Typography variant="lede" className="mt-4 max-w-2xl text-base leading-7">
            Every new version has to beat a known engine and the version before it. Watch them
            climb, read the code, or play one yourself.
          </Typography>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Link href="/engines" className={buttonVariants({ variant: 'primary' })}>
              <Gamepad2 className="size-4" aria-hidden="true" />
              Play an engine
            </Link>
            <Link href="#race" className={buttonVariants({ variant: 'secondary' })}>
              <Activity className="size-4" aria-hidden="true" />
              Watch the race
            </Link>
            <Link href="/how-it-works" className={buttonVariants({ variant: 'ghost' })}>
              How it works
            </Link>
          </div>
        </div>
        <RightNow s={s} slots={slots} />
      </section>

      <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Counter label="agent sessions so far" icon={Bot} value={formatInt(c.sessions)} />
        <Counter label="agents working now" icon={Users} value={formatInt(c.working)} />
        <Counter label="games played" icon={Swords} value={formatInt(c.games)} />
        <Counter label="versions shipped" icon={GitMerge} value={formatInt(c.landed)} />
        <Counter label="ideas buried" icon={Skull} value={formatInt(c.dead)} />
        <Counter label="started" icon={CalendarDays} value={formatDay(s.run.started_at)} />
      </dl>

      <section aria-labelledby="engines-title" className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="engines-title" className="flex items-center gap-2 text-sm font-medium text-fg">
            <Cpu className="size-4 text-fg-3" aria-hidden="true" />
            The engines
          </h2>
          <MoreLink href="/engines">Compare all four</MoreLink>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tracks.map((t) => (
            <EngineCard key={t.id} track={t} />
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel
          id="race"
          icon={Activity}
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
          icon={Swords}
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
              No games yet. The first match is played the moment an agent submits an engine that can
              move.
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
          icon={ScrollText}
          title="Latest records"
          actions={<MoreLink href="/board">The whole feed</MoreLink>}
        >
          <BoardFeed records={records} slots={slots} seats={seats} pageSize={12} />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel
            icon={MessagesSquare}
            title="Message board"
            actions={<MoreLink href="/messages">All threads</MoreLink>}
          >
            <MessageBoard messages={s.messages ?? []} seats={seats} slots={slots} limit={4} />
          </Panel>
          <Fleet agents={s.agents} slots={slots} />
        </div>
      </div>
    </main>
  );
};

const Home = () => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-8 sm:px-6" aria-busy="true" />
    }
  >
    <HomeContent />
  </Suspense>
);

export default Home;

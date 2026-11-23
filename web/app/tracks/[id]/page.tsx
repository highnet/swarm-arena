import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CircleDashed, CircleDot, CircleSlash, Flag, GitMerge } from 'lucide-react';
import type { GameId, Task } from '@arena/shared';
import { BoardFeed } from '@/components/arena/BoardFeed';
import { RaceChart } from '@/components/arena/RaceChart';
import { TrackLadder } from '@/components/arena/TrackLadder';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { newestFirst, snapshotNow, trackSummaries } from '@/lib/derive';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';

type TrackPageProps = {
  params: Promise<{ id: string }>;
};

export const generateStaticParams = async () => TRACK_ORDER.map((id) => ({ id }));

export const generateMetadata = async ({ params }: TrackPageProps): Promise<Metadata> => {
  const { id } = await params;
  return { title: SHORT_NAME[id as GameId] ?? 'Track' };
};

const TASK_TONE = {
  open: 'outline',
  claimed: 'neutral',
  landed: 'good',
  dead: 'critical',
} as const;
const TASK_ICON = {
  open: CircleDashed,
  claimed: CircleDot,
  landed: GitMerge,
  dead: CircleSlash,
} as const;
const TASK_LABEL = {
  open: 'open',
  claimed: 'in progress',
  landed: 'shipped',
  dead: 'buried',
} as const;

type TaskBadgeProps = {
  status: Task['status'];
};

const TaskBadge = ({ status }: TaskBadgeProps) => {
  const Icon = TASK_ICON[status];
  return (
    <Badge tone={TASK_TONE[status]}>
      <Icon className="size-3" aria-hidden="true" />
      {TASK_LABEL[status]}
    </Badge>
  );
};

const TrackContent = async ({ params }: TrackPageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const track = trackSummaries(s).find((t) => t.id === id);
  if (!track) notFound();

  const slots = { [track.id]: track.colorSlot } as Partial<Record<GameId, number>>;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const matches = s.matches
    .filter((m) => m.track_id === track.id)
    .sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''));
  const tasks = s.tasks
    .filter((t) => t.track_id === track.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const points = s.elo
    .filter((e) => e.track_id === track.id)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((e) => ({ t: Date.parse(e.at), elo: e.elo, version: e.engine_version }));

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-6 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg">
        <ArrowLeft className="size-3" aria-hidden="true" />
        The race
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4 pb-5">
        <div>
          <Typography variant="pageTitle">{track.name}</Typography>
          <Typography variant="lede" className="mt-1">
            {track.version
              ? `${track.version} at ${formatElo(track.elo)} Elo`
              : 'No version measured yet'}
            . Finish line: {track.finishLabel} ({formatElo(track.finishElo)}).
          </Typography>
        </div>
        {track.finished && (
          <Badge tone="good">
            <Flag className="size-3" aria-hidden="true" />
            Finished
          </Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel title="Elo by version">
          <div className="px-2 pt-3 sm:px-3">
            <RaceChart
              series={[
                {
                  id: track.id,
                  name: SHORT_NAME[track.id],
                  slot: track.colorSlot,
                  points,
                  finishElo: track.finishElo,
                  finished: track.finished,
                },
              ]}
              start={Date.parse(s.run.started_at)}
              end={Date.parse(snapshotNow(s))}
              height={260}
            />
          </div>
          <div className="border-t border-line">
            <TrackLadder tracks={[track]} />
          </div>
        </Panel>
        <Panel title="Ladder">
          <ol className="divide-y divide-line">
            {[...track.rungs].reverse().map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-12 font-mono text-xs tabular text-fg-3">{formatElo(r.elo)}</span>
                <span className="flex-1 text-[13px] text-fg">{r.label}</span>
                {r.cleared_at ? (
                  <Link
                    href={`/matches/${r.cleared_by_match}`}
                    className="text-xs text-good-text hover:underline"
                  >
                    cleared {formatDay(r.cleared_at)}
                  </Link>
                ) : (
                  <span className="text-xs text-fg-3">not yet</span>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel title="Matches" className="mt-4" bodyClassName="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-3">
              <th className="px-4 py-2 font-medium">Finished (UTC)</th>
              <th className="px-4 py-2 font-medium">Version</th>
              <th className="px-4 py-2 font-medium">Opponent</th>
              <th className="px-4 py-2 text-right font-medium">W–L–D</th>
              <th className="px-4 py-2 text-right font-medium">Performance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {matches.map((m) => (
              <tr key={m.id} className="hover:bg-panel-raised">
                <td className="px-4 py-2 font-mono text-xs tabular text-fg-3">
                  {m.finished_at
                    ? `${formatDay(m.finished_at)} ${formatTime(m.finished_at)}`
                    : 'running'}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-fg">
                  <Link href={`/matches/${m.id}`} className="hover:underline">
                    {m.engine_version}
                  </Link>
                </td>
                <td className="px-4 py-2 text-fg-2">
                  {m.opponent}{' '}
                  <span className="font-mono text-xs text-fg-3">({formatElo(m.opponent_elo)})</span>
                </td>
                <td className="px-4 py-2 text-right font-mono tabular text-fg">
                  {m.wins}–{m.losses}–{m.draws}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular text-fg">
                  {formatElo(m.elo)} <span className="text-fg-3">± {Math.round(m.elo_error)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel title="Board">
          <BoardFeed
            records={newestFirst(s.records.filter((r) => r.track_id === track.id))}
            slots={slots}
            seats={seats}
            scoped
          />
        </Panel>
        <Panel title="Tasks">
          <ol className="divide-y divide-line">
            {tasks.map((t) => (
              <li key={t.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <Typography variant="small" color="primary">
                    {t.title}
                  </Typography>
                  <TaskBadge status={t.status} />
                </div>
                <Typography variant="meta" as="p" className="mt-0.5">
                  {t.claimed_by ? seats[t.claimed_by] : 'unclaimed'} · {formatDay(t.created_at)}
                </Typography>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </main>
  );
};

const TrackPage = ({ params }: TrackPageProps) => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <TrackContent params={params} />
  </Suspense>
);

export default TrackPage;

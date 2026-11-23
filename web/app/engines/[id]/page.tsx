import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CircleDashed, CircleDot, CircleSlash, GitMerge } from 'lucide-react';
import type { GameId, Task } from '@arena/shared';
import { BoardFeed } from '@/components/arena/BoardFeed';
import { Lineage } from '@/components/arena/Lineage';
import { RaceChart } from '@/components/arena/RaceChart';
import { TrackLadder } from '@/components/arena/TrackLadder';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { lineage, newestFirst, snapshotNow, trackSummaries } from '@/lib/derive';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { getPlaybook } from '@/lib/playbook';
import { SERIES, SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type EnginePageProps = {
  params: Promise<{ id: string }>;
};

export const generateStaticParams = async () => TRACK_ORDER.map((id) => ({ id }));

export const generateMetadata = async ({ params }: EnginePageProps): Promise<Metadata> => {
  const { id } = await params;
  return { title: SHORT_NAME[id as GameId] ?? 'Engine' };
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

const EngineContent = async ({ params }: EnginePageProps) => {
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

  const { nodes, beforeFirst } = lineage(s, track.id);
  const playbook = await getPlaybook(track.id);

  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-6 sm:px-6">
      <Link
        href="/engines"
        className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg"
      >
        <ArrowLeft className="size-3" aria-hidden="true" />
        Engines
      </Link>
      <div className="mt-2 pb-5">
        <div className="flex items-center gap-2">
          <span className={cn('size-2.5 rounded-full', SERIES[track.colorSlot].bg)} />
          <Typography variant="pageTitle">{track.name}</Typography>
          {track.atWork && (
            <span className="inline-flex items-center gap-1.5 text-xs text-good-text">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-good" />
              agent at work
            </span>
          )}
        </div>
        <Typography variant="lede" className="mt-1">
          {track.version
            ? `${track.version}, rated ${formatElo(track.elo)}.`
            : 'No version rated yet.'}{' '}
          {track.pastLadder
            ? 'Every opponent on the ladder is beaten; each new version now has to beat the last.'
            : `Next opponent: ${track.nextRung?.label} (${formatElo(track.nextRung?.elo)}).`}
        </Typography>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <Panel title="Rating by version">
          <div className="px-2 pt-3 sm:px-3">
            <RaceChart
              series={[{ id: track.id, name: SHORT_NAME[track.id], slot: track.colorSlot, points }]}
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
                <span className="min-w-0 flex-1 text-[13px] text-fg">{r.label}</span>
                {r.cleared_at ? (
                  <Link
                    href={`/matches/${r.cleared_by_match}`}
                    className="text-xs text-good-text hover:underline"
                  >
                    beaten {formatDay(r.cleared_at)}
                  </Link>
                ) : (
                  <span className="text-xs text-fg-3">ahead</span>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[23rem_minmax(0,1fr)]">
        <Panel title="Lineage">
          <Lineage nodes={nodes} beforeFirst={beforeFirst} slot={track.colorSlot} />
        </Panel>
        <Panel
          title="Playbook"
          actions={
            <Typography variant="meta" as="span">
              kept by the swarm beside the engine
            </Typography>
          }
        >
          {playbook ? (
            <div className="grid gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <div
                className="playbook min-w-0"
                dangerouslySetInnerHTML={{ __html: playbook.html }}
              />
              <div className="min-w-0">
                <Typography variant="label" as="h3">
                  Results log
                </Typography>
                {playbook.log.length ? (
                  <ol className="mt-2 space-y-1.5">
                    {playbook.log.slice(0, 20).map((l) => (
                      <li key={l} className="font-mono text-[11px] leading-5 text-fg-2">
                        {l}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Typography variant="meta" as="p" className="mt-2">
                    No verdicts yet.
                  </Typography>
                )}
              </div>
            </div>
          ) : (
            <Typography variant="small" className="px-4 py-6">
              No playbook yet.
            </Typography>
          )}
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
            {matches.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-[13px] text-fg-3">
                  No matches played yet.
                </td>
              </tr>
            )}
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
          {tasks.length === 0 && (
            <Typography variant="small" className="px-4 py-6">
              No tasks yet.
            </Typography>
          )}
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

const EnginePage = ({ params }: EnginePageProps) => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <EngineContent params={params} />
  </Suspense>
);

export default EnginePage;

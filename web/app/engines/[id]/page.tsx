import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CircleDashed, CircleDot, CircleSlash, GitMerge, GitPullRequest } from 'lucide-react';
import { agentName, type GameId, type Match, type Task } from '@arena/shared';
import { BoardFeed } from '@/components/arena/BoardFeed';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { Lineage } from '@/components/arena/Lineage';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { ProgressChart } from '@/components/arena/ProgressChart';
import { SourceViewer } from '@/components/arena/SourceViewer';
import { buttonVariants } from '@/components/ui/Button';
import { Disclosure } from '@/components/ui/Disclosure';
import { FullBleed } from '@/components/ui/FullBleed';
import { Panel } from '@/components/ui/Panel';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { lineage, newestFirst, snapshotNow, trackSummaries } from '@/lib/derive';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { getPlaybook } from '@/lib/playbook';
import { matchHref, rungHref, taskHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { getEngineSource } from '@/lib/source';
import { ENGINE_FACTS, SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type EnginePageProps = {
  params: Promise<{ id: string }>;
};

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/highnet/swarm-arena';

/** How many rows a long list shows before the rest go behind a disclosure. */
const FIRST_MATCHES = 8;
const FIRST_TASKS = 6;
const FIRST_LOG = 6;

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'climb', label: 'The climb' },
  { id: 'versions', label: 'Versions' },
  { id: 'matches', label: 'Matches' },
  { id: 'playbook', label: 'Playbook' },
  { id: 'source', label: 'Source' },
  { id: 'work', label: 'The work' },
];

export const generateStaticParams = async () => TRACK_ORDER.map((id) => ({ id }));

export const generateMetadata = async ({ params }: EnginePageProps): Promise<Metadata> => {
  const { id } = await params;
  const name = SHORT_NAME[id as GameId] ?? 'Engine';
  return pageMeta(
    `${name} engine`,
    `The ${name} engine the swarm is building: rating by version, ladder, lineage, playbook and source. Play against it in your browser.`,
    `/engines/${id}`,
  );
};

/** Task status as an icon and a word; green and red only for shipped and buried. */
const TASK_STATUS = {
  open: { icon: CircleDashed, label: 'open', tone: 'text-fg-3' },
  claimed: { icon: CircleDot, label: 'in progress', tone: 'text-fg-2' },
  review: { icon: GitPullRequest, label: 'in review', tone: 'text-fg-2' },
  landed: { icon: GitMerge, label: 'shipped', tone: 'text-good-text' },
  dead: { icon: CircleSlash, label: 'buried', tone: 'text-critical-text' },
} as const;

type TaskStatusProps = {
  status: Task['status'];
};

const TaskStatus = ({ status }: TaskStatusProps) => {
  const { icon: Icon, label, tone } = TASK_STATUS[status];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-[13px]', tone)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
};

type TaskRowsProps = {
  tasks: Task[];
};

const TaskRows = ({ tasks }: TaskRowsProps) => (
  <ol className="divide-y divide-line border-y border-line">
    {tasks.map((t) => (
      <li key={t.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-5">
        <div className="min-w-0 flex-1">
          <Link
            href={taskHref(t.id)}
            className="text-[15px] text-fg text-pretty underline-offset-4 hover:underline"
          >
            {t.title}
          </Link>
          <p className="mt-1 text-[13px] text-fg-3">
            {t.claimed_by ? agentName(t.claimed_by) : 'unclaimed'} · {formatDay(t.created_at)}
          </p>
        </div>
        <TaskStatus status={t.status} />
      </li>
    ))}
  </ol>
);

const TH = 'px-4 py-3 font-medium';
const TH_NUM = 'px-4 py-3 text-right font-medium';

type MatchRowsProps = {
  matches: Match[];
  caption: string;
};

const MatchRows = ({ matches, caption }: MatchRowsProps) => (
  <div className="relative overflow-x-auto">
    <table className="w-full min-w-[40rem] text-[15px]">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line-strong text-left text-[13px] text-fg-3">
          <th scope="col" className={TH}>
            Finished (UTC)
          </th>
          <th scope="col" className={TH}>
            Version
          </th>
          <th scope="col" className={TH}>
            Opponent
          </th>
          <th scope="col" className={TH_NUM}>
            W–L–D
          </th>
          <th scope="col" className={TH_NUM}>
            Performance
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {matches.map((m) => (
          <tr key={m.id}>
            <td className="px-4 py-4 font-mono text-[13px] tabular text-fg-3">
              {m.finished_at
                ? `${formatDay(m.finished_at)} ${formatTime(m.finished_at)}`
                : 'running'}
            </td>
            <td className="px-4 py-4 font-mono tabular text-fg">
              <Link href={matchHref(m.id)} className="underline-offset-4 hover:underline">
                {m.engine_version}
              </Link>
            </td>
            <td className="px-4 py-4 text-fg-2">
              {m.opponent}{' '}
              <span className="font-mono text-[13px] tabular text-fg-3">
                ({formatElo(m.opponent_elo)})
              </span>
            </td>
            <td className="px-4 py-4 text-right font-mono tabular text-fg">
              {m.wins}–{m.losses}–{m.draws}
            </td>
            <td className="px-4 py-4 text-right font-mono tabular text-fg">
              {formatElo(m.elo)} <span className="text-fg-3">± {Math.round(m.elo_error)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

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
  const records = newestFirst(s.records.filter((r) => r.track_id === track.id));
  const points = s.elo
    .filter((e) => e.track_id === track.id)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((e) => ({ t: Date.parse(e.at), elo: e.elo, version: e.engine_version }));

  const { nodes, beforeFirst } = lineage(s, track.id);
  const playbook = await getPlaybook(track.id);
  const source = await getEngineSource(track.id);
  const facts = ENGINE_FACTS[track.id];
  const cleared = track.rungs.filter((r) => r.cleared_at).length;

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · Overview: what this engine is, where it stands, one primary action. */}
      <Section id="overview" labelledBy="engine-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="engine-title"
          title={
            <span className="inline-flex items-center gap-4 sm:gap-5">
              <EngineLogo game={track.id} slot={track.colorSlot} size="lg" />
              {track.name}
            </span>
          }
          intro={
            track.pastLadder || !track.nextRung ? (
              'Every opponent on its ladder is beaten; each new version now has to beat the last.'
            ) : (
              <>
                {cleared} of {track.rungs.length} opponents beaten. Next:{' '}
                <Link
                  href={rungHref(track.nextRung)}
                  className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
                >
                  {track.nextRung.label}
                </Link>
                , rated <span className="font-mono tabular">{formatElo(track.nextRung.elo)}</span>.
              </>
            )
          }
        />
        <dl className="mt-12 flex flex-wrap items-end gap-x-16 gap-y-6">
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
          <div>
            <dt className="text-[13px] text-fg-3">Built on</dt>
            <dd className="mt-1 text-[15px] text-fg-2">
              {facts.rules} rules · vs {facts.opponents}
              {track.atWork && (
                <span className="ml-3 inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-good" aria-hidden="true" />
                  agent at work
                </span>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link
            href={`/engines/${track.id}/play`}
            className={buttonVariants({ variant: 'primary', className: 'h-11 px-5 text-[15px]' })}
          >
            Play against it
          </Link>
          <TextLink href={`/games?engine=${track.id}`}>Watch its games</TextLink>
          <TextLink href={`/skills/${track.id}-playbook`}>Read the playbook</TextLink>
        </div>
      </Section>

      {/* 2 · The climb: rating by version, then the ladder rung by rung. */}
      <Section id="climb" labelledBy="climb-title" tone="band" space="roomy">
        <SectionHeading
          id="climb-title"
          title="The climb"
          intro="The rating version by version, from the referee's games. A step up means a new version beat what came before it."
        />
        <FullBleed>
          <ProgressChart
            series={[{ id: track.id, name: SHORT_NAME[track.id], slot: track.colorSlot, points }]}
            start={Date.parse(s.run.started_at)}
            end={Date.parse(snapshotNow(s))}
            height={360}
          />
        </FullBleed>
        <div className="mt-24 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <SectionHeading
            id="ladder-title"
            level="sub"
            space="none"
            title="The ladder"
            intro="Reference opponents, strongest at the top. Each rung opens its matches."
          />
          <ol aria-labelledby="ladder-title" className="divide-y divide-line border-y border-line">
            {[...track.rungs].reverse().map((r) => (
              <li key={r.id} className="grid grid-cols-[4rem_1fr_auto] items-baseline gap-x-4 py-4">
                <span className="font-mono text-[13px] tabular text-fg-3">{formatElo(r.elo)}</span>
                <Link
                  href={rungHref(r)}
                  className="min-w-0 text-[15px] text-fg underline-offset-4 hover:underline"
                >
                  {r.label}
                </Link>
                {r.cleared_at && r.cleared_by_match ? (
                  <Link
                    href={matchHref(r.cleared_by_match)}
                    className="text-[13px] text-good-text underline-offset-4 hover:underline"
                  >
                    beaten {formatDay(r.cleared_at)}
                  </Link>
                ) : (
                  <span className="text-[13px] text-fg-3">ahead</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* 3 · Versions: what shipped, and the ideas that died trying to beat each one. */}
      <Section id="versions" labelledBy="versions-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <SectionHeading
            id="versions-title"
            space="none"
            title="Versions"
            intro="Every version that shipped, newest first, with the ideas that failed to beat it struck through beneath it."
            action={<TextLink href="/versions">All engines&apos; versions</TextLink>}
          />
          <div className="-mx-4 min-w-0">
            <Lineage
              nodes={nodes}
              beforeFirst={beforeFirst}
              track={track.id}
              slot={track.colorSlot}
            />
          </div>
        </div>
      </Section>

      {/* 4 · Matches: the evidence, as one full-width table. */}
      <Section id="matches" labelledBy="matches-title" tone="band">
        <SectionHeading
          id="matches-title"
          title="Matches"
          intro="Every match the referee played for this engine, newest first. Each opens its games."
          action={<TextLink href={`/games?engine=${track.id}`}>Every game</TextLink>}
        />
        <FullBleed>
          {matches.length === 0 ? (
            <Typography variant="intro">No matches played yet.</Typography>
          ) : (
            <>
              <MatchRows
                matches={matches.slice(0, FIRST_MATCHES)}
                caption={`${track.name}: the latest matches`}
              />
              {matches.length > FIRST_MATCHES && (
                <Disclosure
                  className="mt-8"
                  summary={`The ${matches.length - FIRST_MATCHES} earlier matches`}
                >
                  <MatchRows
                    matches={matches.slice(FIRST_MATCHES)}
                    caption={`${track.name}: earlier matches`}
                  />
                </Disclosure>
              )}
            </>
          )}
        </FullBleed>
      </Section>

      {/* 5 · Playbook: the verdicts first, the whole notebook one click away. */}
      <Section id="playbook" labelledBy="playbook-title">
        <SectionHeading
          id="playbook-title"
          title="Playbook"
          intro="The notebook the swarm keeps beside the engine: what it is built from, what worked, and what failed and why."
          action={
            <TextLink href={`/skills/${track.id}-playbook`}>The playbook on its own page</TextLink>
          }
        />
        {playbook ? (
          <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
            <div className="min-w-0">
              <SectionHeading id="log-title" level="sub" space="none" title="Results log" />
              {playbook.log.length ? (
                <>
                  <ol aria-labelledby="log-title" className="mt-6 space-y-3">
                    {playbook.log.slice(0, FIRST_LOG).map((l) => (
                      <li key={l} className="font-mono text-[13px] leading-6 text-fg-2">
                        {l}
                      </li>
                    ))}
                  </ol>
                  {playbook.log.length > FIRST_LOG && (
                    <Disclosure
                      className="mt-6"
                      summary={`${Math.min(playbook.log.length, 20) - FIRST_LOG} more verdicts`}
                    >
                      <ol className="space-y-3">
                        {playbook.log.slice(FIRST_LOG, 20).map((l) => (
                          <li key={l} className="font-mono text-[13px] leading-6 text-fg-2">
                            {l}
                          </li>
                        ))}
                      </ol>
                    </Disclosure>
                  )}
                </>
              ) : (
                <p className="mt-6 text-[15px] text-fg-2">No verdicts yet.</p>
              )}
            </div>
            <div className="min-w-0">
              <Disclosure variant="row" summary="The playbook in full">
                <div
                  className="playbook max-w-prose min-w-0"
                  dangerouslySetInnerHTML={{ __html: playbook.html }}
                />
              </Disclosure>
            </div>
          </div>
        ) : (
          <Typography variant="intro">No playbook yet.</Typography>
        )}
      </Section>

      {/* 6 · Source: the engine as it stands on main (an interactive unit, so a card). */}
      <Section id="source" labelledBy="source-title" tone="band">
        <SectionHeading
          id="source-title"
          title="Source"
          intro={
            <>
              <span className="font-mono">engines/{track.id}</span> on main, as the swarm left it.
              Pick a file to read it.
            </>
          }
        />
        <FullBleed>
          <Panel>
            <SourceViewer files={source} repoUrl={REPO_URL} />
          </Panel>
        </FullBleed>
      </Section>

      {/* 7 · The work behind it: tasks, then the full board on request. */}
      <Section id="work" labelledBy="work-title">
        <SectionHeading
          id="work-title"
          title="The work"
          intro="The tasks agents claimed for this engine, newest first, and every record they left on the board."
        />
        {tasks.length === 0 ? (
          <Typography variant="intro">No tasks yet.</Typography>
        ) : (
          <>
            <TaskRows tasks={tasks.slice(0, FIRST_TASKS)} />
            {tasks.length > FIRST_TASKS && (
              <Disclosure
                className="mt-8"
                summary={`The ${tasks.length - FIRST_TASKS} earlier tasks`}
              >
                <TaskRows tasks={tasks.slice(FIRST_TASKS)} />
              </Disclosure>
            )}
          </>
        )}
        <Disclosure
          className="mt-16"
          variant="row"
          summary={`The board: ${records.length} records about ${SHORT_NAME[track.id]}`}
        >
          <Panel>
            <BoardFeed records={records} slots={slots} seats={seats} scoped />
          </Panel>
        </Disclosure>
      </Section>

      {/* 8 · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" tone="band" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={[...engineSteps(track.id).slice(1), 'versions', 'concepts']}
        />
      </Section>
    </main>
  );
};

const EnginePage = ({ params }: EnginePageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <EngineContent params={params} />
  </Suspense>
);

export default EnginePage;

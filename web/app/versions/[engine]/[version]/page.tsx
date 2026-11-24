import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { agentName, type GameId } from '@arena/shared';
import { MatchFacts, RecordList } from '@/components/arena/Detail';
import { NextSteps, engineSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { agentHref } from '@/components/arena/seats';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { lineage } from '@/lib/derive';
import { formatDay, formatTime } from '@/lib/format';
import { REPO_URL } from '@/lib/github';
import { ideaHref, taskHref, versionHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';

type VersionPageProps = {
  params: Promise<{ engine: string; version: string }>;
};

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'gate', label: 'The gate match' },
  { id: 'shipped', label: 'How it shipped' },
  { id: 'buried', label: 'Ideas that failed' },
  { id: 'more', label: 'Before and after' },
];

const find = async ({ params }: VersionPageProps) => {
  const { engine, version: raw } = await params;
  const version = decodeURIComponent(raw);
  if (!TRACK_ORDER.includes(engine as GameId)) return null;
  const s = await getSnapshot();
  const track = s.tracks.find((t) => t.id === engine);
  const record = s.records.find(
    (r) => r.kind === 'patch_landed' && r.track_id === engine && r.title.split(' ')[0] === version,
  );
  if (!track || !record) return null;
  return { s, track, record, version };
};

export const generateMetadata = async (props: VersionPageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Version' };
  const { track, record, version } = found;
  return pageMeta(
    `${track.name} ${version}`,
    record.title.replace(/^\S+ shipped: /, ''),
    versionHref(track.id, version),
  );
};

const VersionContent = async (props: VersionPageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, track, record, version } = found;
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const name = SHORT_NAME[track.id];
  const { nodes } = lineage(s, track.id);
  const at = nodes.findIndex((n) => n.version === version);
  const node = nodes[at];
  const prev = at > 0 ? nodes[at - 1] : null;
  const next = at >= 0 && at < nodes.length - 1 ? nodes[at + 1] : null;
  const match = record.match_id ? s.matches.find((m) => m.id === record.match_id) : undefined;
  const task = record.task_id ? s.tasks.find((t) => t.id === record.task_id) : undefined;
  const timeline = record.task_id
    ? s.records
        .filter((r) => r.task_id === record.task_id)
        .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
    : [record];

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · What this version is: the idea, in its own words. */}
      <Section id="overview" labelledBy="version-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="version-title"
          title={record.title.replace(/^\S+ shipped: /, '')}
          intro={record.detail}
        />
        <p className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-fg-3">
          <Link
            href={`/engines/${track.id}`}
            className="text-fg-2 underline-offset-4 hover:text-fg hover:underline"
          >
            {name}
          </Link>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular text-fg">{version}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={record.at}>
            shipped {formatDay(record.at)}, {formatTime(record.at)} UTC
          </time>
          {record.agent_id && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={agentHref(record.agent_id)}
                className="underline-offset-4 hover:text-fg hover:underline"
              >
                by {agentName(record.agent_id)}
              </Link>
            </>
          )}
        </p>
      </Section>

      {/* 2 · The evidence: the gate match it had to win. */}
      <Section id="gate" labelledBy="gate-title" tone="band">
        <SectionHeading
          id="gate-title"
          title="The gate match"
          intro="The referee's games that let this version ship. Each number opens the match."
        />
        {match ? (
          <MatchFacts match={match} variant="open" />
        ) : (
          <Typography variant="intro">No gate match is on the record for this version.</Typography>
        )}
      </Section>

      {/* 3 · How it got in: the task's record, claim to merge. */}
      <Section id="shipped" labelledBy="shipped-title">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <SectionHeading
            id="shipped-title"
            space="none"
            title="How it shipped"
            intro="The task's record on the board, from the claim to the merge, oldest first. This version's own record is marked."
            action={
              <>
                {task && <TextLink href={taskHref(task.id)}>The task</TextLink>}
                {task?.pr && (
                  <TextLink href={`${REPO_URL}/pull/${task.pr}`} external>
                    Pull request #{task.pr}
                  </TextLink>
                )}
              </>
            }
          />
          <div className="-mx-4 min-w-0 border-y border-line">
            <RecordList records={timeline} slots={slots} current={record.id} />
          </div>
        </div>
      </Section>

      {/* 4 · What it held off: the ideas buried against it. */}
      <Section id="buried" labelledBy="buried-title" tone="band">
        <SectionHeading
          id="buried-title"
          title="Ideas that failed to beat it"
          intro="Each was tried as the next version, lost its games, and was buried with its numbers."
          action={<TextLink href="/graveyard">The graveyard</TextLink>}
        />
        {!node || node.buried.length === 0 ? (
          <Typography variant="intro">Nothing has been buried against this version.</Typography>
        ) : (
          <ol className="divide-y divide-line border-y border-line">
            {node.buried.map((b) => (
              <li key={b.id} className="py-5">
                <Link
                  href={ideaHref(b.id)}
                  className="text-[15px] text-fg-2 line-through decoration-fg-3/60 underline-offset-4 hover:text-fg"
                >
                  {b.title}
                </Link>
                {b.detail && (
                  <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-fg-3 text-pretty">
                    {b.detail}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* 5 · Its neighbours in the lineage, and where to go next. */}
      <Section id="more" labelledBy="more-title" space="default">
        <SectionHeading id="more-title" title="Before and after" space="tight" />
        <nav
          aria-labelledby="more-title"
          className="grid gap-10 border-y border-line py-8 sm:grid-cols-2"
        >
          {prev ? (
            <Link href={versionHref(track.id, prev.version)} className="group block">
              <span className="text-[13px] text-fg-3">
                Previous · <span className="font-mono">{prev.version}</span>
              </span>
              <span className="mt-1.5 block text-[15px] text-fg text-pretty underline-offset-4 group-hover:underline">
                {prev.title}
              </span>
            </Link>
          ) : (
            <span className="text-[15px] text-fg-3">The first shipped version.</span>
          )}
          {next ? (
            <Link href={versionHref(track.id, next.version)} className="group block sm:text-right">
              <span className="text-[13px] text-fg-3">
                Next · <span className="font-mono">{next.version}</span>
              </span>
              <span className="mt-1.5 block text-[15px] text-fg text-pretty underline-offset-4 group-hover:underline">
                {next.title}
              </span>
            </Link>
          ) : (
            <span className="text-[15px] text-fg-3 sm:text-right">The current version.</span>
          )}
        </nav>
        <NextSteps
          className="mt-20"
          variant="list"
          title="Further reading"
          links={[...engineSteps(track.id), 'versions', 'graveyard']}
        />
      </Section>
    </main>
  );
};

const VersionPage = (props: VersionPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <VersionContent {...props} />
  </Suspense>
);

export default VersionPage;

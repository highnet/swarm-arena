import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, ExternalLink, ScrollText, Skull } from 'lucide-react';
import { agentName, type GameId } from '@arena/shared';
import { DetailShell, MatchFacts, RecordList } from '@/components/arena/Detail';
import { EngineChip } from '@/components/arena/SidePanels';
import { agentHref } from '@/components/arena/seats';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { lineage } from '@/lib/derive';
import { formatDay, formatTime } from '@/lib/format';
import { REPO_URL } from '@/lib/github';
import { ideaHref, taskHref, versionHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { TRACK_ORDER } from '@/lib/tracks';

type VersionPageProps = {
  params: Promise<{ engine: string; version: string }>;
};

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
    <DetailShell
      back={{ href: '/versions', label: 'Versions shipped' }}
      eyebrow={
        <>
          <EngineChip track={track.id} slots={slots} />
          <span className="font-mono text-fg">{version}</span>
          <time dateTime={record.at}>
            shipped {formatDay(record.at)}, {formatTime(record.at)} UTC
          </time>
          {record.agent_id && (
            <Link href={agentHref(record.agent_id)} className="hover:text-fg">
              by {agentName(record.agent_id)}
            </Link>
          )}
        </>
      }
      title={record.title.replace(/^\S+ shipped: /, '')}
      lede={record.detail}
    >
      {match && <MatchFacts match={match} />}

      <nav
        aria-label="Neighbouring versions"
        className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2"
      >
        {prev ? (
          <Link
            href={versionHref(track.id, prev.version)}
            className="bg-panel px-4 py-3 hover:bg-panel-raised"
          >
            <span className="inline-flex items-center gap-1 text-xs text-fg-3">
              <ArrowLeft className="size-3" aria-hidden="true" />
              Previous · <span className="font-mono">{prev.version}</span>
            </span>
            <Typography variant="small" color="primary" className="mt-0.5 text-pretty">
              {prev.title}
            </Typography>
          </Link>
        ) : (
          <div className="bg-panel px-4 py-3 text-xs text-fg-3">First shipped version</div>
        )}
        {next ? (
          <Link
            href={versionHref(track.id, next.version)}
            className="bg-panel px-4 py-3 text-right hover:bg-panel-raised"
          >
            <span className="inline-flex items-center gap-1 text-xs text-fg-3">
              Next · <span className="font-mono">{next.version}</span>
              <ArrowRight className="size-3" aria-hidden="true" />
            </span>
            <Typography variant="small" color="primary" className="mt-0.5 text-pretty">
              {next.title}
            </Typography>
          </Link>
        ) : (
          <div className="bg-panel px-4 py-3 text-right text-xs text-fg-3">Current version</div>
        )}
      </nav>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          icon={ScrollText}
          title="How it shipped"
          actions={
            <>
              {task && (
                <Link href={taskHref(task.id)} className="text-xs text-fg-2 hover:text-fg">
                  Task
                </Link>
              )}
              {task?.pr && (
                <a
                  href={`${REPO_URL}/pull/${task.pr}`}
                  className="inline-flex items-center gap-0.5 text-xs text-fg-2 hover:text-fg"
                >
                  #{task.pr}
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </>
          }
        >
          <RecordList records={timeline} slots={slots} current={record.id} />
        </Panel>
        <Panel icon={Skull} title="Ideas that failed to beat it">
          {!node || node.buried.length === 0 ? (
            <Typography variant="small" className="px-4 py-6">
              Nothing has been buried against this version.
            </Typography>
          ) : (
            <ol className="divide-y divide-line">
              {node.buried.map((b) => (
                <li key={b.id} className="px-4 py-2.5">
                  <Link href={ideaHref(b.id)} className="block hover:underline">
                    <Typography variant="small" className="line-through decoration-fg-3/60">
                      {b.title}
                    </Typography>
                  </Link>
                  {b.detail && (
                    <Typography variant="meta" as="p" className="mt-0.5 text-pretty">
                      {b.detail}
                    </Typography>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </DetailShell>
  );
};

const VersionPage = (props: VersionPageProps) => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <VersionContent {...props} />
  </Suspense>
);

export default VersionPage;

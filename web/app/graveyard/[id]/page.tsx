import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GitBranch, ScrollText } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { DetailShell, MatchFacts, RecordList } from '@/components/arena/Detail';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { EngineChip } from '@/components/arena/SidePanels';
import { VersionChip } from '@/components/arena/TaskChips';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { lineage } from '@/lib/derive';
import { formatDay, formatTime } from '@/lib/format';
import { ideaHref, taskHref, versionHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';

type IdeaPageProps = {
  params: Promise<{ id: string }>;
};

const find = async ({ params }: IdeaPageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const record = s.records.find((r) => r.kind === 'idea_dead' && String(r.id) === id);
  return record ? { s, record } : null;
};

export const generateMetadata = async (props: IdeaPageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Buried idea' };
  const { record } = found;
  return pageMeta(
    record.title,
    record.detail ?? 'An idea the swarm tried and dropped.',
    ideaHref(record.id),
  );
};

const IdeaContent = async (props: IdeaPageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, record } = found;
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const timeline = record.task_id
    ? s.records
        .filter((r) => r.task_id === record.task_id)
        .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
    : [record];
  const matchId = [...timeline].reverse().find((r) => r.match_id)?.match_id;
  const match = matchId ? s.matches.find((m) => m.id === matchId) : undefined;
  const task = record.task_id ? s.tasks.find((t) => t.id === record.task_id) : undefined;
  const champion = record.track_id
    ? [...lineage(s, record.track_id).nodes].reverse().find((n) => n.at <= record.at)
    : undefined;
  const sameConcept = task?.concept
    ? s.tasks.filter((t) => t.concept === task.concept && t.id !== task.id)
    : [];

  return (
    <DetailShell
      eyebrow={
        <>
          {record.track_id && <EngineChip track={record.track_id} slots={slots} />}
          <span className="text-critical-text">Buried</span>
          <time dateTime={record.at}>
            {formatDay(record.at)}, {formatTime(record.at)} UTC
          </time>
          {task && (
            <Link href={taskHref(task.id)} className="hover:text-fg">
              Task
            </Link>
          )}
        </>
      }
      title={record.title}
      titleClassName="line-through decoration-fg-3/60"
      lede={record.detail}
    >
      {match && <MatchFacts match={match} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={ScrollText} title="What happened">
          <RecordList records={timeline} slots={slots} current={record.id} />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel icon={GitBranch} title="The version it had to beat">
            {champion && record.track_id ? (
              <Link
                href={versionHref(record.track_id, champion.version)}
                className="block px-4 py-3 hover:bg-panel-raised"
              >
                <VersionChip
                  version={champion.version}
                  elo={champion.elo}
                  error={champion.eloError}
                />
                <Typography variant="small" color="primary" className="mt-1 text-pretty">
                  {champion.title}
                </Typography>
              </Link>
            ) : (
              <Typography variant="small" className="px-4 py-6">
                Buried before the first version shipped.
              </Typography>
            )}
          </Panel>
          {sameConcept.length > 0 && (
            <Panel title={`Same concept: ${task!.concept}`}>
              <ol className="divide-y divide-line">
                {sameConcept.map((t) => (
                  <li key={t.id} className="px-4 py-2.5">
                    <Link href={taskHref(t.id)} className="hover:underline">
                      <Typography variant="small" color="primary" as="span">
                        {t.title}
                      </Typography>
                    </Link>
                    <Typography variant="meta" as="p">
                      {t.track_id} · {t.status}
                    </Typography>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      </div>
    </DetailShell>
  );
};

const IdeaPage = (props: IdeaPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-5xl px-4 pt-6 sm:px-6" />}>
    <IdeaContent {...props} />
  </Suspense>
);

export default IdeaPage;

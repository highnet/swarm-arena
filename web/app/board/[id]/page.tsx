import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowLeft, ArrowRight, ScrollText } from 'lucide-react';
import { agentName, type GameId } from '@arena/shared';
import { DetailShell, MatchFacts, RecordList } from '@/components/arena/Detail';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { KINDS, TONE_CLASS } from '@/components/arena/recordKinds';
import { EngineChip } from '@/components/arena/SidePanels';
import { agentHref } from '@/components/arena/seats';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { recordHref, taskHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

type RecordPageProps = {
  params: Promise<{ id: string }>;
};

const find = async ({ params }: RecordPageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const record = s.records.find((r) => String(r.id) === id);
  return record ? { s, record } : null;
};

export const generateMetadata = async (props: RecordPageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Record' };
  const { record } = found;
  return pageMeta(
    record.title,
    record.detail ?? `${KINDS[record.kind].label} on the board.`,
    `/board/${record.id}`,
  );
};

const RecordContent = async (props: RecordPageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, record } = found;
  // Shipped versions and buried ideas live on their own pages.
  const own = recordHref(record);
  if (own !== `/board/${record.id}`) permanentRedirect(own);

  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const meta = KINDS[record.kind];
  const ordered = [...s.records].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const at = ordered.findIndex((r) => r.id === record.id);
  const prev = at > 0 ? ordered[at - 1] : null;
  const next = at < ordered.length - 1 ? ordered[at + 1] : null;
  const match = record.match_id ? s.matches.find((m) => m.id === record.match_id) : undefined;
  const related = record.task_id
    ? ordered.filter((r) => r.task_id === record.task_id)
    : ordered.filter((r) => r.kind === record.kind && r.track_id === record.track_id).slice(-12);

  return (
    <DetailShell
      eyebrow={
        <>
          <span className={cn('font-medium', TONE_CLASS[meta.tone])}>{meta.label}</span>
          {record.track_id && <EngineChip track={record.track_id} slots={slots} />}
          <time dateTime={record.at}>
            {formatDay(record.at)}, {formatTime(record.at)} UTC
          </time>
          {record.agent_id && (
            <Link href={agentHref(record.agent_id)} className="hover:text-fg">
              by {agentName(record.agent_id)}
            </Link>
          )}
          {record.task_id && (
            <Link href={taskHref(record.task_id)} className="hover:text-fg">
              Task
            </Link>
          )}
        </>
      }
      title={record.title}
      lede={record.detail}
    >
      {match && <MatchFacts match={match} />}

      <nav
        aria-label="Neighbouring records"
        className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2"
      >
        {[prev, next].map((r, i) =>
          r ? (
            <Link
              key={r.id}
              href={recordHref(r)}
              className={cn('bg-panel px-4 py-3 hover:bg-panel-raised', i === 1 && 'sm:text-right')}
            >
              <span className="inline-flex items-center gap-1 text-xs text-fg-3">
                {i === 0 && <ArrowLeft className="size-3" aria-hidden="true" />}
                {i === 0 ? 'Before' : 'After'} · {KINDS[r.kind].label}
                {i === 1 && <ArrowRight className="size-3" aria-hidden="true" />}
              </span>
              <Typography variant="small" color="primary" className="mt-0.5 text-pretty">
                {r.title}
              </Typography>
            </Link>
          ) : (
            <div
              key={i}
              className={cn('bg-panel px-4 py-3 text-xs text-fg-3', i === 1 && 'sm:text-right')}
            >
              {i === 0 ? 'The first record' : 'The latest record'}
            </div>
          ),
        )}
      </nav>

      <Panel
        icon={ScrollText}
        title={
          record.task_id
            ? 'The same task on the record'
            : `Other ${meta.label.toLowerCase()} records`
        }
      >
        <RecordList records={related} slots={slots} current={record.id} />
      </Panel>
    </DetailShell>
  );
};

const RecordPage = (props: RecordPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-5xl px-4 pt-6 sm:px-6" />}>
    <RecordContent {...props} />
  </Suspense>
);

export default RecordPage;

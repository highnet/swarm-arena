import type { ReactNode } from 'react';
import Link from 'next/link';
import type { BoardRecord, GameId, Match } from '@arena/shared';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { matchHref, recordHref } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { EngineChip } from './SidePanels';
import { KINDS, TONE_CLASS } from './recordKinds';

type DetailShellProps = {
  /** Small line above the title: engine, kind, time. */
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  titleClassName?: string;
  children?: ReactNode;
};

/** The frame every item page shares: what it is, and its title. The way back is the breadcrumb. */
const DetailShell = ({ eyebrow, title, lede, titleClassName, children }: DetailShellProps) => (
  <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
    <div className="pb-5">
      {eyebrow && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">{eyebrow}</div>
      )}
      <Typography variant="pageTitle" className={cn('mt-1', titleClassName)}>
        {title}
      </Typography>
      {lede && (
        <Typography variant="lede" className="mt-2 max-w-3xl">
          {lede}
        </Typography>
      )}
    </div>
    <div className="flex flex-col gap-4">{children}</div>
  </main>
);

type FactsProps = {
  items: { label: string; value: ReactNode; note?: ReactNode; href?: string }[];
};

/** A row of labelled numbers or names, linking where the value has a page of its own. */
const Facts = ({ items }: FactsProps) => (
  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
    {items.map((f) => (
      <div key={f.label} className="bg-panel px-4 py-3">
        <dt className="text-xs text-fg-3">{f.label}</dt>
        <dd className="mt-0.5 truncate font-mono text-lg tabular text-fg">
          {f.href ? (
            <Link href={f.href} className="hover:underline">
              {f.value}
            </Link>
          ) : (
            f.value
          )}
        </dd>
        {f.note && <dd className="truncate text-xs text-fg-3">{f.note}</dd>}
      </div>
    ))}
  </dl>
);

type RecordListProps = {
  records: BoardRecord[];
  slots: Partial<Record<GameId, number>>;
  /** Record to mark as the one this page is about. */
  current?: number;
  empty?: string;
};

/** Board records in order, each linking to its own page. */
const RecordList = ({
  records,
  slots,
  current,
  empty = 'Nothing on the record.',
}: RecordListProps) =>
  records.length === 0 ? (
    <Typography variant="small" className="px-4 py-6">
      {empty}
    </Typography>
  ) : (
    <ol className="divide-y divide-line">
      {records.map((r) => {
        const meta = KINDS[r.kind];
        const Icon = meta.icon;
        return (
          <li
            key={r.id}
            className={cn(
              'relative flex items-start gap-2.5 px-4 py-2.5 hover:bg-panel-raised',
              r.id === current && 'bg-panel-raised',
            )}
          >
            <Icon
              className={cn('mt-0.5 size-4 shrink-0', TONE_CLASS[meta.tone])}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
                <span className={cn('font-medium', TONE_CLASS[meta.tone])}>{meta.label}</span>
                {r.track_id && (
                  <span className="relative z-1">
                    <EngineChip track={r.track_id} slots={slots} />
                  </span>
                )}
                <time dateTime={r.at}>
                  {formatDay(r.at)}, {formatTime(r.at)} UTC
                </time>
              </div>
              <Link
                href={recordHref(r)}
                className="mt-0.5 block text-[13px] text-fg text-pretty after:absolute after:inset-0 after:content-[''] hover:underline"
              >
                {r.title}
              </Link>
              {r.detail && (
                <Typography
                  variant="meta"
                  as="p"
                  className={cn('mt-0.5 text-pretty', r.id !== current && 'line-clamp-3')}
                >
                  {r.detail}
                </Typography>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );

type MatchFactsProps = {
  match: Match;
};

/** The four numbers of a match, each pointing at the match page. */
const MatchFacts = ({ match: m }: MatchFactsProps) => {
  const total = m.wins + m.draws + m.losses;
  const href = matchHref(m.id);
  return (
    <Facts
      items={[
        {
          label: 'Score',
          value: `${m.wins}–${m.losses}–${m.draws}`,
          note: `W–L–D over ${total} games`,
          href,
        },
        {
          label: 'Performance',
          value: formatElo(m.elo),
          note: `± ${Math.round(m.elo_error)} (95%)`,
          href,
        },
        { label: 'Opponent', value: m.opponent, note: `rated ${formatElo(m.opponent_elo)}`, href },
        {
          label: 'Points',
          value: `${m.wins + m.draws / 2} / ${total}`,
          note: `${m.purpose} match`,
          href,
        },
      ]}
    />
  );
};

export { DetailShell, Facts, MatchFacts, RecordList };

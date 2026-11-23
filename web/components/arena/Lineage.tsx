import Link from 'next/link';
import type { LineageNode } from '@/lib/derive';
import { formatDay, formatElo } from '@/lib/format';
import { SERIES } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { Typography } from '@/components/ui/Typography';

type BuriedListProps = {
  items: LineageNode['buried'];
};

const BuriedList = ({ items }: BuriedListProps) =>
  items.length ? (
    <ul className="mt-2 space-y-1.5 border-l border-dashed border-line-strong pl-3">
      {items.map((b) => (
        <li key={`${b.at}-${b.title}`} className="text-xs">
          <span className="text-fg-3 line-through decoration-fg-3/60">{b.title}</span>
          {b.detail && <span className="block text-fg-3">{b.detail}</span>}
        </li>
      ))}
    </ul>
  ) : null;

type LineageProps = {
  nodes: LineageNode[];
  beforeFirst: LineageNode['buried'];
  slot: number;
};

/** Shipped versions newest first, each with the ideas that died trying to beat it. */
const Lineage = ({ nodes, beforeFirst, slot }: LineageProps) => {
  if (!nodes.length && !beforeFirst.length) {
    return (
      <Typography variant="small" className="px-4 py-6">
        No version has shipped yet.
      </Typography>
    );
  }
  return (
    <ol className="px-4 py-3">
      {[...nodes].reverse().map((n, i) => (
        <li key={n.version} className="relative pb-4 pl-6 last:pb-1">
          <span
            className={cn(
              'absolute left-0 top-1 size-3 rounded-full border-2',
              SERIES[slot].border,
              i === 0 ? SERIES[slot].bg : 'bg-panel',
            )}
            aria-hidden="true"
          />
          {i < nodes.length - 1 && (
            <span
              className="absolute left-[5px] top-5 bottom-0 w-px bg-line-strong"
              aria-hidden="true"
            />
          )}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={`/matches/${n.matchId}`}
              className="font-mono text-[13px] text-fg hover:underline"
            >
              {n.version}
            </Link>
            <span className="font-mono text-xs tabular text-fg-2">{formatElo(n.elo)}</span>
            <span className="text-xs text-fg-3">{formatDay(n.at)}</span>
          </div>
          <Typography variant="small" className="mt-0.5 text-pretty">
            {n.title}
          </Typography>
          <BuriedList items={n.buried} />
        </li>
      ))}
      {beforeFirst.length > 0 && (
        <li className="relative pl-6">
          <span
            className="absolute left-0 top-1 size-3 rounded-full border-2 border-line-strong bg-panel"
            aria-hidden="true"
          />
          <span className="text-xs text-fg-3">Before the first version</span>
          <BuriedList items={beforeFirst} />
        </li>
      )}
    </ol>
  );
};

export { Lineage };

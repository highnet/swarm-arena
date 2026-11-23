'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import type { BoardRecord, GameId } from '@arena/shared';
import { BoardFeed } from './BoardFeed';

type BoardSearchProps = {
  records: BoardRecord[];
  slots: Partial<Record<GameId, number>>;
  seats: Record<string, string>;
};

/** The whole feed with text search; ?q= and ?kind= set the starting state. */
const BoardSearch = ({ records, slots, seats }: BoardSearchProps) => {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const kind = params.get('kind') ?? 'all';
  return (
    <div data-slot="board-search">
      <div className="relative border-b border-line p-3">
        <Search
          className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-fg-3"
          aria-hidden="true"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search records, engines and agents"
          placeholder="Search records, engines and agents"
          className="h-9 w-full rounded-md border border-line bg-bg pl-9 pr-3 text-sm text-fg placeholder:text-fg-3 focus:border-line-strong focus:outline-none"
        />
      </div>
      <BoardFeed
        key={kind}
        records={records}
        slots={slots}
        seats={seats}
        pageSize={50}
        query={q}
        initialKind={kind}
      />
    </div>
  );
};

export { BoardSearch };

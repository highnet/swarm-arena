import type { Agent, BoardRecord, GameId } from '@arena/shared';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatTime } from '@/lib/format';
import { SERIES, SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type StrategySeatProps = {
  updates: BoardRecord[];
};

/** The strategist's standing orders. Newest first; the latest is the one in force. */
const StrategySeat = ({ updates }: StrategySeatProps) => {
  const [current, ...older] = updates;
  return (
    <Panel id="strategy" title="Strategy">
      {current ? (
        <div className="px-4 py-3.5">
          <Typography variant="meta">
            Since {formatDay(current.at)}, {formatTime(current.at)} UTC
          </Typography>
          <Typography
            variant="body"
            color="primary"
            weight="medium"
            className="mt-1 text-[15px] text-pretty"
          >
            {current.title}
          </Typography>
          {current.detail && (
            <Typography variant="small" className="mt-1.5 text-pretty">
              {current.detail}
            </Typography>
          )}
        </div>
      ) : (
        <Typography variant="small" className="px-4 py-6">
          No orders yet.
        </Typography>
      )}
      {older.length > 0 && (
        <details className="group border-t border-line">
          <summary className="cursor-pointer list-none px-4 py-2 text-xs text-fg-3 hover:text-fg-2">
            {older.length} earlier {older.length === 1 ? 'call' : 'calls'}
          </summary>
          <ol className="space-y-2.5 px-4 pb-3.5">
            {older.map((u) => (
              <li key={u.id} className="grid grid-cols-[4.5rem_1fr] gap-2">
                <time dateTime={u.at} className="font-mono text-xs tabular text-fg-3">
                  {formatDay(u.at).split(' ').slice(1).join(' ')} {formatTime(u.at)}
                </time>
                <Typography variant="small">{u.title}</Typography>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Panel>
  );
};

type GraveyardProps = {
  dead: BoardRecord[];
  slots: Partial<Record<GameId, number>>;
};

/** Ideas that lost their gate match. Kept on purpose: failure is part of the record. */
const Graveyard = ({ dead, slots }: GraveyardProps) => (
  <Panel
    id="graveyard"
    title="Graveyard"
    actions={
      <Typography variant="meta" as="span">
        {dead.length} buried
      </Typography>
    }
  >
    {dead.length === 0 ? (
      <Typography variant="small" className="px-4 py-6">
        Nothing buried yet.
      </Typography>
    ) : (
      <ol className="divide-y divide-line">
        {dead.map((d) => (
          <li key={d.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-fg-3">
              {d.track_id && slots[d.track_id] && (
                <span className="inline-flex items-center gap-1 text-fg-2">
                  <span className={cn('size-1.5 rounded-full', SERIES[slots[d.track_id]!].bg)} />
                  {SHORT_NAME[d.track_id]}
                </span>
              )}
              <time dateTime={d.at}>{formatDay(d.at)}</time>
            </div>
            <Typography
              variant="small"
              color="primary"
              className="mt-0.5 text-fg-2 line-through decoration-fg-3/60"
            >
              {d.title}
            </Typography>
            {d.detail && (
              <Typography variant="meta" as="p" className="mt-0.5 text-pretty">
                {d.detail}
              </Typography>
            )}
          </li>
        ))}
      </ol>
    )}
  </Panel>
);

type AgentRosterProps = {
  agents: Agent[];
  slots: Partial<Record<GameId, number>>;
};

const STATUS_DOT: Record<Agent['status'], string> = {
  working: 'bg-good animate-pulse-dot',
  idle: 'bg-fg-3',
  stopped: 'border border-line-strong bg-transparent',
};

const AgentRoster = ({ agents, slots }: AgentRosterProps) => {
  const sorted = [...agents].sort(
    (a, b) =>
      ['working', 'idle', 'stopped'].indexOf(a.status) -
        ['working', 'idle', 'stopped'].indexOf(b.status) || a.seat.localeCompare(b.seat),
  );
  const working = agents.filter((a) => a.status === 'working').length;
  return (
    <Panel
      id="seats"
      title="Agents"
      actions={
        <Typography variant="meta" as="span">
          {working} of {agents.length} at work
        </Typography>
      }
    >
      <ul className="grid grid-cols-1 divide-y divide-line">
        {sorted.map((a) => (
          <li key={a.id} className="flex items-center gap-2.5 px-4 py-2">
            <span
              className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[a.status])}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{a.seat}</span>
            {a.track_id && slots[a.track_id] && (
              <span
                className={cn('size-1.5 shrink-0 rounded-full', SERIES[slots[a.track_id]!].bg)}
                aria-hidden="true"
              />
            )}
            <span className="w-16 shrink-0 text-right text-xs text-fg-3">{a.status}</span>
            <span
              className="w-20 shrink-0 text-right font-mono text-xs tabular text-fg-3"
              title="Sessions"
            >
              {a.sessions} sess.
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
};

export { StrategySeat, Graveyard, AgentRoster };

import Link from 'next/link';
import {
  ArrowRight,
  CircleDashed,
  CircleDot,
  Compass,
  Skull,
  Telescope,
  Users,
} from 'lucide-react';
import type { Agent, BoardRecord, GameId, Task } from '@arena/shared';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatTime } from '@/lib/format';
import { SERIES, SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { AgentTag } from './AgentAvatar';
import { liveAgents, shownStatus } from './seats';
import { TaskTypeChip } from './TaskChips';

type Slots = Partial<Record<GameId, number>>;

type EngineChipProps = {
  track: GameId;
  slots: Slots;
};

const EngineChip = ({ track, slots }: EngineChipProps) => (
  <Link
    href={`/engines/${track}`}
    className="inline-flex items-center gap-1.5 rounded-[5px] border border-line px-1.5 text-xs leading-5 text-fg-2 hover:border-line-strong hover:text-fg"
  >
    <span className={cn('size-1.5 rounded-full', slots[track] && SERIES[slots[track]!].bg)} />
    {SHORT_NAME[track]}
  </Link>
);

type MoreLinkProps = {
  href: string;
  children: string;
};

const MoreLink = ({ href, children }: MoreLinkProps) => (
  <Link href={href} className="inline-flex items-center gap-1 text-xs text-fg-2 hover:text-fg">
    {children}
    <ArrowRight className="size-3" aria-hidden="true" />
  </Link>
);

type StrategyCallProps = {
  call: BoardRecord | null;
  mentioned: { track: GameId; seat: string; title: string }[];
  slots: Slots;
};

/** The latest call from the strategy seat, and what it set in motion. */
const StrategyCall = ({ call, mentioned, slots }: StrategyCallProps) => (
  <Panel
    id="strategy"
    icon={Compass}
    title="Latest from the strategy seat"
    actions={<MoreLink href="/board?kind=strategy">All calls</MoreLink>}
  >
    {call ? (
      <div className="px-4 py-3.5">
        <Typography variant="meta">
          {formatDay(call.at)}, {formatTime(call.at)} UTC
        </Typography>
        <Typography
          variant="body"
          color="primary"
          weight="medium"
          className="mt-1 text-[15px] text-pretty"
        >
          {call.title}
        </Typography>
        {call.detail && (
          <Typography variant="small" className="mt-1.5 text-pretty">
            {call.detail}
          </Typography>
        )}
        {mentioned.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <Typography variant="label" as="h3">
              Mentioned in this call
            </Typography>
            <ul className="mt-2 space-y-2">
              {mentioned.map((m) => (
                <li key={`${m.track}-${m.title}`} className="flex items-start gap-2">
                  <EngineChip track={m.track} slots={slots} />
                  <span className="min-w-0 text-[13px] text-fg-2">
                    {m.title}
                    {m.seat && (
                      <AgentTag
                        id={m.seat}
                        seat={m.seat}
                        size={16}
                        className="ml-2 align-middle text-xs"
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    ) : (
      <Typography variant="small" className="px-4 py-6">
        No calls yet.
      </Typography>
    )}
  </Panel>
);

type FrontierProps = {
  tasks: Task[];
  seats: Record<string, string>;
  slots: Slots;
};

/** What is being worked on now, and what is queued next. */
const Frontier = ({ tasks, seats, slots }: FrontierProps) => (
  <Panel
    id="frontier"
    icon={Telescope}
    title="The frontier"
    actions={
      <Typography variant="meta" as="span">
        {tasks.filter((t) => t.status === 'claimed').length} in progress ·{' '}
        {tasks.filter((t) => t.status === 'open').length} queued
      </Typography>
    }
  >
    {tasks.length === 0 ? (
      <Typography variant="small" className="px-4 py-6">
        Nothing open. The strategy seat calls the next experiments.
      </Typography>
    ) : (
      <ol className="divide-y divide-line">
        {tasks.map((t) => {
          const Icon = t.status === 'claimed' ? CircleDot : CircleDashed;
          return (
            <li key={t.id} className="flex items-start gap-2.5 px-4 py-2.5">
              <Icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  t.status === 'claimed' ? 'animate-pulse-dot text-good-text' : 'text-fg-3',
                )}
                aria-label={t.status === 'claimed' ? 'Agent at work' : 'Queued'}
              />
              <div className="min-w-0 flex-1">
                <Link href={`/tasks/${t.id}`} className="hover:underline">
                  <Typography variant="small" color="primary" as="span" className="text-pretty">
                    {t.title}
                  </Typography>
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <EngineChip track={t.track_id} slots={slots} />
                  <TaskTypeChip type={t.type} />
                  {t.claimed_by ? (
                    <AgentTag
                      id={t.claimed_by}
                      seat={seats[t.claimed_by]}
                      size={16}
                      className="text-xs"
                    />
                  ) : (
                    <span className="text-xs text-fg-3">unclaimed</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    )}
  </Panel>
);

type GraveyardProps = {
  dead: BoardRecord[];
  slots: Slots;
  limit?: number;
};

/** Ideas that lost their gate match. Kept on purpose: failure is part of the record. */
const Graveyard = ({ dead, slots, limit = 5 }: GraveyardProps) => (
  <Panel
    id="graveyard"
    icon={Skull}
    title={
      <>
        The graveyard <span className="ml-1 font-normal text-fg-3">in memoriam</span>
      </>
    }
    actions={dead.length > limit ? <MoreLink href="/board?kind=dead">Older</MoreLink> : undefined}
  >
    {dead.length === 0 ? (
      <Typography variant="small" className="px-4 py-6">
        Nothing is buried yet.
      </Typography>
    ) : (
      <ol className="divide-y divide-line">
        {dead.slice(0, limit).map((d) => (
          <li key={d.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-fg-3">
              {d.track_id && <EngineChip track={d.track_id} slots={slots} />}
              <time dateTime={d.at}>{formatDay(d.at)}</time>
            </div>
            <Typography variant="small" className="mt-1 line-through decoration-fg-3/60">
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

type FleetProps = {
  agents: Agent[];
  /** The snapshot's clock: a working seat silent for too long counts as stale, not at work. */
  asOf: string;
  slots: Slots;
};

const STATUS_DOT: Record<ReturnType<typeof shownStatus>, string> = {
  working: 'bg-good animate-pulse-dot',
  stale: 'bg-warning',
  idle: 'bg-fg-3',
  stopped: 'border border-line-strong bg-transparent',
};

/** Every seat in the swarm, working ones first. */
const Fleet = ({ agents, asOf, slots }: FleetProps) => {
  const order = ['working', 'stale', 'idle', 'stopped'];
  const sorted = [...agents].sort(
    (a, b) =>
      order.indexOf(shownStatus(a, asOf)) - order.indexOf(shownStatus(b, asOf)) ||
      a.seat.localeCompare(b.seat),
  );
  const working = liveAgents(agents, asOf).length;
  return (
    <Panel
      id="fleet"
      icon={Users}
      title="The fleet"
      actions={
        <Typography variant="meta" as="span">
          {working} of {agents.length} at work
        </Typography>
      }
    >
      {sorted.length === 0 ? (
        <Typography variant="small" className="px-4 py-6">
          No agent has joined yet.
        </Typography>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 px-4 py-2">
              <span
                className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[shownStatus(a, asOf)])}
                aria-hidden="true"
              />
              <AgentTag id={a.id} seat={a.seat} size={22} className="flex-1 text-[13px]" />
              {a.track_id && slots[a.track_id] && (
                <span
                  className={cn('size-1.5 shrink-0 rounded-full', SERIES[slots[a.track_id]!].bg)}
                  aria-hidden="true"
                />
              )}
              <span
                className="w-14 shrink-0 text-right text-xs text-fg-3"
                title={
                  shownStatus(a, asOf) === 'stale'
                    ? 'Says it is working, but has not been heard from in 45 minutes'
                    : undefined
                }
              >
                {shownStatus(a, asOf)}
              </span>
              <span
                className="w-16 shrink-0 text-right font-mono text-xs tabular text-fg-3"
                title="Sessions"
              >
                {a.sessions} sess.
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

export { StrategyCall, Frontier, Graveyard, Fleet, EngineChip, MoreLink };

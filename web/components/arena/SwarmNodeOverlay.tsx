'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { SwarmAgent, SwarmCount, SwarmWorkItem } from '@rallypoint/swarm-graph/model';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatElo } from '@/lib/format';
import type { EngineNode, EngineVersion } from '@/lib/swarmEvents';
import { cn } from '@/lib/utils';
import { EngineBoard, type EngineBoardSource } from './EngineBoard';
import { agentHref } from './seats';
import { AgentAvatar } from './AgentAvatar';

/** Agent marks shown in a node before "+N". */
const MARKS = 3;
const COUNT_MS = 900;

type RatingCounterProps = {
  value: number | null;
  reducedMotion: boolean;
};

/** A rating that counts up (or down) to its new value in place. */
const RatingCounter = ({ value, reducedMotion }: RatingCounterProps) => {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (value === null || from.current === null || reducedMotion) {
      from.current = value;
      const t = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(t);
    }
    const start = performance.now();
    const a = from.current;
    let frame = requestAnimationFrame(function tick(now) {
      const k = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - (1 - k) ** 3;
      setShown(a + (value - a) * eased);
      if (k < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    });
    return () => cancelAnimationFrame(frame);
  }, [value, reducedMotion]);
  return <>{formatElo(shown)}</>;
};

type SparklineProps = {
  points: EngineVersion[];
};

const Sparkline = ({ points }: SparklineProps) => {
  if (points.length < 2) return null;
  const lo = Math.min(...points.map((p) => p.elo));
  const hi = Math.max(...points.map((p) => p.elo));
  const span = hi - lo || 1;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 22 - ((p.elo - lo) / span) * 20;
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

type VersionTimelineProps = {
  engine: EngineNode;
  repoUrl: string;
  anchor: DOMRect;
  onClose: () => void;
};

/** The engine's versions, v0.1 to now: rating, date landed and the idea each added. */
const VersionTimeline = ({ engine, repoUrl, anchor, onClose }: VersionTimelineProps) => {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 });

  // Keep the card inside the viewport: below the badge if it fits, above it otherwise.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(
      8,
      Math.min(anchor.left + anchor.width / 2 - w / 2, window.innerWidth - w - 8),
    );
    const below = anchor.bottom + 6 + h <= window.innerHeight - 8;
    const top = below ? anchor.bottom + 6 : Math.max(8, anchor.top - 6 - h);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (!card.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const rows = [...engine.timeline].reverse();
  return (
    <div
      ref={card}
      role="dialog"
      aria-label={`${engine.name} versions`}
      className="fixed z-30 w-72 max-w-[calc(100vw-1rem)] rounded-md border border-line-strong bg-panel-raised px-3 py-2 shadow-xl"
      style={{ left: pos.left, top: pos.top }}
    >
      <Typography variant="sectionTitle" as="div">
        {engine.name} versions
      </Typography>
      {engine.timeline.length === 0 ? (
        <Typography variant="meta" as="div">
          No rated version yet.
        </Typography>
      ) : (
        <>
          <div className="mt-1 text-fg-2">
            <Sparkline points={engine.timeline} />
          </div>
          <ol className="mt-1 max-h-60 space-y-1 overflow-y-auto">
            {rows.map((v) => (
              <li
                key={v.version}
                className="grid grid-cols-[3rem_3rem_1fr] items-baseline gap-2 text-xs"
              >
                <Link href={v.href} className="font-mono text-fg hover:underline">
                  {v.version}
                </Link>
                <span className="font-mono tabular text-fg-2">{formatElo(v.elo)}</span>
                <span className="min-w-0 text-fg-3">
                  <span className="text-fg-2">{v.idea ?? 'first rated version'}</span>
                  {' · '}
                  {formatDay(v.at)}
                  {v.pr && (
                    <>
                      {' · '}
                      <a
                        href={`${repoUrl}/pull/${v.pr}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-fg hover:underline"
                      >
                        #{v.pr}
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
};

export type NodeRating = {
  elo: number | null;
  version: string | null;
  delta: number | null;
  key: number;
};

type EngineBadgeProps = {
  engine: EngineNode;
  rating: NodeRating;
  reducedMotion: boolean;
  repoUrl: string;
};

/** "1317 · v0.5": the engine card's rating and version, live. Opens the version timeline. */
const EngineBadge = ({ engine, rating, reducedMotion, repoUrl }: EngineBadgeProps) => {
  const [open, setOpen] = useState<DOMRect | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (el: HTMLElement) => setOpen(el.getBoundingClientRect());
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        aria-expanded={Boolean(open)}
        aria-haspopup="dialog"
        aria-label={`${engine.name}: rated ${formatElo(rating.elo)}, ${rating.version ?? 'no version'}. Show versions`}
        data-slot="sector-rating"
        className="pointer-events-auto h-5 max-w-full gap-1 overflow-hidden bg-panel/80 px-1.5 font-mono text-[11px] tabular text-fg backdrop-blur-sm"
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          const el = e.currentTarget;
          hoverTimer.current = setTimeout(() => show(el), 150);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') clearTimeout(hoverTimer.current);
        }}
        onFocus={(e) => show(e.currentTarget)}
        onClick={(e) => (open ? setOpen(null) : show(e.currentTarget))}
      >
        <RatingCounter value={rating.elo} reducedMotion={reducedMotion} />
        <span className="text-fg-3">· {rating.version ?? '—'}</span>
        {rating.delta !== null && rating.delta !== 0 && (
          <span
            key={rating.key}
            className={cn(
              'animate-delta-flash',
              rating.delta > 0 ? 'text-good-text' : 'text-critical-text',
            )}
          >
            {rating.delta > 0 ? '+' : ''}
            {rating.delta}
          </span>
        )}
      </Button>
      {open && (
        <VersionTimeline
          engine={engine}
          repoUrl={repoUrl}
          anchor={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
};

type AgentMarkProps = {
  agent: SwarmAgent;
  title: string;
};

/** One agent working in the sector, as its own animal (#200); the row around it links and highlights. */
const AgentMark = ({ agent, title }: AgentMarkProps) => (
  <span
    data-slot="sector-agent-mark"
    data-agent-id={agent.id}
    title={title}
    className="block rounded-full ring-1 ring-good"
  >
    <AgentAvatar id={agent.id} size={14} />
  </span>
);

type AgentMarksProps = {
  agents: SwarmAgent[];
  items: Map<string, SwarmWorkItem>;
  detail: boolean;
  seatIds: Set<string>;
  onHighlight: (agentId: string | null) => void;
};

/**
 * Who is working in this sector right now, as a compact row of marks (the agent nodes linked to
 * the sector say the rest). Each mark names the agent's role, name, target and (in the swarm
 * view) its step on hover, and links to the agent's page.
 */
const AgentMarks = ({ agents, items, detail, seatIds, onHighlight }: AgentMarksProps) => {
  if (agents.length === 0) return null;
  const target = (a: SwarmAgent) => {
    const w = a.workItem ? items.get(a.workItem) : undefined;
    if (a.pr && (a.role === 'reviewer' || a.role === 'merger')) return `PR ${a.pr}`;
    if (w?.issue) return `#${w.issue}`;
    if (a.pr) return `PR ${a.pr}`;
    return null;
  };
  return (
    <ul data-slot="sector-agents" className="flex items-center gap-1">
      {agents.slice(0, MARKS).map((a) => {
        const title = [a.role, a.label ?? a.id, target(a), detail ? a.activity : null]
          .filter(Boolean)
          .join(' · ');
        const mark = <AgentMark agent={a} title={title} />;
        return (
          <li
            key={a.id}
            className="pointer-events-auto"
            onPointerEnter={() => onHighlight(a.id)}
            onPointerLeave={() => onHighlight(null)}
          >
            {seatIds.has(a.id) ? (
              <Link
                href={agentHref(a.id)}
                aria-label={title}
                className="block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-fg-3"
                onFocus={() => onHighlight(a.id)}
                onBlur={() => onHighlight(null)}
              >
                {mark}
              </Link>
            ) : (
              mark
            )}
          </li>
        );
      })}
      {agents.length > MARKS && (
        <li className="text-[9px] leading-3 tabular text-fg-3">+{agents.length - MARKS}</li>
      )}
    </ul>
  );
};

type SectorStatusProps = {
  live: boolean;
};

/** "live" or "idle": whether anyone works in the sector now. */
const SectorStatus = ({ live }: SectorStatusProps) => (
  <span
    data-slot="sector-status"
    className={cn('shrink-0 text-[10px] leading-3', live ? 'text-good-text' : 'text-fg-3')}
  >
    {live ? 'live' : 'idle'}
  </span>
);

type SwarmNodeOverlayProps = {
  nodeId: string;
  /** Pins the overlay over its node as the node's bounding square; the renderer moves it. */
  anchor: (nodeId: string, el: HTMLElement | null) => void;
  /** The sector's name. */
  label: string;
  /** The sector's stable count (merged, landed), drawn inside it. */
  count: SwarmCount | null;
  engine: EngineNode | null;
  rating: NodeRating | null;
  board: EngineBoardSource | null;
  agents: SwarmAgent[];
  items: Map<string, SwarmWorkItem>;
  agentDetail: boolean;
  seatIds: Set<string>;
  reducedMotion: boolean;
  repoUrl: string;
  onHighlight: (agentId: string | null) => void;
};

/**
 * Everything a sector node carries, inside its circle (#199): its name, its engine's rating and
 * version, the count landed, whether anyone works there, and the engine's live game. The
 * renderer sizes this element to the node's bounding square (`anchor(…, 'inside')`).
 *
 * The board sits at a fixed place: centred, its top 2rem above the circle's centre. The name and
 * rating stack upwards from a fixed line above it, the count and status downwards from a fixed
 * line below it, so no change of text moves the board. Circles too small for all of this (phones,
 * zoomed out) show only the name, the count and the rating, centred.
 */
const SwarmNodeOverlay = ({
  nodeId,
  anchor,
  label,
  count,
  engine,
  rating,
  board,
  agents,
  items,
  agentDetail,
  seatIds,
  reducedMotion,
  repoUrl,
  onHighlight,
}: SwarmNodeOverlayProps) => {
  // A stable ref: the renderer is told once when the element arrives and once when it goes.
  const pin = useCallback((el: HTMLElement | null) => anchor(nodeId, el), [anchor, nodeId]);
  const live = agents.length > 0;
  const total = count && count.value > 0 ? `${count.value} ${count.unit}` : null;
  const recent = count?.recent ? `${count.recent} ${count.recentUnit ?? 'recent'}` : null;
  return (
    <div
      ref={pin}
      data-slot="swarm-node-overlay"
      data-node-id={nodeId}
      data-live={live || undefined}
      className="@container pointer-events-none invisible absolute top-0 left-0 z-5 rounded-full"
    >
      {/* Full: name and rating above the board, count and status below it. */}
      <div data-slot="sector-full" className="absolute inset-0 hidden @min-[10.5rem]:block">
        <div
          data-slot="sector-head"
          className="absolute inset-x-[22%] bottom-[calc(50%+2.25rem)] flex flex-col items-center gap-0.5"
        >
          <Typography
            as="div"
            variant="label"
            color="primary"
            weight="semibold"
            truncate
            className="max-w-full text-[11px] leading-3.5"
          >
            {label}
          </Typography>
          {engine && rating && (
            <EngineBadge
              engine={engine}
              rating={rating}
              reducedMotion={reducedMotion}
              repoUrl={repoUrl}
            />
          )}
        </div>

        {board ? (
          <div
            data-slot="sector-board"
            className="pointer-events-auto absolute top-[calc(50%-2rem)] left-1/2 w-[62%] -translate-x-1/2"
          >
            <EngineBoard source={board} reducedMotion={reducedMotion} />
          </div>
        ) : (
          <div
            data-slot="sector-count"
            className="absolute inset-x-[15%] top-[calc(50%-2rem)] flex h-16 flex-col items-center justify-center"
          >
            <Typography as="div" variant="bigData" className="text-2xl leading-7">
              {count && count.value > 0 ? count.value : '—'}
            </Typography>
            <Typography as="div" variant="meta" className="text-[10px] leading-3">
              {count?.unit ?? 'nothing yet'}
            </Typography>
          </div>
        )}

        <div
          data-slot="sector-foot"
          className="absolute inset-x-[24%] top-[calc(50%+3rem)] flex flex-col items-center gap-0.5"
        >
          <Typography
            as="div"
            variant="meta"
            truncate
            className="max-w-full text-[10px] leading-3 tabular"
          >
            {board
              ? [total, recent].filter(Boolean).join(' · ') || 'nothing landed'
              : (recent ?? '')}
          </Typography>
          <div className="flex h-3 items-center gap-1.5">
            <SectorStatus live={live} />
            <AgentMarks
              agents={agents}
              items={items}
              detail={agentDetail}
              seatIds={seatIds}
              onHighlight={onHighlight}
            />
          </div>
        </div>
      </div>

      {/* Compact: a small circle keeps the name, the count and the rating, nothing outside. */}
      <div
        data-slot="sector-compact"
        className="absolute inset-[16%] flex flex-col items-center justify-center @min-[10.5rem]:hidden"
      >
        <Typography
          as="div"
          variant="label"
          color="primary"
          weight="semibold"
          truncate
          className="max-w-full text-[10px] leading-3"
        >
          {label}
        </Typography>
        <Typography as="div" variant="bigData" className="text-base leading-5">
          {count && count.value > 0 ? count.value : '—'}
        </Typography>
        {rating?.elo != null && (
          <Typography
            as="div"
            variant="meta"
            truncate
            className="flex max-w-full items-center gap-1 font-mono text-[9px] leading-3 tabular"
          >
            {live && <span className="size-1 shrink-0 rounded-full bg-good" aria-hidden="true" />}
            {formatElo(rating.elo)}
          </Typography>
        )}
      </div>
    </div>
  );
};

export { SwarmNodeOverlay };

'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { SwarmAgent, SwarmWorkItem } from '@rallypoint/swarm-graph/model';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatElo } from '@/lib/format';
import type { EngineNode, EngineVersion } from '@/lib/swarmEvents';
import { cn } from '@/lib/utils';
import { EngineBoard, type EngineBoardSource } from './EngineBoard';
import { agentHref } from './seats';

/** Agent chips shown under a node before "+N more". */
const CHIPS = 3;
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
        className="pointer-events-auto h-5 gap-1 bg-panel/80 px-1.5 font-mono text-[11px] tabular text-fg backdrop-blur-sm"
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

type AgentChipsProps = {
  agents: SwarmAgent[];
  items: Map<string, SwarmWorkItem>;
  detail: boolean;
  seatIds: Set<string>;
  onHighlight: (agentId: string | null) => void;
};

/** Who is working in this node right now: role, name, target and (in the swarm view) the step. */
const AgentChips = ({ agents, items, detail, seatIds, onHighlight }: AgentChipsProps) => {
  if (agents.length === 0)
    return (
      <span className="hidden rounded bg-panel/70 px-1.5 text-[10px] leading-4 text-fg-3 sm:inline">
        idle
      </span>
    );
  const target = (a: SwarmAgent) => {
    const w = a.workItem ? items.get(a.workItem) : undefined;
    if (a.pr && (a.role === 'reviewer' || a.role === 'merger')) return `PR ${a.pr}`;
    if (w?.issue) return `#${w.issue}`;
    if (a.pr) return `PR ${a.pr}`;
    return null;
  };
  return (
    <ul className="flex flex-col items-start gap-0.5 group-data-[side=left]:items-end">
      {agents.slice(0, CHIPS).map((a) => {
        const text = [a.role, a.label ?? a.id, target(a), detail ? a.activity : null]
          .filter(Boolean)
          .join(' · ');
        const chip = (
          <span className="block max-w-44 truncate rounded bg-panel/85 px-1.5 text-[10px] leading-4 text-fg-2 ring-1 ring-line backdrop-blur-sm hover:text-fg">
            <span
              className="mr-1 inline-block size-1.5 rounded-full bg-good align-middle"
              aria-hidden="true"
            />
            {text}
          </span>
        );
        return (
          <li
            key={a.id}
            className="pointer-events-auto"
            title={[a.role, a.label, target(a), a.activity].filter(Boolean).join(' · ')}
            onPointerEnter={() => onHighlight(a.id)}
            onPointerLeave={() => onHighlight(null)}
          >
            {seatIds.has(a.id) ? (
              <Link
                href={agentHref(a.id)}
                onFocus={() => onHighlight(a.id)}
                onBlur={() => onHighlight(null)}
              >
                {chip}
              </Link>
            ) : (
              chip
            )}
          </li>
        );
      })}
      {agents.length > CHIPS && (
        <li className="text-[10px] leading-4 text-fg-3">+{agents.length - CHIPS} more</li>
      )}
    </ul>
  );
};

type SwarmNodeOverlayProps = {
  nodeId: string;
  /** Pins the overlay to its node; the renderer moves it every frame. */
  anchor: (nodeId: string, el: HTMLElement | null) => void;
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
 * What a sector node carries in every preset: its engine's rating and version, who is working
 * in it now, and the engine's latest game. Properties of the node, not events.
 */
const SwarmNodeOverlay = ({
  nodeId,
  anchor,
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
}: SwarmNodeOverlayProps) => (
  <div
    ref={(el) => anchor(nodeId, el)}
    data-slot="swarm-node-overlay"
    data-node-id={nodeId}
    className="group pointer-events-none invisible absolute top-0 left-0 z-5"
  >
    <div className="flex w-40 flex-col items-start gap-1 group-data-[side=left]:items-end">
      {engine && rating && (
        <EngineBadge
          engine={engine}
          rating={rating}
          reducedMotion={reducedMotion}
          repoUrl={repoUrl}
        />
      )}
      <AgentChips
        agents={agents}
        items={items}
        detail={agentDetail}
        seatIds={seatIds}
        onHighlight={onHighlight}
      />
      {board && (
        <div className="pointer-events-auto hidden max-w-40 sm:block">
          <EngineBoard source={board} reducedMotion={reducedMotion} />
        </div>
      )}
    </div>
  </div>
);

export { SwarmNodeOverlay };

'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Pause, Play, RotateCcw, Radio, Vibrate, X } from 'lucide-react';
import {
  type SwarmReplayMode,
  type SwarmReplayPlan,
  type SwarmReplayState,
  type SwarmReplaySummary,
} from '@rallypoint/swarm-graph';
import { Button } from '@/components/ui/Button';
import { formatDay, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const SPEEDS = [1, 2, 4] as const;
/** Ticks drawn at most (milestones always): the rest are thinned so a phone stays readable. */
const MAX_TICKS = { wide: 360, narrow: 120 };
/** A drag released this close to a milestone (fraction of the track) settles on it. */
const SNAP = 0.012;

/** "9 h", "40 min", "2 d". */
export const formatSpan = (ms: number) => {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
};

const stamp = (iso: string | null) => (iso ? `${formatDay(iso)} ${formatTime(iso)}` : '—');

type ReplayScrubberProps = {
  plan: SwarmReplayPlan;
  state: SwarmReplayState;
  summary: SwarmReplaySummary;
  /** Sector id → colour. */
  colors: Map<string, string | null>;
  /** Sector id → label, for the end card. */
  labels: Map<string, string>;
  reducedMotion: boolean;
  clock: () => number | null;
  onSeek: (index: number) => void;
  onSeekTime: (ms: number) => void;
  onPlaying: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  onMode: (mode: SwarmReplayMode) => void;
  /** The viewer started or stopped dragging the playhead. */
  onScrubbing?: (on: boolean) => void;
  /** Haptic ticks on milestones (phones), off by default. */
  haptics?: boolean;
  onHaptics?: () => void;
  onClose: () => void;
};

/**
 * The replay's timeline: a slider over the window with a tick per event (taller for
 * milestones), break marks for squeezed idle gaps, and play, speed and window controls. The
 * playhead follows the renderer's clock every frame without re-rendering React.
 */
const ReplayScrubber = ({
  plan,
  state,
  summary,
  colors,
  labels,
  reducedMotion,
  clock,
  onSeek,
  onSeekTime,
  onPlaying,
  onSpeed,
  onMode,
  onScrubbing,
  haptics = false,
  onHaptics,
  onClose,
}: ReplayScrubberProps) => {
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [narrow, setNarrow] = useState(false);
  const [canVibrate, setCanVibrate] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setCanVibrate('vibrate' in navigator));
    return () => cancelAnimationFrame(id);
  }, []);
  const total = plan.total || 1;

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 480));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The playhead glides with the renderer's clock (jumps, with reduced motion, per event).
  useEffect(() => {
    let id = 0;
    const frame = () => {
      const ms = reducedMotion
        ? state.index > 0
          ? plan.times[state.index - 1]
          : 0
        : (clock() ?? 0);
      const pct = `${Math.max(0, Math.min(1, ms / total)) * 100}%`;
      if (head.current) head.current.style.left = pct;
      if (fill.current) fill.current.style.width = pct;
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [clock, reducedMotion, state.index, plan.times, total]);

  const ticks = useMemo(() => {
    const isMs = new Set(plan.milestones);
    const cap = narrow ? MAX_TICKS.narrow : MAX_TICKS.wide;
    const every = Math.max(1, Math.ceil(plan.flows.length / cap));
    return plan.flows.flatMap((f, i) =>
      isMs.has(i) || i % every === 0
        ? [
            {
              i,
              x: plan.times[i] / total,
              milestone: isMs.has(i),
              color: (f.sector && colors.get(f.sector)) || null,
              label: `${stamp(f.at)} · ${f.title}`,
            },
          ]
        : [],
    );
  }, [plan, total, colors, narrow]);

  const breaks = useMemo(
    () =>
      plan.gaps.map((g) => ({
        key: g.index,
        x: plan.times[g.index] / total,
        label: `${formatSpan(g.ms)} idle`,
      })),
    [plan, total],
  );

  const msAt = (clientX: number) => {
    const el = track.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return (Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * total) | 0;
  };

  const snapped = (ms: number) => {
    const near = plan.milestones
      .map((i) => plan.times[i])
      .find((t) => Math.abs(t - ms) / total < SNAP);
    return near ?? ms;
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    onScrubbing?.(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeekTime(msAt(e.clientX));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onSeekTime(msAt(e.clientX));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    onScrubbing?.(false);
    onSeekTime(snapped(msAt(e.clientX)));
  };

  const stepMilestone = (dir: 1 | -1) => {
    const cur = state.index - 1;
    const next =
      dir > 0
        ? plan.milestones.find((i) => i > cur)
        : [...plan.milestones].reverse().find((i) => i < cur);
    if (next !== undefined) onSeek(next + 1);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) stepMilestone(dir);
      else onSeek(state.index + dir);
    } else if (e.key === 'Home') onSeek(0);
    else if (e.key === 'End') onSeek(plan.flows.length);
    else if (e.key === ' ') onPlaying(!state.playing);
    else return;
    e.preventDefault();
  };

  const current = plan.flows[state.index - 1];
  const valueText = current
    ? `${stamp(current.at)}: ${current.title}`
    : `${stamp(plan.startAt)}: start`;
  const deltas = Object.entries(summary.rating).filter(([, d]) => d !== 0);

  return (
    <div
      data-slot="replay-scrubber"
      className="relative border-t border-line bg-panel-raised/95 px-3 py-2 backdrop-blur-sm sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button
          size="xs"
          variant="primary"
          className="active:scale-95"
          onClick={() => onPlaying(!state.playing)}
          aria-label={state.playing ? 'Pause replay' : 'Play replay'}
        >
          {state.playing ? (
            <Pause className="size-3.5" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
        </Button>
        <span className="font-mono text-xs tabular text-fg-2" data-slot="replay-range">
          {stamp(plan.startAt)} → now
        </span>
        <span className="font-mono text-xs tabular text-fg-3" aria-live="off">
          {state.index}/{state.total}
          {state.gapMs !== null && (
            <span className="text-fg-3" data-slot="replay-gap">
              {' '}
              · {formatSpan(state.gapMs)} later ·
            </span>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <Button
                key={s}
                variant="segment"
                size="xs"
                aria-pressed={state.speed === s}
                onClick={() => onSpeed(s)}
              >
                {s}×
              </Button>
            ))}
          </div>
          <div
            className="flex rounded-md border border-line p-0.5"
            role="group"
            aria-label="Window"
          >
            <Button
              variant="segment"
              size="xs"
              aria-pressed={plan.mode === 'window'}
              onClick={() => onMode('window')}
            >
              last 24 h
            </Button>
            <Button
              variant="segment"
              size="xs"
              aria-pressed={plan.mode === 'all'}
              onClick={() => onMode('all')}
            >
              whole run
            </Button>
          </div>
          {canVibrate && onHaptics && (
            <Button
              variant="segment"
              size="xs"
              aria-pressed={haptics}
              onClick={onHaptics}
              aria-label="Haptic ticks on milestones"
              title="Haptic ticks on milestones"
            >
              <Vibrate className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          <Button variant="icon" size="xs" onClick={onClose} aria-label="Close replay">
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Replay timeline"
        aria-valuemin={0}
        aria-valuemax={plan.flows.length}
        aria-valuenow={state.index}
        aria-valuetext={valueText}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
        className="relative mt-2 h-9 cursor-pointer touch-none rounded outline-none focus-visible:ring-2 focus-visible:ring-fg-3 sm:h-7"
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        <div
          ref={fill}
          className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded bg-fg-2/60 shadow-[0_0_6px_var(--fg-2)]"
        />
        {ticks.map((t) => (
          <span
            key={t.i}
            title={t.label}
            className={cn(
              'absolute bottom-1/2 w-px -translate-x-1/2 transition-[opacity,transform] duration-150 hover:-translate-y-0.5 hover:opacity-100',
              t.milestone ? 'h-3 w-0.5' : 'h-1.5',
              t.i < state.index ? 'opacity-100' : 'opacity-35',
            )}
            style={{ left: `${t.x * 100}%`, background: t.color ?? 'var(--fg-3)' }}
          />
        ))}
        {breaks.map((b) => (
          <span
            key={b.key}
            title={b.label}
            className="absolute top-1/2 -translate-x-1/2 translate-y-0.5 font-mono text-[10px] leading-none text-fg-3"
            style={{ left: `${b.x * 100}%` }}
          >
            ⫽
          </span>
        ))}
        <div
          ref={head}
          className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-fg shadow"
        />
      </div>

      {state.done && (
        <div
          data-slot="replay-summary"
          role="status"
          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-line bg-panel px-3 py-2 text-xs text-fg-2"
        >
          <span className="text-fg">
            {plan.mode === 'window' ? 'Last 24 active hours' : 'The whole run'}
          </span>
          <span className="font-mono tabular">{summary.merges} merged</span>
          <span className="font-mono tabular">{summary.ratings} versions rated</span>
          {summary.rejects > 0 && (
            <span className="font-mono tabular">{summary.rejects} sent back</span>
          )}
          {deltas.map(([sector, d]) => (
            <span key={sector} className="font-mono tabular">
              {labels.get(sector) ?? sector}{' '}
              <span className={d > 0 ? 'text-good-text' : 'text-critical-text'}>
                {d > 0 ? '+' : ''}
                {d}
              </span>
            </span>
          ))}
          <div className="ml-auto flex gap-1">
            <Button size="xs" onClick={() => onPlaying(true)}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Replay again
            </Button>
            <Button size="xs" variant="primary" onClick={onClose}>
              <Radio className="size-3.5" aria-hidden="true" />
              Watch live
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export { ReplayScrubber };

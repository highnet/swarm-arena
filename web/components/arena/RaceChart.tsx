'use client';

import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { formatDay, formatElo, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SERIES } from '@/lib/tracks';

export type RacePoint = { t: number; elo: number; version: string };

export type RaceSeries = {
  id: string;
  name: string;
  slot: number;
  points: RacePoint[];
  finishElo: number;
  finished: boolean;
};

type RaceChartProps = {
  series: RaceSeries[];
  start: number;
  end: number;
  height?: number;
};

const M = { top: 16, right: 112, bottom: 28, left: 44 };

/** Elo at time t: step function, null before the first measured version. */
const valueAt = (points: RacePoint[], t: number) => {
  let v: RacePoint | null = null;
  for (const p of points) {
    if (p.t <= t) v = p;
    else break;
  }
  return v;
};

const RaceChart = ({ series, start, end, height = 320 }: RaceChartProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = width < 520;
  const right = compact ? 16 : M.right;
  const innerW = width - M.left - right;
  const innerH = height - M.top - M.bottom;
  const yMax = Math.ceil((Math.max(...series.map((s) => s.finishElo), ...series.flatMap((s) => s.points.map((p) => p.elo))) + 100) / 500) * 500;
  const x = (t: number) => M.left + ((t - start) / (end - start)) * innerW;
  const y = (elo: number) => M.top + innerH - (Math.max(0, elo) / yMax) * innerH;

  const days = useMemo(() => {
    const out: number[] = [];
    const d = new Date(start);
    d.setUTCHours(24, 0, 0, 0);
    for (let t = d.getTime(); t < end; t += 86400_000) out.push(t);
    return out;
  }, [start, end]);

  // Direct labels at the right edge, nudged apart so they never collide.
  const labels = series
    .filter((s) => s.points.length)
    .map((s) => ({ s, elo: s.points[s.points.length - 1].elo, y: y(s.points[s.points.length - 1].elo) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < 16) labels[i].y = labels[i - 1].y + 16;
  }

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = start + ((e.clientX - rect.left) / rect.width) * (end - start);
    setHoverT(Math.min(end, Math.max(start, t)));
  };

  const hover = hoverT === null
    ? null
    : series
        .map((s) => ({ s, p: valueAt(s.points, hoverT) }))
        .filter((h) => h.p !== null)
        .sort((a, b) => b.p!.elo - a.p!.elo);

  const tipLeft = hoverT !== null && x(hoverT) > width - 200;

  return (
    <div ref={ref} data-slot="race-chart" className="relative w-full select-none">
      <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
        {Array.from({ length: yMax / 500 + 1 }, (_, i) => i * 500).map((v) => (
          <g key={v}>
            <line x1={M.left} x2={M.left + innerW} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end" className="fill-fg-3 font-mono text-[11px]">
              {formatElo(v)}
            </text>
          </g>
        ))}
        {days.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={M.top} y2={M.top + innerH} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={x(t) + 4} y={height - 8} className="fill-fg-3 text-[11px]">
              {formatDay(new Date(t).toISOString())}
            </text>
          </g>
        ))}

        {series.map((s) => (
          <g key={`finish-${s.id}`}>
            <line
              x1={M.left}
              x2={M.left + innerW}
              y1={y(s.finishElo)}
              y2={y(s.finishElo)}
              stroke={SERIES[s.slot].stroke}
              strokeOpacity={s.finished ? 0.35 : 0.7}
              strokeDasharray="6 5"
              strokeWidth={1}
            />
          </g>
        ))}

        {series.map((s) => {
          if (!s.points.length) return null;
          let d = `M${x(s.points[0].t)} ${y(s.points[0].elo)}`;
          for (let i = 1; i < s.points.length; i++) {
            d += ` H${x(s.points[i].t)} V${y(s.points[i].elo)}`;
          }
          d += ` H${x(end)}`;
          return (
            <g key={s.id}>
              <path d={d} fill="none" stroke={SERIES[s.slot].stroke} strokeWidth={2} strokeLinejoin="round" />
              {s.points.map((p) => (
                <circle key={p.t} cx={x(p.t)} cy={y(p.elo)} r={2.5} fill={SERIES[s.slot].stroke} stroke="var(--panel)" strokeWidth={1.5} />
              ))}
            </g>
          );
        })}

        {!compact &&
          labels.map(({ s, elo, y: ly }) => (
            <g key={`label-${s.id}`}>
              <line x1={x(end)} x2={x(end) + 8} y1={y(elo)} y2={ly} stroke="var(--line-strong)" />
              <circle cx={x(end) + 14} cy={ly} r={4} fill={SERIES[s.slot].stroke} />
              <text x={x(end) + 23} y={ly + 4} className="fill-fg text-[12px] font-medium">
                {s.name}
                <tspan className="fill-fg-2 font-mono" dx={6}>
                  {formatElo(elo)}
                </tspan>
              </text>
            </g>
          ))}

        {hoverT !== null && (
          <g>
            <line x1={x(hoverT)} x2={x(hoverT)} y1={M.top} y2={M.top + innerH} stroke="var(--fg-3)" strokeWidth={1} />
            {hover?.map(({ s, p }) => (
              <circle key={s.id} cx={x(hoverT)} cy={y(p!.elo)} r={4.5} fill={SERIES[s.slot].stroke} stroke="var(--panel)" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect
          x={M.left}
          y={M.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          className="cursor-crosshair"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverT(null)}
        />
      </svg>

      {hoverT !== null && hover && (
        <div
          role="status"
          className="pointer-events-none absolute top-3 z-10 w-52 rounded-md border border-line-strong bg-panel-raised p-2.5 shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
          style={{ left: tipLeft ? x(hoverT) - 216 : x(hoverT) + 12 }}
        >
          <div className="mb-1.5 text-xs text-fg-3">
            {formatDay(new Date(hoverT).toISOString())} · {formatTime(new Date(hoverT).toISOString())} UTC
          </div>
          {hover.length === 0 && <div className="text-xs text-fg-2">No engine measured yet</div>}
          {hover.map(({ s, p }) => (
            <div key={s.id} className="flex items-center gap-2 py-0.5 text-[13px]">
              <span className={cn('size-2 shrink-0 rounded-full', SERIES[s.slot].bg)} />
              <span className="flex-1 text-fg">{s.name}</span>
              <span className="font-mono text-xs text-fg-3">{p!.version}</span>
              <span className="w-12 text-right font-mono tabular text-fg">{formatElo(p!.elo)}</span>
            </div>
          ))}
        </div>
      )}

      <table className="sr-only">
        <caption>Elo after each landed version</caption>
        <thead>
          <tr>
            <th>Track</th>
            <th>Version</th>
            <th>Time (UTC)</th>
            <th>Elo</th>
          </tr>
        </thead>
        <tbody>
          {series.flatMap((s) =>
            s.points.map((p) => (
              <tr key={`${s.id}-${p.t}`}>
                <td>{s.name}</td>
                <td>{p.version}</td>
                <td>{new Date(p.t).toISOString()}</td>
                <td>{Math.round(p.elo)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
};

export { RaceChart };

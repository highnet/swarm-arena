'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Crosshair, History, Square } from 'lucide-react';
import {
  agentNodeId,
  buildSwarmGraph,
  createSwarmGraph,
  type SwarmFlow,
  type SwarmGraphRenderer,
  type SwarmInput,
  type SwarmNode,
  type SwarmReplayState,
  type SwarmStage,
} from '@rallypoint/swarm-graph';
import { Button } from '@/components/ui/Button';
import { Typography } from '@/components/ui/Typography';
import { formatDay, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useFleetHover } from './FleetHover';
import { agentHref } from './seats';

const TICKER = 5;

const FLOW_VERB: Record<SwarmFlow['kind'], string> = {
  plan: 'planned',
  claim: 'claimed',
  progress: 'progress',
  review: 'review',
  merge: 'merged',
  reject: 'rejected',
  milestone: 'milestone',
  protocol: 'protocol',
};

const STAGE_TEXT: Record<SwarmStage, string> = {
  backlog: 'Open issue, claimable',
  held: 'Issue on hold',
  claimed: 'Claimed: worked in its branch',
  review: 'Pull request waiting for review',
  changes: 'Changes requested',
  approved: 'Approved, waiting for the merger',
  merged: 'Merged',
  closed: 'Closed',
};

type Hover = { node: SwarmNode; x: number; y: number; width: number };
type Tick = SwarmFlow & { key: string; source: 'live' | 'replay' };

type NodeCardProps = {
  node: SwarmNode;
};

const NodeCard = ({ node }: NodeCardProps) => {
  if (node.kind === 'agent' && node.agent) {
    const a = node.agent;
    return (
      <>
        <Typography variant="sectionTitle" as="div">
          {node.label}
        </Typography>
        <Typography variant="meta" as="div">
          {a.role} ·{' '}
          {node.active ? 'working now' : `seen ${formatDay(a.lastSeen)} ${formatTime(a.lastSeen)}`}
        </Typography>
        {a.activity && (
          <Typography variant="small" as="div" className="mt-1">
            {a.activity}
          </Typography>
        )}
        <Typography variant="meta" as="div" className="mt-1">
          effort logged{' '}
          <span className="font-mono tabular text-fg-2">{Math.round(node.effort)}</span>
        </Typography>
      </>
    );
  }
  if (node.kind === 'work' && node.workItem) {
    const w = node.workItem;
    return (
      <>
        <Typography variant="sectionTitle" as="div">
          {w.title}
        </Typography>
        <Typography variant="meta" as="div">
          {STAGE_TEXT[w.stage]}
          {w.issue ? ` · issue #${w.issue}` : ''}
          {w.pr ? ` · PR #${w.pr}` : ''}
        </Typography>
        {w.branch && node.phase !== 'issue' && (
          <Typography variant="meta" as="div" className="mt-1 break-all font-mono text-fg-2">
            {w.branch}
          </Typography>
        )}
      </>
    );
  }
  if (node.kind === 'sector' && node.sector) {
    return (
      <>
        <Typography variant="sectionTitle" as="div">
          {node.label}
        </Typography>
        {node.sector.paths && (
          <Typography variant="meta" as="div" className="font-mono">
            {node.sector.paths.join(' ')}
          </Typography>
        )}
        <Typography variant="meta" as="div" className="mt-1">
          effort <span className="font-mono tabular text-fg-2">{Math.round(node.effort)}</span>
          {node.active && <span className="text-good-text"> · live</span>}
        </Typography>
      </>
    );
  }
  return (
    <>
      <Typography variant="sectionTitle" as="div" className="font-mono">
        {node.label}
      </Typography>
      <Typography variant="meta" as="div">
        integration branch · merged effort{' '}
        <span className="font-mono tabular text-fg-2">{Math.round(node.effort)}</span>
      </Typography>
    </>
  );
};

type SwarmGraphProps = {
  input: SwarmInput;
  /** Agent ids with a fleet page; the rest (event-only actors) are not linked. */
  seatIds: string[];
  /** Sector ids with an engine page. */
  engineIds: string[];
  /** Where Rallypoint-only issues and pull requests open. */
  repoUrl: string;
  className?: string;
};

/**
 * The fleet as a live graph: the arena's mount of `@rallypoint/swarm-graph`. The page re-renders
 * on every realtime change (see `LiveIndicator`), so new props here mean new rows in Supabase;
 * the renderer diffs them and animates what changed.
 */
const SwarmGraph = ({ input, seatIds, engineIds, repoUrl, className }: SwarmGraphProps) => {
  const router = useRouter();
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<SwarmGraphRenderer | null>(null);
  const graph = useMemo(() => buildSwarmGraph(input), [input]);
  const [hover, setHover] = useState<Hover | null>(null);
  const [ticker, setTicker] = useState<Tick[]>([]);
  const [replay, setReplay] = useState<SwarmReplayState | null>(null);
  const [replaying, setReplaying] = useState(false);

  // Callbacks read the latest props through a ref so the renderer is created once.
  const { hovered, setHovered } = useFleetHover();
  const links = useRef({
    seatIds: new Set(seatIds),
    engineIds: new Set(engineIds),
    router,
    setHovered,
    repoUrl,
  });
  useEffect(() => {
    links.current = {
      seatIds: new Set(seatIds),
      engineIds: new Set(engineIds),
      router,
      setHovered,
      repoUrl,
    };
  }, [seatIds, engineIds, router, setHovered, repoUrl]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const r = createSwarmGraph(el, {
      title: 'Agents and the sectors of the codebase they are working in',
      reducedMotion: reduced,
      onHover: (node, point) => {
        setHover(node && point ? { node, ...point, width: el.clientWidth } : null);
        // Mirror the graph's hover onto the fleet's cards.
        const id = node?.kind === 'agent' ? node.agent?.id : undefined;
        links.current.setHovered((h) =>
          id ? { agentId: id, source: 'graph' } : h?.source === 'graph' ? null : h,
        );
      },
      onSelect: (node) => {
        const { seatIds: seats, engineIds: engines, router: nav } = links.current;
        if (node.kind === 'agent' && node.agent && seats.has(node.agent.id))
          nav.push(agentHref(node.agent.id));
        else if (node.kind === 'work' && node.workItem) {
          const w = node.workItem;
          // Arena tasks have a page; Rallypoint-only work opens on GitHub.
          if (!w.id.startsWith('gh-')) nav.push(`/tasks/${encodeURIComponent(w.id)}`);
          else if (w.pr ?? w.issue)
            window.open(
              `${links.current.repoUrl}/${w.pr ? 'pull' : 'issues'}/${w.pr ?? w.issue}`,
              '_blank',
              'noopener',
            );
        } else if (node.kind === 'sector' && node.sectorId && engines.has(node.sectorId))
          nav.push(`/engines/${node.sectorId}`);
      },
      onFlow: (flow, source) =>
        setTicker((t) =>
          [{ ...flow, source, key: `${source}-${flow.id}-${Date.now()}` }, ...t].slice(0, TICKER),
        ),
      onReplay: (state) => {
        setReplay(state);
        if (!state) setReplaying(false);
      },
    });
    renderer.current = r;
    return () => {
      r.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    renderer.current?.update(graph);
  }, [graph]);

  // A card under the pointer lights up its agent's node.
  const fromCard = hovered?.source === 'card' ? hovered.agentId : null;
  useEffect(() => {
    renderer.current?.highlight(fromCard ? agentNodeId(fromCard) : null);
  }, [fromCard, graph]);

  const sectors = graph.nodes.filter((n) => n.kind === 'sector');
  const startReplay = () => {
    setTicker([]);
    setReplaying(true);
    renderer.current?.replay(Math.min(45_000, Math.max(15_000, graph.flows.length * 250)));
  };
  const stopReplay = () => {
    renderer.current?.stopReplay();
    setReplaying(false);
  };

  return (
    <section
      data-slot="swarm-graph"
      className={cn('relative overflow-hidden rounded-lg border border-line bg-panel', className)}
    >
      <div className="swarm-graph-ground pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <Typography variant="sectionTitle">Swarm graph</Typography>
          <Typography variant="meta">
            Rallypoint, live: issues are claimed into <span className="font-mono">agent/</span>{' '}
            branches forked from{' '}
            <span className="font-mono text-fg-2">{input.integrationBranch}</span>, worked in
            worktrees, opened as pull requests, reviewed, and merged back into the sector they
            change.
          </Typography>
        </div>
        <div className="flex items-center gap-1.5">
          {replaying ? (
            <Button size="sm" onClick={stopReplay}>
              <Square className="size-3.5" aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={startReplay} disabled={graph.flows.length === 0}>
              <History className="size-3.5" aria-hidden="true" />
              Replay run
            </Button>
          )}
          <Button
            variant="icon"
            size="icon"
            onClick={() => renderer.current?.reset()}
            aria-label="Recentre graph"
            title="Recentre"
          >
            <Crosshair className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="relative">
        <div ref={host} className="h-120 w-full sm:h-150" />

        {replay && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="rounded-md border border-line bg-panel-raised px-3 py-1.5 text-xs text-fg-2 shadow-lg">
              Replaying ·{' '}
              <span className="font-mono tabular text-fg">
                {formatDay(replay.at)} {formatTime(replay.at)}
              </span>
              <span className="text-fg-3">
                {' '}
                · {replay.index}/{replay.total}
              </span>
              <div className="mt-1 h-0.5 w-full overflow-hidden rounded bg-line">
                <div
                  className="h-full bg-fg-2 transition-[width] duration-200"
                  style={{ width: `${(replay.index / replay.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {ticker.length > 0 && (
          <ol
            className="pointer-events-none absolute bottom-3 left-3 max-w-[min(22rem,calc(100%-1.5rem))] space-y-1"
            aria-live="polite"
          >
            {ticker.map((t, i) => (
              <li
                key={t.key}
                className={cn(
                  'flex items-baseline gap-2 truncate rounded-md border border-line bg-panel-raised/90 px-2 py-1 text-xs animate-record-in',
                  i > 0 && 'opacity-70',
                )}
              >
                <span
                  className={cn(
                    'shrink-0 font-mono text-[10px] uppercase tracking-[0.15em]',
                    t.kind === 'merge' && 'text-good-text',
                    t.kind === 'reject' && 'text-critical-text',
                    t.kind !== 'merge' && t.kind !== 'reject' && 'text-fg-3',
                  )}
                >
                  {FLOW_VERB[t.kind]}
                </span>
                <span className="truncate text-fg-2">{t.title}</span>
              </li>
            ))}
          </ol>
        )}

        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 -translate-y-full rounded-md border border-line-strong bg-panel-raised px-3 py-2 shadow-xl"
            style={{
              left: Math.max(136, Math.min(hover.x, hover.width - 136)),
              top: hover.y - 14,
            }}
          >
            <NodeCard node={hover.node} />
          </div>
        )}
      </div>

      <ul className="relative flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-4 py-2.5 text-xs text-fg-3">
        {sectors.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ background: s.color ?? undefined }}
              aria-hidden="true"
            />
            <span className={cn(s.active && 'text-fg')}>{s.label}</span>
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 sm:ml-auto">
          <span className="size-2.5 rounded-full border border-fg-2" aria-hidden="true" /> agent
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-full border border-dashed border-fg-3"
            aria-hidden="true"
          />{' '}
          issue
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rotate-45 border border-fg-2" aria-hidden="true" /> branch
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-fg-2 bg-fg-3/30" aria-hidden="true" />{' '}
          pull request
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-fg-3/60" aria-hidden="true" /> merged
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-px w-4 bg-fg-3" aria-hidden="true" /> past effort
        </li>
        <li className="font-mono tabular">
          {graph.totals.live} live · {graph.totals.branches} branch
          {graph.totals.branches === 1 ? '' : 'es'} · {graph.totals.pullRequests} PR
          {graph.totals.pullRequests === 1 ? '' : 's'}
        </li>
      </ul>
    </section>
  );
};

export { SwarmGraph };

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentNodeId, buildSwarmGraph, sectorNodeId, workNodeId, type SwarmInput } from './model';

const asOf = '2026-11-23T12:00:00Z';

const input = (): SwarmInput => ({
  integrationBranch: 'main',
  asOf,
  sectors: [
    { id: 'chess', label: 'Chess' },
    { id: 'go', label: 'Go' },
  ],
  workItems: [
    { id: 't1', sector: 'chess', title: 'Search', status: 'claimed' },
    {
      id: 't0',
      sector: 'chess',
      title: 'Rules',
      status: 'merged',
      at: '2026-11-23T09:00:00Z',
    },
    {
      id: 'old',
      sector: 'chess',
      title: 'Old',
      status: 'merged',
      at: '2026-11-22T09:00:00Z',
    },
  ],
  agents: [
    {
      id: 'w',
      role: 'worker',
      status: 'working',
      sector: null,
      workItem: 't1',
      lastSeen: asOf,
    },
    {
      id: 'r',
      role: 'reviewer',
      status: 'idle',
      sector: null,
      lastSeen: '2026-11-23T11:00:00Z',
    },
    {
      id: 'gone',
      role: 'worker',
      status: 'idle',
      sector: null,
      lastSeen: '2026-11-20T11:00:00Z',
    },
  ],
  events: [
    {
      id: 'e2',
      at: '2026-11-23T11:30:00Z',
      kind: 'merge',
      agent: 'r',
      sector: null,
      workItem: 't0',
      title: 'merged',
    },
    {
      id: 'e1',
      at: '2026-11-23T11:00:00Z',
      kind: 'progress',
      agent: 'w',
      sector: 'go',
      workItem: null,
      title: 'go work',
    },
    {
      id: 'e3',
      at: '2026-11-23T11:40:00Z',
      kind: 'milestone',
      agent: 'referee',
      sector: 'chess',
      workItem: null,
      title: 'cleared',
    },
  ],
});

test('live agent ties to its work item, which ties to its sector', () => {
  const g = buildSwarmGraph(input());
  const assign = g.links.find((l) => l.id === 'assign:w');
  assert.equal(assign?.target, workNodeId('t1'));
  assert.equal(assign?.active, true);
  assert.ok(g.nodes.find((n) => n.id === sectorNodeId('chess'))?.active);
  assert.ok(!g.nodes.find((n) => n.id === sectorNodeId('go'))?.active);
});

test('effort elsewhere shows as a contribution link', () => {
  const g = buildSwarmGraph(input());
  const c = g.links.find((l) => l.id === 'contrib:w:go');
  assert.equal(c?.target, sectorNodeId('go'));
  assert.equal(c?.weight, 1);
});

test('stale agents drop out; event-only actors appear', () => {
  const g = buildSwarmGraph(input());
  assert.ok(!g.nodes.some((n) => n.id === agentNodeId('gone')));
  assert.ok(g.nodes.some((n) => n.id === agentNodeId('referee')));
  // A gate role with no sector waits by the integration branch.
  assert.equal(g.links.find((l) => l.id === 'assign:r')?.target, g.hubId);
});

test('merged history is capped per sector and merges flow to the hub', () => {
  const g = buildSwarmGraph(input(), { mergedPerSector: 1 });
  assert.ok(g.nodes.some((n) => n.id === workNodeId('t0')));
  assert.ok(!g.nodes.some((n) => n.id === workNodeId('old')));
  const merge = g.flows.find((f) => f.id === 'e2');
  assert.equal(merge?.from, workNodeId('t0'));
  assert.equal(merge?.to, g.hubId);
  assert.deepEqual(
    g.flows.map((f) => f.id),
    ['e1', 'e2', 'e3'],
  );
});

test('sector effort sums event weights', () => {
  const g = buildSwarmGraph(input());
  // merge (3) + milestone (2) in chess.
  assert.equal(g.nodes.find((n) => n.id === sectorNodeId('chess'))?.effort, 5);
  assert.equal(g.totals.live, 1);
});

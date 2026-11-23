import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentNodeId,
  buildSwarmGraph,
  rallypointBranch,
  sectorNodeId,
  workNodeId,
  type SwarmInput,
} from './model';

const asOf = '2026-11-23T12:00:00Z';

const input = (): SwarmInput => ({
  integrationBranch: 'main',
  asOf,
  sectors: [
    { id: 'chess', label: 'Chess' },
    { id: 'go', label: 'Go' },
  ],
  workItems: [
    {
      id: 'b',
      sector: 'chess',
      title: 'Search',
      stage: 'claimed',
      issue: 29,
      branch: 'agent/29-search',
    },
    { id: 'p', sector: 'go', title: 'MCTS', stage: 'approved', issue: 30, pr: 40 },
    { id: 'i', sector: 'go', title: 'Ladders', stage: 'backlog', issue: 31 },
    { id: 'm1', sector: 'chess', title: 'Rules', stage: 'merged', at: '2026-11-23T09:00:00Z' },
    { id: 'm0', sector: 'chess', title: 'Old', stage: 'merged', at: '2026-11-22T09:00:00Z' },
    { id: 'x', sector: 'chess', title: 'Dead end', stage: 'closed' },
  ],
  agents: [
    { id: 'w', role: 'worker', status: 'working', sector: null, workItem: 'b', lastSeen: asOf },
    { id: 'r', role: 'reviewer', status: 'working', sector: null, pr: 40, lastSeen: asOf },
    { id: 'm', role: 'merger', status: 'idle', sector: null, lastSeen: '2026-11-23T11:00:00Z' },
    { id: 'gone', role: 'worker', status: 'idle', sector: null, lastSeen: '2026-11-20T11:00:00Z' },
  ],
  events: [
    {
      id: 'e3',
      at: '2026-11-23T11:30:00Z',
      kind: 'merge',
      agent: 'm',
      sector: null,
      workItem: 'm1',
      title: 'merged',
    },
    {
      id: 'e1',
      at: '2026-11-23T11:00:00Z',
      kind: 'progress',
      agent: 'w',
      sector: null,
      workItem: 'b',
      title: 'commit',
    },
    {
      id: 'e2',
      at: '2026-11-23T11:10:00Z',
      kind: 'claim',
      agent: 'w',
      sector: null,
      workItem: 'b',
      title: 'claimed',
    },
    {
      id: 'e4',
      at: '2026-11-23T11:40:00Z',
      kind: 'milestone',
      agent: 'referee',
      sector: 'go',
      workItem: 'p',
      title: 'gate',
    },
    {
      id: 'e5',
      at: '2026-11-23T11:50:00Z',
      kind: 'progress',
      agent: 'w',
      sector: 'go',
      workItem: null,
      title: 'elsewhere',
    },
  ],
});

const link = (g: ReturnType<typeof buildSwarmGraph>, id: string) =>
  g.links.find((l) => l.id === id);
const node = (g: ReturnType<typeof buildSwarmGraph>, id: string) =>
  g.nodes.find((n) => n.id === id);

test('branch names match claim.mjs', () => {
  // The head ref of a real Rallypoint pull request in this repository.
  assert.equal(
    rallypointBranch(28, 'Negamax alpha-beta with iterative deepening inside the go budget'),
    'agent/28-negamax-alpha-beta-with-iterative-deepenin',
  );
});

test('stages draw as issue, branch, pull request and landed; closed work drops out', () => {
  const g = buildSwarmGraph(input());
  assert.equal(node(g, workNodeId('i'))?.phase, 'issue');
  assert.equal(node(g, workNodeId('b'))?.phase, 'branch');
  assert.equal(node(g, workNodeId('b'))?.label, 'agent/29-search');
  assert.equal(node(g, workNodeId('p'))?.phase, 'pr');
  assert.equal(node(g, workNodeId('p'))?.label, '#40');
  assert.equal(node(g, workNodeId('m1'))?.phase, 'landed');
  assert.ok(!node(g, workNodeId('x')));
  assert.equal(g.totals.branches, 1);
  assert.equal(g.totals.pullRequests, 1);
});

test('branches and pull requests fork from the integration branch; issues only target a sector', () => {
  const g = buildSwarmGraph(input());
  assert.equal(link(g, 'fork:b')?.source, g.hubId);
  assert.equal(link(g, 'fork:b')?.active, true);
  assert.equal(link(g, 'scope:b')?.target, sectorNodeId('chess'));
  assert.equal(link(g, 'target:i')?.target, sectorNodeId('go'));
  assert.ok(!link(g, 'fork:i'));
  assert.equal(link(g, 'landed:m1')?.target, sectorNodeId('chess'));
});

test('agents sit where the protocol puts them', () => {
  const g = buildSwarmGraph(input());
  // A worker is in its branch's worktree, not on the integration branch.
  assert.equal(link(g, 'assign:w')?.target, workNodeId('b'));
  // A reviewer is on the pull request it judges.
  assert.equal(link(g, 'assign:r')?.target, workNodeId('p'));
  // A merger with nothing to merge waits at the integration branch.
  assert.equal(link(g, 'assign:m')?.target, g.hubId);
  assert.ok(!node(g, agentNodeId('gone')));
  assert.ok(node(g, agentNodeId('referee')));
});

test('only merges reach the integration branch, and land in their sector', () => {
  const g = buildSwarmGraph(input());
  const byId = new Map(g.flows.map((f) => [f.id, f]));
  assert.deepEqual(byId.get('e3')?.path, [workNodeId('m1'), g.hubId, sectorNodeId('chess')]);
  assert.deepEqual(byId.get('e1')?.path, [agentNodeId('w'), workNodeId('b')]);
  assert.deepEqual(byId.get('e2')?.path, [g.hubId, workNodeId('b')]);
  assert.deepEqual(byId.get('e4')?.path, [agentNodeId('referee'), workNodeId('p')]);
  for (const f of g.flows)
    if (f.kind !== 'merge') assert.notEqual(f.path.at(-1), g.hubId, `${f.id} ends on main`);
  assert.deepEqual(
    g.flows.map((f) => f.id),
    ['e1', 'e2', 'e3', 'e4', 'e5'],
  );
});

test('merged history is capped per sector; effort is summed per sector', () => {
  const g = buildSwarmGraph(input(), { mergedPerSector: 1 });
  assert.ok(node(g, workNodeId('m1')));
  assert.ok(!node(g, workNodeId('m0')));
  // merge (3) + progress (1) + claim (1) on chess.
  assert.equal(node(g, sectorNodeId('chess'))?.effort, 5);
  assert.equal(node(g, g.hubId)?.effort, 3);
  assert.equal(link(g, 'contrib:w:go')?.weight, 1);
});

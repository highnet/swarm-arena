import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentNodeId,
  buildSwarmGraph,
  hubNodeId,
  LIFETIMES,
  lifeOf,
  sectorNodeId,
  workNodeId,
  type SwarmInput,
} from './model';

const T0 = Date.parse('2026-11-24T12:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

/** An agent that ended and an item that merged at T0, a branch last touched at T0. */
const input = (): SwarmInput => ({
  integrationBranch: 'main',
  asOf: at(0),
  sectors: [
    { id: 'chess', label: 'Chess' },
    { id: 'site', label: 'Site' },
  ],
  workItems: [
    { id: 'm', sector: 'chess', title: 'Rules', stage: 'merged', at: at(0) },
    { id: 'b', sector: 'chess', title: 'Search', stage: 'claimed', issue: 9, at: at(0) },
    { id: 'held', sector: 'chess', title: 'Eval', stage: 'claimed', issue: 10, at: at(-600) },
    { id: 'pr', sector: 'chess', title: 'Book', stage: 'review', pr: 11, at: at(-600) },
    { id: 'i', sector: 'chess', title: 'Idea', stage: 'backlog', issue: 12, at: at(-600) },
  ],
  agents: [
    { id: 'done', role: 'worker', status: 'idle', sector: 'chess', workItem: 'm', lastSeen: at(0) },
    { id: 'live', role: 'worker', status: 'working', sector: null, workItem: 'held', lastSeen: at(-600) },
  ],
  events: [],
});

const ids = (minutes: number, lifetimes = LIFETIMES.live) =>
  buildSwarmGraph(input(), { lifetimes, now: at(minutes) }).nodes;

test('lifeOf: alive, then fading, then gone', () => {
  assert.equal(lifeOf(0, 10, 3), 'alive');
  assert.equal(lifeOf(6, 10, 3), 'alive');
  assert.equal(lifeOf(8, 10, 3), 'fading');
  assert.equal(lifeOf(10, 10, 3), 'fading');
  assert.equal(lifeOf(11, 10, 3), 'gone');
  assert.equal(lifeOf(Number.NaN, 10, 3), 'gone');
});

test('an ended agent dims near 10 minutes and is gone after', () => {
  const find = (m: number) => ids(m).find((n) => n.id === agentNodeId('done'));
  assert.ok(find(5));
  assert.ok(!find(5)!.fading);
  assert.equal(find(8)?.fading, true);
  assert.equal(find(11), undefined);
});

test('a merged item and an abandoned branch leave after about an hour', () => {
  const has = (m: number, id: string) => ids(m).some((n) => n.id === workNodeId(id));
  assert.ok(has(30, 'm'));
  assert.ok(has(30, 'b'));
  assert.equal(ids(58).find((n) => n.id === workNodeId('m'))?.fading, true);
  assert.ok(!has(61, 'm'));
  assert.ok(!has(61, 'b'));
});

test('sectors, the hub, open PRs, issues and branches a live seat holds never leave', () => {
  const nodes = ids(24 * 60);
  for (const id of [
    hubNodeId('main'),
    sectorNodeId('chess'),
    sectorNodeId('site'),
    workNodeId('held'),
    workNodeId('pr'),
    workNodeId('i'),
    agentNodeId('live'),
  ])
    assert.ok(
      nodes.some((n) => n.id === id),
      id,
    );
});

test('an event on a branch counts as activity', () => {
  const i = input();
  i.events.push({
    id: 'e',
    at: at(50),
    kind: 'progress',
    agent: null,
    sector: null,
    workItem: 'b',
    title: 'commit',
  });
  const g = buildSwarmGraph(i, { lifetimes: LIFETIMES.live, now: at(100) });
  assert.ok(g.nodes.some((n) => n.id === workNodeId('b')));
});

test('the Everything lifetimes keep dead nodes for hours', () => {
  const nodes = ids(3 * 60, LIFETIMES.everything);
  assert.ok(nodes.some((n) => n.id === agentNodeId('done')));
  assert.ok(nodes.some((n) => n.id === workNodeId('m')));
  assert.ok(!ids(7 * 60, LIFETIMES.everything).some((n) => n.id === workNodeId('m')));
});

test('without lifetimes nothing extra is pruned', () => {
  const g = buildSwarmGraph(input(), { now: at(120) });
  assert.ok(g.nodes.some((n) => n.id === agentNodeId('done')));
  assert.ok(g.nodes.some((n) => n.id === workNodeId('m')));
});

test('a sector carries its host count unchanged', () => {
  const i = input();
  i.sectors[1].count = { value: 48, unit: 'merged', recent: 3, recentUnit: 'today' };
  const s = buildSwarmGraph(i).nodes.find((n) => n.id === sectorNodeId('site'));
  assert.deepEqual(s?.sector?.count, { value: 48, unit: 'merged', recent: 3, recentUnit: 'today' });
});

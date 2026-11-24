import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Agent, Snapshot, Task } from '@arena/shared';
import { Fleet } from '@/components/arena/SidePanels';
import { RightNow } from '@/components/arena/RightNow';
import { STALE_MS, STALE_TITLE, liveAgents } from '@/components/arena/seats';
import { counters, trackSummaries } from './derive';
import type { RpItem } from './github';
import { toSwarmInput } from './swarmGraph';
import { snapshotAsOf, workingCount, workingIds, workingNow } from './working';

const AS_OF = '2026-11-24T16:14:00.000Z';
const ago = (min: number) => new Date(Date.parse(AS_OF) - min * 60_000).toISOString();

const seat = (id: string, patch: Partial<Agent>): Agent => ({
  id,
  run_id: 'r',
  seat: id,
  track_id: null,
  role: 'builder',
  status: 'idle',
  last_seen: ago(1),
  sessions: 1,
  ...patch,
});

const task = (id: string, patch: Partial<Task>): Task => ({
  id,
  run_id: 'r',
  track_id: 'chess',
  title: `Task ${id}`,
  spec: '',
  type: 'search',
  status: 'open',
  claimed_by: null,
  created_at: ago(120),
  closed_at: null,
  ...patch,
});

const item = (number: number, title: string, isPR = false): RpItem => ({
  number,
  title,
  url: `https://github.com/x/y/${isPR ? 'pull' : 'issues'}/${number}`,
  isPR,
  state: 'open',
  merged: false,
  draft: false,
  labels: ['status:claimed'],
  createdAt: ago(60),
  updatedAt: ago(5),
  closedAt: null,
  mergedAt: null,
  arenaTask: null,
  closes: null,
  comments: 0,
});

const snapshot = (agents: Agent[], tasks: Task[] = []) =>
  ({
    run: { id: 'r', label: 'r', started_at: ago(600) },
    tracks: [
      {
        id: 'chess',
        run_id: 'r',
        name: 'Chess',
        color_slot: 1,
        current_elo: null,
        current_version: null,
      },
    ],
    rungs: [],
    agents,
    tasks,
    records: [],
    matches: [],
    games: [],
    elo: [],
    messages: [],
    asOf: AS_OF,
  }) as Snapshot;

// The 16:14 report: four sessions, none on an arena task, plus a stale seat and an idle one.
const rpOnly = snapshot(
  [
    seat('worker', { status: 'working', rp_role: 'worker', activity: 'Working issue #197' }),
    seat('worker-2', { status: 'working', rp_role: 'worker', activity: 'Working issue #199' }),
    seat('reviewer', { status: 'working', rp_role: 'reviewer', pr: 210 }),
    seat('strategist', { status: 'working', rp_role: 'planner', activity: 'Planning' }),
    seat('merger', { status: 'working', rp_role: 'merger', last_seen: ago(STALE_MS / 60_000 + 5) }),
    seat('fixer', { status: 'idle' }),
  ],
  [task('t1', { status: 'open', title: 'Queued chess task' })],
);
const rp = [item(197, 'Fold held rows'), item(199, 'Stale agents'), item(210, 'fix: x', true)];

const render = (s: Snapshot, items: RpItem[] = []) =>
  renderToStaticMarkup(
    createElement(RightNow, { s, working: workingNow(s, items), slots: { chess: 1 } }),
  );

test('(a) live agents on Rallypoint work only, no claimed arena task: listed with their work, not "Nobody"', () => {
  const html = render(rpOnly, rp);
  assert.doesNotMatch(html, /Nobody is working/);
  assert.match(html, /4 agents are working now/);
  assert.match(html, /#197/);
  assert.match(html, /Fold held rows/);
  assert.match(html, /PR (<!-- -->)?#(<!-- -->)?210/);
  assert.match(html, /Reviewer/);
  assert.match(html, /Planner/);
  assert.doesNotMatch(html, /Up next/);
});

test('(b) no live agents: "Nobody is working right now" and "Up next"', () => {
  const quiet = snapshot(
    rpOnly.agents.map((a) => ({ ...a, status: 'idle' as const })),
    rpOnly.tasks,
  );
  const html = render(quiet, rp);
  assert.match(html, /Nobody is working right now/);
  assert.match(html, /Up next/);
  assert.match(html, /Queued chess task/);
});

test('(c) a stale working seat does not count, and its tooltip comes from STALE_MS', () => {
  assert.equal(workingIds(rpOnly).has('merger'), false);
  assert.equal(workingCount(rpOnly), 4);
  assert.match(STALE_TITLE, new RegExp(`${STALE_MS / 60_000} minutes`));
});

test('every surface reports the same set for the same snapshot', () => {
  const ids = [...workingIds(rpOnly)].sort();
  assert.deepEqual(ids, ['reviewer', 'strategist', 'worker', 'worker-2']);
  // Right now panel and fleet page list (both read workingNow).
  assert.deepEqual(
    workingNow(rpOnly, rp)
      .map((w) => w.agent.id)
      .sort(),
    ids,
  );
  // Home stats tile and the site header (counters / workingCount).
  assert.equal(counters(rpOnly).working, ids.length);
  // The fleet panel's "N of M at work".
  assert.match(
    renderToStaticMarkup(
      createElement(Fleet, { agents: rpOnly.agents, asOf: snapshotAsOf(rpOnly), slots: {} }),
    ),
    new RegExp(`${ids.length} of ${rpOnly.agents.length} at work`),
  );
  // The fleet graph's agent nodes.
  const graph = toSwarmInput(rpOnly, rp).input.agents;
  assert.deepEqual(
    graph
      .filter((a) => a.status === 'working')
      .map((a) => a.id)
      .sort(),
    ids,
  );
});

test('one clock: without asOf every surface reads the newest instant in the snapshot', () => {
  const noAsOf: Snapshot = { ...rpOnly, asOf: undefined };
  const asOf = snapshotAsOf(noAsOf);
  assert.equal(asOf, ago(1));
  assert.deepEqual(
    [...workingIds(noAsOf)].sort(),
    liveAgents(noAsOf.agents, asOf)
      .map((a) => a.id)
      .sort(),
  );
  assert.equal(
    toSwarmInput(noAsOf).input.agents.filter((a) => a.status === 'working').length,
    workingCount(noAsOf),
  );
});

test('an engine is at work only while a live seat is on one of its tasks', () => {
  const s = snapshot(
    [
      seat('chess-builder', {
        status: 'working',
        task_id: 't2',
        last_seen: ago(STALE_MS / 60_000 + 1),
      }),
    ],
    [task('t2', { status: 'claimed', claimed_by: 'chess-builder' })],
  );
  assert.equal(trackSummaries(s)[0].atWork, false);
  const live = snapshot([{ ...s.agents[0], last_seen: ago(2) }], s.tasks);
  assert.equal(trackSummaries(live)[0].atWork, true);
  assert.equal(workingNow(live)[0].work?.kind, 'task');
});

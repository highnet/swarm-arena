/**
 * Rallypoint's GitHub read (#233): every open item counts, however long ago it was last touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineReads, stageOf, type RawIssue } from './github';

const raw = (number: number, updated: string, extra: Partial<RawIssue> = {}): RawIssue => ({
  number,
  title: `#${number}`,
  html_url: `https://github.com/x/y/issues/${number}`,
  state: 'open',
  labels: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: updated,
  closed_at: null,
  body: null,
  comments: 0,
  ...extra,
});

test('stale open issues and recent closed ones are both kept, once, newest first', () => {
  const open = [raw(1, '2026-01-02T00:00:00Z'), raw(40, '2026-11-20T00:00:00Z')];
  const closed = [
    raw(50, '2026-11-25T00:00:00Z', {
      state: 'closed',
      pull_request: { merged_at: '2026-11-25T00:00:00Z' },
    }),
    raw(40, '2026-11-20T00:00:00Z'),
    raw(60, '2026-11-24T00:00:00Z', {
      state: 'closed',
      labels: [{ name: 'autorelease: tagged' }],
      pull_request: { merged_at: '2026-11-24T00:00:00Z' },
    }),
  ];
  const items = combineReads(open, closed);
  assert.deepEqual(
    items.map((i) => i.number),
    [50, 40, 1],
  );
  assert.deepEqual(items.map(stageOf), ['merged', 'backlog', 'backlog']);
});

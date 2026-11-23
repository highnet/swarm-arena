import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildThreads,
  mentionsOf,
  normalizeTags,
  parseRef,
  parseRefs,
  segmentText,
  threadTitle,
  type Message,
} from './index';

test('discussion: parses thread, pr, issue and bare references', () => {
  assert.deepEqual(
    parseRefs('See msg#4, PR #12 and issue#9; also #12 and thread#4 again. C#1 is not one.'),
    [
      { kind: 'message', n: 4 },
      { kind: 'pr', n: 12 },
      { kind: 'issue', n: 9 },
    ],
  );
  assert.deepEqual(parseRefs('bare #7 then https://github.com/highnet/swarm-arena/pull/8'), [
    { kind: 'github', n: 7 },
    { kind: 'pr', n: 8 },
  ]);
  assert.deepEqual(parseRefs('#7 later named pr#7'), [{ kind: 'pr', n: 7 }]);
  assert.deepEqual(parseRefs('retros #42/#51'), [
    { kind: 'github', n: 42 },
    { kind: 'github', n: 51 },
  ]);
  assert.deepEqual(parseRef('42'), { kind: 'message', n: 42 });
  assert.deepEqual(parseRef('pr#3'), { kind: 'pr', n: 3 });
});

test('discussion: segments keep the text intact', () => {
  const text = 'fix in pr#3, see msg#2.';
  const segs = segmentText(text);
  assert.equal(segs.map((s) => s.text).join(''), text);
  assert.equal(segs.filter((s) => 'ref' in s).length, 2);
});

test('discussion: tags are normalised slugs', () => {
  assert.deepEqual(normalizeTags('Search, #time management,search,, chess/eval'), [
    'search',
    'time-management',
    'chess/eval',
  ]);
  assert.throws(() => normalizeTags('a,b,c,d,e,f,g,h,i'));
});

const msg = (id: number, at: string, extra: Partial<Message> = {}): Message => ({
  id,
  run_id: 'r',
  at,
  agent_id: `a${id}`,
  track_id: null,
  reply_to: null,
  kind: 'note',
  body: `message ${id}`,
  ...extra,
});

test('discussion: rows without stored refs fall back to their text', () => {
  const old = msg(9, '2026-01-01T00:00:00Z', { body: 'see pr#4' });
  delete old.refs;
  assert.deepEqual(buildThreads([old])[0].refs, [{ kind: 'pr', n: 4 }]);
});

test('discussion: threads gather nested comments, refs and backlinks', () => {
  const ms = [
    msg(1, '2026-01-01T00:00:00Z', { kind: 'question', title: 'TT size?' }),
    msg(2, '2026-01-01T01:00:00Z', { reply_to: 1, kind: 'comment' }),
    msg(3, '2026-01-01T02:00:00Z', {
      reply_to: 2,
      kind: 'comment',
      refs: [{ kind: 'pr', n: 5 }],
    }),
    msg(4, '2026-01-01T00:30:00Z', { refs: [{ kind: 'message', n: 2 }] }),
  ];
  const [first, second] = buildThreads(ms);
  assert.equal(first.root.id, 1);
  assert.deepEqual(
    first.comments.map((c) => c.id),
    [2, 3],
  );
  assert.equal(first.lastAt, '2026-01-01T02:00:00Z');
  assert.deepEqual(first.participants, ['a1', 'a2', 'a3']);
  assert.deepEqual(first.refs, [{ kind: 'pr', n: 5 }]);
  assert.deepEqual(first.backlinks, [4]);
  assert.equal(second.root.id, 4);
  assert.equal(threadTitle(first.root), 'TT size?');
  assert.equal(threadTitle(second.root), 'message 4');
  assert.deepEqual(
    mentionsOf(ms, 5).map((m) => m.id),
    [3],
  );
});

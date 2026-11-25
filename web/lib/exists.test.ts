/**
 * The existence probes Proxy runs before a detail page renders (#268): each mirrors its page's
 * own lookup, so "missing" is exactly a page that would render the not-found UI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATIC_SIBLINGS, probeFor, probeQuery, type Probe, type RowProbe } from './exists';

const row = (p: Probe | null): RowProbe => {
  assert.ok(p && p.kind === 'row', `expected a row probe, got ${JSON.stringify(p)}`);
  return p;
};

test('paths that are not detail routes are left alone', () => {
  for (const path of ['/', '/games', '/fleet', '/engines', '/news/a-story', '/games/a/b']) {
    assert.equal(probeFor(path), null, path);
  }
});

test('engine routes are decided without a read', () => {
  assert.deepEqual(probeFor('/engines/chess'), { kind: 'known', exists: true });
  assert.deepEqual(probeFor('/engines/hex/play'), { kind: 'known', exists: true });
  assert.deepEqual(probeFor('/engines/nope'), { kind: 'known', exists: false });
  assert.deepEqual(probeFor('/engines/nope/play'), { kind: 'known', exists: false });
  assert.deepEqual(probeFor('/engines/nope/ladder/0'), { kind: 'known', exists: false });
  assert.deepEqual(probeFor('/engines/chess/ladder/top'), { kind: 'known', exists: false });
});

test('a ladder rung reads its row in the run, and falls back to the reference ladder', () => {
  const p = row(probeFor('/engines/chess/ladder/1'));
  assert.equal(
    probeQuery(p, 'run-001'),
    'rungs?select=id&track_id=eq.chess&position=eq.1&run_id=eq.run-001&limit=1',
  );
  assert.equal(p.offline, true);
  assert.equal(row(probeFor('/engines/chess/ladder/999')).offline, false);
});

test('a game is read by id in any run, as getGame does; ids are decoded once', () => {
  const p = row(probeFor('/games/run-001-chess-abc-g1'));
  assert.equal(probeQuery(p, 'run-001'), 'games?select=id&id=eq.run-001-chess-abc-g1&limit=1');
  assert.equal(
    probeQuery(row(probeFor('/games/a%20b')), null),
    'games?select=id&id=eq.a%20b&limit=1',
  );
  assert.deepEqual(probeFor('/games/%E0%A4%A'), { kind: 'known', exists: false });
});

test('matches, seats and tasks are read in the current run', () => {
  assert.equal(
    probeQuery(row(probeFor('/matches/m1')), 'r'),
    'matches?select=id&id=eq.m1&run_id=eq.r&limit=1',
  );
  assert.equal(
    probeQuery(row(probeFor('/fleet/chess-builder')), 'r'),
    'agents?select=id&id=eq.chess-builder&run_id=eq.r&limit=1',
  );
  assert.equal(
    probeQuery(row(probeFor('/tasks/t1')), 'r'),
    'tasks?select=id&id=eq.t1&run_id=eq.r&limit=1',
  );
});

test('records, buried ideas and threads take numeric ids, as their pages compare them', () => {
  assert.equal(
    probeQuery(row(probeFor('/board/12')), 'r'),
    'records?select=id&id=eq.12&run_id=eq.r&limit=1',
  );
  assert.equal(
    probeQuery(row(probeFor('/graveyard/12')), 'r'),
    'records?select=id&id=eq.12&kind=eq.idea_dead&run_id=eq.r&limit=1',
  );
  assert.equal(
    probeQuery(row(probeFor('/messages/12')), 'r'),
    'messages?select=id&id=eq.12&run_id=eq.r&limit=1',
  );
  for (const path of ['/board/abc', '/board/012', '/graveyard/1.5', '/messages/x']) {
    assert.deepEqual(probeFor(path), { kind: 'known', exists: false }, path);
  }
  // The thread page reads `Number(id)`, so a padded id still names the thread.
  row(probeFor('/messages/012'));
});

test('a version is a landed patch whose title starts with it', () => {
  const p = row(probeFor('/versions/chess/v0.4'));
  assert.equal(
    probeQuery(p, 'r'),
    'records?select=title&kind=eq.patch_landed&track_id=eq.chess&title=like.v0.4*&run_id=eq.r&limit=50',
  );
  assert.equal(p.accept?.([{ title: 'v0.4 shipped: quiescence' }]), true);
  assert.equal(p.accept?.([{ title: 'v0.41 shipped: more' }]), false);
  assert.deepEqual(probeFor('/versions/nope/v0.4'), { kind: 'known', exists: false });
  // A version PostgREST's pattern cannot carry safely is left to the page.
  assert.equal(probeFor('/versions/chess/v*'), null);
});

test('static routes beside an id are not read as ids (#270)', () => {
  assert.equal(probeFor('/games/download'), null);
  assert.equal(probeFor('/games/download/'), null);
  // Only the exact segment: a game id that merely starts with it is still probed.
  assert.equal(row(probeFor('/games/downloads')).table, 'games');
});

test('every static sibling of a detail route is listed, so Proxy leaves it alone', () => {
  const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
  const sections = ['games', 'matches', 'fleet', 'tasks', 'board', 'messages', 'graveyard'];
  for (const section of sections) {
    const siblings = readdirSync(join(app, section), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('[') && !e.name.startsWith('('))
      .map((e) => e.name);
    assert.deepEqual(
      [...siblings].sort(),
      [...(STATIC_SIBLINGS[section] ?? [])].sort(),
      `app/${section}: add static routes to STATIC_SIBLINGS and the proxy matcher`,
    );
    for (const name of siblings) assert.equal(probeFor(`/${section}/${name}`), null);
  }
});

test('the proxy matcher excludes every static sibling', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'proxy.ts'),
    'utf8',
  );
  for (const [section, names] of Object.entries(STATIC_SIBLINGS)) {
    for (const name of names) {
      assert.ok(
        source.includes(`'/${section}/:id((?!${name}$)[^/]+)'`),
        `proxy.ts matcher must exclude /${section}/${name}`,
      );
    }
  }
});

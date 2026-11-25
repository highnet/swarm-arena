/**
 * PostgREST's row cap (#250). Supabase returns at most `ROW_CAP` rows per request and says nothing
 * when it cuts a list short, so every list the site reads is either paged to the end (`readAll`)
 * or bounded on purpose, and no total is counted from a bounded list. The paging is tested against
 * a fake capped server; the rest is checked against the source, like `cache.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readAll, ROW_CAP } from './paged';

/** A table of `n` rows behind a server that, like PostgREST, never returns more than `ROW_CAP`. */
const capped = (n: number) => {
  const rows = Array.from({ length: n }, (_, id) => ({ id }));
  let calls = 0;
  const query = async (from: number, to: number) => {
    calls++;
    return { data: rows.slice(from, Math.min(to + 1, from + ROW_CAP)), error: null };
  };
  return { query, calls: () => calls };
};

test('readAll reads every row past the cap, each once', async () => {
  for (const n of [0, 1, ROW_CAP - 1, ROW_CAP, ROW_CAP + 1, 3087]) {
    const t = capped(n);
    const got = await readAll('t', t.query);
    assert.equal(got.length, n, `${n} rows`);
    assert.equal(new Set(got.map((r) => r.id)).size, n, `${n} rows, no repeats`);
    assert.equal(t.calls(), Math.floor(n / ROW_CAP) + 1, `${n} rows in as few pages as possible`);
  }
});

test('readAll throws on a failed page instead of returning a short list', async () => {
  let page = 0;
  const query = async (from: number) =>
    page++ === 0
      ? { data: Array.from({ length: ROW_CAP }, (_, i) => ({ id: from + i })), error: null }
      : { data: null, error: { message: 'timeout' } };
  await assert.rejects(readAll('records', query), /records: timeout/);
});

const WEB = join(import.meta.dirname, '..');
const data = readFileSync(join(WEB, 'lib/data.ts'), 'utf8');

/** Each `db.from(...)` / `.from('table')` query chain in the data layer, up to its end. */
const queries = [
  ...data.matchAll(/\.from\((?:'[a-z_]+'|table)\)[\s\S]*?(?:;|\.then\(|\)\s*,\s*\n)/g),
].map(([q]) => q);

test('every query in the data layer is paged, bounded, counted or keyed', () => {
  assert.ok(queries.length >= 8, `found the queries (${queries.length})`);
  for (const q of queries)
    assert.match(
      q,
      /\.range\(|\.limit\(|head: true|\.maybeSingle\(\)|\.in\('id'|\.eq\('id'/,
      `unbounded read, silently capped at ${ROW_CAP} rows:\n${q}`,
    );
});

test('no read asks for more rows than the server will return', () => {
  const constants = new Map(
    [...data.matchAll(/const ([A-Z_]+) = ([\d_]+);/g)].map(([, k, v]) => [
      k,
      Number(v.replaceAll('_', '')),
    ]),
  );
  for (const [, arg] of data.matchAll(/\.limit\(([^)]*)\)/g)) {
    const n = /^[\d_]+$/.test(arg) ? Number(arg.replaceAll('_', '')) : constants.get(arg);
    assert.ok(n !== undefined, `.limit(${arg}) is a literal or a named constant`);
    assert.ok(n <= ROW_CAP, `.limit(${arg}) = ${n} relies on a server cap above ${ROW_CAP}`);
  }
});

test('the snapshot pages every whole-run table to the end', () => {
  const at = data.indexOf('const fromSupabase');
  const fn = data.slice(at, data.indexOf('\n};', at));
  assert.match(fn, /const byRun = [\s\S]*?readAll</, 'byRun pages with readAll');
  assert.match(fn, /byRun[\s\S]*?\.order\('id'[\s\S]*?\.range\(/, 'in a stable order');
  for (const table of [
    'tracks',
    'rungs',
    'agents',
    'tasks',
    'records',
    'matches',
    'elo_points',
    'messages',
  ])
    assert.match(fn, new RegExp(`byRun<[^>]+>\\('${table}'`), `${table} is read whole`);
});

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });

test("no total is counted from the snapshot's bounded games", () => {
  // `s.games` holds each engine's newest `SNAPSHOT_GAMES_PER_ENGINE`: a count of it is wrong as soon
  // as an engine has played more. Count from the matches (`counters`) or `getGamesPage().total`.
  const files = ['app', 'components', 'lib'].flatMap((d) => sources(join(WEB, d)));
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const [use] of src.matchAll(/\b(?:s|snapshot)\.games\b[^;\n]*/g))
      assert.doesNotMatch(
        use,
        /\.length|\.reduce\(/,
        `${file} counts the snapshot's bounded games: ${use.trim()}`,
      );
  }
  const counters = readFileSync(join(WEB, 'lib/derive.ts'), 'utf8');
  const fn = counters.slice(
    counters.indexOf('export const counters'),
    counters.indexOf('});', counters.indexOf('export const counters')),
  );
  assert.doesNotMatch(fn, /s\.games/, 'counters() counts games from the matches');
});

/**
 * Cache rules for the site (#222). ISR writes are billed, so: no browser can expire a cache tag,
 * live data never enters a prerender, and finished games and matches cache for good under their
 * own tags, so no unrelated change can rewrite them. Checked against the source, since these are
 * Next.js directives that only take effect in a build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WEB = join(import.meta.dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'lib'];

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });

const ALL = SOURCE_DIRS.flatMap((d) => sources(join(WEB, d)));
const EXPIRE = /\b(updateTag|revalidateTag|revalidatePath|refresh)\b/;

/** The body of `export const <name> = async (...) => { ... };`, by brace matching. */
const body = (src: string, name: string) => {
  const at = src.indexOf(`export const ${name} = async`);
  assert.ok(at >= 0, `${name} is defined`);
  let i = src.indexOf('{', src.indexOf('=>', at));
  const start = i;
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced body for ${name}`);
};

test('no server action, which any browser can call, expires the server cache', () => {
  const actions = ALL.filter((f) => /^\s*['"]use server['"]/m.test(readFileSync(f, 'utf8')));
  for (const file of actions) {
    const src = readFileSync(file, 'utf8');
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]next\/cache['"]/g)];
    for (const [, names] of imports)
      assert.doesNotMatch(names, EXPIRE, `${file} imports a cache-expiring call`);
  }
});

test('nothing in the site expires cache tags on demand', () => {
  for (const file of ALL) {
    const src = readFileSync(file, 'utf8');
    for (const [, names] of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]next\/cache['"]/g))
      assert.doesNotMatch(names, EXPIRE, `${file} imports a cache-expiring call`);
  }
});

const data = readFileSync(join(WEB, 'lib/data.ts'), 'utf8');

/** A `cacheLife({ ... expire: N })` under five minutes is a request-time hole, never prerendered. */
const shortLived = (fn: string) => {
  const lives = [...fn.matchAll(/cacheLife\(\{[^}]*expire:\s*([\d_]+)[^}]*\}\)/g)];
  return lives.length > 0 && lives.every(([, s]) => Number(s.replaceAll('_', '')) < 300);
};

test('the snapshot is a short memory cache, never a prerender, and carries no tag', () => {
  const fn = body(data, 'getSnapshot');
  assert.match(fn, /'use cache'/);
  assert.ok(shortLived(fn), 'getSnapshot expires in under five minutes');
  assert.doesNotMatch(fn, /cacheTag/);
});

test('live games and the all-games download are read per request, never cached', () => {
  for (const name of ['liveGames', 'getAllGames']) {
    const fn = body(data, name);
    assert.doesNotMatch(fn, /'use cache'/, `${name} is not cached`);
    assert.match(fn, /await connection\(\)/, `${name} is request-time`);
  }
});

test('finished games and matches cache for good under their own tags only', () => {
  const game = body(data, 'getGame');
  assert.match(game, /cacheTag\(`game:\$\{id\}`\)/);
  assert.match(game, /if \(game\) cacheLife\('max'\)/);
  const match = body(data, 'getMatchGames');
  assert.match(match, /cacheTag\(`match:\$\{matchId\}`\)/);
  assert.match(match, /if \(finished\) cacheLife\('max'\)/);
  for (const fn of [game, match])
    assert.equal(fn.match(/cacheTag\(/g)?.length, 1, 'one per-entity tag, no shared one');
});

test('long-lived cached reads hold no wall-clock values, so a revalidation writes nothing new', () => {
  // Vercel bills an ISR write when revalidated output changes: a `new Date()` or `Date.now()`
  // in a cached result would make every revalidation a full write.
  const wallClock = /\bnew Date\(\)|Date\.now\(\)/;
  for (const name of ['getGame', 'getMatchGames']) assert.doesNotMatch(body(data, name), wallClock);
  assert.doesNotMatch(body(readFileSync(join(WEB, 'lib/news.ts'), 'utf8'), 'getNews'), wallClock);
  assert.doesNotMatch(
    body(readFileSync(join(WEB, 'lib/source.ts'), 'utf8'), 'getConcepts'),
    wallClock,
  );
});

test('no cached read shares a tag with another entity', () => {
  for (const file of ALL) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /cacheTag\(SNAPSHOT_TAG\)/, `${file} uses the shared snapshot tag`);
  }
});

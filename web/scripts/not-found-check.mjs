/**
 * Detail routes answer a real 404 for an unknown id, and 200 for a known one (#268).
 *
 * Drives a running production server (`next build && next start`). For every detail route type it
 * requests one id that exists, taken from the site's own sitemap (the fleet from `/fleet`, which
 * the sitemap leaves out), and one that cannot, and checks the status of each. The 404 must still
 * carry the not-found page, and the known page its own content (no `noindex`: its render did not
 * hit `notFound()`).
 *
 * Run: node web/scripts/not-found-check.mjs [base-url] [--allow-missing-known]
 * (default http://localhost:3000). `--allow-missing-known` skips, rather than fails, a route with
 * no known id to try: a build without Supabase (CI) has no games, matches or seats. Exits 1 on a
 * failed check. Requests run one at a time, against a local server only: Vercel's firewall
 * denies bursts from cloud containers.
 */
const args = process.argv.slice(2);
const allowMissingKnown = args.includes('--allow-missing-known');
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/$/, '');

/** Every detail route type: a pattern for its known paths, and paths that name nothing. */
const ROUTES = [
  { name: 'game', known: /^\/games\/[^/]+$/, unknown: ['/games/no-such-game'] },
  { name: 'match', known: /^\/matches\/[^/]+$/, unknown: ['/matches/no-such-match'] },
  { name: 'seat', known: /^\/fleet\/[^/]+$/, unknown: ['/fleet/no-such-seat'] },
  { name: 'task', known: /^\/tasks\/[^/]+$/, unknown: ['/tasks/no-such-task'] },
  { name: 'record', known: /^\/board\/\d+$/, unknown: ['/board/999999999', '/board/abc'] },
  { name: 'thread', known: /^\/messages\/\d+$/, unknown: ['/messages/999999999'] },
  { name: 'buried idea', known: /^\/graveyard\/\d+$/, unknown: ['/graveyard/999999999'] },
  {
    name: 'version',
    known: /^\/versions\/[^/]+\/[^/]+$/,
    unknown: ['/versions/chess/v999.0', '/versions/no-such-engine/v0.1'],
  },
  { name: 'engine', known: /^\/engines\/[^/]+$/, unknown: ['/engines/no-such-engine'] },
  {
    name: 'play',
    known: /^\/engines\/[^/]+\/play$/,
    unknown: ['/engines/no-such-engine/play'],
  },
  {
    name: 'ladder rung',
    known: /^\/engines\/[^/]+\/ladder\/\d+$/,
    unknown: ['/engines/chess/ladder/999', '/engines/no-such-engine/ladder/0'],
  },
];

const NOT_FOUND = 'This page could not be found';
/** Next adds this to a page whose render hit `notFound()`, mid-stream or not. */
const NOINDEX = '<meta name="robots" content="noindex"/>';

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

/** The status, and the whole streamed body (a 200 only shows the not-found UI once it ends). */
const get = async (path) => {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  return { status: res.status, body: await res.text() };
};

const pathsIn = (xml) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1].trim()).pathname);

const sitemap = await get('/sitemap.xml');
check(sitemap.status === 200, `/sitemap.xml answers ${sitemap.status}`);
const fleet = await get('/fleet');
const seats = [...fleet.body.matchAll(/href="(\/fleet\/[^"#?]+)"/g)].map((m) => m[1]);
const candidates = [...new Set([...pathsIn(sitemap.body), ...seats])];

for (const route of ROUTES) {
  const known = candidates.find((p) => route.known.test(p));
  if (!known) {
    check(allowMissingKnown, `${route.name}: no known id to try (none in the sitemap)`);
  } else {
    const { status, body } = await get(known);
    check(status === 200, `${route.name}: known ${known} answers ${status}`);
    check(!body.includes(NOINDEX), `${route.name}: known ${known} renders its own content`);
  }
  for (const path of route.unknown) {
    const { status, body } = await get(path);
    check(status === 404, `${route.name}: unknown ${path} answers ${status}`);
    check(
      body.includes(NOT_FOUND) && body.includes(NOINDEX),
      `${route.name}: unknown ${path} renders the not-found page`,
    );
  }
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');

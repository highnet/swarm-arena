import { NextResponse, type NextRequest } from 'next/server';
import { probeFor, probeQuery, type RowProbe } from '@/lib/exists';

/**
 * A real `404` for an unknown id on a detail route (#268).
 *
 * The detail pages stream their content inside `<Suspense>` under Cache Components, so the
 * response has committed to `200` before the page's own lookup can call `notFound()`. Proxy runs
 * before rendering: it checks that the id names something and, when it does not, rewrites to the
 * not-found page with status `404`. A known id passes straight through and streams as before.
 *
 * Cost (#222): Proxy writes no cache entries at all (it has no `use cache` scope), and it never
 * expires one. Each answer is held in this instance's memory per entity, a found one for half an hour,
 * a missing one for seconds (a game is written the moment it ends). Router prefetches and
 * client-side navigations (`rsc` requests) skip Proxy through the matcher: they render the
 * not-found UI already, and a status code means nothing to them. A failed or slow read lets the
 * request through, never a 404 for a page that may exist.
 */

const FOUND_MS = 30 * 60_000;
const MISSING_MS = 10_000;
const RUN_MS = 60_000;
const TIMEOUT_MS = 1_500;
const MAX_ENTRIES = 5_000;

type Held = { exists: boolean; until: number };
const held = new Map<string, Held>();
let run: { id: string | null; read: number } | null = null;

const hold = (key: string, exists: boolean) => {
  if (held.size >= MAX_ENTRIES) held.delete(held.keys().next().value!);
  held.set(key, { exists, until: Date.now() + (exists ? FOUND_MS : MISSING_MS) });
};

const rest = async (query: string): Promise<Record<string, unknown>[]> => {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${query}`);
  return res.json();
};

/**
 * The newest run, as the snapshot reads it. Held for `RUN_MS`; `maxAge` asks for a fresher one
 * (a miss re-reads it, so a run that just started does not 404 its first matches, seats and tasks).
 */
const currentRun = async (maxAge = RUN_MS) => {
  if (run && Date.now() - run.read < maxAge) return run.id;
  const rows = await rest('runs?select=id&order=started_at.desc&limit=1');
  run = { id: (rows[0]?.id as string | undefined) ?? null, read: Date.now() };
  return run.id;
};

/** Reads one probe in `runId`, held per query. */
const readProbe = async (probe: RowProbe, runId: string | null) => {
  const query = probeQuery(probe, runId);
  const cached = held.get(query);
  if (cached && cached.until > Date.now()) return cached.exists;
  const rows = await rest(query);
  const exists = probe.accept ? probe.accept(rows) : rows.length > 0;
  hold(query, exists);
  return exists;
};

/** `true`/`false` when known, `null` when the read failed (the request then goes through). */
const rowExists = async (probe: RowProbe): Promise<boolean | null> => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return probe.offline;
  }
  try {
    if (!probe.inRun) return await readProbe(probe, null);
    const runId = await currentRun();
    const exists = runId ? await readProbe(probe, runId) : probe.offline;
    if (exists) return exists;
    // A miss may be a run that started after the held run id: re-read it (at most once per
    // `MISSING_MS`, so a stream of unknown ids costs no more than the misses themselves) and
    // only answer 404 if the id is missing from the newest run too.
    const fresh = await currentRun(MISSING_MS);
    if (fresh === runId) return exists;
    return fresh ? await readProbe(probe, fresh) : probe.offline;
  } catch (e) {
    console.error('existence check failed', e);
    return null;
  }
};

export const proxy = async (request: NextRequest) => {
  const probe = probeFor(request.nextUrl.pathname);
  if (!probe) return NextResponse.next();
  const exists = probe.kind === 'known' ? probe.exists : await rowExists(probe);
  if (exists !== false) return NextResponse.next();
  return NextResponse.rewrite(new URL('/_not-found', request.url), { status: 404 });
};

export const config = {
  matcher: [
    {
      // `/games/download` is a real route (the export), not a game id: see `STATIC_SIBLINGS`.
      source: '/games/:id((?!download$)[^/]+)',
      missing: [
        { type: 'header', key: 'rsc' },
        { type: 'header', key: 'next-router-prefetch' },
      ],
    },
    {
      source: '/:section(matches|fleet|tasks|board|messages|graveyard)/:id',
      missing: [
        { type: 'header', key: 'rsc' },
        { type: 'header', key: 'next-router-prefetch' },
      ],
    },
    {
      source: '/versions/:engine/:version',
      missing: [
        { type: 'header', key: 'rsc' },
        { type: 'header', key: 'next-router-prefetch' },
      ],
    },
    {
      source: '/engines/:path+',
      missing: [
        { type: 'header', key: 'rsc' },
        { type: 'header', key: 'next-router-prefetch' },
      ],
    },
  ],
};

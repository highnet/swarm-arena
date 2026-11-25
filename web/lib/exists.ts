import { TRACKS, type GameId } from '@arena/shared';

/**
 * Whether a detail route's id names something, decided before the page renders (#268).
 *
 * Under Cache Components a detail page sends its prerendered shell, and with it a `200`, before
 * the request-time lookup inside `<Suspense>` runs, so a `notFound()` there can only swap in the
 * not-found UI. The supported way to answer a real `404` is Proxy (Next's streaming guide, "The
 * HTTP contract"), which runs before rendering. `proxy.ts` asks `probeFor` what a path needs and
 * checks it with one small PostgREST read, held in memory per entity (Proxy has no `use cache`).
 *
 * Each probe mirrors the lookup its page does, so a probe that says "missing" is exactly a page
 * that would render the not-found UI.
 */

/** The engines, as the `/engines/<id>` and `/versions/<id>/…` routes name them. */
const ENGINE_IDS: readonly string[] = TRACKS.map((t) => t.id);

/** One database read: a row of `table` matching every filter, optionally in the current run. */
export type RowProbe = {
  kind: 'row';
  table: string;
  /** PostgREST filters, already in `column=op.value` form, values URL-encoded. */
  filters: string[];
  /** Scope to the newest run, as the snapshot the page reads is. */
  inRun: boolean;
  /** Columns to read when rows need a check of their own; otherwise `id`. */
  select?: string;
  /** Rows to read (default 1). */
  limit?: number;
  /** A further check on the rows read, for lookups PostgREST cannot express exactly. */
  accept?: (rows: Record<string, unknown>[]) => boolean;
  /** Answer when Supabase is not configured (the site then shows the not-started run). */
  offline: boolean;
};

export type Probe = { kind: 'known'; exists: boolean } | RowProbe;

const eq = (column: string, value: string | number) =>
  `${column}=eq.${encodeURIComponent(String(value))}`;

const decode = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

const missing: Probe = { kind: 'known', exists: false };
const present: Probe = { kind: 'known', exists: true };

/** `/board/12`, `/messages/12`: the page compares `String(id)` or `Number(id)`. */
const numericId = (raw: string) => (/^\d{1,15}$/.test(raw) ? Number(raw) : null);

/** Versions are matched by `title=like.<version>*`; keep the pattern free of its operators. */
const SAFE_VERSION = /^[A-Za-z0-9._+-]{1,64}$/;

/**
 * What decides whether `pathname` names something. `null` for a path that is not a detail route
 * (Proxy then lets it through untouched).
 */
export const probeFor = (pathname: string): Probe | null => {
  const parts = pathname.replace(/\/+$/, '').split('/').slice(1);
  const [section, a, b, c] = parts;
  if (!section || !a) return null;

  if (section === 'engines') {
    const known = ENGINE_IDS.includes(a);
    if (parts.length === 2 || (parts.length === 3 && b === 'play')) {
      return known ? present : missing;
    }
    if (parts.length === 4 && b === 'ladder') {
      if (!known || !/^\d{1,4}$/.test(c)) return missing;
      const position = Number(c);
      const rungs = TRACKS.find((t) => t.id === (a as GameId))?.rungs.length ?? 0;
      return {
        kind: 'row',
        table: 'rungs',
        filters: [eq('track_id', a), eq('position', position)],
        inRun: true,
        offline: position < rungs,
      };
    }
    return null;
  }

  if (section === 'versions') {
    if (parts.length !== 3) return null;
    const version = decode(b);
    if (!ENGINE_IDS.includes(a) || version === null) return missing;
    // A version the pattern cannot carry safely is left to the page.
    if (!SAFE_VERSION.test(version)) return null;
    return {
      kind: 'row',
      table: 'records',
      filters: [
        eq('kind', 'patch_landed'),
        eq('track_id', a),
        `title=like.${encodeURIComponent(version)}*`,
      ],
      inRun: true,
      select: 'title',
      limit: 50,
      accept: (rows) => rows.some((r) => String(r.title).split(' ')[0] === version),
      offline: false,
    };
  }

  if (parts.length !== 2) return null;
  const id = decode(a);
  if (id === null) return missing;

  switch (section) {
    case 'games':
      // `getGame` reads the row by id alone, in any run.
      return { kind: 'row', table: 'games', filters: [eq('id', id)], inRun: false, offline: false };
    case 'matches':
      return {
        kind: 'row',
        table: 'matches',
        filters: [eq('id', id)],
        inRun: true,
        offline: false,
      };
    case 'fleet':
      return { kind: 'row', table: 'agents', filters: [eq('id', id)], inRun: true, offline: false };
    case 'tasks':
      return { kind: 'row', table: 'tasks', filters: [eq('id', id)], inRun: true, offline: false };
    case 'board':
    case 'graveyard':
    case 'messages': {
      const n = numericId(id);
      // The board and graveyard compare `String(r.id) === id`: `012` names nothing there.
      if (n === null || (section !== 'messages' && String(n) !== id)) return missing;
      return {
        kind: 'row',
        table: section === 'messages' ? 'messages' : 'records',
        filters: [eq('id', n), ...(section === 'graveyard' ? [eq('kind', 'idea_dead')] : [])],
        inRun: true,
        offline: false,
      };
    }
    default:
      return null;
  }
};

/** The PostgREST path and query for a row probe, with the run filter when it applies. */
export const probeQuery = (probe: RowProbe, runId: string | null) => {
  const filters = [...probe.filters, ...(probe.inRun && runId ? [eq('run_id', runId)] : [])];
  return `${probe.table}?select=${probe.select ?? 'id'}&${filters.join('&')}&limit=${probe.limit ?? 1}`;
};

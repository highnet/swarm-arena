import { cacheLife, cacheTag } from 'next/cache';

/** Rallypoint state, read from GitHub: the issues and pull requests the swarm coordinates through. */

import { REPO } from './repo';

export { REPO, REPO_URL } from './repo';

export type RpLabel = string;

export type RpItem = {
  number: number;
  title: string;
  url: string;
  isPR: boolean;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  labels: RpLabel[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  /** The arena task this issue mirrors or this pull request delivers. */
  arenaTask: string | null;
  /** For a pull request: the issue it closes. */
  closes: number | null;
  comments: number;
};

export type RpStage =
  'backlog' | 'claimed' | 'held' | 'review' | 'changes' | 'approved' | 'merged' | 'closed';

export const stageOf = (i: RpItem): RpStage => {
  const has = (l: string) => i.labels.includes(l);
  if (i.isPR) {
    if (i.merged) return 'merged';
    if (i.state === 'closed') return 'closed';
    if (has('review:approved')) return 'approved';
    if (has('status:changes-requested')) return 'changes';
    return 'review';
  }
  if (i.state === 'closed') return 'closed';
  if (has('status:blocked') || has('status:deferred') || has('needs:human')) return 'held';
  if (has('status:claimed')) return 'claimed';
  return 'backlog';
};

export type RawIssue = {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  labels: { name: string }[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  body: string | null;
  comments: number;
  pull_request?: { merged_at: string | null };
};

const toItem = (r: RawIssue): RpItem => ({
  number: r.number,
  title: r.title,
  url: r.html_url,
  isPR: Boolean(r.pull_request),
  state: r.state,
  merged: Boolean(r.pull_request?.merged_at),
  draft: Boolean(r.draft),
  labels: r.labels.map((l) => l.name),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  closedAt: r.closed_at,
  mergedAt: r.pull_request?.merged_at ?? null,
  arenaTask: /Arena task: `([^`]+)`/.exec(r.body ?? '')?.[1] ?? null,
  closes:
    Number(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(r.body ?? '')?.[1]) || null,
  comments: r.comments,
});

/** A real GitHub token, if one is configured; placeholders some environments set are ignored. */
const token = () => {
  const t = process.env.GITHUB_TOKEN ?? '';
  return /^(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})$/.test(t) ? t : '';
};

export type RallypointState = {
  /** Every open issue and pull request, then the recently closed ones, newest update first. */
  items: RpItem[];
  /** Every merged swarm pull request, all-time (GitHub's search count); null if it was not read. */
  mergedTotal: number | null;
  asOf: string;
  error: string | null;
};

/** Pages of open issues and pull requests read at most (100 each): far above what the swarm holds. */
const OPEN_PAGES = 10;
/** Recently closed issues and pull requests read: one page, enough for "Landed lately". */
export const RECENT_CLOSED = 100;

const ghHeaders = () => ({
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  ...(token() ? { authorization: `Bearer ${token()}` } : {}),
});

const readIssuesPage = async (query: string): Promise<RawIssue[]> => {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues?${query}`, {
    headers: ghHeaders(),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return (await res.json()) as RawIssue[];
};

/**
 * Every open item (all of it, so stage totals are true counts) and a bounded window of recently
 * closed ones, deduplicated and newest update first. Release-please's pull requests are not swarm
 * coordination and are left out.
 */
export const combineReads = (open: RawIssue[], closed: RawIssue[]): RpItem[] => {
  const seen = new Set<number>();
  const items: RpItem[] = [];
  for (const r of [...open, ...closed]) {
    if (seen.has(r.number)) continue;
    seen.add(r.number);
    const i = toItem(r);
    if (i.labels.includes('autorelease: pending') || i.labels.includes('autorelease: tagged'))
      continue;
    items.push(i);
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

/** All-time merged swarm pull requests, from one search count. Never throws: a count is optional. */
const readMergedTotal = async (): Promise<number | null> => {
  const q = `repo:${REPO} is:pr is:merged -label:"autorelease: pending" -label:"autorelease: tagged"`;
  try {
    const res = await fetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=1`,
      { headers: ghHeaders() },
    );
    if (!res.ok) return null;
    const { total_count } = (await res.json()) as { total_count?: number };
    return typeof total_count === 'number' ? total_count : null;
  } catch {
    return null;
  }
};

/** Refreshes on its own schedule only (`cacheLife` below); visitors never expire it (#222). */
export const GITHUB_TAG = 'github';

/**
 * One paginated read per cache window: every open issue and pull request (usually one page), plus
 * one page of the most recently closed, and one search count of everything merged. The issues listing includes pull requests, their labels
 * (claims, verdicts, holds) and merge state. Cached for two minutes so the site stays inside
 * GitHub's rate limit; set GITHUB_TOKEN to raise it.
 */
export const getRallypoint = async (): Promise<RallypointState> => {
  'use cache';
  cacheTag(GITHUB_TAG);
  cacheLife({ stale: 60, revalidate: 120, expire: 3600 });
  const asOf = new Date().toISOString();
  try {
    const open: RawIssue[] = [];
    let complete = false;
    for (let page = 1; page <= OPEN_PAGES; page++) {
      const raw = await readIssuesPage(
        `state=open&per_page=100&page=${page}&sort=created&direction=asc`,
      );
      open.push(...raw);
      if (raw.length < 100) {
        complete = true;
        break;
      }
    }
    const closed = await readIssuesPage(
      `state=closed&per_page=${RECENT_CLOSED}&sort=updated&direction=desc`,
    );
    const items = combineReads(open, closed);
    return {
      items,
      mergedTotal: await readMergedTotal(),
      asOf,
      error: complete ? null : `More than ${OPEN_PAGES * 100} open items; counts are partial`,
    };
  } catch (e) {
    console.error('rallypoint: GitHub read failed', e);
    const error = e instanceof Error && e.message.startsWith('GitHub answered') ? e.message : null;
    return { items: [], mergedTotal: null, asOf, error: error ?? 'GitHub could not be reached' };
  }
};

/** One merged pull request: enough to count merged work per sector, all-time and recent. */
export type MergedPull = { number: number; title: string; mergedAt: string };

/** Pages of closed pull requests read at most (100 each). */
const MERGED_PAGES = 10;

type RawPull = {
  number: number;
  title: string;
  merged_at: string | null;
  labels: { name: string }[];
};

/**
 * Every merged pull request, all-time: what the fleet graph's sector numbers count. Paged once
 * every 15 minutes. A failed read throws inside the cache, so it is never cached and the last good
 * list keeps serving; callers get `null` only when there has never been one.
 */
const readMergedPulls = async (): Promise<MergedPull[]> => {
  'use cache';
  cacheTag(GITHUB_TAG);
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  const out: MergedPull[] = [];
  for (let page = 1; page <= MERGED_PAGES; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/pulls?state=closed&per_page=100&page=${page}`,
      { headers: ghHeaders() },
    );
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const raw = (await res.json()) as RawPull[];
    for (const p of raw)
      if (p.merged_at && !p.labels.some((l) => l.name.startsWith('autorelease:')))
        out.push({ number: p.number, title: p.title, mergedAt: p.merged_at });
    if (raw.length < 100) break;
  }
  return out;
};

export const getMergedPulls = async (): Promise<MergedPull[] | null> => {
  try {
    return await readMergedPulls();
  } catch (e) {
    console.error('rallypoint: merged pull requests could not be read', e);
    return null;
  }
};

export const STAGES: { id: RpStage; label: string; hint: string }[] = [
  { id: 'backlog', label: 'Backlog', hint: 'Open issues any worker may claim' },
  { id: 'claimed', label: 'Claimed', hint: 'Reserved by a worker session' },
  { id: 'review', label: 'In review', hint: 'Pull requests waiting for an independent verdict' },
  { id: 'changes', label: 'Changes asked', hint: 'Sent back to a fixer' },
  { id: 'approved', label: 'Approved', hint: 'Independent approve; a merger lands it' },
  { id: 'merged', label: 'Merged', hint: 'Landed on main' },
  { id: 'held', label: 'Held', hint: 'Blocked, deferred or waiting on a human' },
];

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

type RawIssue = {
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
  items: RpItem[];
  asOf: string;
  error: string | null;
};

/**
 * One request: the issues listing includes pull requests, their labels (claims, verdicts, holds)
 * and merge state. Cached for two minutes so the site stays well inside GitHub's unauthenticated
 * rate limit; set GITHUB_TOKEN to raise it.
 */
/** Expired by `refreshLive` too, at most once a minute (GitHub rate limits). */
export const GITHUB_TAG = 'github';

export const getRallypoint = async (): Promise<RallypointState> => {
  'use cache';
  cacheTag(GITHUB_TAG);
  cacheLife({ stale: 60, revalidate: 120, expire: 3600 });
  const asOf = new Date().toISOString();
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/issues?state=all&per_page=100&sort=updated&direction=desc`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(token() ? { authorization: `Bearer ${token()}` } : {}),
        },
      },
    );
    if (!res.ok) return { items: [], asOf, error: `GitHub answered ${res.status}` };
    const raw = (await res.json()) as RawIssue[];
    // Release-please and other bots' pull requests are not swarm coordination.
    const items = raw
      .map(toItem)
      .filter(
        (i) =>
          !i.labels.includes('autorelease: pending') && !i.labels.includes('autorelease: tagged'),
      );
    return { items, asOf, error: null };
  } catch (e) {
    console.error('rallypoint: GitHub read failed', e);
    return { items: [], asOf, error: 'GitHub could not be reached' };
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
      {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(token() ? { authorization: `Bearer ${token()}` } : {}),
        },
      },
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

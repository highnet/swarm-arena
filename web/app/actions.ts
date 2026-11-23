'use server';

import { updateTag } from 'next/cache';
import { SNAPSHOT_TAG } from '@/lib/data';
import { GITHUB_TAG } from '@/lib/github';

/** Never expire faster than this, however many viewers report the same change. */
const SNAPSHOT_MIN_MS = 1_500;
/** GitHub is rate limited (60 an hour without a token), so its state refreshes more slowly. */
const GITHUB_MIN_MS = process.env.GITHUB_TOKEN ? 15_000 : 60_000;

let snapshotAt = 0;
let githubAt = 0;

/**
 * Supabase Realtime told a viewer something changed: expire the cached reads so the refresh that
 * follows renders the new rows instead of a stale snapshot. Throttled per server instance, so a
 * busy page cannot turn viewers into a stampede on Supabase or GitHub.
 */
export const refreshLive = async () => {
  const now = Date.now();
  if (now - snapshotAt >= SNAPSHOT_MIN_MS) {
    snapshotAt = now;
    updateTag(SNAPSHOT_TAG);
  }
  if (now - githubAt >= GITHUB_MIN_MS) {
    githubAt = now;
    updateTag(GITHUB_TAG);
  }
};

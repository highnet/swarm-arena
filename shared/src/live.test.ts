import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVE_GAME_STALE_MS, newestLiveGames, type LiveGameRow } from './index';

const at = (ms: number) => new Date(ms).toISOString();
const row = (id: string, track: LiveGameRow['track_id'], started: number, updated: number): LiveGameRow => ({
  id,
  run_id: 'r',
  match_id: 'm',
  track_id: track,
  candidate_version: 'v1',
  opponent: 'main',
  engine_first: true,
  moves: [],
  ply: 0,
  started_at: at(started),
  updated_at: at(updated),
});

test('newest non-stale live game per track', () => {
  const now = 10_000_000;
  const got = newestLiveGames(
    [
      row('old', 'chess', now - 60_000, now - 1_000),
      row('new', 'chess', now - 5_000, now - 1_000),
      row('stale', 'go9', now - 10 * 60_000, now - LIVE_GAME_STALE_MS - 1),
      row('hex', 'hex', now - 1_000, now - 500),
    ],
    now,
  );
  assert.equal(got.chess?.id, 'new');
  assert.equal(got.go9, undefined);
  assert.equal(got.hex?.id, 'hex');
  assert.deepEqual(Object.keys(got).sort(), ['chess', 'hex']);
});

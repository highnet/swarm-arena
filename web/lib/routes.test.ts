/**
 * Engine boards link to a page that exists (#262): a live game has no `games` row until it ends,
 * so `/games/<id>` would 404 while it is played.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardHref } from './routes';

const game = { id: 'run-001-hex-abc-g1', track: 'hex' as const, matchId: 'run-001-hex-abc' };

test('a stored game opens its own page', () => {
  assert.equal(boardHref(game, true), '/games/run-001-hex-abc-g1');
});

test('a live game opens its match, at the games', () => {
  assert.equal(boardHref(game, false), '/matches/run-001-hex-abc#games');
});

test('a live `arena versus` game, which has no match, opens the engine page', () => {
  assert.equal(boardHref({ ...game, matchId: null }, false), '/engines/hex');
});

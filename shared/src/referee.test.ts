import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GAMES, playMatch, randomPlayer, type Mover } from './index';

const rules = GAMES.othello;
const never = new Promise<string>(() => {});

/** A reference that hangs on its first move of the games listed in `hangIn` (1-based calls to a new game). */
const flakyReference = (hangOnGames: Set<number>) => {
  const inner = randomPlayer(3);
  let game = 0;
  let resets = 0;
  const mover: Mover = {
    id: 'stub-ref',
    choose: (r, s) => {
      const plies = r.plies(s);
      if (plies <= 1) game++; // first move of a game (it moves first or second)
      return hangOnGames.has(game) ? never : inner.choose(r, s);
    },
    reset: async () => {
      resets++;
    },
  };
  return { mover, resets: () => resets };
};

/** A candidate that always times out. */
const hangingCandidate: Mover = { id: 'cand-hang', choose: () => never };

test('a reference timeout is voided and replayed, never counted as a candidate win', async () => {
  const ref = flakyReference(new Set([2]));
  const res = await playMatch(rules, randomPlayer(9), ref.mover, 2, {
    moveTimeMs: 50,
    replayOpponentFailures: 2,
  });
  assert.equal(res.games.length, 4);
  assert.ok(res.games.every((g) => g.termination !== 'timeout'));
  assert.equal(res.voided.length, 1);
  assert.equal(res.voided[0].index, 1);
  assert.equal(res.voided[0].termination, 'timeout');
  assert.equal(ref.resets(), 1);
});

test('without replays a reference timeout still resets the reference', async () => {
  const ref = flakyReference(new Set([1]));
  const res = await playMatch(rules, randomPlayer(9), ref.mover, 1, { moveTimeMs: 50 });
  assert.equal(res.voided.length, 0);
  assert.equal(res.games[0].termination, 'timeout');
  assert.equal(ref.resets(), 1);
});

test('a reference that keeps timing out aborts the match', async () => {
  const always = { id: 'dead-ref', choose: () => never } satisfies Mover;
  await assert.rejects(
    playMatch(rules, randomPlayer(9), always, 1, { moveTimeMs: 30, replayOpponentFailures: 2 }),
    /dead-ref timeout in game 1 on 3 attempts/,
  );
});

test("the candidate's own timeouts count against it and are not replayed", async () => {
  const res = await playMatch(rules, hangingCandidate, randomPlayer(4), 1, {
    moveTimeMs: 30,
    replayOpponentFailures: 2,
  });
  assert.equal(res.voided.length, 0);
  assert.equal(res.losses, 2);
  assert.ok(res.games.every((g) => g.termination === 'timeout'));
});

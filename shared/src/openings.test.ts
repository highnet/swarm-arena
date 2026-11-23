import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GAMES, OPENING_PLIES, matchOpenings, playMatch, type GameRecord, type Mover } from './index';

const replay = (id: keyof typeof GAMES, line: string[]) => {
  const rules = GAMES[id];
  return line.reduce((s, m) => rules.play(s, m), rules.initial());
};

for (const id of Object.keys(GAMES) as (keyof typeof GAMES)[]) {
  const rules = GAMES[id];

  test(`${id}: openings are legal, of the set length, and leave the game open`, () => {
    for (const line of matchOpenings(rules, 10, 7)) {
      assert.equal(line.length, OPENING_PLIES[id]);
      const state = replay(id, line); // play() throws on an illegal move
      assert.equal(rules.outcome(state), null);
      assert.ok(rules.legalMoves(state).length > 0);
    }
  });

  test(`${id}: the same seed gives the same openings, another seed others`, () => {
    assert.deepEqual(matchOpenings(rules, 10, 42), matchOpenings(rules, 10, 42));
    assert.notDeepEqual(matchOpenings(rules, 10, 42), matchOpenings(rules, 10, 43));
  });

  test(`${id}: pairs start from distinct positions`, () => {
    const keys = matchOpenings(rules, 10, 99).map((line) => {
      const state = replay(id, line);
      return `${rules.toMove(state)}|${rules.board(state).cells.join(',')}`;
    });
    assert.equal(new Set(keys).size, keys.length);
  });
}

test('repeats are allowed only once distinct openings run out', () => {
  // Hex has 121 one-ply openings: asking for 130 pairs must still return 130, all legal.
  const lines = matchOpenings(GAMES.hex, 130, 5);
  assert.equal(lines.length, 130);
  assert.equal(new Set(lines.map((l) => l.join(' '))).size, 121);
});

test('playMatch: both games of a pair share the opening, colours swapped; pairs differ', async () => {
  const rules = GAMES.othello;
  // A deterministic mover: always the first legal move. Without openings every pair repeats.
  const first: Mover = { id: 'first', choose: async (r, s) => r.legalMoves(s)[0] };
  const seen: GameRecord[] = [];
  const res = await playMatch(rules, first, first, 4, { openingSeed: 11, onGame: (g) => seen.push(g) });
  assert.equal(res.openingSeed, 11);
  assert.deepEqual(res.openings, matchOpenings(rules, 4, 11));
  const plies = OPENING_PLIES.othello;
  for (let p = 0; p < 4; p++) {
    const [a, b] = [res.games[2 * p], res.games[2 * p + 1]];
    assert.deepEqual(a.moves.slice(0, plies), res.openings[p]);
    assert.deepEqual(b.moves.slice(0, plies), res.openings[p]);
  }
  assert.equal(new Set(res.openings.map((o) => o.join(' '))).size, 4);
  assert.equal(seen.length, 8);

  const plain = await playMatch(rules, first, first, 2);
  assert.equal(plain.openingSeed, null);
  assert.deepEqual(plain.games[0].moves, plain.games[2].moves);
});

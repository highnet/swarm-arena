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

// ---- Balanced suites (#105) ---------------------------------------------------------------------
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawFromSuite, formatSuite, parseSuite, pickOpenings, positionKey, type OpeningSuite } from './index';

const suiteFile = (id: string) => resolve(dirname(fileURLToPath(import.meta.url)), 'openings', `${id}.txt`);
const loadSuite = (id: keyof typeof GAMES) => parseSuite(id, readFileSync(suiteFile(id), 'utf8'));

for (const id of Object.keys(GAMES) as (keyof typeof GAMES)[]) {
  const rules = GAMES[id];

  // The largest gate plays 20 pairs; 100 openings leave room to spare (Go's c3–g7 candidate space
  // yields 146 of its 600 two-ply lines, the others 200).
  test(`${id}: has a checked-in suite of at least 100 openings, each with its score`, () => {
    assert.ok(existsSync(suiteFile(id)), `missing shared/src/openings/${id}.txt`);
    const suite = loadSuite(id);
    assert.ok(suite.entries.length >= 100, `${suite.entries.length} openings`);
    assert.ok(suite.header.some((h) => h.startsWith('Rebuild: npm run arena -- openings build')));
    const bounds = suite.header.map((h) => /^Kept: score in \[(-?[\d.]+), (-?[\d.]+)\]/.exec(h)).find(Boolean);
    assert.ok(bounds, 'header states the admission bounds');
    for (const e of suite.entries) {
      assert.ok(e.score >= Number(bounds[1]) && e.score <= Number(bounds[2]), `${e.moves.join(' ')}: ${e.score}`);
    }
  });

  test(`${id}: every suite entry is legal, leaves the game open, and no two transpose`, () => {
    const keys = new Set<string>();
    for (const e of loadSuite(id).entries) {
      const state = replay(id, e.moves); // play() throws on an illegal move
      assert.equal(rules.outcome(state), null, e.moves.join(' '));
      assert.ok(rules.legalMoves(state).length > 0);
      const key = positionKey(rules, state);
      assert.ok(!keys.has(key), `${e.moves.join(' ')} transposes into an earlier entry`);
      keys.add(key);
    }
  });

  test(`${id}: the suite draw is reproducible from the seed, distinct, and seed-dependent`, () => {
    const suite = loadSuite(id);
    const a = drawFromSuite(rules, suite, 20, 42);
    assert.ok(a);
    assert.deepEqual(drawFromSuite(rules, suite, 20, 42), a);
    assert.notDeepEqual(drawFromSuite(rules, suite, 20, 43), a);
    assert.equal(new Set(a).size, 20);
    const picked = pickOpenings(rules, 20, 42, { suite });
    assert.equal(picked.source, 'suite');
    assert.deepEqual(picked.entries, a);
    assert.deepEqual(picked.openings, a.map((i) => suite.entries[i].moves));
    // A shorter match (the head-to-head) draws the first entries of the same order.
    assert.deepEqual(drawFromSuite(rules, suite, 10, 42), a.slice(0, 10));
  });

  test(`${id}: without a suite the openings are exactly #103's random lines`, () => {
    const picked = pickOpenings(rules, 10, 7);
    assert.equal(picked.source, 'random');
    assert.equal(picked.entries, null);
    assert.deepEqual(picked.openings, matchOpenings(rules, 10, 7));
  });
}

test('a suite with too few distinct entries falls back to the random lines', () => {
  const rules = GAMES.chess;
  const small: OpeningSuite = {
    game: 'chess',
    header: [],
    entries: [
      { moves: ['e2e4', 'e7e5'], score: 0.3 },
      { moves: ['g1f3', 'g8f6', 'e2e4', 'e7e5'], score: 0.2 },
      // Transposes into the entry above: counts once.
      { moves: ['e2e4', 'e7e5', 'g1f3', 'g8f6'], score: 0.2 },
    ],
  };
  assert.equal(drawFromSuite(rules, small, 3, 1), null);
  assert.deepEqual(pickOpenings(rules, 3, 1, { suite: small }), {
    openings: matchOpenings(rules, 3, 1),
    source: 'random',
    entries: null,
  });
  assert.equal(drawFromSuite(rules, small, 2, 1)?.length, 2);
  // A suite for another game is ignored.
  assert.equal(pickOpenings(GAMES.othello, 2, 1, { suite: small }).source, 'random');
});

test('formatSuite and parseSuite round-trip', () => {
  const suite: OpeningSuite = {
    game: 'othello',
    header: ['Built for a test.'],
    entries: [
      { moves: ['f5', 'd6'], score: -2 },
      { moves: ['f5', 'f6'], score: 0 },
    ],
  };
  assert.deepEqual(parseSuite('othello', formatSuite(suite, 0)), suite);
  assert.throws(() => parseSuite('othello', 'f5 d6\n'), /no score/);
});

test('playMatch draws from the suite and reports the entries', async () => {
  const rules = GAMES.othello;
  const suite = loadSuite('othello');
  const first: Mover = { id: 'first', choose: async (r, s) => r.legalMoves(s)[0] };
  const res = await playMatch(rules, first, first, 3, { openingSeed: 5, openingSuite: suite });
  assert.equal(res.openingSource, 'suite');
  assert.deepEqual(res.openingEntries, drawFromSuite(rules, suite, 3, 5));
  for (let p = 0; p < 3; p++) {
    const line = suite.entries[res.openingEntries![p]].moves;
    assert.deepEqual(res.games[2 * p].moves.slice(0, line.length), line);
    assert.deepEqual(res.games[2 * p + 1].moves.slice(0, line.length), line);
  }
  const plain = await playMatch(rules, first, first, 1);
  assert.equal(plain.openingSource, null);
  assert.equal(plain.openingEntries, null);
});

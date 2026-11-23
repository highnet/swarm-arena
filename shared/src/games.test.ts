import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chess, go9, hex, othello, GAMES, performanceElo, playGame, randomPlayer, mctsPlayer, replayBoards } from './index';
import { goScore } from './games/go9';

test('chess: start has 20 moves, perft(2) = 400', () => {
  const s = chess.initial();
  const moves = chess.legalMoves(s);
  assert.equal(moves.length, 20);
  const total = moves.reduce((n, m) => n + chess.legalMoves(chess.play(s, m)).length, 0);
  assert.equal(total, 400);
});

test('chess: fool’s mate is a black win', () => {
  let s = chess.initial();
  for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) s = chess.play(s, m);
  assert.equal(chess.outcome(s), 0);
});

test('othello: 4 opening moves, perft(3) = 56', () => {
  const s = othello.initial();
  assert.deepEqual(othello.legalMoves(s).sort(), ['c4', 'd3', 'e6', 'f5']);
  const perft = (st: ReturnType<typeof othello.initial>, d: number): number =>
    d === 0 ? 1 : othello.legalMoves(st).reduce((n, m) => n + perft(othello.play(st, m), d - 1), 0);
  assert.equal(perft(s, 3), 56);
});

test('hex: a straight column wins for black', () => {
  let s = hex.initial();
  for (let r = 1; r <= 11; r++) {
    s = hex.play(s, `a${r}`);
    if (r < 11) s = hex.play(s, `k${r}`);
  }
  assert.equal(hex.outcome(s), 1);
});

test('go: capture and suicide rules', () => {
  let s = go9.initial();
  // Black surrounds white at a9 (top-left corner).
  for (const m of ['b9', 'a9', 'a8']) s = go9.play(s, m);
  assert.equal(s.cells[0], null, 'white stone captured');
  // a9 is now suicide for white.
  assert.throws(() => go9.play(s, 'a9'));
  assert.ok(goScore(s.cells) < 81);
});

test('every game finishes between random players', async () => {
  for (const rules of Object.values(GAMES)) {
    const g = await playGame(rules, [randomPlayer(1), randomPlayer(2)]);
    assert.ok([0, 0.5, 1].includes(g.outcome), rules.id);
    assert.equal(g.termination === 'illegal-move', false, rules.id);
    assert.equal(replayBoards(rules.id, g.moves).length, g.moves.length + 1);
  }
});

test('mcts beats random at othello', async () => {
  const g = await playGame(othello, [mctsPlayer(100), randomPlayer(3)]);
  assert.equal(g.outcome, 1);
});

test('performance elo', () => {
  const even = performanceElo([{ opponentElo: 1000, score: 10, games: 20 }]);
  assert.ok(Math.abs(even.elo - 1000) < 1);
  const strong = performanceElo([{ opponentElo: 1000, score: 15, games: 20 }]);
  assert.ok(strong.elo > 1150 && strong.elo < 1250, String(strong.elo));
  const perfect = performanceElo([{ opponentElo: 500, score: 10, games: 10 }]);
  assert.ok(Number.isFinite(perfect.elo));
});

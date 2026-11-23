import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chess, go9, hex, othello, GAMES, performanceElo, playGame, randomPlayer, mctsPlayer, replayBoards } from './index';
import { goScore, isEye, goParse } from './games/go9';
import { fastGoRollout, rng } from './players';

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

test('go: fast playouts match full-rules playouts and are fast', () => {
  // The MCTS reference plays Go playouts on a mutable board (simple ko instead of superko).
  // Their outcomes must agree with playouts through the full rules, or the reference's strength,
  // and every Go rung anchored on it, would silently move.
  const pick = (s: ReturnType<typeof go9.initial>, r: () => number) => {
    const ms = go9.legalMoves(s).filter((m) => m !== 'pass' && !isEye(s.cells, goParse(m), s.turn));
    return ms.length ? ms[Math.floor(r() * ms.length)] : 'pass';
  };
  let s = go9.initial();
  const r0 = rng(5);
  for (let k = 0; k < 20; k++) s = go9.play(s, pick(s, r0));
  const slow = (r: () => number) => {
    let t = s;
    for (;;) {
      const o = go9.outcome(t);
      if (o !== null) return o;
      if (go9.plies(t) >= go9.maxPlies) return go9.adjudicate(t);
      t = go9.play(t, pick(t, r));
    }
  };
  const n = 300;
  const ra = rng(21);
  const rb = rng(22);
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) a += slow(ra);
  const t0 = performance.now();
  for (let i = 0; i < n; i++) b += fastGoRollout(s, go9.maxPlies, rb);
  const fastMs = (performance.now() - t0) / n;
  assert.ok(Math.abs(a / n - b / n) < 0.12, `win rates ${a / n} vs ${b / n}`);
  assert.ok(fastMs < 5, `fast playout took ${fastMs.toFixed(2)} ms`);
});

test('performance elo', () => {
  const even = performanceElo([{ opponentElo: 1000, score: 10, games: 20 }]);
  assert.ok(Math.abs(even.elo - 1000) < 1);
  const strong = performanceElo([{ opponentElo: 1000, score: 15, games: 20 }]);
  assert.ok(strong.elo > 1150 && strong.elo < 1250, String(strong.elo));
  const perfect = performanceElo([{ opponentElo: 500, score: 10, games: 10 }]);
  assert.ok(Number.isFinite(perfect.elo));
});

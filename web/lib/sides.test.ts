import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineColor, gameSides, sideNames } from './sides';

test('a gate match against main names both sides the same way', () => {
  assert.deepEqual(sideNames('hex', 'v0.6', 'Hex 11×11 v0.5'), {
    engine: 'Hex v0.6 (candidate)',
    opponent: 'Hex v0.5 (main)',
  });
  assert.deepEqual(sideNames('go9', 'v0.7', 'Go 9×9 v0.6'), {
    engine: 'Go v0.7 (candidate)',
    opponent: 'Go v0.6 (main)',
  });
  // The live stream of `arena versus` writes "main <version>" and a local candidate.
  assert.deepEqual(sideNames('chess', 'local', 'main v1.2'), {
    engine: 'Chess (candidate)',
    opponent: 'Chess v1.2 (main)',
  });
  assert.deepEqual(sideNames('othello', 'local', 'main'), {
    engine: 'Othello (candidate)',
    opponent: 'Othello (main)',
  });
});

test('a reference opponent keeps its real name', () => {
  assert.deepEqual(sideNames('chess', 'v0.9', 'Stockfish level 4'), {
    engine: 'Chess v0.9',
    opponent: 'Stockfish level 4',
  });
  assert.deepEqual(sideNames('go9', 'v0.7', 'GNU Go level 8').opponent, 'GNU Go level 8');
  assert.deepEqual(sideNames('othello', 'v0.7', 'Edax level 6').opponent, 'Edax level 6');
  assert.deepEqual(sideNames('hex', 'candidate', 'Random mover'), {
    engine: 'Hex (candidate)',
    opponent: 'Random mover',
  });
  assert.equal(sideNames('hex', 'v0.3', 'MCTS 2000').opponent, 'MCTS 2000');
});

test('colours follow the rules library: White first in chess, Black first elsewhere', () => {
  const [w, b] = gameSides('chess', 'v0.9', 'Stockfish level 4', true);
  assert.deepEqual([w.colorName, w.color, w.name, w.engine], ['White', 'w', 'Chess v0.9', true]);
  assert.deepEqual([b.colorName, b.color, b.name], ['Black', 'b', 'Stockfish level 4']);
  const [first, second] = gameSides('hex', 'v0.6', 'Hex 11×11 v0.5', false);
  assert.deepEqual([first.colorName, first.name], ['Black', 'Hex v0.5 (main)']);
  assert.deepEqual([second.colorName, second.name], ['White', 'Hex v0.6 (candidate)']);
  assert.equal(engineColor('hex', false), 'w');
  assert.equal(engineColor('chess', false), 'b');
  assert.equal(engineColor('go9', true), 'b');
});

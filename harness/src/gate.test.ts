import assert from "node:assert/strict";
import { test } from "node:test";
import { gateBaseline, gateShortfall, needsRungBaseline } from "./gate";

test("re-rates main only when the rung sits below its stored rating", () => {
  // Othello: v0.2 at 1459 from an Edax 1 sweep, gate rung Edax 4 at 1300.
  assert.equal(needsRungBaseline(1300, 1459), true);
  // Chess/go9: the gate rung is above the current rating — unchanged behaviour.
  assert.equal(needsRungBaseline(1500, 1459), false);
  assert.equal(needsRungBaseline(1459, 1459), false);
  // Past the ladder, or no rated version yet.
  assert.equal(needsRungBaseline(null, 1459), false);
  assert.equal(needsRungBaseline(700, null), false);
});

test("the baseline is main's same-rung rating when it was measured", () => {
  assert.equal(gateBaseline(1459, null), 1459);
  assert.equal(gateBaseline(1459, { elo: 1150, error: 120 }), 1150);
  assert.equal(gateBaseline(null, null), null);
});

test("a candidate is judged against main on the same rung, not a different opponent", () => {
  const candidate = { elo: 1309, error: 108 };
  // Old rule would bury #67: 1309 is not above 1459.
  assert.equal(
    gateShortfall({
      candidate,
      currentElo: 1459,
      sameRung: null,
      rungLabel: null,
      currentVersion: "v0.2",
    }),
    "Rated 1309 ± 108, not above 1459.",
  );
  // Same rung: main rated 1150 on Edax 4, so the candidate passes the rating gate.
  assert.equal(
    gateShortfall({
      candidate,
      currentElo: 1459,
      sameRung: { elo: 1150, error: 130 },
      rungLabel: "Edax level 4",
      currentVersion: "v0.2",
    }),
    null,
  );
  // And when main does better on the same rung, the burial names both ratings.
  assert.equal(
    gateShortfall({
      candidate,
      currentElo: 1459,
      sameRung: { elo: 1340, error: 110 },
      rungLabel: "Edax level 4",
      currentVersion: "v0.2",
    }),
    "Rated 1309 ± 108 vs Edax level 4; v0.2 rated 1340 ± 110 on the same rung.",
  );
});

test("first rated version always passes the rating gate", () => {
  assert.equal(
    gateShortfall({
      candidate: { elo: 10, error: 300 },
      currentElo: null,
      sameRung: null,
      rungLabel: "Random mover",
      currentVersion: null,
    }),
    null,
  );
});

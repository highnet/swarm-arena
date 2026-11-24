import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expectedScore,
  GATE_SPRT,
  gateShortfall,
  needsRungBaseline,
  pairScores,
  sprtState,
  sprtVerdict,
  type SprtSpec,
} from "./gate";

/** `n` pairs whose mean is `mean`, alternating around it by `spread` (a realistic, non-zero variance). */
const pairsAt = (n: number, mean: number, spread = 0.25) =>
  Array.from({ length: n }, (_, i) => mean + (i % 2 === 0 ? spread : -spread));

test("re-rates main for the report only when the rung sits below its stored rating", () => {
  assert.equal(needsRungBaseline(1300, 1459), true);
  assert.equal(needsRungBaseline(1500, 1459), false);
  assert.equal(needsRungBaseline(1459, 1459), false);
  assert.equal(needsRungBaseline(null, 1459), false);
  assert.equal(needsRungBaseline(700, null), false);
});

test("pair scores pair up the two games of each opening", () => {
  assert.deepEqual(pairScores([1, 0, 1, 1, 0.5, 0, 1]), [0.5, 1, 0.25]);
  assert.deepEqual(pairScores([]), []);
});

test("the gate passes a clear gain against main", () => {
  const ps = pairsAt(40, 0.62);
  assert.equal(sprtVerdict(ps), "pass");
  assert.equal(
    gateShortfall({
      verdict: "pass",
      state: sprtState(ps),
      currentVersion: "v0.4",
    }),
    null,
  );
});

test("the gate buries a clear loss against main, naming the test", () => {
  const ps = pairsAt(40, 0.4);
  const verdict = sprtVerdict(ps);
  assert.equal(verdict, "fail");
  const why = gateShortfall({
    verdict,
    state: sprtState(ps),
    currentVersion: "v0.4",
  });
  assert.match(
    why ?? "",
    /^The sequential test against v0\.4 decided no gain: 40 pairs \(80 games\)/,
  );
  assert.match(why ?? "", /H0 -20 vs H1 \+30/);
});

test("a change too close to call is inconclusive at the cap, never a burial", () => {
  // Midway between H0 (-20) and H1 (+30): the evidence never crosses a bound.
  const mid = expectedScore(5);
  const ps = pairsAt(GATE_SPRT.maxPairs, mid);
  assert.equal(sprtVerdict(ps.slice(0, GATE_SPRT.maxPairs - 1)), "continue");
  assert.equal(sprtVerdict(ps), "inconclusive");
  assert.throws(() =>
    gateShortfall({
      verdict: "inconclusive",
      state: sprtState(ps),
      currentVersion: "v0.4",
    }),
  );
});

test("no decision on fewer than minPairs, however lopsided", () => {
  const ps = [1, 1, 1, 1, 1];
  assert.ok(sprtState(ps).llr > sprtState(ps).upper);
  assert.equal(sprtVerdict(ps), "continue");
  assert.equal(sprtVerdict([...ps, 1, 1, 1]), "pass");
});

test("the bounds follow alpha and beta, and the LLR is zero at the midpoint of H0 and H1", () => {
  const spec: SprtSpec = {
    elo0: 0,
    elo1: 30,
    alpha: 0.05,
    beta: 0.05,
    minPairs: 1,
    maxPairs: 10,
  };
  const s = sprtState(
    pairsAt(10, (expectedScore(0) + expectedScore(30)) / 2),
    spec,
  );
  assert.ok(Math.abs(s.llr) < 1e-9);
  assert.ok(Math.abs(s.upper - Math.log(19)) < 1e-12);
  assert.ok(Math.abs(s.lower + Math.log(19)) < 1e-12);
});

test("a stored rating is never the yardstick: only the head-to-head pairs decide", () => {
  // chess #179 under the old rule: rated 1520 on the rung, buried for not beating main's stored
  // 1547. The new decision takes no rating at all, so a candidate that beats main head to head
  // passes whatever its rung rating says...
  const beatsMain = pairsAt(30, 0.65);
  assert.equal(sprtVerdict(beatsMain), "pass");
  assert.equal(
    gateShortfall({
      verdict: sprtVerdict(beatsMain),
      state: sprtState(beatsMain),
      currentVersion: "v0.5",
    }),
    null,
  );
  // ...and one rated above main's stored number still fails if it loses to main head to head.
  const losesToMain = pairsAt(30, 0.38);
  assert.equal(sprtVerdict(losesToMain), "fail");
  // The decision's inputs carry no rating field: the signature has nowhere to put one.
  const inputs: Parameters<typeof gateShortfall>[0] = {
    verdict: "fail",
    state: sprtState(losesToMain),
    currentVersion: "v0.5",
  };
  assert.deepEqual(Object.keys(inputs).sort(), [
    "currentVersion",
    "state",
    "verdict",
  ]);
  // @ts-expect-error a stored rating is not an input of the gate
  gateShortfall({ ...inputs, currentElo: 1547 });
});

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { ARENA_ROOT } from "./config";
import { deliveredIssue } from "./orchestrator";
import { issueBody, prioLabel, type Pull } from "./rallypoint";
import { issueTrack } from "./strategist";

const task = {
  id: "run-001-chess-abc",
  spec: "Add a transposition table.",
  track_id: "chess" as const,
  type: "search" as const,
};

test("a plan's priority becomes one prio:p<n> label, p2 by default", () => {
  assert.equal(prioLabel(), "prio:p2");
  assert.equal(prioLabel(""), "prio:p2");
  assert.equal(prioLabel(1), "prio:p1");
  assert.equal(prioLabel("p3"), "prio:p3");
  assert.equal(prioLabel("prio:p0"), "prio:p0");
  assert.throws(() => prioLabel("high"));
  assert.throws(() => prioLabel(10));
});

test("a blocked task's body carries one Blocked-By trailer the unblock sweep parses", async () => {
  const lib = resolve(ARENA_ROOT, ".rallypoint/scripts/lib/blocked-by.mjs");
  const { parseBlockedBy } = (await import(lib)) as {
    parseBlockedBy: (body: string) => { kind: string; blockers?: string[] };
  };
  assert.deepEqual(parseBlockedBy(issueBody(task, { blockedBy: 42 })), {
    kind: "declared",
    blockers: ["42"],
    line: "Blocked-By: #42",
  });
  assert.equal(parseBlockedBy(issueBody(task)).kind, "absent");
  // Unchanged for an unblocked task.
  assert.match(
    issueBody(task),
    /^Add a transposition table\.\n\n---\nArena task:/,
  );
});

test("an issue is an arena task only when it names a known engine", () => {
  assert.equal(issueTrack([{ name: "arena" }, { name: "engine:go9" }]), "go9");
  assert.equal(issueTrack([{ name: "engine:poker" }]), null);
  assert.equal(issueTrack([{ name: "area:harness" }]), null);
});

test("the delivered issue comes from Closes, then Refs, then the agent/ branch", () => {
  const pull = (body: string, ref = "claude/x") =>
    ({ body, head: { ref, sha: "" } }) as Pull;
  assert.deepEqual(deliveredIssue(pull("Fixes it.\n\nCloses #12")), {
    issue: 12,
    closes: true,
  });
  assert.deepEqual(deliveredIssue(pull("Refs #7\n")), {
    issue: 7,
    closes: false,
  });
  assert.deepEqual(deliveredIssue(pull("No keywords.", "agent/31-tt")), {
    issue: 31,
    closes: false,
  });
  assert.equal(deliveredIssue(pull("This closes #5 in passing.")), null);
});

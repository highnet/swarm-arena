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

test("a worker re-dispatched with the claim holder's agent id resumes; any other id is refused (#177)", async () => {
  const { holdsClaim, claimHolder } = await import("./rallypoint");
  const labels = [{ name: "status:claimed" }, { name: "arena" }, { name: "engine:go9" }];
  const comments = [
    { body: "Claimed by Rallypoint agent `cd-d2-worker-go154`.\n\n- plan" },
    { body: "Inconclusive gate; resubmitting." },
    // A quoted claim later in a comment never counts: the line must open the body.
    { body: "> Claimed by Rallypoint agent `intruder`." },
  ];
  assert.equal(claimHolder(comments), "cd-d2-worker-go154");
  const base = { labels, comments, reserved: true };
  assert.equal(holdsClaim({ ...base, agentId: "cd-d2-worker-go154" }), true);
  assert.equal(holdsClaim({ ...base, agentId: "someone-else" }), false);
  assert.equal(holdsClaim({ ...base, agentId: "intruder" }), false);
  // No live reservation: the claim was released, so it is claimed afresh, not resumed.
  assert.equal(holdsClaim({ ...base, reserved: false, agentId: "cd-d2-worker-go154" }), false);
  // Any other hold (blocked, deferred, needs:human) is never resumed past.
  for (const hold of ["status:blocked", "status:deferred", "needs:human"])
    assert.equal(
      holdsClaim({ ...base, labels: [...labels, { name: hold }], agentId: "cd-d2-worker-go154" }),
      false,
    );
  // A re-claim supersedes: the last claim comment is the holder.
  const reclaimed = [...comments, { body: "Claimed by Rallypoint agent `cd-d2-worker-go154b`." }];
  assert.equal(holdsClaim({ ...base, comments: reclaimed, agentId: "cd-d2-worker-go154" }), false);
  assert.equal(holdsClaim({ ...base, comments: reclaimed, agentId: "cd-d2-worker-go154b" }), true);
});

test("release-claim lists a branch's pull requests by head through the REST transport (#177)", async () => {
  const scripts = resolve(ARENA_ROOT, ".rallypoint/scripts/lib");
  const { createTransport } = (await import(resolve(scripts, "api.mjs"))) as {
    createTransport: (o: {
      request: (c: { method: string; path: string }) => { status: number; body: unknown };
      repository: string;
    }) => (...args: string[]) => string;
  };
  const { branchPullRequests } = (await import(resolve(scripts, "release-claim.mjs"))) as {
    branchPullRequests: (
      gh: (...args: string[]) => string,
      branches: { name: string }[],
    ) => { ok: boolean; items?: { name: string; state: string; settledAt: string | null; pullRequests: number[] }[] };
  };
  const seen: string[] = [];
  const pulls: Record<string, unknown[]> = {
    "agent/154-go-tree-reuse": [
      { number: 162, state: "closed", merged_at: null, closed_at: "2026-11-24T10:00:00Z", head: { ref: "agent/154-go-tree-reuse", sha: "a" } },
    ],
    "agent/155-merged": [
      { number: 170, state: "closed", merged_at: "2026-11-24T11:00:00Z", closed_at: "2026-11-24T11:00:00Z", head: { ref: "agent/155-merged", sha: "b" } },
    ],
    "agent/156-open": [
      { number: 171, state: "open", merged_at: null, closed_at: null, head: { ref: "agent/156-open", sha: "c" } },
    ],
  };
  const gh = createTransport({
    repository: "highnet/swarm-arena",
    request: ({ method, path }) => {
      seen.push(`${method} ${path}`);
      const url = new URL(path, "https://x");
      assert.equal(url.pathname, "/repos/highnet/swarm-arena/pulls");
      assert.equal(url.searchParams.get("state"), "all");
      const head = url.searchParams.get("head") ?? "";
      assert.match(head, /^highnet:/);
      return { status: 200, body: pulls[head.slice("highnet:".length)] ?? [] };
    },
  });
  const out = branchPullRequests(gh, [
    { name: "agent/154-go-tree-reuse" },
    { name: "agent/155-merged" },
    { name: "agent/156-open" },
    { name: "agent/157-none" },
  ]);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(
    out.items!.map(({ name, state, settledAt, pullRequests }) => ({ name, state, settledAt, pullRequests })),
    [
      { name: "agent/154-go-tree-reuse", state: "settled", settledAt: "2026-11-24T10:00:00.000Z", pullRequests: [162] },
      { name: "agent/155-merged", state: "settled", settledAt: "2026-11-24T11:00:00.000Z", pullRequests: [170] },
      { name: "agent/156-open", state: "open", settledAt: null, pullRequests: [171] },
      { name: "agent/157-none", state: "none", settledAt: null, pullRequests: [] },
    ],
  );
  assert.equal(seen.length, 4);
});

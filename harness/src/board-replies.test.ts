import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildThreads, type Message } from "@arena/shared";

// A file store in a scratch home: set before config.ts is loaded.
process.env.ARENA_STORE = "file";
process.env.ARENA_HOME = mkdtempSync(join(tmpdir(), "arena-replies-"));
process.env.ARENA_RUN = "run-replies-test";
const m = await import("./messages");
const { boardLine, retro, RetroRefused } = await import("./orchestrator");
const { getStore } = await import("./store");

const as = async <T>(session: string, f: () => Promise<T>) => {
  const before = process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
  process.env.CLAUDE_CODE_REMOTE_SESSION_ID = session;
  try {
    return await f();
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
    else process.env.CLAUDE_CODE_REMOTE_SESSION_ID = before;
  }
};

test("#227: a worker's brief lists the hand-off it builds on, and its retro needs a reply", async () => {
  // Session A leaves a chess hand-off and an open question; a go9 hand-off is not the chess worker's.
  const { handoff, question } = await as("s-a", async () => {
    const h = await m.postMessage({
      seat: "worker",
      body: "Tried aspiration windows: +3 at 40 games, not enough.",
      kind: "handoff",
      track: "chess",
      title: "chess: aspiration windows",
    });
    await m.postMessage({
      seat: "worker",
      body: "go9 notes",
      kind: "handoff",
      track: "go9",
    });
    const q = await m.postMessage({
      seat: "worker",
      body: "Is the TT size capped by the referee?",
      kind: "question",
      track: "chess",
    });
    return { handoff: h.message.id, question: q.message.id };
  });

  await as("s-b", async () => {
    const ctx = { role: "worker", track: "chess", issue: 99, pr: null };
    m.startLedger(ctx);
    const section = await m.waitingSection(ctx);
    assert.match(section, /Threads waiting on you/);
    assert.match(
      section,
      new RegExp(`msg#${handoff} \\[open, unacknowledged\\]`),
    );
    assert.match(section, new RegExp(`msg#${question} \\[open, unanswered\\]`));
    assert.doesNotMatch(section, /go9 notes/);

    // No reply yet: the retro is refused with the list, and nothing is posted.
    const before = (await getStore().select<Message>("messages", {})).length;
    await assert.rejects(retro("worker-2", "slow build"), RetroRefused);
    assert.equal(
      (await getStore().select<Message>("messages", {})).length,
      before,
    );

    // A reply on the hand-off: the retro posts and names the thread.
    await m.postMessage({
      seat: "worker-2",
      replyTo: handoff,
      body: "Building on this: trying windows only at depth >= 6.",
    });
    const line = await boardLine();
    assert.ok("line" in line);
    assert.equal(line.line, `Board: replied on msg#${handoff}.`);
    await retro("worker-2", "slow build");
    const all = await getStore().select<Message>("messages", {});
    const posted = all.find((x) => x.kind === "retro");
    assert.match(
      posted!.body,
      new RegExp(`slow build\\n\\nBoard: replied on msg#${handoff}\\.`),
    );
    // The hand-off no longer waits on anybody.
    const t = buildThreads(all).find((x) => x.root.id === handoff)!;
    assert.equal(m.waitingFor([t], ctx).length, 0);
  });

  // A session with nothing to say states why, and the retro carries the reason.
  await as("s-c", async () => {
    m.startLedger({ role: "merger", track: null, issue: null, pr: 7 });
    const l = await boardLine("merger; nothing cites pr#7");
    assert.deepEqual(l, {
      line: "Board: no reply (merger; nothing cites pr#7).",
    });
  });
});

test("#227: an improver is pointed at unanswered retros, a planner at every engine's hand-off", async () => {
  const all = await getStore().select<Message>("messages", {});
  const threads = buildThreads(
    all.map((x) => ({ ...x, status: x.status ?? "open" })),
  );
  const planner = m
    .waitingFor(threads, { role: "planner" }, 20)
    .map((w) => w.why);
  assert.ok(planner.includes("latest unacknowledged go9 hand-off"));
  assert.ok(planner.includes("unanswered question"));
  // The retro posted above has no comment yet: the improver sees it.
  const improver = m
    .waitingFor(threads, { role: "improver" }, 20)
    .map((w) => w.why);
  assert.ok(improver.includes("retro nobody answered"));
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SEAT_STALE_MS, type Agent } from "@arena/shared";

// A file store in a scratch home: set before config.ts is loaded.
process.env.ARENA_STORE = "file";
process.env.ARENA_HOME = mkdtempSync(join(tmpdir(), "arena-seats-"));
process.env.ARENA_RUN = "run-seats-test";
const { takeSeat, sessionSeat, setAgent, touchSessionSeats } =
  await import("./board");
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
const row = async (id: string) =>
  (await getStore().select<Agent>("agents", { id }))[0];

test("#205: concurrent sessions of one role each get their own live seat", async () => {
  const a = await as("s-a", () => takeSeat("worker", null, "worker"));
  const b = await as("s-b", () => takeSeat("worker", null, "worker"));
  const c = await as("s-c", () => takeSeat("worker", null, "worker"));
  assert.deepEqual([a, b, c], ["worker", "worker-2", "worker-3"]);
  assert.equal((await row("worker"))?.session_id, "s-a");
  assert.equal((await row("worker-2"))?.session_id, "s-b");
  assert.equal((await row("worker-3"))?.status, "working");
});

test("a session keeps the seat it holds, and later commands find it", async () => {
  assert.equal(
    await as("s-b", () => takeSeat("worker", null, "worker")),
    "worker-2",
  );
  assert.equal(
    await as("s-b", () => sessionSeat("worker", null, "worker")),
    "worker-2",
  );
});

test("an idle or stale seat is reused; a live one never is", async () => {
  await setAgent("worker", { status: "idle" });
  assert.equal(
    await as("s-d", () => takeSeat("worker", null, "worker")),
    "worker",
  );
  const old = new Date(Date.now() - SEAT_STALE_MS - 60_000).toISOString();
  await getStore().update("agents", { id: "worker-3" }, { last_seen: old });
  assert.equal(
    await as("s-e", () => takeSeat("worker", null, "worker")),
    "worker-3",
  );
  assert.equal((await row("worker-2"))?.session_id, "s-b");
});

test("the heartbeat touches only this session's working seats", async () => {
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  await getStore().update("agents", { id: "worker-2" }, { last_seen: old });
  await getStore().update("agents", { id: "worker" }, { last_seen: old });
  assert.equal(await as("s-b", () => touchSessionSeats()), 1);
  assert.notEqual((await row("worker-2"))?.last_seen, old);
  assert.equal((await row("worker"))?.last_seen, old);
});

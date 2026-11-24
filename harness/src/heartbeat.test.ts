import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SEAT_STALE_MS, seatIsLive, type Agent } from "@arena/shared";

// A file store in a scratch home: set before config.ts is loaded.
process.env.ARENA_STORE = "file";
process.env.ARENA_HOME = mkdtempSync(join(tmpdir(), "arena-heartbeat-"));
process.env.ARENA_RUN = "run-heartbeat-test";
process.env.CLAUDE_CODE_REMOTE_SESSION_ID = "s-hb";
const { takeSeat, setAgent } = await import("./board");
const { beat, lastActivity, runHeartbeat, heartbeatPid } =
  await import("./heartbeat");
const { retro } = await import("./orchestrator");
const { roleOfSeat } = await import("./messages");
const { getStore } = await import("./store");

const MIN = 60_000;
const row = async (id: string) =>
  (await getStore().select<Agent>("agents", { id }))[0];
const iso = (ms: number) => new Date(ms).toISOString();

test("#228: a session quiet between arena commands stays working for its whole lifetime", async () => {
  const t0 = Date.now();
  const id = await takeSeat("merger", null, "merger");
  await setAgent(id, { status: "working", last_seen: iso(t0) });
  // 20 minutes of coding and testing with no arena command; the heartbeat beats once a minute and
  // the session keeps acting (its transcript grows), so the seat is live at every minute.
  for (let m = 1; m <= 20; m++) {
    const at = t0 + m * MIN;
    const b = await beat(at, at - 5_000);
    assert.equal(b.beat, "touched");
    assert.deepEqual(b.seats, [id]);
    assert.ok(seatIsLive((await row(id))!, at), `live at minute ${m}`);
  }
  // Without the heartbeat the same seat would be stale long before now.
  assert.ok(
    !seatIsLive({ status: "working", last_seen: iso(t0) }, t0 + 50 * MIN),
  );
});

test("a silent session (usage limit, dead turn) ages from its last action and reads stale within SEAT_STALE_MS", async () => {
  const t0 = Date.now();
  const [r] = await getStore().select<Agent>("agents", { id: "merger" });
  await setAgent(r.id, { status: "working", last_seen: iso(t0) });
  const lastAct = t0 + 2 * MIN;
  // The loop keeps running, but the session stopped acting at lastAct: the beat never claims more.
  for (let m = 3; m <= 30; m++) await beat(t0 + m * MIN, lastAct);
  assert.equal((await row("merger"))!.last_seen, iso(lastAct));
  assert.ok(!seatIsLive((await row("merger"))!, lastAct + SEAT_STALE_MS + 1));
  // Once it has been quiet past the threshold the loop has nothing true to say, and stops.
  const b = await beat(lastAct + SEAT_STALE_MS + MIN, lastAct);
  assert.equal(b.beat, "silent");
});

test("the beat never moves last_seen back past an arena command", async () => {
  const t0 = Date.now();
  await setAgent("merger", { status: "working", last_seen: iso(t0) });
  await beat(t0 + MIN, t0 - 10 * MIN);
  assert.equal((await row("merger"))!.last_seen, iso(t0));
});

test("retro ends the seat and the heartbeat with it", async () => {
  await setAgent("merger", { status: "working" });
  assert.equal(
    (await runHeartbeat({ intervalMs: 1, maxBeats: 2 })).beat,
    "touched",
  );
  await retro("merger", "heartbeat test retro");
  assert.equal((await row("merger"))!.status, "idle");
  const last = await runHeartbeat({ intervalMs: 1, maxBeats: 5 });
  assert.equal(last.beat, "done");
  assert.equal(heartbeatPid(), null);
});

test("another session's seats are never beaten by this one", async () => {
  const before = process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
  process.env.CLAUDE_CODE_REMOTE_SESSION_ID = "s-other";
  const other = await takeSeat("reviewer", null, "reviewer");
  process.env.CLAUDE_CODE_REMOTE_SESSION_ID = before;
  const old = iso(Date.now() - 10 * MIN);
  await getStore().update("agents", { id: other }, { last_seen: old });
  await beat(Date.now(), Date.now());
  assert.equal((await row(other))!.last_seen, old);
});

test("activity is the newest transcript write", () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-activity-"));
  assert.equal(lastActivity(dir), null);
  mkdirSync(join(dir, "proj"));
  writeFileSync(join(dir, "proj", "a.jsonl"), "{}\n");
  writeFileSync(join(dir, "proj", "b.jsonl"), "{}\n");
  writeFileSync(join(dir, "proj", "c.txt"), "ignored");
  const when = new Date("2026-01-01T00:00:00Z");
  utimesSync(join(dir, "proj", "a.jsonl"), when, when);
  utimesSync(
    join(dir, "proj", "c.txt"),
    new Date(),
    new Date(Date.now() + MIN),
  );
  const later = new Date("2026-01-02T00:00:00Z");
  utimesSync(join(dir, "proj", "b.jsonl"), later, later);
  assert.equal(lastActivity(dir), later.getTime());
});

test("a seat first seen in a signature takes its role from its name, not `builder`", () => {
  assert.equal(roleOfSeat("cd-d2-merger-pr223"), "merger");
  assert.equal(roleOfSeat("cd-d2-reviewer-pr216"), "reviewer");
  assert.equal(roleOfSeat("strategist"), "strategist");
  assert.equal(roleOfSeat("Rhea Pinecrest"), "worker");
});

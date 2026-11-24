import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { randomPlayer, type Mover, type Task } from "@arena/shared";

// A file store in a scratch home and a fast clock: set before config.ts is loaded (#164).
process.env.ARENA_STORE = "file";
process.env.ARENA_HOME = mkdtempSync(join(tmpdir(), "arena-abort-"));
process.env.ARENA_RUN = "run-abort-test";
process.env.ARENA_MOVE_MS = "20";
process.env.ARENA_MOVE_SLACK_MS = "10";
process.env.ARENA_REFERENCE_MOVE_MS = "60";
const { runMatch, isMatchAborted } = await import("./match");
const { inconclusive } = await import("./seat");
const { gtpEngine, killAll, liveProcesses } = await import("./engine");
const { getStore } = await import("./store");

type Row = Record<string, unknown>;
const never = new Promise<string>(() => {});
const db = getStore();

test("a reference that keeps timing out aborts the match as inconclusive: no verdict, no rating, no burial", async () => {
  const task = {
    id: "t-abort",
    run_id: "run-abort-test",
    track_id: "go9",
    title: "tree reuse",
    status: "claimed",
  };
  await db.insert("tasks", task);
  const dead: Mover = {
    id: "gnugo-8",
    choose: () => never,
    reset: async () => {},
  };
  const err = await runMatch({
    track: "go9",
    candidate: randomPlayer(3),
    candidateVersion: "v0.9",
    opponent: dead,
    opponentLabel: "GNU Go level 8",
    opponentElo: 1400,
    pairs: 1,
    purpose: "gate",
    taskId: task.id,
  }).catch((e: unknown) => e);
  assert.ok(isMatchAborted(err), `expected MatchAborted, got ${String(err)}`);
  assert.match(err.reason, /GNU Go level 8 timeout in game 1 on 4 attempts/);

  const [match] = await db.select<Row>("matches", { id: err.matchId });
  assert.equal(match.elo, 0, "no rating written");
  assert.ok(match.finished_at, "the aborted match is closed, not left running");
  const records = await db.select<Row>("records", { task_id: task.id });
  assert.ok(
    !records.some((r) => r.kind === "match_verdict"),
    "no match verdict",
  );

  const out = await inconclusive(
    task as Pick<Task, "id" | "track_id" | "title">,
    err,
  );
  assert.equal(out.inconclusive, true);
  assert.equal(out.shipped, false);
  assert.match(out.why, /^inconclusive: reference failure/);
  const after = await db.select<Row>("records", { task_id: task.id });
  for (const kind of ["patch_rejected", "idea_dead", "match_verdict"])
    assert.ok(!after.some((r) => r.kind === kind), `no ${kind} record`);
  assert.ok(
    after.some(
      (r) => r.kind === "progress" && /Inconclusive/.test(String(r.title)),
    ),
  );
  const [stored] = await db.select<Row>("tasks", { id: task.id });
  assert.equal(stored.status, "claimed", "the task keeps its claim; no burial");
  assert.equal(stored.pr, undefined, "no lesson pull request");
});

test("a sequential head-to-head stops when the test decides, and an undecided cap is inconclusive, not a burial (#195)", async () => {
  const task = {
    id: "t-undecided",
    run_id: "run-abort-test",
    track_id: "othello",
    title: "close call",
    status: "claimed",
  };
  await db.insert("tasks", task);
  const asked: number[] = [];
  const m = await runMatch({
    track: "othello",
    candidate: randomPlayer(3),
    candidateVersion: "v0.9",
    opponent: randomPlayer(4),
    opponentLabel: "Othello v0.8",
    opponentElo: 1400,
    pairs: 6,
    referenceOpponent: false,
    purpose: "gate",
    taskId: task.id,
    openingSeed: 11,
    stop: (ps) => (asked.push(ps.length), ps.length === 2),
  });
  assert.deepEqual(asked, [1, 2]);
  assert.equal(m.pairScores.length, 2);
  assert.equal(m.result.wins + m.result.draws + m.result.losses, 4);

  const out = await inconclusive(
    task as Pick<Task, "id" | "track_id" | "title">,
    { matchId: m.matchId, reason: "100 pairs, LLR 0.4" },
    "undecided",
  );
  assert.equal(out.inconclusive, true);
  assert.match(
    out.why,
    /^inconclusive: the sequential test against main reached its cap undecided/,
  );
  assert.match(out.why, /not a failed one/);
  const after = await db.select<Row>("records", { task_id: task.id });
  for (const kind of ["patch_rejected", "idea_dead"])
    assert.ok(!after.some((r) => r.kind === kind), `no ${kind} record`);
  const [stored] = await db.select<Row>("tasks", { id: task.id });
  assert.equal(stored.status, "claimed", "the task keeps its claim; no burial");
});

/** A GTP stub that never answers genmove, ignores quit and SIGTERM, and starts a grandchild. */
const hangingGtp = () => {
  const dir = mkdtempSync(join(tmpdir(), "gtp-hang-"));
  const pids = join(dir, "pids");
  const script = join(dir, "hang.mjs");
  writeFileSync(
    script,
    `
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
process.on("SIGTERM", () => {});
const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
appendFileSync(${JSON.stringify(pids)}, process.pid + " " + kid.pid + "\\n");
setInterval(() => {}, 1000); // outlives stdin closing
createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.startsWith("genmove")) return; // hangs
  if (line.startsWith("quit")) return; // ignored
  process.stdout.write("= \\n\\n");
});
`,
  );
  return {
    script,
    pids: () => readFileSync(pids, "utf8").trim().split(/\s+/).map(Number),
  };
};

/** Running (a zombie waiting to be reaped counts as gone). */
const alive = (pid: number) => {
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
};
/** SIGKILL is delivered asynchronously: allow it a moment. */
const settled = async (pids: number[], ms = 2000) => {
  const end = Date.now() + ms;
  while (pids.some(alive) && Date.now() < end)
    await new Promise((ok) => setTimeout(ok, 50));
  return pids.filter(alive);
};

test("after an aborted match killAll leaves no reference process (or its children) running", async () => {
  const stub = hangingGtp();
  const ref = await gtpEngine({
    id: "hang",
    command: process.execPath,
    args: [stub.script],
    setup: ["boardsize 9"],
  });
  const err = await runMatch({
    track: "go9",
    candidate: randomPlayer(3),
    candidateVersion: "v0.9",
    opponent: ref,
    opponentLabel: "hanging GTP",
    opponentElo: 1400,
    pairs: 1,
    purpose: "gate",
  }).catch((e: unknown) => e);
  assert.ok(isMatchAborted(err));
  const pids = stub.pids();
  // The first process plus a restart after each of the four failed attempts, each with a child.
  assert.equal(pids.length, 10);
  // Every restart killed the old process's whole group, not only its own pid.
  assert.deepEqual(
    await settled(pids.slice(0, 8)),
    [],
    "restarted-away processes are gone",
  );
  assert.ok(
    liveProcesses() >= 1,
    "the current reference still runs before cleanup",
  );
  killAll();
  assert.equal(liveProcesses(), 0);
  assert.deepEqual(
    await settled(pids),
    [],
    "no reference process or child is left",
  );
});

test("a referee process with a hanging reference exits within seconds once its match aborts", async () => {
  const stub = hangingGtp();
  const home = mkdtempSync(join(tmpdir(), "arena-abort-exit-"));
  const driver = join(home, "driver.mts");
  writeFileSync(
    driver,
    `
import { randomPlayer } from ${JSON.stringify(import.meta.resolve("@arena/shared"))};
import { runMatch, isMatchAborted } from ${JSON.stringify(join(import.meta.dirname, "match.ts"))};
import { gtpEngine, killAll } from ${JSON.stringify(join(import.meta.dirname, "engine.ts"))};
const ref = await gtpEngine({ id: "hang", command: process.execPath, args: [${JSON.stringify(stub.script)}], setup: [] });
try {
  await runMatch({ track: "go9", candidate: randomPlayer(1), candidateVersion: "c", opponent: ref,
    opponentLabel: "hanging GTP", opponentElo: 0, pairs: 1, purpose: "gate" });
} catch (e) {
  if (!isMatchAborted(e)) throw e;
  console.log("aborted");
} finally {
  killAll(); // what submit's finally does; without it the open pipes keep this process alive
}
`,
  );
  const started = Date.now();
  const child = spawn(process.execPath, ["--import", "tsx", driver], {
    cwd: import.meta.dirname,
    env: { ...process.env, ARENA_HOME: home },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const code = await new Promise<number | null>((done) => {
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      done(null);
    }, 15_000);
    child.on("exit", (c) => {
      clearTimeout(t);
      done(c);
    });
  });
  assert.equal(code, 0, `exited (${out})`);
  assert.match(out, /aborted/);
  // Four attempts at a 60 ms allowance plus tsx start-up; a leftover process would hang it.
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
  assert.deepEqual(
    await settled(stub.pids()),
    [],
    "no reference process or child is left",
  );
});

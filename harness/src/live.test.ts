import assert from "node:assert/strict";
import { test } from "node:test";
import { liveStream, LIVE_TABLE } from "./live";
import type { Store } from "./store";

type Row = Record<string, unknown>;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const info = {
  run_id: "run-t",
  match_id: "m1",
  track_id: "othello",
  candidate_version: "v2",
  opponent: "Edax L1",
};

/** An in-memory store that logs every live write; `mode` makes it fail or hang. */
const memoryStore = (mode: "ok" | "reject" | "throw" | "hang" = "ok") => {
  const rows = new Map<string, Row>();
  const log: string[] = [];
  const never = new Promise<never>(() => {});
  const act = async <T>(f: () => T): Promise<T> => {
    if (mode === "reject") throw new Error("fetch failed");
    if (mode === "hang") return never;
    await sleep(2);
    return f();
  };
  const store = {
    kind: "file",
    select: async () => [],
    insert: async (_t: string, r: Row) => r,
    update: async () => 0,
    claim: async () => 0,
    upsert: (table: string, row: Row) => {
      if (mode === "throw") throw new Error("sync boom");
      return act(() => {
        assert.equal(table, LIVE_TABLE);
        log.push(`upsert ${row.id} ply ${row.ply}`);
        rows.set(row.id as string, row);
      });
    },
    remove: (table: string, filter: Row) => {
      if (mode === "throw") throw new Error("sync boom");
      return act(() => {
        assert.equal(table, LIVE_TABLE);
        log.push(`delete ${filter.id}`);
        return rows.delete(filter.id as string) ? 1 : 0;
      });
    },
  } as unknown as Store;
  return { store, rows, log };
};

test("a game streams as it advances, batched, and its row goes when it ends", async () => {
  const { store, rows, log } = memoryStore();
  const live = liveStream(store, info, { intervalMs: 20 });
  const g = live.start("m1-g1", true, ["d3", "c5"]);
  const seen: number[] = [];
  for (let p = 3; p <= 30; p++) {
    g.move(`m${p}`, p);
    await sleep(4);
    const r = rows.get("m1-g1");
    if (r) seen.push(r.ply as number);
  }
  await sleep(40);
  const last = rows.get("m1-g1")!;
  assert.equal(last.ply, 30, "the trailing write carries the last ply");
  assert.deepEqual((last.moves as string[]).slice(0, 3), ["d3", "c5", "m3"]);
  assert.equal((last.moves as string[]).length, 30);
  assert.equal(last.engine_first, true);
  assert.equal(last.match_id, "m1");
  assert.ok(
    seen.some((p) => p > 2 && p < 30),
    "intermediate plies were visible",
  );
  const upserts = log.filter((l) => l.startsWith("upsert")).length;
  assert.ok(upserts < 28 / 2, `writes were batched (${upserts} for 28 plies)`);
  g.end();
  g.move("late", 31);
  await live.flush();
  assert.equal(rows.size, 0, "empty once the game ends");
  assert.equal(
    log.at(-1),
    "delete m1-g1",
    "the delete comes after the last upsert",
  );
});

test("the delete waits for an upsert still in flight", async () => {
  const { store, rows, log } = memoryStore();
  const live = liveStream(store, info, { intervalMs: 1000 });
  const g = live.start("m1-g2", false, []);
  g.move("a", 1);
  g.end(); // the first upsert is still in flight
  await live.flush();
  assert.equal(rows.size, 0);
  assert.deepEqual(log, ["upsert m1-g2 ply 0", "delete m1-g2"]);
});

for (const mode of ["reject", "throw", "hang"] as const) {
  test(`a store that ${mode}s never fails or slows the game`, async () => {
    const { store } = memoryStore(mode);
    const lines: string[] = [];
    const live = liveStream(store, info, {
      intervalMs: 1,
      log: (l) => lines.push(l),
    });
    const t0 = performance.now();
    const g = live.start("m1-g1", true, []);
    for (let p = 1; p <= 200; p++) {
      g.move(`m${p}`, p);
      if (p % 20 === 0) await sleep(2);
    }
    g.end();
    const played = performance.now() - t0;
    assert.ok(
      played < 200,
      `moves were never held up (${played.toFixed(0)} ms)`,
    );
    const f0 = performance.now();
    await live.flush(100);
    assert.ok(performance.now() - f0 < 500, "flush is bounded");
    if (mode !== "hang") assert.equal(lines.length, 1, "logged once");
  });
}

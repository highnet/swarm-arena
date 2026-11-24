import assert from "node:assert/strict";
import { test } from "node:test";
import { GAMES, playMatch, randomPlayer, type Mover } from "@arena/shared";
import { liveHooks, liveStream, LIVE_TABLE } from "./live";
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

/** A random player that takes a few ms per move, so the store sees each game in progress. */
const slow = (seed: number): Mover => {
  const inner = randomPlayer(seed);
  return {
    id: `slow-${seed}`,
    choose: async (r, st) => {
      await sleep(3);
      return inner.choose(r, st);
    },
  };
};

test("versus hooks stream every game of a playMatch with no match row, and clear them all", async () => {
  const { store, rows, log } = memoryStore();
  const live = liveStream(
    store,
    { ...info, match_id: null },
    { intervalMs: 5 },
  );
  const hooks = liveHooks(live, "run-t-othello-versus-x");
  const seen = new Set<string>();
  const res = await playMatch(GAMES.othello, slow(1), slow(2), 2, {
    onGameStart: hooks.onGameStart,
    onMove: (m, p) => {
      hooks.onMove(m, p);
      for (const id of rows.keys()) seen.add(id);
    },
    onVoid: hooks.onVoid,
    onGame: hooks.onGame,
  }).finally(hooks.done);
  assert.equal(res.wins + res.losses + res.draws, 4);
  assert.equal(rows.size, 0, "every row is deleted once its game ends");
  for (let g = 1; g <= 4; g++)
    assert.ok(
      log.includes(`delete run-t-othello-versus-x-g${g}`),
      `game ${g} streamed and ended`,
    );
  assert.ok(seen.size >= 1, "rows exist while games are played");
});

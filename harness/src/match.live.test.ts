import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { randomPlayer, type Mover } from "@arena/shared";

// A file store in a scratch home, live writes every 20 ms: set before config.ts is loaded.
process.env.ARENA_STORE = "file";
process.env.ARENA_HOME = mkdtempSync(join(tmpdir(), "arena-live-"));
process.env.ARENA_RUN = "run-live-test";
process.env.ARENA_LIVE_MS = "20";
const { runMatch } = await import("./match");
const { getStore } = await import("./store");

type Row = Record<string, unknown>;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** A seeded random player that takes `ms` per move, so a game lasts long enough to watch. */
const slow = (seed: number, ms: number): Mover => {
  const inner = randomPlayer(seed);
  return {
    id: `slow-${seed}`,
    choose: async (r, s) => {
      await sleep(ms);
      return inner.choose(r, s);
    },
  };
};
const spec = () => ({
  track: "othello" as const,
  candidate: slow(11, 4),
  candidateVersion: "v-live",
  opponent: slow(12, 4),
  opponentLabel: "random",
  opponentElo: 0,
  pairs: 1,
  purpose: "calibration" as const,
});

const db = getStore();
const { upsert, remove } = db;
const played: { moves: string[][]; score: number }[] = [];

test("live_games shows each game advancing and is empty once the match ends", async () => {
  const queryLog: string[] = [];
  db.upsert = async (table, row) => {
    queryLog.push(`upsert ${table} ${row.id} ply=${row.ply}`);
    await upsert(table, row);
  };
  db.remove = async (table, filter) => {
    queryLog.push(`delete ${table} ${filter.id}`);
    return remove(table, filter);
  };
  const { matchId, result } = await runMatch(spec());
  played.push({ moves: result.games.map((g) => g.moves), score: result.score });
  console.log(queryLog.join("\n"));

  for (const g of [1, 2]) {
    const id = `${matchId}-g${g}`;
    const plies = queryLog
      .filter((l) => l.startsWith(`upsert live_games ${id} `))
      .map((l) => Number(l.split("ply=")[1]));
    assert.ok(plies.length >= 3, `game ${g} was written while it was played`);
    assert.deepEqual(
      plies,
      [...plies].sort((a, b) => a - b),
      "plies only go up",
    );
    assert.ok(
      plies.length < result.games[g - 1].moves.length,
      "plies are batched",
    );
    const del = queryLog.indexOf(`delete live_games ${id}`);
    const lastUpsert = queryLog
      .map((l) => l.includes(` ${id} `))
      .lastIndexOf(true);
    assert.ok(del > lastUpsert, "deleted after its last upsert");
  }
  assert.deepEqual(
    await db.select("live_games"),
    [],
    "empty once the match ends",
  );
  assert.equal(
    (await db.select<Row>("games", { match_id: matchId })).length,
    2,
  );
});

test("a live store outage leaves the match's result and timing unchanged", async () => {
  const lines: string[] = [];
  const consoleLog = console.log;
  db.upsert = async () => {
    throw new Error("TypeError: fetch failed");
  };
  db.remove = async () => {
    throw new Error("TypeError: fetch failed");
  };
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  let res;
  const t0 = performance.now();
  try {
    res = await runMatch(spec());
  } finally {
    console.log = consoleLog;
    db.upsert = upsert;
    db.remove = remove;
  }
  const ms = performance.now() - t0;
  // Same seeded players, same games, same score as with a working store.
  assert.deepEqual(
    res.result.games.map((g) => g.moves),
    played[0].moves,
  );
  assert.equal(res.result.score, played[0].score);
  assert.equal(
    (await db.select<Row>("games", { match_id: res.matchId })).length,
    2,
  );
  assert.ok(ms < 5000, `the match was not held up (${ms.toFixed(0)} ms)`);
  assert.equal(
    lines.filter((l) => l.includes("live games:")).length,
    1,
    "the outage is logged once and the match carries on",
  );
});

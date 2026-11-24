import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAMES, playMatch, randomPlayer } from "@arena/shared";
import { gtpEngine } from "./engine";

/**
 * A tiny GTP engine: it acknowledges every command and answers genmove with "MOVE", except the
 * genmoves whose 1-based count across all its processes (kept in a file) is listed in `hang`,
 * which it never answers.
 */
const stubGtp = (hang: number[]) => {
  const dir = mkdtempSync(join(tmpdir(), "gtp-stub-"));
  const counter = join(dir, "count");
  writeFileSync(counter, "0");
  const script = join(dir, "stub.mjs");
  writeFileSync(
    script,
    `
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
const hang = ${JSON.stringify(hang)};
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const [cmd] = line.trim().split(/\\s+/);
  if (cmd === "quit") process.exit(0);
  if (cmd === "genmove") {
    const n = Number(readFileSync(${JSON.stringify(counter)}, "utf8")) + 1;
    writeFileSync(${JSON.stringify(counter)}, String(n));
    if (hang.includes(n)) return; // stuck: no reply, ever
    // The referee's legal moves are not known here; the test mover below filters.
    process.stdout.write("= MOVE\\n\\n");
    return;
  }
  process.stdout.write("= \\n\\n");
});
`,
  );
  return script;
};

test("a GTP reference that stops answering is restarted and its game replayed", async () => {
  const rules = GAMES.othello;
  const legal = randomPlayer(5);
  const gtp = await gtpEngine({
    id: "stub",
    command: process.execPath,
    args: [stubGtp([3])],
    setup: ["boardsize 8"],
  });
  let restarts = 0;
  // Ask the stub (so a hang is real), then play a legal move in its place.
  const ref = {
    id: "stub",
    choose: async <S>(r: typeof rules, s: S) => {
      assert.equal(await gtp.choose(r as never, s), "move");
      return legal.choose(r as never, s);
    },
    reset: async () => {
      restarts++;
      await gtp.reset!();
    },
    close: gtp.close,
  };
  const voided: number[] = [];
  const res = await playMatch(rules, randomPlayer(9), ref, 2, {
    moveTimeMs: 300,
    replayOpponentFailures: 2,
    onVoid: (_g, i) => voided.push(i),
  });
  await ref.close?.();
  // Before #131 the late reply poisoned every later game: all of them timed out.
  assert.equal(restarts, 1);
  assert.deepEqual(voided, [0]);
  assert.equal(res.games.length, 4);
  assert.ok(res.games.every((g) => g.termination !== "timeout"));
});

// Fleet graph live boards (#163): fakes live_games Realtime payloads on the page's live bus
// (lib/liveBus.ts) and checks a board appears, follows moves, shows the result, then goes.
// Run against a site with no live rows: npm run build && npx next start -p 3163 (in web/), then
// BASE_URL=http://localhost:3163 node scripts/check-live-boards.cjs
const { chromium } = require("playwright");
const assert = require("assert");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  await p.goto((process.env.BASE_URL ?? "http://localhost:3163") + "/fleet", {
    waitUntil: "networkidle",
  });
  await p.waitForSelector('[data-slot="swarm-graph"]');
  await p.waitForTimeout(1500);
  const boards = () => p.locator('[data-slot="engine-board"]').count();
  const sectors = await p
    .locator('[data-slot="swarm-graph"] [data-slot*="node"]')
    .count();
  console.log("node overlays:", sectors);
  assert.equal(await boards(), 0, "no live rows -> no boards");
  console.log("1. no live_games rows: 0 boards");
  const fire = (detail) =>
    p.evaluate(
      (d) => window.dispatchEvent(new CustomEvent("arena:live", { detail: d })),
      detail,
    );
  const now = () => new Date().toISOString();
  const row = (ply, moves) => ({
    id: "run-001-chess-test-g1",
    run_id: "run-001",
    match_id: "run-001-chess-test",
    track_id: "chess",
    candidate_version: "v0.9",
    opponent: "Stockfish L3",
    engine_first: true,
    moves,
    ply,
    started_at: now(),
    updated_at: now(),
  });
  await fire({
    table: "live_games",
    eventType: "INSERT",
    new: row(2, ["e2e4", "e7e5"]),
    old: null,
  });
  await p.waitForSelector('[data-slot="engine-board"][data-board="live"]');
  const cap1 = await p.locator('[data-slot="engine-board"]').innerText();
  console.log("2. INSERT -> board:", JSON.stringify(cap1));
  assert.match(cap1, /vs Stockfish L3 · move 1/);
  await fire({
    table: "live_games",
    eventType: "UPDATE",
    new: row(5, ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]),
    old: null,
  });
  await p.waitForFunction(() =>
    document
      .querySelector('[data-slot="engine-board"]')
      ?.textContent.includes("move 3"),
  );
  console.log(
    "3. UPDATE -> board:",
    JSON.stringify(await p.locator('[data-slot="engine-board"]').innerText()),
  );
  await fire({
    table: "games",
    eventType: "INSERT",
    new: {
      id: "run-001-chess-test-g1",
      track_id: "chess",
      moves: ["e2e4"],
      engine_first: true,
      outcome: 1,
      finished_at: now(),
      match_id: "run-001-chess-test",
      run_id: "run-001",
    },
    old: null,
  });
  await fire({
    table: "live_games",
    eventType: "DELETE",
    new: null,
    old: row(5, ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]),
  });
  await p.waitForSelector('[data-slot="engine-board"][data-board="ended"]');
  console.log(
    "4. DELETE -> board:",
    JSON.stringify(await p.locator('[data-slot="engine-board"]').innerText()),
    "aria:",
    await p.locator('[data-slot="engine-board"]').getAttribute("aria-label"),
  );
  const t0 = Date.now();
  await p.waitForSelector('[data-slot="engine-board"]', {
    state: "detached",
    timeout: 10000,
  });
  console.log(
    `5. board removed ${Date.now() - t0} ms later; boards now:`,
    await boards(),
  );
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

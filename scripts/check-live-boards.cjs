// Fleet graph live boards (#163, #171): fakes live_games Realtime payloads on the page's live bus
// (lib/liveBus.ts) and checks a board plays a burst of plies one by one, holds the result, loops
// the last game dimmed, cross-fades into the next game without a blank frame, and, with motion
// reduced, shows plain per-batch positions and no loop.
// Run: npm run build && npx next start -p 3163 (in web/), then
// BASE_URL=http://localhost:3163 node scripts/check-live-boards.cjs
const { chromium } = require("playwright");
const assert = require("assert");

const BASE = (process.env.BASE_URL ?? "http://localhost:3163") + "/fleet";
// A legal opening with a capture and a recapture at plies 7 and 8.
const MOVES = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5c6", "d7c6"];

const row = (id, moves) => {
  const now = new Date().toISOString();
  return {
    id,
    run_id: "run-001",
    match_id: "run-001-chess-test",
    track_id: "chess",
    candidate_version: "v0.9",
    opponent: "Stockfish L3",
    engine_first: true,
    moves,
    ply: moves.length,
    started_at: now,
    updated_at: now,
  };
};

const open = async (b, reducedMotion) => {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForSelector('[data-slot="swarm-graph"]');
  await p.waitForTimeout(1500);
  const fire = (detail) =>
    p.evaluate((d) => window.dispatchEvent(new CustomEvent("arena:live", { detail: d })), detail);
  return { ctx, p, fire };
};

const boardOf = (p, id) => p.locator(`[data-slot="engine-board"][href*="${id}"]`);

/** Samples a board's displayed ply (and caption) every `ms` for `forMs`. */
const sample = (p, id, forMs, ms = 40) =>
  p.evaluate(
    ([id, forMs, ms]) =>
      new Promise((done) => {
        const seen = [];
        const t0 = performance.now();
        const tick = () => {
          const el = document.querySelector(`[data-slot="engine-board"][href*="${id}"]`);
          if (el) {
            const ply = Number(el.getAttribute("data-ply"));
            const caption = el.textContent;
            const last = seen[seen.length - 1];
            if (!last || last.ply !== ply || last.phase !== el.dataset.phase)
              seen.push({ t: Math.round(performance.now() - t0), ply, phase: el.dataset.phase, caption });
          }
          if (performance.now() - t0 < forMs) setTimeout(tick, ms);
          else done(seen);
        };
        tick();
      }),
    [id, forMs, ms],
  );

const ended = (id, outcome) => [
  {
    table: "games",
    eventType: "INSERT",
    new: {
      id,
      track_id: "chess",
      moves: MOVES,
      engine_first: true,
      outcome,
      finished_at: new Date().toISOString(),
      match_id: "run-001-chess-test",
      run_id: "run-001",
    },
    old: null,
  },
  { table: "live_games", eventType: "DELETE", new: null, old: row(id, MOVES) },
];

(async () => {
  const b = await chromium.launch();

  // --- Motion on -----------------------------------------------------------------------------
  {
    const { ctx, p, fire } = await open(b, "no-preference");
    const g1 = "run-001-chess-test-g171a";
    await fire({ table: "live_games", eventType: "INSERT", new: row(g1, MOVES.slice(0, 2)), old: null });
    await boardOf(p, g1).waitFor();
    assert.equal(await boardOf(p, g1).getAttribute("data-ply"), "2");
    console.log("1. INSERT at ply 2:", JSON.stringify(await boardOf(p, g1).innerText()));

    // A burst of 6 plies in one payload plays one by one.
    const watching = sample(p, g1, 4500);
    await fire({ table: "live_games", eventType: "UPDATE", new: row(g1, MOVES), old: null });
    await p.waitForTimeout(550);
    const slides = await p.locator(`[data-slot="engine-board"][href*="${g1}"] .animate-piece-slide`).count();
    const seen = await watching;
    const plies = seen.map((s) => s.ply);
    console.log("2. burst of 6 plies, displayed plies over time:");
    for (const s of seen) console.log(`   +${s.t} ms  ply ${s.ply}  ${JSON.stringify(s.caption)}`);
    assert.deepEqual(plies, [2, 3, 4, 5, 6, 7, 8], "every intermediate ply shown, in order");
    const gaps = seen.slice(1).map((s, i) => s.t - seen[i].t);
    assert(gaps.slice(1).every((g) => g >= 300 && g <= 650), `steady pace: ${gaps}`);
    assert(slides > 0, "the moving piece slides");
    for (const s of seen) assert(s.caption.includes(`move ${Math.ceil(s.ply / 2)}`), "caption in step");
    console.log(`   gaps ${gaps.join(", ")} ms; a sliding piece was drawn: ${slides}`);

    // Game ends: hold the result, then loop the last game dimmed.
    for (const c of ended(g1, 1)) await fire(c);
    await p.waitForSelector(`[data-slot="engine-board"][href*="${g1}"][data-phase="hold"]`);
    const held = await boardOf(p, g1).innerText();
    console.log("3. ended -> hold:", JSON.stringify(held));
    assert.match(held, /won/);
    const loop = await sample(p, g1, 4000, 50);
    const firstLoop = loop.find((s) => s.phase === "loop");
    assert(firstLoop && firstLoop.t > 1500 && firstLoop.t < 2600, "held about 2 s");
    assert.match(firstLoop.caption, /last game/);
    const loopPlies = loop.filter((s) => s.phase === "loop").map((s) => s.ply);
    assert.deepEqual(loopPlies.slice(0, 4), [0, 1, 2, 3], "the loop replays from the start");
    const dim = await p
      .locator(`[data-slot="engine-board"][href*="${g1}"] .opacity-70`)
      .count();
    assert(dim > 0, "the loop is dimmed");
    console.log(`4. loop began ${firstLoop.t} ms after the hold:`, JSON.stringify(firstLoop.caption), "plies", loopPlies.join(","));

    // A new game cross-fades in, with a board drawn in every frame.
    const g2 = "run-001-chess-test-g171b";
    const frames = p.evaluate(
      () =>
        new Promise((done) => {
          const out = { frames: 0, blank: 0, outgoing: 0 };
          const t0 = performance.now();
          const tick = () => {
            out.frames++;
            const boards = document.querySelectorAll('[data-slot="engine-board"] svg');
            if (!boards.length) out.blank++;
            if (document.querySelector('[data-slot="engine-board-outgoing"]')) out.outgoing++;
            if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
            else done(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    await fire({ table: "live_games", eventType: "INSERT", new: row(g2, MOVES.slice(0, 4)), old: null });
    const f = await frames;
    await boardOf(p, g2).waitFor();
    console.log("5. new game -> cross-fade:", f, JSON.stringify(await boardOf(p, g2).innerText()));
    assert.equal(f.blank, 0, "no blank frame");
    assert(f.outgoing > 0, "the old game fades out over the new one");
    assert.equal(await boardOf(p, g1).count(), 0);
    assert.equal(await boardOf(p, g2).getAttribute("data-board"), "live");
    await ctx.close();
  }

  // --- Reduced motion ------------------------------------------------------------------------
  {
    const { ctx, p, fire } = await open(b, "reduce");
    const g3 = "run-001-chess-test-g171c";
    await fire({ table: "live_games", eventType: "INSERT", new: row(g3, MOVES.slice(0, 2)), old: null });
    await boardOf(p, g3).waitFor();
    const watching = sample(p, g3, 1500);
    await fire({ table: "live_games", eventType: "UPDATE", new: row(g3, MOVES), old: null });
    const seen = await watching;
    console.log("6. reduced motion, burst:", seen.map((s) => s.ply).join(" -> "));
    assert.deepEqual(seen.map((s) => s.ply), [2, 8], "one update per batch");
    assert.equal(await p.locator('[data-slot="engine-board"] .animate-piece-slide').count(), 0);
    for (const c of ended(g3, -1)) await fire(c);
    const after = await sample(p, g3, 4000, 100);
    console.log("7. reduced motion, ended:", after.map((s) => `${s.phase}@${s.ply}`).join(" -> "), JSON.stringify(after.at(-1).caption));
    assert.deepEqual(
      after.map((s) => s.phase).filter((ph) => ph !== "play"),
      ["hold", "rest"],
      "holds, then rests: no loop",
    );
    assert(after.every((s) => s.ply === 8));
    assert.match(after.at(-1).caption, /lost/);
    await ctx.close();
  }

  await b.close();
  console.log("ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Fleet graph ticker (#204): fakes ten `records` Realtime payloads in quick succession on the
// page's live bus (lib/liveBus.ts) and checks the ticker never shows more than one line, holds
// each line instead of flickering through the burst, and settles on the newest event. With motion
// reduced, the line swaps without animation and no outgoing line is drawn.
// Run: npm run build && npx next start -p 3204 (in web/), then
// BASE_URL=http://localhost:3204 node scripts/check-ticker.cjs
const { chromium } = require("playwright");
const assert = require("assert");

const BASE = (process.env.BASE_URL ?? "http://localhost:3204") + "/fleet";
const LINE = '[data-slot="swarm-ticker-line"]';
const LEAVING = '[data-slot="swarm-ticker-leaving"]';

const record = (run, i) => ({
  id: 9_000_000 + run * 100 + i,
  at: new Date(Date.now() + i * 10).toISOString(),
  kind: "progress",
  agent_id: null,
  track_id: "chess",
  task_id: null,
  match_id: null,
  title: `Ticker check ${run} event ${i}`,
});

const open = async (b, reducedMotion) => {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForSelector('[data-slot="swarm-graph"]');
  // The default preset shows only the big moments; progress records show under "Everything".
  await p.getByRole("button", { name: "Everything", exact: true }).click();
  // Let the intro and any catch-up of the snapshot finish first.
  await p.waitForTimeout(4000);
  return { ctx, p };
};

/** Fires ten events 30 ms apart while sampling the ticker every animation frame. */
const burst = (p, run) =>
  p.evaluate(
    ([rows, LINE, LEAVING]) =>
      new Promise((done) => {
        const seen = [];
        let maxLines = 0;
        let maxLeaving = 0;
        let animated = false;
        const t0 = performance.now();
        const sample = () => {
          const lines = document.querySelectorAll(LINE);
          const leaving = document.querySelectorAll(LEAVING);
          maxLines = Math.max(maxLines, lines.length);
          maxLeaving = Math.max(maxLeaving, [...leaving].filter((l) => l.offsetParent).length);
          const el = lines[0];
          if (el) {
            if (getComputedStyle(el).animationName !== "none") animated = true;
            const text = el.textContent;
            if (seen[seen.length - 1]?.text !== text)
              seen.push({ t: Math.round(performance.now() - t0), text });
          }
          if (performance.now() - t0 < 5000) requestAnimationFrame(sample);
          else done({ seen, maxLines, maxLeaving, animated });
        };
        requestAnimationFrame(sample);
        rows.forEach((row, i) =>
          setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent("arena:live", {
                  detail: { table: "records", eventType: "INSERT", new: row, old: null },
                }),
              ),
            i * 30,
          ),
        );
      }),
    [Array.from({ length: 10 }, (_, i) => record(run, i + 1)), LINE, LEAVING],
  );

(async () => {
  const b = await chromium.launch();
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const { ctx, p } = await open(b, reducedMotion);
    const run = reducedMotion === "reduce" ? 2 : 1;
    const r = await burst(p, run);
    const mine = r.seen.filter((s) => s.text.includes(`Ticker check ${run} `));
    console.log(reducedMotion, JSON.stringify({ ...r, seen: mine }));
    assert.equal(r.maxLines, 1, "at most one ticker line, ever");
    assert.ok(mine.length >= 1 && mine.length <= 3, `a burst of 10 shows a few lines, not 10 (${mine.length})`);
    const last = mine[mine.length - 1].text;
    assert.ok(last.includes(`Ticker check ${run} event 10`), `settles on the newest: ${last}`);
    assert.ok(/\+\d+/.test(last), "the folded events are counted (+N)");
    for (let i = 1; i < mine.length; i++)
      assert.ok(mine[i].t - mine[i - 1].t >= 900, "each line holds before the next");
    assert.equal(await p.locator(LINE).count(), 1);
    assert.match(await p.locator(LINE).textContent(), new RegExp(`Ticker check ${run} event 10`));
    if (reducedMotion === "reduce") {
      assert.equal(r.animated, false, "reduced motion: no animation on the line");
      assert.equal(r.maxLeaving, 0, "reduced motion: no outgoing line drawn");
    } else {
      assert.ok(r.maxLeaving <= 1, "at most one line leaving");
      await p.waitForTimeout(600);
      assert.equal(await p.locator(LEAVING).count(), 0, "the outgoing line is gone after its fade");
    }
    await p.screenshot({ path: `${process.env.SHOT_DIR ?? "."}/ticker-${reducedMotion}.png` });
    await ctx.close();
  }
  await b.close();
  console.log("ticker check: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

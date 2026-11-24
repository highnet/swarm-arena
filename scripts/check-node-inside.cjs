// Sector nodes carry their information inside their circles (#199). Fakes Realtime payloads on
// the page's live bus (lib/liveBus.ts): a live chess game, agents starting and stopping in the
// chess sector and a new rating, then also rewrites the overlay's text by hand (a long name, a
// long caption, a long count line). Checks, at desktop and phone width:
//   1. every overlay is its node's bounding square, centred on the drawn circle (< 1 px);
//   2. every visible element of every overlay lies inside its node's circle;
//   3. the live board's place in its circle stays fixed (< 1 px) whatever the text does;
//   4. no edge shows through the text: the body is opaque and every edge layer is drawn below it.
// Saves screenshots of a live sector, an idle sector and a phone-width view to OUT_DIR.
// Run: npm run build && npx next start -p 3163 (in web/), then
// BASE_URL=http://localhost:3163 OUT_DIR=/tmp node scripts/check-node-inside.cjs
const { chromium } = require("playwright");
const assert = require("assert");
const path = require("path");

const BASE = (process.env.BASE_URL ?? "http://localhost:3163") + "/fleet";
const OUT = process.env.OUT_DIR ?? null;
const MOVES = [
  "e2e4",
  "e7e5",
  "g1f3",
  "b8c6",
  "f1b5",
  "a7a6",
  "b5c6",
  "d7c6",
  "e1g1",
  "f7f6",
];
const GAME = "run-001-chess-test-g199";

const liveRow = (moves) => {
  const now = new Date().toISOString();
  return {
    id: GAME,
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
const agentRow = (id, status) => ({
  id,
  run_id: "run-001",
  seat: "chess/search",
  track_id: "chess",
  role: "worker",
  rp_role: "worker",
  status,
  last_seen:
    status === "working" ? new Date().toISOString() : "2026-01-01T00:00:00Z",
  sessions: 1,
  task_id: null,
  pr: null,
  activity:
    "measuring a much longer activity line than anything that fits in a circle",
});

/** Opens the fleet page and returns helpers. */
const open = async (b, opts) => {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForSelector(
    '[data-slot="swarm-node-overlay"][data-side="inside"]',
  );
  await p.waitForTimeout(2500);
  const fire = (detail) =>
    p.evaluate(
      (d) => window.dispatchEvent(new CustomEvent("arena:live", { detail: d })),
      detail,
    );
  return { ctx, p, fire, errors };
};

/** Geometry of every overlay: its circle (from the SVG body), its box, and stray elements. */
const geometry = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('[data-slot="swarm-node-overlay"]')].map(
      (o) => {
        const id = o.dataset.nodeId;
        const box = o.getBoundingClientRect();
        const R = parseFloat(o.style.getPropertyValue("--node-r"));
        const node = [...document.querySelectorAll("g.sg-node")].find(
          (g) => g.__data__?.id === id,
        );
        const path = node?.querySelector("path.sg-body");
        const body = path?.getBoundingClientRect();
        // Opaque: fill-opacity 1 and a fill with no alpha of its own.
        const fill = path ? getComputedStyle(path) : null;
        const opaque =
          !!fill &&
          fill.fillOpacity === "1" &&
          !/rgba\(.*,\s*0?\.\d+\)|\/\s*0?\.\d/.test(fill.fill);
        // Every layer drawing an edge (path with a stroke and no fill) sits before the nodes.
        const nodes = node?.parentElement;
        const layers = nodes ? [...nodes.parentElement.children] : [];
        const edgesAbove = layers
          .slice(layers.indexOf(nodes) + 1)
          .filter((g) =>
            g.querySelector('path[stroke]:not([fill]), path[fill="none"]'),
          ).length;
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const outside = [];
        for (const el of o.querySelectorAll("*")) {
          if (el.closest("svg")) continue;
          const r = el.getBoundingClientRect();
          // The layout layer spanning the whole bounding square draws nothing itself.
          if (el.dataset.slot === "sector-full") continue;
          if (
            r.width === 0 ||
            r.height === 0 ||
            !el.checkVisibility({ visibilityProperty: true })
          )
            continue;
          const far = Math.max(
            ...[
              [r.left, r.top],
              [r.right, r.top],
              [r.left, r.bottom],
              [r.right, r.bottom],
            ].map(([x, y]) => Math.hypot(x - cx, y - cy)),
          );
          if (far > R + 1)
            outside.push(
              `${el.dataset.slot ?? el.tagName} ${Math.round(far)} > ${R}: "${el.textContent.slice(0, 30)}"`,
            );
        }
        const board = o
          .querySelector('[data-slot="engine-board"] .w-16')
          ?.getBoundingClientRect();
        return {
          id,
          R,
          size: [box.width, box.height],
          centreOff: body
            ? [
                cx - (body.left + body.width / 2),
                cy - (body.top + body.height / 2),
              ]
            : null,
          bodyR: body ? body.width / 2 : null,
          opaque,
          edgesAbove,
          outside,
          // Measured from the circle's centre: a circle that grows (more effort) keeps it in place.
          board: board
            ? [board.left - cx, board.top - cy, board.width, board.height]
            : null,
        };
      },
    ),
  );

const checkInside = (geo, label) => {
  for (const g of geo) {
    assert(g.R > 0, `${label} ${g.id}: has a radius`);
    assert(
      Math.abs(g.size[0] - 2 * g.R) < 0.5 &&
        Math.abs(g.size[1] - 2 * g.R) < 0.5,
      `${label} ${g.id}: bounding square`,
    );
    assert(g.centreOff, `${label} ${g.id}: node drawn`);
    assert(
      Math.hypot(...g.centreOff) < 1,
      `${label} ${g.id}: centred on its circle (${g.centreOff})`,
    );
    assert(
      Math.abs(g.bodyR - g.R) <= 1,
      `${label} ${g.id}: radius matches (${g.bodyR} vs ${g.R})`,
    );
    assert(g.opaque, `${label} ${g.id}: its body is opaque`);
    assert.equal(
      g.edgesAbove,
      0,
      `${label} ${g.id}: no edge layer above its body`,
    );
    assert.deepEqual(
      g.outside,
      [],
      `${label} ${g.id}: everything inside its circle: ${g.outside.join(" | ")}`,
    );
  }
  console.log(
    `   ${label}: ${geo.length} overlays, all centred and inside (R ${geo.map((g) => g.R).join(", ")})`,
  );
};

const chess = (geo) => geo.find((g) => g.id === "sector:chess");

(async () => {
  const b = await chromium.launch();
  // The site has one (dark) theme; the loop is the place to add another.
  for (const colorScheme of ["dark"]) {
    const { ctx, p, fire, errors } = await open(b, {
      viewport: { width: 1400, height: 1000 },
      colorScheme,
    });
    console.log(`${colorScheme}, 1400 x 1000:`);
    checkInside(await geometry(p), "idle");
    if (OUT) {
      await p
        .locator('[data-slot="swarm-graph"]')
        .screenshot({ path: path.join(OUT, `graph-${colorScheme}.png`) });
      await p
        .locator('[data-slot="swarm-node-overlay"][data-node-id="sector:go9"]')
        .screenshot({ path: path.join(OUT, `idle-sector-${colorScheme}.png`) });
    }

    // A live game: the board appears inside the chess circle.
    await fire({
      table: "live_games",
      eventType: "INSERT",
      new: liveRow(MOVES.slice(0, 2)),
      old: null,
    });
    await p.waitForSelector(
      '[data-node-id="sector:chess"] [data-slot="engine-board"]',
    );
    await p.waitForTimeout(600);
    const start = chess(await geometry(p)).board;
    assert(start, "the chess board is drawn");
    console.log(
      `   board at ${start.map((v) => v.toFixed(2)).join(", ")} from its circle's centre`,
    );
    const drift = [];
    const step = async (what, act) => {
      await act();
      await p.waitForTimeout(700);
      const geo = await geometry(p);
      checkInside(geo, what);
      const now = chess(geo).board;
      const d = Math.max(
        Math.abs(now[0] - start[0]),
        Math.abs(now[1] - start[1]),
      );
      drift.push(d);
      assert(d < 1, `${what}: the board moved ${d.toFixed(2)} px`);
    };
    await step("moves arrive (caption changes)", () =>
      fire({
        table: "live_games",
        eventType: "UPDATE",
        new: liveRow(MOVES),
        old: null,
      }),
    );
    await p.waitForTimeout(4000);
    await step("agents start in the sector", async () => {
      for (const id of ["cd-a", "cd-b", "cd-c", "cd-d", "cd-e"])
        await fire({
          table: "agents",
          eventType: "INSERT",
          new: agentRow(id, "working"),
          old: null,
        });
    });
    if (OUT)
      await p
        .locator(
          '[data-slot="swarm-node-overlay"][data-node-id="sector:chess"]',
        )
        .screenshot({ path: path.join(OUT, `live-sector-${colorScheme}.png`) });
    await step("a new rating", () =>
      fire({
        table: "tracks",
        eventType: "UPDATE",
        new: { id: "chess", current_elo: 2417, current_version: "v0.12" },
        old: null,
      }),
    );
    await step("agents stop", async () => {
      for (const id of ["cd-a", "cd-b", "cd-c", "cd-d"])
        await fire({
          table: "agents",
          eventType: "UPDATE",
          new: agentRow(id, "idle"),
          old: null,
        });
    });
    await step("long text everywhere", () =>
      p.evaluate(() => {
        const o = document.querySelector('[data-node-id="sector:chess"]');
        const set = (sel, t) =>
          o.querySelectorAll(sel).forEach((e) => (e.textContent = t));
        set(
          '[data-slot="sector-head"] [data-slot="typography"]',
          "A very long sector name indeed",
        );
        set(
          '[data-slot="sector-foot"] [data-slot="typography"]',
          "123456 merged · 7890 today and more",
        );
        // The opponent's name; the move number beside it is never long.
        o.querySelector(
          '[data-slot="engine-board-caption"] span:not([aria-hidden])',
        ).textContent = "vs An Opponent With A Long Name Indeed";
      }),
    );
    console.log(
      `   board drift across changes: ${drift.map((d) => d.toFixed(2)).join(", ")} px`,
    );
    assert.deepEqual(errors, [], "no page errors");
    await ctx.close();
  }

  // Phone width: smaller circles fall back to the name, count and rating, still inside.
  {
    const { ctx, p, errors } = await open(b, {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    console.log("phone, 390 x 844:");
    checkInside(await geometry(p), "phone");
    if (OUT)
      await p
        .locator('[data-slot="swarm-graph"]')
        .screenshot({ path: path.join(OUT, "phone.png") });
    assert.deepEqual(errors, [], "no page errors");
    await ctx.close();
  }
  await b.close();
  console.log("ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

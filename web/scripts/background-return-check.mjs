/**
 * Browser check for coming back to the fleet graph after a long time away (issue #197).
 * Drives a running site (`next start`) in Chromium and feeds the page Realtime changes through
 * its live bus (`arena:live`, see `lib/liveBus.ts`), the way `LiveIndicator` does:
 *
 *   1. hidden: the page is hidden (`visibilityState` emulated), takes 6,000 changes (live-game
 *      moves above all, plus agents, games, records, matches, ratings), and is shown again.
 *      After it comes back, no long task may exceed LONG_TASK_MS and the JS heap (after a GC)
 *      may sit at most HEAP_GROWTH_MB above where it stood before the page was hidden.
 *   2. unfocused: the page stays visible (no visibilitychange) while a simulated two hours pass
 *      (Playwright's clock) and 24,000 changes arrive. The heap after a GC at the end may sit at
 *      most PLATEAU_MB above the heap after the first quarter: growth is bounded, not linear.
 *   3. reduced motion: hidden, the same changes, shown again: the catch-up does not play, the
 *      final state lands at once (the graph has no catch-up bar within a second).
 *
 * Run: node web/scripts/background-return-check.mjs [base-url] (default http://localhost:3000;
 * needs Playwright's Chromium). Exits 1 on a failed check.
 */
import { createRequire } from 'node:module';

// Playwright resolves wherever it is installed (it is not a dependency of this package).
const { chromium } = createRequire(import.meta.url)('playwright');

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const LONG_TASK_MS = 200;
const HEAP_GROWTH_MB = 40;
const PLATEAU_MB = 15;
const HIDDEN_CHANGES = 6_000;
const UNFOCUSED_CHANGES = 24_000;

/** Legal games, one per engine (the boards replay them, so moves must be real). */
const LINES = {
  chess: [
    'e2e3',
    'g8f6',
    'h2h4',
    'c7c5',
    'g1f3',
    'd7d5',
    'f1e2',
    'd5d4',
    'e1g1',
    'b8c6',
    'e3d4',
    'c5d4',
    'f1e1',
    'a7a5',
    'b2b3',
    'c8f5',
    'c1b2',
    'e7e6',
    'e2b5',
    'f8c5',
    'a2a4',
    'e8g8',
    'd1e2',
    'a8c8',
    'b1a3',
    'h7h5',
    'b5c6',
    'c8c6',
    'd2d3',
    'c6c7',
    'a1c1',
    'c7d7',
    'a3b5',
    'b7b6',
    'e2e5',
    'g7g6',
    'e5f4',
    'f6d5',
    'f4g3',
    'd5b4',
    'b2d4',
    'c5d4',
    'f3d4',
    'd7d4',
    'b5d4',
    'd8d4',
    'c2c3',
    'd4d5',
    'c3b4',
    'd5b3',
    'b4a5',
    'b6a5',
    'g3f4',
    'b3d3',
    'c1c5',
    'f8a8',
    'f4e5',
    'd3d8',
    'g2g3',
    'f7f6',
    'e5c3',
    'e6e5',
    'c5c7',
    'e5e4',
    'c3c4',
    'g8h8',
    'c4f7',
    'd8c7',
    'f7c7',
    'h8g8',
    'e1d1',
    'a8f8',
    'd1c1',
    'f8c8',
    'c7c8',
    'f5c8',
    'c1c8',
    'g8f7',
    'c8c7',
    'f7e6',
  ],
  go9: [
    'e7',
    'c6',
    'e5',
    'd4',
    'e3',
    'e4',
    'f4',
    'f6',
    'd6',
    'd5',
    'e6',
    'f5',
    'c7',
    'f8',
    'f7',
    'g7',
    'e8',
    'f3',
    'g4',
    'g3',
    'g6',
    'd3',
    'b6',
    'h4',
    'g5',
    'b4',
    'e2',
    'h2',
    'd2',
    'c3',
    'c5',
    'c2',
    'h5',
    'j5',
    'j6',
    'j4',
    'a5',
    'h7',
    'h6',
    'h9',
    'j8',
    'b5',
    'a4',
    'j7',
    'f9',
    'a7',
    'a6',
    'f5',
    'f6',
    'b7',
    'c8',
    'a2',
    'e1',
    'h8',
    'e9',
    'j3',
    'b8',
    'c4',
    'c6',
    'g8',
    'a9',
    'b9',
    'c9',
    'j2',
    'f1',
    'a1',
    'a3',
    'd1',
    'f2',
    'g1',
    'j1',
    'g9',
    'd9',
    'd7',
    'j9',
    'b2',
    'h7',
    'g7',
    'h9',
    'f8',
  ],
  othello: [
    'd3',
    'c3',
    'f5',
    'e3',
    'd2',
    'f6',
    'f4',
    'c5',
    'c4',
    'g5',
    'c6',
    'g3',
    'c2',
    'b4',
    'b5',
    'd6',
    'f3',
    'e2',
    'f2',
    'f1',
    'd7',
    'a6',
    'b3',
    'a3',
    'g4',
    'h4',
    'g6',
    'e1',
    'e6',
    'd1',
    'a4',
    'a5',
    'b6',
    'a7',
    'h5',
    'c8',
    'd8',
    'e8',
    'c7',
    'f7',
    'e7',
    'f8',
    'b2',
    'h6',
    'b1',
    'b7',
    'h2',
    'g2',
    'c1',
    'a1',
    'a2',
    'pass',
    'a8',
    'pass',
    'b8',
    'pass',
    'h1',
    'g1',
    'g8',
    'g7',
    'h3',
    'pass',
    'h7',
    'h8',
  ],
  hex: [
    'g8',
    'f10',
    'f7',
    'g5',
    'e6',
    'h9',
    'f4',
    'e7',
    'd7',
    'c9',
    'd9',
    'd8',
    'f6',
    'e8',
    'b9',
    'b10',
    'g10',
    'f8',
    'g7',
    'g9',
    'f9',
    'e10',
    'i8',
    'i9',
    'j8',
    'j9',
    'e9',
    'c11',
    'c10',
    'b11',
    'd11',
    'd10',
    'j10',
    'k8',
    'a10',
    'a11',
  ],
};

/**
 * In the page: a generator of plausible Realtime changes. Eight live games at a time (two per
 * engine) gain a move per change, replaying real games (`LINES`); at the last move a game ends (its `games` row, then the
 * `live_games` delete) and a new one starts. Every so often an agent steps, a record lands, a
 * match updates, a rating moves.
 */
const installFeed = (lines) => {
  const tracks = ['chess', 'go9', 'othello', 'hex'];
  const seats = Array.from({ length: 12 }, (_, i) => `Seat ${i}`);
  let n = 0;
  let gameNo = 0;
  const games = Array.from({ length: 8 }, (_, i) => ({
    id: `check-${tracks[i % 4]}-g${gameNo++}`,
    track: tracks[i % 4],
    moves: [],
  }));
  const send = (change) => window.dispatchEvent(new CustomEvent('arena:live', { detail: change }));
  const iso = () => new Date().toISOString();
  const one = () => {
    n++;
    const at = iso();
    if (n % 25 === 0) {
      const s = seats[n % seats.length];
      send({
        table: 'agents',
        eventType: 'UPDATE',
        old: null,
        new: {
          id: s,
          run_id: 'run-001',
          seat: s,
          track_id: tracks[n % 4],
          role: 'builder',
          status: 'working',
          last_seen: at,
          sessions: 1,
          rp_role: 'worker',
          task_id: null,
          pr: null,
          activity: `step ${n}`,
          session_id: `sess-${s}`,
          started_at: at,
        },
      });
      return;
    }
    if (n % 97 === 0) {
      send({
        table: 'records',
        eventType: 'INSERT',
        old: null,
        new: {
          id: 1_000_000 + n,
          run_id: 'run-001',
          at,
          kind: 'progress',
          track_id: tracks[n % 4],
          agent_id: seats[n % seats.length],
          task_id: null,
          match_id: null,
          title: `Progress ${n}`,
          detail: null,
          data: {},
        },
      });
      return;
    }
    if (n % 401 === 0) {
      const t = tracks[n % 4];
      send({
        table: 'tracks',
        eventType: 'UPDATE',
        old: null,
        new: {
          id: t,
          run_id: 'run-001',
          name: t,
          color_slot: n % 4,
          current_elo: 1300 + (n % 200),
          current_version: 'v0.7',
        },
      });
      return;
    }
    if (n % 211 === 0) {
      const t = tracks[n % 4];
      send({
        table: 'matches',
        eventType: 'UPDATE',
        old: null,
        new: {
          id: `check-match-${t}-${Math.floor(n / 4000)}`,
          run_id: 'run-001',
          track_id: t,
          engine_version: 'v0.8',
          opponent: 'Reference',
          opponent_elo: 1500,
          purpose: 'gate',
          wins: n % 7,
          draws: 1,
          losses: n % 5,
          elo: null,
          elo_error: null,
          started_at: at,
          finished_at: null,
        },
      });
      return;
    }
    const g = games[n % games.length];
    g.moves.push(lines[g.track][g.moves.length]);
    const row = {
      id: g.id,
      run_id: 'run-001',
      match_id: `check-match-${g.track}-${Math.floor(n / 4000)}`,
      track_id: g.track,
      candidate_version: 'v0.8',
      opponent: 'Reference',
      engine_first: true,
      moves: [...g.moves],
      ply: g.moves.length,
      started_at: at,
      updated_at: at,
    };
    if (g.moves.length < lines[g.track].length) {
      send({ table: 'live_games', eventType: 'UPDATE', old: null, new: row });
      return;
    }
    send({
      table: 'games',
      eventType: 'INSERT',
      old: null,
      new: {
        id: g.id,
        run_id: 'run-001',
        match_id: row.match_id,
        track_id: g.track,
        ply_count: row.ply,
        engine_first: true,
        outcome: 1,
        termination: 'rules',
        moves: row.moves,
        finished_at: at,
      },
    });
    send({ table: 'live_games', eventType: 'DELETE', old: { id: g.id }, new: null });
    g.id = `check-${g.track}-g${gameNo++}`;
    g.moves = [];
  };
  window.__feed = (count) => {
    for (let i = 0; i < count; i++) one();
  };
};

/**
 * In the page: hide or show it as a background tab does. `visibilityState` flips and animation
 * frames stop while hidden (the queued ones run on return, as a browser runs them).
 */
const setHidden = (hidden) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  if (hidden && !window.__realRaf) {
    window.__realRaf = window.requestAnimationFrame;
    window.__rafQueue = [];
    window.requestAnimationFrame = (cb) => window.__rafQueue.push(cb);
  } else if (!hidden && window.__realRaf) {
    window.requestAnimationFrame = window.__realRaf;
    delete window.__realRaf;
    const queued = window.__rafQueue;
    window.requestAnimationFrame((t) => queued.forEach((cb) => cb(t)));
  }
  document.dispatchEvent(new Event('visibilitychange'));
};

const heapMb = async (cdp) => {
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize / 2 ** 20;
};

const open = async (browser, opts = {}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (opts.clock) await page.clock.install();
  await page.addInitScript(installFeed, LINES);
  await page.goto(`${base}/fleet`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-slot="swarm-graph"]');
  await page.waitForTimeout(4_000);
  // A page that failed to hydrate would pass everything below trivially: insist it is drawn.
  const drawn = await page.locator('[data-slot="swarm-graph"] g.sg-node').count();
  if (!drawn) throw new Error(`${base}/fleet did not draw the graph (no nodes)`);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  return { context, page, cdp, errors };
};

/** Feed `count` changes in batches, yielding between them as a real stream would. */
const feed = async (page, count, between) => {
  const batch = 200;
  for (let done = 0; done < count; done += batch) {
    const t0 = Date.now();
    await page.evaluate((k) => window.__feed(k), Math.min(batch, count - done));
    if (process.env.VERBOSE) console.log(`  fed ${done + batch} (${Date.now() - t0} ms)`);
    await between?.(done);
  }
};

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
try {
  // 1. Hidden, thousands of changes, back again.
  {
    const { context, page, cdp, errors } = await open(browser);
    const before = await heapMb(cdp);
    await page.evaluate(setHidden, true);
    await feed(page, HIDDEN_CHANGES, () => page.waitForTimeout(5));
    const hiddenHeap = await heapMb(cdp);
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__long.push(Math.round(e.duration));
      }).observe({ type: 'longtask' });
    });
    await page.evaluate(setHidden, false);
    // The catch-up lasts at most CATCH_UP_MS (5 s) plus its slack; keep watching past it.
    await page.waitForTimeout(8_000);
    const long = await page.evaluate(() => window.__long);
    const after = await heapMb(cdp);
    const worst = long.length ? Math.max(...long) : 0;
    console.log(
      `hidden: heap ${before.toFixed(1)} MB before, ${hiddenHeap.toFixed(1)} MB hidden after ${HIDDEN_CHANGES} changes, ${after.toFixed(1)} MB after the catch-up; long tasks after return: [${long.join(', ')}] ms`,
    );
    check(
      worst <= LONG_TASK_MS,
      `no long task over ${LONG_TASK_MS} ms after coming back (worst ${worst} ms)`,
    );
    check(
      after - before <= HEAP_GROWTH_MB,
      `heap within ${HEAP_GROWTH_MB} MB of where it stood (+${(after - before).toFixed(1)} MB)`,
    );
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await context.close();
  }

  // 2. Visible but unfocused for two simulated hours.
  {
    const { context, page, cdp, errors } = await open(browser, { clock: true });
    const quarter = UNFOCUSED_CHANGES / 4;
    const marks = [];
    await feed(page, UNFOCUSED_CHANGES, async (done) => {
      // 24,000 changes over two hours: 200 changes a minute.
      await page.clock.fastForward(60_000);
      await page.waitForTimeout(2);
      if ((done + 200) % quarter === 0) marks.push(await heapMb(cdp));
    });
    console.log(
      `unfocused: heap after each quarter: ${marks.map((m) => m.toFixed(1)).join(', ')} MB`,
    );
    check(
      marks.at(-1) - marks[0] <= PLATEAU_MB,
      `heap stops growing while visible for hours (+${(marks.at(-1) - marks[0]).toFixed(1)} MB from the first quarter, bound ${PLATEAU_MB} MB)`,
    );
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await context.close();
  }

  // 3. Reduced motion lands the final state at once.
  {
    const { context, page, errors } = await open(browser, { reducedMotion: true });
    await page.evaluate(setHidden, true);
    await feed(page, 2_000, () => page.waitForTimeout(5));
    await page.evaluate(setHidden, false);
    await page.waitForTimeout(1_000);
    const playing = await page.locator('[data-slot="swarm-catch-up"]').count();
    check(playing === 0, 'reduced motion: no catch-up playback, the final state shows at once');
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await context.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');

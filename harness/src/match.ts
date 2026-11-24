import {
  drawFromSuite,
  GAMES,
  performanceElo,
  playMatch,
  type GameId,
  type GameRecord,
  type Match,
  type Mover,
  type Rung,
} from "@arena/shared";
import { now, post } from "./board";
import { LIVE_MS, log, MOVE_MS, MOVE_SLACK_MS, RUN_ID } from "./config";
import { liveStream, type LiveGame } from "./live";
import { getStore } from "./store";
import { loadSuite, suiteName } from "./openings";

/**
 * How many times in a row one game may be replayed because the reference timed out or crashed.
 * A reference forfeit is not a result (#131); past this the match aborts with an error.
 */
export const REFERENCE_REPLAYS = 3;

export type MatchSpec = {
  track: GameId;
  candidate: Mover;
  candidateVersion: string;
  opponent: Mover;
  opponentLabel: string;
  opponentElo: number;
  pairs: number;
  /**
   * The opponent is a reference (built-in or external), not an arena engine: its timeouts and
   * crashes void the game and replay it (REFERENCE_REPLAYS). Default true. Set false when the
   * opponent is a version of our own engine, whose forfeits are results.
   */
  referenceOpponent?: boolean;
  purpose: Match["purpose"];
  taskId?: string | null;
  /**
   * Seed for each pair's opening: distinct entries of the track's balanced suite
   * (shared/src/openings/<track>.txt), or #103's random lines when it has none or too few. Omit to
   * start every game from the initial position (calibration does). One submit uses one seed for
   * all its gate matches.
   */
  openingSeed?: number;
};

/** Play a match, store every game, and post the verdict. Returns the performance estimate. */
export const runMatch = async (spec: MatchSpec) => {
  const db = getStore();
  const suite =
    spec.openingSeed === undefined ? undefined : loadSuite(spec.track);
  const fromSuite =
    suite !== undefined &&
    spec.openingSeed !== undefined &&
    drawFromSuite(GAMES[spec.track], suite, spec.pairs, spec.openingSeed) !==
      null;
  const seedNote =
    spec.openingSeed === undefined
      ? ""
      : fromSuite
        ? `, balanced openings from ${suiteName(spec.track)}, seed ${spec.openingSeed}`
        : `, random openings from seed ${spec.openingSeed}`;
  const id = `${RUN_ID}-${spec.track}-${Date.now().toString(36)}`;
  await db.insert("matches", {
    id,
    run_id: RUN_ID,
    track_id: spec.track,
    engine_version: spec.candidateVersion,
    opponent: spec.opponentLabel,
    opponent_elo: spec.opponentElo,
    purpose: spec.purpose,
    wins: 0,
    draws: 0,
    losses: 0,
    elo: 0,
    elo_error: 0,
    started_at: now(),
    finished_at: null,
  });
  log(
    `match ${id}: ${spec.candidateVersion} vs ${spec.opponentLabel}, ${spec.pairs * 2} games${seedNote}`,
  );
  if (spec.taskId) {
    const what = {
      calibration: "Smoke test",
      gate: "Gate match",
      ladder: "Ladder match",
    }[spec.purpose];
    await post("progress", {
      track_id: spec.track,
      agent_id: "referee",
      task_id: spec.taskId,
      match_id: id,
      title: `${what} started: ${spec.candidateVersion} vs ${spec.opponentLabel}, ${spec.pairs * 2} games${seedNote}.`,
    });
  }
  const forfeits: string[] = [];
  const tally = { w: 0, l: 0, d: 0 };
  // Each game streams to live_games while it is played; nothing here awaits it (see live.ts).
  const live = liveStream(
    db,
    {
      run_id: RUN_ID,
      match_id: id,
      track_id: spec.track,
      candidate_version: spec.candidateVersion,
      opponent: spec.opponentLabel,
    },
    { log, intervalMs: LIVE_MS },
  );
  let current: LiveGame | null = null;
  // playMatch does not await onGame: keep its writes so the live rows can be cleared after them.
  const stored: Promise<void>[] = [];
  const storeGame = async (
    g: GameRecord,
    i: number,
    finished: LiveGame | null,
  ) => {
    const engineFirst = i % 2 === 0;
    const s = engineFirst ? g.outcome : 1 - g.outcome;
    tally[s === 1 ? "w" : s === 0 ? "l" : "d"]++;
    log(
      `  game ${i + 1}/${spec.pairs * 2}: ${s === 1 ? "win" : s === 0 ? "loss" : "draw"} (${g.termination}, ${g.moves.length} plies) · ${spec.candidateVersion} ${tally.w}–${tally.l}–${tally.d} vs ${spec.opponentLabel}`,
    );
    if (g.offender !== null && (g.offender === 0) === engineFirst) {
      forfeits.push(
        `${g.termination}${g.detail ? ` (${g.detail.slice(0, 40)})` : ""}`,
      );
    }
    try {
      await db.insert("games", {
        id: `${id}-g${i + 1}`,
        run_id: RUN_ID,
        match_id: id,
        track_id: spec.track,
        ply_count: g.moves.length,
        engine_first: engineFirst,
        outcome: g.outcome,
        termination: g.termination,
        moves: g.moves,
        finished_at: now(),
      });
    } finally {
      // The finished game is in `games` now: its live row goes.
      finished?.end();
    }
  };
  const result = await playMatch(
    GAMES[spec.track],
    spec.candidate,
    spec.opponent,
    spec.pairs,
    {
      moveTimeMs: MOVE_MS + MOVE_SLACK_MS,
      openingSeed: spec.openingSeed,
      openingSuite: suite,
      replayOpponentFailures:
        spec.referenceOpponent === false ? 0 : REFERENCE_REPLAYS,
      onGameStart: (i, attempt, opening) => {
        current?.end();
        current = live.start(
          `${id}-g${i + 1}${attempt ? `-r${attempt}` : ""}`,
          i % 2 === 0,
          opening,
        );
      },
      onMove: (move, ply) => current?.move(move, ply),
      onVoid: (g, i, attempt) => {
        current?.end();
        current = null;
        log(
          `  game ${i + 1}/${spec.pairs * 2}: voided, ${spec.opponentLabel} ${g.termination} at ${g.moves.length} plies (attempt ${attempt + 1}); restarted it, replaying the same opening`,
        );
      },
      onGame: (g, i) => {
        const finished = current;
        current = null;
        stored.push(storeGame(g, i, finished));
      },
    },
  ).finally(async () => {
    current?.end();
    await Promise.allSettled(stored);
    // Bounded: a hung store cannot hold the match open.
    await live.flush(2000);
  });
  const voided = result.voided.map(
    (v) =>
      `game ${v.index + 1}: ${spec.opponentLabel} ${v.termination} at ${v.plies} plies`,
  );
  const games = result.wins + result.draws + result.losses;
  const est = performanceElo([
    { opponentElo: spec.opponentElo, score: result.score, games },
  ]);
  await db.update(
    "matches",
    { id },
    {
      wins: result.wins,
      draws: result.draws,
      losses: result.losses,
      elo: Math.round(est.elo),
      elo_error: Math.round(est.error),
      finished_at: now(),
    },
  );
  const score = `${result.wins}–${result.losses}${result.draws ? `–${result.draws}` : ""}`;
  await post("match_verdict", {
    track_id: spec.track,
    agent_id: "referee",
    match_id: id,
    task_id: spec.taskId ?? null,
    title: `${GAMES[spec.track].name} ${spec.candidateVersion} vs ${spec.opponentLabel}: ${score}`,
    detail: `Performance ${Math.round(est.elo)} ± ${Math.round(est.error)} over ${games} games${seedNote}.${forfeits.length ? ` ${forfeits.length} forfeits by the engine.` : ""}${voided.length ? ` ${voided.length} games voided and replayed: the reference timed out or crashed (${voided.join("; ")}).` : ""}`,
    data: {
      wins: result.wins,
      draws: result.draws,
      losses: result.losses,
      elo: Math.round(est.elo),
      error: Math.round(est.error),
      forfeits,
      voided,
      opening_seed: result.openingSeed,
      opening_source: result.openingSource,
      // 1-based, in file order: entry n is the n-th opening line of the suite.
      opening_entries: result.openingEntries?.map((i) => i + 1) ?? null,
    },
  });
  return { matchId: id, est, result, forfeits, voided };
};

/**
 * The rung a version should be measured against: the first one not yet cleared, or null once
 * the whole ladder is cleared (the gate is then played against the current version itself).
 */
export const gateRung = (rungs: Rung[], currentElo: number | null) =>
  currentElo === null ? rungs[0] : (rungs.find((r) => !r.cleared_at) ?? null);

export const moveMs = () => MOVE_MS;

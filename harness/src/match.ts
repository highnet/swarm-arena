import {
  GAMES,
  performanceElo,
  playMatch,
  type GameId,
  type Match,
  type Mover,
  type Rung,
} from "@arena/shared";
import { now, post } from "./board";
import { log, MOVE_MS, MOVE_SLACK_MS, RUN_ID } from "./config";
import { getStore } from "./store";

export type MatchSpec = {
  track: GameId;
  candidate: Mover;
  candidateVersion: string;
  opponent: Mover;
  opponentLabel: string;
  opponentElo: number;
  pairs: number;
  purpose: Match["purpose"];
  taskId?: string | null;
  /**
   * Seed for each pair's random opening (`matchOpenings`). Omit to start every game from the
   * initial position (calibration does). One submit uses one seed for all its gate matches.
   */
  openingSeed?: number;
};

/** Play a match, store every game, and post the verdict. Returns the performance estimate. */
export const runMatch = async (spec: MatchSpec) => {
  const db = getStore();
  const seedNote =
    spec.openingSeed === undefined
      ? ""
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
  const result = await playMatch(
    GAMES[spec.track],
    spec.candidate,
    spec.opponent,
    spec.pairs,
    {
      moveTimeMs: MOVE_MS + MOVE_SLACK_MS,
      openingSeed: spec.openingSeed,
      onGame: async (g, i) => {
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
      },
    },
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
    detail: `Performance ${Math.round(est.elo)} ± ${Math.round(est.error)} over ${games} games${seedNote}.${forfeits.length ? ` ${forfeits.length} forfeits by the engine.` : ""}`,
    data: {
      wins: result.wins,
      draws: result.draws,
      losses: result.losses,
      elo: Math.round(est.elo),
      error: Math.round(est.error),
      forfeits,
      opening_seed: result.openingSeed,
    },
  });
  return { matchId: id, est, result, forfeits };
};

/**
 * The rung a version should be measured against: the first one not yet cleared, or null once
 * the whole ladder is cleared (the gate is then played against the current version itself).
 */
export const gateRung = (rungs: Rung[], currentElo: number | null) =>
  currentElo === null ? rungs[0] : (rungs.find((r) => !r.cleared_at) ?? null);

export const moveMs = () => MOVE_MS;

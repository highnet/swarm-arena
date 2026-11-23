/**
 * Generates the SAMPLE run the site ships with until a real run exists.
 *
 * Everything here is synthetic and the run is flagged `is_sample`, which makes the site label
 * every view SAMPLE. The replayed games are real, legal games played by the referee between
 * simple reference players, so the boards are genuine positions even though the engines,
 * agents and Elo curve are illustrative.
 *
 * Writes web/data/sample.json and supabase/seed.sql.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAMES,
  TRACKS,
  chess,
  expectedScore,
  mctsPlayer,
  performanceElo,
  playGame,
  randomPlayer,
  rng,
  type Agent,
  type BoardRecord,
  type EloPoint,
  type GameId,
  type GameRow,
  type Match,
  type Mover,
  type RecordKind,
  type Rung,
  type Snapshot,
  type Task,
  type Track,
} from '@arena/shared';
import type { ChessState } from '@arena/shared';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUN_ID = 'sample-001';
const START = Date.parse('2026-11-20T09:00:00Z');
const HOURS = 71;
const rand = rng(20261120);

const iso = (t: number) => new Date(t).toISOString();

/** A cheap chess player that grabs material and mates when it can; good enough for sample replays. */
const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const greedyChess = (seed: number): Mover => {
  const r = rng(seed);
  return {
    id: 'greedy',
    choose: async (rules, state) => {
      const s = state as unknown as ChessState;
      let best: string[] = [];
      let bestScore = -Infinity;
      for (const m of chess.legalMoves(s)) {
        const next = chess.play(s, m);
        const o = chess.outcome(next);
        let score = r() * 0.5;
        if (o !== null && o !== 0.5) score += 1000;
        const side = s.fen.split(' ')[1] === 'w' ? 1 : -1;
        for (const ch of next.fen.split(' ')[0]) {
          const v = VALUES[ch.toLowerCase()];
          if (v !== undefined) score += (ch === ch.toUpperCase() ? v : -v) * side;
        }
        if (score > bestScore) {
          bestScore = score;
          best = [m];
        }
      }
      void rules;
      return best[0];
    },
  };
};

const samplePlayers = (game: GameId, seed: number): [Mover, Mover] => {
  switch (game) {
    case 'chess':
      return [greedyChess(seed), greedyChess(seed + 1)];
    case 'othello':
      return [mctsPlayer(120, seed), mctsPlayer(80, seed + 1)];
    case 'hex':
      return [mctsPlayer(400, seed), mctsPlayer(250, seed + 1)];
    case 'go9':
      return [mctsPlayer(60, seed), mctsPlayer(30, seed + 1)];
  }
};

type Plan = {
  /** Target Elo after each landed patch. */
  curve: number[];
  ideas: { title: string; seat: string; spec: string; landed: boolean; why?: string }[];
};

/** Illustrative build plans, one per track. Landed ideas raise Elo along `curve`. */
const PLANS: Record<GameId, Plan> = {
  chess: {
    curve: [40, 310, 520, 760, 910, 1040, 1180, 1265, 1340, 1420],
    ideas: [
      { title: 'Bitboard move generator, perft-verified to depth 5', seat: 'chess/movegen', spec: 'Pseudo-legal bitboard generation with legality filter. Gate: perft matches reference counts for six positions.', landed: true },
      { title: 'Alpha-beta search with iterative deepening', seat: 'chess/search', spec: 'Negamax alpha-beta, iterative deepening to the time limit, material-only eval.', landed: true },
      { title: 'Piece-square tables (tapered middlegame/endgame)', seat: 'chess/eval', spec: 'Add PSTs with a game-phase taper.', landed: true },
      { title: 'Quiescence search on captures', seat: 'chess/search', spec: 'Extend leaf nodes with capture-only search, MVV-LVA ordering.', landed: true },
      { title: 'Transposition table (Zobrist, 64 MB)', seat: 'chess/search', spec: 'Always-replace TT keyed by Zobrist hash; store bound type and best move.', landed: true },
      { title: 'Null-move pruning in all positions', seat: 'chess/search', spec: 'R=3 null move everywhere.', landed: false, why: 'Lost 31 Elo in the gate: zugzwang blunders in pawn endgames. Retry only with a material guard.' },
      { title: 'Killer moves and history heuristic', seat: 'chess/search', spec: 'Two killer slots per ply plus butterfly history for quiet-move ordering.', landed: true },
      { title: 'Null-move pruning with non-pawn material guard', seat: 'chess/search', spec: 'Skip null move when side to move has only pawns.', landed: true },
      { title: 'Late move reductions', seat: 'chess/search', spec: 'Reduce quiet moves after the fourth by one ply; re-search on fail-high.', landed: true },
      { title: 'Hand-tuned king safety term', seat: 'chess/eval', spec: 'Penalise open files and missing pawn shield near the king.', landed: false, why: 'Inside error bars after 400 games (+4 ± 22). Tuning by hand stalled; next try is Texel tuning.' },
      { title: 'Passed-pawn and mobility evaluation', seat: 'chess/eval', spec: 'Rank-scaled passed pawn bonus; mobility counts for minor pieces.', landed: true },
      { title: 'Aspiration windows', seat: 'chess/search', spec: 'Narrow windows around the previous iteration score.', landed: true },
    ],
  },
  go9: {
    curve: [30, 260, 430, 560, 690, 790, 880],
    ideas: [
      { title: 'Board, captures, superko, Tromp-Taylor scoring', seat: 'go/rules', spec: 'Rules core verified against the referee on 10k random games.', landed: true },
      { title: 'UCT tree search with random playouts', seat: 'go/tree', spec: 'UCT with eye-aware random playouts, 2k playouts per move.', landed: true },
      { title: 'RAVE / AMAF statistics', seat: 'go/tree', spec: 'Blend AMAF values into UCT selection.', landed: true },
      { title: '3×3 pattern playout policy', seat: 'go/playout', spec: 'Mogo-style 3x3 patterns bias the playouts.', landed: true },
      { title: 'Ladder reader in playouts', seat: 'go/playout', spec: 'Detect working ladders and avoid running them.', landed: false, why: 'Playouts slowed 4x; net −58 Elo at equal time. Graveyard.' },
      { title: 'Atari capture/escape heuristics', seat: 'go/playout', spec: 'Prefer capturing or saving groups in atari during playouts.', landed: true },
      { title: 'Tree reuse between moves', seat: 'go/tree', spec: 'Keep the subtree of the played move.', landed: true },
      { title: 'Neural value net (tiny CNN)', seat: 'go/tree', spec: 'Train a 6-layer CNN on self-play.', landed: false, why: 'Not trainable on CPU in budget; 40 self-play games/hour. Parked.' },
      { title: 'Progressive widening at the root', seat: 'go/tree', spec: 'Limit root branching early, widen with visits.', landed: true },
    ],
  },
  othello: {
    curve: [60, 420, 700, 930, 1110, 1240, 1340],
    ideas: [
      { title: 'Bitboard move generation with flips', seat: 'othello/movegen', spec: 'Kogge-Stone style shifts for all 8 directions.', landed: true },
      { title: 'Alpha-beta with disc-count evaluation', seat: 'othello/search', spec: 'Baseline search.', landed: true },
      { title: 'Mobility + corner + stability evaluation', seat: 'othello/eval', spec: 'Weighted sum of mobility, corner ownership and edge stability.', landed: true },
      { title: 'Exact endgame solver from 14 empties', seat: 'othello/search', spec: 'Switch to perfect play when 14 squares remain.', landed: true },
      { title: 'Opening book from self-play', seat: 'othello/book', spec: 'Build a 6-ply book from 2k self-play games.', landed: false, why: 'Book lines were dominated by early engine mistakes; −12 ± 30. Dead until the engine is stronger.' },
      { title: 'Edge pattern tables', seat: 'othello/eval', spec: 'Index edge configurations into 3^8 tables tuned by regression.', landed: true },
      { title: 'Move ordering by shallow search', seat: 'othello/search', spec: 'Order moves by a depth-2 search score.', landed: true },
    ],
  },
  hex: {
    curve: [80, 400, 640, 860, 1040, 1230],
    ideas: [
      { title: 'Union-find win detection', seat: 'hex/rules', spec: 'O(α) connection check per move.', landed: true },
      { title: 'MCTS with uniform random fill-in playouts', seat: 'hex/mcts', spec: 'Random fill to the end then a single connection check.', landed: true },
      { title: 'Bridge-save playout rule', seat: 'hex/mcts', spec: 'When the opponent intrudes a bridge, answer the other cell.', landed: true },
      { title: 'Two-distance evaluation for move priors', seat: 'hex/eval', spec: 'Shannon two-distance as a prior on child nodes.', landed: true },
      { title: 'Virtual-connection engine (H-search)', seat: 'hex/eval', spec: 'Compute virtual connections for pruning.', landed: false, why: 'Implementation correct but too slow at 11×11 under 1s/move. Graveyard.' },
      { title: 'Dead-cell and captured-cell pruning', seat: 'hex/mcts', spec: 'Remove provably dead cells from consideration.', landed: true },
      { title: 'Parallel root MCTS (4 threads)', seat: 'hex/mcts', spec: 'Independent trees merged at the root.', landed: true },
    ],
  },
};

const STRATEGY = [
  { h: 0, title: 'Run opened. Four tracks, one rule: no number without a match.', detail: 'Each track starts from an empty crate. First rung for every engine is the random mover; the referee rejects any illegal move as a forfeit.' },
  { h: 14, title: 'Chess search seats go first; eval waits for a stable search.', detail: 'Two builders on search, one on eval. Eval patches are gated against the same search version to keep comparisons clean.' },
  { h: 30, title: 'Go is the slowest climber. Moving a builder from Othello to Go playouts.', detail: 'Othello is ahead of its curve; Go playout quality is the bottleneck.' },
  { h: 47, title: 'Hex reached its finish line. Hex seats move to Go.', detail: 'Hex is closed unless a regression shows up in the nightly ladder.' },
  { h: 62, title: 'Next 24h: chess targets Stockfish level 6, Go targets GNU Go level 1.', detail: 'Chess eval moves to Texel tuning after the hand-tuned king safety stalled.' },
];

const main = async () => {
  const tracks: Track[] = [];
  const rungs: Rung[] = [];
  const agents: Agent[] = [];
  const tasks: Task[] = [];
  const records: BoardRecord[] = [];
  const matches: Match[] = [];
  const games: GameRow[] = [];
  const elo: EloPoint[] = [];
  let recordId = 1;

  const record = (
    at: number,
    kind: RecordKind,
    fields: Partial<BoardRecord> & { title: string },
  ) => {
    records.push({
      id: recordId++,
      run_id: RUN_ID,
      at: iso(at),
      kind,
      track_id: null,
      agent_id: null,
      task_id: null,
      match_id: null,
      detail: null,
      data: {},
      ...fields,
    });
  };

  const agent = (seat: string, track: GameId | null, role: Agent['role']) => {
    const id = seat.replace('/', '-');
    if (!agents.find((a) => a.id === id)) {
      agents.push({
        id,
        run_id: RUN_ID,
        seat,
        track_id: track,
        role,
        status: 'idle',
        last_seen: iso(START),
        sessions: 0,
      });
    }
    return agents.find((a) => a.id === id)!;
  };

  const strategist = agent('strategist', null, 'strategist');
  const referee = agent('referee', null, 'referee');
  for (const s of STRATEGY) {
    record(START + s.h * 3600_000, 'strategy', {
      agent_id: strategist.id,
      title: s.title,
      detail: s.detail,
    });
    strategist.sessions++;
  }

  for (const spec of TRACKS) {
    const plan = PLANS[spec.id];
    const finishRung = spec.rungs.find((r) => r.label === spec.finishLabel)!;
    const track: Track = {
      id: spec.id,
      run_id: RUN_ID,
      name: spec.name,
      color_slot: spec.colorSlot,
      finish_label: spec.finishLabel,
      finish_elo: finishRung.elo,
      current_elo: null,
      current_version: null,
    };
    tracks.push(track);
    spec.rungs.forEach((r, position) =>
      rungs.push({
        id: `${spec.id}-${position}`,
        run_id: RUN_ID,
        track_id: spec.id,
        position,
        label: r.label,
        opponent: r.opponent,
        elo: r.elo,
        cleared_at: null,
        cleared_by_match: null,
      }),
    );

    const landedCount = plan.ideas.filter((i) => i.landed).length;
    const span = (HOURS - 2) * 3600_000;
    let landedIndex = 0;
    let version = 0;
    const trackRungs = rungs.filter((r) => r.track_id === spec.id);
    const pace = spec.id === 'hex' ? 0.66 : 1;

    for (const [n, idea] of plan.ideas.entries()) {
      const t0 = START + ((n + 0.3) / plan.ideas.length) * span * pace + rand() * 1800_000;
      const builder = agent(idea.seat, spec.id, 'builder');
      builder.sessions += 1 + Math.floor(rand() * 3);
      const taskId = `${spec.id}-t${n + 1}`;
      const task: Task = {
        id: taskId,
        run_id: RUN_ID,
        track_id: spec.id,
        title: idea.title,
        spec: idea.spec,
        status: idea.landed ? 'landed' : 'dead',
        claimed_by: builder.id,
        created_at: iso(t0),
        closed_at: iso(t0 + 2.5 * 3600_000),
      };
      tasks.push(task);
      record(t0, 'task_opened', { track_id: spec.id, agent_id: strategist.id, task_id: taskId, title: idea.title, detail: idea.spec });
      record(t0 + 600_000, 'task_claimed', { track_id: spec.id, agent_id: builder.id, task_id: taskId, title: `${idea.seat} claimed “${idea.title}”` });

      const prevElo = landedIndex === 0 ? 0 : plan.curve[landedIndex - 1];
      const target = idea.landed ? plan.curve[landedIndex] : prevElo - 10 - rand() * 40;

      // Gate vs the opponent nearest the target, so the estimate is meaningful.
      const opp = [...trackRungs].sort((a, b) => Math.abs(a.elo - target) - Math.abs(b.elo - target))[0];
      const gamesPlayed = 40;
      let wins = 0;
      let draws = 0;
      const pWin = expectedScore(target, opp.elo);
      const drawRate = spec.id === 'chess' ? 0.18 : spec.id === 'othello' ? 0.04 : 0;
      for (let g = 0; g < gamesPlayed; g++) {
        const x = rand();
        if (x < drawRate) draws++;
        else if (x < drawRate + (1 - drawRate) * pWin) wins++;
      }
      const losses = gamesPlayed - wins - draws;
      const est = performanceElo([{ opponentElo: opp.elo, score: wins + draws / 2, games: gamesPlayed }]);
      const lands = idea.landed && est.elo > (track.current_elo ?? -Infinity);
      const nextVersion = lands ? `v0.${version + 1}` : `candidate ${n + 1}`;
      const tMatch = t0 + 2.2 * 3600_000;
      const matchId = `${spec.id}-m${n + 1}`;
      matches.push({
        id: matchId,
        run_id: RUN_ID,
        track_id: spec.id,
        engine_version: nextVersion,
        opponent: opp.label,
        opponent_elo: opp.elo,
        purpose: 'gate',
        wins,
        draws,
        losses,
        elo: Math.round(est.elo),
        elo_error: Math.round(est.error),
        started_at: iso(tMatch - 1800_000),
        finished_at: iso(tMatch),
      });

      // Two stored replays per sample match: real legal games, not the engine's.
      for (let k = 0; k < 2; k++) {
        const seed = Math.floor(rand() * 1e9);
        const g = await playGame(GAMES[spec.id], samplePlayers(spec.id, seed));
        games.push({
          id: `${matchId}-g${k + 1}`,
          run_id: RUN_ID,
          match_id: matchId,
          track_id: spec.id,
          ply_count: g.moves.length,
          engine_first: k === 0,
          outcome: g.outcome,
          termination: g.termination,
          moves: g.moves,
          finished_at: iso(tMatch - (1 - k) * 300_000),
        });
      }

      const score = `${wins}–${losses}${draws ? `–${draws}` : ''}`;
      record(tMatch, 'match_verdict', {
        track_id: spec.id,
        agent_id: referee.id,
        match_id: matchId,
        task_id: taskId,
        title: `${spec.name} ${nextVersion} vs ${opp.label}: ${score}`,
        detail: `Performance ${Math.round(est.elo)} ± ${Math.round(est.error)} over ${gamesPlayed} games.`,
        data: { wins, draws, losses, elo: Math.round(est.elo), error: Math.round(est.error) },
      });

      if (lands) {
        version++;
        landedIndex++;
        track.current_elo = Math.round(est.elo);
        track.current_version = nextVersion;
        elo.push({ run_id: RUN_ID, track_id: spec.id, at: iso(tMatch), engine_version: nextVersion, elo: Math.round(est.elo), elo_error: Math.round(est.error), match_id: matchId });
        record(tMatch + 120_000, 'patch_landed', {
          track_id: spec.id,
          agent_id: builder.id,
          task_id: taskId,
          match_id: matchId,
          title: `${nextVersion} landed: ${idea.title}`,
          detail: `${Math.round(est.elo - prevElo) >= 0 ? '+' : ''}${Math.round(est.elo - prevElo)} Elo over ${track.current_version === 'v0.1' ? 'baseline' : 'the previous version'}.`,
        });
        for (const r of trackRungs) {
          if (!r.cleared_at && est.elo - est.error / 2 > r.elo) {
            r.cleared_at = iso(tMatch + 180_000);
            r.cleared_by_match = matchId;
            record(tMatch + 180_000, 'rung_cleared', {
              track_id: spec.id,
              match_id: matchId,
              agent_id: referee.id,
              title: `${spec.name} cleared ${r.label} (${r.elo})`,
              detail: r.label === spec.finishLabel ? 'Finish line reached.' : null,
            });
          }
        }
      } else {
        task.status = 'dead';
        record(tMatch + 120_000, 'patch_rejected', {
          track_id: spec.id,
          agent_id: referee.id,
          task_id: taskId,
          match_id: matchId,
          title: `Rejected: ${idea.title}`,
          detail: `Gate result ${Math.round(est.elo - prevElo)} Elo vs the current version.`,
        });
        record(tMatch + 240_000, 'idea_dead', {
          track_id: spec.id,
          agent_id: strategist.id,
          task_id: taskId,
          title: idea.title,
          detail: idea.why ?? 'No measurable gain.',
        });
      }
      void landedCount;
    }
  }

  // Who is "working now" at the end of the sample window.
  const end = START + HOURS * 3600_000;
  for (const a of agents) a.last_seen = iso(end - Math.floor(rand() * 5400_000));
  for (const seat of ['chess/eval', 'chess/search', 'go/playout', 'go/tree', 'strategist', 'referee']) {
    const a = agents.find((x) => x.seat === seat);
    if (a) {
      a.status = 'working';
      a.last_seen = iso(end - 60_000);
    }
  }
  for (const a of agents.filter((x) => x.track_id === 'hex')) a.status = 'stopped';

  // Two open tasks so the board has a frontier.
  const open: [GameId, string, string, string][] = [
    ['chess', 'chess/eval', 'Texel-tune evaluation weights on 200k quiet positions', 'Logistic regression over self-play positions; gate against v0.9 at equal time.'],
    ['go9', 'go/playout', 'Nakade and self-atari avoidance in playouts', 'Skip self-atari moves for groups larger than two stones.'],
  ];
  for (const [i, [track, seat, title, spec]] of open.entries()) {
    const b = agent(seat, track, 'builder');
    const id = `${track}-open${i + 1}`;
    tasks.push({ id, run_id: RUN_ID, track_id: track, title, spec, status: 'claimed', claimed_by: b.id, created_at: iso(end - (3 - i) * 3600_000), closed_at: null });
    record(end - (3 - i) * 3600_000, 'task_opened', { track_id: track, agent_id: strategist.id, task_id: id, title, detail: spec });
    record(end - (2.6 - i) * 3600_000, 'task_claimed', { track_id: track, agent_id: b.id, task_id: id, title: `${seat} claimed “${title}”` });
  }

  records.sort((a, b) => a.at.localeCompare(b.at));
  records.forEach((r, i) => (r.id = i + 1));

  const snapshot: Snapshot = {
    run: { id: RUN_ID, label: 'Sample run', is_sample: true, started_at: iso(START) },
    tracks,
    rungs,
    agents,
    tasks,
    records,
    matches,
    games,
    elo,
  };

  const jsonPath = resolve(ROOT, 'web/data/sample.json');
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(snapshot));
  writeFileSync(resolve(ROOT, 'supabase/seed.sql'), toSql(snapshot));
  console.log(
    `sample: ${tracks.length} tracks, ${matches.length} matches, ${games.length} stored games, ${records.length} records`,
  );
};

const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'`;

const toSql = (s: Snapshot) => {
  const rows: [string, unknown[], boolean?][] = [
    ['runs', [s.run]],
    ['tracks', s.tracks],
    ['rungs', s.rungs],
    ['agents', s.agents],
    ['tasks', s.tasks],
    ['matches', s.matches],
    ['games', s.games],
    ['records', s.records, true],
    ['elo_points', s.elo.map((e, i) => ({ id: i + 1, ...e })), true],
  ];
  const lines = [
    '-- SAMPLE run generated by `npm run sample`. Synthetic: the site labels it SAMPLE.',
    `delete from runs where id = '${s.run.id}';`,
  ];
  for (const [table, data, identity] of rows) {
    lines.push(
      `insert into ${table} ${identity ? 'overriding system value ' : ''}select * from json_populate_recordset(null::${table}, ${lit(data)});`,
    );
  }
  lines.push(
    "select setval(pg_get_serial_sequence('records', 'id'), (select max(id) from records));",
    "select setval(pg_get_serial_sequence('elo_points', 'id'), (select max(id) from elo_points));",
  );
  return lines.join('\n') + '\n';
};

await main();

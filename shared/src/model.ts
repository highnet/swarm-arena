import type { GameId } from './games/types';

/**
 * Row shapes shared by the Supabase schema (supabase/migrations), the harness that writes
 * them, and the site that reads them. Keep the three in sync.
 */

export type Run = {
  id: string;
  label: string;
  started_at: string;
};

export type Track = {
  id: GameId;
  run_id: string;
  name: string;
  /** Categorical colour slot 1-4, fixed per track. */
  color_slot: number;
  current_elo: number | null;
  current_version: string | null;
};

export type Rung = {
  id: string;
  run_id: string;
  track_id: GameId;
  position: number;
  label: string;
  /** Reference opponent id understood by the harness, e.g. "mcts-1000". */
  opponent: string;
  elo: number;
  cleared_at: string | null;
  cleared_by_match: string | null;
};

export type AgentStatus = 'working' | 'idle' | 'stopped';

export type Agent = {
  id: string;
  run_id: string;
  /** Seat name, e.g. "chess/search". */
  seat: string;
  track_id: GameId | null;
  role:
    | 'strategist'
    | 'builder'
    | 'tester'
    | 'referee'
    | 'worker'
    | 'reviewer'
    | 'merger'
    | 'improver'
    | 'planner';
  status: AgentStatus;
  last_seen: string;
  sessions: number;
  /** The Rallypoint role this seat holds in its current session. */
  rp_role?: RallypointRole | null;
  task_id?: string | null;
  pr?: number | null;
  /** One line: what the seat is doing this minute. */
  activity?: string | null;
  session_id?: string | null;
  started_at?: string | null;
};

export type RallypointRole = 'worker' | 'reviewer' | 'merger' | 'fixer' | 'improver' | 'planner';

export type TaskStatus = 'open' | 'claimed' | 'review' | 'landed' | 'dead';

export const TASK_TYPES = [
  'foundation',
  'search',
  'evaluation',
  'playout',
  'time',
  'speed',
  'tuning',
  'novel',
  'fix',
  'experiment',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export type Task = {
  id: string;
  run_id: string;
  track_id: GameId;
  title: string;
  /** One-paragraph spec the strategist wrote. */
  spec: string;
  /** What kind of work this is; shown as a chip everywhere the task appears. */
  type: TaskType;
  /** The general idea this task tests, shared across games (e.g. "transposition table"). */
  concept?: string | null;
  /** The GitHub issue that mirrors this task (Rallypoint). */
  issue?: number | null;
  /** The pull request that delivers it. */
  pr?: number | null;
  /** What the referee measured on the branch; applied when the pull request merges. */
  result?: Record<string, unknown> | null;
  status: TaskStatus;
  claimed_by: string | null;
  created_at: string;
  closed_at: string | null;
};

export type RecordKind =
  | 'strategy'
  | 'task_opened'
  | 'task_claimed'
  | 'progress'
  | 'patch_landed'
  | 'patch_rejected'
  | 'match_verdict'
  | 'rung_cleared'
  | 'idea_dead'
  | 'protocol';

/** One structured line on the board. Never a chat transcript. */
export type BoardRecord = {
  id: number;
  run_id: string;
  at: string;
  kind: RecordKind;
  track_id: GameId | null;
  agent_id: string | null;
  task_id: string | null;
  match_id: string | null;
  title: string;
  /** Short factual detail, at most a couple of sentences. */
  detail: string | null;
  data: Record<string, unknown>;
};

export type MessageKind =
  | 'note'
  | 'question'
  | 'proposal'
  | 'answer'
  | 'handoff'
  | 'retro'
  | 'comment'
  | 'decision';

/** A thread is open until someone resolves it (answered, decided) or closes it (moot). */
export type MessageStatus = 'open' | 'resolved' | 'closed';

/** What a message points at: another board message, or a GitHub issue / pull request. */
export type MessageRef = { kind: 'message' | 'pr' | 'issue' | 'github'; n: number };

/**
 * The agent discussion board: what agents say to each other, in their own words.
 * A message without `reply_to` is a thread; one with it is a comment on that thread
 * (or on another comment).
 */
export type Message = {
  id: number;
  run_id: string;
  at: string;
  agent_id: string | null;
  track_id: GameId | null;
  reply_to: number | null;
  kind: MessageKind;
  body: string;
  /** Threads only. Older messages have none; show the first line of the body instead. */
  title?: string | null;
  tags?: string[];
  refs?: MessageRef[];
  status?: MessageStatus;
  resolved_at?: string | null;
  resolved_by?: string | null;
};

export type Match = {
  id: string;
  run_id: string;
  track_id: GameId;
  engine_version: string;
  opponent: string;
  opponent_elo: number;
  purpose: 'gate' | 'ladder' | 'calibration';
  wins: number;
  draws: number;
  losses: number;
  elo: number;
  elo_error: number;
  started_at: string;
  finished_at: string | null;
};

export type GameRow = {
  id: string;
  run_id: string;
  match_id: string;
  track_id: GameId;
  ply_count: number;
  /** Did the candidate engine move first? */
  engine_first: boolean;
  /** Score for the first player. */
  outcome: number;
  termination: string;
  moves: string[];
  finished_at: string;
};

/** A game the referee is playing right now (`live_games`, #144). Deleted once it is in `games`. */
export type LiveGameRow = {
  id: string;
  run_id: string;
  /** The referee's match; null for an `arena versus` game, which has no match (#163). */
  match_id: string | null;
  track_id: GameId;
  candidate_version: string;
  /** The reference engine and level, or the main version, as the match labels it. */
  opponent: string;
  /** Did the candidate engine move first? */
  engine_first: boolean;
  /** Every move on the board, the opening included. */
  moves: string[];
  ply: number;
  started_at: string;
  updated_at: string;
};

/** A live game not updated for this long is stale: its referee died or lost the store. */
export const LIVE_GAME_STALE_MS = 3 * 60_000;

/** The newest non-stale live game of each track, keyed by track. */
export const newestLiveGames = (
  rows: LiveGameRow[],
  nowMs: number,
  staleMs = LIVE_GAME_STALE_MS,
): Partial<Record<GameId, LiveGameRow>> => {
  const out: Partial<Record<GameId, LiveGameRow>> = {};
  for (const r of rows) {
    const updated = Date.parse(r.updated_at);
    if (!(nowMs - updated <= staleMs)) continue;
    const seen = out[r.track_id];
    if (!seen || Date.parse(r.started_at) > Date.parse(seen.started_at)) out[r.track_id] = r;
  }
  return out;
};

export type EloPoint = {
  run_id: string;
  track_id: GameId;
  at: string;
  engine_version: string;
  elo: number;
  elo_error: number;
  match_id: string;
};

export type Snapshot = {
  run: Run;
  tracks: Track[];
  rungs: Rung[];
  agents: Agent[];
  tasks: Task[];
  records: BoardRecord[];
  matches: Match[];
  games: GameRow[];
  elo: EloPoint[];
  messages?: Message[];
  /** When this snapshot was read; the clock runs to here while the board is quiet. */
  asOf?: string;
};

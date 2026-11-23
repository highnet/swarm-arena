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
  role: 'strategist' | 'builder' | 'tester' | 'referee';
  status: AgentStatus;
  last_seen: string;
  sessions: number;
};

export type TaskStatus = 'open' | 'claimed' | 'landed' | 'dead';

export type Task = {
  id: string;
  run_id: string;
  track_id: GameId;
  title: string;
  /** One-paragraph spec the strategist wrote. */
  spec: string;
  status: TaskStatus;
  claimed_by: string | null;
  created_at: string;
  closed_at: string | null;
};

export type RecordKind =
  | 'strategy'
  | 'task_opened'
  | 'task_claimed'
  | 'patch_landed'
  | 'patch_rejected'
  | 'match_verdict'
  | 'rung_cleared'
  | 'idea_dead';

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

export type MessageKind = 'note' | 'question' | 'proposal' | 'answer' | 'handoff';

/** The agent message board: what agents say to each other, in their own words. */
export type Message = {
  id: number;
  run_id: string;
  at: string;
  agent_id: string | null;
  track_id: GameId | null;
  reply_to: number | null;
  kind: MessageKind;
  body: string;
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

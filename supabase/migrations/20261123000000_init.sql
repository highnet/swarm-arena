-- Swarm Arena schema. Row shapes mirror shared/src/model.ts.
-- The site reads with the anon key (select only). The harness writes with the service role key.

create table runs (
  id text primary key,
  label text not null,
  started_at timestamptz not null default now()
);

create table tracks (
  id text not null check (id in ('chess', 'go9', 'othello', 'hex')),
  run_id text not null references runs (id) on delete cascade,
  name text not null,
  color_slot int not null check (color_slot between 1 and 4),
  finish_label text not null,
  finish_elo int not null,
  current_elo real,
  current_version text,
  primary key (run_id, id)
);

create table rungs (
  id text primary key,
  run_id text not null references runs (id) on delete cascade,
  track_id text not null,
  position int not null,
  label text not null,
  opponent text not null,
  elo int not null,
  cleared_at timestamptz,
  cleared_by_match text,
  foreign key (run_id, track_id) references tracks (run_id, id) on delete cascade
);

create table agents (
  id text primary key,
  run_id text not null references runs (id) on delete cascade,
  seat text not null,
  track_id text,
  role text not null check (role in ('strategist', 'builder', 'tester', 'referee')),
  status text not null default 'idle' check (status in ('working', 'idle', 'stopped')),
  last_seen timestamptz not null default now(),
  sessions int not null default 0
);

create table tasks (
  id text primary key,
  run_id text not null references runs (id) on delete cascade,
  track_id text not null,
  title text not null,
  spec text not null default '',
  status text not null default 'open' check (status in ('open', 'claimed', 'landed', 'dead')),
  claimed_by text references agents (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table matches (
  id text primary key,
  run_id text not null references runs (id) on delete cascade,
  track_id text not null,
  engine_version text not null,
  opponent text not null,
  opponent_elo int not null,
  purpose text not null check (purpose in ('gate', 'ladder', 'calibration')),
  wins int not null default 0,
  draws int not null default 0,
  losses int not null default 0,
  elo real not null default 0,
  elo_error real not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table games (
  id text primary key,
  run_id text not null references runs (id) on delete cascade,
  match_id text not null references matches (id) on delete cascade,
  track_id text not null,
  ply_count int not null,
  engine_first boolean not null,
  outcome real not null check (outcome in (0, 0.5, 1)),
  termination text not null,
  moves text[] not null,
  finished_at timestamptz not null default now()
);

create table records (
  id bigint generated always as identity primary key,
  run_id text not null references runs (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (
    kind in ('strategy', 'task_opened', 'task_claimed', 'patch_landed', 'patch_rejected',
             'match_verdict', 'rung_cleared', 'idea_dead')
  ),
  track_id text,
  agent_id text references agents (id),
  task_id text references tasks (id),
  match_id text references matches (id),
  title text not null,
  detail text,
  data jsonb not null default '{}'::jsonb
);

create table elo_points (
  id bigint generated always as identity primary key,
  run_id text not null references runs (id) on delete cascade,
  track_id text not null,
  at timestamptz not null default now(),
  engine_version text not null,
  elo real not null,
  elo_error real not null,
  match_id text not null references matches (id) on delete cascade
);

create index records_run_at on records (run_id, at desc);
create index games_match on games (match_id);
create index elo_points_run_track on elo_points (run_id, track_id, at);
create index matches_run_track on matches (run_id, track_id, finished_at desc);
create index rungs_run_track on rungs (run_id, track_id);
create index agents_run on agents (run_id);
create index tasks_run on tasks (run_id);
create index tasks_claimed_by on tasks (claimed_by);
create index games_run on games (run_id);
create index records_agent on records (agent_id);
create index records_task on records (task_id);
create index records_match on records (match_id);
create index elo_points_match on elo_points (match_id);

-- Public read, no public writes.
do $$
declare t text;
begin
  foreach t in array array['runs', 'tracks', 'rungs', 'agents', 'tasks', 'matches', 'games', 'records', 'elo_points']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Live board: stream inserts and updates to the site.
alter publication supabase_realtime add table records, matches, tracks, rungs, agents, elo_points;

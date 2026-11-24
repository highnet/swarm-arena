-- Games in progress (#144). The referee upserts one row per game as its moves are played (at most
-- about once a second) and deletes it once the finished game is written to `games`. A row whose
-- updated_at is a few minutes old is stale (its referee died or lost the store): readers ignore it,
-- and `sweep_live_games()` deletes it.
create table live_games (
  id text primary key,
  run_id text not null references runs (id) on delete cascade,
  match_id text not null references matches (id) on delete cascade,
  track_id text not null,
  candidate_version text not null,
  -- The reference engine and level, or the main version, as the match labels it.
  opponent text not null,
  engine_first boolean not null,
  moves text[] not null default '{}',
  ply int not null default 0,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index live_games_run_track on live_games (run_id, track_id, updated_at desc);
create index live_games_match on live_games (match_id);

-- Same RLS and read policy as games: public read, no public writes.
alter table live_games enable row level security;
create policy "public read" on live_games for select to anon, authenticated using (true);

-- Writes through the API carry the arena password, like every other table.
create trigger arena_password before insert or update or delete on live_games
  for each row execute function arena_require_password();

-- Realtime: the site's LiveIndicator subscribes with a run_id filter; a full replica identity lets
-- delete events carry run_id so the filter matches them too.
alter table live_games replica identity full;
alter publication supabase_realtime add table live_games;

-- Delete rows that stopped updating. Runs as definer from a direct connection or a scheduled job.
create or replace function sweep_live_games(older_than interval default interval '10 minutes')
returns int language sql security definer set search_path = public as $$
  with gone as (delete from live_games where updated_at < now() - older_than returning 1)
  select count(*)::int from gone
$$;
revoke all on function sweep_live_games(interval) from public, anon, authenticated;

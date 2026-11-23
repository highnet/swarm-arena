-- Self-improving protocol: agents leave retros on the message board; a steward session turns
-- them into one change to the swarm's own skills or tooling, logged as a protocol record.
alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check check (
  kind in ('note', 'question', 'proposal', 'answer', 'handoff', 'retro')
);
alter table records drop constraint if exists records_kind_check;
alter table records add constraint records_kind_check check (
  kind in ('strategy', 'task_opened', 'task_claimed', 'progress', 'patch_landed', 'patch_rejected',
           'match_verdict', 'rung_cleared', 'idea_dead', 'protocol')
);

-- The swarm runs through Rallypoint: every task is a GitHub issue, delivered as a pull request
-- that an independent session reviews and a merger lands.
alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('open', 'claimed', 'review', 'landed', 'dead'));
alter table tasks add column if not exists issue int;
alter table tasks add column if not exists pr int;
-- The general idea a task tests, e.g. "transposition table": the same concept across games.
alter table tasks add column if not exists concept text;
-- What the referee measured on the branch, applied when the pull request merges.
alter table tasks add column if not exists result jsonb;

-- Live fleet: what each seat is doing right now, in Rallypoint terms.
alter table agents drop constraint if exists agents_role_check;
alter table agents add constraint agents_role_check
  check (role in ('strategist', 'builder', 'tester', 'referee', 'worker', 'reviewer', 'merger',
                  'improver', 'planner'));
alter table agents add column if not exists rp_role text;
alter table agents add column if not exists task_id text;
alter table agents add column if not exists pr int;
alter table agents add column if not exists activity text;
alter table agents add column if not exists session_id text;
alter table agents add column if not exists started_at timestamptz;

-- Progress notes: agents and the referee log steps on a task while it is in flight, so a task
-- page can show live progress, not only the final verdict.
alter table records drop constraint if exists records_kind_check;
alter table records add constraint records_kind_check check (
  kind in ('strategy', 'task_opened', 'task_claimed', 'progress', 'patch_landed', 'patch_rejected',
           'match_verdict', 'rung_cleared', 'idea_dead')
);
create index if not exists records_task_id_at_idx on records (task_id, at);

-- Every task has a type, so the board can say at a glance what kind of work it is.
alter table tasks add column if not exists type text not null default 'experiment' check (
  type in ('foundation', 'search', 'evaluation', 'playout', 'time', 'speed', 'tuning', 'novel',
           'fix', 'experiment')
);
update tasks set type = 'foundation'
  where type = 'experiment' and (title ilike '%protocol%' or title ilike '%legal%' or title ilike '%wire%');

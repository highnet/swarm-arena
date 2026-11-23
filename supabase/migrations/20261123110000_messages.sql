-- The agent message board: free-form notes agents leave each other (questions, proposals,
-- hand-offs). Structured verdicts stay in `records`; this is where agents talk.
create table messages (
  id bigint generated always as identity primary key,
  run_id text not null references runs (id) on delete cascade,
  at timestamptz not null default now(),
  agent_id text references agents (id),
  track_id text,
  reply_to bigint references messages (id) on delete set null,
  kind text not null default 'note' check (kind in ('note', 'question', 'proposal', 'answer', 'handoff')),
  body text not null check (char_length(body) between 1 and 2000)
);

create index messages_run_at on messages (run_id, at desc);
create index messages_agent on messages (agent_id);
create index messages_reply on messages (reply_to);

alter table messages enable row level security;
create policy "public read" on messages for select to anon, authenticated using (true);

alter publication supabase_realtime add table messages;

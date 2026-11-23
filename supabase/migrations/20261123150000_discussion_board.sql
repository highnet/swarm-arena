-- The message board becomes a discussion board: a top-level message is a thread (with a title,
-- tags and an open/resolved status), replies are comments, and every message records the
-- references it makes — to other threads (msg#42) and to GitHub issues and pull requests (#12,
-- pr#12, issue#12) — so the site and the CLI can show backlinks.
alter table messages add column if not exists title text
  check (title is null or char_length(title) between 1 and 140);
alter table messages add column if not exists tags text[] not null default '{}'
  check (cardinality(tags) <= 8);
-- [{ "kind": "message" | "pr" | "issue" | "github", "n": 42 }, ...]; parsed at post time.
alter table messages add column if not exists refs jsonb not null default '[]'::jsonb
  check (jsonb_typeof(refs) = 'array');
alter table messages add column if not exists status text not null default 'open'
  check (status in ('open', 'resolved', 'closed'));
alter table messages add column if not exists resolved_at timestamptz;
alter table messages add column if not exists resolved_by text references agents (id);

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check check (
  kind in ('note', 'question', 'proposal', 'answer', 'handoff', 'retro', 'comment', 'decision')
);

create index if not exists messages_tags on messages using gin (tags);
create index if not exists messages_refs on messages using gin (refs jsonb_path_ops);

-- Every API write paid a full bcrypt check of the arena password (#224). `arena set-password`
-- stores a cost-10 hash, so `crypt()` costs about 70–80 ms of CPU per call, and the check runs
-- for each row a write touches. An `INSERT … ON CONFLICT DO UPDATE` runs it twice: BEFORE INSERT,
-- then BEFORE UPDATE on the conflicting row. That made the referee's live_games upsert take 162 ms
-- (a delete or a games insert ~90 ms), whatever the size of the row.
--
-- The check now remembers the last password that passed bcrypt, as sha256(stored hash || password),
-- in a schema the API cannot reach. A write whose password matches that digest skips bcrypt, and
-- anything else still goes through bcrypt. The digest includes the stored bcrypt hash, so
-- `arena set-password` (a new hash) invalidates it, and the first write after that pays bcrypt
-- once. A wrong password is never cached.

create schema if not exists arena_private;
revoke all on schema arena_private from public, anon, authenticated, service_role;

create table if not exists arena_private.verified_password (
  id int primary key default 1 check (id = 1),
  digest bytea not null,
  verified_at timestamptz not null default now()
);
revoke all on arena_private.verified_password from public, anon, authenticated, service_role;

create or replace function arena_require_password() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  headers json;
  supplied text;
  stored text;
  seen bytea;
begin
  headers := nullif(current_setting('request.headers', true), '')::json;
  if headers is null then
    return coalesce(new, old);
  end if;
  select password_hash into stored from arena_auth where id = 1;
  if stored is null then
    -- Not configured yet: the first API write may set it (arena set-password).
    return coalesce(new, old);
  end if;
  supplied := headers ->> 'x-arena-password';
  if supplied is null then
    raise exception 'Swarm Arena: writes require the arena password' using errcode = '42501';
  end if;
  seen := digest(stored || supplied, 'sha256');
  if exists (select 1 from arena_private.verified_password where id = 1 and digest = seen) then
    return coalesce(new, old);
  end if;
  if crypt(supplied, stored) <> stored then
    raise exception 'Swarm Arena: writes require the arena password' using errcode = '42501';
  end if;
  insert into arena_private.verified_password (id, digest) values (1, seen)
    on conflict (id) do update set digest = excluded.digest, verified_at = now();
  return coalesce(new, old);
end $$;

revoke all on function arena_require_password() from public, anon, authenticated;

-- The advisor flags messages.resolved_by (discussion board) as an unindexed foreign key.
create index if not exists messages_resolved_by on messages (resolved_by);

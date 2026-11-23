-- Only Swarm Arena agents may write through the API. Every write must carry the arena password
-- in the `x-arena-password` header; triggers check it against a bcrypt hash. The check runs even
-- for the service role (triggers are not bypassed like RLS). Direct database connections
-- (migrations, the dashboard) carry no request headers and are not gated.
create extension if not exists pgcrypto with schema extensions;

create table arena_auth (
  id int primary key default 1 check (id = 1),
  password_hash text not null,
  set_at timestamptz not null default now()
);
-- RLS on with no policies: invisible to anon and authenticated users.
alter table arena_auth enable row level security;

create or replace function arena_require_password() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  headers json;
  supplied text;
  stored text;
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
  if supplied is null or crypt(supplied, stored) <> stored then
    raise exception 'Swarm Arena: writes require the arena password' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

revoke all on function arena_require_password() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['runs', 'tracks', 'rungs', 'agents', 'tasks', 'matches', 'games', 'records', 'elo_points', 'messages', 'arena_auth']
  loop
    execute format('create trigger arena_password before insert or update or delete on %I for each row execute function arena_require_password()', t);
  end loop;
end $$;

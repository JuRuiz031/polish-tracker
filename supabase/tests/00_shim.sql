-- Supabase shim: the pieces the migrations assume exist.
-- Mirrors how Supabase actually defines them, so the migrations run unmodified.

create extension if not exists "pgcrypto";

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid()
);

-- Supabase reads the subject claim out of the request GUC. Same here, so a test can
-- impersonate a user with `set request.jwt.claim.sub = '<uuid>'`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant select on auth.users to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

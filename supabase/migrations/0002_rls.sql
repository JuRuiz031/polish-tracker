-- Polish — 0002 row-level security
--
-- This file IS the multi-user story. Isolation is enforced by Postgres, not by React,
-- so a bug in the client cannot leak one user's collection to another.
--
-- Shipping single-user means exactly one thing beyond this file: public signups stay
-- OFF in the Supabase dashboard (Authentication → Providers → Email → "Enable signup").
-- Anabel is added by invite. Going multi-user later is flipping that toggle and adding
-- a signup screen — these policies do not change.
--
-- Invariant: the client only ever holds the anon key. The service_role key bypasses
-- every policy below and must live only in GitHub Actions secrets (backup job).

alter table polish   enable row level security;
alter table wear     enable row level security;
alter table wishlist enable row level security;

-- Force RLS so that even the table owner is subject to these policies. Without this,
-- a future migration or admin connection can silently sidestep them.
alter table polish   force row level security;
alter table wear     force row level security;
alter table wishlist force row level security;

-- `using` guards which rows are visible to read/update/delete.
-- `with check` guards what may be written — without it a user could insert a row
-- stamped with someone else's user_id, or reassign one of their own rows away.

create policy polish_owner on polish
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy wear_owner on wear
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy wishlist_owner on wishlist
  for all
  to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Note on `(select auth.uid())` rather than a bare `auth.uid()`: wrapping it lets the
-- planner evaluate it once per query instead of once per row. On a 300-row collection
-- it is irrelevant; it costs nothing to be right about it now.

-- The anon role gets nothing. Every policy above is scoped `to authenticated`, so an
-- unauthenticated request sees zero rows rather than erroring — which is what we want
-- when a session expires mid-use.
revoke all on polish, wear, wishlist from anon;

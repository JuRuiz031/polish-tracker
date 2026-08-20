-- Polish — 0003 views
--
-- ⚠ security_invoker is the whole point of this file.
--
-- A Postgres view runs with the privileges of its OWNER by default, which means it
-- bypasses the RLS policies on its underlying tables — a view over `polish` would
-- happily hand every user's rows to whoever queries it. `security_invoker = on`
-- (PG15+) makes the view run as the caller instead, so 0002's policies apply.
-- This is the single most commonly missed Supabase security bug.
--
-- Scope note: the app does NOT depend on these views. times_worn / last_worn /
-- days_since / avg_rating are computed client-side in src/domain/derive.ts because
-- they have to work offline. These exist to sanity-check exports and as the scaling
-- path if the collection ever outgrows "fetch everything".
--
-- These views are also where the duplicate-key expression is centralised now that it is
-- an index rather than a stored column (see 0001). Callers should go through
-- polish_duplicates / wishlist_already_owned rather than retyping the expression, so
-- there is exactly one copy of it in SQL to keep in step with domain/dedupe.ts.

create view polish_stats
with (security_invoker = on)
as
select
  p.id                                            as polish_id,
  p.user_id,
  count(w.id)                                     as times_worn,
  max(w.worn_on)                                  as last_worn,
  round(avg(w.rating)::numeric, 1)                as avg_rating
from polish p
left join wear w
  on  w.polish_id  = p.id
  and w.deleted_at is null
where p.deleted_at is null
group by p.id, p.user_id;

-- NOTE: there is deliberately no days_since here.
--
-- It used to be `(current_date - max(w.worn_on))`, which is the SERVER's date in UTC.
-- The client computes the same number from LOCAL midnight via domain/date.ts — a module
-- that exists specifically to avoid that off-by-one. For anyone west of Greenwich the
-- two disagree by a day every evening, and "days since" feeds the picker's rest-day
-- rule, so a wrong copy of it is worse than no copy. last_worn is a timezone-free fact;
-- derive days_since from it in the client.

-- Unresolved duplicates: non-archived, non-deleted polishes sharing a duplicate key.
-- Matches the rule in src/domain/dedupe.ts — if you change one, change both.
--
-- The window count has to be computed in a subquery and filtered outside it: a window
-- function cannot appear in its own WHERE clause. The previous version simply omitted
-- the filter, so this view returned EVERY live polish with a group_size column attached
-- rather than the duplicates it names — a caller trusting the name got the whole
-- collection back.
create view polish_duplicates
with (security_invoker = on)
as
select polish_id, user_id, dedupe_key, group_size
from (
  select
    p.id                                                as polish_id,
    p.user_id,
    lower(btrim(p.brand)) || ' - ' || lower(btrim(p.name)) as dedupe_key,
    count(*) over (
      partition by p.user_id, lower(btrim(p.brand)) || ' - ' || lower(btrim(p.name))
    )                                                   as group_size
  from polish p
  where p.deleted_at is null
    and p.archived  = false
) grouped
where group_size > 1;

-- Wishlist rows she already owns. Distinct from a within-wishlist duplicate, and the
-- UI renders the two states differently (amber vs alert).
--
-- Bought rows are excluded: once "I bought it" has resolved a row it points at the
-- bottle directly via bought_polish_id, and flagging it as "you already own this" would
-- be telling her something she just did.
create view wishlist_already_owned
with (security_invoker = on)
as
select
  wl.id as wishlist_id,
  wl.user_id,
  lower(btrim(wl.brand)) || ' - ' || lower(btrim(wl.name)) as dedupe_key,
  p.id  as owned_polish_id
from wishlist wl
join polish p
  on  p.user_id    = wl.user_id
  and lower(btrim(p.brand)) || ' - ' || lower(btrim(p.name))
    = lower(btrim(wl.brand)) || ' - ' || lower(btrim(wl.name))
  and p.deleted_at is null
  and p.archived   = false
where wl.deleted_at is null
  and wl.status    <> 'Bought';

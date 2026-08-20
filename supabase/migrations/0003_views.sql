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

create view polish_stats
with (security_invoker = on)
as
select
  p.id                                            as polish_id,
  p.user_id,
  count(w.id)                                     as times_worn,
  max(w.worn_on)                                  as last_worn,
  (current_date - max(w.worn_on))::int            as days_since,
  round(avg(w.rating)::numeric, 1)                as avg_rating
from polish p
left join wear w
  on  w.polish_id  = p.id
  and w.deleted_at is null
where p.deleted_at is null
group by p.id, p.user_id;

-- Unresolved duplicates: non-archived, non-deleted polishes sharing a dedupe_key.
-- Matches the rule in src/domain/dedupe.ts — if you change one, change both.
create view polish_duplicates
with (security_invoker = on)
as
select
  p.id as polish_id,
  p.user_id,
  p.dedupe_key,
  count(*) over (partition by p.user_id, p.dedupe_key) as group_size
from polish p
where p.deleted_at is null
  and p.archived  = false;

-- Wishlist rows she already owns. Distinct from a within-wishlist duplicate, and the
-- UI renders the two states differently (amber vs alert).
create view wishlist_already_owned
with (security_invoker = on)
as
select
  wl.id as wishlist_id,
  wl.user_id,
  wl.dedupe_key,
  p.id  as owned_polish_id
from wishlist wl
join polish p
  on  p.user_id    = wl.user_id
  and p.dedupe_key = wl.dedupe_key
  and p.deleted_at is null
  and p.archived   = false
where wl.deleted_at is null;

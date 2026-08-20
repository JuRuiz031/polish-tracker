-- Polish — 0001 schema
--
-- Design notes that matter:
--   * Every table carries user_id defaulting to auth.uid(). Single-user today, multi-user
--     later without a migration. RLS lives in 0002.
--   * polish gets `unique (user_id, id)` purely so wear/wishlist can hang a COMPOSITE foreign
--     key off it. That makes it structurally impossible to attach a child row to another
--     user's polish, independent of any RLS policy or client-side check.
--   * Deletes are soft (deleted_at). This buys Undo, idempotent offline replay, and
--     protection against a mis-tap destroying data — one column, three requirements.
--   * There is deliberately NO dedupe_key column. The duplicate rule is
--     lower(btrim(brand)) || ' - ' || lower(btrim(name)), and it lives in an EXPRESSION
--     INDEX rather than a stored generated column. Two reasons: a stored copy of
--     brand+name is a transitive dependency on non-key attributes (3NF), and a generated
--     column cannot appear in any INSERT — which would have meant every write path, and
--     every restore of a JSON backup, had to remember to strip it. The index gives the
--     same lookups with nothing to strip. Mirror of src/domain/dedupe.ts.
--   * brand and name are stored pre-normalised (whitespace runs collapsed, ends trimmed)
--     and a CHECK enforces it. That is what makes the client-side and Postgres duplicate
--     keys provably identical: with no tabs or double spaces possible, JS .trim() and
--     Postgres btrim() cannot disagree.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums. Values are exactly the ones already in use in her workbook.
-- Growth path: `alter type ... add value 'X'` is a one-liner. If she ever needs to
-- define her own from the UI, migrate to a lookup table with an FK.
-- ---------------------------------------------------------------------------

create type polish_color as enum (
  'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Indigo', 'Violet', 'Purple', 'Pink',
  'Coral', 'Nude/Beige', 'Brown', 'White', 'Black', 'Gray', 'Silver', 'Gold', 'Teal',
  'Multi/Glitter', 'Clear'
);

create type polish_finish as enum (
  'Cream', 'Shimmer', 'Glitter', 'Holographic', 'Metallic', 'Matte', 'Jelly', 'Crelly',
  'Magnetic', 'Chrome', 'Duochrome', 'Flakie', 'Thermal', 'Top Coat', 'Base Coat', 'Other'
);

create type sale_window as enum (
  'Black Friday/Cyber Monday', 'Ulta 21 Days of Beauty', 'Sephora Savings Event',
  'Prime Day', 'Memorial Day', 'Labor Day', 'Holiday sets', 'Spring sale',
  'Brand anniversary', 'Monthly promo', 'Rarely discounted', 'Not sure'
);

create type wishlist_priority as enum ('High', 'Medium', 'Low');

-- 'Bought' is set by the "I bought it" action, never chosen by hand in the form — it is
-- what keeps the purchase (price paid, where, how long it was wanted) instead of
-- deleting the row and losing all of it. See bought_polish_id below.
create type wishlist_status   as enum ('Wanting', 'Wishing', 'Waiting', 'Bought');

-- ---------------------------------------------------------------------------
-- updated_at maintenance.
--
-- This is the clock that last-write-wins resolves on, so what it does matters.
--
-- It does NOT simply stamp now(). Doing that means a write replayed from the offline
-- queue is timestamped when it ARRIVED rather than when it was MADE: an edit made on
-- the phone with no signal on Monday, flushed on Wednesday, would beat an edit made in
-- the browser on Tuesday. "Last write wins" would quietly mean "last to arrive wins",
-- and the Tuesday edit would vanish with nothing to show it ever existed.
--
-- Instead the client may supply its own updated_at and it is honoured — but clamped so
-- it can never move backwards. greatest() makes the column monotonic per row, so a
-- device with a badly wrong clock can be too new but never rewrite history to be older
-- than what is already stored.
--
-- A client that sends nothing still gets now(), so a plain UPDATE from the SQL editor
-- or a future second client behaves the way anyone would expect.
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := greatest(
    coalesce(nullif(new.updated_at, old.updated_at), now()),
    old.updated_at
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- polish — the collection
-- ---------------------------------------------------------------------------

create table polish (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,

  -- Stored already-normalised: internal whitespace runs collapsed to one space, ends
  -- trimmed. The client does this in domain/schema.ts; this CHECK is the backstop that
  -- makes it an invariant rather than a convention, which is what lets the duplicate key
  -- below be computed identically in JS and in SQL.
  brand       text not null check (brand = btrim(regexp_replace(brand, '\s+', ' ', 'g')) and brand <> ''),
  name        text not null check (name  = btrim(regexp_replace(name,  '\s+', ' ', 'g')) and name  <> ''),
  color       polish_color  not null,
  finish      polish_finish not null,

  -- The actual bottle colour for the UI chip. Distinct from the `color` bucket:
  -- `color` is how she filters, swatch_hex is what she sees.
  swatch_hex  text check (swatch_hex ~ '^#[0-9A-Fa-f]{6}$'),
  photo_path  text,
  notes       text,

  -- Used-up or given-away bottles: out of the picker, still in history.
  archived    boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- Target for the composite FKs below. Redundant with the PK on its own, but it is
  -- what lets Postgres enforce that a child row cannot cross a user boundary.
  unique (user_id, id)
);

-- The duplicate key, as an index rather than a column. Deliberately NOT unique: she may
-- legitimately own a backup bottle, so duplicates are a warning, never a block.
-- A query must use this exact expression to hit the index; polish_duplicates in
-- 0003_views.sql wraps it so callers do not have to reproduce it by hand.
create index polish_user_dedupe_idx  on polish (
  user_id, (lower(btrim(brand)) || ' - ' || lower(btrim(name)))
) where deleted_at is null;
create index polish_user_active_idx  on polish (user_id) where deleted_at is null and archived = false;
create index polish_user_brand_idx   on polish (user_id, lower(brand)) where deleted_at is null;

create trigger polish_set_updated_at
  before update on polish
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- wear — the usage log. Every derived number on every screen comes from this table.
-- Append-only: each manicure is a new row, never an overwrite.
-- ---------------------------------------------------------------------------

create table wear (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  polish_id   uuid not null,

  worn_on     date not null,
  rating      int check (rating between 1 and 5),
  -- Upper bound matches wearInputSchema exactly. Without it Postgres would accept a
  -- value the importer refuses, so a row that got in by any other route (SQL editor, a
  -- future second client) would export fine and then never re-import — silently
  -- breaking the round-trip guarantee that data/transfer/ exists to provide.
  days_lasted int check (days_lasted between 0 and 365),
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- Composite FK: the wear row and the polish it points at must belong to the same user.
  foreign key (user_id, polish_id)
    references polish (user_id, id) on delete cascade
);

create index wear_user_polish_idx on wear (user_id, polish_id, worn_on desc) where deleted_at is null;
create index wear_user_date_idx   on wear (user_id, worn_on desc)            where deleted_at is null;

create trigger wear_set_updated_at
  before update on wear
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- wishlist
-- ---------------------------------------------------------------------------

create table wishlist (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,

  -- Same normalisation invariant as polish, for the same reason.
  brand         text not null check (brand = btrim(regexp_replace(brand, '\s+', ' ', 'g')) and brand <> ''),
  name          text not null check (name  = btrim(regexp_replace(name,  '\s+', ' ', 'g')) and name  <> ''),
  color         polish_color  not null,
  finish        polish_finish not null,

  -- Mirrors polish.swatch_hex so "I bought it" can carry the shade across into the
  -- collection instead of dropping it. Same constraint, same meaning.
  swatch_hex    text check (swatch_hex ~ '^#[0-9A-Fa-f]{6}$'),

  where_sold    text,
  typical_price numeric(10, 2) check (typical_price >= 0),
  sale_window   sale_window,
  priority      wishlist_priority not null default 'Medium',
  status        wishlist_status   not null default 'Wanting',
  link          text,
  notes         text,

  -- "I bought it" resolves the row instead of deleting it. Before, buying copied six
  -- fields into polish and dropped the wishlist row, taking typical_price, where_sold,
  -- sale_window and priority with it — so "what did I pay, and where?" became
  -- unanswerable the moment the answer mattered. Now the row survives as history and
  -- points at the bottle it became.
  --
  -- SET NULL is column-scoped (PG15+, as security_invoker in 0003 already requires):
  -- a plain composite SET NULL would try to null user_id too, which is NOT NULL.
  bought_polish_id uuid,
  bought_on        date,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- A link to a bottle only makes sense on a row that was actually bought. Enforced in
  -- that direction ONLY, deliberately: the reverse (Bought implies a link) would fight
  -- the SET NULL above — hard-deleting the polish nulls the column while the status
  -- stays Bought, and the delete would fail on its own constraint. A Bought row whose
  -- bottle is gone is still true history; a Wanting row pointing at a bottle is not.
  constraint wishlist_bought_link_needs_bought_status check (
    bought_polish_id is null or status = 'Bought'
  ),

  foreign key (user_id, bought_polish_id)
    references polish (user_id, id) on delete set null (bought_polish_id)
);

create index wishlist_user_dedupe_idx on wishlist (
  user_id, (lower(btrim(brand)) || ' - ' || lower(btrim(name)))
) where deleted_at is null;

-- The live wishlist is "not bought"; that is the list the screen shows.
create index wishlist_user_open_idx on wishlist (user_id, priority)
  where deleted_at is null and status <> 'Bought';

create trigger wishlist_set_updated_at
  before update on wishlist
  for each row execute function set_updated_at();

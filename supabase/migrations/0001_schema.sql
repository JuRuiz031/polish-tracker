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
--   * dedupe_key is generated, indexed, and deliberately NOT unique: she may legitimately
--     own a backup bottle, so duplicates are a warning, never a block.

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
create type wishlist_status   as enum ('Wanting', 'Wishing', 'Waiting');

-- ---------------------------------------------------------------------------
-- updated_at maintenance. Sync's last-write-wins resolution depends on this being
-- server-authoritative, so it is a trigger rather than something the client sends.
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
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

  brand       text not null check (length(trim(brand)) > 0),
  name        text not null check (length(trim(name))  > 0),
  color       polish_color  not null,
  finish      polish_finish not null,

  -- The actual bottle colour for the UI chip. Distinct from the `color` bucket:
  -- `color` is how she filters, swatch_hex is what she sees.
  swatch_hex  text check (swatch_hex ~ '^#[0-9A-Fa-f]{6}$'),
  photo_path  text,
  notes       text,

  -- Used-up or given-away bottles: out of the picker, still in history.
  archived    boolean not null default false,

  dedupe_key  text generated always as (
                lower(trim(brand)) || ' - ' || lower(trim(name))
              ) stored,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- Target for the composite FKs below. Redundant with the PK on its own, but it is
  -- what lets Postgres enforce that a child row cannot cross a user boundary.
  unique (user_id, id)
);

create index polish_user_dedupe_idx  on polish (user_id, dedupe_key) where deleted_at is null;
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
  days_lasted int check (days_lasted >= 0),
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

  brand         text not null check (length(trim(brand)) > 0),
  name          text not null check (length(trim(name))  > 0),
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

  dedupe_key    text generated always as (
                  lower(trim(brand)) || ' - ' || lower(trim(name))
                ) stored,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index wishlist_user_dedupe_idx on wishlist (user_id, dedupe_key) where deleted_at is null;

create trigger wishlist_set_updated_at
  before update on wishlist
  for each row execute function set_updated_at();

# Pre-persistence audit

A review of the domain logic, the cross-screen relationships, and the SQL schema, done
while the app still runs entirely on `InMemoryRepository` — i.e. while every finding was
still free to fix.

> **Status: the blocking findings are fixed.** The migrations were edited in place rather
> than layered with a corrective `0004`, because they had never been applied to a live
> project — so the result is a clean schema rather than a history of its own mistakes.
> [`src/data/__tests__/schemaParity.test.ts`](../src/data/__tests__/schemaParity.test.ts)
> now asserts each pairing below, so the two sides cannot drift apart again in silence.
>
> **Validated by execution.** The migrations have been applied to PostgreSQL 17 and
> exercised by 47 assertions — every constraint, the `updated_at` trigger's conflict
> behaviour, the `SET NULL` orphaning path, all three views, and RLS isolation between two
> users (run as the `authenticated` role, since a superuser bypasses RLS and would prove
> nothing). All pass. Reproduce with `./supabase/tests/run.sh`.

---

## Blocking — fixed

### 1. `dedupe_key` was a generated column, and therefore unwritable

`polish.dedupe_key` and `wishlist.dedupe_key` were `generated always as (...) stored`.
Postgres rejects **any** insert or update naming a generated column
(`428C9 cannot insert into column`) — and three things carried it anyway: the row types
in `domain/types.ts` declared it required, `buildExportBundle` emitted it on every row
(so the JSON backup could not be restored verbatim), and `InMemoryRepository` populated
it. It was also a stored copy of `brand`+`name`: a transitive dependency on non-key
attributes, and the schema's only genuine 3NF violation.

**Done:** the column is gone. The duplicate rule now lives in an **expression index**:

```sql
create index polish_user_dedupe_idx on polish (
  user_id, (lower(btrim(brand)) || ' - ' || lower(btrim(name)))
) where deleted_at is null;
```

Same lookups, nothing stored, nothing to strip on write, and the JSON backup became
restorable as-is. `domain/dedupe.ts` computes the key on demand for the UI, and
`polish_duplicates` / `wishlist_already_owned` wrap the expression so no caller has to
retype it. Old backups that still contain the field are accepted and the value discarded
(`legacyDedupeKey` in `domain/schema.ts`) — refusing them would mean the escape hatch
stopped opening the archives it exists to protect.

### 2. `updated_at` was server-forced, which inverted last-write-wins

The trigger was `new.updated_at := now()`, unconditionally. That stamps a write replayed
from the offline queue with its **arrival** time rather than the time it was made:

> An edit made on the phone with no signal on Monday, flushed on Wednesday, beats an edit
> made in the browser on Tuesday. "Last write wins" quietly means "last to arrive wins",
> and the Tuesday edit disappears with nothing to show it existed.

**Done:** the client may now supply `updated_at` and it is honoured, clamped so it can
never move backwards.

```sql
new.updated_at := greatest(
  coalesce(nullif(new.updated_at, old.updated_at), now()),
  old.updated_at
);
```

`nullif` is how the trigger tells "the client set this column" from "the client left it
alone" without a second flag — an unchanged column arrives equal to `old`, so it falls
through to `now()` and a plain `UPDATE` from the SQL editor behaves as anyone would
expect. `greatest` keeps the column monotonic per row, so a device with a wrong clock can
be too new but can never rewrite history to be older than what is stored.

This trusts the device clock, which for a single-user app on her own phone is the right
trade. If it ever goes multi-device in earnest, revisit — a separate `client_updated_at`
keeps a trustworthy server audit trail alongside it.

### 3. "Client ids make writes idempotent" was half true

Replaying a plain `insert` with the same id raises a primary-key violation; it does not
land on the same row. The property belongs to `.upsert({ onConflict: 'id' })`, not to the
id. **Done:** documented as such in `domain/types.ts`, so the Supabase repository is
written against the real guarantee rather than the assumed one.

---

## Constraint asymmetries — fixed

Each of these let Postgres hold a value the importer would later refuse, breaking the
round-trip guarantee `data/transfer/` exists to provide.

| Field | Was | Now |
|---|---|---|
| `days_lasted` | zod `0–365`, SQL only `>= 0` | SQL `check (days_lasted between 0 and 365)` |
| `typical_price` | zod unbounded full-float, SQL `numeric(10, 2)` | zod caps at `99999999.99` and rounds to 2dp, so the value sent is the value stored is the value exported |
| `brand` / `name` | free text; JS `.trim()` and pg `btrim()` disagree on tabs | normalised on write (whitespace runs collapsed, ends trimmed) with a matching `CHECK` |
| `rating` | parity already held | unchanged |

The brand/name normalisation is worth calling out: it does not merely tidy input, it
makes the one case where the client and Postgres duplicate keys could disagree
**unreachable**. With no tabs, newlines or double spaces storable, `.trim()` and
`btrim()` cannot produce different answers.

### CSV is export-only, by construction

`CSV_COLUMNS` omits `user_id`, which the row schemas require, so the app's own CSV cannot
be fed back through them. This is intended: `importCollectionCsv` parses against the
**input** schemas and mints fresh rows, because its job is reading her old spreadsheet,
not restoring a backup. The consequence — re-importing that CSV creates duplicates rather
than restoring, and the JSON file is the only true backup — should be said plainly in the
export UI when it is built.

---

## Wishlist: buying no longer destroys the purchase

`polish` and `wishlist` share six columns, and "I bought it" copied them into the
collection and then **deleted** the wishlist row — taking `typical_price`, `where_sold`,
`sale_window` and `priority` with it. "What did I pay, and where?" became unanswerable at
exactly the moment the answer mattered.

**Done:** the row is resolved rather than destroyed. `wishlist_status` gained `'Bought'`,
plus `bought_polish_id` and `bought_on` pointing at the bottle it became.

- A `CHECK` enforces `bought_polish_id is null or status = 'Bought'` — in that direction
  only. The reverse would fight the FK's `on delete set null (bought_polish_id)`: hard
  deleting the polish nulls the column while the status stays `Bought`, and the delete
  would fail on its own constraint. A Bought row whose bottle is gone is still true
  history; a Wanting row pointing at a bottle is not.
- `SET NULL` is column-scoped (PG15+, which `security_invoker` in 0003 already requires).
  A plain composite `SET NULL` would try to null `user_id` too, which is `NOT NULL`.
- `'Bought'` is in `STATUSES` (so stored and imported rows parse) but not in
  `SELECTABLE_STATUSES` (so the form cannot set it with nothing to point at).
- Bought rows are excluded from the wishlist list, from `flagWishlist`, and from the
  `wishlist_already_owned` view — otherwise the purchase would flag itself against the
  very polish it created.

The deeper option — a shared `product` supertype with `polish` and `wishlist` as role
tables — was considered and declined as too large a refactor for the benefit, given the
column duplication is stable and small.

---

## Views — fixed

- **`polish_duplicates` did not return duplicates.** It returned *every* live,
  non-archived polish with a `group_size` column attached, because a window function
  cannot be filtered in its own `WHERE`. It is now wrapped in a subquery with
  `where group_size > 1`, matching the name and the rule in `domain/dedupe.ts`.
- **`polish_stats.days_since` is gone.** It was `current_date - max(worn_on)` — the
  *server's* UTC date — while the client counts from local midnight via `domain/date.ts`,
  a module that exists specifically to avoid that off-by-one. The two disagree by a day
  every evening west of Greenwich, and `days_since` feeds the picker's rest-day rule, so
  a wrong copy is worse than no copy. `last_worn` is timezone-free; derive from it.
- All three views remain `security_invoker = on`, asserted by a test that counts
  `create view` against the guard so a fourth view cannot be added without one.

---

## Resolved — product decisions

### Soft-deleting a polish orphans its wear rows

Verified: deleting `OPI Big Apple Red` (2 wears) moved the polish count 26 → 25 while the
manicure count stayed at 22.

**Decision: keep no-cascade.** The manicures happened, and Undo has to restore the bottle
without rebuilding history — the owner confirmed this is the correct behavior, not a bug.
Note that the SQL's `on delete cascade` therefore never fires in normal use: it guards a
*hard* delete, which the app never performs, and a hard delete *would* correctly take the
wear history with it.

**Done**, the two rough edges:

- `filterWears` returns `false` for a wear whose polish is missing, so brand and colour
  filters silently dropped orphans while the unfiltered list showed them, with nothing
  explaining why. `domain/filters.ts` now exports `orphanedWearCount()`, and the Log
  screen shows a footnote — "N manicures are for a polish that was deleted, so brand and
  color can't match them" — whenever a brand or colour filter is active and at least one
  such row exists.
- `summary.avg_rating` and `summary.manicures_logged` still include ratings/counts from
  deleted polishes, while `mostWorn` and `bestRated` (Stats screen) still cannot — kept as
  is, and documented in `derive.ts` as intentional rather than closed as a bug. The Log
  screen renders those same rows as "Deleted polish" right below the summary, so a summary
  that quietly dropped them would disagree with the list under it on the same screen. The
  Stats screen split is a different, unavoidable population — a per-polish breakdown
  structurally cannot show a polish that no longer exists.

### "How many polishes do I have" has two answers

Verified: the log's **Polishes** tile read 26, the collection list showed 25, because one
bottle is archived and `filterPolishes` hides archived rows by default while `summarise`
counted them. Same split on **Never worn** (9) — left as is; once the Polishes tile
explains itself, the Never-worn split needs no separate footnote.

**Done.** `CollectionSummary` gained an `archived` field, and the Log's **Polishes** tile
now reads "26 (1 archived)" whenever `archived > 0` — the cheapest fix, as noted above,
now shipped.

### Storage and memory, checked for multi-year growth

Asked by the owner directly: is the one-JSON-file design still fine after years of use?
Measured, not guessed — real row sizes via `JSON.stringify(row, null, 2)`, the actual
format `serialise()` writes:

| Usage | Wears/yr | New polishes/yr | File size after 20 years |
|---|---|---|---|
| Moderate | 150 | 30 | 1.15 MB |
| Heavy | 300 | 50 | 2.21 MB |

The only real ceiling in this design is the GitHub Contents API's 1MB inline limit —
`readFile()` already falls back to the blob endpoint above that, but until now the
fallback path had **zero test coverage**; the "tested at 1.88MB" note in an earlier
version of this file was a one-off manual check, not a committed test. Added
`githubRepository.test.ts`'s "falls back to the blob endpoint for a file too large to
inline" — an ~8000-wear, 700-polish snapshot (1.77MB), deliberately sized past the heavy
20-year projection above, not just past 1MB.

Everything else checked out with margin: git deltas near-identical successive JSON
snapshots efficiently, so the repository's on-disk history size stays well under any
GitHub limit even after thousands of commits; IndexedDB and in-memory React state are
non-issues at these sizes; a multi-MB PUT to the Contents API still completes in a second
or two, which does not matter anyway since writes are backgrounded
(`data/repositories/offline.ts`).

**Not built, floated by the owner and deliberately shelved:** pruning the log to a rolling
window (e.g. only the last 12 months) to bound orphan growth. Correctly identified as not
a current problem — the numbers above show it is not becoming one for a long time — so no
code changes were made. Worth revisiting only if a future audit finds the file size is
actually approaching the 1MB boundary in practice, not on a schedule.

---

## Verified sound

Recorded so the next audit does not re-derive it:

- **All five enums match the SQL exactly**, in order, now asserted by a test.
- **`dedupeKey()` genuinely mirrors Postgres** — and since the normalisation above, it
  cannot diverge even in principle.
- **RLS is correct and complete.** `for all` with both `using` and `with check` on all
  three tables (a `using` alone would let a user write a row stamped with someone else's
  `user_id`), `force row level security` so the owner is not exempt, and `revoke ... from
  anon`. All asserted by tests.
- **The composite FK `(user_id, polish_id) → polish (user_id, id)`** makes it structurally
  impossible to attach a wear row to another user's polish, independent of RLS. A
  genuinely good call.
- **Derived stats are honest about absence** — `null` for never-worn and unrated
  throughout, never `0`, so "unrated" and "rated zero" stay distinct facts.
- **Indexes match the access patterns**, all partial on `deleted_at is null`.

---

## Unwired

`src/data/transfer/` — export to JSON + CSV, import from JSON + spreadsheet CSV, with
round-trip tests — is fully implemented and **imported by nothing**. There is no settings
or data screen; `features/`, `ui/` and `app/` never reference it.

The brief calls the escape hatch requirement #3 and non-negotiable, so this is a real gap
rather than polish. The code is done; it needs a screen.

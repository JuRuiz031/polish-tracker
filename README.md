# Polish

A nail polish tracker — collection, wear log, wishlist, and a picker that answers
"what should I wear tonight?"

Replaces a Google Sheets workbook. Built as a PWA so it installs to an iPhone home
screen and a Mac dock from one codebase, with no App Store, no developer account, and
nothing that expires.

## Status

**The UI is complete and driveable on seeded data; persistence is next.** Every screen
works against an in-memory repository, so the whole app can be used and judged before a
Supabase project exists. Nothing persists yet: reloading the page resets to the seed, and
an unmissable banner says so.

### Done

| # | Phase | Detail |
|---|---|---|
| 1 | Domain logic | Picker, derived stats, duplicate detection, filters — pure functions, no React, no I/O |
| 2 | Design system | Tokens, primitives, and a contrast audit that fails the build on a regression |
| 3 | Every screen | Collection, wear log, wishlist, picker, stats — all driveable on the in-memory repo |
| 4 | Import / export layer | JSON + CSV both directions, with round-trip tests. Code complete, not yet wired to a screen |
| 5 | Schema, RLS, views | Written, audited, and corrected — see below |
| 6 | Schema fixes | The audit's blocking findings, applied in place |
| 7 | Schema validated against real Postgres | 47 assertions on PG17: constraints, the sync trigger, the views, and RLS isolation between two users |

### Next

| # | Phase | Detail |
|---|---|---|
| 8 | **Supabase repository + auth** | **Next** — swap `InMemoryRepository` for the real one; one line in `app/store.tsx` |
| 9 | Offline write queue | The `updated_at` clock it depends on is settled and tested |
| 10 | PWA install | Manifest + service worker |
| 11 | Import / export UI | A settings screen for the layer built in phase 4 |
| 12 | Photos | `photo_path` exists on the schema; nothing uploads to it yet |

### What the schema audit changed

An audit found four issues that were cheap to fix with no data in the database and
expensive afterwards. All are now fixed, and
[`src/data/__tests__/schemaParity.test.ts`](src/data/__tests__/schemaParity.test.ts)
asserts each one so the client and the SQL cannot drift apart in silence.

- **`dedupe_key` was a stored generated column** — unwritable by any insert, and a copy of
  `brand`+`name` besides. It is an expression index now, so there is nothing to strip on
  write and a JSON backup restores as-is.
- **The `updated_at` trigger overwrote whatever the client sent**, which turned "last
  write wins" into "last to arrive wins" — an edit made offline on Monday and synced
  Wednesday would silently beat an edit made in the browser on Tuesday. It now honours a
  client timestamp, clamped so it can never move backwards.
- **Two check-constraint asymmetries** (`days_lasted`, `typical_price`) let Postgres hold
  values the importer would later refuse, breaking the round-trip guarantee.
- **Buying a wishlist item deleted the row**, discarding the price, the retailer and the
  priority. It is now marked `Bought` and linked to the bottle it became.

Full detail, including the two open questions that need a product decision rather than a
fix, is in [`docs/pre-persistence-audit.md`](docs/pre-persistence-audit.md).

The migrations were edited in place rather than corrected by a `0004`, because they had
never been applied anywhere — the result is a clean schema rather than a record of its own
mistakes. They have since been run against PostgreSQL 17 and all 47 assertions pass; see
[Testing the schema](#testing-the-schema).

## Running it

No Supabase project is needed to run the UI right now:

```bash
npm install
npm run dev          # opens on the seeded in-memory data
```

Once the Supabase repository lands (phase 8), it will also want:

```bash
cp .env.example .env.local   # then fill in from the Supabase dashboard
```

```bash
npm test            # 224 tests: domain logic, contrast audit, round trip
npm run coverage    # domain/ is held to 90% statements
npm run lint        # oxlint
npx tsc -b          # typecheck
```

### Testing the schema

`npm test` includes a parity suite that reads the migrations as text and checks the
client and the SQL still agree — enum values, bounds, the dedupe expression. What it
cannot do is prove the SQL parses, that a `CHECK` rejects what it should, that the
`updated_at` trigger resolves conflicts the way its comment claims, or that RLS actually
isolates two users. That needs a real server:

```bash
./supabase/tests/run.sh            # create a throwaway Postgres, run 47 assertions
./supabase/tests/run.sh --clean    # ...and destroy the VM afterwards
```

It builds a podman machine **of its own** (`polish-pgtest`), so it cannot disturb any
other VM on the machine, and it recreates the database on every run — which re-proves the
migrations apply from nothing each time. Requires podman; needs PG15+ for
`security_invoker` and column-scoped `SET NULL`.

## Setting up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Run the migrations in order, via the SQL editor or `supabase db push`:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_rls.sql`
   - `supabase/migrations/0003_views.sql`
3. **Authentication → Providers → Email: turn "Enable signup" OFF.** Single-user is
   enforced here, not in code. Add the one user by invite.
4. Copy the project URL and anon key into `.env.local`.
5. Add repository secrets for the workflows: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_REPO`, `BACKUP_TOKEN`.

### Why the heartbeat workflow exists

Supabase pauses a free project after ~7 days without database activity. A gift app that
sits unopened for a week would otherwise greet its user with errors.
`.github/workflows/heartbeat.yml` issues one trivial query a day to keep it awake, and
`backup.yml` dumps everything nightly to a private repo so even a total loss of the
Supabase project costs at most one day.

## Architecture

```
src/
  domain/     Pure TypeScript. No React, no Supabase, no I/O.
  data/       Supabase client, repositories, offline queue, import/export.
  features/   One directory per screen.
  ui/         Shared primitives.
  styles/     Design tokens and the contrast audit.
```

`domain/` is the load-bearing boundary. Every business rule — the picker's eligibility
test, duplicate detection, derived stats — is a pure function there, imported by the UI
but importing nothing from it. That is what makes the rules testable without a browser,
and what would let the backend be swapped without touching a screen.

`data/repositories/` sits behind an interface, so Supabase is an implementation detail
rather than an assumption baked into every component. That interface is currently
carrying its weight: `InMemoryRepository` is a full implementation of it — client-generated
ids, soft deletes, the Bought/bought_polish_id pairing — which is what lets the entire UI be built,
driven, and judged with no backend at all. Swapping in the Supabase implementation
changes one line in `app/store.tsx` and no screen.

`data/repositories/seed.ts` is a stand-in for the spreadsheet import, shaped to put
every state the UI must handle on screen at once: never-worn, long-resting, recently
worn, a duplicate pair, an archived bottle, and both wishlist flag states.

### Multi-user

The app ships single-user, but the database is multi-tenant from day one. Every table
carries `user_id` with a row-level-security policy keyed to `auth.uid()`, so isolation
is enforced by Postgres rather than by application code — a bug in the client cannot
leak one user's data to another. Opening it up later means enabling signups and adding
a signup screen; the schema and policies do not change.

### Derived values

`times_worn`, `last_worn`, `days_since`, and `avg_rating` are never stored. They are
computed from wear rows in `domain/derive.ts` so they work offline and cannot drift out
of sync with the log. Equivalent SQL views exist in `0003_views.sql` for export
sanity-checks.

`days_since` is deliberately **absent** from those views. It would have to be computed
against the server's UTC date, while the client counts from local midnight — the exact
off-by-one `domain/date.ts` exists to prevent, and it feeds the picker's rest-day rule.
`last_worn` is a timezone-free fact; the client derives the rest from it.

### Deletes are soft

Nothing is ever hard-deleted; rows get a `deleted_at`. One decision covering three
requirements: Undo without confirm dialogs, idempotent replay of offline writes, and no
way for a mis-tap to destroy data.

A soft delete does **not** cascade. Deleting a polish leaves its wear rows live, which is
deliberate — the manicures still happened, and Undo has to be able to put the bottle back
without reconstructing history. The visible consequence is that the log keeps those rows
and labels them "Deleted polish", while the collection, the stats and the picker no longer
see them. Note that the SQL's `on delete cascade` therefore never fires in normal use; it
is a guard for a hard delete, and a hard delete *would* take the wear history with it.

## Accessibility

Not decorative here — the user is dyslexic, so this is a functional requirement.

- Body text 17px, line height 1.65, nothing below weight 400, left-aligned.
- Body and heading text hold **AAA (7:1)** contrast on every surface.
- No dyslexia-branded font. Body is Atkinson Hyperlegible Next, a legibility face built
  for character disambiguation.

`src/styles/__tests__/contrast.test.ts` measures every pairing and fails the build on a
regression. Three constraints came out of that audit rather than from taste:

| Finding | Rule |
|---|---|
| plum `#8E4A63` is 6.2:1 on the page — AA, not AAA | Body-size text uses deepPlum `#6E3049` (9.4:1). Plum is for fills and large display text. |
| Both plum shades fall short on the alert surface | State surfaces (mint/amber/alert) carry ink text only. |
| edge `#DCB4C4` is 1.8:1 — under the 3:1 for UI components | Decorative hairlines only. Controls use `--border-functional`. |

The palette itself is unchanged from the one that was approved; only its usage is
constrained.

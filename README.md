# Polish

A nail polish tracker — collection, wear log, wishlist, and a picker that answers
"what should I wear tonight?"

Replaces a Google Sheets workbook. Built as a PWA so it installs to an iPhone home
screen and a Mac dock from one codebase, with no App Store, no developer account, and
nothing that expires.

## Status

**Phase 2/3 — the UI runs on seeded data.** Every screen is built and driveable against
an in-memory repository, so the whole app can be used and iterated on before a Supabase
project exists. Nothing persists yet: reloading the page resets to the seed, and an
unmissable banner says so.

| Phase | What | State |
|---|---|---|
| 1 | Schema, RLS, import/export, backups | SQL + transfer layer done; needs a live Supabase project |
| 2 | Collection + wear logging | screens done, on the in-memory repo |
| 3 | Picker + PWA shell | picker done; installable manifest + service worker not started |
| 3.5 | **Supabase repository + auth** | **next** — swap `InMemoryRepository` for the real one |
| 4 | Offline write queue | not started |
| 5 | Photos, import UI, stats | not started |

## Running it

No Supabase project is needed to run the UI right now:

```bash
npm install
npm run dev          # opens on the seeded in-memory data
```

Once Phase 3.5 lands, it will also want:

```bash
cp .env.example .env.local   # then fill in from the Supabase dashboard
```

```bash
npm test            # 149 tests: domain logic, contrast audit, round trip
npm run coverage    # domain/ is held to 90% statements
npx tsc -b          # typecheck
```

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
ids, soft deletes, recomputed dedupe keys — which is what lets the entire UI be built,
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
of sync with the log. The equivalent SQL views exist in `0003_views.sql` for
export sanity-checks.

### Deletes are soft

Nothing is ever hard-deleted; rows get a `deleted_at`. One decision covering three
requirements: Undo without confirm dialogs, idempotent replay of offline writes, and no
way for a mis-tap to destroy data.

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

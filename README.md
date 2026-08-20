# Polish

A nail polish tracker — collection, wear log, wishlist, and a picker that answers
"what should I wear tonight?"

Replaces a Google Sheets workbook. Built as a PWA so it installs to an iPhone home
screen and a Mac dock from one codebase, with no App Store, no developer account, and
nothing that expires.

## Status

**The UI is complete and driveable on seeded data; persistence is being wired up.** Every
screen works against an in-memory repository, so the whole app can be used and judged
before any backend exists. Nothing persists yet: reloading the page resets to the seed,
and an unmissable banner says so.

### Storage: a private repository, not a database

The collection is stored as one JSON file in a **private GitHub repository**, written
through the Contents API. Every save is a commit.

This replaced a planned Supabase backend, and the reason is durability rather than
elegance. This app is a gift; it has to keep working while nobody is maintaining it. The
Supabase free tier pauses a project after 7 days of inactivity and needs a **manual**
dashboard click to restore, keeps **zero** backups of its own, and releases the project's
API URL after 90 days paused. Keeping it awake meant a scheduled GitHub Action — which
GitHub disables after 60 days of repository inactivity, taking the nightly backup with it.
Two safety nets sharing one point of failure, on a clock, about two months after the last
commit.

A private repo has none of that. Nothing pauses, nothing expires, no cron has to keep
anything warm, and the history *is* the backup — any day of her collection is recoverable
with `git checkout`. The stored file is exactly the shape `exportSchema` defines, so
cloning the repo yields a working export with no app involved.

What it costs, stated plainly: no server-side constraint enforcement (the client
validates, and a push-triggered Action can check the file), and a hard single-user
ceiling. Going multi-user later means a real backend and a migration.

### Done

| # | Phase | Detail |
|---|---|---|
| 1 | Domain logic | Picker, derived stats, duplicate detection, filters — pure functions, no React, no I/O |
| 2 | Design system | Tokens, primitives, and a contrast audit that fails the build on a regression |
| 3 | Every screen | Collection, wear log, wishlist, picker, stats — all driveable on the in-memory repo |
| 4 | Import / export layer | JSON + CSV both directions, with round-trip tests. Code complete, not yet wired to a screen |
| 5 | Postgres schema | Written, audited, fixed, and validated against real PG17 — now **shelved**, see below |
| 6 | GitHub storage layer | `GitHubRepository` + Contents API client, behind the existing interface. Tested against a mocked API |

### Next

| # | Phase | Detail |
|---|---|---|
| 7 | **Setup screen + wiring** | **Next** — paste a token, verify write access, store it, swap the repository in `app/store.tsx` |
| 8 | Export screen | Wire up the phase-4 layer. This is what makes her data independent of every account involved |
| 9 | Offline cache | A full local copy so the app works with no signal, and a failed write is queued rather than lost |
| 10 | PWA install | Manifest + service worker. Load-bearing for data safety — see below |
| 11 | Batched bulk import | Importing her spreadsheet must be **one** commit, not one per polish |
| 12 | Photos | `photo_path` exists on the row type; nothing uploads to it yet |

### Why PWA install matters more than it looks

iOS caps script-writable storage at 7 days for ordinary Safari tabs, and can evict
IndexedDB from infrequently-used sites. Web apps **installed to the home screen** with
`display: standalone` are exempt. So installing is not polish — it is what makes the
offline copy on her phone trustworthy, and it is why phase 10 is not last.

### The Postgres work is shelved, not deleted

`supabase/` still holds the schema, the RLS policies, the views, and a test harness that
proves all of it against a real PostgreSQL 17. It is kept because it is the migration
path if this ever goes multi-user — that design is done and validated, which is the
expensive part.

It was not wasted work either. The audit that produced it shook out constraint
asymmetries that fed the Zod schemas the app still uses today, the brand/name
normalisation that keeps duplicate detection consistent, and the wishlist `Bought`
redesign that stopped buying a polish from discarding what she paid for it. All of that
survives the backend change.

⚠️ `.github/workflows/heartbeat.yml` and `backup.yml` exist to keep a Supabase project
awake and backed up. **Neither is needed any more**, and both will fail on a schedule
until they are removed or their secrets are configured.

### What the schema audit changed

An audit of the schema against the client found four issues, all now fixed. Most of what
it turned up outlived the backend it was written for — which is the argument for having
done it before any data existed, rather than the argument against having done it at all.

| Finding | Still live? |
|---|---|
| **`dedupe_key` was a stored generated column** — unwritable by any insert, and a redundant copy of `brand`+`name` | **Yes.** The field is gone from the row types, so the stored JSON has no stale copy to disagree with the rows it was derived from |
| **Two check-constraint asymmetries** (`days_lasted`, `typical_price`) let the database hold values the importer would refuse | **Yes, and it matters more now.** With no server, the Zod schemas are the *only* enforcement — including rounding prices so a stored value can never differ from what was sent |
| **Buying a wishlist item deleted the row**, discarding the price, the retailer and the priority | **Yes.** Lives in the row types, the enums, the UI and both repositories |
| **The `updated_at` trigger overwrote the client's timestamp**, turning "last write wins" into "last to arrive wins" | Shelved with the SQL — but the same rule now resolves two-device conflicts in `GitHubRepository`, by re-reading and re-applying rather than overwriting |

Also from that audit: **brand and name are normalised on write** (whitespace collapsed,
ends trimmed). That began as a way to stop JS `.trim()` and Postgres `btrim()` disagreeing
about duplicates, and it survives as the reason duplicate detection is stable at all.

Full detail, including the two open questions that need a product decision rather than a
fix, is in [`docs/pre-persistence-audit.md`](docs/pre-persistence-audit.md).
[`src/data/__tests__/schemaParity.test.ts`](src/data/__tests__/schemaParity.test.ts) keeps
the shelved SQL and the live client from drifting apart, so the migration path stays valid
if it is ever needed. See
[Testing the shelved Postgres schema](#testing-the-shelved-postgres-schema).

## Running it

No backend of any kind is needed to run the UI:

```bash
npm install
npm run dev          # opens on the seeded in-memory data
```

```bash
npm test            # 245 tests: domain logic, storage layer, contrast audit, round trip
npm run coverage    # domain/ is held to 90% statements
npm run lint        # oxlint
npx tsc -b          # typecheck
```

## Setting up storage

One private repository holds the collection. She does **not** need a GitHub account —
the token is created once, by you, and put on her devices; GitHub stays invisible to her.

1. Create a **private** repository, e.g. `polish-data`. Nothing needs to be in it — the
   app creates the file on her first save.
2. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.
3. **Resource owner:** you. **Repository access:** Only select repositories → `polish-data`.
4. **Permissions:** Contents → **Read and write**. (Metadata read is added automatically.
   Grant nothing else.)
5. **Expiration:** No expiration. Personal-account tokens allow this; the 366-day cap is
   an organisation policy and does not apply here.
6. Enter it in the app's setup screen, on each device she uses.

> ⚠️ **Use a fine-grained token, never a classic one.** A classic PAT with `repo` scope
> can reach **every private repository on the account**. A fine-grained token scoped to
> one repo with Contents read/write can do exactly one thing: read and write files in that
> repo. It cannot see other repositories, cannot delete this one, and cannot act as the
> account anywhere else. That difference is the entire security model for a credential
> that lives on a phone.

Commits are authored as `Polish <app@polish.invalid>` rather than as the token's owner.
`.invalid` is reserved by RFC 2606 and can never belong to a GitHub account, so a saved
manicure cannot land on anyone's contribution graph.

### Testing the shelved Postgres schema

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

## Architecture

```
src/
  domain/     Pure TypeScript. No React, no network, no I/O.
  data/       Storage clients, repositories, import/export.
  features/   One directory per screen.
  ui/         Shared primitives.
  styles/     Design tokens and the contrast audit.
```

`domain/` is the load-bearing boundary. Every business rule — the picker's eligibility
test, duplicate detection, derived stats — is a pure function there, imported by the UI
but importing nothing from it. That is what makes the rules testable without a browser,
and what would let the backend be swapped without touching a screen.

`data/repositories/` sits behind an interface, so the backend is an implementation detail
rather than an assumption baked into every component. That interface has now earned itself
twice over. It let the entire UI be built and judged against `InMemoryRepository` with no
backend at all — and when the backend changed from Postgres to a GitHub repository, the
switch was a new class implementing the same eleven methods. **No screen changed. No
domain function changed.** Selecting a repository is one line in `app/store.tsx`.

Three implementations now exist or are planned:

| | Used for |
|---|---|
| `InMemoryRepository` | the seeded demo, and every test that needs a backend |
| `GitHubRepository` | production storage — one JSON file, one commit per change |
| *(shelved)* Supabase | kept as the multi-user migration path, not built |

`data/repositories/seed.ts` is a stand-in for the spreadsheet import, shaped to put
every state the UI must handle on screen at once: never-worn, long-resting, recently
worn, a duplicate pair, an archived bottle, and both wishlist flag states.

### Multi-user, if it ever happens

Storing the collection in one repository is a single-user design and there is no way to
dress that up: going multi-user means a real backend.

The groundwork is done, though. Rows still carry `user_id`, and the shelved Postgres
schema is multi-tenant with row-level security keyed to `auth.uid()` — isolation enforced
by the database rather than by application code, verified with two users. Migrating would
mean standing that schema up and importing the JSON file, which is already exactly the
format the importer reads.

### Derived values

`times_worn`, `last_worn`, `days_since`, and `avg_rating` are never stored. They are
computed from wear rows in `domain/derive.ts` so they work offline and cannot drift out of
sync with the log. This matters more with a file-based backend than it would with a
database: there is no server to compute them, and no chance of a stored total disagreeing
with the rows it came from.

`days_since` in particular is always computed locally. Deriving it server-side would mean
using a UTC date while the client counts from local midnight — the exact off-by-one
`domain/date.ts` exists to prevent, and it feeds the picker's rest-day rule. `last_worn`
is a timezone-free fact; everything else follows from it.

### Deletes are soft

Nothing is ever hard-deleted; rows get a `deleted_at`. One decision covering three
requirements: Undo without confirm dialogs, idempotent replay of offline writes, and no
way for a mis-tap to destroy data.

A soft delete does **not** cascade. Deleting a polish leaves its wear rows live, which is
deliberate — the manicures still happened, and Undo has to be able to put the bottle back
without reconstructing history. The visible consequence is that the log keeps those rows
and labels them "Deleted polish", while the collection, the stats and the picker no longer
see them.

Two consequences of that are still open questions rather than settled design; both are
written up in [`docs/pre-persistence-audit.md`](docs/pre-persistence-audit.md).

With the repository as the backend there is a second layer of undo underneath all of
this: every change is a commit, so anything at all is recoverable with `git revert`, even
a mistake the app has no button for.

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

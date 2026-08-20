# Working on Polish

A nail polish tracker built as a gift for the owner's girlfriend, who will be its only
user and its beta tester. She is dyslexic; the accessibility constraints in the README
are functional requirements, not preferences.

The guiding constraint for every decision here: **it has to keep working while nobody is
maintaining it, and her data must never be lost.** That is why the backend is a git
repository rather than a database, and why several things below look more paranoid than a
todo app would justify.

---

## Where we left off (last session)

Persistence is built and working end to end. `main` has:

1. The wheel animation fix
2. Postgres schema audit + fixes + validation (now **shelved** — see below)
3. Storage moved to a private GitHub repo
4. First-run setup screen and the four connection states
5. Write-side validation
6. Offline-first writes with row-level reconciliation

**Next up, in order:**

| | What | Why |
|---|---|---|
| 1 | **Export screen** | Wire up `src/data/transfer/` — it is fully written and tested but imported by *nothing*. This is what makes her data independent of GitHub, the owner's account, and this app. Agreed as the next task. |
| 2 | **JSON import (restore)** | Pairs with export to give her local backups. Use `importJson`, which reads our own format. |
| 3 | **PWA install** (manifest + service worker) | Load-bearing, not polish. See "known gaps". |
| 4 | Photos | `photo_path` exists on the row type; nothing uploads to it. |

**Explicitly deprioritised:** importing her original spreadsheet. `importCollectionCsv`
exists but its column aliases are guesses, and she only has ~50 polishes — entering them
by hand once was judged easier and safer than debugging a fragile mapping. Do not spend
time here unless asked.

---

## Known gaps — say these out loud rather than discovering them later

- **Reloading the app while offline fails.** There is no service worker, so the browser
  cannot fetch the app shell. Offline *data* works fine while the app stays open; force-
  quitting without signal and reopening does not. This is the strongest argument for
  doing the PWA phase soon.
- **Bulk operations commit one at a time.** Importing or adding many rows would produce
  one commit each. Needs a batch path before any bulk feature ships.
- **Two open design questions** are written up in `docs/pre-persistence-audit.md` and
  still need the owner's decision: soft-deleting a polish orphans its wear rows (the
  log's "N of M" counter disagrees with its own list when filtered), and "how many
  polishes do I have" has two answers because the Log tile counts archived bottles while
  the Collection hides them.

---

## Setup needed before touching live data

The data lives in the private repo **`JuRuiz031/polish-data`**. It is currently a blank
slate: one `Initial commit` containing only a README, no `data/collection.json` (the app
creates it on first save).

To test against it you need a **fine-grained** token from the owner:

- Resource owner: him. Repository access: **only** `polish-data`.
- Permissions: **Contents → Read and write**. Nothing else.
- Never a *classic* token — `repo` scope reaches every private repository he owns.

The token used last session was deliberately short-lived and is gone. **Ask for a new
one; do not assume one is lying around.** Prefer a throwaway with a short expiry for
testing, and clean up any test data afterwards.

---

## Git identity — read this before the first commit

The machine-global git config is the owner's **work** email
(`Juan.Fernando.Ruiz@ibm.com`). This is a **personal** project, and GitHub rejects pushes
that use it (`GH007: your push would publish a private email address`).

Set it **locally in this repo only**, never `--global`:

```bash
git config user.name  "JFRuiz"
git config user.email "77316037+JuRuiz031@users.noreply.github.com"
```

Check `git log --format='%an <%ae>' | sort -u` matches before committing. The owner has
agreed to say up front whether a task is work or personal.

Also: **do not use the existing `podman-machine-default` VM** — it belongs to a work
repo. `supabase/tests/run.sh` creates its own machine (`polish-pgtest`) for exactly this
reason.

---

## Architecture: the one thing to understand

Everything above `data/repositories/` talks to the `Repository` interface and knows
nothing about the backend. That interface has already earned itself twice — the entire
UI was built against `InMemoryRepository` before a backend existed, and swapping Postgres
for GitHub changed no screen and no domain function.

| Implementation | Used for |
|---|---|
| `InMemoryRepository` | the seeded demo, and every test needing a backend |
| `GitHubRepository` | one JSON file in a private repo, one commit per change |
| `OfflineRepository` | wraps the above; local-first writes, background sync |
| *(shelved)* Supabase | `supabase/` holds a validated schema kept as the multi-user path |

`domain/` is pure functions — no React, no I/O. Business rules live there so they are
testable without a browser. Derived stats (`times_worn`, `days_since`, …) are **never
stored**; they are recomputed from wear rows.

---

## Invariants — do not break these without a very good reason

These exist because breaking them loses or misrepresents her data.

1. **Never write a snapshot that would not load.** `assertReadable` runs before every
   push. Reads refuse to parse a malformed file rather than returning an empty
   collection — because every mutation rewrites the whole file, so treating a corrupt
   file as "no data" would commit that emptiness over everything she owns.
2. **A device that has ever connected must never show demo data.** Falling back to the
   seeded collection after a revoked key would tell her, wrongly, that her polishes were
   replaced by a stranger's. `hasEverConnected` is stored *separately* from the
   connection so clearing a bad token does not erase the memory that her data exists.
3. **A refused key and a missing network are different states.** One is worth
   interrupting her about; the other resolves itself.
4. **Deletes are soft, ids are client-generated.** Both are load-bearing for offline
   reconciliation: a soft delete merges like any row update (so reconnecting cannot
   resurrect what she deleted), and stable ids mean one row edited twice stays one row.
5. **Merge ties must resolve deterministically.** Two devices reaching different answers
   would write different files back and undo each other forever.
6. **Commits are authored `Polish <app@polish.invalid>`.** `.invalid` is reserved by RFC
   2606, so saving a manicure can never land on anyone's contribution graph.

---

## Gotchas learned the hard way

Every one of these was a real bug caught by testing, not by reading:

- **Shallow copies of a shared empty snapshot.** `{ ...EMPTY }` shares the arrays; the
  first row added leaks into the module constant. Use a function returning fresh arrays.
- **`btoa` throws on the first em dash or emoji.** Base64 must go through `TextEncoder`.
- **The Contents API stops inlining above 1MB** and returns an empty string, so a large
  collection would load as *empty*. There is a blob-endpoint fallback; it is tested at
  1.88MB.
- **A boolean "primed" flag set before an async load resolves** lets a concurrent second
  read return the empty pre-load state. Share the promise instead.
- **React runs child effects before parent effects.** Anything the store needs must be
  ready before the store mounts, not arranged in a parent effect.
- **Swallowing errors in a promise chain hides them from `await`ers too.** Keep the
  chain-continuation promise and the returned promise separate.

**Test in a browser, not just in vitest.** The last three bugs above were invisible to
unit tests and obvious within seconds of driving the real app. Playwright is not a
dependency — install it temporarily, then remove it and restore `package-lock.json`.

---

## Commands

```bash
npm run dev          # seeded in-memory data, no backend needed
npm test             # 286 tests
npm run lint         # oxlint
npx tsc -b           # typecheck
./supabase/tests/run.sh --clean   # 47 assertions against a throwaway PG17 (shelved schema)
```

Run all four before committing. The contrast audit fails the build on a regression, which
is intentional.

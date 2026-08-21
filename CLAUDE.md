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

Persistence, the export/restore round trip, and PWA install are all built and verified
end to end. `main` has:

1. The wheel animation fix
2. Postgres schema audit + fixes + validation (now **shelved** — see below)
3. Storage moved to a private GitHub repo
4. First-run setup screen and the four connection states
5. Write-side validation
6. Offline-first writes with row-level reconciliation
7. **Backup screen** — download and restore, wired to the existing `data/transfer/` layer
8. **PWA install** — manifest, icons, service worker; offline reload now works
9. **Both open design decisions settled** and the storage/growth question the owner
   raised is answered with real numbers — see `docs/pre-persistence-audit.md`'s
   "Resolved" section, not "Known gaps" below (moved there once this actually happened)
10. **Deployed to GitHub Pages** — live at `https://juruiz031.github.io/polish-tracker/`,
    auto-deploys on every push to `main` via `.github/workflows/deploy-pages.yml`. Served
    from a **subpath**, not the domain root — see "GitHub Pages subpath" below before
    touching `vite.config.ts`, `index.html`, or `App.tsx`'s router.

**Next up, in order:**

| | What | Why |
|---|---|---|
| 1 | **Batched bulk import** of her original spreadsheet | Explicitly deprioritised (below), but if it ever happens it needs one commit, not one per row — the batch path (`Repository.replaceAll`) already exists and JSON restore already uses it; a CSV importer would just need to build a merged `Snapshot` the same way `store.tsx`'s `importBackup` does. |
| 2 | Beta test with the actual owner (Anabel), a few hours, on real device(s) | Everything below this line is written/simulated; nothing has been driven by the person it's for yet. |

**Explicitly deprioritised:**
- Importing her original spreadsheet. `importCollectionCsv` exists but its column
  aliases are guesses, and she only has ~50 polishes — entering them by hand once was
  judged easier and safer than debugging a fragile mapping. Do not spend time here
  unless asked.
- **Photos — cut, not just deferred.** `photo_path` still exists on the row type (it is
  free — nothing is being un-done), but no upload path will be built while storage is a
  git repository. Binary blobs committed on every edit is a bad fit for a backend chosen
  specifically to avoid write amplification and quota surprises; see the README's "Storage:
  a private repository, not a database" for why that trade-off was made in the first
  place. Revisit only if this ever moves to a real backend (the shelved Supabase path, or
  something else) — not before.

---

## Known gaps — say these out loud rather than discovering them later

- **Reloading the app while offline now works** — verified with Playwright: install the
  service worker, reload once so the page is controlled, go offline, reload again, the
  shell still renders. This was the strongest argument for doing the PWA phase, and it is
  done. What is *not* tested is a real iOS home-screen install — only the mechanism
  (`vite-plugin-pwa`, workbox precache, manifest, apple-touch-icon) is verified in
  Chromium. Confirm on her actual phone during the beta.
- **`Repository.replaceAll` exists now** — added this session, so bulk writes (JSON
  restore, and the offline layer's own reconciliation push) go through one commit
  instead of one per row. If a future bulk feature (CSV import, say) calls `addPolish`
  in a loop instead of building a `Snapshot` and calling `replaceAll` once, it has
  regressed back into the write-amplification problem this was built to avoid.
- **GitHub Pages subpath — the sharp edge in the whole deployment.** The live site is at
  `/polish-tracker/`, not `/`. Four places have to agree on that or "Add to Home Screen"
  breaks silently: `vite.config.ts`'s `base` (conditional on `command === 'build'`, since
  `npm run dev` still needs `/`), the PWA manifest's `start_url`/`scope`/icon paths
  (derived from that same `base`, not hard-coded), `index.html`'s `%BASE_URL%`-prefixed
  asset hrefs (root-absolute `/x` paths do NOT get auto-prefixed by Vite the way the
  module script does — this is the trap), and `App.tsx`'s `<BrowserRouter
  basename={import.meta.env.BASE_URL}>`. GitHub Pages also has no server-side rewrites,
  so a reload on any route but `/` hits a real 404 — `public/404.html` redirects back to
  `index.html` with the path folded into `?redirect=`, and a head script in `index.html`
  restores it via `history.replaceState` before React Router reads the URL.

  **`vite preview` does not faithfully emulate this** — it does not mount built assets
  under `base` the way a real static host does, so it will show phantom 404s (or worse,
  silently serve `index.html` in place of a JS file) that do not reproduce on the actual
  deployed site. To test a subpath build locally, serve `dist/` from a plain static
  server rooted so `/polish-tracker/` resolves correctly (e.g. copy `dist/` into a
  `polish-tracker/` subfolder and run `python3 -m http.server` from its parent) — that is
  what was actually used to verify this, after `vite preview` gave false negatives.
- **Storage growth is a solved question, not an assumption.** Measured (not estimated):
  even heavy use — 300 manicures/year, 50 new polishes/year — projects to 2.21MB after
  20 years, comfortably inside what the Contents-API blob-endpoint fallback now has real
  test coverage for (1.77MB, deliberately past that projection). Full numbers and method
  in `docs/pre-persistence-audit.md`. A rolling 12-month log window was considered and
  correctly shelved as solving a problem that does not exist yet — do not build it
  pre-emptively; revisit only if a real file approaches 1MB.

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
npm test             # 295 tests
npm run lint         # oxlint
npx tsc -b           # typecheck
npm run build        # also verifies the PWA plugin still emits sw.js + manifest.webmanifest
./supabase/tests/run.sh --clean   # 47 assertions against a throwaway PG17 (shelved schema)
```

Browser-testing the PWA/offline behavior needs Playwright, which is not a dependency —
install it temporarily (`npm install -D playwright && npx playwright install chromium`),
run against `npm run preview` (the service worker only exists in a production build, not
`npm run dev`), then `npm uninstall playwright && git checkout package-lock.json`. Browsers
are cached under `~/.cache/ms-playwright` between sessions, so the install step is usually
instant.

Run all four before committing. The contrast audit fails the build on a regression, which
is intentional.

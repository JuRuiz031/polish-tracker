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

Everything through deployment was already built and verified when this session started:
the wheel animation fix, the Postgres schema audit (now **shelved**), GitHub-repo
storage, the setup screen and four connection states, write-side validation,
offline-first writes with row-level reconciliation, the backup screen, PWA install, both
open design decisions settled, and GitHub Pages deployment at
`https://juruiz031.github.io/polish-tracker/` — served from a **subpath**, so read
"GitHub Pages subpath" below before touching `vite.config.ts`, `index.html`, or
`App.tsx`'s router.

**The beta test has now actually started, and it immediately found what a year of
simulation did not.** On a real iPhone every modal was unusable: the panel opened, flew
upward and came to rest above the viewport, leaving only its bottom edge — a strip of
Save/Cancel/Delete — visible at the top of the screen with the backdrop greyed behind it.
Six earlier commits had attacked this as "renders as a sliver at the top" and failed,
because that description was wrong. It is fixed now (commit `ec44a13`); the reasoning is
under "The iOS sheet bug" below, and it is worth reading before touching `ui/Sheet.tsx`
or the `.sheet__*` rules.

Two follow-up layout faults from the same beta session are also fixed (`67d0c66`): a stat
tile that wrapped mid-parenthetical, and an `input[type="date"]` whose WebKit intrinsic
width made the whole form horizontally scrollable.

**She is testing in demo mode.** The screenshots so far show seeded data — "OPI Bubble
Bath", 26 polishes, 22 manicures, 4.2★ — which is exactly what `npm run dev` and "Look
around first" produce. No token has been issued and `polish-data` is still empty, so
nothing observed so far has touched real data, and no real data exists to lose yet.

**Next up:**

| | What | Why |
|---|---|---|
| 1 | **Bulk add / import** — reopened, being designed | The owner asked for this directly. See "Bulk import" below; it is no longer deprioritised. |
| 2 | Continue the beta on a real device | The sheet bug proves this is where the real bugs are. Still untested: home-screen install, and anything touching a real token. |

**Explicitly deprioritised:**
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
  done. What is *still* not tested is a real iOS home-screen install — only the mechanism
  (`vite-plugin-pwa`, workbox precache, manifest, apple-touch-icon) is verified in
  Chromium. The beta so far has been in an ordinary Safari tab opened from a Discord
  link, which is the one context where the 7-day storage cap applies, so this remains
  unconfirmed and matters: see "Why PWA install matters more than it looks" in the README.
- **A service worker precaches the shell, so a deployed fix may not be what she is
  looking at.** When asking her to re-test, say explicitly how to bypass it — close the
  tab and reopen, or fully quit the app from the switcher if it is home-screen installed.
  A "your fix didn't work" report from a stale cache costs a whole round trip.
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

## The iOS sheet bug — seven commits, and what actually ended it

Worth reading in full before changing `ui/Sheet.tsx` or the `.sheet__*` rules, because
six of those seven commits were confident, well-argued, and wrong.

**The symptom was misread from the start.** Every earlier attempt described it as "the
modal renders as a sliver at the top of the screen" and reached for height and viewport
units — `svh`, `dvh`, percentages, JS measurement, and eventually a full-screen redesign.
None worked. What the strip at the top of the screen actually contained was
`.form__actions` — the **last** element inside the scrolling `.sheet__body`. (`Sheet` has
a `footer` prop, but no screen passes it; every form's buttons are the tail of the form
itself.) So the visible strip was the panel's **bottom edge**, with the grip, the header
and every field pushed off-screen above it.

That is a **vertical displacement, not a collapsed height** — a different bug from the one
being fixed, which is why six height fixes in a row did nothing. The owner's own
description clinched it: the panel "flies to the top and then disappears above the
screen" is the entry animation running *correctly* from below up to `translateY(0)`, when
`translateY(0)` is itself off-screen. The animation was never at fault. The resting
position was.

Two things could displace it, and both were removed:

1. **The scroll lock was translating the whole document.** `lockBodyScroll` pinned
   `<body>` with `position: fixed; top: -scrollY` — the standard iOS recipe, and the only
   code in the app that moves the document vertically, by exactly a scroll offset. It was
   safe to drop because that trick exists to hide background scrolling behind a *partial*
   bottom sheet, and the phone sheet had already become a full-screen opaque take-over —
   the benefit was gone, the risk was not. It is now `overflow: hidden` plus
   `overscroll-behavior: none`, which holds the page still **without moving it**.
2. **The panel's box was defined by the `<dialog>`.** `.sheet__panel` was
   `position: absolute; inset: 0`, so it was only ever as correct as the dialog's box —
   and the dialog is the one element here already caught misbehaving on a real device
   (an earlier session watched it collapse to 0x0, which is why `dialog.sheet` carries an
   explicit `width`/`height` papering over it). It is now `position: fixed`, resolving
   against the viewport directly and cutting the dialog out of the layout chain. The
   dialog still supplies the focus trap, the inert background and Escape-to-close.

**Both shipped together and the bug is gone, so which one fixed it is unknown.** The
scroll lock is the better bet — the displacement matches its mechanism exactly — but do
not "clean up" either change on the assumption that the other was the real fix.

A knock-on the next person will otherwise rediscover: removing the body pinning exposed a
scroll jump it had been hiding. `showModal()` auto-focuses the dialog's first focusable
child, and focusing scrolls it into view; with the panel fixed at the top of the viewport
that means scrolling the document to 0. A pinned body could not be scrolled by anything,
so the old code got this for free. `restoreScroll()` now does it explicitly.

**Two process lessons, which are the transferable part:**

- **Read the symptom off the DOM before theorising.** The single most useful minute in
  seven commits was checking which element those three buttons belonged to. Everything
  before that was fixing a bug that was not happening.
- **WebKit cannot be run on this machine.** Playwright's WebKit is downloaded and cached,
  but will not launch — it needs ~35 system libraries and `npx playwright install-deps
  webkit` needs root, which this environment does not have. Chromium at iPhone viewport
  renders the sheet perfectly *both before and after* the fix, so it cannot reproduce any
  of this. Do not mistake a green Chromium run for a verified iOS fix, and say so plainly
  when reporting. `public/diag.html` exists for this: it is a standalone page that
  **reports measured numbers** (viewport, visualViewport, scrollY, dialog and panel boxes,
  plus a verdict line) and pits a plain fixed div against both the old absolute-panel and
  new fixed-panel structures, so one screenshot from her phone can settle a layout
  question that is otherwise pure speculation.

---

## Bulk import — reopened

Previously deprioritised on the reasoning that ~50 polishes entered by hand once was
safer than debugging a fragile CSV mapping. **The owner has since asked for it directly,
so it is live work again.** Two things from the old note still hold and should shape
whatever gets built:

- **`importCollectionCsv` exists but its column aliases are guesses.** Nobody has seen her
  actual spreadsheet. Do not treat that mapping as a foundation without checking it
  against the real file.
- **It must be one commit, not one per row.** `Repository.replaceAll` is the batch path
  and JSON restore already uses it; build a merged `Snapshot` and call `replaceAll` once,
  the same way `store.tsx`'s `importBackup` does. Calling `addPolish` in a loop regresses
  into the write-amplification problem the batch path was built to avoid.

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
- **`input[type="date"]` has an intrinsic width in WebKit** derived from the locale's
  date format, and treats it as a floor — `width: 100%` will not shrink it. On a phone it
  overflowed the sheet, and because `.sheet__body` scrolls (an `overflow-y: auto` box
  computes `overflow-x` to `auto` too) that one field made the **whole form horizontally
  scrollable**, which made every *other* field look misaligned. One overflowing child can
  present as "the whole screen is subtly janky"; check `scrollWidth > clientWidth` on the
  container before believing a report about alignment. Fixed with `appearance: none`,
  `min-width: 0`, and a `::-webkit-date-and-time-value` reset for WebKit's centred value.
- **Playwright's `.click()` scrolls the target into view first.** A test that scrolls the
  page, then clicks a button near the top, has silently undone its own scroll before the
  assertion runs. This cost a real detour chasing a scroll-restoration "regression" that
  did not exist. Click something already inside the viewport when scroll position is part
  of what is under test.

**Test in a browser, not just in vitest.** Most of the bugs above were invisible to unit
tests and obvious within seconds of driving the real app. Playwright is not a dependency —
install it temporarily, then remove it and restore `package-lock.json`.

**And test on the real device where the real device is the subject.** The iOS sheet bug
survived six fixes and a full redesign precisely because everything above was green the
whole time. Chromium's iPhone emulation is a layout check, not a browser-engine check.

---

## Commands

```bash
npm run dev          # seeded in-memory data, no backend needed
npm test             # 296 tests
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

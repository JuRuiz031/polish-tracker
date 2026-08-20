# Shelved workflows

**These do not run.** GitHub only executes workflows in `.github/workflows/`, and these
live here deliberately. They are kept, rather than deleted, because they are part of the
Supabase migration path — not because anything currently needs them.

| File | What it did |
|---|---|
| `heartbeat.yml` | One query a day, to stop Supabase pausing a free project after 7 days idle |
| `backup.yml` | Nightly dump of every row to a private repo, via `../scripts/backup.py` |

## Why they were retired

The app stores its data in a private GitHub repository now, and both of these existed
only to paper over problems that storage model does not have:

- **Nothing pauses**, so there is nothing to keep awake.
- **The commit history is the backup**, so there is nothing to dump nightly. Every save is
  already a restorable point, which is strictly better than one snapshot a day.

They were also a liability in their own right. Both were `schedule:`-triggered in a public
repository, and GitHub disables scheduled workflows after 60 days without repository
activity — so roughly two months after the last commit, the heartbeat and the backup would
have stopped **together**, silently. Two safety nets sharing one point of failure is worse
than one safety net, because it reads as redundancy and is not.

## Reactivating them

Only relevant if this ever moves back to Supabase (see the multi-user note in the root
README). Then:

1. Move both files to `.github/workflows/`.
2. Move `../scripts/backup.py` back to `scripts/backup.py`, or fix the path in
   `backup.yml`.
3. Add the repository secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_REPO`, `BACKUP_TOKEN`.
4. **Put them in a private repository**, or accept that the 60-day rule will disable them.
   That, or drive the heartbeat from something with no inactivity expiry.

`backup.py` has never been run against a live Supabase project. Prove it produces a
genuinely restorable file before trusting it with anything.

import { daysBetween, today as todayIso } from './date';
import type { IsoDate, Polish, PolishStats, PolishWithStats, Wear } from './types';

/**
 * Derived collection stats — the port of the spreadsheet's calculated columns.
 *
 * All of it is computed from wear rows at read time and never stored, for two reasons:
 * it cannot drift out of sync with the log, and it works with no network. The whole
 * dataset for a 300-bottle collection is well under 100KB, so recomputing is free.
 *
 * Soft-deleted wear rows are excluded everywhere. Undoing a delete restores the
 * numbers automatically because nothing was ever written down.
 */

/** Group wear rows by polish_id, dropping soft-deleted ones. */
export function groupWearsByPolish(wears: readonly Wear[]): Map<string, Wear[]> {
  const byPolish = new Map<string, Wear[]>();
  for (const wear of wears) {
    if (wear.deleted_at !== null) continue;
    const existing = byPolish.get(wear.polish_id);
    if (existing) existing.push(wear);
    else byPolish.set(wear.polish_id, [wear]);
  }
  return byPolish;
}

/**
 * Stats for a single polish from its own wear rows.
 * `wears` is assumed to be already filtered to that polish.
 */
export function statsFor(
  wears: readonly Wear[],
  today: IsoDate = todayIso(),
): PolishStats {
  const live = wears.filter((w) => w.deleted_at === null);

  if (live.length === 0) {
    // Never worn. Deliberately distinct from "worn a long time ago" — the picker
    // always admits these, and the UI gives them their own mint treatment.
    return { times_worn: 0, last_worn: null, days_since: null, avg_rating: null };
  }

  let lastWorn = live[0].worn_on;
  let ratingSum = 0;
  let ratingCount = 0;

  for (const wear of live) {
    if (wear.worn_on > lastWorn) lastWorn = wear.worn_on; // ISO dates sort lexically
    if (wear.rating !== null) {
      ratingSum += wear.rating;
      ratingCount += 1;
    }
  }

  return {
    times_worn: live.length,
    last_worn: lastWorn,
    days_since: daysBetween(lastWorn, today),
    // Rounded to one decimal, matching the spreadsheet. A polish with wears but no
    // ratings gets null, not 0 — "unrated" and "rated zero" are different facts.
    avg_rating: ratingCount === 0 ? null : Math.round((ratingSum / ratingCount) * 10) / 10,
  };
}

/** Attach stats to every polish in one pass. This is what the collection view renders. */
export function withStats(
  polishes: readonly Polish[],
  wears: readonly Wear[],
  today: IsoDate = todayIso(),
): PolishWithStats[] {
  const byPolish = groupWearsByPolish(wears);
  return polishes.map((polish) => ({
    ...polish,
    stats: statsFor(byPolish.get(polish.id) ?? [], today),
  }));
}

/** Aggregate numbers for the Log screen's stats block. */
export interface CollectionSummary {
  total_polishes: number;
  /** Of `total_polishes` — archived bottles are counted in the total, not hidden. */
  archived: number;
  never_worn: number;
  worn_at_least_once: number;
  manicures_logged: number;
  avg_rating: number | null;
  most_recent_manicure: IsoDate | null;
}

/**
 * `total_polishes` here and the Collection screen's row count can legitimately differ:
 * this counts every live polish, archived ones included, because "how many bottles do I
 * own" and "how many can I currently pick from" are different questions and the
 * Collection view already hides archived bottles by default. Exposing `archived`
 * separately is what lets the Log screen say "26 (1 archived)" instead of a bare number
 * that looks like it disagrees with what she sees one tab over — see
 * docs/pre-persistence-audit.md, "How many polishes do I have".
 *
 * `manicures_logged` and `avg_rating` include wears whose polish has since been deleted
 * — deliberately. The Log still lists those rows as "Deleted polish" (see LogScreen), so
 * a summary that quietly dropped them would disagree with the list right below it on the
 * same screen. This is a different population from `mostWorn`/`bestRated` on the Stats
 * screen, which can only ever show currently-known polishes — that split is inherent to
 * a per-polish breakdown, not a bug to fix here.
 */
export function summarise(
  polishes: readonly PolishWithStats[],
  wears: readonly Wear[],
): CollectionSummary {
  const live = polishes.filter((p) => p.deleted_at === null);
  const liveWears = wears.filter((w) => w.deleted_at === null);

  const rated = liveWears.filter((w) => w.rating !== null);
  const ratingSum = rated.reduce((sum, w) => sum + (w.rating ?? 0), 0);

  let mostRecent: IsoDate | null = null;
  for (const wear of liveWears) {
    if (mostRecent === null || wear.worn_on > mostRecent) mostRecent = wear.worn_on;
  }

  const neverWorn = live.filter((p) => p.stats.times_worn === 0).length;

  return {
    total_polishes: live.length,
    archived: live.filter((p) => p.archived).length,
    never_worn: neverWorn,
    worn_at_least_once: live.length - neverWorn,
    manicures_logged: liveWears.length,
    avg_rating: rated.length === 0 ? null : Math.round((ratingSum / rated.length) * 10) / 10,
    most_recent_manicure: mostRecent,
  };
}

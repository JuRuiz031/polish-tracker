import { parseIsoDate, toIsoDate } from './date';
import type { PolishWithStats, Wear } from './types';

/**
 * Aggregations for the Stats screen.
 *
 * Pure functions over rows, in domain/ with everything else that decides something.
 * The charts are a rendering of these numbers and contain no arithmetic of their own —
 * which is what makes the figures testable without a browser, and what stops a chart
 * and a stat tile on the same screen disagreeing about the same fact.
 *
 * Archived polishes are counted everywhere except the picker-facing views: she still
 * owned and wore them, and dropping them would silently rewrite her history.
 */

export interface Tally {
  label: string;
  count: number;
  /** Hex for the mark, where the category IS a color. Null means "use the chart hue". */
  color?: string | null;
}

/** Count rows by a key, sorted most-first, ties broken alphabetically for stability. */
function tally<T>(rows: readonly T[], key: (row: T) => string): Tally[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function countByColor(polishes: readonly PolishWithStats[]): Tally[] {
  return tally(polishes, (polish) => polish.color);
}

export function countByBrand(polishes: readonly PolishWithStats[]): Tally[] {
  // Brands are typed by hand and drift in case ("essie" vs "Essie"). Group
  // case-insensitively but display the most common spelling rather than lowercasing
  // everything, which would look like a bug.
  const groups = new Map<string, { display: Map<string, number>; count: number }>();
  for (const polish of polishes) {
    const key = polish.brand.trim().toLowerCase();
    const group = groups.get(key) ?? { display: new Map(), count: 0 };
    group.count += 1;
    group.display.set(polish.brand, (group.display.get(polish.brand) ?? 0) + 1);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      let label = '';
      let best = -1;
      for (const [spelling, uses] of group.display) {
        if (uses > best) {
          best = uses;
          label = spelling;
        }
      }
      return { label, count: group.count };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function countByFinish(polishes: readonly PolishWithStats[]): Tally[] {
  return tally(polishes, (polish) => polish.finish);
}

/**
 * Reduce a ranking to at most `limit` entries, folding the tail into one "Other".
 *
 * `limit` is the maximum number of entries in the RESULT, including "Other" — not the
 * number kept before it. The distinction matters: the caller's cap is a hard ceiling on
 * how many segments a donut may draw, and returning limit + 1 would quietly break it.
 *
 * Past about six slices the segments are too thin to compare and the colors stop being
 * distinguishable. Folding is always honest — the remainder is shown, never dropped.
 */
export function foldToTop(entries: readonly Tally[], limit: number): Tally[] {
  if (limit <= 0) return [];
  if (entries.length <= limit) return [...entries];

  // One slot is spent on "Other", so only limit - 1 named entries survive.
  const kept = entries.slice(0, limit - 1);
  const rest = entries.slice(limit - 1);
  const remainder = rest.reduce((sum, entry) => sum + entry.count, 0);
  if (remainder === 0) return kept;

  return [...kept, { label: `Other (${rest.length})`, count: remainder, color: null }];
}

export interface MonthCount {
  /** `YYYY-MM`. */
  month: string;
  count: number;
}

/**
 * Wear counts for the last `months` calendar months, oldest first, including the
 * months with nothing in them.
 *
 * The empty months are the point: a gap in the log is information ("I did not paint my
 * nails in February"), and a chart that silently omits them turns an irregular history
 * into a smooth, false one.
 */
export function wearsByMonth(
  wears: readonly Wear[],
  months = 12,
  today: Date = new Date(),
): MonthCount[] {
  const counts = new Map<string, number>();

  // Seed every bucket first so gaps survive into the output.
  const cursor = new Date(today.getFullYear(), today.getMonth(), 1);
  const keys: string[] = [];
  for (let index = months - 1; index >= 0; index -= 1) {
    const month = new Date(cursor.getFullYear(), cursor.getMonth() - index, 1);
    const key = toIsoDate(month).slice(0, 7);
    keys.push(key);
    counts.set(key, 0);
  }

  for (const wear of wears) {
    if (wear.deleted_at !== null) continue;
    const key = wear.worn_on.slice(0, 7);
    // Only count what falls inside the window; older wears are not "month zero".
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return keys.map((month) => ({ month, count: counts.get(month) ?? 0 }));
}

/** Most-worn polishes, ties broken alphabetically. Never-worn are excluded. */
export function mostWorn(
  polishes: readonly PolishWithStats[],
  limit = 6,
): PolishWithStats[] {
  return polishes
    .filter((polish) => polish.stats.times_worn > 0)
    .sort(
      (a, b) =>
        b.stats.times_worn - a.stats.times_worn ||
        `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`),
    )
    .slice(0, limit);
}

/**
 * Best-rated polishes.
 *
 * `minWears` exists so a single lucky 5★ does not outrank a polish rated 4.8 across
 * ten manicures. With one wear there is no evidence of anything.
 */
export function bestRated(
  polishes: readonly PolishWithStats[],
  limit = 6,
  minWears = 2,
): PolishWithStats[] {
  return polishes
    .filter(
      (polish) => polish.stats.avg_rating !== null && polish.stats.times_worn >= minWears,
    )
    .sort((a, b) => (b.stats.avg_rating ?? 0) - (a.stats.avg_rating ?? 0))
    .slice(0, limit);
}

export interface Highlights {
  favouriteBrand: Tally | null;
  mostWornPolish: PolishWithStats | null;
  neverWornCount: number;
  /** Share of the collection that has never been worn, 0–100, rounded. */
  neverWornPercent: number;
  /** Mean days between the wears we have, null with fewer than two. */
  averageGapDays: number | null;
  longestStreakMonths: number;
}

export function highlights(
  polishes: readonly PolishWithStats[],
  wears: readonly Wear[],
): Highlights {
  const brands = countByBrand(polishes);
  const worn = mostWorn(polishes, 1);
  const neverWorn = polishes.filter((polish) => polish.stats.times_worn === 0).length;

  return {
    favouriteBrand: brands[0] ?? null,
    mostWornPolish: worn[0] ?? null,
    neverWornCount: neverWorn,
    neverWornPercent:
      polishes.length === 0 ? 0 : Math.round((neverWorn / polishes.length) * 100),
    averageGapDays: averageGap(wears),
    longestStreakMonths: longestStreak(wears),
  };
}

/** Mean whole days between consecutive manicures. */
function averageGap(wears: readonly Wear[]): number | null {
  const dates = wears
    .filter((wear) => wear.deleted_at === null)
    .map((wear) => parseIsoDate(wear.worn_on))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length < 2) return null;

  const span = dates[dates.length - 1].getTime() - dates[0].getTime();
  return Math.round(span / 86_400_000 / (dates.length - 1));
}

/** Longest run of consecutive calendar months with at least one manicure logged. */
function longestStreak(wears: readonly Wear[]): number {
  const months = new Set(
    wears.filter((wear) => wear.deleted_at === null).map((wear) => wear.worn_on.slice(0, 7)),
  );
  if (months.size === 0) return 0;

  const sorted = [...months].sort();
  let best = 1;
  let run = 1;

  for (let index = 1; index < sorted.length; index += 1) {
    best = Math.max(best, run = isNextMonth(sorted[index - 1], sorted[index]) ? run + 1 : 1);
  }
  return best;
}

/** Is `b` the calendar month immediately after `a`? Both are `YYYY-MM`. */
function isNextMonth(a: string, b: string): boolean {
  const [aYear, aMonth] = a.split('-').map(Number);
  const [bYear, bMonth] = b.split('-').map(Number);
  // Compare in absolute months so a December→January rollover is not a special case.
  return bYear * 12 + bMonth === aYear * 12 + aMonth + 1;
}

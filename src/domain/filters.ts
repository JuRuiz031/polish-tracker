import { ANY, type Any, type Color, type Finish } from './enums';
import type { Polish, PolishWithStats, Wear } from './types';
import { countByBrand } from './stats';

/**
 * Filtering, as pure functions.
 *
 * These live here rather than inside the screens for the same reason the picker does:
 * they are rules, they are worth testing, and three different screens need the same
 * answers. The screens keep the filter state and render the controls; deciding what
 * survives a filter happens here.
 */

export { ANY, type Any };

/**
 * Every brand in the collection, alphabetical, deduplicated case-insensitively.
 *
 * Drawn from the data rather than from a fixed list, because the set of brands she owns
 * is not knowable in advance — and a dropdown offering brands she does not own would be
 * worse than typing. Reuses countByBrand so "essie" and "Essie" collapse to one entry
 * spelled the way she most often writes it.
 */
export function brandNames(polishes: readonly Polish[]): string[] {
  return countByBrand(polishes as readonly PolishWithStats[])
    .map((entry) => entry.label)
    .sort((a, b) => a.localeCompare(b));
}

// ---- Collection ----------------------------------------------------------------

export interface CollectionFilter {
  color: Color | Any;
  finish: Finish | Any;
  brand: string | Any;
  /** Minimum average rating, 1–5. 0 means no constraint. */
  minRating: number;
  showArchived: boolean;
}

export const DEFAULT_COLLECTION_FILTER: CollectionFilter = {
  color: ANY,
  finish: ANY,
  brand: ANY,
  minRating: 0,
  showArchived: false,
};

/** How many constraints are actually narrowing anything — drives the "Filter · 2" chip. */
export function activeFilterCount(filter: CollectionFilter): number {
  return (
    (filter.color !== ANY ? 1 : 0) +
    (filter.finish !== ANY ? 1 : 0) +
    (filter.brand !== ANY ? 1 : 0) +
    (filter.minRating > 0 ? 1 : 0) +
    (filter.showArchived ? 1 : 0)
  );
}

export function filterPolishes(
  polishes: readonly PolishWithStats[],
  filter: CollectionFilter,
  query = '',
): PolishWithStats[] {
  const needle = query.trim().toLowerCase();

  return polishes.filter((polish) => {
    if (!filter.showArchived && polish.archived) return false;
    if (filter.color !== ANY && polish.color !== filter.color) return false;
    if (filter.finish !== ANY && polish.finish !== filter.finish) return false;

    // Case-insensitive so the brand dropdown still matches a row typed as "essie".
    if (filter.brand !== ANY && polish.brand.trim().toLowerCase() !== filter.brand.trim().toLowerCase()) {
      return false;
    }

    if (filter.minRating > 0) {
      // An unrated polish is EXCLUDED by a rating filter rather than treated as zero.
      // "Show me the 4-star ones" is a question about polishes she has judged; a bottle
      // she never rated has no answer, and guessing one would be a lie.
      if (polish.stats.avg_rating === null) return false;
      if (polish.stats.avg_rating < filter.minRating) return false;
    }

    if (needle === '') return true;
    return (
      polish.brand.toLowerCase().includes(needle) || polish.name.toLowerCase().includes(needle)
    );
  });
}

/**
 * Wear rows still logged whose polish has since been soft-deleted.
 *
 * Visible in the unfiltered log as "Deleted polish", but structurally unreachable the
 * moment a brand or color filter is chosen — there is no brand or color left to test
 * against (see `filterWears`). Used to explain that gap on screen rather than leaving it
 * silent: see docs/pre-persistence-audit.md, "Soft-deleting a polish orphans its wear
 * rows".
 */
export function orphanedWearCount(wears: readonly Wear[], polishes: readonly Polish[]): number {
  const known = new Set(polishes.map((polish) => polish.id));
  return wears.filter((wear) => wear.deleted_at === null && !known.has(wear.polish_id)).length;
}

// ---- Log -----------------------------------------------------------------------

export interface LogFilter {
  /** `YYYY-MM`, `YYYY`, or ANY. */
  period: string;
  brand: string | Any;
  color: Color | Any;
}

export const DEFAULT_LOG_FILTER: LogFilter = { period: ANY, brand: ANY, color: ANY };

export function activeLogFilterCount(filter: LogFilter): number {
  return (
    (filter.period !== ANY ? 1 : 0) +
    (filter.brand !== ANY ? 1 : 0) +
    (filter.color !== ANY ? 1 : 0)
  );
}

export interface Period {
  /** `YYYY` for a year, `YYYY-MM` for a month. */
  value: string;
  label: string;
  isYear: boolean;
}

/**
 * The years and months that actually contain a manicure, newest first.
 *
 * Offered rather than a free date range because a period with nothing in it is a dead
 * end — picking it can only ever produce an empty screen. Years come first with their
 * months nested beneath, so a long history stays navigable.
 */
export function availablePeriods(wears: readonly Wear[]): Period[] {
  const months = new Set<string>();
  for (const wear of wears) {
    if (wear.deleted_at !== null) continue;
    months.add(wear.worn_on.slice(0, 7));
  }

  const byYear = new Map<string, string[]>();
  for (const month of months) {
    const year = month.slice(0, 4);
    const list = byYear.get(year) ?? [];
    list.push(month);
    byYear.set(year, list);
  }

  const periods: Period[] = [];
  for (const year of [...byYear.keys()].sort().reverse()) {
    periods.push({ value: year, label: year, isYear: true });
    for (const month of (byYear.get(year) ?? []).sort().reverse()) {
      periods.push({ value: month, label: `  ${monthName(month)}`, isYear: false });
    }
  }
  return periods;
}

function monthName(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long' });
}

/**
 * Wears surviving a log filter.
 *
 * Brand and color are properties of the POLISH, not of the wear, so this needs the
 * collection to resolve them. A wear whose polish has been hard-deleted keeps showing
 * under no filter but drops out of a brand or color filter — there is no honest answer
 * to "was it an OPI?" once the row is gone.
 */
export function filterWears(
  wears: readonly Wear[],
  polishes: readonly Polish[],
  filter: LogFilter,
): Wear[] {
  const byId = new Map(polishes.map((polish) => [polish.id, polish]));

  return wears.filter((wear) => {
    if (wear.deleted_at !== null) return false;

    // A YYYY period matches every month in that year; YYYY-MM matches exactly. Prefix
    // matching handles both without branching on the length.
    if (filter.period !== ANY && !wear.worn_on.startsWith(filter.period)) return false;

    if (filter.brand === ANY && filter.color === ANY) return true;

    const polish = byId.get(wear.polish_id);
    if (!polish) return false;

    if (
      filter.brand !== ANY &&
      polish.brand.trim().toLowerCase() !== filter.brand.trim().toLowerCase()
    ) {
      return false;
    }
    if (filter.color !== ANY && polish.color !== filter.color) return false;

    return true;
  });
}

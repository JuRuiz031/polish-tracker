import { ANY, DEFAULT_REST_DAYS, type Any, type Color, type Finish } from './enums';
import { daysBetween, today as todayIso } from './date';
import type { IsoDate, PolishWithStats } from './types';

export { ANY, type Any };

/**
 * The picker — "what should I wear tonight?"
 *
 * Port of the spreadsheet's Pick a Polish tab, with its one real flaw fixed. In Sheets
 * the pick is built on a volatile RANDOM, so it re-rolls on every edit and vanishes the
 * moment she logs the manicure. Here `pick()` is a pure function of an explicit rng:
 * the caller holds the result in state and it changes only when she asks it to. That
 * stability is what makes "spin → wear this" a usable loop instead of a race.
 */

export interface PickerFilters {
  /** Minimum days since last worn. Never-worn polishes bypass this entirely. */
  restDays: number;
  finish: Finish | Any;
  color: Color | Any;
  /** Case-insensitive substring match on brand. Empty string means no constraint. */
  brandQuery: string;
}

export const DEFAULT_FILTERS: PickerFilters = {
  restDays: DEFAULT_REST_DAYS,
  finish: ANY,
  color: ANY,
  brandQuery: '',
};

/**
 * The individual predicates are exported separately so that `diagnose()` can ask
 * "which one of you is responsible for the empty result?" without duplicating logic.
 */

/** Available at all: not deleted, not archived (used up or given away). */
export function isAvailable(polish: PolishWithStats): boolean {
  return polish.deleted_at === null && !polish.archived;
}

/**
 * Rested long enough. A never-worn polish always passes regardless of restDays —
 * surfacing those is the entire reason the picker exists.
 *
 * This recomputes from `last_worn` against the supplied `today` rather than trusting
 * the precomputed `stats.days_since`. Those stats are derived once when the data is
 * loaded, so if she leaves the app open across midnight they are a day stale — and a
 * stale day at exactly the rest-days boundary silently drops a polish from the pool.
 */
export function isRested(polish: PolishWithStats, restDays: number, today: IsoDate): boolean {
  if (polish.stats.last_worn === null) return true;
  const daysSince = daysBetween(polish.stats.last_worn, today);
  if (daysSince === null) return true;
  return daysSince >= restDays;
}

export function matchesFinish(polish: PolishWithStats, finish: Finish | Any): boolean {
  return finish === ANY || polish.finish === finish;
}

export function matchesColor(polish: PolishWithStats, color: Color | Any): boolean {
  return color === ANY || polish.color === color;
}

export function matchesBrand(polish: PolishWithStats, brandQuery: string): boolean {
  const query = brandQuery.trim().toLowerCase();
  if (query === '') return true;
  return polish.brand.toLowerCase().includes(query);
}

/** The full eligibility rule, exactly as specified in the brief. */
export function eligible(
  polish: PolishWithStats,
  filters: PickerFilters,
  today: IsoDate = todayIso(),
): boolean {
  return (
    isAvailable(polish) &&
    isRested(polish, filters.restDays, today) &&
    matchesFinish(polish, filters.finish) &&
    matchesColor(polish, filters.color) &&
    matchesBrand(polish, filters.brandQuery)
  );
}

export function eligiblePolishes(
  polishes: readonly PolishWithStats[],
  filters: PickerFilters,
  today: IsoDate = todayIso(),
): PolishWithStats[] {
  return polishes.filter((polish) => eligible(polish, filters, today));
}

/**
 * Uniform random choice.
 *
 * `rng` is injected rather than reaching for Math.random directly so the tests can
 * prove uniformity and boundary behaviour deterministically. Returns null rather
 * than throwing on an empty pool — the empty state is a real, expected screen here,
 * not an error.
 */
export function pick<T>(pool: readonly T[], rng: () => number = Math.random): T | null {
  if (pool.length === 0) return null;
  const index = Math.floor(rng() * pool.length);
  // Guard against an rng that returns exactly 1, which would index off the end.
  return pool[Math.min(index, pool.length - 1)];
}

/**
 * Empty-state diagnosis.
 *
 * The brief is explicit that "No results" is not good enough — it should say which
 * filter is responsible and offer to relax it. We do that by relaxing each filter on
 * its own and counting what that would unlock. The filter that frees the most is the
 * one worth pointing at.
 */
export type FilterName = 'restDays' | 'finish' | 'color' | 'brandQuery';

export interface RelaxationOption {
  filter: FilterName;
  /** How many polishes become eligible if this one filter is dropped. */
  unlocks: number;
}

export interface Diagnosis {
  eligibleCount: number;
  /** Non-empty only when eligibleCount is 0. Sorted most-unlocking first. */
  suggestions: RelaxationOption[];
  /**
   * True when nothing is available at all — an empty or fully archived collection.
   * No amount of filter-relaxing helps, so the UI should say something different.
   */
  collectionEmpty: boolean;
}

export function diagnose(
  polishes: readonly PolishWithStats[],
  filters: PickerFilters,
  today: IsoDate = todayIso(),
): Diagnosis {
  const available = polishes.filter(isAvailable);
  const eligibleCount = eligiblePolishes(polishes, filters, today).length;

  if (eligibleCount > 0 || available.length === 0) {
    return {
      eligibleCount,
      suggestions: [],
      collectionEmpty: available.length === 0,
    };
  }

  const relaxations: Array<{ filter: FilterName; relaxed: PickerFilters }> = [
    { filter: 'restDays', relaxed: { ...filters, restDays: 0 } },
    { filter: 'finish', relaxed: { ...filters, finish: ANY } },
    { filter: 'color', relaxed: { ...filters, color: ANY } },
    { filter: 'brandQuery', relaxed: { ...filters, brandQuery: '' } },
  ];

  const suggestions = relaxations
    .map(({ filter, relaxed }) => ({
      filter,
      unlocks: eligiblePolishes(polishes, relaxed, today).length,
    }))
    // Only suggest a filter that actually changes something.
    .filter((option) => option.unlocks > 0)
    .sort((a, b) => b.unlocks - a.unlocks);

  return { eligibleCount: 0, suggestions, collectionEmpty: false };
}

/**
 * "Untouched" — the gentle view of what has been sitting longest, which is the
 * problem the picker exists to solve. Never-worn sort first, then longest-rested.
 */
export function untouched(
  polishes: readonly PolishWithStats[],
  limit = 10,
): PolishWithStats[] {
  return polishes
    .filter(isAvailable)
    .sort((a, b) => {
      const aDays = a.stats.days_since;
      const bDays = b.stats.days_since;
      if (aDays === null && bDays === null) return a.brand.localeCompare(b.brand);
      if (aDays === null) return -1;
      if (bDays === null) return 1;
      return bDays - aDays;
    })
    .slice(0, limit);
}

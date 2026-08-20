import { daysBetween, parseIsoDate, today as isoToday } from '../domain/date';

/**
 * Human-readable formatting shared across screens.
 *
 * Kept out of domain/ deliberately: these produce English prose for a UI, not facts.
 * The domain layer deals in numbers and ISO dates and stays free of presentation.
 */

/**
 * "3 days ago" rather than a bare count.
 *
 * Precision degrades on purpose as the gap grows — "about 4 months ago" is what she
 * actually wants to know at that distance, and an exact 127 is noise. Anything under a
 * week keeps its exact number, because that is the range the rest filter turns on.
 */
export function describeDays(days: number | null): string {
  if (days === null) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  const months = Math.round(days / 30);
  if (months < 12) return `about ${months} ${months === 1 ? 'month' : 'months'} ago`;

  const years = Math.round(days / 365);
  return `about ${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/**
 * A wear date: relative while that is the more useful fact, absolute once it is not.
 * "Today" and "Yesterday" are what she thinks in; "Sat, 14 Mar" is what she needs once
 * the entry is old enough that counting days stops meaning anything.
 */
export function formatWearDate(iso: string, todayIso: string = isoToday()): string {
  const diff = daysBetween(iso, todayIso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff !== null && diff < 7) return `${diff} days ago`;

  const parsed = parseIsoDate(iso);
  if (!parsed) return iso;

  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    // Drop the year only when it is the current one; an undated old entry is confusing.
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

/** Month heading for grouped lists, from a `YYYY-MM` key. */
export function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

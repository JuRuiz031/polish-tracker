import type { IsoDate } from './types';

/**
 * Calendar-date arithmetic, done in LOCAL time on purpose.
 *
 * The trap this module exists to avoid: `new Date('2026-01-01')` is parsed by spec as
 * UTC midnight, not local midnight. For anyone west of Greenwich that instant is still
 * 2025-12-31 locally, so `.getDate()` returns the wrong day and every "days since"
 * number in the app is off by one. Anabel logs a manicure on the day she does her
 * nails; "worn_on" is a wall-calendar fact with no time and no zone attached, so all
 * of it is computed against local midnight.
 *
 * Every function here is pure and takes `today` as a parameter so tests can pin it.
 */

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` to local midnight. Returns null on anything malformed. */
export function parseIsoDate(iso: IsoDate): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Local midnight, explicitly — not Date.parse.
  const date = new Date(year, month - 1, day);

  // Rejects overflow like 2026-02-31, which the Date constructor would silently roll
  // forward to March 3 rather than treating as invalid.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Format a Date as `YYYY-MM-DD` using its LOCAL components. */
export function toIsoDate(date: Date): IsoDate {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today as `YYYY-MM-DD`, local. This is what "I wore this" stamps onto a wear row. */
export function today(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

/**
 * Whole calendar days between two dates, `to - from`. Negative if `to` precedes `from`.
 *
 * Normalising both ends to local midnight before subtracting is what makes this
 * survive a daylight-saving boundary: the raw millisecond gap across a DST change is
 * 23 or 25 hours, which plain division would round to the wrong day.
 */
export function daysBetween(from: IsoDate, to: IsoDate): number | null {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return null;

  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / MS_PER_DAY);
}

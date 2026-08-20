import { describe, expect, it } from 'vitest';
import { daysBetween, parseIsoDate, toIsoDate, today } from '../date';

describe('parseIsoDate', () => {
  it('parses to LOCAL midnight, not UTC midnight', () => {
    const parsed = parseIsoDate('2026-03-15')!;
    // The bug this guards: `new Date('2026-03-15')` is UTC midnight, which in any
    // negative-offset zone reports as the 14th locally.
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(15);
    expect(parsed.getHours()).toBe(0);
  });

  it('rejects malformed input', () => {
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate('2026-3-15')).toBeNull();
    expect(parseIsoDate('15/03/2026')).toBeNull();
    expect(parseIsoDate('not a date')).toBeNull();
  });

  it('rejects overflow dates rather than silently rolling them forward', () => {
    // `new Date(2026, 1, 31)` quietly becomes March 3rd. That must not pass.
    expect(parseIsoDate('2026-02-31')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('2026-00-10')).toBeNull();
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(parseIsoDate('2024-02-29')).not.toBeNull();
    expect(parseIsoDate('2026-02-29')).toBeNull();
  });
});

describe('toIsoDate / today', () => {
  it('round-trips through parse', () => {
    expect(toIsoDate(parseIsoDate('2026-08-19')!)).toBe('2026-08-19');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('formats a supplied clock', () => {
    expect(today(new Date(2026, 7, 19, 23, 58))).toBe('2026-08-19');
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-08-01', '2026-08-15')).toBe(14);
    expect(daysBetween('2026-08-19', '2026-08-19')).toBe(0);
  });

  it('goes negative when the range runs backwards', () => {
    expect(daysBetween('2026-08-15', '2026-08-01')).toBe(-14);
  });

  it('crosses month and year boundaries', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('counts a leap day', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1);
  });

  it('stays exact across a daylight-saving transition', () => {
    // US DST springs forward 2026-03-08. The raw gap is 23 hours, which naive
    // division by 86_400_000 would floor to 0 days instead of 1.
    expect(daysBetween('2026-03-07', '2026-03-08')).toBe(1);
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    // And back again in November.
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
  });

  it('returns null on malformed endpoints', () => {
    expect(daysBetween('nope', '2026-08-19')).toBeNull();
    expect(daysBetween('2026-08-19', 'nope')).toBeNull();
  });
});

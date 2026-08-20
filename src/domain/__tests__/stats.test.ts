import { describe, expect, it } from 'vitest';
import { withStats } from '../derive';
import {
  bestRated,
  countByBrand,
  countByColor,
  countByFinish,
  foldToTop,
  highlights,
  mostWorn,
  wearsByMonth,
} from '../stats';
import { makePolish, makeWear } from './factories';

/** Attach stats with a pinned "today" so nothing here depends on the wall clock. */
const TODAY = '2026-08-20';
const withPinnedStats = (polishes: Parameters<typeof withStats>[0], wears: Parameters<typeof withStats>[1] = []) =>
  withStats(polishes, wears, TODAY);

describe('countByColor', () => {
  it('counts and sorts most-first', () => {
    const polishes = withPinnedStats([
      makePolish({ color: 'Red' }),
      makePolish({ color: 'Red' }),
      makePolish({ color: 'Blue' }),
    ]);

    expect(countByColor(polishes)).toEqual([
      { label: 'Red', count: 2 },
      { label: 'Blue', count: 1 },
    ]);
  });

  it('breaks ties alphabetically so the order is stable between renders', () => {
    const polishes = withPinnedStats([
      makePolish({ color: 'Violet' }),
      makePolish({ color: 'Blue' }),
      makePolish({ color: 'Pink' }),
    ]);

    expect(countByColor(polishes).map((entry) => entry.label)).toEqual([
      'Blue',
      'Pink',
      'Violet',
    ]);
  });
});

describe('countByBrand', () => {
  it('groups brands that differ only in case', () => {
    const polishes = withPinnedStats([
      makePolish({ brand: 'Essie', name: 'A' }),
      makePolish({ brand: 'essie', name: 'B' }),
      makePolish({ brand: 'ESSIE', name: 'C' }),
    ]);

    const result = countByBrand(polishes);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
  });

  it('displays the most common spelling rather than lowercasing', () => {
    const polishes = withPinnedStats([
      makePolish({ brand: 'Essie', name: 'A' }),
      makePolish({ brand: 'Essie', name: 'B' }),
      makePolish({ brand: 'essie', name: 'C' }),
    ]);

    expect(countByBrand(polishes)[0].label).toBe('Essie');
  });

  it('ignores surrounding whitespace when grouping', () => {
    const polishes = withPinnedStats([
      makePolish({ brand: 'OPI', name: 'A' }),
      makePolish({ brand: '  OPI  ', name: 'B' }),
    ]);

    expect(countByBrand(polishes)).toHaveLength(1);
  });
});

describe('countByFinish', () => {
  it('counts finishes', () => {
    const polishes = withPinnedStats([
      makePolish({ finish: 'Cream' }),
      makePolish({ finish: 'Glitter' }),
      makePolish({ finish: 'Cream' }),
    ]);

    expect(countByFinish(polishes)[0]).toEqual({ label: 'Cream', count: 2 });
  });
});

describe('foldToTop', () => {
  const entries = [
    { label: 'a', count: 10 },
    { label: 'b', count: 8 },
    { label: 'c', count: 5 },
    { label: 'd', count: 3 },
    { label: 'e', count: 1 },
  ];

  it('returns the list untouched when it already fits', () => {
    expect(foldToTop(entries, 5)).toEqual(entries);
    expect(foldToTop(entries, 9)).toEqual(entries);
  });

  it('never returns more entries than the limit, counting Other', () => {
    // The whole point of the cap: a donut told "at most 4" must not get 5 segments.
    for (const limit of [1, 2, 3, 4, 5]) {
      expect(foldToTop(entries, limit).length).toBeLessThanOrEqual(limit);
    }
  });

  it('folds the tail into one Other bucket that preserves the total', () => {
    const folded = foldToTop(entries, 3);

    expect(folded).toHaveLength(3);
    expect(folded.map((entry) => entry.label)).toEqual(['a', 'b', 'Other (3)']);
    expect(folded[2].count).toBe(9);

    const before = entries.reduce((sum, entry) => sum + entry.count, 0);
    const after = folded.reduce((sum, entry) => sum + entry.count, 0);
    // Folding must never lose anything — the donut has to still add up.
    expect(after).toBe(before);
  });

  it('does not append an Other bucket when the folded tail is all zeros', () => {
    // Entries arrive sorted desc, so zero-count categories sit at the tail. Folding
    // them must drop them silently rather than draw an "Other" slice worth nothing.
    const withZeros = [
      { label: 'a', count: 10 },
      { label: 'y', count: 0 },
      { label: 'z', count: 0 },
    ];

    expect(foldToTop(withZeros, 2)).toEqual([{ label: 'a', count: 10 }]);
  });

  it('returns nothing for a non-positive limit rather than a bare Other', () => {
    expect(foldToTop(entries, 0)).toEqual([]);
  });
});

describe('wearsByMonth', () => {
  const today = new Date(2026, 7, 20); // August 2026

  it('returns a bucket per month, oldest first', () => {
    const result = wearsByMonth([], 12, today);

    expect(result).toHaveLength(12);
    expect(result[0].month).toBe('2025-09');
    expect(result[11].month).toBe('2026-08');
  });

  it('keeps empty months rather than omitting them', () => {
    const result = wearsByMonth([makeWear({ worn_on: '2026-08-01' })], 3, today);

    expect(result).toEqual([
      { month: '2026-06', count: 0 },
      { month: '2026-07', count: 0 },
      { month: '2026-08', count: 1 },
    ]);
  });

  it('excludes soft-deleted wears', () => {
    const result = wearsByMonth(
      [
        makeWear({ worn_on: '2026-08-01' }),
        makeWear({ worn_on: '2026-08-02', deleted_at: '2026-08-03T00:00:00Z' }),
      ],
      1,
      today,
    );

    expect(result[0].count).toBe(1);
  });

  it('ignores wears older than the window instead of folding them into month zero', () => {
    const result = wearsByMonth([makeWear({ worn_on: '2020-01-01' })], 3, today);
    expect(result.every((month) => month.count === 0)).toBe(true);
  });

  it('handles a December to January rollover', () => {
    const result = wearsByMonth([], 3, new Date(2026, 0, 15));
    expect(result.map((entry) => entry.month)).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('mostWorn', () => {
  it('ranks by wear count and drops the never-worn', () => {
    const a = makePolish({ brand: 'A', name: 'a' });
    const b = makePolish({ brand: 'B', name: 'b' });
    const c = makePolish({ brand: 'C', name: 'c' });

    const polishes = withPinnedStats(
      [a, b, c],
      [
        makeWear({ polish_id: a.id, worn_on: '2026-08-01' }),
        makeWear({ polish_id: a.id, worn_on: '2026-08-05' }),
        makeWear({ polish_id: b.id, worn_on: '2026-08-02' }),
      ],
    );

    const result = mostWorn(polishes);
    expect(result.map((polish) => polish.id)).toEqual([a.id, b.id]);
    expect(result.some((polish) => polish.id === c.id)).toBe(false);
  });
});

describe('bestRated', () => {
  it('requires a minimum number of wears, so one lucky 5 does not win', () => {
    const lucky = makePolish({ brand: 'Lucky', name: 'once' });
    const proven = makePolish({ brand: 'Proven', name: 'often' });

    const polishes = withPinnedStats(
      [lucky, proven],
      [
        makeWear({ polish_id: lucky.id, worn_on: '2026-08-01', rating: 5 }),
        makeWear({ polish_id: proven.id, worn_on: '2026-08-01', rating: 4 }),
        makeWear({ polish_id: proven.id, worn_on: '2026-08-08', rating: 4 }),
      ],
    );

    const result = bestRated(polishes, 6, 2);
    expect(result.map((polish) => polish.id)).toEqual([proven.id]);
  });

  it('excludes polishes that were worn but never rated', () => {
    const unrated = makePolish();
    const polishes = withPinnedStats(
      [unrated],
      [
        makeWear({ polish_id: unrated.id, worn_on: '2026-08-01', rating: null }),
        makeWear({ polish_id: unrated.id, worn_on: '2026-08-08', rating: null }),
      ],
    );

    expect(bestRated(polishes)).toEqual([]);
  });
});

describe('highlights', () => {
  it('reports the never-worn share as a percentage', () => {
    const worn = makePolish({ brand: 'A', name: 'a' });
    const polishes = withPinnedStats(
      [worn, makePolish({ brand: 'B', name: 'b' }), makePolish({ brand: 'C', name: 'c' }), makePolish({ brand: 'D', name: 'd' })],
      [makeWear({ polish_id: worn.id, worn_on: '2026-08-01' })],
    );

    const result = highlights(polishes, []);
    expect(result.neverWornCount).toBe(3);
    expect(result.neverWornPercent).toBe(75);
  });

  it('averages the gap between manicures', () => {
    const wears = [
      makeWear({ worn_on: '2026-08-01' }),
      makeWear({ worn_on: '2026-08-11' }),
      makeWear({ worn_on: '2026-08-21' }),
    ];
    // 20 days spanned across 2 intervals.
    expect(highlights([], wears).averageGapDays).toBe(10);
  });

  it('has no average gap with fewer than two manicures', () => {
    expect(highlights([], [makeWear()]).averageGapDays).toBeNull();
    expect(highlights([], []).averageGapDays).toBeNull();
  });

  it('counts the longest run of consecutive months, including a year rollover', () => {
    const wears = [
      makeWear({ worn_on: '2025-11-04' }),
      makeWear({ worn_on: '2025-12-04' }),
      makeWear({ worn_on: '2026-01-04' }),
      // Gap in February breaks the streak.
      makeWear({ worn_on: '2026-03-04' }),
    ];

    expect(highlights([], wears).longestStreakMonths).toBe(3);
  });

  it('is safe on an empty collection', () => {
    const result = highlights([], []);
    expect(result.favouriteBrand).toBeNull();
    expect(result.mostWornPolish).toBeNull();
    expect(result.neverWornPercent).toBe(0);
    expect(result.longestStreakMonths).toBe(0);
  });
});

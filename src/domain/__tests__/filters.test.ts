import { describe, expect, it } from 'vitest';
import { withStats } from '../derive';
import {
  ANY,
  DEFAULT_COLLECTION_FILTER,
  DEFAULT_LOG_FILTER,
  activeFilterCount,
  activeLogFilterCount,
  availablePeriods,
  brandNames,
  filterPolishes,
  filterWears,
} from '../filters';
import { makePolish, makeWear } from './factories';

const TODAY = '2026-08-20';
const stat = (polishes: Parameters<typeof withStats>[0], wears: Parameters<typeof withStats>[1] = []) =>
  withStats(polishes, wears, TODAY);

describe('brandNames', () => {
  it('lists each brand once, alphabetically', () => {
    const names = brandNames([
      makePolish({ brand: 'Zoya', name: 'a' }),
      makePolish({ brand: 'Essie', name: 'b' }),
      makePolish({ brand: 'OPI', name: 'c' }),
    ]);
    expect(names).toEqual(['Essie', 'OPI', 'Zoya']);
  });

  it('collapses case variants into the most common spelling', () => {
    const names = brandNames([
      makePolish({ brand: 'Essie', name: 'a' }),
      makePolish({ brand: 'Essie', name: 'b' }),
      makePolish({ brand: 'essie', name: 'c' }),
    ]);
    expect(names).toEqual(['Essie']);
  });
});

describe('filterPolishes', () => {
  const red = makePolish({ brand: 'OPI', name: 'Red One', color: 'Red', finish: 'Cream' });
  const blue = makePolish({ brand: 'Zoya', name: 'Blue One', color: 'Blue', finish: 'Glitter' });
  const archived = makePolish({ brand: 'OPI', name: 'Gone', color: 'Red', archived: true });
  const all = [red, blue, archived];

  it('hides archived polishes unless asked for', () => {
    const visible = filterPolishes(stat(all), DEFAULT_COLLECTION_FILTER);
    expect(visible.map((p) => p.id)).not.toContain(archived.id);

    const withArchived = filterPolishes(stat(all), {
      ...DEFAULT_COLLECTION_FILTER,
      showArchived: true,
    });
    expect(withArchived.map((p) => p.id)).toContain(archived.id);
  });

  it('filters by color, finish, and brand', () => {
    const byColor = filterPolishes(stat(all), { ...DEFAULT_COLLECTION_FILTER, color: 'Blue' });
    expect(byColor.map((p) => p.id)).toEqual([blue.id]);

    const byFinish = filterPolishes(stat(all), { ...DEFAULT_COLLECTION_FILTER, finish: 'Glitter' });
    expect(byFinish.map((p) => p.id)).toEqual([blue.id]);

    const byBrand = filterPolishes(stat(all), { ...DEFAULT_COLLECTION_FILTER, brand: 'Zoya' });
    expect(byBrand.map((p) => p.id)).toEqual([blue.id]);
  });

  it('matches the brand filter regardless of how the row was capitalised', () => {
    const odd = makePolish({ brand: 'essie', name: 'x' });
    const result = filterPolishes(stat([odd]), { ...DEFAULT_COLLECTION_FILTER, brand: 'Essie' });
    expect(result).toHaveLength(1);
  });

  it('searches brand and name together', () => {
    expect(filterPolishes(stat(all), DEFAULT_COLLECTION_FILTER, 'zoy')).toHaveLength(1);
    expect(filterPolishes(stat(all), DEFAULT_COLLECTION_FILTER, 'red one')).toHaveLength(1);
    expect(filterPolishes(stat(all), DEFAULT_COLLECTION_FILTER, 'nothing')).toHaveLength(0);
  });

  describe('minRating', () => {
    const good = makePolish({ brand: 'A', name: 'good' });
    const poor = makePolish({ brand: 'B', name: 'poor' });
    const unrated = makePolish({ brand: 'C', name: 'unrated' });

    const rated = stat(
      [good, poor, unrated],
      [
        makeWear({ polish_id: good.id, worn_on: '2026-08-01', rating: 5 }),
        makeWear({ polish_id: poor.id, worn_on: '2026-08-01', rating: 2 }),
        makeWear({ polish_id: unrated.id, worn_on: '2026-08-01', rating: null }),
      ],
    );

    it('keeps only polishes at or above the threshold', () => {
      const result = filterPolishes(rated, { ...DEFAULT_COLLECTION_FILTER, minRating: 4 });
      expect(result.map((p) => p.id)).toEqual([good.id]);
    });

    it('EXCLUDES unrated polishes rather than treating them as zero', () => {
      // An unrated bottle has no answer to "is it 3 stars or better?", and defaulting it
      // to zero would quietly assert she disliked something she never judged.
      const result = filterPolishes(rated, { ...DEFAULT_COLLECTION_FILTER, minRating: 1 });
      expect(result.map((p) => p.id)).not.toContain(unrated.id);
    });

    it('includes everything when the threshold is zero', () => {
      const result = filterPolishes(rated, { ...DEFAULT_COLLECTION_FILTER, minRating: 0 });
      expect(result).toHaveLength(3);
    });
  });
});

describe('activeFilterCount', () => {
  it('is zero for the defaults', () => {
    expect(activeFilterCount(DEFAULT_COLLECTION_FILTER)).toBe(0);
  });

  it('counts each narrowing constraint once', () => {
    expect(
      activeFilterCount({
        color: 'Red',
        finish: 'Cream',
        brand: 'OPI',
        minRating: 4,
        showArchived: true,
      }),
    ).toBe(5);
  });
});

describe('availablePeriods', () => {
  it('offers only years and months that contain a manicure, newest first', () => {
    const periods = availablePeriods([
      makeWear({ worn_on: '2026-08-04' }),
      makeWear({ worn_on: '2026-06-04' }),
      makeWear({ worn_on: '2025-12-04' }),
    ]);

    expect(periods.map((p) => p.value)).toEqual([
      '2026',
      '2026-08',
      '2026-06',
      '2025',
      '2025-12',
    ]);
    // 2026-07 had nothing in it, so it is not offered — picking it could only ever
    // produce an empty screen.
    expect(periods.map((p) => p.value)).not.toContain('2026-07');
  });

  it('ignores soft-deleted wears', () => {
    const periods = availablePeriods([
      makeWear({ worn_on: '2026-08-04' }),
      makeWear({ worn_on: '2020-01-04', deleted_at: '2026-01-01T00:00:00Z' }),
    ]);
    expect(periods.map((p) => p.value)).not.toContain('2020');
  });

  it('is empty when nothing is logged', () => {
    expect(availablePeriods([])).toEqual([]);
  });
});

describe('filterWears', () => {
  const opi = makePolish({ brand: 'OPI', name: 'Red', color: 'Red' });
  const zoya = makePolish({ brand: 'Zoya', name: 'Blue', color: 'Blue' });
  const polishes = [opi, zoya];

  const wears = [
    makeWear({ polish_id: opi.id, worn_on: '2026-08-04' }),
    makeWear({ polish_id: zoya.id, worn_on: '2026-06-04' }),
    makeWear({ polish_id: opi.id, worn_on: '2025-12-04' }),
  ];

  it('returns everything under the default filter', () => {
    expect(filterWears(wears, polishes, DEFAULT_LOG_FILTER)).toHaveLength(3);
  });

  it('matches a whole year from a YYYY period', () => {
    const result = filterWears(wears, polishes, { ...DEFAULT_LOG_FILTER, period: '2026' });
    expect(result.map((w) => w.worn_on)).toEqual(['2026-08-04', '2026-06-04']);
  });

  it('matches a single month from a YYYY-MM period', () => {
    const result = filterWears(wears, polishes, { ...DEFAULT_LOG_FILTER, period: '2026-08' });
    expect(result.map((w) => w.worn_on)).toEqual(['2026-08-04']);
  });

  it('filters by the polish brand and color', () => {
    expect(filterWears(wears, polishes, { ...DEFAULT_LOG_FILTER, brand: 'OPI' })).toHaveLength(2);
    expect(filterWears(wears, polishes, { ...DEFAULT_LOG_FILTER, color: 'Blue' })).toHaveLength(1);
  });

  it('combines period and brand', () => {
    const result = filterWears(wears, polishes, {
      ...DEFAULT_LOG_FILTER,
      period: '2026',
      brand: 'OPI',
    });
    expect(result.map((w) => w.worn_on)).toEqual(['2026-08-04']);
  });

  it('excludes soft-deleted wears', () => {
    const withDeleted = [...wears, makeWear({ polish_id: opi.id, worn_on: '2026-08-09', deleted_at: 'x' })];
    expect(filterWears(withDeleted, polishes, DEFAULT_LOG_FILTER)).toHaveLength(3);
  });

  it('drops a wear whose polish is missing once brand or color is constrained', () => {
    const orphan = [makeWear({ polish_id: 'gone', worn_on: '2026-08-04' })];
    // With no brand/color constraint it still shows — the date is still true.
    expect(filterWears(orphan, polishes, DEFAULT_LOG_FILTER)).toHaveLength(1);
    // Asked "was it an OPI?", there is no honest answer, so it drops out.
    expect(filterWears(orphan, polishes, { ...DEFAULT_LOG_FILTER, brand: 'OPI' })).toHaveLength(0);
  });
});

describe('activeLogFilterCount', () => {
  it('counts narrowing constraints', () => {
    expect(activeLogFilterCount(DEFAULT_LOG_FILTER)).toBe(0);
    expect(activeLogFilterCount({ period: '2026', brand: ANY, color: 'Red' })).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { withStats } from '../derive';
import {
  ANY,
  DEFAULT_FILTERS,
  diagnose,
  eligible,
  eligiblePolishes,
  pick,
  untouched,
  type PickerFilters,
} from '../picker';
import type { PolishWithStats, Wear } from '../types';
import { makePolish, makeWear } from './factories';

const TODAY = '2026-08-19';

function build(
  polishes: Parameters<typeof makePolish>[0][],
  wears: Wear[] = [],
): PolishWithStats[] {
  return withStats(polishes.map(makePolish), wears, TODAY);
}

const filters = (overrides: Partial<PickerFilters> = {}): PickerFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides,
});

describe('eligible', () => {
  it('always admits a never-worn polish, however long the rest period', () => {
    const [never] = build([{ id: 'p1' }]);
    // This is the rule that makes the picker do its job — surfacing the untouched.
    expect(eligible(never, filters({ restDays: 90 }), TODAY)).toBe(true);
  });

  it('excludes archived polishes', () => {
    const [gone] = build([{ id: 'p1', archived: true }]);
    expect(eligible(gone, filters(), TODAY)).toBe(false);
  });

  it('excludes soft-deleted polishes', () => {
    const [deleted] = build([{ id: 'p1', deleted_at: '2026-08-01T00:00:00Z' }]);
    expect(eligible(deleted, filters(), TODAY)).toBe(false);
  });

  describe('rest period boundary', () => {
    // Worn exactly 14 days ago; the rule is `days_since >= rest_days`.
    const wornFourteenDaysAgo = () =>
      build([{ id: 'p1' }], [makeWear({ polish_id: 'p1', worn_on: '2026-08-05' })])[0];

    it('admits at exactly the threshold', () => {
      expect(eligible(wornFourteenDaysAgo(), filters({ restDays: 14 }), TODAY)).toBe(true);
    });

    it('rejects one day short of the threshold', () => {
      expect(eligible(wornFourteenDaysAgo(), filters({ restDays: 15 }), TODAY)).toBe(false);
    });

    it('admits everything at restDays 0, including something worn today', () => {
      const worn = build([{ id: 'p1' }], [makeWear({ polish_id: 'p1', worn_on: TODAY })])[0];
      expect(eligible(worn, filters({ restDays: 0 }), TODAY)).toBe(true);
    });

    it('recomputes against the supplied today rather than trusting stale stats', () => {
      // Stats were derived on the 19th, but we are now asking on the 20th.
      const worn = build([{ id: 'p1' }], [makeWear({ polish_id: 'p1', worn_on: '2026-08-06' })])[0];
      expect(eligible(worn, filters({ restDays: 14 }), '2026-08-19')).toBe(false);
      expect(eligible(worn, filters({ restDays: 14 }), '2026-08-20')).toBe(true);
    });
  });

  describe('attribute filters', () => {
    const subject = () => build([{ id: 'p1', brand: 'OPI', color: 'Red', finish: 'Cream' }])[0];

    it('matches finish exactly, and Any matches all', () => {
      expect(eligible(subject(), filters({ finish: 'Cream' }), TODAY)).toBe(true);
      expect(eligible(subject(), filters({ finish: 'Glitter' }), TODAY)).toBe(false);
      expect(eligible(subject(), filters({ finish: ANY }), TODAY)).toBe(true);
    });

    it('matches color exactly, and Any matches all', () => {
      expect(eligible(subject(), filters({ color: 'Red' }), TODAY)).toBe(true);
      expect(eligible(subject(), filters({ color: 'Blue' }), TODAY)).toBe(false);
    });

    it('matches brand as a case-insensitive substring', () => {
      expect(eligible(subject(), filters({ brandQuery: 'opi' }), TODAY)).toBe(true);
      expect(eligible(subject(), filters({ brandQuery: 'OP' }), TODAY)).toBe(true);
      expect(eligible(subject(), filters({ brandQuery: 'Zoya' }), TODAY)).toBe(false);
    });

    it('treats a blank or whitespace-only brand query as no constraint', () => {
      expect(eligible(subject(), filters({ brandQuery: '' }), TODAY)).toBe(true);
      expect(eligible(subject(), filters({ brandQuery: '   ' }), TODAY)).toBe(true);
    });

    it('requires every filter to pass, not any', () => {
      expect(eligible(subject(), filters({ color: 'Red', finish: 'Glitter' }), TODAY)).toBe(false);
    });
  });
});

describe('pick', () => {
  it('returns null on an empty pool rather than throwing', () => {
    expect(pick([])).toBeNull();
  });

  it('selects by the injected rng', () => {
    const pool = ['a', 'b', 'c'];
    expect(pick(pool, () => 0)).toBe('a');
    expect(pick(pool, () => 0.5)).toBe('b');
    expect(pick(pool, () => 0.99)).toBe('c');
  });

  it('does not run off the end when rng returns exactly 1', () => {
    // Math.random() never returns 1, but a seeded or mocked rng might.
    expect(pick(['a', 'b'], () => 1)).toBe('b');
  });

  it('can reach every element', () => {
    const pool = [1, 2, 3, 4, 5];
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) seen.add(pick(pool)!);
    expect(seen.size).toBe(5);
  });
});

describe('diagnose', () => {
  it('reports the count and no suggestions when the pool is healthy', () => {
    const polishes = build([{ id: 'p1' }, { id: 'p2' }]);
    const result = diagnose(polishes, filters(), TODAY);
    expect(result.eligibleCount).toBe(2);
    expect(result.suggestions).toEqual([]);
    expect(result.collectionEmpty).toBe(false);
  });

  it('flags an empty collection distinctly from an over-filtered one', () => {
    const result = diagnose([], filters(), TODAY);
    expect(result.collectionEmpty).toBe(true);
    expect(result.suggestions).toEqual([]);
  });

  it('treats a fully archived collection as empty, not over-filtered', () => {
    const polishes = build([{ id: 'p1', archived: true }]);
    expect(diagnose(polishes, filters(), TODAY).collectionEmpty).toBe(true);
  });

  it('names the single filter responsible for an empty result', () => {
    const polishes = build([{ id: 'p1', color: 'Red' }, { id: 'p2', color: 'Red' }]);
    const result = diagnose(polishes, filters({ color: 'Teal' }), TODAY);

    expect(result.eligibleCount).toBe(0);
    expect(result.suggestions[0]).toEqual({ filter: 'color', unlocks: 2 });
  });

  it('ranks suggestions by how much each unlocks', () => {
    const polishes = build([
      { id: 'p1', brand: 'OPI', color: 'Red' },
      { id: 'p2', brand: 'OPI', color: 'Red' },
      { id: 'p3', brand: 'Zoya', color: 'Blue' },
    ]);
    // Both filters are wrong. Relaxing color leaves brandQuery='OPI' in force, which
    // frees the two OPI reds. Relaxing brand leaves color='Blue' in force, which frees
    // only the one Zoya blue. So color is the more useful suggestion.
    const result = diagnose(polishes, filters({ color: 'Blue', brandQuery: 'OPI' }), TODAY);

    expect(result.eligibleCount).toBe(0);
    expect(result.suggestions.map((s) => s.filter)).toEqual(['color', 'brandQuery']);
    expect(result.suggestions[0].unlocks).toBe(2);
    expect(result.suggestions[1].unlocks).toBe(1);
  });

  it('suggests relaxing the rest period when that is the blocker', () => {
    const polishes = build(
      [{ id: 'p1' }],
      [makeWear({ polish_id: 'p1', worn_on: '2026-08-18' })],
    );
    const result = diagnose(polishes, filters({ restDays: 28 }), TODAY);
    expect(result.suggestions[0].filter).toBe('restDays');
  });

  it('omits filters whose relaxation would change nothing', () => {
    const polishes = build([{ id: 'p1', color: 'Red', finish: 'Cream' }]);
    const result = diagnose(polishes, filters({ color: 'Teal', finish: 'Matte' }), TODAY);
    // Relaxing only color still leaves the finish wrong, and vice versa — so neither
    // single relaxation unlocks anything and we must not promise otherwise.
    expect(result.suggestions).toEqual([]);
  });
});

describe('eligiblePolishes', () => {
  it('filters the list', () => {
    const polishes = build([
      { id: 'p1', color: 'Red' },
      { id: 'p2', color: 'Blue' },
    ]);
    expect(eligiblePolishes(polishes, filters({ color: 'Red' }), TODAY)).toHaveLength(1);
  });
});

describe('untouched', () => {
  it('puts never-worn first, then longest-rested', () => {
    const polishes = build(
      [
        { id: 'p1', name: 'Recent' },
        { id: 'p2', name: 'Ancient' },
        { id: 'p3', name: 'Never' },
      ],
      [
        makeWear({ polish_id: 'p1', worn_on: '2026-08-15' }),
        makeWear({ polish_id: 'p2', worn_on: '2026-01-01' }),
      ],
    );
    expect(untouched(polishes).map((p) => p.name)).toEqual(['Never', 'Ancient', 'Recent']);
  });

  it('excludes archived bottles and respects the limit', () => {
    const polishes = build([
      { id: 'p1', archived: true },
      { id: 'p2' },
      { id: 'p3' },
    ]);
    expect(untouched(polishes, 1)).toHaveLength(1);
    expect(untouched(polishes).every((p) => !p.archived)).toBe(true);
  });
});

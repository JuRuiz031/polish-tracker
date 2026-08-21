import { describe, expect, it } from 'vitest';
import { statsFor, summarise, withStats } from '../derive';
import { makePolish, makeWear } from './factories';

const TODAY = '2026-08-19';

describe('statsFor', () => {
  it('reports never-worn as null rather than zero', () => {
    const stats = statsFor([], TODAY);
    expect(stats.times_worn).toBe(0);
    // These three being null is what distinguishes "never worn" from "worn long ago".
    expect(stats.last_worn).toBeNull();
    expect(stats.days_since).toBeNull();
    expect(stats.avg_rating).toBeNull();
  });

  it('counts wears and finds the most recent regardless of input order', () => {
    const stats = statsFor(
      [
        makeWear({ worn_on: '2026-07-01' }),
        makeWear({ worn_on: '2026-08-10' }),
        makeWear({ worn_on: '2026-06-15' }),
      ],
      TODAY,
    );
    expect(stats.times_worn).toBe(3);
    expect(stats.last_worn).toBe('2026-08-10');
    expect(stats.days_since).toBe(9);
  });

  it('averages only the rated wears, to one decimal', () => {
    const stats = statsFor(
      [
        makeWear({ rating: 5 }),
        makeWear({ rating: 4 }),
        makeWear({ rating: 4 }),
        makeWear({ rating: null }),
      ],
      TODAY,
    );
    // 13/3 = 4.333… → 4.3, and the unrated row must not drag it toward zero.
    expect(stats.avg_rating).toBe(4.3);
    expect(stats.times_worn).toBe(4);
  });

  it('distinguishes unrated from rated-badly', () => {
    const unrated = statsFor([makeWear({ rating: null })], TODAY);
    const rated = statsFor([makeWear({ rating: 1 })], TODAY);
    expect(unrated.avg_rating).toBeNull();
    expect(rated.avg_rating).toBe(1);
  });

  it('rounds halves consistently', () => {
    expect(statsFor([makeWear({ rating: 4 }), makeWear({ rating: 5 })], TODAY).avg_rating).toBe(4.5);
    expect(statsFor([makeWear({ rating: 3 }), makeWear({ rating: 4 })], TODAY).avg_rating).toBe(3.5);
  });

  it('excludes soft-deleted wears from every number', () => {
    const stats = statsFor(
      [
        makeWear({ worn_on: '2026-08-10', rating: 1, deleted_at: '2026-08-11T00:00:00Z' }),
        makeWear({ worn_on: '2026-07-01', rating: 5 }),
      ],
      TODAY,
    );
    expect(stats.times_worn).toBe(1);
    expect(stats.last_worn).toBe('2026-07-01');
    expect(stats.avg_rating).toBe(5);
  });

  it('handles a wear logged today', () => {
    expect(statsFor([makeWear({ worn_on: TODAY })], TODAY).days_since).toBe(0);
  });
});

describe('withStats', () => {
  it('attaches each polish only its own wears', () => {
    const red = makePolish({ id: 'p1' });
    const blue = makePolish({ id: 'p2', name: 'Blue Moon' });
    const result = withStats(
      [red, blue],
      [
        makeWear({ polish_id: 'p1', worn_on: '2026-08-01' }),
        makeWear({ polish_id: 'p1', worn_on: '2026-08-05' }),
        makeWear({ polish_id: 'p2', worn_on: '2026-01-01' }),
      ],
      TODAY,
    );
    expect(result[0].stats.times_worn).toBe(2);
    expect(result[1].stats.times_worn).toBe(1);
  });

  it('gives a polish with no wears the never-worn shape', () => {
    const [only] = withStats([makePolish({ id: 'p1' })], [], TODAY);
    expect(only.stats.last_worn).toBeNull();
  });

  it('ignores orphan wear rows pointing at nothing in the list', () => {
    const result = withStats(
      [makePolish({ id: 'p1' })],
      [makeWear({ polish_id: 'ghost' })],
      TODAY,
    );
    expect(result).toHaveLength(1);
    expect(result[0].stats.times_worn).toBe(0);
  });
});

describe('summarise', () => {
  it('splits never-worn from worn-at-least-once', () => {
    const polishes = withStats(
      [makePolish({ id: 'p1' }), makePolish({ id: 'p2' }), makePolish({ id: 'p3' })],
      [makeWear({ polish_id: 'p1', rating: 4 })],
      TODAY,
    );
    const summary = summarise(polishes, [makeWear({ polish_id: 'p1', rating: 4 })]);

    expect(summary.total_polishes).toBe(3);
    expect(summary.never_worn).toBe(2);
    expect(summary.worn_at_least_once).toBe(1);
    expect(summary.manicures_logged).toBe(1);
    expect(summary.avg_rating).toBe(4);
    expect(summary.most_recent_manicure).toBe('2026-08-01');
  });

  it('reports an empty collection without dividing by zero', () => {
    const summary = summarise([], []);
    expect(summary.total_polishes).toBe(0);
    expect(summary.avg_rating).toBeNull();
    expect(summary.most_recent_manicure).toBeNull();
  });

  it('counts archived polishes in the total and reports them separately', () => {
    const polishes = withStats(
      [makePolish({ id: 'p1', archived: false }), makePolish({ id: 'p2', archived: true })],
      [],
      TODAY,
    );
    const summary = summarise(polishes, []);

    // Deliberate: total_polishes includes the archived bottle even though the
    // Collection screen hides it by default. See the `archived` field's doc comment.
    expect(summary.total_polishes).toBe(2);
    expect(summary.archived).toBe(1);
  });

  it('includes a rating from a wear whose polish was since deleted', () => {
    // The Log still lists this row as "Deleted polish" — the summary above it on the
    // same screen has to agree with what she can scroll down and see.
    const polishes = withStats([makePolish({ id: 'p1' })], [], TODAY);
    const wears = [
      makeWear({ polish_id: 'p1', rating: 4 }),
      makeWear({ polish_id: 'now-deleted', rating: 2 }),
    ];
    const summary = summarise(polishes, wears);

    expect(summary.manicures_logged).toBe(2);
    expect(summary.avg_rating).toBe(3); // (4 + 2) / 2
  });
});

import { describe, expect, it } from 'vitest';
import {
  countDuplicateGroups,
  dedupeKey,
  findCollisions,
  findDuplicates,
  flagWishlist,
} from '../dedupe';
import { makePolish, makeWishlistItem } from './factories';

describe('dedupeKey', () => {
  it('matches the documented format', () => {
    expect(dedupeKey('OPI', 'Big Apple Red')).toBe('opi - big apple red');
  });

  it('normalises case and surrounding spaces', () => {
    expect(dedupeKey('  OPI ', ' Big Apple Red  ')).toBe(dedupeKey('opi', 'big apple red'));
  });

  it('preserves interior spacing, which is a real difference', () => {
    expect(dedupeKey('OPI', 'Big  Apple')).not.toBe(dedupeKey('OPI', 'Big Apple'));
  });

  it('trims spaces only, mirroring Postgres trim() rather than JS .trim()', () => {
    // Postgres trim() does not strip tabs, so neither may we — otherwise the client
    // and the generated column would disagree about whether two rows collide.
    expect(dedupeKey('OPI\t', 'Red')).toBe('opi\t - red');
  });

  it('keeps different polishes distinct', () => {
    expect(dedupeKey('OPI', 'Red')).not.toBe(dedupeKey('Zoya', 'Red'));
    expect(dedupeKey('OPI', 'Red')).not.toBe(dedupeKey('OPI', 'Blue'));
  });
});

describe('findDuplicates', () => {
  it('flags BOTH members of a duplicate pair', () => {
    const flagged = findDuplicates([
      makePolish({ id: 'a', brand: 'OPI', name: 'Red' }),
      makePolish({ id: 'b', brand: 'opi', name: '  red ' }),
      makePolish({ id: 'c', brand: 'Zoya', name: 'Blue' }),
    ]);
    // The brief asks for both rows marked in the list, not just the newer one.
    expect(flagged).toEqual(new Set(['a', 'b']));
  });

  it('flags all members of a triple', () => {
    const flagged = findDuplicates([
      makePolish({ id: 'a', brand: 'OPI', name: 'Red' }),
      makePolish({ id: 'b', brand: 'OPI', name: 'Red' }),
      makePolish({ id: 'c', brand: 'OPI', name: 'Red' }),
    ]);
    expect(flagged.size).toBe(3);
  });

  it('ignores archived and soft-deleted rows', () => {
    const flagged = findDuplicates([
      makePolish({ id: 'a', brand: 'OPI', name: 'Red' }),
      makePolish({ id: 'b', brand: 'OPI', name: 'Red', archived: true }),
      makePolish({ id: 'c', brand: 'OPI', name: 'Red', deleted_at: '2026-01-01T00:00:00Z' }),
    ]);
    // Archiving one of a pair is a legitimate way to resolve a duplicate.
    expect(flagged.size).toBe(0);
  });

  it('returns empty for a clean collection', () => {
    expect(findDuplicates([makePolish({ id: 'a' })]).size).toBe(0);
    expect(findDuplicates([]).size).toBe(0);
  });
});

describe('countDuplicateGroups', () => {
  it('counts groups, not rows', () => {
    const polishes = [
      makePolish({ brand: 'OPI', name: 'Red' }),
      makePolish({ brand: 'OPI', name: 'Red' }),
      makePolish({ brand: 'OPI', name: 'Red' }),
      makePolish({ brand: 'Zoya', name: 'Blue' }),
      makePolish({ brand: 'Zoya', name: 'Blue' }),
    ];
    // Five rows, three of one and two of another — but only 2 things to resolve.
    expect(countDuplicateGroups(polishes)).toBe(2);
  });
});

describe('findCollisions', () => {
  const collection = [
    makePolish({ id: 'a', brand: 'OPI', name: 'Big Apple Red' }),
    makePolish({ id: 'b', brand: 'Zoya', name: 'Storm' }),
  ];

  it('finds an existing bottle by normalised key', () => {
    expect(findCollisions(collection, '  opi ', 'BIG APPLE RED').map((p) => p.id)).toEqual(['a']);
  });

  it('returns empty for something genuinely new', () => {
    expect(findCollisions(collection, 'Essie', 'Ballet Slippers')).toEqual([]);
  });

  it('does not flag a row against itself when editing', () => {
    expect(findCollisions(collection, 'OPI', 'Big Apple Red', 'a')).toEqual([]);
  });

  it('warns rather than blocks — it only reports, never rejects', () => {
    // Encodes the brief's rule: she may legitimately own a backup bottle, so the
    // caller is free to add anyway. This function has no veto.
    const collisions = findCollisions(collection, 'OPI', 'Big Apple Red');
    expect(collisions).toHaveLength(1);
  });

  it('ignores an archived bottle, so replacing a used-up polish is not flagged', () => {
    const withArchived = [makePolish({ id: 'a', brand: 'OPI', name: 'Red', archived: true })];
    expect(findCollisions(withArchived, 'OPI', 'Red')).toEqual([]);
  });

  // The wishlist form checks a new row against BOTH lists, so this has to work over
  // wishlist rows and not only over polishes.
  describe('over wishlist rows', () => {
    const wishlist = [
      makeWishlistItem({ id: 'w1', brand: 'ILNP', name: 'Mercury Rising' }),
      makeWishlistItem({ id: 'w2', brand: 'Zoya', name: 'Payton' }),
    ];

    it('finds an item already listed, by normalised key', () => {
      expect(findCollisions(wishlist, 'ilnp ', 'MERCURY RISING').map((i) => i.id)).toEqual(['w1']);
    });

    it('does not flag a row against itself when editing', () => {
      expect(findCollisions(wishlist, 'ILNP', 'Mercury Rising', 'w1')).toEqual([]);
    });

    it('ignores a Bought row, which is history rather than an intention', () => {
      // Mirrors isCountable's status filter: once bought, the row points at the bottle
      // it became, so re-wanting the shade is not "already on the wishlist".
      const bought = [makeWishlistItem({ id: 'w3', brand: 'OPI', name: 'Red', status: 'Bought' })];
      expect(findCollisions(bought, 'OPI', 'Red')).toEqual([]);
    });
  });
});

describe('flagWishlist', () => {
  it('marks an item she already owns, pointing at the owned polish', () => {
    const owned = makePolish({ id: 'p1', brand: 'OPI', name: 'Red' });
    const item = makeWishlistItem({ id: 'w1', brand: 'opi', name: 'RED' });

    const { alreadyOwned, duplicated } = flagWishlist([item], [owned]);
    expect(alreadyOwned.get('w1')).toBe('p1');
    expect(duplicated.size).toBe(0);
  });

  it('marks a within-wishlist duplicate separately from already-owned', () => {
    const { alreadyOwned, duplicated } = flagWishlist(
      [
        makeWishlistItem({ id: 'w1', brand: 'Zoya', name: 'Storm' }),
        makeWishlistItem({ id: 'w2', brand: 'Zoya', name: 'Storm' }),
      ],
      [],
    );
    // Two distinct states, two distinct visual treatments — they must not be conflated.
    expect(duplicated).toEqual(new Set(['w1', 'w2']));
    expect(alreadyOwned.size).toBe(0);
  });

  it('can report both states on the same row', () => {
    const { alreadyOwned, duplicated } = flagWishlist(
      [
        makeWishlistItem({ id: 'w1', brand: 'OPI', name: 'Red' }),
        makeWishlistItem({ id: 'w2', brand: 'OPI', name: 'Red' }),
      ],
      [makePolish({ id: 'p1', brand: 'OPI', name: 'Red' })],
    );
    expect(alreadyOwned.has('w1')).toBe(true);
    expect(duplicated.has('w1')).toBe(true);
  });

  it('does not count an archived bottle as owned', () => {
    // She gave it away or used it up, so wanting it again is reasonable.
    const { alreadyOwned } = flagWishlist(
      [makeWishlistItem({ id: 'w1', brand: 'OPI', name: 'Red' })],
      [makePolish({ id: 'p1', brand: 'OPI', name: 'Red', archived: true })],
    );
    expect(alreadyOwned.size).toBe(0);
  });
});

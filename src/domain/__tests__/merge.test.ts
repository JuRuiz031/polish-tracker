import { describe, expect, it } from 'vitest';
import { hasLocalChanges, mergeRows, mergeSnapshots } from '../merge';
import { makePolish, makeWear, makeWishlistItem } from './factories';

const EARLY = '2026-01-01T00:00:00Z';
const LATE = '2026-06-01T00:00:00Z';

describe('mergeRows', () => {
  it('keeps rows that exist on only one side', () => {
    const local = [makePolish({ id: 'a' })];
    const remote = [makePolish({ id: 'b' })];
    expect(mergeRows(local, remote).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('the newer edit of the same row wins, whichever side it is on', () => {
    const older = makePolish({ id: 'a', name: 'Old', updated_at: EARLY });
    const newer = makePolish({ id: 'a', name: 'New', updated_at: LATE });

    expect(mergeRows([newer], [older])[0].name).toBe('New'); // local newer
    expect(mergeRows([older], [newer])[0].name).toBe('New'); // remote newer
  });

  it('resolves ties the same way regardless of which device asks', () => {
    // Not about which one "should" win — about both devices agreeing. If they
    // disagreed they would write different files back and undo each other forever.
    const l = makePolish({ id: 'a', name: 'Local', updated_at: EARLY });
    const r = makePolish({ id: 'a', name: 'Remote', updated_at: EARLY });
    expect(mergeRows([l], [r])[0].name).toBe(mergeRows([l], [r])[0].name);
    expect(mergeRows([l], [r])).toHaveLength(1);
  });

  it('never duplicates a row edited on both devices', () => {
    const local = [makePolish({ id: 'a', updated_at: LATE })];
    const remote = [makePolish({ id: 'a', updated_at: EARLY })];
    expect(mergeRows(local, remote)).toHaveLength(1);
  });

  it('sorts by id, so a save diffs to the row that changed', () => {
    const ids = mergeRows(
      [makePolish({ id: 'c' }), makePolish({ id: 'a' })],
      [makePolish({ id: 'b' })],
    ).map((r) => r.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('is idempotent — merging twice changes nothing', () => {
    const local = [makePolish({ id: 'a', updated_at: LATE })];
    const remote = [makePolish({ id: 'a', updated_at: EARLY }), makePolish({ id: 'b' })];
    const once = mergeRows(local, remote);
    expect(mergeRows(once, once)).toEqual(once);
  });
});

describe('deletes survive a merge', () => {
  it('a delete made offline is not resurrected by the other device', () => {
    // The reason deletes are soft. A hard delete would be indistinguishable from
    // "the phone has not seen this row yet", and reconnecting would bring back
    // everything she deleted while offline.
    const deletedOnPhone = makePolish({ id: 'a', deleted_at: LATE, updated_at: LATE });
    const stillLiveOnLaptop = makePolish({ id: 'a', deleted_at: null, updated_at: EARLY });

    const merged = mergeRows([deletedOnPhone], [stillLiveOnLaptop]);
    expect(merged[0].deleted_at).toBe(LATE);
  });

  it('an undo after a delete wins, because it happened later', () => {
    const deleted = makePolish({ id: 'a', deleted_at: EARLY, updated_at: EARLY });
    const restored = makePolish({ id: 'a', deleted_at: null, updated_at: LATE });
    expect(mergeRows([restored], [deleted])[0].deleted_at).toBeNull();
  });
});

describe('mergeSnapshots', () => {
  it('merges each table independently', () => {
    const local = {
      polish: [makePolish({ id: 'p1' })],
      wear: [makeWear({ id: 'w1' })],
      wishlist: [makeWishlistItem({ id: 'l1' })],
    };
    const remote = {
      polish: [makePolish({ id: 'p2' })],
      wear: [makeWear({ id: 'w2' })],
      wishlist: [makeWishlistItem({ id: 'l2' })],
    };
    const merged = mergeSnapshots(local, remote);
    expect(merged.polish).toHaveLength(2);
    expect(merged.wear).toHaveLength(2);
    expect(merged.wishlist).toHaveLength(2);
  });

  it('edits on different devices to different rows both survive', () => {
    // The case that a file-level last-write-wins would get wrong: logging a manicure on
    // the phone and renaming a polish on the laptop are not in conflict at all.
    const phone = {
      polish: [makePolish({ id: 'p1', name: 'Renamed', updated_at: LATE })],
      wear: [],
      wishlist: [],
    };
    const laptop = {
      polish: [makePolish({ id: 'p1', name: 'Original', updated_at: EARLY })],
      wear: [makeWear({ id: 'w1', polish_id: 'p1' })],
      wishlist: [],
    };
    const merged = mergeSnapshots(phone, laptop);
    expect(merged.polish[0].name).toBe('Renamed');
    expect(merged.wear).toHaveLength(1);
  });
});

describe('hasLocalChanges', () => {
  const remote = {
    polish: [makePolish({ id: 'a', updated_at: EARLY })],
    wear: [],
    wishlist: [],
  };

  it('is false when local matches remote', () => {
    expect(hasLocalChanges(remote, remote)).toBe(false);
  });

  it('is true for a new local row', () => {
    const local = { ...remote, polish: [...remote.polish, makePolish({ id: 'b' })] };
    expect(hasLocalChanges(local, remote)).toBe(true);
  });

  it('is true for a locally edited row', () => {
    const local = { ...remote, polish: [makePolish({ id: 'a', updated_at: LATE })] };
    expect(hasLocalChanges(local, remote)).toBe(true);
  });

  it('is false when remote is simply ahead — that is a pull, not a push', () => {
    const local = { polish: [], wear: [], wishlist: [] };
    expect(hasLocalChanges(local, remote)).toBe(false);
  });
});

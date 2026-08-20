import type { Polish, Wear, WishlistItem } from './types';

/**
 * Reconciling two versions of the collection.
 *
 * This is what makes working offline safe. Her phone edits a cached copy with no signal;
 * meanwhile her laptop may have written to the repository. When the phone reconnects,
 * neither copy is authoritative — both contain real changes she made — so one cannot
 * simply overwrite the other.
 *
 * The rule is last-write-wins PER ROW, on `updated_at`. Row-level rather than file-level
 * is the whole point: logging a manicure on her phone and renaming a polish on her laptop
 * are not in conflict, and a file-level rule would throw one of them away. Only genuine
 * edits to the SAME row compete, and those are rare for one person.
 *
 * Two earlier decisions pay off here:
 *
 *   - Deletes are soft. A deletion is an ordinary row update (`deleted_at` set,
 *     `updated_at` bumped), so it merges by the same rule as everything else. With hard
 *     deletes there would be no way to tell "deleted on the phone" from "created on the
 *     laptop and not yet seen by the phone", and reconnecting would silently resurrect
 *     everything she had deleted while offline.
 *   - Ids are generated on the client. The same row edited on two devices keeps one id,
 *     so it can be recognised as one row rather than merged into two.
 */

/** Anything storable: an id to match on, and a timestamp to order by. */
interface Mergeable {
  id: string;
  updated_at: string;
}

export interface MergeableSnapshot {
  polish: Polish[];
  wear: Wear[];
  wishlist: WishlistItem[];
}

/**
 * Merge one table.
 *
 * Ties go to `remote`. The choice is arbitrary but it must be *deterministic*: two
 * devices merging the same pair of versions have to reach the same answer, or they will
 * write different files back and ping-pong forever, each undoing the other.
 *
 * Output is sorted by id for the same reason it is in the export — the stored file is
 * committed on every save, and stable ordering means a diff shows the row that changed
 * rather than the whole collection.
 */
export function mergeRows<T extends Mergeable>(local: readonly T[], remote: readonly T[]): T[] {
  const byId = new Map<string, T>();

  for (const row of remote) byId.set(row.id, row);

  for (const row of local) {
    const existing = byId.get(row.id);
    // Strictly greater: on an equal timestamp the remote row already in the map stays.
    if (!existing || row.updated_at > existing.updated_at) byId.set(row.id, row);
  }

  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function mergeSnapshots(
  local: MergeableSnapshot,
  remote: MergeableSnapshot,
): MergeableSnapshot {
  return {
    polish: mergeRows(local.polish, remote.polish),
    wear: mergeRows(local.wear, remote.wear),
    wishlist: mergeRows(local.wishlist, remote.wishlist),
  };
}

/**
 * Does the local copy contain anything the remote one does not already have?
 *
 * Used to decide whether a sync is worth doing at all. Comparing merged output against
 * the remote input answers "would pushing change anything?" without needing to track
 * which individual rows are dirty — and tracking dirtiness separately from the data is
 * exactly the kind of bookkeeping that drifts out of step with reality and loses a write.
 */
export function hasLocalChanges(
  local: MergeableSnapshot,
  remote: MergeableSnapshot,
): boolean {
  const merged = mergeSnapshots(local, remote);
  return (
    !sameRows(merged.polish, remote.polish) ||
    !sameRows(merged.wear, remote.wear) ||
    !sameRows(merged.wishlist, remote.wishlist)
  );
}

function sameRows<T extends Mergeable>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((row) => [row.id, row.updated_at]));
  return a.every((row) => byId.get(row.id) === row.updated_at);
}

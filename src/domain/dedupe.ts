import type { Polish, WishlistItem } from './types';

/**
 * Duplicate detection.
 *
 * The uniqueness key is `lower(trim(brand)) + ' - ' + lower(trim(name))` — the same rule
 * the spreadsheet matches on. It is computed in TWO places: here, and as a generated
 * column in supabase/migrations/0001_schema.sql. They must agree, so `dedupeKey()`
 * below is written to mirror Postgres semantics exactly:
 *
 *   - Postgres `trim()` strips spaces only, not all whitespace. JS `.trim()` strips all
 *     whitespace including tabs and newlines, so a pasted "OPI\t" would key differently
 *     on client and server. We strip spaces only, to match.
 *   - Postgres `lower()` is locale-dependent; JS `toLowerCase()` is Unicode-default.
 *     For brand and polish names these agree, but `toLocaleLowerCase()` would NOT
 *     (Turkish dotless ı), so we deliberately use the locale-independent form.
 *
 * Detection is a WARNING, never a block — she may legitimately own a backup bottle.
 * Nothing here rejects anything; it only labels.
 */
export function dedupeKey(brand: string, name: string): string {
  return `${trimSpaces(brand).toLowerCase()} - ${trimSpaces(name).toLowerCase()}`;
}

/** Postgres `trim()` semantics: leading and trailing SPACES only. */
function trimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, '');
}

/**
 * Rows that count toward duplicate detection: live, not archived, not already bought.
 *
 * A Bought wishlist row is excluded because it is history, not an intention. It links
 * directly to the bottle it became, so flagging it "you already own this" would be
 * telling her something she just did — and it would flag itself against the very polish
 * the purchase created. Mirrors the `status <> 'Bought'` filter on the
 * wishlist_already_owned view.
 */
function isCountable(row: {
  deleted_at: string | null;
  archived?: boolean;
  status?: string;
}): boolean {
  return row.deleted_at === null && row.archived !== true && row.status !== 'Bought';
}

/**
 * IDs of polishes that share their key with at least one other. Both members of a pair
 * are returned — the brief asks for both rows to be marked in the list, not just the
 * later one.
 */
export function findDuplicates(polishes: readonly Polish[]): Set<string> {
  const byKey = new Map<string, string[]>();

  for (const polish of polishes) {
    if (!isCountable(polish)) continue;
    const key = dedupeKey(polish.brand, polish.name);
    const existing = byKey.get(key);
    if (existing) existing.push(polish.id);
    else byKey.set(key, [polish.id]);
  }

  const flagged = new Set<string>();
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) flagged.add(id);
  }
  return flagged;
}

/** Count of distinct duplicate GROUPS, which is the calmer number to surface. */
export function countDuplicateGroups(polishes: readonly Polish[]): number {
  const seen = new Map<string, number>();
  for (const polish of polishes) {
    if (!isCountable(polish)) continue;
    const key = dedupeKey(polish.brand, polish.name);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let groups = 0;
  for (const count of seen.values()) if (count > 1) groups += 1;
  return groups;
}

/**
 * The minimum a row needs for duplicate detection. Both `Polish` and `WishlistItem`
 * satisfy it structurally — mirroring `isCountable` above, which was already written
 * against a shape rather than a concrete type.
 */
interface DedupeRow {
  id: string;
  brand: string;
  name: string;
  deleted_at: string | null;
  archived?: boolean;
  status?: string;
}

/**
 * Would adding this brand/name collide with something already recorded?
 *
 * Used at entry time to render an inline warning while she types, in both forms and
 * against both lists — a new wishlist row is checked against the collection ("you
 * already own this") *and* against the wishlist itself ("this is already listed"), which
 * are the same two states `flagWishlist` distinguishes after the fact.
 *
 * `excludeId` lets an edit of an existing row ignore itself.
 *
 * Generic over the row type so the caller gets its own type back, rather than every
 * caller having to widen to a common interface and cast at the use site.
 */
export function findCollisions<T extends DedupeRow>(
  rows: readonly T[],
  brand: string,
  name: string,
  excludeId?: string,
): T[] {
  const key = dedupeKey(brand, name);
  return rows.filter(
    (row) => isCountable(row) && row.id !== excludeId && dedupeKey(row.brand, row.name) === key,
  );
}

/**
 * The two wishlist states, which the brief is explicit must look different:
 *   alreadyOwned — this key exists in the collection ("you already own this"), amber
 *   duplicated   — this key is listed twice within the wishlist itself, alert
 */
export interface WishlistFlags {
  alreadyOwned: Map<string, string>;
  duplicated: Set<string>;
}

export function flagWishlist(
  wishlist: readonly WishlistItem[],
  polishes: readonly Polish[],
): WishlistFlags {
  const ownedByKey = new Map<string, string>();
  for (const polish of polishes) {
    if (!isCountable(polish)) continue;
    const key = dedupeKey(polish.brand, polish.name);
    if (!ownedByKey.has(key)) ownedByKey.set(key, polish.id);
  }

  const alreadyOwned = new Map<string, string>();
  const byKey = new Map<string, string[]>();

  for (const item of wishlist) {
    if (!isCountable(item)) continue;
    const key = dedupeKey(item.brand, item.name);

    const ownedId = ownedByKey.get(key);
    if (ownedId) alreadyOwned.set(item.id, ownedId);

    const existing = byKey.get(key);
    if (existing) existing.push(item.id);
    else byKey.set(key, [item.id]);
  }

  const duplicated = new Set<string>();
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) duplicated.add(id);
  }

  return { alreadyOwned, duplicated };
}

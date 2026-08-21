import type { Polish, Wear, WishlistItem } from '../../domain/types';
import type { PolishInput, WearInput, WishlistInput } from '../../domain/schema';
import { buildSeed } from './seed';
import type { Repository, Snapshot } from './types';

/**
 * In-memory repository.
 *
 * Holds everything in a JS object for the life of the tab. Reloading the page resets to
 * the seed, which is the point: it makes the UI safe to poke at destructively while it
 * is being designed, and it means no Supabase project has to exist yet.
 *
 * It is a real implementation of `Repository`, not a stub — it enforces the same rules
 * the database will (client-generated ids, soft deletes, updated_at bumps, the
 * Bought/bought_polish_id pairing). When Supabase lands, the screens do not change; only
 * the object handed to the provider does.
 *
 * It does NOT store a dedupe_key, matching 0001: the duplicate key is an expression
 * index in Postgres and a function call (domain/dedupe.ts) here.
 */

/**
 * This class serves two different roles under one implementation: the seeded demo (a
 * throwaway collection that never leaves the tab), and the local half of
 * `OfflineRepository` — which is where every row Anabel ever creates actually gets
 * stamped, since her writes go through `local.addPolish()` before syncing up. Those two
 * roles need different `user_id` values, so it is a constructor parameter rather than a
 * hardcoded constant: a real collection permanently labeled "demo-user" in its own
 * backing store would be a wrong, confusing fact baked into her data forever.
 */
const DEMO_USER_ID = 'demo-user';

function now(): string {
  return new Date().toISOString();
}

/**
 * crypto.randomUUID needs a secure context. Vite dev serves localhost, which qualifies,
 * but a phone testing over the LAN on plain http does not — and that is exactly how this
 * gets looked at on an iPhone before deploy. Fall back rather than crash.
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export class InMemoryRepository implements Repository {
  private data: Snapshot;
  private readonly userId: string;

  constructor(initial: Snapshot = buildSeed(), userId: string = DEMO_USER_ID) {
    this.data = initial;
    this.userId = userId;
  }

  async load(): Promise<Snapshot> {
    return this.clone();
  }

  // ---- Polish ------------------------------------------------------------------

  async addPolish(input: PolishInput): Promise<Polish> {
    const timestamp = now();
    const row: Polish = {
      id: newId(),
      user_id: this.userId,
      brand: input.brand,
      name: input.name,
      color: input.color,
      finish: input.finish,
      swatch_hex: input.swatch_hex,
      photo_path: input.photo_path,
      notes: input.notes,
      archived: input.archived,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };
    this.data.polish.push(row);
    return { ...row };
  }

  async updatePolish(id: string, patch: Partial<PolishInput>): Promise<Polish> {
    const row = this.require(this.data.polish, id, 'polish');
    Object.assign(row, patch, { updated_at: now() });
    return { ...row };
  }

  async deletePolish(id: string): Promise<Polish> {
    return this.setDeleted(this.data.polish, id, now(), 'polish');
  }

  async restorePolish(id: string): Promise<Polish> {
    return this.setDeleted(this.data.polish, id, null, 'polish');
  }

  // ---- Wear --------------------------------------------------------------------

  async addWear(input: WearInput): Promise<Wear> {
    const timestamp = now();
    const row: Wear = {
      id: newId(),
      user_id: this.userId,
      polish_id: input.polish_id,
      worn_on: input.worn_on,
      rating: input.rating,
      days_lasted: input.days_lasted,
      notes: input.notes,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };
    this.data.wear.push(row);
    return { ...row };
  }

  async updateWear(id: string, patch: Partial<WearInput>): Promise<Wear> {
    const row = this.require(this.data.wear, id, 'wear');
    Object.assign(row, patch, { updated_at: now() });
    return { ...row };
  }

  async deleteWear(id: string): Promise<Wear> {
    return this.setDeleted(this.data.wear, id, now(), 'wear');
  }

  async restoreWear(id: string): Promise<Wear> {
    return this.setDeleted(this.data.wear, id, null, 'wear');
  }

  // ---- Wishlist ----------------------------------------------------------------

  async addWishlistItem(input: WishlistInput): Promise<WishlistItem> {
    const timestamp = now();
    const row: WishlistItem = {
      id: newId(),
      user_id: this.userId,
      brand: input.brand,
      name: input.name,
      color: input.color,
      finish: input.finish,
      swatch_hex: input.swatch_hex,
      where_sold: input.where_sold,
      typical_price: input.typical_price,
      sale_window: input.sale_window,
      priority: input.priority,
      status: input.status,
      link: input.link,
      notes: input.notes,
      bought_polish_id: null,
      bought_on: null,
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };
    this.data.wishlist.push(row);
    return { ...row };
  }

  async updateWishlistItem(id: string, patch: Partial<WishlistInput>): Promise<WishlistItem> {
    const row = this.require(this.data.wishlist, id, 'wishlist item');
    Object.assign(row, patch, { updated_at: now() });
    return { ...row };
  }

  /**
   * "I bought it" — resolve the row instead of deleting it.
   *
   * Mirrors the wishlist_bought_link_needs_bought_status constraint in 0001: status and
   * the link are written together, never separately, so the pair cannot drift out of
   * step here and then be rejected by Postgres later.
   */
  async markWishlistItemBought(
    id: string,
    polishId: string,
    boughtOn: string,
  ): Promise<WishlistItem> {
    const row = this.require(this.data.wishlist, id, 'wishlist item');
    row.status = 'Bought';
    row.bought_polish_id = polishId;
    row.bought_on = boughtOn;
    row.updated_at = now();
    return { ...row };
  }

  async deleteWishlistItem(id: string): Promise<WishlistItem> {
    return this.setDeleted(this.data.wishlist, id, now(), 'wishlist item');
  }

  async restoreWishlistItem(id: string): Promise<WishlistItem> {
    return this.setDeleted(this.data.wishlist, id, null, 'wishlist item');
  }

  /** `message` exists only to satisfy the interface — nothing here has commits to name. */
  async replaceAll(next: Snapshot, _message: string): Promise<void> {
    this.data = {
      polish: next.polish.map((row) => ({ ...row })),
      wear: next.wear.map((row) => ({ ...row })),
      wishlist: next.wishlist.map((row) => ({ ...row })),
    };
  }

  // ---- Internals ---------------------------------------------------------------

  private require<T extends { id: string }>(rows: T[], id: string, label: string): T {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`No ${label} with id ${id}`);
    return row;
  }

  private setDeleted<T extends { id: string; deleted_at: string | null; updated_at: string }>(
    rows: T[],
    id: string,
    deletedAt: string | null,
    label: string,
  ): T {
    const row = this.require(rows, id, label);
    row.deleted_at = deletedAt;
    row.updated_at = now();
    return { ...row };
  }

  /** Hand out copies so a caller mutating what it received cannot corrupt the store. */
  private clone(): Snapshot {
    return {
      polish: this.data.polish.map((row) => ({ ...row })),
      wear: this.data.wear.map((row) => ({ ...row })),
      wishlist: this.data.wishlist.map((row) => ({ ...row })),
    };
  }
}

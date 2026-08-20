import type { IsoDate, Polish, Wear, WishlistItem } from '../../domain/types';
import type { PolishInput, WearInput, WishlistInput } from '../../domain/schema';

/**
 * The repository boundary.
 *
 * Everything above this line (features/, ui/) knows only this interface. Supabase is
 * one implementation of it; `memory.ts` is another. That is what lets the whole UI be
 * built and iterated on before a Supabase project exists.
 *
 * Every method is async even though the in-memory version resolves immediately. The
 * alternative — a sync interface now, rewritten when the network arrives — would mean
 * touching every screen later. Awaiting a resolved promise costs nothing.
 *
 * Mutations return the affected row rather than void, because the caller needs the
 * server-assigned `updated_at` to update its cache.
 */

export interface Snapshot {
  polish: Polish[];
  wear: Wear[];
  wishlist: WishlistItem[];
}

export interface Repository {
  /** Everything, including soft-deleted rows — the UI filters, so Undo stays possible. */
  load(): Promise<Snapshot>;

  addPolish(input: PolishInput): Promise<Polish>;
  updatePolish(id: string, patch: Partial<PolishInput>): Promise<Polish>;
  /** Soft delete: stamps deleted_at. Nothing is ever hard-deleted. */
  deletePolish(id: string): Promise<Polish>;
  restorePolish(id: string): Promise<Polish>;

  addWear(input: WearInput): Promise<Wear>;
  updateWear(id: string, patch: Partial<WearInput>): Promise<Wear>;
  deleteWear(id: string): Promise<Wear>;
  restoreWear(id: string): Promise<Wear>;

  addWishlistItem(input: WishlistInput): Promise<WishlistItem>;
  updateWishlistItem(id: string, patch: Partial<WishlistInput>): Promise<WishlistItem>;
  deleteWishlistItem(id: string): Promise<WishlistItem>;
  restoreWishlistItem(id: string): Promise<WishlistItem>;
  /**
   * Resolve a wishlist row as bought, pointing at the polish it became. Separate from
   * `updateWishlistItem` because status and the link have to move together — the
   * database has a CHECK saying so.
   */
  markWishlistItemBought(
    id: string,
    polishId: string,
    boughtOn: IsoDate,
  ): Promise<WishlistItem>;
}

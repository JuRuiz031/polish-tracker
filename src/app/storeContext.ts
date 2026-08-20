import { createContext, useContext } from 'react';
import type { WishlistFlags } from '../domain/dedupe';
import type { CollectionSummary } from '../domain/derive';
import type { Polish, PolishWithStats, Wear, WishlistItem } from '../domain/types';
import type { PolishInput, WearInput, WishlistInput } from '../domain/schema';

/**
 * The store's shape and its accessor, kept apart from the provider component so that
 * `store.tsx` exports nothing but a component and Fast Refresh keeps working.
 */

export interface Toast {
  message: string;
  /** Present only when the action is reversible. */
  undo?: () => void;
}

export interface StoreValue {
  ready: boolean;
  /** Non-null when the collection could not be loaded at all. */
  error: Error | null;

  /** Live, non-deleted polishes with derived stats. What every list renders. */
  polishes: PolishWithStats[];
  /** Includes soft-deleted and archived rows. For export and duplicate counting. */
  allPolishes: Polish[];
  wears: Wear[];
  wishlist: WishlistItem[];

  duplicateIds: Set<string>;
  wishlistFlags: WishlistFlags;
  summary: CollectionSummary;

  addPolish: (input: PolishInput) => Promise<Polish>;
  editPolish: (id: string, patch: Partial<PolishInput>) => Promise<void>;
  removePolish: (id: string) => Promise<void>;

  addWear: (input: WearInput) => Promise<Wear>;
  editWear: (id: string, patch: Partial<WearInput>) => Promise<void>;
  removeWear: (id: string) => Promise<void>;

  addWishlistItem: (input: WishlistInput) => Promise<WishlistItem>;
  editWishlistItem: (id: string, patch: Partial<WishlistInput>) => Promise<void>;
  removeWishlistItem: (id: string) => Promise<void>;
  /** "I bought it": copy into the collection and resolve the wishlist row as Bought. */
  buyWishlistItem: (item: WishlistItem) => Promise<void>;

  toast: Toast | null;
  showToast: (toast: Toast) => void;
  dismissToast: () => void;
}

export const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}

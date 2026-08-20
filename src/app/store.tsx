import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { findDuplicates, flagWishlist } from '../domain/dedupe';
import { summarise, withStats } from '../domain/derive';
import { InMemoryRepository } from '../data/repositories/memory';
import type { Repository, Snapshot } from '../data/repositories/types';
import { StoreContext, type StoreValue, type Toast } from './storeContext';

/**
 * The one place screens get data from.
 *
 * Everything derived — stats, duplicate flags, the summary — is computed here with
 * useMemo from the raw rows, rather than stored. That is the same rule domain/derive.ts
 * enforces at the data level, carried up into React: there is exactly one source of
 * truth (the rows) and every number on screen is a function of it.
 *
 * Deletes go through `remove*`, which returns an undo action wired into a toast. No
 * confirm dialogs anywhere — soft deletes make undo cheap, and a confirm dialog is a
 * worse experience than a five-second undo for someone with wet nails.
 */

const EMPTY: Snapshot = { polish: [], wear: [], wishlist: [] };

export function StoreProvider({
  children,
  repository,
}: {
  children: ReactNode;
  /** Swap this for the Supabase implementation and nothing above it changes. */
  repository?: Repository;
}) {
  // Held in a ref so a re-render never constructs a second repository and silently
  // resets the seed data mid-session.
  const repoRef = useRef<Repository>(repository ?? new InMemoryRepository());
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    repoRef.current.load().then((loaded) => {
      if (cancelled) return;
      setSnapshot(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setSnapshot(await repoRef.current.load());
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((next: Toast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    // Long enough to read and act on without being in the way. Undo disappearing is
    // safe: the row is only soft-deleted, so it is recoverable from the archive later.
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  /** Delete + "Undo" toast, shared by all three tables. */
  const removeWithUndo = useCallback(
    async (
      remove: () => Promise<unknown>,
      restore: () => Promise<unknown>,
      message: string,
    ) => {
      await remove();
      await refresh();
      showToast({
        message,
        undo: () => {
          restore()
            .then(refresh)
            .then(() => showToast({ message: 'Restored.' }));
        },
      });
    },
    [refresh, showToast],
  );

  const value = useMemo<StoreValue>(() => {
    const repo = repoRef.current;

    const livePolishes = snapshot.polish.filter((row) => row.deleted_at === null);
    const polishes = withStats(livePolishes, snapshot.wear);

    return {
      ready,
      polishes,
      allPolishes: snapshot.polish,
      wears: snapshot.wear,
      wishlist: snapshot.wishlist.filter((row) => row.deleted_at === null),

      duplicateIds: findDuplicates(snapshot.polish),
      wishlistFlags: flagWishlist(snapshot.wishlist, snapshot.polish),
      summary: summarise(polishes, snapshot.wear),

      addPolish: async (input) => {
        const row = await repo.addPolish(input);
        await refresh();
        return row;
      },
      editPolish: async (id, patch) => {
        await repo.updatePolish(id, patch);
        await refresh();
      },
      removePolish: (id) => {
        const row = snapshot.polish.find((candidate) => candidate.id === id);
        return removeWithUndo(
          () => repo.deletePolish(id),
          () => repo.restorePolish(id),
          row ? `Deleted ${row.brand} ${row.name}.` : 'Deleted.',
        );
      },

      addWear: async (input) => {
        const row = await repo.addWear(input);
        await refresh();
        return row;
      },
      editWear: async (id, patch) => {
        await repo.updateWear(id, patch);
        await refresh();
      },
      removeWear: (id) =>
        removeWithUndo(
          () => repo.deleteWear(id),
          () => repo.restoreWear(id),
          'Manicure removed from the log.',
        ),

      addWishlistItem: async (input) => {
        const row = await repo.addWishlistItem(input);
        await refresh();
        return row;
      },
      editWishlistItem: async (id, patch) => {
        await repo.updateWishlistItem(id, patch);
        await refresh();
      },
      removeWishlistItem: (id) =>
        removeWithUndo(
          () => repo.deleteWishlistItem(id),
          () => repo.restoreWishlistItem(id),
          'Removed from the wishlist.',
        ),

      toast,
      showToast,
      dismissToast,
    };
  }, [snapshot, ready, toast, refresh, removeWithUndo, showToast, dismissToast]);

  return <StoreContext value={value}>{children}</StoreContext>;
}


import { get, set } from 'idb-keyval';
import { mergeSnapshots, hasLocalChanges } from '../../domain/merge';
import type { IsoDate, Polish, Wear, WishlistItem } from '../../domain/types';
import type { PolishInput, WearInput, WishlistInput } from '../../domain/schema';
import { GitHubApiError } from '../github/api';
import { InMemoryRepository } from './memory';
import type { Repository, Snapshot } from './types';

/**
 * Offline-first storage.
 *
 * Every change is written to a local copy first and answered immediately, then pushed to
 * the repository in the background. Nothing she does waits on the network, and nothing
 * she does is lost when the network is not there — which for a phone-first app is the
 * normal case, not the edge case.
 *
 * The alternative — write straight through and show a spinner — fails badly in exactly
 * the situation this app is for: standing at a shelf with one bar of signal, deciding
 * what to wear. A save that fails there is a save she has to remember to redo.
 *
 * Reconciliation is row-level last-write-wins (domain/merge.ts), so an edit here and an
 * edit there both survive unless they are literally the same row.
 */

const SNAPSHOT_KEY = 'polish:snapshot';

export type SyncStatus =
  /** Local and remote agree. */
  | 'synced'
  /** A push is in flight. */
  | 'syncing'
  /** Unreachable. Changes are held locally and will go up when it returns. */
  | 'offline'
  /** Refused rather than unreachable — a revoked key. Retrying will not help. */
  | 'error';

/** What the offline layer needs from the thing it syncs to. Not the full Repository. */
export interface SyncTarget {
  load(): Promise<Snapshot>;
  replaceAll(snapshot: Snapshot, message: string): Promise<void>;
}

export interface OfflineState {
  status: SyncStatus;
  /** True when there are local changes the repository has not accepted yet. */
  pending: boolean;
  lastError: string | null;
}

function emptySnapshot(): Snapshot {
  return { polish: [], wear: [], wishlist: [] };
}

async function readCache(): Promise<Snapshot | null> {
  try {
    return (await get<Snapshot>(SNAPSHOT_KEY)) ?? null;
  } catch {
    return null;
  }
}

async function writeCache(snapshot: Snapshot): Promise<void> {
  try {
    await set(SNAPSHOT_KEY, snapshot);
  } catch {
    // A full or blocked IndexedDB must not fail the save she just made. The change is
    // still in memory and still queued for the repository; it just will not survive a
    // reload, which is strictly better than refusing to accept it at all.
  }
}

export class OfflineRepository implements Repository {
  private readonly remote: SyncTarget;
  private local: InMemoryRepository;
  private snapshot: Snapshot;
  private priming: Promise<void> | null = null;
  private state: OfflineState = { status: 'synced', pending: false, lastError: null };
  private listeners = new Set<(state: OfflineState) => void>();
  /** Syncs are chained rather than concurrent — two at once would race on the SHA. */
  private queue: Promise<void> = Promise.resolve();

  constructor(remote: SyncTarget, cached: Snapshot = emptySnapshot()) {
    this.remote = remote;
    this.snapshot = cached;
    this.local = new InMemoryRepository(cached);
  }

  /** Build one with whatever this device already had cached. */
  static async create(remote: SyncTarget): Promise<OfflineRepository> {
    return new OfflineRepository(remote, (await readCache()) ?? emptySnapshot());
  }

  subscribe(listener: (state: OfflineState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => void this.listeners.delete(listener);
  }

  getState(): OfflineState {
    return this.state;
  }

  private setState(patch: Partial<OfflineState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  /**
   * Reads are answered from the local copy, always.
   *
   * The first call additionally waits for a sync, because on a fresh device the local
   * copy is empty and returning it would look exactly like an empty collection.
   *
   * The priming sync is held as a PROMISE rather than a boolean, and that distinction is
   * load-bearing. A flag set before the sync resolves means a second `load()` arriving
   * while the first is still in flight takes the fast path and returns the empty local
   * copy — so the caller that happens to finish second renders an empty collection over
   * the real one. React's StrictMode double-invokes effects and reproduces this every
   * time in development, but any two overlapping reads would do it. Sharing one promise
   * makes every concurrent caller wait for the same answer.
   */
  async load(): Promise<Snapshot> {
    if (!this.priming) {
      this.priming = this.sync('Sync').catch((cause: unknown) => {
        // Cleared so a later attempt can try again rather than replaying this failure
        // forever, but still rethrown so whoever is waiting now hears about it.
        this.priming = null;
        throw cause;
      });
    }
    await this.priming;
    return this.local.load();
  }

  /**
   * Force a reconciliation. Used on reconnect and when she asks.
   *
   * The chain and the returned promise are deliberately different objects. The chain
   * must swallow failures or one dropped connection would poison every later sync;
   * the caller must NOT have them swallowed, or an awaited first load could not tell
   * "your key was refused" from "everything is fine and your collection is empty".
   */
  async sync(message = 'Sync'): Promise<void> {
    const run = this.queue.then(() => this.runSync(message));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runSync(message: string): Promise<void> {
    this.setState({ status: 'syncing' });
    try {
      const remote = await this.remote.load();
      // Read local AFTER the round trip, so a change she made while it was in flight is
      // included rather than silently dropped.
      const local = await this.local.load();
      const merged = mergeSnapshots(local, remote) as Snapshot;

      if (hasLocalChanges(local, remote)) {
        await this.remote.replaceAll(merged, message);
      }

      // Merge into the current local state rather than replacing it, for the same
      // reason: a mutation may have landed during the push above. Merging is idempotent,
      // so doing it twice costs nothing and losing a write costs everything.
      const latest = await this.local.load();
      const settled = mergeSnapshots(latest, merged) as Snapshot;
      this.adopt(settled);
      await writeCache(settled);
      this.setState({ status: 'synced', pending: false, lastError: null });
    } catch (cause) {
      const authFailure =
        cause instanceof GitHubApiError && (cause.status === 401 || cause.status === 403);
      this.setState({
        // A refused key is not the same as a missing network: one is worth telling her
        // about, the other resolves itself when she walks back into signal.
        status: authFailure ? 'error' : 'offline',
        pending: true,
        lastError: cause instanceof Error ? cause.message : String(cause),
      });
      // Only the very first sync may fail loudly, and only when there is nothing cached
      // to fall back on — otherwise she is looking at her collection and a failed
      // background push is not something to interrupt her with.
      if (this.isEmpty() && authFailure) throw cause;
    }
  }

  private isEmpty(): boolean {
    return (
      this.snapshot.polish.length === 0 &&
      this.snapshot.wear.length === 0 &&
      this.snapshot.wishlist.length === 0
    );
  }

  private adopt(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.local = new InMemoryRepository(snapshot);
  }

  /**
   * Apply locally, answer immediately, push in the background.
   *
   * The push is deliberately not awaited. Awaiting it would put the network back on the
   * path of every tap — the exact thing this class exists to avoid.
   */
  private async write<T>(operation: () => Promise<T>, message: string): Promise<T> {
    const result = await operation();
    this.snapshot = await this.local.load();
    this.setState({ pending: true });
    await writeCache(this.snapshot);
    // Explicitly swallowed: `sync()` now propagates failures to its caller, and a
    // background push that fails is already recorded in `state`. Leaving it unhandled
    // would surface as an unhandled rejection for something that is not an error here.
    void this.sync(message).catch(() => undefined);
    return result;
  }

  // ---- Repository ----------------------------------------------------------------

  addPolish(input: PolishInput): Promise<Polish> {
    return this.write(() => this.local.addPolish(input), `Add ${input.brand} ${input.name}`);
  }

  updatePolish(id: string, patch: Partial<PolishInput>): Promise<Polish> {
    return this.write(() => this.local.updatePolish(id, patch), 'Update polish');
  }

  deletePolish(id: string): Promise<Polish> {
    return this.write(() => this.local.deletePolish(id), 'Delete polish');
  }

  restorePolish(id: string): Promise<Polish> {
    return this.write(() => this.local.restorePolish(id), 'Restore polish');
  }

  addWear(input: WearInput): Promise<Wear> {
    return this.write(() => this.local.addWear(input), `Log manicure on ${input.worn_on}`);
  }

  updateWear(id: string, patch: Partial<WearInput>): Promise<Wear> {
    return this.write(() => this.local.updateWear(id, patch), 'Update manicure');
  }

  deleteWear(id: string): Promise<Wear> {
    return this.write(() => this.local.deleteWear(id), 'Delete manicure');
  }

  restoreWear(id: string): Promise<Wear> {
    return this.write(() => this.local.restoreWear(id), 'Restore manicure');
  }

  addWishlistItem(input: WishlistInput): Promise<WishlistItem> {
    return this.write(
      () => this.local.addWishlistItem(input),
      `Wishlist ${input.brand} ${input.name}`,
    );
  }

  updateWishlistItem(id: string, patch: Partial<WishlistInput>): Promise<WishlistItem> {
    return this.write(() => this.local.updateWishlistItem(id, patch), 'Update wishlist item');
  }

  deleteWishlistItem(id: string): Promise<WishlistItem> {
    return this.write(() => this.local.deleteWishlistItem(id), 'Remove from wishlist');
  }

  restoreWishlistItem(id: string): Promise<WishlistItem> {
    return this.write(() => this.local.restoreWishlistItem(id), 'Restore wishlist item');
  }

  markWishlistItemBought(id: string, polishId: string, boughtOn: IsoDate): Promise<WishlistItem> {
    return this.write(
      () => this.local.markWishlistItemBought(id, polishId, boughtOn),
      'Bought a wishlist item',
    );
  }
}

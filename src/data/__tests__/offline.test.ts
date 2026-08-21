import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (k: string) => store.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  del: vi.fn(async (k: string) => void store.delete(k)),
}));

const { OfflineRepository } = await import('../repositories/offline');
const { GitHubApiError } = await import('../github/api');
type Snapshot = import('../repositories/types').Snapshot;

/**
 * The offline layer.
 *
 * These tests are about the promise it makes: a change she makes without signal is
 * answered immediately, survives a reload, and reaches the repository later — and a
 * change made elsewhere in the meantime is not trampled on the way.
 */

const POLISH = {
  brand: 'OPI', name: 'Big Apple Red', color: 'Red', finish: 'Cream',
  swatch_hex: '#C8102E', photo_path: null, notes: null, archived: false,
} as const;

function empty(): Snapshot {
  return { polish: [], wear: [], wishlist: [] };
}

/** A stand-in repository whose reachability the test controls. */
class FakeRemote {
  snapshot: Snapshot = empty();
  reachable = true;
  authorised = true;
  pushes = 0;

  async load(): Promise<Snapshot> {
    if (!this.authorised) throw new GitHubApiError('Bad credentials', 401);
    if (!this.reachable) throw new Error('network down');
    return structuredClone(this.snapshot);
  }

  async replaceAll(next: Snapshot): Promise<void> {
    if (!this.authorised) throw new GitHubApiError('Bad credentials', 401);
    if (!this.reachable) throw new Error('network down');
    this.snapshot = structuredClone(next);
    this.pushes += 1;
  }
}

/** Let the fire-and-forget background sync finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => store.clear());

describe('working offline', () => {
  it('accepts a save with no network and does not throw', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    await repo.load();

    remote.reachable = false;
    const added = await repo.addPolish({ ...POLISH });
    await settle();

    expect(added.name).toBe('Big Apple Red');
    expect((await repo.load()).polish).toHaveLength(1); // visible immediately
    expect(repo.getState().status).toBe('offline');
    expect(repo.getState().pending).toBe(true);
  });

  it('reads come from the local copy while offline', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    await repo.load();
    await repo.addPolish({ ...POLISH });
    await settle();

    remote.reachable = false;
    // No throw, and her collection is still there.
    expect((await repo.load()).polish).toHaveLength(1);
  });

  it('an offline change survives a reload of the app', async () => {
    const remote = new FakeRemote();
    const first = new OfflineRepository(remote, empty());
    await first.load();
    remote.reachable = false;
    await first.addPolish({ ...POLISH });
    await settle();

    // New instance, as if the tab were closed and reopened, still offline.
    const second = await OfflineRepository.create(remote);
    expect((await second.load()).polish).toHaveLength(1);
  });

  it('pushes everything once the network returns', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    await repo.load();

    remote.reachable = false;
    await repo.addPolish({ ...POLISH, name: 'One' });
    await repo.addPolish({ ...POLISH, name: 'Two' });
    await settle();
    expect(remote.snapshot.polish).toHaveLength(0); // nothing got through

    remote.reachable = true;
    await repo.sync();

    expect(remote.snapshot.polish.map((p) => p.name).sort()).toEqual(['One', 'Two']);
    expect(repo.getState()).toMatchObject({ status: 'synced', pending: false });
  });
});

describe('restoring a backup (replaceAll)', () => {
  it('is visible locally immediately, same as any other write', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    await repo.load();

    const restored: Snapshot = {
      polish: [{ id: 'p1', user_id: 'u', ...POLISH, created_at: 't', updated_at: 't', deleted_at: null }],
      wear: [],
      wishlist: [],
    };
    await repo.replaceAll(restored, 'Import backup');

    expect((await repo.load()).polish).toHaveLength(1);
  });

  it('pushes the restored snapshot to the remote in the background', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    await repo.load();

    const restored: Snapshot = {
      polish: [{ id: 'p1', user_id: 'u', ...POLISH, created_at: 't', updated_at: 't', deleted_at: null }],
      wear: [],
      wishlist: [],
    };
    await repo.replaceAll(restored, 'Import backup');
    await settle();

    expect(remote.snapshot.polish).toHaveLength(1);
    expect(repo.getState()).toMatchObject({ status: 'synced', pending: false });
  });

  it('does not throw when restoring with no network — it queues like everything else', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    await repo.load();

    remote.reachable = false;
    const restored: Snapshot = {
      polish: [{ id: 'p1', user_id: 'u', ...POLISH, created_at: 't', updated_at: 't', deleted_at: null }],
      wear: [],
      wishlist: [],
    };
    await repo.replaceAll(restored, 'Import backup');
    await settle();

    expect((await repo.load()).polish).toHaveLength(1); // safe on this device
    expect(repo.getState().status).toBe('offline');
  });
});

describe('reconciling with the other device', () => {
  it('a change made elsewhere while offline is not trampled', async () => {
    const remote = new FakeRemote();
    const phone = new OfflineRepository(remote, empty());
    await phone.load();

    remote.reachable = false;
    await phone.addPolish({ ...POLISH, name: 'From Phone' });
    await settle();

    // The laptop wrote while the phone had no signal.
    remote.snapshot = {
      ...empty(),
      polish: [
        {
          id: 'laptop-row', user_id: 'owner', brand: 'Zoya', name: 'From Laptop',
          color: 'Blue', finish: 'Glitter', swatch_hex: null, photo_path: null,
          notes: null, archived: false, created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
        },
      ],
    } as Snapshot;

    remote.reachable = true;
    await phone.sync();

    expect(remote.snapshot.polish.map((p) => p.name).sort()).toEqual([
      'From Laptop',
      'From Phone',
    ]);
  });

  it('a delete made offline is not resurrected by the sync', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    await repo.load();
    const row = await repo.addPolish({ ...POLISH });
    await settle();
    expect(remote.snapshot.polish).toHaveLength(1);

    remote.reachable = false;
    await repo.deletePolish(row.id);
    await settle();

    remote.reachable = true;
    await repo.sync();

    expect(remote.snapshot.polish[0].deleted_at).not.toBeNull();
  });

  it('pulls a remote-only change down without pushing anything', async () => {
    const remote = new FakeRemote();
    remote.snapshot = {
      ...empty(),
      polish: [
        {
          id: 'only-remote', user_id: 'owner', brand: 'Essie', name: 'Wicked',
          color: 'Red', finish: 'Cream', swatch_hex: null, photo_path: null,
          notes: null, archived: false, created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
        },
      ],
    } as Snapshot;

    const repo = new OfflineRepository(remote, empty());
    const loaded = await repo.load();

    expect(loaded.polish).toHaveLength(1);
    expect(remote.pushes).toBe(0); // nothing local to send
  });
});

describe('a revoked key is not the same as no signal', () => {
  it('reports error, not offline', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    await repo.load();
    await repo.addPolish({ ...POLISH });
    await settle();

    remote.authorised = false;
    await repo.sync();

    expect(repo.getState().status).toBe('error');
    expect(repo.getState().pending).toBe(true);
  });

  it('throws on first load only when there is nothing cached to show', async () => {
    const remote = new FakeRemote();
    remote.authorised = false;
    await expect(new OfflineRepository(remote, empty()).load()).rejects.toThrow(/credentials/i);
  });

  it('does NOT throw when a cached collection exists — she keeps seeing her data', async () => {
    const cached: Snapshot = {
      ...empty(),
      polish: [
        {
          id: 'cached', user_id: 'owner', brand: 'OPI', name: 'Cached',
          color: 'Red', finish: 'Cream', swatch_hex: null, photo_path: null,
          notes: null, archived: false, created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
        },
      ],
    } as Snapshot;

    const remote = new FakeRemote();
    remote.authorised = false;
    const repo = new OfflineRepository(remote, cached);

    const loaded = await repo.load();
    expect(loaded.polish).toHaveLength(1);
    expect(repo.getState().status).toBe('error');
  });
});

describe('concurrent first loads', () => {
  it('two overlapping loads both get the collection, not an empty one', async () => {
    // The bug this pins: priming used to be a boolean set BEFORE the first sync
    // resolved, so a second load() arriving mid-flight took the fast path and returned
    // the still-empty local copy. Whichever caller finished second won, and rendered an
    // empty collection over the real one. React StrictMode double-invokes effects and
    // reproduced it on every single mount.
    const remote = new FakeRemote();
    remote.snapshot = {
      ...empty(),
      polish: [
        {
          id: 'r1', user_id: 'owner', brand: 'OPI', name: 'Already There',
          color: 'Red', finish: 'Cream', swatch_hex: null, photo_path: null,
          notes: null, archived: false, created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
        },
      ],
    } as Snapshot;

    const repo = new OfflineRepository(remote, empty());
    const [first, second] = await Promise.all([repo.load(), repo.load()]);

    expect(first.polish).toHaveLength(1);
    expect(second.polish).toHaveLength(1);
  });

  it('a failed first load can be retried rather than failing forever', async () => {
    const remote = new FakeRemote();
    remote.authorised = false;
    const repo = new OfflineRepository(remote, empty());

    await expect(repo.load()).rejects.toThrow(/credentials/i);

    // A new key works: the next load must actually try again, not replay the rejection.
    remote.authorised = true;
    await expect(repo.load()).resolves.toBeDefined();
  });
});

describe('status reporting', () => {
  it('notifies subscribers as it moves between states', async () => {
    const remote = new FakeRemote();
    const repo = new OfflineRepository(remote, empty());
    const seen: string[] = [];
    repo.subscribe((s) => seen.push(s.status));

    await repo.load();
    remote.reachable = false;
    await repo.addPolish({ ...POLISH });
    await settle();

    expect(seen).toContain('syncing');
    expect(seen).toContain('offline');
    expect(seen[seen.length - 1]).toBe('offline');
  });
});

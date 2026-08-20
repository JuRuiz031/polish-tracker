import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The stored connection.
 *
 * idb-keyval is mocked with a plain Map: these tests are about what gets written and
 * read back, not about IndexedDB, and the node test environment has no IndexedDB to
 * exercise anyway.
 */
const store = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => void store.set(key, value)),
  del: vi.fn(async (key: string) => void store.delete(key)),
}));

const {
  clearConnection,
  connectionDefaults,
  hasEverConnected,
  loadConnection,
  looksLikeToken,
  markConnected,
  saveConnection,
  toTarget,
} = await import('../github/config');

beforeEach(() => store.clear());

describe('round trip', () => {
  it('a saved connection survives and comes back whole', async () => {
    const connection = { ...connectionDefaults(), token: 'github_pat_' + 'a'.repeat(40) };
    await saveConnection(connection);
    expect(await loadConnection()).toEqual(connection);
  });

  it('nothing stored means no connection, not a half-built one', async () => {
    expect(await loadConnection()).toBeNull();
  });

  it('a stored entry with no token counts as not connected', async () => {
    // Guards against a partially-written record putting the app into "connected" mode
    // with nothing to authenticate with.
    store.set('polish:github-connection', { ...connectionDefaults(), token: '' });
    expect(await loadConnection()).toBeNull();
  });

  it('fills in fields added after the connection was saved', async () => {
    // A connection stored by an older build must not load as an object missing `path`,
    // which would send writes to `undefined`.
    store.set('polish:github-connection', { token: 'tok', owner: 'me', repo: 'polish-data' });
    const loaded = await loadConnection();
    expect(loaded?.path).toBe(connectionDefaults().path);
    expect(loaded?.branch).toBe(connectionDefaults().branch);
    expect(loaded?.owner).toBe('me');
  });

  it('clearing removes it', async () => {
    await saveConnection({ ...connectionDefaults(), token: 'tok' });
    await clearConnection();
    expect(await loadConnection()).toBeNull();
  });
});

describe('the has-ever-connected flag', () => {
  it('is false until a connection actually succeeds', async () => {
    expect(await hasEverConnected()).toBe(false);
  });

  it('survives the connection being cleared', async () => {
    // The whole point. A revoked token gets cleared, but the device must still remember
    // her collection exists — otherwise it would fall back to showing demo data, which
    // reads as "your polishes were replaced by someone else's".
    await saveConnection({ ...connectionDefaults(), token: 'tok' });
    await markConnected();
    await clearConnection();

    expect(await loadConnection()).toBeNull();
    expect(await hasEverConnected()).toBe(true);
  });
});

describe('token sanity check', () => {
  it('accepts a realistic token', () => {
    expect(looksLikeToken('github_pat_11ABCDEFG0123456789_abcdefghijklmnop')).toBe(true);
  });

  it('does not hard-code a prefix, since GitHub keeps adding them', () => {
    expect(looksLikeToken('ghp_' + 'x'.repeat(36))).toBe(true);
    expect(looksLikeToken('x'.repeat(40))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['has a space', 'github_pat_11ABCDEFG 0123456789abcdefgh'],
    ['a pasted URL', 'https://github.com/settings/tokens/12345678901234567890'],
  ])('rejects %s', (_label, value) => {
    expect(looksLikeToken(value)).toBe(false);
  });
});

describe('toTarget', () => {
  it('maps a connection onto what the API client expects', () => {
    const connection = { ...connectionDefaults(), token: 'tok', owner: 'me', repo: 'data' };
    expect(toTarget(connection)).toEqual({
      owner: 'me',
      repo: 'data',
      path: connectionDefaults().path,
      branch: connectionDefaults().branch,
      token: 'tok',
    });
  });
});

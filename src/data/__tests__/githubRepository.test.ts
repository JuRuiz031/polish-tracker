import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubRepository, parseSnapshot, serialise } from '../repositories/github';
import { APP_IDENTITY, encodeBase64, decodeBase64, GitHubApiError } from '../github/api';
import type { GitHubTarget } from '../github/api';
import type { Snapshot } from '../repositories/types';

/**
 * The GitHub-backed repository.
 *
 * The tests that matter here are not the happy path — they are the ones about not
 * destroying her collection: a file that fails to parse must stop the app rather than
 * be treated as "no data", and a write that loses a race must merge rather than
 * clobber.
 */

const TARGET: GitHubTarget = {
  owner: 'someone',
  repo: 'polish-data',
  path: 'data/collection.json',
  branch: 'main',
  token: 'tok',
};

const EMPTY: Snapshot = { polish: [], wear: [], wishlist: [] };

function fileBody(text: string, sha = 'sha1') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: encodeBase64(text), sha, size: text.length }),
  } as unknown as Response;
}

function notFound() {
  return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) } as unknown as Response;
}

function written(sha: string) {
  return { ok: true, status: 200, json: async () => ({ content: { sha } }) } as unknown as Response;
}

function conflict() {
  return {
    ok: false,
    status: 409,
    json: async () => ({ message: 'is at abc but expected def' }),
  } as unknown as Response;
}

const POLISH_INPUT = {
  brand: 'OPI',
  name: 'Big Apple Red',
  color: 'Red',
  finish: 'Cream',
  swatch_hex: '#C8102E',
  photo_path: null,
  notes: null,
  archived: false,
} as const;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('base64 round trip', () => {
  it('survives the characters she will actually type', () => {
    // btoa() alone throws on every one of these.
    const text = 'Malaga Wine — “the good one” · café · 💅 · naïve';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('handles a payload large enough to break a spread-argument encoder', () => {
    const text = JSON.stringify({ notes: 'é'.repeat(200_000) });
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('tolerates the line breaks GitHub puts in its base64', () => {
    const raw = encodeBase64('hello world');
    const wrapped = `${raw.slice(0, 4)}\n${raw.slice(4)}\n`;
    expect(decodeBase64(wrapped)).toBe('hello world');
  });
});

describe('parseSnapshot refuses rather than losing data', () => {
  it('throws on malformed JSON instead of returning an empty collection', () => {
    // If this returned {} instead, the next write would commit an empty file over
    // everything she owns.
    expect(() => parseSnapshot('{ not json')).toThrow(/not valid JSON/i);
  });

  it('throws when the shape is wrong', () => {
    expect(() => parseSnapshot(JSON.stringify({ version: 1 }))).toThrow(
      /does not match the expected format/i,
    );
  });

  it('names the offending field so it can be fixed by hand', () => {
    const bad = JSON.parse(serialise(EMPTY));
    bad.polish = [{ id: 'x' }];
    expect(() => parseSnapshot(JSON.stringify(bad))).toThrow(/polish/);
  });

  it('accepts what serialise produces', () => {
    expect(parseSnapshot(serialise(EMPTY))).toEqual(EMPTY);
  });

  it('accepts a legacy file that still carries dedupe_key, and drops it', () => {
    const legacy = JSON.parse(serialise(EMPTY));
    legacy.polish = [
      {
        id: 'p1', user_id: 'owner', brand: 'OPI', name: 'Big Apple Red',
        color: 'Red', finish: 'Cream', swatch_hex: '#C8102E', photo_path: null,
        notes: null, archived: false, dedupe_key: 'opi - big apple red',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        deleted_at: null,
      },
    ];
    const parsed = parseSnapshot(JSON.stringify(legacy));
    expect(parsed.polish).toHaveLength(1);
    expect(parsed.polish[0]).not.toHaveProperty('dedupe_key');
  });
});

describe('load', () => {
  it('treats a missing file as a new, empty collection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound()));
    const repo = new GitHubRepository(TARGET);
    await expect(repo.load()).resolves.toEqual(EMPTY);
  });

  it('refuses to load a corrupt file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fileBody('{ broken')));
    await expect(new GitHubRepository(TARGET).load()).rejects.toThrow(/not valid JSON/i);
  });

  /**
   * The Contents API only inlines `content` below 1MB. A collection this size is well
   * past what she will realistically log in a lifetime (projected: ~2.2MB after 20
   * years at 300 manicures/year — see CLAUDE.md's storage-growth note), but it is
   * exactly the file size that would otherwise come back with an empty `content` and
   * silently load as empty, so the size chosen here is deliberately past that real-world
   * ceiling rather than just past 1MB.
   */
  it('falls back to the blob endpoint for a file too large to inline', async () => {
    const big: Snapshot = {
      polish: Array.from({ length: 700 }, (_, i) => ({
        id: `p${i}`, user_id: 'owner', brand: 'OPI', name: `Shade ${i}`, color: 'Red',
        finish: 'Cream', swatch_hex: '#C8102E', photo_path: null, notes: null,
        archived: false, created_at: 't', updated_at: 't', deleted_at: null,
      })),
      wear: Array.from({ length: 8000 }, (_, i) => ({
        id: `w${i}`, user_id: 'owner', polish_id: `p${i % 700}`, worn_on: '2026-01-01',
        rating: 4, days_lasted: 6, notes: null, created_at: 't', updated_at: 't', deleted_at: null,
      })),
      wishlist: [],
    };
    const text = serialise(big);
    expect(Buffer.byteLength(text)).toBeGreaterThan(2 * 1024 * 1024); // comfortably past 1MB

    const contentsResponse = {
      ok: true, status: 200,
      json: async () => ({ content: '', sha: 'bigsha', size: Buffer.byteLength(text) }),
    } as unknown as Response;
    const blobResponse = {
      ok: true, status: 200,
      json: async () => ({ content: encodeBase64(text), encoding: 'base64' }),
    } as unknown as Response;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(contentsResponse)
      .mockResolvedValueOnce(blobResponse);
    vi.stubGlobal('fetch', fetchMock);

    const loaded = await new GitHubRepository(TARGET).load();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/git/blobs/bigsha');
    expect(loaded.polish).toHaveLength(700);
    expect(loaded.wear).toHaveLength(8000);
  });
});

describe('writing', () => {
  it('creates the file on the first save and sends no sha', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(written('sha-new'));
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    await repo.addPolish({ ...POLISH_INPUT });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).not.toHaveProperty('sha');
    expect(body.branch).toBe('main');
    expect(body.message).toBe('Add OPI Big Apple Red');
  });

  it('sends the sha it read, so a stale write is rejected by GitHub', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fileBody(serialise(EMPTY), 'sha-read'))
      .mockResolvedValueOnce(written('sha-2'));
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    await repo.addPolish({ ...POLISH_INPUT });

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).sha).toBe('sha-read');
  });

  it('writes a file that parses back to what was written', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(written('sha-new'));
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    const added = await repo.addPolish({ ...POLISH_INPUT });

    const sent = decodeBase64(JSON.parse(fetchMock.mock.calls[1][1].body).content);
    const parsed = parseSnapshot(sent);
    expect(parsed.polish).toHaveLength(1);
    expect(parsed.polish[0].id).toBe(added.id);
    expect(parsed.polish[0].name).toBe('Big Apple Red');
  });
});

describe('conflict handling — the two-device case', () => {
  it('re-reads and merges rather than overwriting the other device', async () => {
    // The other device added a polish between our read and our write.
    const theirs = JSON.parse(serialise(EMPTY));
    theirs.polish = [
      {
        id: 'theirs', user_id: 'owner', brand: 'Zoya', name: 'Storm',
        color: 'Blue', finish: 'Glitter', swatch_hex: '#1C2A4A', photo_path: null,
        notes: null, archived: false,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        deleted_at: null,
      },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fileBody(serialise(EMPTY), 'sha-old')) // initial load
      .mockResolvedValueOnce(conflict())                            // our write loses
      .mockResolvedValueOnce(fileBody(JSON.stringify(theirs), 'sha-new')) // re-read
      .mockResolvedValueOnce(written('sha-final'));                 // retry succeeds
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    const mine = await repo.addPolish({ ...POLISH_INPUT });

    const finalBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    const merged = parseSnapshot(decodeBase64(finalBody.content));

    // Both survive. Theirs was NOT clobbered.
    expect(merged.polish.map((p) => p.id).sort()).toEqual(['theirs', mine.id].sort());
    // And the retry used the SHA from the re-read, not the stale one.
    expect(finalBody.sha).toBe('sha-new');
  });

  it('does not duplicate the row when a retry re-applies the same add', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fileBody(serialise(EMPTY), 'sha-old'))
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(fileBody(serialise(EMPTY), 'sha-new'))
      .mockResolvedValueOnce(written('sha-final'));
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    await repo.addPolish({ ...POLISH_INPUT });

    const merged = parseSnapshot(
      decodeBase64(JSON.parse(fetchMock.mock.calls[3][1].body).content),
    );
    expect(merged.polish).toHaveLength(1);
  });

  it('gives up rather than looping forever, and surfaces the error', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PUT' ? conflict() : fileBody(serialise(EMPTY), 's')),
    );
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    await expect(repo.addPolish({ ...POLISH_INPUT })).rejects.toThrow(GitHubApiError);
  });

  it('does NOT retry a genuine auth failure', async () => {
    const revoked = {
      ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }),
    } as unknown as Response;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fileBody(serialise(EMPTY), 'sha'))
      .mockResolvedValueOnce(revoked);
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    await expect(repo.addPolish({ ...POLISH_INPUT })).rejects.toThrow(/token may have been revoked/i);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no pointless retries
  });
});

describe('the buy flow behaves identically to the in-memory repository', () => {
  it('marks Bought and links the polish in one write', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PUT' ? written('s') : notFound()),
    );
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    const item = await repo.addWishlistItem({
      brand: 'ILNP', name: 'Mercury Rising', color: 'Silver', finish: 'Holographic',
      swatch_hex: '#B9BFC6', where_sold: 'ilnp.com', typical_price: 12.5,
      sale_window: null, priority: 'High', status: 'Wanting', link: null, notes: null,
    });
    const polish = await repo.addPolish({ ...POLISH_INPUT });
    const resolved = await repo.markWishlistItemBought(item.id, polish.id, '2026-08-20');

    expect(resolved.status).toBe('Bought');
    expect(resolved.bought_polish_id).toBe(polish.id);
    expect(resolved.typical_price).toBe(12.5); // purchase context preserved
  });
});

describe('commits are attributed to the app, not to a person', () => {
  it('sets both author and committer to an address no account can own', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(written('sha-new'));
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository(TARGET);
    await repo.load();
    await repo.addPolish({ ...POLISH_INPUT });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    // Both matter: GitHub credits the contribution graph off either field, so setting
    // only `author` would still put her manicures on the token owner's profile.
    expect(body.author).toEqual(APP_IDENTITY);
    expect(body.committer).toEqual(APP_IDENTITY);
    // RFC 2606 reserves .invalid, so this can never match a real GitHub account.
    expect(APP_IDENTITY.email).toMatch(/\.invalid$/);
  });

  it('still allows an explicit identity when one is wanted', async () => {
    const identity = { name: 'Anabel', email: 'anabel@example.com' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(written('sha-new'));
    vi.stubGlobal('fetch', fetchMock);

    const repo = new GitHubRepository({ ...TARGET, identity });
    await repo.load();
    await repo.addPolish({ ...POLISH_INPUT });

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).author).toEqual(identity);
  });
});

describe('guard rails', () => {
  it('refuses to write before load(), which would push an empty file', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const repo = new GitHubRepository(TARGET);
    await expect(repo.addPolish({ ...POLISH_INPUT })).rejects.toThrow(/load\(\) must be awaited/);
  });
});

/**
 * The GitHub Contents API, reduced to the two operations this app needs:
 * read a file, and write a file.
 *
 * Storing the collection in a private repository rather than a hosted database is a
 * deliberate trade for a single-user app. What it buys: nothing pauses, nothing expires,
 * nothing has to be kept warm by a cron job, and every write is a commit — so the entire
 * history of her collection is recoverable for free, which is more than the Supabase free
 * tier offers (zero backup retention). What it costs: no server-side constraint
 * enforcement, and a single-user ceiling.
 */

export interface GitHubTarget {
  owner: string;
  repo: string;
  /** Path within the repo, e.g. `data/collection.json`. */
  path: string;
  branch: string;
  token: string;
  /** Who the commits are attributed to. Defaults to APP_IDENTITY — see below. */
  identity?: CommitIdentity;
}

export interface CommitIdentity {
  name: string;
  email: string;
}

/**
 * The app commits as itself, not as whoever's token is in use.
 *
 * Without this, every saved manicure would land on a real person's GitHub contribution
 * graph: GitHub credits a commit when its author email matches a verified email on an
 * account and it is on the default branch. Months of automated green squares from a
 * repository nobody can see is, at best, a misleading profile — and it is not what a
 * contribution graph is supposed to mean.
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered, so this address is
 * guaranteed never to match a GitHub account. The commits still show up in the
 * repository's history with a readable name; they just belong to the app.
 */
export const APP_IDENTITY: CommitIdentity = {
  name: 'Polish',
  email: 'app@polish.invalid',
};

export class GitHubApiError extends Error {
  readonly status: number;
  /** True when the write lost a race and the caller should re-read and retry. */
  readonly isConflict: boolean;

  constructor(message: string, status: number, isConflict = false) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.isConflict = isConflict;
  }
}

/** What a read returns. `sha` is required to write the file back. */
export interface FileContents {
  text: string;
  /** Blob SHA of what was read, or null when the file does not exist yet. */
  sha: string | null;
}

const API = 'https://api.github.com';

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Base64 for text that is not ASCII.
 *
 * `btoa(JSON.stringify(...))` throws `InvalidCharacterError` the moment a string
 * contains a character outside Latin-1 — which for this app means the first time she
 * writes "Malaga Wine — the good one" with an em dash, or puts an emoji in a note. The
 * data has to survive her actual vocabulary, so the string is encoded to UTF-8 bytes
 * first and those bytes are what get base64'd.
 */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Built one char at a time rather than String.fromCharCode(...bytes): spreading a
  // large array into a call blows the argument limit and throws on a big collection.
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(base64: string): string {
  // GitHub wraps its base64 at 60 characters; atob rejects the newlines.
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Read the file. A missing file is not an error — it is what a brand-new, empty
 * collection looks like, and the caller starts from an empty snapshot.
 */
export async function readFile(target: GitHubTarget): Promise<FileContents> {
  const url =
    `${API}/repos/${target.owner}/${target.repo}/contents/${encodePath(target.path)}` +
    `?ref=${encodeURIComponent(target.branch)}`;

  const response = await fetch(url, { headers: headers(target.token) });

  if (response.status === 404) return { text: '', sha: null };
  if (!response.ok) throw await describe(response, 'read');

  const body = (await response.json()) as { content?: string; sha: string; size: number };

  // The Contents API inlines `content` only below 1MB; above that it returns the
  // metadata with an empty string and expects you to go to the blob endpoint. A
  // long-lived wear log will cross that line, and the failure would be a silently
  // empty collection rather than an error — so handle it now, not after it happens.
  if (!body.content && body.size > 0) {
    return { text: await readBlob(target, body.sha), sha: body.sha };
  }

  return { text: body.content ? decodeBase64(body.content) : '', sha: body.sha };
}

async function readBlob(target: GitHubTarget, sha: string): Promise<string> {
  const response = await fetch(
    `${API}/repos/${target.owner}/${target.repo}/git/blobs/${sha}`,
    { headers: headers(target.token) },
  );
  if (!response.ok) throw await describe(response, 'read blob');
  const body = (await response.json()) as { content: string; encoding: string };
  return body.encoding === 'base64' ? decodeBase64(body.content) : body.content;
}

/**
 * Write the file, returning the new SHA.
 *
 * `sha` is the version being replaced, and passing it is what makes this safe on two
 * devices: GitHub refuses the write if the file moved underneath us, rather than
 * silently overwriting whatever the other device just saved. Pass null to create.
 */
export async function writeFile(
  target: GitHubTarget,
  text: string,
  sha: string | null,
  message: string,
): Promise<string> {
  const url = `${API}/repos/${target.owner}/${target.repo}/contents/${encodePath(target.path)}`;

  const identity = target.identity ?? APP_IDENTITY;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...headers(target.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: encodeBase64(text),
      branch: target.branch,
      // Both, deliberately. Setting only `author` leaves the token owner as committer,
      // and GitHub credits the contribution graph off either one.
      author: identity,
      committer: identity,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!response.ok) throw await describe(response, 'write');

  const body = (await response.json()) as { content: { sha: string } };
  return body.content.sha;
}

/** Does this token actually reach this repo? Used by the setup screen. */
export async function checkAccess(
  target: Omit<GitHubTarget, 'path'>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const response = await fetch(`${API}/repos/${target.owner}/${target.repo}`, {
      headers: headers(target.token),
    });
    if (response.ok) {
      const body = (await response.json()) as { permissions?: { push?: boolean } };
      // Read access is not enough — a token that cannot push looks fine until the first
      // save fails, which is the worst moment to find out.
      if (!body.permissions?.push) {
        return { ok: false, reason: 'That token can read the repository but not write to it.' };
      }
      return { ok: true };
    }
    if (response.status === 404) {
      return {
        ok: false,
        reason: 'No such repository, or the token has not been granted access to it.',
      };
    }
    if (response.status === 401) return { ok: false, reason: 'That token was rejected.' };
    return { ok: false, reason: `GitHub returned ${response.status}.` };
  } catch {
    return { ok: false, reason: 'Could not reach GitHub. Check the connection.' };
  }
}

/** Percent-encode each path segment but keep the slashes that separate them. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function describe(response: Response, action: string): Promise<GitHubApiError> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: string };
    detail = body.message ? ` — ${body.message}` : '';
  } catch {
    /* a non-JSON error body is not worth failing over */
  }

  // 409 is a genuine race. 422 covers "sha didn't match", which GitHub reports as a
  // validation failure rather than a conflict but means exactly the same thing here.
  const isConflict = response.status === 409 || response.status === 422;

  if (response.status === 401 || response.status === 403) {
    return new GitHubApiError(
      `GitHub refused the ${action} (${response.status})${detail}. The access token may have been revoked.`,
      response.status,
    );
  }
  return new GitHubApiError(
    `GitHub ${action} failed with ${response.status}${detail}`,
    response.status,
    isConflict,
  );
}

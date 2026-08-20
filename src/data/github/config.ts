import { del, get, set } from 'idb-keyval';
import type { GitHubTarget } from './api';

/**
 * Where the connection lives on this device.
 *
 * IndexedDB rather than localStorage for two reasons: it is what
 * `navigator.storage.persist()` protects from eviction, and it is asynchronous, so
 * reading it cannot block first paint. The token never leaves the device and is never
 * bundled into the build — a token compiled into a public repo's JavaScript would be
 * readable by anyone who viewed source.
 *
 * Per-device by design. IndexedDB is scoped to the origin on one browser, so connecting
 * her phone does not connect her laptop, which is the intended behaviour: each device
 * is authorised deliberately.
 */

const CONNECTION_KEY = 'polish:github-connection';
const EVER_CONNECTED_KEY = 'polish:has-ever-connected';

/** What she actually supplies. Owner and repo have defaults she never has to see. */
export interface Connection {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

/**
 * Defaults baked into the build.
 *
 * None of this is secret — the repository is private, but its *name* is not, and
 * knowing it grants nothing without a token. Shipping them as defaults means the setup
 * screen asks for one thing instead of five, which for someone who is not a developer
 * is the difference between a screen she can use and a form she needs help with.
 *
 * Overridable at build time so a second collection, or a rename, does not need a code
 * change.
 */
export const DEFAULT_OWNER = import.meta.env.VITE_GITHUB_OWNER ?? 'JuRuiz031';
export const DEFAULT_REPO = import.meta.env.VITE_GITHUB_REPO ?? 'polish-data';
export const DEFAULT_BRANCH = 'main';
export const DEFAULT_PATH = 'data/collection.json';

export function connectionDefaults(): Omit<Connection, 'token'> {
  return {
    owner: DEFAULT_OWNER,
    repo: DEFAULT_REPO,
    branch: DEFAULT_BRANCH,
    path: DEFAULT_PATH,
  };
}

export async function loadConnection(): Promise<Connection | null> {
  try {
    const stored = await get<Connection>(CONNECTION_KEY);
    if (!stored?.token) return null;
    // Merge over the defaults so a connection saved before a new field existed still
    // works rather than loading as a half-built object.
    return { ...connectionDefaults(), ...stored };
  } catch {
    // A browser with IndexedDB blocked (private mode on some platforms) is not a crash;
    // it is a device that has to be set up again each session.
    return null;
  }
}

export async function saveConnection(connection: Connection): Promise<void> {
  await set(CONNECTION_KEY, connection);
}

export async function clearConnection(): Promise<void> {
  await del(CONNECTION_KEY);
}

/**
 * Has this device ever successfully reached her collection?
 *
 * This is the flag that stops a revoked token from showing her the demo collection. A
 * device that has never connected can honestly show sample data; a device that HAS
 * connected must never do so again, because "your polishes have been replaced by
 * someone else's" is the most alarming thing this app could tell her, and it would not
 * even be true. Deliberately kept separate from the connection itself so that clearing
 * a bad token does not also erase the memory that her data exists.
 */
export async function markConnected(): Promise<void> {
  await set(EVER_CONNECTED_KEY, true);
}

export async function hasEverConnected(): Promise<boolean> {
  try {
    return (await get<boolean>(EVER_CONNECTED_KEY)) === true;
  } catch {
    return false;
  }
}

export function toTarget(connection: Connection): GitHubTarget {
  return {
    owner: connection.owner,
    repo: connection.repo,
    path: connection.path,
    branch: connection.branch,
    token: connection.token,
  };
}

/**
 * A first-pass sanity check, before spending a network round trip.
 *
 * Deliberately loose: GitHub has shipped several token prefixes over the years and will
 * ship more, so this rejects the things that are obviously not a token — an empty box, a
 * pasted URL — rather than trying to validate the format. The real check is `checkAccess`,
 * which asks GitHub.
 */
export function looksLikeToken(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 20 && !/\s/.test(trimmed) && !trimmed.startsWith('http');
}

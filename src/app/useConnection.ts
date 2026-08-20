import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitHubRepository } from '../data/repositories/github';
import { InMemoryRepository } from '../data/repositories/memory';
import type { Repository } from '../data/repositories/types';
import {
  clearConnection,
  hasEverConnected,
  loadConnection,
  markConnected,
  saveConnection,
  toTarget,
  type Connection,
} from '../data/github/config';

/**
 * Which of the app's four lives it is currently living.
 *
 *   loading   — reading the stored connection. Milliseconds, but not zero.
 *   setup     — no connection on this device. Show the connect screen.
 *   demo      — she chose "look around first". Seeded data, saves nothing.
 *   connected — her real collection.
 */
export type ConnectionMode = 'loading' | 'setup' | 'demo' | 'connected';

export interface ConnectionState {
  mode: ConnectionMode;
  repository: Repository | null;
  /**
   * True when this device has reached her collection at least once before.
   *
   * The single most important flag in this file. It is what stops a device whose token
   * was revoked from quietly falling back to the sample collection — which would tell
   * her, wrongly and alarmingly, that her polishes had been replaced by a stranger's.
   * A device that has never connected may honestly show a demo; one that has, may not.
   */
  hasConnectedBefore: boolean;
  connect: (connection: Connection) => Promise<void>;
  exploreDemo: () => void;
  /** Forget the token and return to setup. Used after a revoked-token failure. */
  reset: () => Promise<void>;
}

export function useConnection(): ConnectionState {
  const [mode, setMode] = useState<ConnectionMode>('loading');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [hasConnectedBefore, setHasConnectedBefore] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [stored, everConnected] = await Promise.all([
        loadConnection(),
        hasEverConnected(),
      ]);
      if (cancelled) return;

      setHasConnectedBefore(everConnected);
      if (stored) {
        setConnection(stored);
        setMode('connected');
      } else {
        setMode('setup');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (next: Connection) => {
    // Persisted BEFORE the mode flips, and only after the caller has verified it
    // against GitHub — so a token that cannot write is never written down, and one that
    // can is never held in React state alone. Without the save, the connection would
    // survive exactly as long as the tab did and she would be asked for her key on
    // every single launch.
    await saveConnection(next);
    await markConnected();
    setConnection(next);
    setHasConnectedBefore(true);
    setMode('connected');
  }, []);

  const exploreDemo = useCallback(() => setMode('demo'), []);

  const reset = useCallback(async () => {
    await clearConnection();
    setConnection(null);
    setMode('setup');
  }, []);

  /**
   * One repository instance per connection.
   *
   * Rebuilt only when the connection actually changes — a new instance on every render
   * would re-fetch the whole collection each time anything above it re-rendered, and
   * `GitHubRepository` caches the file's SHA, so a fresh one mid-session would also lose
   * the concurrency guard that stops two devices overwriting each other.
   */
  const repository = useMemo<Repository | null>(() => {
    if (mode === 'demo') return new InMemoryRepository();
    if (mode === 'connected' && connection) return new GitHubRepository(toTarget(connection));
    return null;
  }, [mode, connection]);

  return { mode, repository, hasConnectedBefore, connect, exploreDemo, reset };
}

import { useState } from 'react';
import { checkAccess } from '../../data/github/api';
import {
  connectionDefaults,
  looksLikeToken,
  type Connection,
} from '../../data/github/config';
import { Button, TextField } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';

/**
 * First run on a device.
 *
 * The audience is one person who is not a developer and did not ask for a GitHub
 * account, so this screen asks for exactly one thing and explains itself in her terms,
 * not the API's. The words "personal access token", "repository" and "scope" do not
 * appear above the fold; it is "the key", and it came from someone she trusts.
 *
 * It also never asks her to check the key is right. She is dyslexic and the key is forty
 * opaque characters — proofreading it is a task no one should be given when a machine
 * can simply try it. Paste, tap, and the app says what happened.
 */
export function ConnectScreen({
  onConnect,
  onExploreDemo,
  /** Set when a previously working connection stopped working, not on first run. */
  reason,
}: {
  onConnect: (connection: Connection) => Promise<void>;
  onExploreDemo: () => void;
  reason?: string;
}) {
  const [token, setToken] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [target, setTarget] = useState(connectionDefaults());
  const [status, setStatus] = useState<'idle' | 'checking'>('idle');
  const [error, setError] = useState<string | null>(null);

  const returning = reason !== undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmed = token.trim();
    if (!looksLikeToken(trimmed)) {
      setError('That does not look like a key. Paste the whole thing, with no spaces.');
      return;
    }

    setStatus('checking');
    // Verified BEFORE saving. A token that can read but not write looks perfectly fine
    // until her first save fails, which is the worst possible moment to discover it.
    const result = await checkAccess({ ...target, token: trimmed });
    setStatus('idle');

    if (!result.ok) {
      setError(result.reason);
      return;
    }

    await onConnect({ ...target, token: trimmed });
  }

  return (
    <div className="connect">
      <div className="connect__card">
        <header className="connect__head">
          <span className="connect__mark" aria-hidden="true">
            <Icon name="sparkle" filled />
          </span>
          <h1 className="connect__title">
            {returning ? 'Reconnect your collection' : 'Connect your collection'}
          </h1>
          <p className="connect__lede">
            {returning
              ? 'This device has lost access to your collection. Your polishes are safe — ' +
                'this just needs a new key.'
              : 'Paste the key you were given. It stays on this device and only has to be ' +
                'entered once.'}
          </p>
        </header>

        {returning && (
          <p className="connect__reason" role="status">
            {reason}
          </p>
        )}

        <form className="form" onSubmit={submit}>
          <TextField
            label="Your key"
            type="password"
            value={token}
            onChange={setToken}
            error={error ?? undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Paste it here"
            disabled={status === 'checking'}
            hint="Nothing is saved until the key has been checked."
          />

          <div className="form__actions">
            <Button variant="primary" type="submit" disabled={status === 'checking'}>
              {status === 'checking' ? 'Checking…' : 'Connect'}
            </Button>
            {!returning && (
              <Button variant="quiet" type="button" onClick={onExploreDemo}>
                Look around first
              </Button>
            )}
          </div>
        </form>

        {/*
          Everything below is for whoever set this up, not for her. It is collapsed
          because a second and third field on this screen would double its difficulty
          for the one person who has to use it, to serve a case that comes up once.
        */}
        <details className="connect__advanced" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary>Where the collection is stored</summary>
          <div className="form">
            <TextField
              label="Account"
              value={target.owner}
              onChange={(owner) => setTarget((t) => ({ ...t, owner }))}
              autoComplete="off"
              spellCheck={false}
            />
            <TextField
              label="Repository"
              value={target.repo}
              onChange={(repo) => setTarget((t) => ({ ...t, repo }))}
              autoComplete="off"
              spellCheck={false}
            />
            <TextField
              label="File"
              value={target.path}
              onChange={(path) => setTarget((t) => ({ ...t, path }))}
              autoComplete="off"
              spellCheck={false}
              hint="Created automatically on the first save."
            />
          </div>
        </details>
      </div>
    </div>
  );
}

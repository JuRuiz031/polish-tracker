import { useEffect, useState } from 'react';
import { OfflineRepository, type OfflineState } from '../data/repositories/offline';
import type { Repository } from '../data/repositories/types';
import { Icon } from './Icon';

/**
 * Whether what she just did has actually reached the repository.
 *
 * Deliberately quiet. An app that shouts "SAVED!" after every tap trains its user to
 * ignore it, and then says nothing useful on the one occasion it matters. So the settled
 * state is silent — nothing is drawn at all — and the indicator appears only when there
 * is something she could not otherwise know:
 *
 *   offline — the change is safe on this device but has not gone up yet
 *   error   — it will not go up until the key is replaced
 *
 * "Syncing" is shown only when something is already pending, so a routine background
 * push does not flicker a badge at her for 300ms.
 */
export function SyncStatus({ repository }: { repository: Repository | null }) {
  const offline = repository instanceof OfflineRepository ? repository : null;
  const [state, setState] = useState<OfflineState | null>(null);

  // Subscribing IS synchronising with an external system, which is what effects are
  // for. `subscribe` reports the current value on arrival, so there is no window where
  // this renders a stale status.
  useEffect(() => offline?.subscribe(setState), [offline]);

  if (!offline || !state) return null;
  if (state.status === 'synced' && !state.pending) return null;
  if (state.status === 'syncing' && !state.pending) return null;

  const { label, detail, tone } = describe(state);

  return (
    <p className={`sync sync--${tone}`} role="status">
      <Icon name={tone === 'error' ? 'close' : 'archive'} />
      <span className="sync__text">
        <strong>{label}</strong>
        <span className="sync__detail">{detail}</span>
      </span>
    </p>
  );
}

function describe(state: OfflineState): { label: string; detail: string; tone: string } {
  if (state.status === 'error') {
    return {
      tone: 'error',
      label: 'Not saving to your collection',
      // Never "your changes are lost" — they are not. They are on the device, and the
      // only thing standing between them and the repository is a working key.
      detail: 'Your changes are safe on this device. They will be saved once the key works again.',
    };
  }
  if (state.status === 'syncing') {
    return { tone: 'pending', label: 'Saving…', detail: 'Sending your changes.' };
  }
  if (state.status === 'offline') {
    return {
      tone: 'pending',
      label: 'Offline',
      detail: 'Your changes are saved on this device and will sync when you are back online.',
    };
  }
  return { tone: 'pending', label: 'Waiting to save', detail: 'Not sent yet.' };
}

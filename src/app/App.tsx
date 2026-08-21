import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router';
import { StoreProvider } from './store';
import { useStore } from './storeContext';
import { useConnection, type ConnectionMode } from './useConnection';
import type { Repository } from '../data/repositories/types';
import { ConnectScreen } from '../features/setup/ConnectScreen';
import { Toaster } from '../ui/Toaster';
import { SyncStatus } from '../ui/SyncStatus';
import { Button, EmptyState } from '../ui/primitives';
import { Icon, type IconName } from '../ui/Icon';
import { TonightScreen } from '../features/tonight/TonightScreen';
import { CollectionScreen } from '../features/collection/CollectionScreen';
import { LogScreen } from '../features/log/LogScreen';
import { WishlistScreen } from '../features/wishlist/WishlistScreen';
import { StatsScreen } from '../features/stats/StatsScreen';
import { DataScreen } from '../features/data/DataScreen';

/**
 * The app shell.
 *
 * One set of nav markup, two presentations. On a phone it is a bottom tab bar in the
 * thumb zone; from 60rem up it becomes a persistent left rail. Rendering the same
 * links twice would mean two DOM nodes claiming the same landmark and a screen reader
 * announcing every destination twice, so the switch is done entirely in CSS.
 *
 * Tabs are routes rather than local state so the back button works — on an installed
 * iOS PWA that is the only navigation affordance the user gets.
 */

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/tonight', label: 'Tonight', icon: 'sparkle' },
  { to: '/collection', label: 'Collection', icon: 'grid' },
  { to: '/log', label: 'Log', icon: 'calendar' },
  { to: '/wishlist', label: 'Wishlist', icon: 'heart' },
  { to: '/stats', label: 'Stats', icon: 'chart' },
  { to: '/backup', label: 'Backup', icon: 'download' },
];

export default function App() {
  const { mode, repository, hasConnectedBefore, connect, exploreDemo, reset } =
    useConnection();

  // Reading IndexedDB is fast but not instant, and rendering the setup screen for one
  // frame before discovering she is already connected would flash a "paste your key"
  // prompt at someone who has used the app for a year.
  //
  // The second condition waits for the repository to finish reading this device's cached
  // collection. Mounting the store before that would have it load from an empty cache,
  // so opening the app without signal would show an empty collection instead of her data.
  if (mode === 'loading' || ((mode === 'connected' || mode === 'demo') && !repository)) {
    return (
      <div className="loading" role="status">
        <span className="loading__dot" />
        <span className="loading__dot" />
        <span className="loading__dot" />
        <span className="visually-hidden">Loading</span>
      </div>
    );
  }

  if (mode === 'setup') {
    return (
      <ConnectScreen
        onConnect={connect}
        onExploreDemo={exploreDemo}
        reason={
          hasConnectedBefore
            ? 'The key this device was using no longer works. Nothing has been lost.'
            : undefined
        }
      />
    );
  }

  return (
    // `key` forces a fresh provider when the backend changes, so leaving demo mode
    // cannot leave the seeded collection on screen over her real data.
    <StoreProvider key={mode} repository={repository ?? undefined}>
      {/* GitHub Pages serves this app from a subpath (see vite.config.ts's `base`);
          import.meta.env.BASE_URL carries that same value, so every route stays under
          it instead of resolving against the domain root. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Shell mode={mode} onReconnect={reset} repository={repository} />
      </BrowserRouter>
    </StoreProvider>
  );
}

function Shell({
  mode,
  onReconnect,
  repository,
}: {
  mode: ConnectionMode;
  onReconnect: () => void;
  repository: Repository | null;
}) {
  const { ready, error } = useStore();

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <nav className="nav" aria-label="Sections">
        <p className="nav__brand" aria-hidden="true">
          Polish
        </p>
        <ul className="nav__list">
          {TABS.map((tab) => (
            <li key={tab.to} className="nav__item">
              <NavLink
                to={tab.to}
                className={({ isActive }) => `nav__link ${isActive ? 'is-active' : ''}`}
              >
                {({ isActive }) => (
                  <>
                    <Icon name={tab.icon} filled={isActive} />
                    <span className="nav__label">{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        {mode === 'demo' && <DemoNote />}
      </nav>

      <main className="app__main" id="main">
        <SyncStatus repository={repository} />
        {!ready ? (
          <div className="loading" role="status">
            <span className="loading__dot" />
            <span className="loading__dot" />
            <span className="loading__dot" />
            <span className="visually-hidden">Loading</span>
          </div>
        ) : error ? (
          <LoadFailed error={error} onReconnect={onReconnect} />
        ) : (
          <Routes>
            <Route path="/" element={<Navigate to="/tonight" replace />} />
            <Route path="/tonight" element={<TonightScreen />} />
            <Route path="/collection" element={<CollectionScreen />} />
            <Route path="/log" element={<LogScreen />} />
            <Route path="/wishlist" element={<WishlistScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route path="/backup" element={<DataScreen />} />
            <Route path="*" element={<Navigate to="/tonight" replace />} />
          </Routes>
        )}
      </main>

      <Toaster />
    </div>
  );
}

/**
 * Shown only in demo mode, and deliberately impossible to miss.
 *
 * Without it the app looks finished, and the first real reaction to it would be losing
 * an evening of data entry into a repository that resets on reload.
 */
function DemoNote() {
  return (
    <p className="nav__note" role="note">
      <strong>Sample data</strong>
      <span>Nothing here is saved. Reload to start over.</span>
    </p>
  );
}

/**
 * The collection could not be loaded at all.
 *
 * This is deliberately not an empty collection and never the demo. The two ways to get
 * here are a revoked key and a file the app refuses to parse, and in both cases her data
 * still exists — saying anything that implies otherwise would be both frightening and
 * false. So it says what happened, says the data is safe, and offers the one action that
 * helps.
 */
function LoadFailed({ error, onReconnect }: { error: Error; onReconnect: () => void }) {
  return (
    <div className="screen">
      <EmptyState
        title="Can't reach your collection"
        action={
          <Button variant="primary" onClick={onReconnect}>
            Enter a new key
          </Button>
        }
      >
        <p>
          Your polishes are safe — they are stored separately and nothing has been
          changed. This device just could not read them.
        </p>
        <p className="empty__detail">{error.message}</p>
      </EmptyState>
    </div>
  );
}

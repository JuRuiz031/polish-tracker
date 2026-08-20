import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router';
import { StoreProvider } from './store';
import { useStore } from './storeContext';
import { Toaster } from '../ui/Toaster';
import { Icon, type IconName } from '../ui/Icon';
import { TonightScreen } from '../features/tonight/TonightScreen';
import { CollectionScreen } from '../features/collection/CollectionScreen';
import { LogScreen } from '../features/log/LogScreen';
import { WishlistScreen } from '../features/wishlist/WishlistScreen';
import { StatsScreen } from '../features/stats/StatsScreen';

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
];

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </StoreProvider>
  );
}

function Shell() {
  const { ready } = useStore();

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
        <DemoNote />
      </nav>

      <main className="app__main" id="main">
        {ready ? (
          <Routes>
            <Route path="/" element={<Navigate to="/tonight" replace />} />
            <Route path="/tonight" element={<TonightScreen />} />
            <Route path="/collection" element={<CollectionScreen />} />
            <Route path="/log" element={<LogScreen />} />
            <Route path="/wishlist" element={<WishlistScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route path="*" element={<Navigate to="/tonight" replace />} />
          </Routes>
        ) : (
          <div className="loading" role="status">
            <span className="loading__dot" />
            <span className="loading__dot" />
            <span className="loading__dot" />
            <span className="visually-hidden">Loading</span>
          </div>
        )}
      </main>

      <Toaster />
    </div>
  );
}

/**
 * Temporary, and deliberately impossible to miss.
 *
 * Nothing is persisted yet — the in-memory repository resets on reload. Without this
 * the app looks finished, and the first real reaction to it would be losing an evening
 * of data entry. It comes out when Supabase is wired up.
 */
function DemoNote() {
  return (
    <p className="nav__note" role="note">
      <strong>Preview</strong>
      <span>Sample data — nothing is saved yet.</span>
    </p>
  );
}

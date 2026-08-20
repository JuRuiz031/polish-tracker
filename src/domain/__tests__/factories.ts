import type { Polish, Wear, WishlistItem } from '../types';
import { dedupeKey } from '../dedupe';

/** Test builders. Everything defaults to something valid; override what the test is about. */

let counter = 0;
const nextId = () => `id-${(counter += 1)}`;

export function makePolish(overrides: Partial<Polish> = {}): Polish {
  const brand = overrides.brand ?? 'OPI';
  const name = overrides.name ?? 'Big Apple Red';
  return {
    id: nextId(),
    user_id: 'user-1',
    brand,
    name,
    color: 'Red',
    finish: 'Cream',
    swatch_hex: '#C8102E',
    photo_path: null,
    notes: null,
    archived: false,
    dedupe_key: dedupeKey(brand, name),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

export function makeWear(overrides: Partial<Wear> = {}): Wear {
  return {
    id: nextId(),
    user_id: 'user-1',
    polish_id: 'polish-1',
    worn_on: '2026-08-01',
    rating: null,
    days_lasted: null,
    notes: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

export function makeWishlistItem(overrides: Partial<WishlistItem> = {}): WishlistItem {
  const brand = overrides.brand ?? 'Zoya';
  const name = overrides.name ?? 'Storm';
  return {
    id: nextId(),
    user_id: 'user-1',
    brand,
    name,
    color: 'Blue',
    finish: 'Glitter',
    swatch_hex: '#1C2A4A',
    where_sold: null,
    typical_price: null,
    sale_window: null,
    priority: 'Medium',
    status: 'Wanting',
    link: null,
    notes: null,
    dedupe_key: dedupeKey(brand, name),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

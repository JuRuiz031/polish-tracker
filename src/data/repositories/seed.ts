import { toIsoDate } from '../../domain/date';
import type { Polish, Wear, WishlistItem } from '../../domain/types';
import type { Snapshot } from './types';

/**
 * A stand-in for the spreadsheet import, so the UI can be built and judged against
 * realistic data before a Supabase project exists.
 *
 * This is NOT arbitrary filler. It is shaped to put every state the interface has to
 * handle on screen at once:
 *
 *   - never-worn polishes            → mint treatment, and the picker's whole reason
 *   - polishes resting past 28 days  → amber "resting a long time"
 *   - polishes worn in the last week → excluded by the default 14-day rest filter
 *   - a genuine duplicate pair       → alert treatment in the collection
 *   - an archived bottle             → invisible to the picker, visible when shown
 *   - a wishlist item already owned  → amber
 *   - a wishlist entry listed twice  → alert
 *   - wears with and without ratings → exercises the "unrated ≠ rated zero" rule
 *
 * Dates are generated relative to today rather than hard-coded, so the seed does not
 * quietly rot into "everything is resting" a month from now.
 */

const USER_ID = 'demo-user';

/** `n` days before today, as YYYY-MM-DD. */
function daysAgo(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return toIsoDate(date);
}

function timestampDaysAgo(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString();
}

interface PolishSeed {
  key: string;
  brand: string;
  name: string;
  color: Polish['color'];
  finish: Polish['finish'];
  swatch: string | null;
  notes?: string;
  archived?: boolean;
}

const POLISHES: PolishSeed[] = [
  { key: 'big-apple', brand: 'OPI', name: 'Big Apple Red', color: 'Red', finish: 'Cream', swatch: '#C8102E' },
  { key: 'lincoln-park', brand: 'OPI', name: 'Lincoln Park After Dark', color: 'Purple', finish: 'Cream', swatch: '#3B1F33' },
  { key: 'bubble-bath', brand: 'OPI', name: 'Bubble Bath', color: 'Nude/Beige', finish: 'Cream', swatch: '#E8CFC8', notes: 'The safe one. Goes with everything.' },
  { key: 'malaga', brand: 'OPI', name: 'Malaga Wine', color: 'Red', finish: 'Cream', swatch: '#7B2D3B' },

  { key: 'ballet-slippers', brand: 'Essie', name: 'Ballet Slippers', color: 'Pink', finish: 'Cream', swatch: '#E9D3D0' },
  { key: 'wicked', brand: 'Essie', name: 'Wicked', color: 'Red', finish: 'Cream', swatch: '#5C1622' },
  { key: 'mint-candy', brand: 'Essie', name: 'Mint Candy Apple', color: 'Green', finish: 'Cream', swatch: '#A8D8C4' },
  { key: 'bordeaux', brand: 'Essie', name: 'Bordeaux', color: 'Red', finish: 'Cream', swatch: '#5A1E2B' },

  { key: 'storm', brand: 'Zoya', name: 'Storm', color: 'Blue', finish: 'Glitter', swatch: '#1C2A4A', notes: 'Takes three coats but worth it.' },
  { key: 'carter', brand: 'Zoya', name: 'Carter', color: 'Brown', finish: 'Cream', swatch: '#6B4A3A' },
  { key: 'payton', brand: 'Zoya', name: 'Payton', color: 'Pink', finish: 'Shimmer', swatch: '#D96A8A' },

  { key: 'ruby-pumps', brand: 'China Glaze', name: 'Ruby Pumps', color: 'Red', finish: 'Glitter', swatch: '#9B1B30' },
  { key: 'liquid-leather', brand: 'China Glaze', name: 'Liquid Leather', color: 'Black', finish: 'Cream', swatch: '#111111' },

  { key: 'mercury-rising', brand: 'ILNP', name: 'Mercury Rising', color: 'Silver', finish: 'Holographic', swatch: '#B9BFC6', notes: 'Blinding in sunlight. Saving it.' },
  { key: 'juliette', brand: 'ILNP', name: 'Juliette', color: 'Pink', finish: 'Holographic', swatch: '#D98BA8' },
  { key: 'birthday-suit', brand: 'ILNP', name: 'Birthday Suit', color: 'Nude/Beige', finish: 'Duochrome', swatch: '#D8B49C' },

  { key: 'unicorn-skin', brand: 'Holo Taco', name: 'Unicorn Skin', color: 'Multi/Glitter', finish: 'Holographic', swatch: '#C9A7D4' },
  { key: 'black-taco', brand: 'Holo Taco', name: 'Black Multi-Chrome Taco', color: 'Black', finish: 'Chrome', swatch: '#232028' },
  { key: 'mint-holo', brand: 'Holo Taco', name: 'Mint Holo', color: 'Green', finish: 'Holographic', swatch: '#9FD9C0' },

  { key: 'tinsel', brand: 'Cirque Colors', name: 'Tinsel', color: 'Silver', finish: 'Metallic', swatch: '#C2C6CC' },
  { key: 'oxblood', brand: 'Cirque Colors', name: 'Oxblood', color: 'Red', finish: 'Jelly', swatch: '#6E1A22' },

  { key: 'ceo', brand: 'Olive & June', name: 'CEO', color: 'Nude/Beige', finish: 'Cream', swatch: '#DDBCA8' },
  { key: 'bff', brand: 'Olive & June', name: 'BFF', color: 'Pink', finish: 'Cream', swatch: '#E4A3B4' },

  { key: 'glossy-top', brand: 'Seche', name: 'Vite Top Coat', color: 'Clear', finish: 'Top Coat', swatch: null, notes: 'Restock when it gets gloopy.' },

  // ---- The duplicate pair, matching 'bordeaux' above. ----
  // The lowercase brand is deliberate: dedupeKey() lowercases the way Postgres lower()
  // does, so this keys identically to "Essie Bordeaux" and findDuplicates() flags BOTH
  // rows. Inconsistent capitalisation is exactly how duplicates enter a real workbook.
  { key: 'dupe-a', brand: 'essie', name: 'Bordeaux', color: 'Red', finish: 'Cream', swatch: '#5A1E2B', notes: 'Backup bottle — kept on purpose.' },

  // ---- Archived: used up. Never offered by the picker. ----
  { key: 'used-up', brand: 'OPI', name: 'Cajun Shrimp', color: 'Coral', finish: 'Cream', swatch: '#E2725B', archived: true, notes: 'Finished the bottle. Repurchase?' },
];

/**
 * How long ago each polish was last worn, keyed by seed key. Anything absent from this
 * map has never been worn — which is the single most important state in the app, so
 * roughly a third of the collection is deliberately left out of it.
 */
const WEAR_PLAN: Record<string, Array<{ days: number; rating: number | null; lasted: number | null; notes?: string }>> = {
  // Worn recently — inside the default 14-day rest window, so the picker skips these.
  'bubble-bath': [
    { days: 3, rating: 4, lasted: 6 },
    { days: 40, rating: 4, lasted: 7 },
    { days: 96, rating: 5, lasted: 8 },
  ],
  'ballet-slippers': [{ days: 9, rating: 3, lasted: 4, notes: 'Chipped fast on my right hand.' }],

  // Rested past the 14-day default but not yet "a long time".
  'big-apple': [
    { days: 21, rating: 5, lasted: 7, notes: 'Classic. Never fails.' },
    { days: 88, rating: 5, lasted: 6 },
  ],
  wicked: [{ days: 25, rating: 4, lasted: 5 }],

  // Past LONG_REST_DAYS (28) — these get the amber "resting a long time" treatment.
  'lincoln-park': [
    { days: 47, rating: 5, lasted: 9, notes: 'Best formula of the whole collection.' },
    { days: 130, rating: 4, lasted: 7 },
  ],
  storm: [{ days: 62, rating: 3, lasted: 5, notes: 'Removal was a nightmare.' }],
  'ruby-pumps': [{ days: 74, rating: 4, lasted: 6 }],
  'mint-candy': [{ days: 55, rating: null, lasted: null }], // logged, never rated
  carter: [{ days: 118, rating: 3, lasted: 4 }],
  'liquid-leather': [{ days: 92, rating: 4, lasted: 5 }],
  juliette: [{ days: 39, rating: 5, lasted: 8 }],
  'unicorn-skin': [{ days: 145, rating: 5, lasted: 6, notes: 'Saved it for New Year.' }],
  oxblood: [{ days: 201, rating: 4, lasted: 7 }],
  ceo: [
    { days: 33, rating: 4, lasted: 6 },
    { days: 71, rating: null, lasted: null },
  ],
  malaga: [{ days: 166, rating: 4, lasted: 6 }],
  'glossy-top': [{ days: 3, rating: null, lasted: null }],
  'used-up': [{ days: 240, rating: 5, lasted: 7 }],

  // Everything else — payton, mercury-rising, birthday-suit, black-taco, mint-holo,
  // tinsel, bff, bordeaux, dupe-a — has NEVER been worn. Mint treatment, always
  // eligible for the picker regardless of the rest filter.
};

interface WishlistSeed {
  brand: string;
  name: string;
  color: WishlistItem['color'];
  finish: WishlistItem['finish'];
  swatch: string | null;
  where_sold: string | null;
  typical_price: number | null;
  sale_window: WishlistItem['sale_window'];
  priority: WishlistItem['priority'];
  status: WishlistItem['status'];
  notes?: string;
}

const WISHLIST: WishlistSeed[] = [
  {
    brand: 'ILNP', name: 'Fantasy', color: 'Purple', finish: 'Holographic', swatch: '#8E5FC4',
    where_sold: 'ilnp.com', typical_price: 12, sale_window: 'Black Friday/Cyber Monday',
    priority: 'High', status: 'Wanting', notes: 'Sells out every restock.',
  },
  {
    brand: 'Cirque Colors', name: 'Aura', color: 'Pink', finish: 'Duochrome', swatch: '#E4A3B4',
    where_sold: 'cirquecolors.com', typical_price: 16, sale_window: 'Brand anniversary',
    priority: 'Medium', status: 'Wishing',
  },
  {
    brand: 'Holo Taco', name: 'Rainbow Linear Holo', color: 'Multi/Glitter', finish: 'Holographic', swatch: '#C9A7D4',
    where_sold: 'holotaco.com', typical_price: 13, sale_window: 'Holiday sets',
    priority: 'High', status: 'Waiting', notes: 'Waiting for the multi-pack.',
  },
  {
    brand: 'Zoya', name: 'Tomoko', color: 'White', finish: 'Metallic', swatch: '#F5F5F5',
    where_sold: 'zoya.com', typical_price: 11, sale_window: 'Monthly promo',
    priority: 'Low', status: 'Wishing',
  },
  // ---- Already owned: same key as the OPI already in the collection. Renders amber. ----
  {
    brand: 'OPI', name: 'Malaga Wine', color: 'Red', finish: 'Cream', swatch: '#7B2D3B',
    where_sold: 'Ulta', typical_price: 11, sale_window: 'Ulta 21 Days of Beauty',
    priority: 'Medium', status: 'Wanting', notes: 'Added before I checked the drawer.',
  },
  // ---- Listed twice within the wishlist itself. Both render in alert. ----
  {
    brand: 'ILNP', name: 'Fantasy', color: 'Purple', finish: 'Holographic', swatch: '#8E5FC4',
    where_sold: 'Amazon', typical_price: 15, sale_window: 'Prime Day',
    priority: 'Medium', status: 'Wishing', notes: 'Duplicate entry — different retailer.',
  },
];

/** Build the seed snapshot. Called once per session by the in-memory repository. */
export function buildSeed(): Snapshot {
  const polish: Polish[] = [];
  const idByKey = new Map<string, string>();

  POLISHES.forEach((seed, index) => {
    const id = `seed-polish-${index + 1}`;
    idByKey.set(seed.key, id);
    // Spread creation timestamps backwards so "recently added" ordering is meaningful.
    const created = timestampDaysAgo(400 - index * 12);
    polish.push({
      id,
      user_id: USER_ID,
      brand: seed.brand,
      name: seed.name,
      color: seed.color,
      finish: seed.finish,
      swatch_hex: seed.swatch,
      photo_path: null,
      notes: seed.notes ?? null,
      archived: seed.archived ?? false,
      created_at: created,
      updated_at: created,
      deleted_at: null,
    });
  });

  const wear: Wear[] = [];
  let wearCounter = 0;
  for (const [key, entries] of Object.entries(WEAR_PLAN)) {
    const polishId = idByKey.get(key);
    if (!polishId) continue;
    for (const entry of entries) {
      wearCounter += 1;
      wear.push({
        id: `seed-wear-${wearCounter}`,
        user_id: USER_ID,
        polish_id: polishId,
        worn_on: daysAgo(entry.days),
        rating: entry.rating,
        days_lasted: entry.lasted,
        notes: entry.notes ?? null,
        created_at: timestampDaysAgo(entry.days),
        updated_at: timestampDaysAgo(entry.days),
        deleted_at: null,
      });
    }
  }

  const wishlist: WishlistItem[] = WISHLIST.map((seed, index) => {
    const created = timestampDaysAgo(120 - index * 15);
    return {
      id: `seed-wish-${index + 1}`,
      user_id: USER_ID,
      brand: seed.brand,
      name: seed.name,
      color: seed.color,
      finish: seed.finish,
      swatch_hex: seed.swatch,
      where_sold: seed.where_sold,
      typical_price: seed.typical_price,
      sale_window: seed.sale_window,
      priority: seed.priority,
      status: seed.status,
      link: null,
      notes: seed.notes ?? null,
      bought_polish_id: null,
      bought_on: null,
      created_at: created,
      updated_at: created,
      deleted_at: null,
    };
  });

  return { polish, wear, wishlist };
}

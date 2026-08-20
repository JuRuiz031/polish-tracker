/**
 * Enum values, mirrored exactly from supabase/migrations/0001_schema.sql.
 *
 * These are the lists Anabel is already using. Do not "improve" them — the
 * spreadsheet import depends on matching them verbatim, and the Postgres enum
 * types will reject anything that drifts.
 *
 * Adding a value means: `alter type ... add value` in a new migration, then here.
 */

export const COLORS = [
  'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Indigo', 'Violet', 'Purple', 'Pink',
  'Coral', 'Nude/Beige', 'Brown', 'White', 'Black', 'Gray', 'Silver', 'Gold', 'Teal',
  'Multi/Glitter', 'Clear',
] as const;

export const FINISHES = [
  'Cream', 'Shimmer', 'Glitter', 'Holographic', 'Metallic', 'Matte', 'Jelly', 'Crelly',
  'Magnetic', 'Chrome', 'Duochrome', 'Flakie', 'Thermal', 'Top Coat', 'Base Coat', 'Other',
] as const;

export const SALE_WINDOWS = [
  'Black Friday/Cyber Monday', 'Ulta 21 Days of Beauty', 'Sephora Savings Event',
  'Prime Day', 'Memorial Day', 'Labor Day', 'Holiday sets', 'Spring sale',
  'Brand anniversary', 'Monthly promo', 'Rarely discounted', 'Not sure',
] as const;

export const PRIORITIES = ['High', 'Medium', 'Low'] as const;
export const STATUSES = ['Wanting', 'Wishing', 'Waiting'] as const;

/** Rest-period options for the picker. Default is 14. */
export const REST_DAY_OPTIONS = [0, 7, 14, 21, 28, 45, 60, 90] as const;
export const DEFAULT_REST_DAYS = 14;

/** Idle threshold at which the collection starts flagging a polish as resting a long time. */
export const LONG_REST_DAYS = 28;

export type Color = (typeof COLORS)[number];
export type Finish = (typeof FINISHES)[number];
export type SaleWindow = (typeof SALE_WINDOWS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];
export type RestDays = (typeof REST_DAY_OPTIONS)[number];

/**
 * "No constraint" for any filter that otherwise takes one of the enums above.
 *
 * Defined once, here, because it was previously declared independently in the picker,
 * the filter module and one screen — three string literals that had to stay identical
 * for filtering to work, with nothing enforcing that they did.
 */
export const ANY = 'Any' as const;
export type Any = typeof ANY;

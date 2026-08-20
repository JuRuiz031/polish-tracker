import type { Color, Finish, Priority, SaleWindow, Status } from './enums';

/**
 * Row types, mirroring the Postgres schema.
 *
 * `id` is always client-generated (crypto.randomUUID()) rather than left to the
 * database default. That is what makes every offline write an idempotent upsert:
 * replaying a queued insert twice lands on the same row instead of duplicating it.
 */

/** ISO calendar date, `YYYY-MM-DD`. Deliberately not a Date — see date.ts for why. */
export type IsoDate = string;

/** ISO 8601 timestamp with zone. */
export type IsoTimestamp = string;

export interface Polish {
  id: string;
  user_id: string;
  brand: string;
  name: string;
  color: Color;
  finish: Finish;
  /** Real bottle color for the UI chip; distinct from the `color` filter bucket. */
  swatch_hex: string | null;
  photo_path: string | null;
  notes: string | null;
  archived: boolean;
  /** Generated in Postgres. Never write this — see dedupe.ts for the client-side twin. */
  dedupe_key: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  deleted_at: IsoTimestamp | null;
}

export interface Wear {
  id: string;
  user_id: string;
  polish_id: string;
  worn_on: IsoDate;
  rating: number | null;
  days_lasted: number | null;
  notes: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  deleted_at: IsoTimestamp | null;
}

export interface WishlistItem {
  id: string;
  user_id: string;
  brand: string;
  name: string;
  color: Color;
  finish: Finish;
  /** Real bottle colour, carried into the collection when she buys it. */
  swatch_hex: string | null;
  where_sold: string | null;
  typical_price: number | null;
  sale_window: SaleWindow | null;
  priority: Priority;
  status: Status;
  link: string | null;
  notes: string | null;
  dedupe_key: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  deleted_at: IsoTimestamp | null;
}

/**
 * Derived stats for one polish. Never stored — computed from cached wear rows so
 * that every number on screen is correct offline. See derive.ts.
 */
export interface PolishStats {
  times_worn: number;
  /** null means never worn, which is a distinct UI state from "worn long ago". */
  last_worn: IsoDate | null;
  days_since: number | null;
  /** Mean of non-null ratings, one decimal. null when nothing has been rated. */
  avg_rating: number | null;
}

/** A polish with its derived stats attached, which is what list and detail views render. */
export type PolishWithStats = Polish & { stats: PolishStats };

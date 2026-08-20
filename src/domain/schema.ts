import { z } from 'zod';
import { COLORS, FINISHES, PRIORITIES, SALE_WINDOWS, STATUSES } from './enums';

/**
 * One set of schemas, three jobs: validating the entry forms, validating rows coming
 * out of her spreadsheet CSVs, and defining the export contract. Keeping them unified
 * is what makes the round-trip guarantee meaningful — an export that re-imports
 * cleanly is checked against the same rules that let the data in originally.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }, 'Not a real calendar date');

const isoTimestamp = z.string().min(1);

/**
 * Trimmed, non-empty, and internally normalised: runs of whitespace collapse to one
 * space. Rejects a field that is nothing but whitespace.
 *
 * The collapsing is not cosmetic. brand and name are the two halves of the duplicate
 * key, which is computed in JS here and in SQL by an expression index — and JS `.trim()`
 * strips all whitespace while Postgres `btrim()` strips only spaces. Guaranteeing that
 * neither field can contain a tab, a newline, or a double space removes the one case
 * where those two definitions disagree, so the client and the database can never
 * disagree about whether two bottles are the same bottle. 0001_schema.sql carries the
 * matching CHECK as a backstop.
 */
const requiredText = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .refine((value) => value.length > 0, 'Required');

/** Optional free text: blank, whitespace, and absent all normalise to null. */
const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });

const hexColor = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // Accept a bare hex from a spreadsheet cell and normalise it.
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  })
  .refine(
    (value) => value === null || /^#[0-9A-Fa-f]{6}$/.test(value),
    'Use a 6-digit hex color like #C8102E',
  );

export const colorSchema = z.enum(COLORS);
export const finishSchema = z.enum(FINISHES);
export const saleWindowSchema = z.enum(SALE_WINDOWS);
export const prioritySchema = z.enum(PRIORITIES);
export const statusSchema = z.enum(STATUSES);

/** What the add/edit polish form collects. `id` and `user_id` are added by the data layer. */
export const polishInputSchema = z.object({
  brand: requiredText,
  name: requiredText,
  color: colorSchema,
  finish: finishSchema,
  swatch_hex: hexColor,
  photo_path: optionalText,
  notes: optionalText,
  archived: z.boolean().default(false),
});

export const wearInputSchema = z.object({
  polish_id: z.string().min(1),
  worn_on: isoDate,
  rating: z.number().int().min(1).max(5).nullable().default(null),
  days_lasted: z.number().int().min(0).max(365).nullable().default(null),
  notes: optionalText,
});

/**
 * Money, matching `numeric(10, 2)` exactly.
 *
 * Both halves matter. The cap is the largest value the column can hold — anything more
 * raises `22003 numeric field overflow` on write. The rounding is what stops silent
 * drift: Postgres would quietly store 12.345 as 12.35, so an export taken after the
 * write would not match the value that was sent, and the round-trip guarantee would be
 * false for reasons nobody would ever think to look for. Rounding here means the value
 * that leaves the client is the value that comes back.
 */
const money = z
  .number()
  .min(0)
  .max(99_999_999.99, 'That is more than the price field can hold')
  .transform((value) => Math.round(value * 100) / 100)
  .nullable()
  .default(null);

export const wishlistInputSchema = z.object({
  brand: requiredText,
  name: requiredText,
  color: colorSchema,
  finish: finishSchema,
  swatch_hex: hexColor,
  where_sold: optionalText,
  typical_price: money,
  sale_window: saleWindowSchema.nullable().default(null),
  priority: prioritySchema.default('Medium'),
  status: statusSchema.default('Wanting'),
  link: optionalText,
  notes: optionalText,
});

/** Full persisted rows — what export writes and import reads back. */
const rowFields = {
  id: z.string().min(1),
  user_id: z.string().min(1),
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
  deleted_at: isoTimestamp.nullable().default(null),
};

/**
 * `dedupe_key` is tolerated but discarded on the way in.
 *
 * It is no longer a column — it became an expression index in 0001 — but a backup taken
 * before that change still carries it on every row, and refusing those files would mean
 * the escape hatch stopped opening the very archives it exists to protect. Accepting and
 * dropping it keeps old exports importable without letting a stale copy back into the
 * data.
 */
const legacyDedupeKey = z.string().optional().transform(() => undefined);

export const polishRowSchema = polishInputSchema.extend({
  ...rowFields,
  dedupe_key: legacyDedupeKey,
});

export const wearRowSchema = wearInputSchema.extend(rowFields);

export const wishlistRowSchema = wishlistInputSchema.extend({
  ...rowFields,
  dedupe_key: legacyDedupeKey,
  bought_polish_id: z.string().min(1).nullable().default(null),
  bought_on: isoDate.nullable().default(null),
});

/**
 * The export envelope. `version` is what lets a future import recognise and migrate an
 * older file — this is her escape hatch, so it has to stay readable indefinitely.
 */
export const EXPORT_VERSION = 1;

export const exportSchema = z.object({
  version: z.literal(EXPORT_VERSION),
  exported_at: isoTimestamp,
  polish: z.array(polishRowSchema),
  wear: z.array(wearRowSchema),
  wishlist: z.array(wishlistRowSchema),
});

export type PolishInput = z.infer<typeof polishInputSchema>;
export type WearInput = z.infer<typeof wearInputSchema>;
export type WishlistInput = z.infer<typeof wishlistInputSchema>;
export type ExportBundle = z.infer<typeof exportSchema>;

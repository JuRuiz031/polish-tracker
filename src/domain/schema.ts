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

/** Trimmed, non-empty. Rejects a field that is nothing but whitespace. */
const requiredText = z.string().trim().min(1, 'Required');

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

export const wishlistInputSchema = z.object({
  brand: requiredText,
  name: requiredText,
  color: colorSchema,
  finish: finishSchema,
  swatch_hex: hexColor,
  where_sold: optionalText,
  typical_price: z.number().min(0).nullable().default(null),
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

export const polishRowSchema = polishInputSchema.extend({
  ...rowFields,
  // Generated in Postgres; accepted on import but always recomputed rather than trusted.
  dedupe_key: z.string().optional(),
});

export const wearRowSchema = wearInputSchema.extend(rowFields);
export const wishlistRowSchema = wishlistInputSchema.extend({
  ...rowFields,
  dedupe_key: z.string().optional(),
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

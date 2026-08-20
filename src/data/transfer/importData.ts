import Papa from 'papaparse';
import { COLORS, FINISHES, PRIORITIES, SALE_WINDOWS, STATUSES } from '../../domain/enums';
import type { Color, Finish, Priority, SaleWindow, Status } from '../../domain/enums';
import { exportSchema, polishInputSchema, wishlistInputSchema } from '../../domain/schema';
import type { ExportBundle, PolishInput, WishlistInput } from '../../domain/schema';

/**
 * Import.
 *
 * Two entry points with different tolerances:
 *
 *   importJson  — strict. It reads our own export, so anything unexpected is a real
 *                 problem and should fail loudly rather than quietly drop a row.
 *   importCsv   — forgiving. It reads whatever Google Sheets produced from a workbook
 *                 maintained by hand over years, so it tolerates header variations,
 *                 stray whitespace, and enum values that differ only in case.
 *
 * Neither ever throws on bad data. Both return the rows that parsed AND the problems,
 * so the UI can show "412 of 418 rows imported, here are the 6 that need a look"
 * instead of failing the whole file because one cell has a typo in it.
 */

export interface RowProblem {
  /** 1-based, counting the header, so it matches what she sees in the spreadsheet. */
  row: number;
  column?: string;
  message: string;
  raw?: string;
}

export interface ImportResult<T> {
  rows: T[];
  problems: RowProblem[];
}

// ---------------------------------------------------------------------------
// JSON (our own format)
// ---------------------------------------------------------------------------

export function importJson(text: string): ImportResult<ExportBundle> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], problems: [{ row: 0, message: 'File is not valid JSON' }] };
  }

  const result = exportSchema.safeParse(parsed);
  if (!result.success) {
    return {
      rows: [],
      problems: result.error.issues.map((issue) => ({
        row: 0,
        column: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  return { rows: [result.data], problems: [] };
}

// ---------------------------------------------------------------------------
// Header matching
// ---------------------------------------------------------------------------

/** Reduce a header to letters and digits so spacing and punctuation stop mattering. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Header aliases. The left side is the canonical field; the right side lists what her
 * workbook might plausibly call it.
 *
 * NOTE: these are educated guesses until the real CSVs arrive. Once we have them,
 * verify and trim this list rather than leaving speculative entries in place.
 */
const POLISH_ALIASES: Record<string, string[]> = {
  brand: ['brand', 'brandname', 'maker', 'company'],
  name: ['name', 'polishname', 'polish', 'shade', 'shadename', 'colorname'],
  color: ['color', 'color', 'colorfamily', 'colorfamily', 'colorgroup'],
  finish: ['finish', 'finishtype', 'type'],
  swatch_hex: ['swatchhex', 'hex', 'hexcode', 'swatch', 'colorhex'],
  notes: ['notes', 'note', 'comments', 'comment'],
  archived: ['archived', 'usedup', 'gone', 'retired'],
};

const WISHLIST_ALIASES: Record<string, string[]> = {
  brand: POLISH_ALIASES.brand,
  name: POLISH_ALIASES.name,
  color: POLISH_ALIASES.color,
  finish: POLISH_ALIASES.finish,
  swatch_hex: POLISH_ALIASES.swatch_hex,
  where_sold: ['wheresold', 'where', 'retailer', 'store', 'soldat'],
  typical_price: ['typicalprice', 'price', 'usualprice', 'cost'],
  sale_window: ['salewindow', 'usualsalewindow', 'sale', 'saleevent'],
  priority: ['priority'],
  status: ['status'],
  link: ['link', 'url', 'website'],
  notes: POLISH_ALIASES.notes,
};

/** Map the file's headers onto canonical field names. */
export function mapHeaders(
  headers: readonly string[],
  aliases: Record<string, string[]>,
): Map<string, string> {
  const mapping = new Map<string, string>();
  for (const header of headers) {
    const normalised = normaliseHeader(header);
    for (const [field, candidates] of Object.entries(aliases)) {
      if (candidates.includes(normalised)) {
        // First header wins, so a duplicated column does not silently override.
        if (!mapping.has(field)) mapping.set(field, header);
        break;
      }
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/**
 * Match an enum value tolerantly. Her spreadsheet is hand-maintained, so "cream",
 * "Cream ", and "CREAM" all have to land on the same enum member — but anything that
 * is not a real member becomes a reported problem rather than a silent default.
 */
export function coerceEnum<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T | null {
  if (value === null || value === undefined) return null;
  const needle = normaliseHeader(value);
  if (needle === '') return null;

  const exact = allowed.find((option) => normaliseHeader(option) === needle);
  if (exact) return exact;

  // Handle the slash-joined members ("Nude/Beige", "Multi/Glitter") where she may
  // have written only one side of the pair.
  const partial = allowed.find((option) =>
    option.split('/').some((part) => normaliseHeader(part) === needle),
  );
  return partial ?? null;
}

export function coerceBoolean(value: string | null | undefined): boolean {
  if (!value) return false;
  return ['true', 'yes', 'y', '1', 'x'].includes(value.trim().toLowerCase());
}

/** Parse a number from a spreadsheet cell, tolerating currency symbols and commas. */
export function coerceNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.replace(/[^0-9.-]/g, '').trim();
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a date cell into `YYYY-MM-DD`.
 *
 * Deliberately does NOT fall back to `new Date(value)`. An ambiguous cell like
 * "01/02/2026" is either January 2nd or February 1st depending on locale, and quietly
 * guessing would corrupt her wear history in a way nobody would ever notice. Ambiguous
 * input is reported instead.
 */
export function coerceDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Google Sheets exports commonly land in M/D/YYYY.
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function parseCsv(text: string): { rows: Record<string, string>[]; headers: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });
  return {
    rows: parsed.data ?? [],
    headers: parsed.meta?.fields ?? [],
  };
}

/** Read a mapped column out of a row. */
function cell(
  row: Record<string, string>,
  mapping: Map<string, string>,
  field: string,
): string | null {
  const header = mapping.get(field);
  if (!header) return null;
  const value = row[header];
  return value === undefined || value === null ? null : value;
}

export function importCollectionCsv(text: string): ImportResult<PolishInput> {
  const { rows, headers } = parseCsv(text);
  const mapping = mapHeaders(headers, POLISH_ALIASES);
  const problems: RowProblem[] = [];

  for (const required of ['brand', 'name'] as const) {
    if (!mapping.has(required)) {
      problems.push({
        row: 1,
        column: required,
        message: `Could not find a "${required}" column. Found: ${headers.join(', ')}`,
      });
    }
  }
  if (problems.length > 0) return { rows: [], problems };

  const imported: PolishInput[] = [];

  rows.forEach((row, index) => {
    const lineNumber = index + 2; // +1 for the header, +1 for 1-based counting.

    const rawColor = cell(row, mapping, 'color');
    const rawFinish = cell(row, mapping, 'finish');
    const color = coerceEnum<Color>(rawColor, COLORS);
    const finish = coerceEnum<Finish>(rawFinish, FINISHES);

    // Skip rows that are entirely blank — trailing empties are normal in a workbook.
    const brand = cell(row, mapping, 'brand')?.trim() ?? '';
    const name = cell(row, mapping, 'name')?.trim() ?? '';
    if (brand === '' && name === '') return;

    if (color === null && rawColor?.trim()) {
      problems.push({
        row: lineNumber, column: 'color',
        message: `"${rawColor}" is not a known color`, raw: rawColor,
      });
    }
    if (finish === null && rawFinish?.trim()) {
      problems.push({
        row: lineNumber, column: 'finish',
        message: `"${rawFinish}" is not a known finish`, raw: rawFinish,
      });
    }

    const candidate = {
      brand,
      name,
      // Fall back rather than drop the row: a polish with an unrecognised color is
      // still her polish, and she can fix the bucket later in the app.
      color: color ?? 'Multi/Glitter',
      finish: finish ?? 'Other',
      swatch_hex: cell(row, mapping, 'swatch_hex'),
      photo_path: null,
      notes: cell(row, mapping, 'notes'),
      archived: coerceBoolean(cell(row, mapping, 'archived')),
    };

    const result = polishInputSchema.safeParse(candidate);
    if (result.success) {
      imported.push(result.data);
    } else {
      for (const issue of result.error.issues) {
        problems.push({
          row: lineNumber,
          column: String(issue.path[0] ?? ''),
          message: issue.message,
        });
      }
    }
  });

  return { rows: imported, problems };
}

/**
 * The wear log. Rows reference a polish by "Brand - Name" text, exactly as the
 * spreadsheet's dropdown stored it, so the caller supplies a resolver that maps a
 * dedupe key to a real polish id.
 */
export interface WearCsvRow {
  polish_id: string;
  worn_on: string;
  rating: number | null;
  days_lasted: number | null;
  notes: string | null;
}

const WEAR_ALIASES: Record<string, string[]> = {
  polish: ['polish', 'polishname', 'brandandname', 'brandname', 'name', 'wornpolish'],
  worn_on: ['date', 'dateworn', 'wornon', 'worn', 'day'],
  rating: ['rating', 'stars', 'score'],
  days_lasted: ['dayslasted', 'lasted', 'wear', 'daysitlasted', 'duration'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

export function importWearCsv(
  text: string,
  resolvePolishId: (label: string) => string | null,
): ImportResult<WearCsvRow> {
  const { rows, headers } = parseCsv(text);
  const mapping = mapHeaders(headers, WEAR_ALIASES);
  const problems: RowProblem[] = [];

  for (const required of ['polish', 'worn_on'] as const) {
    if (!mapping.has(required)) {
      problems.push({
        row: 1, column: required,
        message: `Could not find a "${required}" column. Found: ${headers.join(', ')}`,
      });
    }
  }
  if (problems.length > 0) return { rows: [], problems };

  const imported: WearCsvRow[] = [];

  rows.forEach((row, index) => {
    const lineNumber = index + 2;
    const label = cell(row, mapping, 'polish')?.trim() ?? '';
    const rawDate = cell(row, mapping, 'worn_on');

    if (label === '' && !rawDate?.trim()) return;

    const polishId = resolvePolishId(label);
    if (polishId === null) {
      problems.push({
        row: lineNumber, column: 'polish',
        message: `No polish in the collection matches "${label}"`, raw: label,
      });
      return;
    }

    const wornOn = coerceDate(rawDate);
    if (wornOn === null) {
      problems.push({
        row: lineNumber, column: 'worn_on',
        message: `Could not read "${rawDate ?? ''}" as a date. Use YYYY-MM-DD.`,
        raw: rawDate ?? '',
      });
      return;
    }

    const rating = coerceNumber(cell(row, mapping, 'rating'));
    const daysLasted = coerceNumber(cell(row, mapping, 'days_lasted'));

    if (rating !== null && (rating < 1 || rating > 5)) {
      problems.push({
        row: lineNumber, column: 'rating',
        message: `Rating ${rating} is outside 1-5`,
      });
    }

    imported.push({
      polish_id: polishId,
      worn_on: wornOn,
      rating: rating !== null && rating >= 1 && rating <= 5 ? Math.round(rating) : null,
      days_lasted: daysLasted !== null && daysLasted >= 0 ? Math.round(daysLasted) : null,
      notes: cell(row, mapping, 'notes')?.trim() || null,
    });
  });

  return { rows: imported, problems };
}

export function importWishlistCsv(text: string): ImportResult<WishlistInput> {
  const { rows, headers } = parseCsv(text);
  const mapping = mapHeaders(headers, WISHLIST_ALIASES);
  const problems: RowProblem[] = [];

  for (const required of ['brand', 'name'] as const) {
    if (!mapping.has(required)) {
      problems.push({
        row: 1, column: required,
        message: `Could not find a "${required}" column. Found: ${headers.join(', ')}`,
      });
    }
  }
  if (problems.length > 0) return { rows: [], problems };

  const imported: WishlistInput[] = [];

  rows.forEach((row, index) => {
    const lineNumber = index + 2;
    const brand = cell(row, mapping, 'brand')?.trim() ?? '';
    const name = cell(row, mapping, 'name')?.trim() ?? '';
    if (brand === '' && name === '') return;

    const candidate = {
      brand,
      name,
      color: coerceEnum<Color>(cell(row, mapping, 'color'), COLORS) ?? 'Multi/Glitter',
      finish: coerceEnum<Finish>(cell(row, mapping, 'finish'), FINISHES) ?? 'Other',
      swatch_hex: cell(row, mapping, 'swatch_hex'),
      where_sold: cell(row, mapping, 'where_sold'),
      typical_price: coerceNumber(cell(row, mapping, 'typical_price')),
      sale_window: coerceEnum<SaleWindow>(cell(row, mapping, 'sale_window'), SALE_WINDOWS),
      priority: coerceEnum<Priority>(cell(row, mapping, 'priority'), PRIORITIES) ?? 'Medium',
      status: coerceEnum<Status>(cell(row, mapping, 'status'), STATUSES) ?? 'Wanting',
      link: cell(row, mapping, 'link'),
      notes: cell(row, mapping, 'notes'),
    };

    const result = wishlistInputSchema.safeParse(candidate);
    if (result.success) {
      imported.push(result.data);
    } else {
      for (const issue of result.error.issues) {
        problems.push({
          row: lineNumber,
          column: String(issue.path[0] ?? ''),
          message: issue.message,
        });
      }
    }
  });

  return { rows: imported, problems };
}

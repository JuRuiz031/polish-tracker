import Papa from 'papaparse';
import { EXPORT_VERSION } from '../../domain/schema';
import type { ExportBundle } from '../../domain/schema';
import type { Polish, Wear, WishlistItem } from '../../domain/types';

/**
 * Export — the escape hatch.
 *
 * Requirement #3 in the brief and non-negotiable: if this project ever goes
 * unmaintained, she must be able to walk away with everything. Two formats, because
 * they serve different purposes:
 *
 *   JSON — lossless and re-importable. This is the backup.
 *   CSV  — one file per table, opens in Sheets or Excel. This is the readable copy,
 *          and it is what lets her go back to a spreadsheet if she ever wants to.
 *
 * Soft-deleted rows ARE included. An export is a backup, not a view, and dropping
 * them would silently discard data that Undo could still restore.
 */

export function buildExportBundle(
  polish: readonly Polish[],
  wear: readonly Wear[],
  wishlist: readonly WishlistItem[],
  now: Date = new Date(),
): ExportBundle {
  return {
    version: EXPORT_VERSION,
    exported_at: now.toISOString(),
    // Sorted by id so two exports of identical data are byte-identical, which is what
    // makes the nightly backup diffable and the round-trip test meaningful.
    polish: [...polish].sort(byId),
    wear: [...wear].sort(byId),
    wishlist: [...wishlist].sort(byId),
  } as ExportBundle;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Canonical JSON: keys sorted recursively, so the same data always serialises to the
 * same bytes.
 *
 * Without this, an export → import → export cycle is value-identical but byte-different,
 * because validation rebuilds each object in schema order rather than the order the
 * row happened to arrive in. That would make every nightly backup show a full-file
 * diff and hide the one line that actually changed.
 */
export function toJson(bundle: ExportBundle): string {
  return JSON.stringify(canonicalise(bundle), null, 2);
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    // Drop undefined rather than letting JSON.stringify silently omit it, so the
    // presence of a key never depends on how the object was constructed.
    if (source[key] !== undefined) sorted[key] = canonicalise(source[key]);
  }
  return sorted;
}

/**
 * CSV column order is pinned rather than derived from Object.keys, so the header row
 * stays stable across releases and a diff of two backups shows only real changes.
 */
export const CSV_COLUMNS = {
  polish: [
    'id', 'brand', 'name', 'color', 'finish', 'swatch_hex', 'photo_path', 'notes',
    'archived', 'created_at', 'updated_at', 'deleted_at',
  ],
  wear: [
    'id', 'polish_id', 'worn_on', 'rating', 'days_lasted', 'notes',
    'created_at', 'updated_at', 'deleted_at',
  ],
  wishlist: [
    'id', 'brand', 'name', 'color', 'finish', 'swatch_hex', 'where_sold', 'typical_price',
    'sale_window', 'priority', 'status', 'link', 'notes',
    'created_at', 'updated_at', 'deleted_at',
  ],
} as const;

type TableName = keyof typeof CSV_COLUMNS;

export function toCsv<T extends object>(rows: readonly T[], table: TableName): string {
  const columns = CSV_COLUMNS[table];
  return Papa.unparse(
    {
      fields: [...columns],
      data: rows.map((row) =>
        columns.map((column) => serialiseCell((row as Record<string, unknown>)[column])),
      ),
    },
    // CRLF is what Excel expects, and Sheets accepts either.
    { newline: '\r\n' },
  );
}

/**
 * null becomes an empty cell rather than the string "null" — otherwise a re-import
 * would faithfully restore the four characters n-u-l-l into her notes field.
 */
function serialiseCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

/** Every file for a full export, ready to be zipped or downloaded individually. */
export function buildExportFiles(bundle: ExportBundle, now: Date = new Date()): ExportFile[] {
  const stamp = now.toISOString().slice(0, 10);
  return [
    {
      filename: `polish-backup-${stamp}.json`,
      mimeType: 'application/json',
      content: toJson(bundle),
    },
    {
      filename: `polish-collection-${stamp}.csv`,
      mimeType: 'text/csv',
      content: toCsv(bundle.polish, 'polish'),
    },
    {
      filename: `polish-wear-log-${stamp}.csv`,
      mimeType: 'text/csv',
      content: toCsv(bundle.wear, 'wear'),
    },
    {
      filename: `polish-wishlist-${stamp}.csv`,
      mimeType: 'text/csv',
      content: toCsv(bundle.wishlist, 'wishlist'),
    },
  ];
}

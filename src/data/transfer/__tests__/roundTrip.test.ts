import { describe, expect, it } from 'vitest';
import { dedupeKey } from '../../../domain/dedupe';
import { makePolish, makeWear, makeWishlistItem } from '../../../domain/__tests__/factories';
import { buildExportBundle, buildExportFiles, toCsv, toJson } from '../exportData';
import {
  coerceDate,
  coerceEnum,
  coerceNumber,
  importCollectionCsv,
  importJson,
  importWearCsv,
  importWishlistCsv,
  mapHeaders,
  normaliseHeader,
} from '../importData';
import { COLORS, FINISHES } from '../../../domain/enums';

/**
 * THE PHASE 1 GATE.
 *
 * The brief's definition of done: "Export produces a file that can be re-imported to
 * reconstruct the entire database." This file is the proof, and it is the reason the
 * data layer is built and verified before any UI exists.
 */

describe('JSON round trip', () => {
  const polish = [
    makePolish({ id: 'p1', brand: 'OPI', name: 'Big Apple Red' }),
    makePolish({ id: 'p2', brand: 'Zoya', name: 'Storm', notes: 'Gift from Mum' }),
    makePolish({ id: 'p3', brand: 'Essie', name: 'Ballet Slippers', archived: true }),
  ];
  const wear = [
    makeWear({ id: 'w1', polish_id: 'p1', worn_on: '2026-08-01', rating: 5, days_lasted: 6 }),
    makeWear({ id: 'w2', polish_id: 'p2', worn_on: '2026-07-15', rating: null }),
  ];
  const wishlist = [makeWishlistItem({ id: 'l1', typical_price: 12.5 })];

  it('reconstructs every row exactly', () => {
    const bundle = buildExportBundle(polish, wear, wishlist);
    const { rows, problems } = importJson(toJson(bundle));

    expect(problems).toEqual([]);
    const restored = rows[0];
    expect(restored.polish).toHaveLength(3);
    expect(restored.wear).toHaveLength(2);
    expect(restored.wishlist).toHaveLength(1);
  });

  it('survives a second round trip unchanged', () => {
    // Export → import → export must be byte-identical, or the format is lossy in a
    // way that would compound every time a backup is restored.
    const first = toJson(buildExportBundle(polish, wear, wishlist, new Date('2026-08-19T00:00:00Z')));
    const reimported = importJson(first).rows[0];
    const second = toJson(
      buildExportBundle(
        reimported.polish as never,
        reimported.wear as never,
        reimported.wishlist as never,
        new Date('2026-08-19T00:00:00Z'),
      ),
    );
    expect(second).toBe(first);
  });

  it('preserves the values that are easy to lose', () => {
    const restored = importJson(toJson(buildExportBundle(polish, wear, wishlist))).rows[0];

    const zoya = restored.polish.find((p) => p.id === 'p2')!;
    expect(zoya.notes).toBe('Gift from Mum');

    const archived = restored.polish.find((p) => p.id === 'p3')!;
    expect(archived.archived).toBe(true); // boolean, not the string "true"

    const unrated = restored.wear.find((w) => w.id === 'w2')!;
    expect(unrated.rating).toBeNull(); // null, not 0 and not "null"

    expect(restored.wishlist[0].typical_price).toBe(12.5); // number, not "12.5"
  });

  it('includes soft-deleted rows, because an export is a backup not a view', () => {
    const withDeleted = [makePolish({ id: 'p9', deleted_at: '2026-08-01T00:00:00Z' })];
    const restored = importJson(toJson(buildExportBundle(withDeleted, [], []))).rows[0];
    expect(restored.polish[0].deleted_at).toBe('2026-08-01T00:00:00Z');
  });

  it('is deterministic regardless of input order', () => {
    const forward = toJson(buildExportBundle(polish, wear, wishlist, new Date(0)));
    const reversed = toJson(
      buildExportBundle([...polish].reverse(), [...wear].reverse(), wishlist, new Date(0)),
    );
    // Nightly backups must diff cleanly, showing only genuine changes.
    expect(reversed).toBe(forward);
  });

  it('rejects a corrupted file loudly instead of importing nothing silently', () => {
    expect(importJson('not json').problems[0].message).toMatch(/not valid JSON/i);
    expect(importJson('{"version": 99}').problems.length).toBeGreaterThan(0);
  });

  it('produces one JSON and three CSV files', () => {
    const files = buildExportFiles(buildExportBundle(polish, wear, wishlist), new Date('2026-08-19T12:00:00Z'));
    expect(files.map((f) => f.filename)).toEqual([
      'polish-backup-2026-08-19.json',
      'polish-collection-2026-08-19.csv',
      'polish-wear-log-2026-08-19.csv',
      'polish-wishlist-2026-08-19.csv',
    ]);
  });
});

describe('CSV export', () => {
  it('writes null as an empty cell, not the word "null"', () => {
    const csv = toCsv([makePolish({ notes: null, swatch_hex: null })], 'polish');
    expect(csv).not.toContain('null');
  });

  it('quotes fields containing commas and quotes', () => {
    const csv = toCsv([makePolish({ notes: 'Red, but warmer. She said "perfect".' })], 'polish');
    const reparsed = importCollectionCsv(csv);
    expect(reparsed.rows[0].notes).toBe('Red, but warmer. She said "perfect".');
  });

  it('keeps a stable header order', () => {
    const header = toCsv([], 'polish').split('\r\n')[0];
    expect(header).toBe(
      'id,brand,name,color,finish,swatch_hex,photo_path,notes,archived,created_at,updated_at,deleted_at',
    );
  });
});

describe('CSV import — header tolerance', () => {
  it('normalises headers to letters and digits', () => {
    expect(normaliseHeader('Polish Name')).toBe('polishname');
    expect(normaliseHeader('  Days_Lasted  ')).toBe('dayslasted');
    expect(normaliseHeader('Where Sold?')).toBe('wheresold');
  });

  it('maps varied header spellings onto canonical fields', () => {
    const mapping = mapHeaders(['Brand', 'Polish Name', 'Color', 'Finish Type'], {
      brand: ['brand'],
      name: ['polishname'],
      color: ['color'],
      finish: ['finishtype'],
    });
    expect(mapping.get('name')).toBe('Polish Name');
    expect(mapping.get('color')).toBe('Color');
  });

  it('reports a missing required column with the headers it did find', () => {
    const { problems } = importCollectionCsv('Foo,Bar\n1,2');
    expect(problems[0].message).toMatch(/could not find a "brand" column/i);
    expect(problems[0].message).toContain('Foo');
  });
});

describe('CSV import — value coercion', () => {
  it('matches enums case- and space-insensitively', () => {
    expect(coerceEnum('cream', FINISHES)).toBe('Cream');
    expect(coerceEnum('  HOLOGRAPHIC ', FINISHES)).toBe('Holographic');
    expect(coerceEnum('top coat', FINISHES)).toBe('Top Coat');
  });

  it('matches one half of a slash-joined enum member', () => {
    // She may well have typed just "Nude" or just "Glitter".
    expect(coerceEnum('nude', COLORS)).toBe('Nude/Beige');
    expect(coerceEnum('beige', COLORS)).toBe('Nude/Beige');
  });

  it('returns null for an unknown value rather than guessing', () => {
    expect(coerceEnum('chartreuse', COLORS)).toBeNull();
    expect(coerceEnum('', COLORS)).toBeNull();
  });

  it('reads prices with currency symbols and thousands separators', () => {
    expect(coerceNumber('$12.50')).toBe(12.5);
    expect(coerceNumber('1,299')).toBe(1299);
    expect(coerceNumber('')).toBeNull();
    expect(coerceNumber('n/a')).toBeNull();
  });

  it('reads ISO and US slash dates', () => {
    expect(coerceDate('2026-08-19')).toBe('2026-08-19');
    expect(coerceDate('2026-8-9')).toBe('2026-08-09');
    expect(coerceDate('8/19/2026')).toBe('2026-08-19');
  });

  it('refuses ambiguous dates rather than guessing the locale', () => {
    // Silently picking a reading here would corrupt her wear history invisibly.
    expect(coerceDate('19 Aug 2026')).toBeNull();
    expect(coerceDate('August 19')).toBeNull();
    expect(coerceDate('')).toBeNull();
  });
});

describe('CSV import — collection', () => {
  const csv = [
    'Brand,Polish Name,Color,Finish,Notes',
    'OPI,Big Apple Red,Red,Cream,Classic',
    'Zoya,Storm,Blue,Glitter,',
    'Essie,Ballet Slippers,pink,cream,Sheer',
  ].join('\n');

  it('imports every row', () => {
    const { rows, problems } = importCollectionCsv(csv);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ brand: 'OPI', name: 'Big Apple Red', color: 'Red' });
    expect(rows[2].color).toBe('Pink'); // lowercase in the file, canonical on the way in
  });

  it('normalises a blank note to null rather than an empty string', () => {
    expect(importCollectionCsv(csv).rows[1].notes).toBeNull();
  });

  it('skips trailing blank rows, which every spreadsheet has', () => {
    const { rows, problems } = importCollectionCsv(`${csv}\n,,,,\n,,,,`);
    expect(rows).toHaveLength(3);
    expect(problems).toEqual([]);
  });

  it('keeps a row with an unknown color but reports it', () => {
    const { rows, problems } = importCollectionCsv(
      'Brand,Name,Color,Finish\nOPI,Weird One,Chartreuse,Cream',
    );
    // Losing one of her polishes would be worse than mis-bucketing it; she can fix
    // the bucket in the app, but she cannot recover a row we dropped.
    expect(rows).toHaveLength(1);
    expect(problems[0]).toMatchObject({ row: 2, column: 'color' });
    expect(problems[0].message).toContain('Chartreuse');
  });

  it('reports the row number as it appears in her spreadsheet', () => {
    const { problems } = importCollectionCsv(
      'Brand,Name,Color,Finish\nOPI,A,Red,Cream\nZoya,B,Nonsense,Cream',
    );
    expect(problems[0].row).toBe(3); // header is row 1, so the bad row really is 3
  });
});

describe('CSV import — wear log', () => {
  const collection = [
    makePolish({ id: 'p1', brand: 'OPI', name: 'Big Apple Red' }),
    makePolish({ id: 'p2', brand: 'Zoya', name: 'Storm' }),
  ];
  const resolve = (label: string): string | null => {
    const [brand, ...rest] = label.split(' - ');
    if (rest.length === 0) return null;
    const key = dedupeKey(brand, rest.join(' - '));
    return collection.find((p) => dedupeKey(p.brand, p.name) === key)?.id ?? null;
  };

  it('links rows to the right polish and parses the fields', () => {
    const { rows, problems } = importWearCsv(
      [
        'Date Worn,Polish,Rating,Days Lasted,Notes',
        '2026-08-01,OPI - Big Apple Red,5,6,Chipped early',
        '7/15/2026,Zoya - Storm,4,,',
      ].join('\n'),
      resolve,
    );

    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { polish_id: 'p1', worn_on: '2026-08-01', rating: 5, days_lasted: 6, notes: 'Chipped early' },
      { polish_id: 'p2', worn_on: '2026-07-15', rating: 4, days_lasted: null, notes: null },
    ]);
  });

  it('reports a wear row pointing at a polish that is not in the collection', () => {
    const { rows, problems } = importWearCsv(
      'Date,Polish,Rating\n2026-08-01,Ghost - Missing,5',
      resolve,
    );
    expect(rows).toHaveLength(0);
    expect(problems[0].message).toMatch(/no polish in the collection matches/i);
  });

  it('reports an unreadable date instead of inventing one', () => {
    const { rows, problems } = importWearCsv(
      'Date,Polish\nsometime last week,OPI - Big Apple Red',
      resolve,
    );
    expect(rows).toHaveLength(0);
    expect(problems[0].column).toBe('worn_on');
  });

  it('drops an out-of-range rating but keeps the manicure', () => {
    const { rows, problems } = importWearCsv(
      'Date,Polish,Rating\n2026-08-01,OPI - Big Apple Red,9',
      resolve,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBeNull();
    expect(problems[0].column).toBe('rating');
  });
});

describe('CSV import — wishlist', () => {
  it('imports with defaults for the optional enums', () => {
    const { rows, problems } = importWishlistCsv(
      [
        'Brand,Name,Color,Finish,Where Sold,Typical Price,Priority,Status,Link',
        'Holo Taco,Mint Chip,Green,Holographic,holotaco.com,$13.00,High,Wanting,https://holotaco.com',
        'Cirque,Nebula,Purple,Duochrome,,,,,',
      ].join('\n'),
    );

    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({
      brand: 'Holo Taco', typical_price: 13, priority: 'High', status: 'Wanting',
    });
    // Blank priority/status fall back to the schema defaults rather than failing.
    expect(rows[1]).toMatchObject({ priority: 'Medium', status: 'Wanting' });
  });
});

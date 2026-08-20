import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORS, FINISHES, PRIORITIES, SALE_WINDOWS, STATUSES } from '../../domain/enums';
import { dedupeKey } from '../../domain/dedupe';
import { polishInputSchema, wearInputSchema, wishlistInputSchema } from '../../domain/schema';

/**
 * The client and the database hold the same rules in two languages. Nothing at runtime
 * forces them to agree, and a drift between them is invisible until real data hits a
 * constraint — which, for a single-user app that syncs from a phone, means a write that
 * silently fails long after the change that broke it.
 *
 * These tests read the migrations as text and assert the pairings that matter. They are
 * not a substitute for running the SQL (nothing here proves the migration executes), but
 * they do catch the failure mode that actually happens: someone edits one side.
 */

const url = (file: string) => new URL(`../../../supabase/migrations/${file}`, import.meta.url);
const schemaSql = readFileSync(url('0001_schema.sql'), 'utf8');
const rlsSql = readFileSync(url('0002_rls.sql'), 'utf8');
const viewsSql = readFileSync(url('0003_views.sql'), 'utf8');

/**
 * Executable SQL only.
 *
 * These files are heavily commented, and the comments quote the very expressions being
 * asserted on — so a naive text match happily passes against a sentence explaining why
 * something was removed. Strip them, and the assertions describe the schema rather than
 * the prose about it.
 */
function code(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

function sqlEnum(name: string): string[] {
  const match = new RegExp(`create type ${name}\\s+as enum \\(([\\s\\S]*?)\\);`).exec(schemaSql);
  if (!match) throw new Error(`enum ${name} not found in 0001_schema.sql`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

describe('enum values match the Postgres types exactly', () => {
  // Order matters as much as membership: importData coerces by matching against these
  // lists, and a value present in one place and not the other is a rejected row.
  it.each([
    ['polish_color', COLORS],
    ['polish_finish', FINISHES],
    ['sale_window', SALE_WINDOWS],
    ['wishlist_priority', PRIORITIES],
    ['wishlist_status', STATUSES],
  ])('%s', (typeName, values) => {
    expect(sqlEnum(typeName)).toEqual([...values]);
  });
});

describe('the duplicate key is an index, not a column', () => {
  it('no generated column survives in either table', () => {
    // A generated column cannot appear in an INSERT, so its return would silently break
    // every write path and every restore of a JSON backup.
    expect(schemaSql).not.toMatch(/generated always as/);
  });

  it('both dedupe indexes use the expression domain/dedupe.ts computes', () => {
    const expression = "lower(btrim(brand)) || ' - ' || lower(btrim(name))";
    // One index on polish, one on wishlist, and nothing else in executable SQL.
    expect(code(schemaSql)).toContain(`user_id, (${expression})`);
    expect(code(schemaSql).match(new RegExp(escapeRegex(expression), 'g'))).toHaveLength(2);
  });

  it('dedupeKey() produces exactly what the SQL expression would', () => {
    // Both sides: lowercase, ends trimmed, joined by ' - '.
    expect(dedupeKey('OPI', 'Big Apple Red')).toBe('opi - big apple red');
    expect(dedupeKey('  Essie  ', '  Bordeaux  ')).toBe('essie - bordeaux');
  });

  it('normalised input removes the case where JS and Postgres trim differently', () => {
    // JS .trim() strips tabs; Postgres btrim() does not. requiredText collapses all
    // whitespace before either gets a chance to disagree, so the divergence is
    // unreachable rather than merely handled.
    const parsed = polishInputSchema.parse({
      brand: ' OPI\t ', name: 'Big\n\nApple   Red',
      color: 'Red', finish: 'Cream', swatch_hex: null, photo_path: null, notes: null,
    });
    expect(parsed.brand).toBe('OPI');
    expect(parsed.name).toBe('Big Apple Red');
    expect(parsed.brand).not.toMatch(/\s/);
  });
});

describe('CHECK constraints and zod agree on bounds', () => {
  it('days_lasted is 0-365 on both sides', () => {
    expect(schemaSql).toMatch(/days_lasted int check \(days_lasted between 0 and 365\)/);
    const overLimit = wearInputSchema.safeParse({
      polish_id: 'p', worn_on: '2026-01-01', rating: null, days_lasted: 366, notes: null,
    });
    expect(overLimit.success).toBe(false);
  });

  it('rating is 1-5 on both sides', () => {
    expect(schemaSql).toMatch(/rating\s+int check \(rating between 1 and 5\)/);
    for (const rating of [0, 6]) {
      expect(wearInputSchema.safeParse({
        polish_id: 'p', worn_on: '2026-01-01', rating, days_lasted: null, notes: null,
      }).success).toBe(false);
    }
  });

  it('typical_price cannot exceed what numeric(10,2) holds', () => {
    expect(schemaSql).toMatch(/typical_price numeric\(10, 2\)/);
    expect(price(100_000_000).success).toBe(false); // would raise 22003 in Postgres
    expect(price(99_999_999.99).success).toBe(true);
  });

  it('typical_price is rounded client-side so Postgres never silently changes it', () => {
    const parsed = price(12.345);
    // numeric(10,2) would store 12.35; rounding here means the value sent is the value
    // stored is the value exported.
    expect(parsed.success && parsed.data.typical_price).toBe(12.35);
  });

  it('brand and name are stored pre-normalised, enforced by CHECK', () => {
    const normalise = /= btrim\(regexp_replace\((brand|name),\s*'\\s\+', ' ', 'g'\)\)/g;
    // polish.brand, polish.name, wishlist.brand, wishlist.name
    expect(schemaSql.match(normalise)).toHaveLength(4);
  });
});

describe('the wishlist Bought state', () => {
  it('resolves rather than deletes, and the link implies the status', () => {
    expect(schemaSql).toMatch(/bought_polish_id uuid/);
    expect(schemaSql).toMatch(/bought_on\s+date/);
    expect(schemaSql).toMatch(
      /check \(\s*bought_polish_id is null or status = 'Bought'\s*\)/,
    );
  });

  it('uses column-scoped SET NULL so the NOT NULL user_id survives a hard delete', () => {
    expect(schemaSql).toMatch(/on delete set null \(bought_polish_id\)/);
  });

  it("'Bought' is not offered as a manual choice in forms", async () => {
    const { SELECTABLE_STATUSES } = await import('../../domain/enums');
    expect(STATUSES).toContain('Bought');
    expect(SELECTABLE_STATUSES).not.toContain('Bought');
    // ...but it must still parse, or stored and imported rows would be rejected.
    expect(wishlistInputSchema.safeParse({
      brand: 'OPI', name: 'X', color: 'Red', finish: 'Cream', swatch_hex: null,
      where_sold: null, typical_price: null, sale_window: null,
      priority: 'Medium', status: 'Bought', link: null, notes: null,
    }).success).toBe(true);
  });
});

describe('sync clock', () => {
  it('updated_at honours a client value but cannot move backwards', () => {
    // The bug this replaces: `new.updated_at := now()` stamps a replayed offline write
    // with its arrival time, so last-write-wins becomes last-to-arrive-wins.
    expect(schemaSql).toMatch(/new\.updated_at := greatest\(/);
    expect(schemaSql).toMatch(/coalesce\(nullif\(new\.updated_at, old\.updated_at\), now\(\)\)/);
    expect(schemaSql).not.toMatch(/new\.updated_at := now\(\);/);
  });
});

describe('security', () => {
  it('every view is security_invoker, or it bypasses RLS entirely', () => {
    const created = viewsSql.match(/^create view /gm) ?? [];
    const guarded = viewsSql.match(/^with \(security_invoker = on\)$/gm) ?? [];
    expect(created.length).toBeGreaterThan(0);
    expect(guarded).toHaveLength(created.length);
  });

  it('all three tables force RLS and are revoked from anon', () => {
    for (const table of ['polish', 'wear', 'wishlist']) {
      expect(rlsSql).toMatch(new RegExp(`alter table ${table}\\s+enable row level security`));
      expect(rlsSql).toMatch(new RegExp(`alter table ${table}\\s+force row level security`));
    }
    expect(rlsSql).toMatch(/revoke all on polish, wear, wishlist from anon/);
  });

  it('every policy carries both using and with check', () => {
    // `using` alone would let a user write a row stamped with someone else's user_id.
    const policies = rlsSql.match(/create policy [\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(3);
    for (const policy of policies) {
      expect(policy).toMatch(/using\s+\(user_id = \(select auth\.uid\(\)\)\)/);
      expect(policy).toMatch(/with check \(user_id = \(select auth\.uid\(\)\)\)/);
    }
  });
});

describe('views', () => {
  it('polish_duplicates returns only actual duplicates', () => {
    // It previously returned every live polish with a group_size column attached, so a
    // caller trusting the name got the whole collection back.
    expect(viewsSql).toMatch(/where group_size > 1/);
  });

  it('polish_stats does not publish a UTC days_since', () => {
    // current_date is the server's date; the client counts from local midnight. The two
    // disagree by a day every evening west of Greenwich, and days_since feeds the
    // picker's rest rule.
    expect(code(viewsSql)).not.toMatch(/current_date/);
    expect(code(viewsSql)).toMatch(/max\(w\.worn_on\)\s+as last_worn/);
  });

  it('wishlist_already_owned ignores rows that were bought', () => {
    expect(viewsSql).toMatch(/wl\.status\s+<> 'Bought'/);
  });
});

function price(value: number) {
  return wishlistInputSchema.safeParse({
    brand: 'OPI', name: 'X', color: 'Red', finish: 'Cream', swatch_hex: null,
    where_sold: null, typical_price: value, sale_window: null,
    priority: 'Medium', status: 'Wanting', link: null, notes: null,
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

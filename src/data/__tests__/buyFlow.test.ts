import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../repositories/memory';
import { flagWishlist } from '../../domain/dedupe';
import type { Snapshot } from '../repositories/types';

/**
 * "I bought it".
 *
 * The old flow copied six fields into the collection and then DELETED the wishlist row,
 * which threw away the price she expected to pay, where she meant to buy it, and how
 * long it had been on the list — the whole reason for keeping a wishlist at all. These
 * tests pin the replacement: the row is resolved, not destroyed.
 */

const EMPTY: Snapshot = { polish: [], wear: [], wishlist: [] };

async function withOneWishlistItem() {
  const repo = new InMemoryRepository({ ...EMPTY, polish: [], wear: [], wishlist: [] });
  const item = await repo.addWishlistItem({
    brand: 'ILNP',
    name: 'Mercury Rising',
    color: 'Silver',
    finish: 'Holographic',
    swatch_hex: '#B9BFC6',
    where_sold: 'ilnp.com',
    typical_price: 12.5,
    sale_window: 'Black Friday/Cyber Monday',
    priority: 'High',
    status: 'Wanting',
    link: null,
    notes: 'Saving for the holiday set.',
  });
  return { repo, item };
}

describe('buying a wishlist item', () => {
  it('keeps the row, marks it Bought, and links it to the new bottle', async () => {
    const { repo, item } = await withOneWishlistItem();

    const polish = await repo.addPolish({
      brand: item.brand,
      name: item.name,
      color: item.color,
      finish: item.finish,
      swatch_hex: item.swatch_hex,
      photo_path: null,
      notes: item.notes,
      archived: false,
    });
    await repo.markWishlistItemBought(item.id, polish.id, '2026-08-20');

    const snapshot = await repo.load();
    const resolved = snapshot.wishlist.find((row) => row.id === item.id);

    expect(snapshot.wishlist).toHaveLength(1);
    expect(resolved?.deleted_at).toBeNull();
    expect(resolved?.status).toBe('Bought');
    expect(resolved?.bought_polish_id).toBe(polish.id);
    expect(resolved?.bought_on).toBe('2026-08-20');
  });

  it('preserves the purchase context that used to be discarded', async () => {
    const { repo, item } = await withOneWishlistItem();
    const polish = await repo.addPolish({
      brand: item.brand, name: item.name, color: item.color, finish: item.finish,
      swatch_hex: item.swatch_hex, photo_path: null, notes: item.notes, archived: false,
    });
    await repo.markWishlistItemBought(item.id, polish.id, '2026-08-20');

    const resolved = (await repo.load()).wishlist[0];
    expect(resolved.typical_price).toBe(12.5);
    expect(resolved.where_sold).toBe('ilnp.com');
    expect(resolved.sale_window).toBe('Black Friday/Cyber Monday');
    expect(resolved.priority).toBe('High');
  });

  it('carries the swatch into the collection', async () => {
    const { repo, item } = await withOneWishlistItem();
    const polish = await repo.addPolish({
      brand: item.brand, name: item.name, color: item.color, finish: item.finish,
      swatch_hex: item.swatch_hex, photo_path: null, notes: item.notes, archived: false,
    });
    expect(polish.swatch_hex).toBe('#B9BFC6');
  });

  it('does not then flag the bought row as "you already own this"', async () => {
    const { repo, item } = await withOneWishlistItem();
    const polish = await repo.addPolish({
      brand: item.brand, name: item.name, color: item.color, finish: item.finish,
      swatch_hex: item.swatch_hex, photo_path: null, notes: item.notes, archived: false,
    });
    await repo.markWishlistItemBought(item.id, polish.id, '2026-08-20');

    const snapshot = await repo.load();
    const flags = flagWishlist(snapshot.wishlist, snapshot.polish);

    // The purchase created the very polish that would otherwise match it. Flagging that
    // would be telling her she already owns the thing she just bought.
    expect(flags.alreadyOwned.has(item.id)).toBe(false);
    expect(flags.duplicated.has(item.id)).toBe(false);
  });

  it('still flags a genuinely-owned item that was never bought through the app', async () => {
    const { repo, item } = await withOneWishlistItem();
    // Same bottle added to the collection directly — the amber "you already own this".
    await repo.addPolish({
      brand: 'ILNP', name: 'Mercury Rising', color: 'Silver', finish: 'Holographic',
      swatch_hex: '#B9BFC6', photo_path: null, notes: null, archived: false,
    });

    const snapshot = await repo.load();
    const flags = flagWishlist(snapshot.wishlist, snapshot.polish);
    expect(flags.alreadyOwned.has(item.id)).toBe(true);
  });
});

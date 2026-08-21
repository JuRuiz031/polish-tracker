import { useMemo, useState } from 'react';
import { FINISHES, PRIORITIES, SALE_WINDOWS, SELECTABLE_STATUSES } from '../../domain/enums';
import { wishlistInputSchema } from '../../domain/schema';
import { findCollisions } from '../../domain/dedupe';
import type { WishlistItem } from '../../domain/types';
import { useStore } from '../../app/storeContext';
import { Button, SelectField, TextAreaField, TextField } from '../../ui/primitives';
import { ColorPicker } from '../../ui/ColorPicker';
import { useSchemaForm } from '../../ui/useSchemaForm';
import type { Color } from '../../domain/enums';
import { colorOptions } from '../../ui/colorOptions';

const NONE = '';

export function WishlistForm({
  existing,
  onDone,
  onCancel,
}: {
  existing?: WishlistItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { allPolishes, allWishlist, addWishlistItem, editWishlistItem, showToast } = useStore();

  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState<string>(existing?.color ?? 'Red');
  const [finish, setFinish] = useState<string>(existing?.finish ?? 'Cream');
  const [swatch, setSwatch] = useState(existing?.swatch_hex ?? '');
  const [whereSold, setWhereSold] = useState(existing?.where_sold ?? '');
  const [price, setPrice] = useState(
    existing?.typical_price === null || existing?.typical_price === undefined
      ? ''
      : String(existing.typical_price),
  );
  const [saleWindow, setSaleWindow] = useState<string>(existing?.sale_window ?? NONE);
  const [priority, setPriority] = useState<string>(existing?.priority ?? 'Medium');
  const [status, setStatus] = useState<string>(existing?.status ?? 'Wanting');
  const [link, setLink] = useState(existing?.link ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { errors, saving, submit } = useSchemaForm(wishlistInputSchema);

  /**
   * Live duplicate detection, in the two flavours the wishlist has to tell apart — the
   * same split `flagWishlist` makes for the list view, moved to entry time so she hears
   * about it before saving rather than after.
   *
   * Neither blocks submission. "Already owned" is not even a mistake: she may want a
   * backup of a favourite, exactly as the collection form allows. "Already listed" is
   * closer to a slip, but it is still her call — the app says so and gets out of the way.
   *
   * Checked against the `all*` lists because `isCountable` does the filtering itself, and
   * it excludes more than deleted rows: an archived bottle she used up should not suppress
   * a wishlist entry to replace it, and a Bought wishlist row is history rather than an
   * intention.
   */
  const owned = useMemo(() => {
    if (brand.trim() === '' || name.trim() === '') return [];
    return findCollisions(allPolishes, brand, name);
  }, [allPolishes, brand, name]);

  const alreadyListed = useMemo(() => {
    if (brand.trim() === '' || name.trim() === '') return [];
    return findCollisions(allWishlist, brand, name, existing?.id);
  }, [allWishlist, brand, name, existing?.id]);

  async function save() {
    await submit(
      {
        brand,
        name,
        color,
        finish,
        swatch_hex: swatch,
        where_sold: whereSold,
        typical_price: price.trim() === '' ? null : Number(price),
        sale_window: saleWindow === NONE ? null : saleWindow,
        priority,
        status,
        link,
        notes,
      },
      async (input) => {
        if (existing) {
          await editWishlistItem(existing.id, input);
          showToast({ message: 'Wishlist item updated.' });
        } else {
          await addWishlistItem(input);
          showToast({ message: `Added ${input.brand} ${input.name} to the wishlist.` });
        }
        onDone();
      },
    );
  }

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <TextField
        label="Brand"
        value={brand}
        error={errors.brand}
        onChange={(value) => setBrand(value)}
        autoComplete="off"
        autoFocus
      />
      <TextField
        label="Name"
        value={name}
        error={errors.name}
        onChange={(value) => setName(value)}
        autoComplete="off"
      />

      {/* Both advisory, and deliberately worded differently — see the memos above. */}
      {owned.length > 0 && (
        <div className="notice notice--owned" role="status">
          <p>
            You already have{' '}
            <strong>
              {owned[0].brand} {owned[0].name}
            </strong>{' '}
            in the collection.
          </p>
          <p className="notice__aside">
            Still fine to want a backup — saving will keep both.
          </p>
        </div>
      )}
      {alreadyListed.length > 0 && (
        <div className="notice notice--duplicate" role="status">
          <p>This is already on the wishlist.</p>
          <p className="notice__aside">
            Saving will list it twice, which is usually a slip rather than intentional.
          </p>
        </div>
      )}

      <div className="form__row">
        <SelectField
          label="Color"
          value={color}
          onChange={(value) => setColor(value)}
          options={colorOptions()}
        />
        <SelectField
          label="Finish"
          value={finish}
          onChange={(value) => setFinish(value)}
          options={FINISHES}
        />
      </div>

      <ColorPicker
        family={color as Color}
        value={swatch === '' ? null : swatch}
        onChange={(hex) => setSwatch(hex ?? '')}
      />

      <div className="form__row">
        <SelectField
          label="Priority"
          value={priority}
          onChange={(value) => setPriority(value)}
          options={PRIORITIES}
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(value) => setStatus(value)}
          /* Not STATUSES: 'Bought' is written by the "I bought it" action together with
             a link to the bottle it created, and the database requires that pairing.
             Offering it here would let her claim a purchase with nothing to point at. */
          options={SELECTABLE_STATUSES}
        />
      </div>

      <TextField
        label="Where to buy"
        value={whereSold}
        error={errors.where_sold}
        onChange={(value) => setWhereSold(value)}
        placeholder="Ulta, the brand's site, wherever"
        autoComplete="off"
      />

      <div className="form__row">
        <TextField
          label="Typical price"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={price}
          error={errors.typical_price}
          onChange={(value) => setPrice(value)}
        />
        <SelectField
          label="Usually on sale"
          value={saleWindow}
          onChange={(value) => setSaleWindow(value)}
          options={[{ value: NONE, label: 'Not sure' }, ...SALE_WINDOWS]}
        />
      </div>

      <TextField
        label="Link"
        type="url"
        value={link}
        error={errors.link}
        onChange={(value) => setLink(value)}
        placeholder="https://"
        autoComplete="off"
      />

      <TextAreaField
        label="Notes"
        value={notes}
        error={errors.notes}
        onChange={(value) => setNotes(value)}
      />

      <div className="form__actions">
        <Button variant="primary" type="submit" disabled={saving}>
          {existing ? 'Save changes' : 'Add to wishlist'}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

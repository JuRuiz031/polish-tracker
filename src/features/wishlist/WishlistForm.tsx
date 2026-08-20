import { useState } from 'react';
import { FINISHES, PRIORITIES, SALE_WINDOWS, SELECTABLE_STATUSES } from '../../domain/enums';
import { wishlistInputSchema } from '../../domain/schema';
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
  const { addWishlistItem, editWishlistItem, showToast } = useStore();

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

import { useMemo, useState } from 'react';
import { FINISHES, type Color } from '../../domain/enums';
import { polishInputSchema } from '../../domain/schema';
import { findCollisions } from '../../domain/dedupe';
import type { Polish } from '../../domain/types';
import { useStore } from '../../app/storeContext';
import { Button, SelectField, TextAreaField, TextField } from '../../ui/primitives';
import { ColorPicker } from '../../ui/ColorPicker';
import { useSchemaForm } from '../../ui/useSchemaForm';
import { colorOptions } from '../../ui/colorOptions';

/**
 * Add / edit a polish.
 *
 * Validation runs `polishInputSchema` — the same schema the CSV import and the export
 * contract use. One rule set, three callers: a value the form accepts is by
 * construction a value that survives a round trip.
 *
 * Duplicate detection is live and advisory. It never blocks submission, because owning
 * a backup bottle of a favourite is normal and the app has no business arguing.
 */
export function PolishForm({
  existing,
  onDone,
  onCancel,
}: {
  existing?: Polish;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { allPolishes, addPolish, editPolish, showToast } = useStore();

  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState<string>(existing?.color ?? 'Red');
  const [finish, setFinish] = useState<string>(existing?.finish ?? 'Cream');
  const [swatch, setSwatch] = useState(existing?.swatch_hex ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const { errors, saving, submit } = useSchemaForm(polishInputSchema);

  /** Live collision check, excluding the row being edited so it cannot flag itself. */
  const collisions = useMemo(() => {
    if (brand.trim() === '' || name.trim() === '') return [];
    return findCollisions(allPolishes, brand, name, existing?.id);
  }, [allPolishes, brand, name, existing?.id]);

  async function save() {
    await submit(
      {
        brand,
        name,
        color,
        finish,
        swatch_hex: swatch,
        photo_path: null,
        notes,
        archived,
      },
      async (input) => {
        if (existing) {
          await editPolish(existing.id, input);
          showToast({ message: `Saved ${input.brand} ${input.name}.` });
        } else {
          await addPolish(input);
          showToast({ message: `Added ${input.brand} ${input.name}.` });
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

      {collisions.length > 0 && (
        <div className="notice notice--duplicate" role="status">
          <p>
            You already have <strong>{collisions[0].brand} {collisions[0].name}</strong> in the
            collection.
          </p>
          <p className="notice__aside">
            That is fine if this is a backup bottle — saving will keep both.
          </p>
        </div>
      )}

      <div className="form__row">
        <SelectField
          label="Color"
          value={color}
          error={errors.color}
          onChange={(value) => setColor(value)}
          options={colorOptions()}
        />
        <SelectField
          label="Finish"
          value={finish}
          error={errors.finish}
          onChange={(value) => setFinish(value)}
          options={FINISHES}
        />
      </div>

      <ColorPicker
        family={color as Color}
        value={swatch === '' ? null : swatch}
        onChange={(hex) => setSwatch(hex ?? '')}
      />

      <TextAreaField
        label="Notes"
        value={notes}
        error={errors.notes}
        onChange={(value) => setNotes(value)}
        placeholder="How it wears, how many coats, anything worth remembering."
      />

      <label className="checkbox">
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
        />
        <span>
          Archived
          <span className="checkbox__hint">
            Used up or given away. Kept in the log, never offered by the picker.
          </span>
        </span>
      </label>

      <div className="form__actions">
        <Button variant="primary" type="submit" disabled={saving}>
          {existing ? 'Save changes' : 'Add polish'}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

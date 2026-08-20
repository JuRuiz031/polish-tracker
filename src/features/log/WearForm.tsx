import { useState } from 'react';
import { today } from '../../domain/date';
import { wearInputSchema } from '../../domain/schema';
import type { Wear } from '../../domain/types';
import { useStore } from '../../app/storeContext';
import { Button, RatingField, SelectField, TextAreaField, TextField } from '../../ui/primitives';
import { useSchemaForm } from '../../ui/useSchemaForm';

/**
 * Log a manicure, or edit one already logged.
 *
 * Rating and days-lasted are both genuinely optional and default to "not recorded".
 * The domain draws a hard line between unrated and rated-zero (see derive.ts), so the
 * form has to offer a real third state rather than defaulting a star count she did not
 * choose — a defaulted 3 would quietly poison every average in the app.
 */
export function WearForm({
  polishId,
  existing,
  defaultDate,
  onDone,
  onCancel,
  onDelete,
}: {
  /** Fixed when logging from a polish; chosen from a dropdown on the Log screen. */
  polishId?: string;
  existing?: Wear;
  defaultDate?: string;
  onDone: () => void;
  onCancel: () => void;
  /**
   * Supplied only where deleting makes sense — editing an existing entry. Its absence
   * is what keeps a destructive control off the "log a new manicure" form.
   */
  onDelete?: () => void;
}) {
  const { polishes, addWear, editWear, removeWear, showToast } = useStore();

  const [selectedPolish, setSelectedPolish] = useState(
    existing?.polish_id ?? polishId ?? polishes[0]?.id ?? '',
  );
  const [wornOn, setWornOn] = useState(existing?.worn_on ?? defaultDate ?? today());
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [daysLasted, setDaysLasted] = useState(
    existing?.days_lasted === null || existing?.days_lasted === undefined
      ? ''
      : String(existing.days_lasted),
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const { errors, saving, submit } = useSchemaForm(wearInputSchema);

  const locked = polishId !== undefined && existing === undefined;

  async function save() {
    await submit(
      {
        polish_id: selectedPolish,
        worn_on: wornOn,
        rating,
        days_lasted: daysLasted.trim() === '' ? null : Number(daysLasted),
        notes,
      },
      async (input) => {
        if (existing) {
          await editWear(existing.id, input);
          showToast({ message: 'Manicure updated.' });
        } else {
          await addWear(input);
          showToast({ message: 'Manicure logged.' });
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
      {!locked && (
        <SelectField
          label="Polish"
          value={selectedPolish}
          error={errors.polish_id}
          onChange={(value) => setSelectedPolish(value)}
          options={[...polishes]
            .sort((a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`))
            .map((polish) => ({
              value: polish.id,
              label: `${polish.brand} — ${polish.name}`,
            }))}
        />
      )}

      <TextField
        label="Worn on"
        type="date"
        value={wornOn}
        error={errors.worn_on}
        onChange={(value) => setWornOn(value)}
        // No future manicures; the picker's rest maths assumes wears are in the past.
        max={today()}
      />

      <RatingField label="How did it look?" value={rating} onChange={setRating} />

      <TextField
        label="Days it lasted"
        type="number"
        inputMode="numeric"
        min={0}
        max={365}
        value={daysLasted}
        error={errors.days_lasted}
        onChange={(value) => setDaysLasted(value)}
        hint="Optional. Leave blank if you would rather not track it."
      />

      <TextAreaField
        label="Notes"
        value={notes}
        error={errors.notes}
        onChange={(value) => setNotes(value)}
        placeholder="Chipping, coats, occasion — whatever is worth remembering."
      />

      <div className="form__actions">
        <Button variant="primary" type="submit" disabled={saving || selectedPolish === ''}>
          {existing ? 'Save changes' : 'Log it'}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        {existing && onDelete && (
          <Button
            variant="danger"
            className="form__delete"
            onClick={async () => {
              // Soft delete with an Undo toast — no confirm dialog anywhere in the app.
              await removeWear(existing.id);
              onDelete();
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </form>
  );
}

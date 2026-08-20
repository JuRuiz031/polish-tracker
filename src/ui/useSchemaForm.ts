import { useState } from 'react';
import type { ZodType } from 'zod';

/**
 * The submit half of a form: validate, surface field errors, guard against
 * double-submission.
 *
 * All three forms in the app had this same fifteen lines copied out — the same
 * `safeParse`, the same loop flattening issues into a per-field map, the same
 * `saving` flag with the same try/finally. Three copies of a rule is three places for it
 * to drift, and the interesting part of a form is its fields, not its plumbing.
 *
 * The schema is supplied by the caller and is always one of the domain schemas, so a
 * value this accepts is by construction a value the CSV import and export accept too.
 */
export function useSchemaForm<T>(schema: ZodType<T>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /**
   * Validate `raw`; on success hand the parsed value to `save`. Returns whether it got
   * that far, so a caller can close its sheet only when the save actually happened.
   */
  async function submit(raw: unknown, save: (value: T) => Promise<void>): Promise<boolean> {
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        // First message per field wins; later ones are usually less specific.
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return false;
    }

    setErrors({});
    setSaving(true);
    try {
      await save(parsed.data);
      return true;
    } finally {
      // In a finally so a failed save re-enables the button instead of leaving the form
      // permanently stuck behind a spinner.
      setSaving(false);
    }
  }

  return { errors, saving, submit };
}

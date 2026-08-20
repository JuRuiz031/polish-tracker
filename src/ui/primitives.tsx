import { useId, useState, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { Select, type SelectOption } from './Select';

/**
 * Shared primitives.
 *
 * The accessibility constraints from styles/palette.ts are enforced structurally here
 * rather than left to each screen to remember:
 *
 *   - `Badge` only ever renders ink text, because its surfaces are the state colors.
 *   - `Field` always renders a real <label> bound to the control by id. No placeholder
 *     ever stands in for a label — placeholders vanish on focus, which is exactly the
 *     worst behaviour for someone who is dyslexic and mid-form.
 *   - Every interactive element clears the 48px tap minimum via CSS, because most
 *     logging happens one-handed at a table with wet nails.
 */

// ---- Button --------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type="button" className={`btn btn--${variant} ${className}`} {...props} />;
}

/**
 * Floating action button — the one primary action per screen, pinned above the tab bar
 * on a phone. On a wide screen it is not floating at all: CSS relocates it into the
 * header, where a floating circle over acres of empty space would look like a mistake.
 */
export function Fab({
  label,
  icon = 'plus',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon?: IconName }) {
  return (
    <button type="button" className="fab" {...props}>
      <Icon name={icon} />
      <span className="fab__label">{label}</span>
    </button>
  );
}

/** A filter summary pill. `active` means it is narrowing something, not merely present. */
export function Chip({
  label,
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button type="button" className={`chip ${active ? 'is-active' : ''}`} {...props}>
      {label}
    </button>
  );
}

// ---- Swatch --------------------------------------------------------------------

/**
 * The bottle color chip.
 *
 * Decorative: the color duplicates information already in the text (a polish is named
 * and has a Color field), so it is aria-hidden rather than described. A `null` hex —
 * a clear top coat, or a row imported without one — gets a visibly distinct ring
 * instead of a silent white circle that reads as a rendering bug.
 */
export function Swatch({ hex, size = 'md' }: { hex: string | null; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={`swatch swatch--${size} ${hex ? '' : 'swatch--empty'}`}
      style={hex ? { background: hex } : undefined}
      aria-hidden="true"
    />
  );
}

// ---- Badge ---------------------------------------------------------------------

export type BadgeTone = 'never-worn' | 'resting' | 'duplicate' | 'neutral';

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

// ---- Form fields ---------------------------------------------------------------

interface FieldShellProps {
  label: string;
  /** Rendered below the control, and wired to it via aria-describedby. */
  hint?: string;
  error?: string;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}

function Field({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy })}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Every field primitive hands back the VALUE, never the change event.
 *
 * The dropdown has no native <select> under it any more, so it has no event to give —
 * and a form where two of the three inputs speak events and the third does not is a
 * trap for whoever writes the next screen. One signature for all of them.
 */
export function TextField({
  label,
  hint,
  error,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  label: string;
  hint?: string;
  error?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <input
          id={id}
          className={`control ${error ? 'control--invalid' : ''}`}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange?.(event.target.value)}
          {...props}
        />
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  onChange,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  label: string;
  hint?: string;
  error?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          rows={3}
          className={`control control--textarea ${error ? 'control--invalid' : ''}`}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange?.(event.target.value)}
          {...props}
        />
      )}
    </Field>
  );
}

/**
 * Form dropdown.
 *
 * A thin adapter over the in-app listbox in Select.tsx — it keeps the Field label /
 * hint / error scaffolding consistent with the text inputs while the list itself is
 * rendered by the page rather than by the operating system.
 *
 * `onChange` hands over the value directly rather than a change event: there is no
 * native <select> underneath any more, so an event would be a fiction.
 */
export function SelectField({
  label,
  hint,
  error,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (string | SelectOption)[];
}) {
  const normalised: SelectOption[] = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );

  return (
    <Select
      label={label}
      hint={hint}
      error={error}
      value={value}
      onChange={onChange}
      options={normalised}
    />
  );
}

// ---- Layout --------------------------------------------------------------------

/**
 * The one empty state.
 *
 * Every screen has at least one, and each had grown its own copy of the same markup —
 * so the heading level, the spacing and the wording style were free to drift apart. One
 * component means an empty Collection and an empty Log are recognisably the same idea.
 *
 * `children` is the explanation; `action` is the way out of it. Both optional, because
 * "nothing logged yet" needs a button and "no results" needs a suggestion.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      {children}
      {action}
    </div>
  );
}

/**
 * Star rating, 1–5, as a radio group.
 *
 * Stars fill CUMULATIVELY: choosing 3 lights up stars one through three, because that
 * is what a star rating means everywhere else in the world. Lighting only the star
 * under the cursor made "3" look like a single star floating in a row of empty ones.
 *
 * Hovering previews the same fill, so the control answers "what will I get" before the
 * click rather than after it.
 *
 * Radios rather than buttons so the whole control is one tab stop with arrow-key
 * selection, and so a screen reader announces "3 of 5" instead of five unrelated
 * toggles. Includes an explicit "no rating" option, because the domain treats unrated
 * and rated-zero as different facts and the UI has to let her express that.
 */
export function RatingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const name = useId();
  const [preview, setPreview] = useState<number | null>(null);

  // Hover wins while the pointer is over the row; otherwise the committed value shows.
  const shown = preview ?? value ?? 0;

  return (
    <fieldset className="field rating">
      <legend className="field__label">{label}</legend>
      <div className="rating__options" onPointerLeave={() => setPreview(null)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <label
            key={star}
            className={`rating__star ${star <= shown ? 'is-filled' : ''} ${
              preview !== null && star <= preview ? 'is-previewing' : ''
            }`}
            onPointerEnter={() => setPreview(star)}
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              onChange={() => onChange(star)}
              /* Keyboard focus should preview too, so arrowing through the group looks
                 the same as hovering it. */
              onFocus={() => setPreview(star)}
              onBlur={() => setPreview(null)}
            />
            <span aria-hidden="true">{star <= shown ? '\u2605' : '\u2606'}</span>
            <span className="visually-hidden">{star} of 5</span>
          </label>
        ))}
        <label className={`rating__none ${value === null ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value=""
            checked={value === null}
            onChange={() => onChange(null)}
          />
          Not rated
        </label>
      </div>
    </fieldset>
  );
}

import { useId, useState } from 'react';
import { CustomColor } from './CustomColor';
import type { Color } from '../domain/enums';
import { Icon } from './Icon';
import { SHADES, isDarkHex } from './shades';

/**
 * Pick the bottle colour by looking at it.
 *
 * This replaces a text field that wanted `#C8102E`. Asking someone to hand-type a hex
 * code to describe a colour they are holding is a developer's idea of an interface;
 * the shade is right there in the bottle, so the control should be something you point at.
 *
 * Three tiers, in the order people actually need them:
 *
 *   1. Six ready shades for the colour family already chosen on the form. One tap.
 *   2. "+" — opens the in-app picker in CustomColor.tsx, for a shade the presets do not
 *      cover. Deliberately not `<input type="color">`: that hands off to the OS, which
 *      means a dated dialog on Windows, a different one on macOS, and whatever the
 *      browser vendor shipped on mobile — none of it styleable, sizeable for touch, or
 *      consistent between the two devices this app actually runs on.
 *   3. "No colour" — a real, explicit option. Top coats have no shade, and leaving the
 *      field blank should be a choice rather than an omission.
 *
 * Implemented as a radio group so arrow keys move between shades and a screen reader
 * announces "3 of 6" rather than six unrelated buttons. Selection is signalled by a
 * checkmark and a ring, never by colour alone — the swatches ARE colours, so colour
 * cannot also be the state indicator.
 */
export function ColorPicker({
  family,
  value,
  onChange,
}: {
  /** The colour family selected on the form; decides which shades are offered. */
  family: Color;
  value: string | null;
  onChange: (hex: string | null) => void;
}) {
  const name = useId();
  const presets = SHADES[family] ?? [];

  // Anything not in the current family's row is a custom colour — including a shade
  // picked before the family was changed. Keeping it listed means switching family
  // never silently discards the colour already chosen.
  const isCustom = value !== null && !presets.includes(value);
  const [customDraft, setCustomDraft] = useState(value && isCustom ? value : '#C8102E');
  // Open by default when the existing colour is already a custom one, so editing a
  // polish never hides the control that produced its colour.
  const [panelOpen, setPanelOpen] = useState(isCustom);

  return (
    <fieldset className="field colorpicker">
      <legend className="field__label">Bottle color</legend>
      <p className="field__hint">Tap the shade closest to the bottle.</p>

      <div className="colorpicker__grid">
        {presets.map((hex, index) => (
          <label
            key={hex}
            className={`swatch-option ${value === hex ? 'is-selected' : ''}`}
            style={{ background: hex }}
          >
            <input
              type="radio"
              name={name}
              value={hex}
              checked={value === hex}
              onChange={() => onChange(hex)}
            />
            {value === hex && (
              <Icon
                name="check"
                className={isDarkHex(hex) ? 'swatch-option__tick is-light' : 'swatch-option__tick'}
              />
            )}
            <span className="visually-hidden">
              Shade {index + 1} of {presets.length}
            </span>
          </label>
        ))}

        {/* Opens the in-app picker below. Deliberately NOT <input type="color">: that
            hands off to the OS dialog, which is dated on Windows, different on every
            platform, and impossible to style or size for touch. */}
        <button
          type="button"
          className={`swatch-option swatch-option--custom ${isCustom ? 'is-selected' : ''}`}
          style={isCustom && value ? { background: value } : undefined}
          aria-expanded={panelOpen}
          onClick={() => {
            setPanelOpen((open) => !open);
            // Opening the panel should commit the colour it is already showing, so the
            // preview and the selection never disagree.
            if (!panelOpen && !isCustom) onChange(customDraft);
          }}
        >
          {isCustom && value ? (
            <Icon
              name="check"
              className={isDarkHex(value) ? 'swatch-option__tick is-light' : 'swatch-option__tick'}
            />
          ) : (
            <span className="swatch-option__plus" aria-hidden="true">
              +
            </span>
          )}
          <span className="visually-hidden">
            {panelOpen ? 'Close the custom color picker' : 'Mix a custom color'}
          </span>
        </button>
      </div>

      {panelOpen && (
        <div className="colorpicker__panel">
          <CustomColor
            value={isCustom && value ? value : customDraft}
            onChange={(hex) => {
              setCustomDraft(hex);
              onChange(hex);
            }}
          />
        </div>
      )}

      <label className={`colorpicker__none ${value === null ? 'is-selected' : ''}`}>
        <input
          type="radio"
          name={name}
          checked={value === null}
          onChange={() => onChange(null)}
        />
        No color — it's a clear top or base coat
      </label>
    </fieldset>
  );
}

import { COLORS } from '../domain/enums';
import { familySwatch } from './shades';
import type { SelectOption } from './Select';

/**
 * The color-family list, with a dot beside each name.
 *
 * This is the payoff for replacing <select>: a native option list can only ever be
 * text, so on the one dropdown in the app whose entries ARE colors, the OS control
 * could not show them. Now "Nude/Beige" arrives with a nude dot next to it.
 */
export function colorOptions(anyLabel?: string): SelectOption[] {
  const list: SelectOption[] = COLORS.map((color) => ({
    value: color,
    label: color,
    swatch: familySwatch(color),
  }));

  // The "Any color" row gets a hollow dot rather than a filled one, so it does not
  // read as a color you could actually own.
  return anyLabel ? [{ value: 'Any', label: anyLabel, swatch: null }, ...list] : list;
}

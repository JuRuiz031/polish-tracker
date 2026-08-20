import type { Color } from '../domain/enums';

/**
 * Ready-made shades, one row per color family.
 *
 * These exist so nobody ever has to type a hex code. The family is already chosen on
 * the form ("Red", "Nude/Beige"), so the picker only has to offer the handful of shades
 * that belong to it — a small, tappable grid instead of a colour-space to navigate.
 *
 * The values are chosen to look like actual bottles rather than to tile a colour wheel
 * evenly: real polish clusters in deep vampy reds and soft nudes, and a picker that
 * offers six evenly-spaced hues is useless for the thing it is actually for.
 *
 * Custom colours are still possible via the native picker — this is the fast path, not
 * a cage.
 */
export const SHADES: Record<Color, readonly string[]> = {
  Red: ['#C8102E', '#E23D50', '#9B1B30', '#7B2D3B', '#5C1622', '#6E1A22'],
  Orange: ['#F97316', '#EA580C', '#FB923C', '#C2410C', '#E8590C', '#9A3412'],
  Yellow: ['#FDE047', '#FACC15', '#EAB308', '#F59E0B', '#FEF3A0', '#CA8A04'],
  Green: ['#4ADE80', '#22C55E', '#16A34A', '#A8D8C4', '#15803D', '#065F46'],
  Blue: ['#60A5FA', '#3B82F6', '#2563EB', '#1E3A8A', '#1C2A4A', '#0C4A6E'],
  Indigo: ['#818CF8', '#6366F1', '#4F46E5', '#4338CA', '#3730A3', '#312E81'],
  Violet: ['#A78BFA', '#8B5CF6', '#7C3AED', '#6D28D9', '#5B21B6', '#4C1D95'],
  Purple: ['#C084FC', '#A855F7', '#9333EA', '#6B21A8', '#581C87', '#3B1F33'],
  Pink: ['#F9A8D4', '#E9D3D0', '#E4A3B4', '#D96A8A', '#EC4899', '#DB2777'],
  Coral: ['#FDA4AF', '#FB7185', '#F87171', '#FF6F61', '#E2725B', '#E11D48'],
  'Nude/Beige': ['#F5E6DC', '#E8CFC8', '#DDBCA8', '#D8B49C', '#C9A88F', '#B08968'],
  Brown: ['#A16207', '#8B5A2B', '#78350F', '#6B4A3A', '#5C4033', '#3E2723'],
  White: ['#FFFFFF', '#FDFDFD', '#F8F8F8', '#F5F5F5', '#FFFDD0', '#FAF0E6'],
  Black: ['#333333', '#2D2D2D', '#232028', '#1A1A1A', '#111111', '#000000'],
  Gray: ['#D1D5DB', '#9CA3AF', '#6B7280', '#4B5563', '#374151', '#1F2937'],
  Silver: ['#E5E7EB', '#D9DCE0', '#C2C6CC', '#B9BFC6', '#A0A4A8', '#8E9196'],
  Gold: ['#FFD700', '#E6BE8A', '#D4AF37', '#C9A227', '#B8860B', '#A67C00'],
  Teal: ['#5EEAD4', '#2DD4BF', '#14B8A6', '#0D9488', '#0F766E', '#134E4A'],
  'Multi/Glitter': ['#C9A7D4', '#F0ABFC', '#A5B4FC', '#FDE68A', '#FCA5A5', '#86EFAC'],
  // A top or base coat has no bottle colour worth recording; the picker defaults these
  // to "no colour" and offers the faintest tints only for the rare tinted topper.
  Clear: ['#FFFFFF', '#FDF4F7', '#F4FAFF', '#FFFBEA'],
};

/**
 * Relative luminance, per WCAG. Used only to decide whether the "selected" checkmark
 * drawn on top of a swatch should be black or white — a dark tick on #111111 would be
 * invisible, and this is the one place in the app where the foreground colour is not
 * known until runtime.
 */
export function isDarkHex(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return false;

  const int = parseInt(match[1], 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });

  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance < 0.5;
}

/**
 * A representative mid-tone for a color family, used to paint its slice or bar in the
 * stats charts. Falls back to a neutral surface for anything unrecognised — an
 * "Other" bucket, or a family added to the enum before this table catches up.
 */
export function familySwatch(label: string): string {
  const shades = SHADES[label as Color];
  if (!shades || shades.length === 0) return 'var(--surface-card-deep)';
  return shades[Math.min(2, shades.length - 1)];
}

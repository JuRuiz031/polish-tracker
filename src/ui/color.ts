/**
 * Colour conversion for the in-app picker.
 *
 * The picker works in HSL because that is the space a person can actually navigate:
 * "same colour, lighter" is one axis, and hue runs around a rainbow they recognise.
 * Storage stays hex, because that is what the database column and the CSV round trip
 * already use — see domain/schema.ts.
 */

export interface Hsl {
  /** 0–360 */
  h: number;
  /** 0–100 */
  s: number;
  /** 0–100 */
  l: number;
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) =>
    light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));

  const toHex = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`.toUpperCase();
}

export function hexToHsl(hex: string): Hsl | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l: Math.round(l * 100) };

  const s = delta / (1 - Math.abs(2 * l - 1));

  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * A plain-English name for a colour, announced to screen readers and shown under the
 * picker. "Deep pink" is a description someone can confirm against the bottle in their
 * hand; "#C8102E" is not.
 */
export function describeColor({ h, s, l }: Hsl): string {
  if (l >= 96) return 'White';
  if (l <= 6) return 'Black';
  if (s <= 8) {
    if (l >= 75) return 'Light gray';
    if (l >= 40) return 'Gray';
    return 'Dark gray';
  }

  const lightness = l >= 78 ? 'Pale ' : l >= 60 ? 'Light ' : l >= 34 ? '' : 'Deep ';
  const muted = s < 30 ? 'muted ' : '';
  return `${lightness}${muted}${hueName(h)}`.trim().replace(/^./, (c) => c.toUpperCase());
}

function hueName(h: number): string {
  // Bands are uneven on purpose: the eye gets far more resolution in the reds and
  // pinks than in the greens, and this app is mostly reds and pinks.
  if (h < 8) return 'red';
  if (h < 20) return 'scarlet';
  if (h < 40) return 'orange';
  if (h < 52) return 'amber';
  if (h < 66) return 'yellow';
  if (h < 150) return 'green';
  if (h < 175) return 'teal';
  if (h < 200) return 'cyan';
  if (h < 235) return 'blue';
  if (h < 260) return 'indigo';
  if (h < 285) return 'violet';
  if (h < 310) return 'purple';
  if (h < 335) return 'magenta';
  if (h < 350) return 'pink';
  return 'red';
}

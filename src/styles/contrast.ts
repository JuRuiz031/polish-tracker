/**
 * WCAG 2.1 contrast maths. Pure, so the audit can run in CI with no browser.
 * Reference: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const value = parseInt(match[1], 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** Linearise one 0-255 channel, per the WCAG definition. */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** Contrast ratio between two colors, from 1:1 to 21:1. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded to one decimal, which is how ratios are conventionally quoted. */
export function ratio(a: string, b: string): number {
  return Math.round(contrastRatio(a, b) * 10) / 10;
}

export const WCAG = {
  /** AAA for normal-size text — the bar this app holds body copy to. */
  AAA_NORMAL: 7,
  /** AAA for large text (24px+, or 18.66px+ bold). */
  AAA_LARGE: 4.5,
  /** AA for normal-size text — the absolute floor for anything in this app. */
  AA_NORMAL: 4.5,
  /** AA for large text, and the floor for UI components and graphical objects. */
  AA_LARGE: 3,
} as const;

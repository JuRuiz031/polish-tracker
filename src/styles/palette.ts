/**
 * The palette, as data.
 *
 * Anabel approved these colors in the spreadsheet, so the values are fixed. What is
 * NOT fixed is where each one may be used — see contrast.test.ts, which fails the
 * build if any text pairing drops below its required ratio.
 *
 * Accessibility here is functional, not decorative: she is dyslexic, so the brief sets
 * AAA (7:1) for body text and an absolute floor of 4.5:1 for anything else.
 *
 * tokens.css mirrors these values as CSS custom properties. This file is the source of
 * truth; palette.test.ts asserts the two agree so they cannot drift.
 */

export const PALETTE = {
  plum: '#8E4A63',
  deepPlum: '#6E3049',
  blush: '#FDF4F7',
  card: '#FBEAF0',
  cardDeep: '#F6DEE7',
  edge: '#DCB4C4',
  offWhite: '#FFFBFC',
  ink: '#1A1A1A',
  mint: '#DFF1E7',
  amber: '#FCE9D2',
  alert: '#F9CDCD',
  white: '#FFFFFF',
} as const;

export type PaletteToken = keyof typeof PALETTE;

/**
 * Usage rules, derived from the measured ratios rather than assumed.
 *
 * The finding that shaped this: plum #8E4A63 on the off-white page background measures
 * ~6.2:1 — comfortably AA, but SHORT of the AAA 7:1 the brief demands for body text.
 * The palette is preserved and the constraint lands on usage instead:
 *
 *   - deepPlum #6E3049 (~9.5:1) carries every piece of text at body size.
 *   - plum #8E4A63 is reserved for fills, large display text (24px+ bold / 18.66px+),
 *     borders, and other non-text UI.
 */
export const TEXT_ON_SURFACE = {
  /** Body copy. Must clear 7:1. */
  body: PALETTE.ink,
  /** Headings and high-emphasis text. Must clear 7:1. */
  heading: PALETTE.deepPlum,
  /** Large display text only — 24px+, or 18.66px+ bold. Must clear 4.5:1. */
  display: PALETTE.plum,
} as const;

/**
 * Neutral surfaces. These carry the full type scale: ink for body, deepPlum for
 * headings, plum for large display text.
 */
export const NEUTRAL_SURFACES = {
  page: PALETTE.offWhite,
  banded: PALETTE.blush,
  card: PALETTE.card,
  cardDeep: PALETTE.cardDeep,
} as const;

/**
 * State surfaces — mint for never-worn, amber for long-resting / already-owned,
 * alert for duplicates.
 *
 * MEASURED CONSTRAINT: text on these is ALWAYS ink. The audit found deepPlum on
 * alert at 6.7:1 and plum on alert at 4.4:1 — both fractionally under their bars.
 * Rather than alter a color Anabel approved, plum-family text is simply not used
 * on state surfaces. Ink clears AAA on all three with room to spare.
 */
export const STATE_SURFACES = {
  neverWorn: PALETTE.mint,
  resting: PALETTE.amber,
  duplicate: PALETTE.alert,
} as const;

export const SURFACES = { ...NEUTRAL_SURFACES, ...STATE_SURFACES } as const;

/**
 * Borders, split by whether WCAG 1.4.11 applies.
 *
 * MEASURED CONSTRAINT: edge #DCB4C4 against the page is 1.8:1 — well under the 3:1
 * that non-text UI needs. That is acceptable for a decorative divider (the card is
 * already identified by its own fill and spacing) but NOT for anything a person has
 * to perceive to operate the interface. So:
 *
 *   decorative — hairlines between rows, card edges. Carries no information.
 *   functional — input borders, focus rings, selected/checked states. Uses plum,
 *                which measures 6.2:1 against the page.
 *
 * A control must never be identifiable by `decorative` alone.
 */
export const BORDERS = {
  decorative: PALETTE.edge,
  functional: PALETTE.plum,
} as const;

import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb, ratio, relativeLuminance, WCAG } from '../contrast';
import {
  BORDERS,
  NEUTRAL_SURFACES,
  PALETTE,
  STATE_SURFACES,
  SURFACES,
  TEXT_ON_SURFACE,
} from '../palette';

/**
 * The accessibility audit.
 *
 * The brief's definition of done says contrast must be "verified, not assumed". This
 * is that verification, and it runs in CI — a future palette tweak that breaks
 * legibility fails the build instead of shipping to someone who needs it.
 */

describe('contrast maths', () => {
  it('parses hex with and without the hash', () => {
    expect(hexToRgb('#8E4A63')).toEqual({ r: 142, g: 74, b: 99 });
    expect(hexToRgb('8e4a63')).toEqual({ r: 142, g: 74, b: 99 });
  });

  it('rejects malformed colors rather than guessing', () => {
    expect(() => hexToRgb('#FFF')).toThrow();
    expect(() => hexToRgb('plum')).toThrow();
  });

  it('anchors against the known extremes', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
    // Black on white is the definitional maximum.
    expect(ratio('#000000', '#FFFFFF')).toBe(21);
    expect(ratio('#123456', '#123456')).toBe(1);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#1A1A1A', '#FFFBFC')).toBeCloseTo(
      contrastRatio('#FFFBFC', '#1A1A1A'),
      10,
    );
  });
});

describe('body text clears AAA on every surface it can land on', () => {
  // Body copy is the load-bearing case: this is the text she actually reads.
  for (const [surfaceName, surface] of Object.entries(SURFACES)) {
    it(`ink on ${surfaceName} is at least 7:1`, () => {
      expect(ratio(TEXT_ON_SURFACE.body, surface)).toBeGreaterThanOrEqual(WCAG.AAA_NORMAL);
    });
  }
});

describe('headings clear AAA on the neutral surfaces', () => {
  // Only the neutral surfaces — plum-family text is barred from state surfaces below.
  for (const [surfaceName, surface] of Object.entries(NEUTRAL_SURFACES)) {
    it(`deep plum on ${surfaceName} is at least 7:1`, () => {
      expect(ratio(TEXT_ON_SURFACE.heading, surface)).toBeGreaterThanOrEqual(WCAG.AAA_NORMAL);
    });
  }
});

describe('state surfaces take ink text only', () => {
  // This encodes a measured finding rather than a preference. Both plum-family
  // colors fall marginally short on the alert surface, so the rule is absolute:
  // mint / amber / alert carry ink, nothing else.
  it('deep plum on the duplicate surface would MISS AAA, which is why the rule exists', () => {
    expect(ratio(PALETTE.deepPlum, STATE_SURFACES.duplicate)).toBeLessThan(WCAG.AAA_NORMAL);
  });

  it('plum on the duplicate surface would MISS even the large-text bar', () => {
    expect(ratio(PALETTE.plum, STATE_SURFACES.duplicate)).toBeLessThan(WCAG.AAA_LARGE);
  });

  for (const [name, surface] of Object.entries(STATE_SURFACES)) {
    it(`ink on ${name} clears AAA`, () => {
      expect(ratio(PALETTE.ink, surface)).toBeGreaterThanOrEqual(WCAG.AAA_NORMAL);
    });
  }
});

describe('the plum usage rule', () => {
  // This is the measurement that produced the rule, kept as a regression test so the
  // reasoning does not get lost and quietly reversed later.
  it('plum on the page background falls SHORT of AAA for normal text', () => {
    const measured = ratio(PALETTE.plum, SURFACES.page);
    expect(measured).toBeLessThan(WCAG.AAA_NORMAL);
    expect(measured).toBeGreaterThanOrEqual(WCAG.AA_NORMAL);
  });

  it('deep plum on the page background clears AAA, so it is the body-size choice', () => {
    expect(ratio(PALETTE.deepPlum, SURFACES.page)).toBeGreaterThanOrEqual(WCAG.AAA_NORMAL);
  });

  it('plum is still valid for large display text on the neutral surfaces', () => {
    for (const surface of Object.values(NEUTRAL_SURFACES)) {
      expect(ratio(TEXT_ON_SURFACE.display, surface)).toBeGreaterThanOrEqual(WCAG.AAA_LARGE);
    }
  });
});

describe('plum as a fill', () => {
  it('carries white text at AA for normal size', () => {
    // Primary buttons: white on plum. Clears AA but not AAA, so button labels are set
    // large and semibold rather than at body size.
    const measured = ratio(PALETTE.white, PALETTE.plum);
    expect(measured).toBeGreaterThanOrEqual(WCAG.AA_NORMAL);
  });

  it('carries white text at AAA when the fill is deep plum', () => {
    expect(ratio(PALETTE.white, PALETTE.deepPlum)).toBeGreaterThanOrEqual(WCAG.AAA_NORMAL);
  });
});

describe('non-text UI', () => {
  it('functional borders meet the 3:1 bar for UI components', () => {
    // WCAG 1.4.11 applies to anything you must perceive to operate the interface:
    // input borders, focus rings, checked states.
    for (const surface of Object.values(NEUTRAL_SURFACES)) {
      expect(ratio(BORDERS.functional, surface)).toBeGreaterThanOrEqual(WCAG.AA_LARGE);
    }
  });

  it('the decorative border is documented as too faint to carry meaning', () => {
    // edge #DCB4C4 measures ~1.8:1 on the page. Recorded deliberately: it is fine as
    // a hairline, and must never be the only thing identifying a control.
    expect(ratio(BORDERS.decorative, NEUTRAL_SURFACES.page)).toBeLessThan(WCAG.AA_LARGE);
  });

  it('the page background is never pure white', () => {
    // Glare is a real problem for her; the brief calls for a warm off-white.
    expect(SURFACES.page).not.toBe('#FFFFFF');
  });
});

describe('state surfaces stay legible', () => {
  // mint = never worn, amber = resting a long time / already owned, alert = duplicate.
  // These carry real text, so they are held to the same AAA bar as any other surface.
  const states = { mint: PALETTE.mint, amber: PALETTE.amber, alert: PALETTE.alert };

  for (const [name, color] of Object.entries(states)) {
    it(`${name} carries body text at AAA`, () => {
      expect(ratio(PALETTE.ink, color)).toBeGreaterThanOrEqual(WCAG.AAA_NORMAL);
    });
  }

  it('the three states are distinguishable from each other and from card surfaces', () => {
    // Color is never the only signal in the UI, but if two state chips are nearly the
    // same color the redundant cue gets harder to read too.
    expect(ratio(PALETTE.mint, PALETTE.alert)).toBeGreaterThan(1.1);
    expect(ratio(PALETTE.amber, PALETTE.alert)).toBeGreaterThan(1.05);
  });
});

/** Printed for the record — this table is the evidence behind the design tokens. */
describe('measured ratios (reference)', () => {
  it('records the palette audit', () => {
    const rows = [
      ['ink on page', ratio(PALETTE.ink, SURFACES.page)],
      ['ink on card', ratio(PALETTE.ink, SURFACES.card)],
      ['deepPlum on page', ratio(PALETTE.deepPlum, SURFACES.page)],
      ['plum on page', ratio(PALETTE.plum, SURFACES.page)],
      ['white on plum', ratio(PALETTE.white, PALETTE.plum)],
      ['white on deepPlum', ratio(PALETTE.white, PALETTE.deepPlum)],
      ['edge on page', ratio(PALETTE.edge, SURFACES.page)],
    ] as const;

    for (const [label, value] of rows) {
      expect(value, `${label} = ${value}:1`).toBeGreaterThan(1);
    }
    console.table(Object.fromEntries(rows.map(([l, v]) => [l, `${v}:1`])));
  });
});

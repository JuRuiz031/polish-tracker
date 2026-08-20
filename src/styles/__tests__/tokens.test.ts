import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';

/**
 * Keeps tokens.css and palette.ts from drifting apart.
 *
 * They have to duplicate the hex values — the CSS needs literals, and the contrast
 * audit needs them as data. This test makes the duplication safe: change one without
 * the other and the build fails.
 */

const css = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');

/** Read a custom property's literal value from :root. */
function cssVar(name: string): string | null {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  return match ? match[1].toLowerCase() : null;
}

describe('tokens.css matches palette.ts', () => {
  const pairs: Array<[string, string]> = [
    ['plum', PALETTE.plum],
    ['deep-plum', PALETTE.deepPlum],
    ['blush', PALETTE.blush],
    ['card', PALETTE.card],
    ['card-deep', PALETTE.cardDeep],
    ['edge', PALETTE.edge],
    ['off-white', PALETTE.offWhite],
    ['ink', PALETTE.ink],
    ['mint', PALETTE.mint],
    ['amber', PALETTE.amber],
    ['alert', PALETTE.alert],
  ];

  for (const [token, expected] of pairs) {
    it(`--${token} is ${expected}`, () => {
      expect(cssVar(token)).toBe(expected.toLowerCase());
    });
  }
});

describe('type scale honours the legibility floor', () => {
  it('body text is at or above 16px', () => {
    const match = /--text-base:\s*([\d.]+)rem/.exec(css);
    expect(match).not.toBeNull();
    expect(Number(match![1]) * 16).toBeGreaterThanOrEqual(16);
  });

  it('declares no weight below 400', () => {
    const weights = [...css.matchAll(/--weight-[a-z]+:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(weights.length).toBeGreaterThan(0);
    for (const weight of weights) expect(weight).toBeGreaterThanOrEqual(400);
  });

  it('sets body line height at 1.6 or more', () => {
    const match = /--leading-body:\s*([\d.]+)/.exec(css);
    expect(Number(match![1])).toBeGreaterThanOrEqual(1.6);
  });

  it('ships no dyslexia-branded font', () => {
    // She has said she does not like them. Atkinson Hyperlegible is a legibility
    // face, which is a different thing and explicitly allowed.
    expect(css.toLowerCase()).not.toContain('opendyslexic');
    expect(css.toLowerCase()).not.toContain('dyslexie');
  });

  it('never uses pure white as a page background', () => {
    const match = /--surface-page:\s*var\(--([a-z-]+)\)/.exec(css);
    expect(match![1]).toBe('off-white');
  });

  it('keeps tap targets at 44px or more', () => {
    const match = /--tap-min:\s*(\d+)px/.exec(css);
    expect(Number(match![1])).toBeGreaterThanOrEqual(44);
  });
});

describe('reduced motion', () => {
  it('zeroes every duration under prefers-reduced-motion', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)([\s\S]*?)\n}/.exec(css);
    expect(block).not.toBeNull();

    const declared = [...css.matchAll(/--duration-([a-z]+):/g)].map((m) => m[1]);
    const overridden = [...block![1].matchAll(/--duration-([a-z]+):\s*0ms/g)].map((m) => m[1]);

    // Every duration token must be zeroed, or an animation slips through the guard.
    for (const name of new Set(declared)) expect(overridden).toContain(name);
  });
});

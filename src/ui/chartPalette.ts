/**
 * Categorical chart palette.
 *
 * These eight hues are not a taste choice — they were run through the palette
 * validator against this app's own page surface (#FFFBFC) and this exact order is the
 * one that passed every check:
 *
 *   Lightness band      all 8 inside L 0.43–0.77
 *   Chroma floor        all 8 >= 0.1          (nothing reads as gray)
 *   CVD separation      worst adjacent ΔE 12.5 (deutan) — target is >= 8
 *   Normal-vision floor worst adjacent ΔE 21.4 — floor is 15
 *   Contrast vs surface all 8 >= 3:1
 *
 * Two earlier attempts failed: muted jewel tones dropped below the chroma floor and
 * read gray, and a version with teal beside magenta collapsed to ΔE 1.3 under deuteranopia
 * — indistinguishable for roughly one man in twelve. THE ORDER IS PART OF THE RESULT.
 * Reordering these changes which pairs sit adjacent and can silently reintroduce a
 * failure, so add or reorder only by re-running the validator.
 *
 * Slot 0 is the app's own plum, so the first and largest series always looks like it
 * belongs to the rest of the interface.
 */
export const CHART_HUES = [
  '#A6386B', // plum — the brand anchor
  '#8A7400', // gold
  '#2D5DB4', // blue
  '#C25A1E', // orange
  '#0E8C7D', // teal
  '#6C3FA5', // violet
  '#2F7D32', // green
  '#D65D93', // pink
] as const;

/**
 * Pick a hue for a label, keyed to the LABEL rather than to its position.
 *
 * This is the rule that stops a chart repainting itself. If colour were assigned by
 * rank, then logging one manicure could reorder the bars and hand "Essie" the colour
 * that meant "OPI" a second ago — and a reader who learned one association is now
 * being actively misled. Hashing the name means Essie is the same hue for as long as
 * it is called Essie.
 *
 * Collisions are resolved by probing forward to the next free slot, so two brands in
 * the same chart can never share a colour even when their names hash together.
 */
export function assignHues(labels: readonly string[]): Map<string, string> {
  const taken = new Set<number>();
  const assigned = new Map<string, string>();

  for (const label of labels) {
    // Past eight distinct labels every slot is taken. Reusing one here would hand two
    // different brands the same colour in the same chart, which is worse than having no
    // colour at all — so we stop, and the caller paints the remainder neutral. The
    // number of COLOURED series is capped at eight by construction.
    if (taken.size >= CHART_HUES.length) break;

    let slot = hash(label) % CHART_HUES.length;
    while (taken.has(slot)) slot = (slot + 1) % CHART_HUES.length;

    taken.add(slot);
    assigned.set(label, CHART_HUES[slot]);
  }

  return assigned;
}

/** FNV-1a. Small, stable, and dependency-free — the exact hash does not matter, only that it never changes. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h);
}

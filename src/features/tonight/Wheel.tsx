import { useEffect, useMemo, useRef, useState } from 'react';
import type { PolishWithStats } from '../../domain/types';

/**
 * Spin-the-wheel.
 *
 * The wheel is a presentation of a decision that has already been made. `pick()` in
 * domain/picker.ts chooses the winner from the eligible pool; this component is handed
 * that winner and works backwards to the rotation that lands on it. Doing it the other
 * way round — spinning first and reading off whatever stops under the pointer — would
 * move the app's central business rule into an animation callback, where it could not
 * be tested and would drift from the eligibility logic.
 *
 * Segments are coloured from each polish's own swatch, so the wheel is literally a
 * picture of the collection. Bottles with no recorded colour fall back to the card
 * surface rather than rendering as an invisible slice.
 *
 * A wheel of 200 segments is a grey smear, so the visual is capped at MAX_SEGMENTS and
 * the winner is always spliced in — what she sees is a representative wheel that
 * genuinely contains the answer, not a lie about the pool size.
 */

const MAX_SEGMENTS = 12;
const SPIN_MS = 3400;
/** Whole extra rotations before settling, so it reads as a spin rather than a jump. */
const FULL_TURNS = 5;

export function Wheel({
  pool,
  winner,
  spinning,
  onRest,
}: {
  pool: readonly PolishWithStats[];
  /** Decided by pick() before the spin starts. null renders an idle wheel. */
  winner: PolishWithStats | null;
  spinning: boolean;
  onRest: () => void;
}) {
  const [rotation, setRotation] = useState(0);
  const turns = useRef(0);

  /**
   * The segments actually drawn.
   *
   * `winner` MUST be a dependency. Leaving it out to "keep the segments stable" meant
   * the sample was computed while the winner was still null, so any winner outside the
   * first MAX_SEGMENTS of the pool was simply not on the wheel — findIndex returned -1,
   * the settle effect bailed, and the wheel span forever with no result. With a pool of
   * 22 that was roughly every other spin.
   *
   * Including it is safe: the winner is chosen before `spinning` flips true and is not
   * cleared until the wheel has come to rest, so this cannot recompute mid-animation.
   */
  const segments = useMemo(() => {
    if (pool.length <= MAX_SEGMENTS) return [...pool];

    const sample = [...pool].slice(0, MAX_SEGMENTS);
    // Guarantee the winner is on the wheel; drop something else to make room.
    if (winner && !sample.some((polish) => polish.id === winner.id)) {
      sample[MAX_SEGMENTS - 1] = winner;
    }
    return sample;
  }, [pool, winner]);

  const sliceAngle = 360 / Math.max(segments.length, 1);

  /**
   * Held in a ref so the settle timer does not depend on the callback's identity.
   * `onRest` is a fresh closure on every parent render; with it in the dependency list,
   * any incidental re-render during the spin cleared the pending timer and started a
   * new one, so the wheel could stall indefinitely.
   */
  const onRestRef = useRef(onRest);
  useEffect(() => {
    onRestRef.current = onRest;
  });

  useEffect(() => {
    if (!spinning || !winner) return;

    const index = segments.findIndex((polish) => polish.id === winner.id);
    // The winner is guaranteed to be on the wheel by the memo above; this is a guard
    // against a future change reintroducing the bug, not an expected branch.
    if (index === -1) {
      onRestRef.current();
      return;
    }

    // The pointer sits at 12 o'clock. Rotating by -(centre of the winning slice) brings
    // that slice under it; the extra whole turns are what make it a spin.
    const target = -(index * sliceAngle + sliceAngle / 2);
    turns.current += FULL_TURNS;
    setRotation(turns.current * 360 + target);

    const timer = window.setTimeout(() => onRestRef.current(), SPIN_MS);
    return () => window.clearTimeout(timer);
  }, [spinning, winner, segments, sliceAngle]);

  if (segments.length === 0) return null;

  return (
    <div className="wheel">
      <div className="wheel__pointer" aria-hidden="true" />
      <svg
        className="wheel__disc"
        viewBox="-100 -100 200 200"
        style={{
          transform: `rotate(${rotation}deg)`,
          // The easing lives here rather than in CSS because the duration has to match
          // the timer above exactly, or the card appears before the wheel stops.
          transition: spinning
            ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
            : 'none',
        }}
        // Decorative: the result is announced by the reveal card's own aria-live region,
        // and a screen reader has no use for a spinning graphic.
        aria-hidden="true"
        focusable="false"
      >
        {segments.map((polish, index) => (
          <path
            key={polish.id}
            d={slicePath(index * sliceAngle, (index + 1) * sliceAngle)}
            fill={polish.swatch_hex ?? 'var(--surface-card-deep)'}
            stroke="var(--off-white)"
            strokeWidth="1"
          />
        ))}
        <circle r="18" fill="var(--surface-page)" stroke="var(--edge)" strokeWidth="2" />
      </svg>
    </div>
  );
}

/**
 * One pie slice as an SVG path, in a coordinate system centred on the origin.
 * Angles are clockwise from 12 o'clock, which is where the pointer is.
 */
function slicePath(startDeg: number, endDeg: number): string {
  const r = 96;
  const start = pointOnCircle(startDeg, r);
  const end = pointOnCircle(endDeg, r);
  // A single slice can exceed a semicircle when the pool is tiny (two polishes = 180°
  // each, three = 120°), so the large-arc flag has to be computed, not assumed.
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M 0 0 L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function pointOnCircle(degrees: number, radius: number) {
  // -90 puts 0° at the top rather than at 3 o'clock.
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) };
}

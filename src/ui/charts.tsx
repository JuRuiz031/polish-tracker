import type { Tally } from '../domain/stats';
import { familySwatch } from './shades';
import { assignHues } from './chartPalette';

/**
 * Charts, as inline SVG.
 *
 * No charting library: these are three fixed forms over small datasets, and a
 * dependency would cost more bytes than the whole app to draw a bar.
 *
 * Two rules run through all of them, both from the accessibility brief rather than
 * taste:
 *
 *   1. Identity is never carried by colour alone. Every segment and every bar is
 *      labelled in text next to its own count, so the charts are readable in
 *      greyscale, under any colour-vision deficiency, and by a screen reader.
 *   2. Marks are separated by a 2px gap in the page colour rather than by a darker
 *      outline, so adjacent fills stay distinct without adding a competing edge.
 *
 * The colour-family chart is the one place a multi-hue palette is legitimate: the
 * categories ARE colours, so each slice is painted its own real shade. Nothing is
 * assigned an arbitrary hue, which is exactly the trap that makes most categorical
 * palettes fail. Every other chart is a single hue — length carries the magnitude,
 * and colour carries nothing.
 */

// ---- Donut ---------------------------------------------------------------------

/**
 * Part-to-whole, at a glance.
 *
 * Hard-capped at six segments by the caller (`foldToTop`): past that the slices are
 * too thin to compare and a bar chart is the honest form. The hole is what makes it a
 * donut rather than a pie — it leaves room for the total, which is the number people
 * actually look for first.
 */
export function Donut({
  entries,
  total,
  totalLabel,
  /**
   * True only when the categories ARE colours, in which case each slice is painted its
   * own real shade. Otherwise the validated categorical palette is used — brands and
   * finishes have no inherent colour, and a wall of identical plum tells you nothing
   * about which slice is which.
   */
  useOwnColors = false,
  hues,
}: {
  entries: readonly Tally[];
  total: number;
  totalLabel: string;
  useOwnColors?: boolean;
  /** Shared with the expanded bar list so the two charts never disagree on a colour. */
  hues?: Map<string, string>;
}) {
  if (total === 0 || entries.length === 0) {
    return <p className="chart__empty">Nothing to chart yet.</p>;
  }

  // Hues are keyed to the label, not to the row's position, so adding a polish cannot
  // reshuffle which brand owns which colour. See chartPalette.assignHues.
  const palette = hues ?? assignHues(entries.map((entry) => entry.label));
  const fillFor = (entry: Tally) =>
    entry.color === null
      ? 'url(#donut-other)'
      : useOwnColors
        ? familySwatch(entry.label)
        : (palette.get(entry.label) ?? 'var(--plum)');

  // Running offsets, computed as a scan rather than by mutating a counter during
  // render — the arcs are a pure function of the entries.
  const arcs = entries.reduce<{ entry: Tally; start: number; end: number }[]>(
    (acc, entry) => {
      const start = acc.length === 0 ? 0 : acc[acc.length - 1].end;
      acc.push({ entry, start, end: start + (entry.count / total) * 360 });
      return acc;
    },
    [],
  );

  return (
    <div className="donut">
      <svg viewBox="-110 -110 220 220" className="donut__svg" role="img"
        aria-label={`${totalLabel}: ${entries.map((e) => `${e.label} ${e.count}`).join(', ')}`}>
        <defs>
          {/* "Other" is textured rather than tinted. Any flat colour picked for it
              collides with a real family — the first attempt used --edge, which sat
              beside the genuine Pink slice and read as a second pink. A hatch belongs
              to no family and stays distinct in greyscale and under any CVD. */}
          <pattern id="donut-other" width="6" height="6" patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--surface-card-deep)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--plum)" strokeWidth="2.5" />
          </pattern>
        </defs>
        {arcs.map(({ entry, start, end }) => (
          <path
            key={entry.label}
            d={donutSlice(start, end)}
            fill={fillFor(entry)}
            /* The 2px gap in the page colour, not a dark outline. */
            stroke="var(--surface-page)"
            strokeWidth="2"
          >
            <title>
              {entry.label}: {entry.count}
            </title>
          </path>
        ))}
        <text className="donut__total" x="0" y="-2" textAnchor="middle">
          {total}
        </text>
        <text className="donut__caption" x="0" y="18" textAnchor="middle">
          {totalLabel}
        </text>
      </svg>

      {/* The legend is not decoration — it is what makes the chart readable without
          colour vision, so it always carries the label AND the count. */}
      <ul className="legend">
        {entries.map((entry) => (
          <li key={entry.label} className="legend__row">
            <span
              className="legend__key"
              style={
                entry.color === null
                  ? {
                      // Mirror the slice's hatch so the legend key matches what is drawn.
                      backgroundImage:
                        'repeating-linear-gradient(45deg, var(--plum) 0 2px, var(--card-deep) 2px 5px)',
                    }
                  : { background: fillFor(entry) }
              }
              aria-hidden="true"
            />
            <span className="legend__label">{entry.label}</span>
            <span className="legend__value">{entry.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const OUTER = 100;
const INNER = 58;

function donutSlice(startDeg: number, endDeg: number): string {
  // A single category can be the entire collection. SVG cannot draw a 360° arc — start
  // and end land on the same point and the path collapses — so shave a hair off.
  const sweep = Math.min(endDeg - startDeg, 359.99);
  const end = startDeg + sweep;
  const largeArc = sweep > 180 ? 1 : 0;

  const o1 = polar(startDeg, OUTER);
  const o2 = polar(end, OUTER);
  const i1 = polar(end, INNER);
  const i2 = polar(startDeg, INNER);

  return [
    `M ${o1.x} ${o1.y}`,
    `A ${OUTER} ${OUTER} 0 ${largeArc} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${INNER} ${INNER} 0 ${largeArc} 0 ${i2.x} ${i2.y}`,
    'Z',
  ].join(' ');
}

function polar(degrees: number, radius: number) {
  // -90 puts 0° at 12 o'clock rather than at 3 o'clock.
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) };
}

// ---- Horizontal bars -----------------------------------------------------------

/**
 * Ranked magnitude — brands, finishes, most-worn.
 *
 * Horizontal because the labels are words of wildly different length ("Olive & June",
 * "Holographic"): vertical columns would either clip them or turn them on their side.
 *
 * One hue for every bar. Shading each bar darker-where-longer would double-encode the
 * value the length already shows, and burn the only free channel for nothing.
 */
export function BarList({
  entries,
  /** Paint each bar its own colour. Only true where the category IS a colour. */
  useOwnColors = false,
  /**
   * Give each bar its own categorical hue. Off by default: for a plain ranking, length
   * already carries the value and colouring by rank would double-encode it. On when the
   * bars double as a key to the donut above, so the two agree at a glance.
   */
  colorful = false,
  hues,
  unit = '',
}: {
  entries: readonly Tally[];
  useOwnColors?: boolean;
  colorful?: boolean;
  /**
   * Shared with the donut above. Entries absent from the map — everything past the
   * eight-hue ceiling — are drawn in a neutral rather than being handed a recycled
   * colour, which would tell the reader two different brands were the same one. Every
   * row is labelled with its name and count regardless, so nothing depends on hue.
   */
  hues?: Map<string, string>;
  unit?: string;
}) {
  if (entries.length === 0) return <p className="chart__empty">Nothing to chart yet.</p>;

  const palette = hues ?? assignHues(entries.map((entry) => entry.label));

  // Scale to the largest bar rather than the total: this is a ranking, not a share.
  const max = Math.max(...entries.map((entry) => entry.count), 1);

  return (
    <ul className="bars">
      {entries.map((entry) => (
        <li key={entry.label} className="bars__row">
          {/* Label and value share a full-width line above the bar. Side by side, the
              label column had to be capped, and every polish with a real name
              ("OPI Lincoln Park After Dark") ended in an ellipsis. */}
          <span className="bars__head">
            <span className="bars__label">{entry.label}</span>
            <span className="bars__value">
              {entry.count}
              {unit}
            </span>
          </span>
          <span className="bars__track">
            <span
              className="bars__fill"
              style={{
                width: `${(entry.count / max) * 100}%`,
                background: useOwnColors
                  ? familySwatch(entry.label)
                  : colorful
                    ? (palette.get(entry.label) ?? 'var(--edge)')
                    : 'var(--plum)',
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---- Activity columns ----------------------------------------------------------

/**
 * Manicures per month over the last year.
 *
 * Months with nothing in them are drawn as empty tracks rather than skipped. A gap in
 * the log is real information, and closing it up would turn an irregular history into
 * a tidy, false one.
 */
export function MonthColumns({ months }: { months: readonly { month: string; count: number }[] }) {
  const max = Math.max(...months.map((entry) => entry.count), 1);

  return (
    <div className="columns" role="img" aria-label={describeMonths(months)}>
      {months.map((entry) => (
        <div key={entry.month} className="columns__slot">
          <div className="columns__track">
            <div
              className={`columns__bar ${entry.count === 0 ? 'is-empty' : ''}`}
              style={{ height: `${entry.count === 0 ? 2 : (entry.count / max) * 100}%` }}
            >
              <title>
                {entry.month}: {entry.count}
              </title>
            </div>
          </div>
          {/* Only the count above a bar that has one — a zero on every empty month is
              noise, and the empty track already says it. */}
          <span className="columns__value">{entry.count > 0 ? entry.count : ''}</span>
          <span className="columns__label">{shortMonth(entry.month)}</span>
        </div>
      ))}
    </div>
  );
}

function shortMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'narrow' });
}

function describeMonths(months: readonly { month: string; count: number }[]): string {
  const total = months.reduce((sum, entry) => sum + entry.count, 0);
  return `Manicures per month over the last ${months.length} months, ${total} in total.`;
}

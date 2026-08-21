/**
 * Icons.
 *
 * Inline SVG rather than an icon font: a font renders as a wrong-glyph box or nothing
 * at all when it fails to load, and it is invisible to `currentColor` transitions.
 *
 * Every icon is decorative by default (`aria-hidden`) because it always sits beside a
 * real text label. Nothing in this app is icon-only — an unlabelled glyph is a guessing
 * game, which is the opposite of the brief.
 *
 * `filled` gives the active nav item a second, non-color signal, so the current tab is
 * distinguishable without relying on hue.
 */

export type IconName =
  | 'sparkle'
  | 'grid'
  | 'calendar'
  | 'heart'
  | 'plus'
  | 'search'
  | 'close'
  | 'chevron'
  | 'sliders'
  | 'dice'
  | 'check'
  | 'pencil'
  | 'trash'
  | 'archive'
  | 'bag'
  | 'chart'
  | 'download'
  | 'upload';

export function Icon({
  name,
  filled = false,
  className = '',
}: {
  name: IconName;
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<IconName, React.ReactNode> = {
  sparkle: <path d="M12 3l2.1 5.4L19.5 10.5 14.1 12.6 12 18l-2.1-5.4L4.5 10.5 9.9 8.4z" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" strokeWidth="1.8" stroke="currentColor" fill="none" />
    </>
  ),
  heart: <path d="M12 20.3l-1.5-1.4C5.4 14.3 2.5 11.7 2.5 8.5 2.5 6 4.5 4 7 4c1.7 0 3.3.8 4.3 2.1L12 7l.7-.9C13.7 4.8 15.3 4 17 4c2.5 0 4.5 2 4.5 4.5 0 3.2-2.9 5.8-8 10.4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </>
  ),
  dice: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pencil: (
    <>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17v3z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.5" />
      <path d="M5.5 8.5V19a1.5 1.5 0 001.5 1.5h10A1.5 1.5 0 0018.5 19V8.5M10 12.5h4" />
    </>
  ),
  /*
   * Drawn as closed rects, not as line segments.
   *
   * `filled` sets fill="currentColor" and strokeWidth={0}, so an icon made of open
   * strokes has no area to fill and vanishes the moment its tab becomes active — which
   * is exactly what this one did. Every icon that can be filled must be a closed shape.
   */
  chart: (
    <>
      <rect x="3.5" y="12" width="4" height="8" rx="1.2" />
      <rect x="10" y="7" width="4" height="13" rx="1.2" />
      <rect x="16.5" y="3.5" width="4" height="16.5" rx="1.2" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12.5H6z" />
      <path d="M8.5 8V6a3.5 3.5 0 017 0v2" />
    </>
  ),
  // Closed shapes (an arrow polygon, not open stroke lines) so the Backup nav tab can
  // fill it the same way as chart/grid/archive.
  download: (
    <>
      <path d="M9.5 3h5v7h3.5l-6 6.5-6-6.5H9.5z" />
      <rect x="4" y="18.5" width="16" height="2.2" rx="1.1" />
    </>
  ),
  upload: (
    <>
      <path d="M9.5 14.5h5v-7h3.5l-6-6.5-6 6.5H9.5z" />
      <rect x="4" y="18.5" width="16" height="2.2" rx="1.1" />
    </>
  ),
};

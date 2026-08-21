import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Modal surface — every add / edit / detail view goes through this.
 *
 * Built on <dialog> so the browser supplies the focus trap, the inert background, and
 * Escape-to-close. Hand-rolling those is where accessible modals usually go wrong.
 *
 * ---------------------------------------------------------------------------------
 * MOTION
 *
 * The panel is moved by the Web Animations API with explicit pixel keyframes, and by
 * nothing else. There is deliberately NO `transform` or `transition` on `.sheet__panel`
 * in the stylesheet — its CSS position IS its resting position, and this file is the
 * only thing that ever displaces it.
 *
 * That is a reaction to how the CSS-transition version kept failing. It depended on
 * `translateY(100%)` resolving against a height that had to be final before the first
 * paint, on a class landing in the right frame, and on no other rule touching the same
 * property. Each of those is an opportunity for the panel to be somewhere unintended for
 * a frame or two, which is exactly what a jitter is. Measuring the distance in pixels at
 * the moment the animation starts removes all three: the travel is a number, the start
 * and end are stated outright, and a monotonic easing between two values cannot
 * overshoot.
 * ---------------------------------------------------------------------------------
 */

const DURATION_MS = 320;
/** Even deceleration. A front-loaded curve reads as a lurch on a panel this large. */
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** Drag further than this and the sheet dismisses instead of springing back. */
const DISMISS_PX = 110;
/** ...or flick faster than this, however far it travelled. */
const DISMISS_VELOCITY = 0.5; // px per ms

/**
 * Every mounted sheet, so a newly opening one can evict the others.
 *
 * Two modal <dialog>s can be in the top layer at once: tapping "Edit" inside the detail
 * sheet closes one and opens another in the same commit, so without this the outgoing
 * panel — its own grip, its own backdrop — was still on screen while the incoming one
 * animated through it. A hand-off is not the moment for a farewell animation.
 */
const mountedSheets = new Set<() => void>();

/**
 * Locking background scroll while a sheet is open.
 *
 * This deliberately does NOT pin `<body>` with `position: fixed`, which is what it used
 * to do and what most "iOS scroll lock" advice still recommends.
 *
 * That advice was written for a PARTIAL bottom sheet, where the page behind stays visible
 * beside and above the panel and any background scrolling is therefore obvious. This
 * sheet is a full-screen opaque take-over on a phone (see index.css), so there is nothing
 * to see behind it and nothing for a stray scroll to give away. The cost stayed, though,
 * and it is a bad one: pinning the body is the only code in this app that translates the
 * whole document vertically, by `-scrollY`. A modal rendering as a strip of its own bottom
 * edge at the top of the screen — the reported symptom on a real iPhone — is exactly what
 * "the panel got displaced upward by roughly a scroll offset" looks like. Whether iOS is
 * genuinely resolving the panel against the pinned body or not, keeping a document-moving
 * hack around to solve a problem the full-screen redesign already solved is trading a
 * confirmed layout risk for a benefit that no longer exists.
 *
 * `overflow: hidden` on both the element and the body, plus `overscroll-behavior: none`
 * to stop scroll chaining and the rubber-band, holds the page still without moving it.
 *
 * Reference-counted rather than a plain set/clear, because `mountedSheets` allows two
 * sheets to briefly coexist during a handoff (detail closes, edit opens, same commit) —
 * without counting, the first sheet's cleanup would unlock scrolling out from under the
 * second.
 */
let scrollLockCount = 0;
let savedScrollY = 0;
let saved: { bodyOverflow: string; bodyPaddingRight: string; rootOverflow: string; rootOverscroll: string } | null =
  null;

function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    const root = document.documentElement;
    savedScrollY = window.scrollY;
    saved = {
      bodyOverflow: document.body.style.overflow,
      bodyPaddingRight: document.body.style.paddingRight,
      rootOverflow: root.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
    };
    // Reserve the scrollbar's width so the page behind does not shift sideways when its
    // scrolling is disabled. Invisible with overlay scrollbars, obvious on Windows.
    const gutter = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;
  }
  scrollLockCount += 1;
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount > 0 || !saved) return;
  const root = document.documentElement;
  root.style.overflow = saved.rootOverflow;
  root.style.overscrollBehavior = saved.rootOverscroll;
  document.body.style.overflow = saved.bodyOverflow;
  document.body.style.paddingRight = saved.bodyPaddingRight;
  saved = null;
  restoreScroll();
}

/**
 * Put the page back where the lock found it.
 *
 * Normally a no-op — nothing here translates the document any more. It exists because the
 * browser can still scroll the page on its own while a sheet opens: `showModal()`
 * auto-focuses the dialog's first focusable child, and focusing an element scrolls it into
 * view. `overflow: hidden` does not prevent that (it stops *user* scroll input; a
 * programmatic scroll still lands, which is also why this correction works at all).
 *
 * The old body-pinning lock got this for free, since a `position: fixed` body cannot be
 * scrolled by anything. Locking without moving the document means it has to be explicit.
 */
function restoreScroll(): void {
  if (window.scrollY !== savedScrollY) window.scrollTo(0, savedScrollY);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function Sheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size = 'default',
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider variant for detail views that show more than a form. */
  size?: 'default' | 'wide';
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const animation = useRef<Animation | null>(null);
  const gesture = useRef<{ startY: number; startedAt: number; offset: number } | null>(null);

  /** Is the <dialog> in the DOM? Stays true through the exit animation. */
  const [mounted, setMounted] = useState(open);

  // Opening mounts immediately. Adjusted during render — React's documented pattern for
  // deriving state from a prop change — so the dialog never paints a frame unmounted.
  if (open && !mounted) setMounted(true);

  /** How far the panel must travel to sit completely below the viewport. */
  function travel(panel: HTMLElement): number {
    // offsetHeight over getBoundingClientRect: it is the untransformed layout height, so
    // a measurement taken mid-animation still returns the true distance.
    return panel.offsetHeight;
  }

  function isBottomSheet(): boolean {
    return window.matchMedia('(max-width: 59.99rem)').matches;
  }

  /**
   * `will-change: transform`, scoped to only while something is actually moving the
   * panel — never left on permanently.
   *
   * A composited ancestor is a real, documented way for a WebKit-family browser to drop
   * native momentum scrolling for a touch-scrolling descendant, and `.sheet__body` is
   * exactly that descendant: `overflow-y: auto` on a child of a permanently-composited
   * `.sheet__panel`. Reported directly: a touch-drag inside an open sheet did not scroll
   * at all, it just registered as a tap wherever the finger landed — which is what a
   * touch sequence looks like when the browser never recognises it as a scroll gesture
   * to begin with. Composited only for the ~320ms an animation or a drag is actually
   * happening removes the one thing in this file that stayed composited for the sheet's
   * entire open duration.
   */
  function beginTransformActivity(panel: HTMLElement): void {
    panel.style.willChange = 'transform';
  }

  function endTransformActivity(panel: HTMLElement): void {
    panel.style.willChange = 'auto';
  }

  /**
   * Stop an animation without leaving it running forever.
   *
   * `fill: 'both'` is what keeps the panel visually in place once an animation finishes
   * — cancelling it outright would snap the panel back to its unanimated CSS position.
   * But a `fill: 'both'` animation that is never cancelled stays in the 'finished' play
   * state indefinitely, which keeps its target composited for as long as the sheet is
   * open — the same problem `will-change` caused, from a different source. Committing
   * bakes the current value into a plain inline style, then cancelling removes the
   * animation itself; the panel does not move, because the inline style already says
   * where the animation left it.
   *
   * Guarded by identity: by the time `.finished` resolves, a newer animation (a drag, a
   * close) may already have replaced this one in `animation.current`, and settling a
   * stale animation would stomp on whatever that newer one is doing.
   */
  function settleWhenFinished(anim: Animation, panel: HTMLElement): void {
    anim.finished
      .then(() => {
        if (animation.current !== anim) return;
        anim.commitStyles();
        anim.cancel();
        endTransformActivity(panel);
      })
      // cancel() rejects `finished`; that is a normal outcome here, not an error.
      .catch(() => {});
  }

  /** Mount, show, lock the page — and undo all of it on the way out. */
  useLayoutEffect(() => {
    if (!mounted) return;
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!dialog || !panel) return;

    for (const evictOther of mountedSheets) evictOther();
    const evict = () => setMounted(false);
    mountedSheets.add(evict);

    opener.current = document.activeElement;

    // Locked BEFORE showModal(), so the scroll position it records is where she actually
    // was rather than wherever the browser's auto-focus is about to leave her.
    lockBodyScroll();
    if (!dialog.open) dialog.showModal();

    // showModal() auto-focuses the dialog's first focusable child, and focusing scrolls
    // that child into view. Taking focus explicitly, without scrolling, stops the browser
    // nudging anything further.
    panel.focus({ preventScroll: true });

    // ...and undo the scroll showModal()'s own auto-focus may already have done before we
    // got here. Inside a layout effect, so the correction lands before paint.
    restoreScroll();

    // Slide in, from measured pixels. On a wide screen the panel is a centred dialog, so
    // it lifts and fades a little rather than travelling the height of the viewport.
    const distance = isBottomSheet() ? travel(panel) : 12;
    const from = isBottomSheet()
      ? { transform: `translateY(${distance}px)` }
      : { transform: `translateY(${distance}px)`, opacity: '0' };
    const to = isBottomSheet()
      ? { transform: 'translateY(0px)' }
      : { transform: 'translateY(0px)', opacity: '1' };

    animation.current?.cancel();
    beginTransformActivity(panel);
    animation.current = panel.animate([from, to], {
      duration: prefersReducedMotion() ? 0 : DURATION_MS,
      easing: EASING,
      // `both` pins the start value from the moment the animation is created, so the
      // panel is never painted at its resting position for a frame first.
      fill: 'both',
    });
    settleWhenFinished(animation.current, panel);

    return () => {
      mountedSheets.delete(evict);
      animation.current?.cancel();
      animation.current = null;
      endTransformActivity(panel);
      unlockBodyScroll();
      if (dialog.open) dialog.close();
      // Focus goes back where it came from, so dismissing does not drop the user at the
      // top of the document.
      if (opener.current instanceof HTMLElement && opener.current.isConnected) {
        opener.current.focus();
      }
    };
  }, [mounted]);

  /** Slide out, then unmount. */
  useEffect(() => {
    if (open || !mounted) return;
    const panel = panelRef.current;
    if (!panel) {
      setMounted(false);
      return;
    }

    // Continue from wherever the panel currently is, so a drag-dismiss carries on from
    // the finger's last position instead of snapping back first.
    const current = gesture.current?.offset ?? currentOffset(panel);
    const distance = isBottomSheet() ? travel(panel) : 12;

    animation.current?.cancel();
    beginTransformActivity(panel);
    const exit = panel.animate(
      isBottomSheet()
        ? [{ transform: `translateY(${current}px)` }, { transform: `translateY(${distance}px)` }]
        : [
            { transform: `translateY(${current}px)`, opacity: '1' },
            { transform: `translateY(${distance}px)`, opacity: '0' },
          ],
      { duration: prefersReducedMotion() ? 0 : DURATION_MS, easing: EASING, fill: 'both' },
    );
    animation.current = exit;

    let cancelled = false;
    exit.finished
      .then(() => {
        if (!cancelled) setMounted(false);
      })
      // A cancel() rejects the promise; that is a normal outcome, not an error.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open, mounted]);

  // ---- Drag to dismiss -----------------------------------------------------------
  //
  // Driven straight through inline styles rather than React state: a re-render per
  // pointermove is both wasted work and a chance for the panel to lag the finger.

  function onGripPointerDown(event: React.PointerEvent) {
    // Only the bottom sheet is draggable; a centred desktop dialog is not something you
    // can pull down, so its grip is hidden.
    if (!isBottomSheet()) return;
    const panel = panelRef.current;
    if (!panel) return;

    // Hand control of the transform from the animation to the inline style.
    animation.current?.cancel();
    animation.current = null;
    beginTransformActivity(panel);
    panel.style.transform = 'translateY(0px)';

    gesture.current = { startY: event.clientY, startedAt: performance.now(), offset: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onGripPointerMove(event: React.PointerEvent) {
    const panel = panelRef.current;
    if (!gesture.current || !panel) return;

    // Downward only. Allowing upward drag would imply an expanded state that does not
    // exist — the same lie the inert grip used to tell.
    const offset = Math.max(0, event.clientY - gesture.current.startY);
    gesture.current.offset = offset;
    panel.style.transform = `translateY(${offset}px)`;
  }

  function onGripPointerUp(event: React.PointerEvent) {
    const panel = panelRef.current;
    if (!gesture.current || !panel) return;
    event.currentTarget.releasePointerCapture(event.pointerId);

    const { offset, startedAt } = gesture.current;
    const elapsed = performance.now() - startedAt;
    const velocity = elapsed > 0 ? offset / elapsed : 0;

    if (offset > DISMISS_PX || velocity > DISMISS_VELOCITY) {
      // Leave `gesture` set so the exit animation knows where to start from; the
      // unmount clears it.
      onClose();
      return;
    }

    gesture.current = null;
    animation.current?.cancel();
    animation.current = panel.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0px)' }],
      { duration: prefersReducedMotion() ? 0 : DURATION_MS, easing: EASING, fill: 'both' },
    );
    settleWhenFinished(animation.current, panel);
    panel.style.transform = '';
  }

  if (!mounted) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`sheet sheet--${size}`}
      aria-label={title}
      onCancel={(event) => {
        // Fires on Escape. Prevent the default close so React state stays the source of
        // truth rather than the dialog going visually closed while `open` is still set.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The <dialog> covers the whole viewport; the panel is its child. A click that
        // lands on the dialog itself is therefore a click outside the content.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="sheet__panel" ref={panelRef} tabIndex={-1}>
        <div
          className="sheet__grip-zone"
          onPointerDown={onGripPointerDown}
          onPointerMove={onGripPointerMove}
          onPointerUp={onGripPointerUp}
          onPointerCancel={onGripPointerUp}
        >
          <span className="sheet__grip" aria-hidden="true" />
        </div>

        <header className="sheet__head">
          <div className="sheet__heading">
            <h2 className="sheet__title">{title}</h2>
            {subtitle && <p className="sheet__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </dialog>
  );
}

/** The panel's current vertical displacement, whatever is producing it. */
function currentOffset(panel: HTMLElement): number {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
  return Number.isFinite(matrix.m42) ? matrix.m42 : 0;
}

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
 * `overflow: hidden` on `<body>` is the textbook approach and it is NOT enough on iOS
 * Safari — the page behind a modal keeps scrolling anyway, because iOS does not treat
 * `overflow: hidden` on `<body>` as a scroll boundary the way every other engine does.
 * The fix that iOS actually respects is pinning the body with `position: fixed`, which
 * is why this exists instead of the one-line version.
 *
 * Reference-counted rather than a plain set/clear, because `mountedSheets` allows two
 * sheets to briefly coexist during a handoff (detail closes, edit opens, same commit) —
 * without counting, the first sheet's cleanup would unlock scrolling out from under the
 * second, and `window.scrollY` reads 0 while the body is pinned, so a naive re-lock
 * would forget where the page actually was.
 */
let scrollLockCount = 0;
let savedScrollY = 0;
let savedPaddingRight = '';

function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    savedScrollY = window.scrollY;
    savedPaddingRight = document.body.style.paddingRight;
    // Reserve the scrollbar's width so the page behind does not shift sideways when its
    // scrolling is disabled. Invisible with overlay scrollbars, obvious on Windows.
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;
  }
  scrollLockCount += 1;
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount > 0) return;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.overflow = '';
  document.body.style.paddingRight = savedPaddingRight;
  // Restore exactly where she was — position: fixed disconnects the page from its own
  // scroll position, so without this closing a sheet would silently drop her at the top.
  window.scrollTo(0, savedScrollY);
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
   * The panel's height on a phone, measured rather than left to CSS.
   *
   * `88svh` in the stylesheet is correct by the spec and still there as a fallback, but
   * it lives inside a `<dialog>` shown via `showModal()`, and on a real device that has
   * been observed to size wrong — not a simulated small window, an actual iPhone in
   * Safari, reported twice, on two different sheets. `visualViewport` is the API iOS
   * Safari itself provides specifically for "what height is actually visible right now",
   * built for exactly this class of problem (the address bar, the keyboard, all of it).
   * Reading it directly and setting the height as an inline style bypasses whatever went
   * wrong in the CSS cascade entirely, because an inline style wins regardless of cause.
   */
  function panelHeightPx(): number {
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    return Math.round(viewport * 0.88);
  }

  /** Applies the measured height, and keeps it current — the keyboard opening or the
   * device rotating both change what "the viewport" means mid-session. */
  function syncPanelHeight() {
    const panel = panelRef.current;
    if (!panel || !isBottomSheet()) return;
    panel.style.height = `${panelHeightPx()}px`;
  }

  /**
   * Keep correcting the height for a moment after open, instead of trusting the first
   * reading.
   *
   * On a real device, `visualViewport.height` read at the exact instant the dialog opens
   * can catch Safari's chrome mid-transition and report a value that settles moments
   * later — confirmed because tapping the undersized panel was enough to fix it, and the
   * only thing in this file that reacts to anything after open is the resize listener
   * above. A tap is not a reliable way to trigger that correction, so this does the same
   * thing on a schedule instead: next frame, and again after the animation would have
   * finished, in case the settle takes longer than one frame.
   */
  function scheduleHeightRechecks(): () => void {
    const frame = requestAnimationFrame(syncPanelHeight);
    const timers = [100, 400].map((ms) => window.setTimeout(syncPanelHeight, ms));
    return () => {
      cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
    };
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

    // Locked BEFORE showModal(), not after: showModal() auto-focuses the first focusable
    // child, and that focus can scroll the page to reveal it — so capturing the scroll
    // position any later than this records wherever that auto-scroll already left it,
    // not where she actually was.
    lockBodyScroll();
    if (!dialog.open) dialog.showModal();

    // showModal()'s auto-focus can also scroll a container to reveal it. Taking focus
    // explicitly, without scrolling, keeps the browser from nudging anything further
    // while the panel is still off-screen.
    panel.focus({ preventScroll: true });

    // Set BEFORE travel() reads offsetHeight below, so the slide distance matches the
    // height actually in effect rather than whatever the stylesheet alone would produce.
    syncPanelHeight();
    window.visualViewport?.addEventListener('resize', syncPanelHeight);
    window.addEventListener('resize', syncPanelHeight);
    const cancelRechecks = scheduleHeightRechecks();
    // Belt and braces: a tap anywhere on the dialog is exactly what was observed to fix
    // an undersized panel on a real device, whatever the browser was doing internally to
    // make that true. Reacting to it directly does not depend on guessing why.
    dialog.addEventListener('pointerdown', syncPanelHeight);

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
      window.visualViewport?.removeEventListener('resize', syncPanelHeight);
      window.removeEventListener('resize', syncPanelHeight);
      cancelRechecks();
      dialog.removeEventListener('pointerdown', syncPanelHeight);
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

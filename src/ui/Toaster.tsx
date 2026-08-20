import { useStore } from '../app/storeContext';

/**
 * The undo toast.
 *
 * `role="status"` with aria-live="polite" rather than an alert: a deletion that is
 * immediately reversible is not an emergency, and assertive announcements interrupt
 * whatever the screen reader was saying.
 *
 * This is the entire confirmation strategy for the app. There are no "are you sure?"
 * dialogs — soft deletes make the undo real, and a modal asking twice is worse for
 * someone doing this one-handed than a five-second escape hatch.
 */
export function Toaster() {
  const { toast, dismissToast } = useStore();
  if (!toast) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <p className="toast__message">{toast.message}</p>
      {toast.undo && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.undo?.();
          }}
        >
          Undo
        </button>
      )}
      <button type="button" className="toast__dismiss" onClick={dismissToast} aria-label="Dismiss">
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
  /** Optional colour dot — used for the colour family list. */
  swatch?: string | null;
}

/**
 * An in-app dropdown.
 *
 * `<select>` renders its option list with the operating system, not the page: a grey
 * system menu on Windows, a wheel on iOS, a sheet on Android. It cannot be styled, its
 * rows cannot be given a 48px target, and it cannot show a colour dot beside a shade
 * name — so on the one screen where the list IS colours, the native control is actively
 * unhelpful.
 *
 * This is the standard listbox pattern, and it is a keyboard control first:
 *
 *   Enter / Space / ↓   open, landing on the current value
 *   ↑ ↓                 move through options
 *   Home / End          jump to first / last
 *   Enter               choose
 *   Escape              close, keeping the previous value
 *   Tab or click away   close
 *   Type a letter       jump to the next option starting with it
 *
 * Roles are wired so a screen reader announces it as a combobox with a listbox and a
 * selected option, which is exactly what the native element would have given us — the
 * part worth keeping.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  /** Which way the list opens, and how tall it may be. Measured, not assumed. */
  const [placement, setPlacement] = useState<{ above: boolean; maxHeight: number }>({
    above: false,
    maxHeight: 272,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buffer: '', at: 0 });

  const selectedIndex = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  );
  const selected = options[selectedIndex];

  // Close on an outside click or a focus that escapes the component. Both are needed:
  // pointerdown catches a click on the page, focusin catches Tab moving away.
  useEffect(() => {
    if (!open) return;

    const away = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open]);

  /**
   * Decide which way to open, before the browser paints.
   *
   * Inside a modal the list is clipped by the scrolling sheet body, so a dropdown near
   * the bottom of a form opened downwards into ~170px of space and showed two options —
   * the rest reachable only by scrolling the sheet. Now it measures the room on each
   * side of the trigger, opens toward whichever is larger, and caps its own height to
   * what is actually available.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const trigger = rootRef.current?.querySelector('.select__trigger');
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    // Clip to the scrollable ancestor (the sheet body) when there is one; otherwise to
    // the viewport. That container, not the window, is what actually cuts the list off.
    const clipper = rootRef.current?.closest('.sheet__body');
    const bounds = clipper
      ? clipper.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight };

    const GAP = 8;
    const below = bounds.bottom - rect.bottom - GAP;
    const above = rect.top - bounds.top - GAP;

    // Prefer downward — it is what people expect — and only flip when it genuinely buys
    // room. A list that fits below stays below.
    const wanted = Math.min(options.length * 56 + 8, 272);
    const flip = below < wanted && above > below;

    setPlacement({
      above: flip,
      maxHeight: Math.max(140, Math.min(wanted, flip ? above : below)),
    });
  }, [open, options.length]);

  // Keep the highlighted row in view when arrowing through a long list (all 20 colours).
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function openList() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(activeIndex);
        return;
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        return;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        break;
    }

    // Typeahead. Consecutive keystrokes within a second build a prefix, so "gl" finds
    // Glitter rather than stopping at Gold — the behaviour a native select has.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.buffer = now - state.at > 1000 ? event.key : state.buffer + event.key;
      state.at = now;

      const match = options.findIndex((option) =>
        option.label.toLowerCase().startsWith(state.buffer.toLowerCase()),
      );
      if (match >= 0) setActiveIndex(match);
    }
  }

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field" ref={rootRef}>
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>

      <div className="select">
        <button
          type="button"
          id={id}
          className={`select__trigger ${error ? 'control--invalid' : ''}`}
          role="combobox"
          aria-controls={listId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby={`${id}-label ${id}`}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
        >
          {selected?.swatch !== undefined && (
            <span
              className={`select__dot ${selected.swatch ? '' : 'select__dot--empty'}`}
              style={selected.swatch ? { background: selected.swatch } : undefined}
              aria-hidden="true"
            />
          )}
          <span className="select__value">{selected?.label ?? ''}</span>
          <Icon name="chevron" className={`select__chevron ${open ? 'is-open' : ''}`} />
        </button>

        {open && (
          <ul
            className={`select__list ${placement.above ? 'is-above' : ''}`}
            style={{ maxHeight: `${placement.maxHeight}px` }}
            id={listId}
            ref={listRef}
            role="listbox"
            aria-labelledby={`${id}-label`}
            tabIndex={-1}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  className={`select__option ${index === activeIndex ? 'is-active' : ''} ${
                    isSelected ? 'is-selected' : ''
                  }`}
                  /* pointerdown rather than click: the outside-click listener also runs
                     on pointerdown, and a click handler would fire after the list had
                     already been torn down. */
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(index);
                  }}
                  onPointerEnter={() => setActiveIndex(index)}
                >
                  {option.swatch !== undefined && (
                    <span
                      className={`select__dot ${option.swatch ? '' : 'select__dot--empty'}`}
                      style={option.swatch ? { background: option.swatch } : undefined}
                      aria-hidden="true"
                    />
                  )}
                  <span className="select__option-label">{option.label}</span>
                  {isSelected && <Icon name="check" className="select__tick" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

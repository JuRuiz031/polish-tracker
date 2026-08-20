import { useCallback, useEffect, useRef, useState } from 'react';
import { describeColor, hexToHsl, hslToHex, type Hsl } from './color';

/**
 * The in-app colour picker.
 *
 * This replaces `<input type="color">`, which hands off to the operating system: a
 * dated grid-and-dropper dialog on Windows, something else again on macOS, and on
 * mobile whatever the browser vendor decided that year. The app cannot style any of it,
 * cannot make its targets 48px, and cannot guarantee it is usable at all. So the picker
 * is built here, and looks and behaves identically everywhere.
 *
 * Two controls, both operable by pointer, touch, and keyboard:
 *
 *   - A saturation/lightness field. Drag anywhere in it; arrow keys nudge, shift-arrow
 *     jumps. It carries role="slider" with an aria-valuetext of the colour's plain name
 *     ("Deep pink"), because "#C8102E" tells a screen-reader user nothing.
 *   - A hue rail, which is a real <input type="range"> — free keyboard support, and the
 *     browser already knows how to drag it on a touchscreen.
 *
 * The plain-English name under the swatch is the point of the whole thing: it is what
 * lets someone confirm they picked the colour they meant without reading a hex code.
 */
export function CustomColor({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(value) ?? { h: 340, s: 70, l: 45 });
  const fieldRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Follow the value when it is changed from outside (a preset tapped above the panel),
  // but only when it genuinely differs — otherwise every internal update would round-trip
  // through hex and fight the drag.
  useEffect(() => {
    const incoming = hexToHsl(value);
    if (incoming && hslToHex(incoming) !== hslToHex(hsl)) setHsl(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = useCallback(
    (next: Hsl) => {
      setHsl(next);
      onChange(hslToHex(next));
    },
    [onChange],
  );

  /** Map a pointer position inside the field to saturation / lightness. */
  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const field = fieldRef.current;
      if (!field) return;

      const rect = field.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((clientY - rect.top) / rect.height, 0, 1);

      commit({ ...hsl, s: Math.round(x * 100), l: Math.round((1 - y) * 100) });
    },
    [commit, hsl],
  );

  /**
   * Pointer capture keeps the drag alive when the finger leaves the field, which is
   * constant on a phone — without it the swatch sticks the moment you overshoot.
   */
  useEffect(() => {
    if (!dragging.current) return;

    const move = (event: PointerEvent) => applyPointer(event.clientX, event.clientY);
    const up = () => {
      dragging.current = false;
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 10 : 2;
    const moves: Record<string, Partial<Hsl>> = {
      ArrowRight: { s: clamp(hsl.s + step, 0, 100) },
      ArrowLeft: { s: clamp(hsl.s - step, 0, 100) },
      ArrowUp: { l: clamp(hsl.l + step, 0, 100) },
      ArrowDown: { l: clamp(hsl.l - step, 0, 100) },
    };

    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    commit({ ...hsl, ...move });
  }

  const hex = hslToHex(hsl);
  const name = describeColor(hsl);

  return (
    <div className="custom-color">
      <div
        ref={fieldRef}
        className="custom-color__field"
        style={{ '--hue': hsl.h } as React.CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and lightness"
        aria-valuetext={name}
        aria-valuenow={hsl.l}
        aria-valuemin={0}
        aria-valuemax={100}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          dragging.current = true;
          applyPointer(event.clientX, event.clientY);
        }}
      >
        <span
          className="custom-color__thumb"
          style={{ left: `${hsl.s}%`, top: `${100 - hsl.l}%`, background: hex }}
          aria-hidden="true"
        />
      </div>

      <label className="custom-color__hue">
        <span className="visually-hidden">Hue</span>
        <input
          type="range"
          min={0}
          max={360}
          value={hsl.h}
          onChange={(event) => commit({ ...hsl, h: Number(event.target.value) })}
        />
      </label>

      <p className="custom-color__readout">
        <span className="custom-color__preview" style={{ background: hex }} aria-hidden="true" />
        <span className="custom-color__name">{name}</span>
      </p>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

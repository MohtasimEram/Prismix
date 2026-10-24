import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

interface ResizerProps {
  /** Which edge of the panel the handle sits on; dragging towards the page widens a panel on its `end` edge. */
  edge: 'start' | 'end';
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (width: number) => void;
  onReset: () => void;
}

const KEY_STEP = 16;

/**
 * A vertical drag handle on a panel's edge. Pointer capture keeps the drag
 * alive when the cursor leaves the strip; arrow keys resize it too (Home /
 * End jump to the limits) and a double-click restores the default width.
 * `edge: 'end'` is the right edge of a left panel; `'start'` the left edge
 * of a right panel.
 */
export function Resizer({ edge, value, min, max, label, onChange, onReset }: ResizerProps) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  const sign = edge === 'end' ? 1 : -1;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width: value };
    setActive(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    onChange(start.width + sign * (e.clientX - start.x));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setActive(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = edge === 'end' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = edge === 'end' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === grow) onChange(value + KEY_STEP);
    else if (e.key === shrink) onChange(value - KEY_STEP);
    else if (e.key === 'Home') onChange(min);
    else if (e.key === 'End') onChange(max);
    else if (e.key === 'Enter') onReset();
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      data-active={active || undefined}
      className={`group/resizer absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none outline-none max-sm:hidden ${edge === 'end' ? '-right-1' : '-left-1'}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onDoubleClick={onReset}
      onKeyDown={key}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover/resizer:bg-(--systemTertiary) group-focus-visible/resizer:bg-(--keyColor) group-data-active/resizer:w-0.5 group-data-active/resizer:bg-(--keyColor)" />
    </div>
  );
}

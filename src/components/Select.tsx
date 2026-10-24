import { ChevronsUpDown } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Menu, MenuItem } from './Menu';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Names the control for assistive tech; the row's visible text is usually the best label. */
  label: string;
  className?: string;
}

/**
 * A themed replacement for the native <select>, whose popup the OS draws (a
 * white, unstyled list on a dark page, clipped by the window edge). It opens
 * the app's own glass menu (Menu.tsx) with a check beside the current choice,
 * and keeps the keyboard behaviour: Enter/Space/↓ open, ↑/↓ move, Esc closes.
 */
export function Select<T extends string>({ value, options, onChange, label, className }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`flex w-[220px] flex-none items-center justify-between gap-2 rounded-[8px] bg-quaternary px-2.5 py-[5px] text-start type-body text-primary transition-[background-color] duration-100 hover:bg-[color-mix(in_srgb,var(--systemPrimary)_18%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--keyColor) data-open:bg-[color-mix(in_srgb,var(--systemPrimary)_18%,transparent)] ${className ?? ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current?.label ?? ''}`}
        data-open={open || undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? '—'}</span>
        <ChevronsUpDown size={14} strokeWidth={2} className="flex-none text-secondary" aria-hidden="true" />
      </button>
      {open && trigger.current && (
        <Menu anchor={trigger.current} label={label} onClose={() => setOpen(false)}>
          {options.map((option) => (
            <MenuItem
              key={option.value}
              checked={option.value === value}
              onSelect={() => {
                setOpen(false);
                trigger.current?.focus({ preventScroll: true });
                if (option.value !== value) onChange(option.value);
              }}
            >
              {option.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}

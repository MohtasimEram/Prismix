import { Pin, PinOff } from 'lucide-react';
import { usePins, type Pin as PinData } from '@/state/pins';
import { detailButton } from './DetailHeader';

/** Pins or unpins a playlist in the sidebar, from its page header. */
export function PinButton({ pin }: { pin: PinData }) {
  const pinned = usePins((s) => s.pins.some((p) => p.key === pin.key));
  const toggle = usePins((s) => s.toggle);
  return (
    <button
      className={detailButton.circle}
      aria-label={pinned ? 'Unpin from Sidebar' : 'Pin to Sidebar'}
      aria-pressed={pinned}
      title={pinned ? 'Unpin from Sidebar' : 'Pin to Sidebar'}
      onClick={() => toggle(pin)}
    >
      {pinned ? <PinOff size={16} strokeWidth={2.2} /> : <Pin size={16} strokeWidth={2.2} />}
    </button>
  );
}

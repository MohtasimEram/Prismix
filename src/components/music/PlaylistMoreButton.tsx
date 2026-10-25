import { MoreHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import { detailButton } from './DetailHeader';

/**
 * ⋯ in an own playlist's header. Delete Playlist asks once more inside the menu
 * (it can't be undone) before it does anything.
 */
export function PlaylistMoreButton({ title, pending, onDelete }: { title: string; pending: boolean; onDelete: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const close = useCallback(() => {
    setAnchor(null);
    setConfirming(false);
  }, []);
  return (
    <>
      <button
        className={detailButton.circle}
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={pending}
        onClick={(event) => (anchor ? close() : setAnchor(event.currentTarget))}
      >
        <MoreHorizontal size={18} strokeWidth={2.2} />
      </button>
      {anchor && (
        <Menu anchor={anchor} onClose={close} label="Playlist options">
          {confirming ? (
            <>
              <MenuHeader>Delete “{title}”?</MenuHeader>
              <div className="px-2 pb-1.5 type-callout text-secondary">This can’t be undone.</div>
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 size={15} />}
                destructive
                onSelect={() => {
                  close();
                  onDelete();
                }}
              >
                Delete
              </MenuItem>
              <MenuItem onSelect={close}>Cancel</MenuItem>
            </>
          ) : (
            <MenuItem icon={<Trash2 size={15} />} destructive onSelect={() => setConfirming(true)}>
              Delete Playlist
            </MenuItem>
          )}
        </Menu>
      )}
    </>
  );
}

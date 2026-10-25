import { Globe, Link2, Lock } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Menu, MenuHeader, MenuItem } from '@/components/Menu';
import { detailButton } from './DetailHeader';

export type Privacy = 'private' | 'unlisted' | 'public';

const CHOICES: { value: Privacy; label: string; hint: string }[] = [
  { value: 'private', label: 'Private', hint: 'Only you' },
  { value: 'unlisted', label: 'Unlisted', hint: 'Anyone with the link' },
  { value: 'public', label: 'Public', hint: 'Anyone' },
];

/**
 * Who can see one of the account's playlists, in its header: the icon says which
 * (a lock, a link, a globe), and the menu changes it.
 */
export function PlaylistPrivacyButton({ privacy, pending, onChange }: { privacy: Privacy | null; pending: boolean; onChange: (next: Privacy) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const Icon = privacy === 'private' ? Lock : privacy === 'unlisted' ? Link2 : Globe;
  const label = `Visibility: ${CHOICES.find((c) => c.value === privacy)?.label ?? 'Change who can see this playlist'}`;
  return (
    <>
      <button
        className={detailButton.circle}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={pending}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <Icon size={16} strokeWidth={2.2} />
      </button>
      {anchor && (
        <Menu anchor={anchor} onClose={close} label="Playlist visibility">
          <MenuHeader>Who can see this playlist</MenuHeader>
          {CHOICES.map((choice) => (
            <MenuItem
              key={choice.value}
              checked={privacy === choice.value}
              trailing={choice.hint}
              onSelect={() => {
                close();
                if (choice.value !== privacy) onChange(choice.value);
              }}
            >
              {choice.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}

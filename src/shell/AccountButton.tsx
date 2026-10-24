import { ChevronsUpDown } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import { signIn, signOut } from '@/desktop/session';
import { forgetSelection } from '@/desktop/ytAuth';
import { useRefreshYtAuth, useSelectChannel, useSetConnected, useYtAuth } from '@/extension/useYtAuth';

/** Opens Google's sign-in in Prismix's own isolated window (src-tauri/src/auth.rs). */
function openSignIn(addAccount = false): void {
  void signIn('youtube', addAccount).catch((error: unknown) => {
    window.alert(`Couldn’t open the sign-in window: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export async function signOutOfYouTube(): Promise<void> {
  forgetSelection();
  await signOut('youtube');
}

// The signed-out pill: Apple's red "Sign In" (report §1, .navigation__native-cta).
const pill =
  'self-start rounded-[16px] bg-key px-3.5 py-[5px] type-[600_13px/18px] text-white hover:brightness-[1.08] disabled:opacity-60';
const avatar = 'inline-grid flex-none place-items-center rounded-full bg-quinary object-cover type-[600_11px/1] text-secondary';

function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  return src ? (
    <img className={avatar} src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" />
  ) : (
    <span className={avatar} style={{ width: size, height: size }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The sidebar's account control (report §1: avatar and name at the bottom,
 * opening the account menu; a red "Sign In" pill when signed out).
 *
 * There is no sign-in form (prompt §5.3): "Sign In" opens Google's own
 * sign-in page in a separate window; the Rust side keeps the resulting
 * session in an encrypted vault and this updates itself when it lands.
 */
export function AccountButton() {
  const status = useYtAuth();
  const select = useSelectChannel();
  const connect = useSetConnected();
  const refresh = useRefreshYtAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  if (status.state !== 'ready') return null;
  const { auth } = status;

  if (!auth.browserSignedIn) {
    return (
      <button className={pill} onClick={() => openSignIn()}>
        Sign In
      </button>
    );
  }
  if (!auth.connected) {
    return (
      <button className={pill} onClick={() => connect.mutate(true)} disabled={connect.isPending}>
        Connect YouTube Music
      </button>
    );
  }
  if (!auth.active) {
    // Signed in, but the account couldn't be read (the reason is in Settings › Accounts).
    return (
      <button
        className={pill}
        title={auth.problem ?? undefined}
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
      >
        {refresh.isPending ? 'Reading account…' : 'Retry YouTube Sign-In'}
      </button>
    );
  }
  const active = auth.active;
  const multiple = auth.accounts.flatMap((a) => a.channels).length > 1;

  return (
    <>
      <button
        // Signed in: a 24px avatar and the name, opening the account menu.
        className="flex w-full min-w-0 items-center gap-2 rounded-nav px-1 py-1.5 text-start type-body-reduced text-primary hover:bg-quinary aria-expanded:bg-quinary"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <Avatar src={active.avatarUrl} name={active.name} size={24} />
        <span className="min-w-0 flex-1 truncate">{active.name}</span>
        {multiple && <ChevronsUpDown size={14} strokeWidth={2} className="flex-none text-secondary" />}
      </button>
      {anchor && (
        <Menu anchor={anchor} placement="above-start" onClose={close} label="Account">
          {auth.accounts.map((account) => (
            <div key={account.authUser} role="group" aria-label={account.email ?? account.name}>
              <MenuHeader>{account.email ?? account.name}</MenuHeader>
              {account.channels.map((channel) => (
                <MenuItem
                  key={channel.id}
                  checked={channel.id === active.id}
                  icon={<Avatar src={channel.avatarUrl} name={channel.name} size={20} />}
                  trailing={channel.brand ? 'Brand' : undefined}
                  onSelect={() => {
                    close();
                    if (channel.id !== active.id) select.mutate(channel.id);
                  }}
                >
                  {channel.name}
                </MenuItem>
              ))}
            </div>
          ))}
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              close();
              openSignIn(true);
            }}
          >
            Add Account
          </MenuItem>
          <MenuItem
            destructive
            onSelect={() => {
              close();
              connect.mutate(false);
            }}
          >
            Disconnect from Prismix
          </MenuItem>
          <MenuItem
            destructive
            onSelect={() => {
              close();
              if (window.confirm('Sign out of YouTube Music in Prismix? Your library and playlists stay on your account.')) {
                void signOutOfYouTube().then(() => refresh.mutate());
              }
            }}
          >
            Sign Out
          </MenuItem>
        </Menu>
      )}
    </>
  );
}

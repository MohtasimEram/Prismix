import { Check, ListMusic, Loader2, MoreHorizontal, Pin, Plus, Settings, TriangleAlert, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { PrefetchLink, PrefetchNavLink } from '@/components/PrefetchLink';
import { LogoMark } from '@/components/icons/LogoMark';
import {
  AlbumsIcon,
  AllPlaylistsIcon,
  ArtistsIcon,
  DiscoverIcon,
  DownloadsIcon,
  HomeIcon,
  MadeForYouIcon,
  NewIcon,
  RecentlyAddedIcon,
  SearchIcon,
  SongsIcon,
  type NavIconProps,
} from '@/components/icons/NavIcons';
import { Artwork } from '@/components/music/Artwork';
import { hrefFor } from '@/components/music/links';
import { LIBRARY_SECTIONS, type LibrarySection } from '@/data/music/library';
import { useAddToPlaylist, useCreatePlaylist, useLibraryPlaylists, useSignedIn } from '@/data/music/queries';
import { droppedTrack, isPrismixTrackDrag, useDragTrack } from '@/state/dragTrack';
import { useSpotifyPlaylists } from '@/data/spotify/queries';
import { useSpotifySignedIn } from '@/extension/useSpotifyAuth';
import { SIDEBAR_LIMITS, useLayout } from '@/state/layout';
import { PLAYLIST_MIME, sortByOrder, usePlaylistDrag, usePlaylistOrder } from '@/state/playlistOrder';
import { spotifyPinKey, usePins, ytmPinKey, type Pin as PinData } from '@/state/pins';
import { useUi } from '@/state/ui';
import { Resizer } from './Resizer';
import { AccountButton } from './AccountButton';
import { PlaylistRowMenu, runPlaylistAction, type PlaylistAction } from './PlaylistRowMenu';

interface NavItem {
  to: string;
  label: string;
  Icon: (props: NavIconProps) => React.ReactNode;
}

const PRIMARY: NavItem[] = [
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/home', label: 'Home', Icon: HomeIcon },
  { to: '/discover', label: 'Discover', Icon: DiscoverIcon },
  { to: '/new', label: 'New', Icon: NewIcon },
];

const LIBRARY_ICONS: Record<Exclude<LibrarySection, 'playlists'>, NavItem['Icon']> = {
  recent: RecentlyAddedIcon,
  artists: ArtistsIcon,
  albums: AlbumsIcon,
  songs: SongsIcon,
  'made-for-you': MadeForYouIcon,
};

const LIBRARY_PAGES: NavItem[] = (Object.keys(LIBRARY_ICONS) as (keyof typeof LIBRARY_ICONS)[]).map((section) => ({
  to: `/library/${section}`,
  label: LIBRARY_SECTIONS[section].title,
  Icon: LIBRARY_ICONS[section],
}));
const LIBRARY: NavItem[] = [...LIBRARY_PAGES, { to: '/downloads', label: 'Downloads', Icon: DownloadsIcon }];

// A sidebar row; NavLink sets aria-current on the page's own row.
const item =
  'group flex h-9 items-center gap-2 mb-0.5 p-1 rounded-nav type-body-reduced text-primary hover:bg-quinary aria-[current=page]:bg-nav-selected';
// Apple's glyphs, drawn at 24px (their 24-unit box), which the user preferred to Apple's own 28px.
/** A playlist row: a taller row with a larger cover and name than the page links. */
const playlistItem =
  'group flex h-11 items-center gap-2.5 mb-0.5 p-1 rounded-nav type-body text-primary hover:bg-quinary aria-[current=page]:bg-nav-selected';
const icon = 'inline-grid size-6 flex-none place-items-center text-primary group-aria-[current=page]:text-key';
const navLabel = 'min-w-0 truncate';
// "Library", "Playlists" (report §1: 12px/15px 600, secondary, padding 4px 8px).
const sectionHeader = 'mt-4 px-2 py-1 type-callout-emphasized text-secondary';
const list = 'flex flex-col';

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate: () => void }) {
  return (
    <ul className={list}>
      {items.map(({ to, label, Icon }) => (
        <li key={to}>
          <PrefetchNavLink to={to} className={item} onClick={onNavigate}>
            <Icon size={24} className={icon} />
            <span className={navLabel}>{label}</span>
          </PrefetchNavLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * A playlist's cover, 34px, beside its name; the list icon until it has one. A pinned playlist wears a
 * small tilted white pin on the cover's corner, on the Create button's colour (a faint tint over the
 * sidebar's glass). That colour is built up from solid layers, so the cover behind it doesn't show through.
 */
function Cover({ src, pinned = false }: { src: string | null; pinned?: boolean }) {
  return (
    <span className="relative inline-grid size-[34px] flex-none place-items-center">
      <span className="inline-grid size-[34px] place-items-center overflow-hidden rounded-[6px] bg-quinary text-secondary">
        {src ? <Artwork src={src} displayWidth={34} radius="6px" /> : <ListMusic size={18} strokeWidth={1.8} />}
      </span>
      {pinned && (
        <span className="pointer-events-none absolute -top-1.5 -right-1.5 size-[18px] rounded-full bg-[var(--pageBG)] shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" aria-hidden="true">
          <span className="grid size-full place-items-center rounded-full bg-key text-white shadow-xs">
            <Pin size={10} strokeWidth={2.4} className="rotate-[30deg]" />
          </span>
        </span>
      )}
    </span>
  );
}

const moreButton =
  'absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-[5px] text-secondary opacity-0 hover:bg-quaternary hover:text-primary focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:bg-quaternary aria-expanded:text-primary aria-expanded:opacity-100';

/** The playlist id behind a YouTube Music pin (`ytm:VL…`); null for Spotify's, which can't take a drop. */
const ytmPlaylistId = (pin: PinData): string | null => (pin.key.startsWith('ytm:') ? pin.key.slice(4).replace(/^VL/, '') || null : null);

/**
 * One playlist row: cover, name, and a ⋯ menu that shows on hover (play, pin, queue, save). A song
 * dragged from a track list can be dropped on a YouTube Music playlist's row to
 * add it; the row lights up while one is over it and confirms (or says it
 * failed) afterwards.
 */
function PlaylistRow({
  pin,
  pinned,
  section,
  onReorder,
  onNudge,
  onNavigate,
}: {
  pin: PinData;
  pinned: boolean;
  /** Rows only trade places within their section (pinned, YouTube Music, Spotify). */
  section: string;
  onReorder: (from: string, to: string, after: boolean) => void;
  onNudge: (key: string, direction: -1 | 1) => void;
  onNavigate: () => void;
}) {
  const toggle = usePins((s) => s.toggle);
  const playlistId = ytmPlaylistId(pin);
  const add = useAddToPlaylist();
  const dragging = useDragTrack((s) => s.track !== null);
  // Reordering: this row being dragged, and the line where a drop on it would land.
  const beingMoved = usePlaylistDrag((s) => s.key === pin.key);
  const dropLine = usePlaylistDrag((s) =>
    s.over?.key === pin.key && s.key !== pin.key && s.section === section ? (s.over.after ? 'after' : 'before') : null,
  );
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'added' | 'failed' | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (resultTimer.current && clearTimeout(resultTimer.current)), []);
  // A drag that ends anywhere (dropped elsewhere, cancelled with Esc) clears the highlight.
  useEffect(() => {
    if (!dragging) setOver(false);
  }, [dragging]);

  const show = (next: 'added' | 'failed') => {
    setResult(next);
    if (resultTimer.current) clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => setResult(null), 2200);
  };
  return (
    <li
      className={`group/row relative${beingMoved ? ' opacity-40' : ''}`}
      data-playlist-key={pin.key}
      onKeyDown={(event) => {
        // Alt + ↑ / ↓ moves the focused playlist, for those who don't drag.
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onNudge(pin.key, event.key === 'ArrowUp' ? -1 : 1);
        requestAnimationFrame(() => {
          const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-playlist-key]'));
          rows.find((row) => row.dataset.playlistKey === pin.key)?.querySelector<HTMLElement>('a')?.focus();
        });
      }}
      onDragStart={(event) => {
        // A playlist row dragged to a new place; the link's own URL payload is replaced.
        event.dataTransfer.clearData();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(PLAYLIST_MIME, pin.key);
        event.dataTransfer.setData('text/plain', pin.title.slice(0, 200));
        // After the browser has taken its drag image: restyling the row any sooner can cancel the drag.
        setTimeout(() => usePlaylistDrag.getState().start(pin.key, section), 0);
      }}
      onDragOver={(event) => {
        const move = usePlaylistDrag.getState();
        if (move.key !== null && event.dataTransfer.types.includes(PLAYLIST_MIME)) {
          if (move.section !== section) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const rect = event.currentTarget.getBoundingClientRect();
          move.hover(pin.key, event.clientY > rect.top + rect.height / 2);
          return;
        }
        // Only a song Prismix itself is dragging, and only onto a playlist that can take it.
        if (!playlistId || !isPrismixTrackDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
        if (usePlaylistDrag.getState().over?.key === pin.key) usePlaylistDrag.setState({ over: null });
      }}
      onDrop={(event) => {
        setOver(false);
        const move = usePlaylistDrag.getState();
        if (move.key !== null && event.dataTransfer.types.includes(PLAYLIST_MIME)) {
          if (move.section !== section) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onReorder(move.key, pin.key, event.clientY > rect.top + rect.height / 2);
          move.end();
          return;
        }
        const track = droppedTrack(event);
        if (!playlistId || !track) return;
        event.preventDefault();
        useDragTrack.getState().end();
        add.mutate(
          { playlistId, videoId: track.videoId },
          { onSuccess: () => show('added'), onError: () => show('failed') },
        );
      }}
    >
      {dropLine && (
        <span
          className={`pointer-events-none absolute inset-x-1 z-1 h-0.5 rounded-full bg-key ${dropLine === 'before' ? '-top-px' : '-bottom-px'}`}
          aria-hidden="true"
        />
      )}
      <PrefetchNavLink
        to={pin.href}
        className={`${playlistItem} pr-8${over ? ' bg-quaternary shadow-[inset_0_0_0_1.5px_var(--keyColor)]' : ''}${
          dragging && playlistId !== null && !over ? ' bg-quinary' : ''
        }`}
        onClick={onNavigate}
        // Drag a playlist up or down to change the order it is listed in.
        draggable
      >
        <Cover src={pin.thumbnail} pinned={pinned} />
        <span className={navLabel}>{pin.title}</span>
      </PrefetchNavLink>
      {result ? (
        <span
          className={`pointer-events-none absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center ${result === 'added' ? 'text-green' : 'text-destructive'}`}
          role="status"
          aria-label={result === 'added' ? `Added to ${pin.title}` : `Couldn’t add to ${pin.title}`}
        >
          {result === 'added' ? <Check size={15} strokeWidth={2.6} /> : <TriangleAlert size={15} strokeWidth={2.2} />}
        </span>
      ) : busy ? (
        <span className="pointer-events-none absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center text-secondary" role="status" aria-label="Loading playlist">
          <Loader2 size={15} strokeWidth={2.2} className="animate-spin" />
        </span>
      ) : (
        <button
          type="button"
          className={moreButton}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-label={`More options for ${pin.title}`}
          title="More"
          onClick={(event) => setMenu(menu ? null : event.currentTarget)}
        >
          <MoreHorizontal size={15} strokeWidth={2} />
        </button>
      )}
      {menu && (
        <PlaylistRowMenu
          anchor={menu}
          pin={pin}
          pinned={pinned}
          playlistId={playlistId}
          onClose={() => setMenu(null)}
          onTogglePin={() => toggle(pin)}
          // The id as the playlist's own page uses it, so its songs are read once between the two.
          onAction={(action: PlaylistAction) => playlistId && void runPlaylistAction(action, pin, pin.key.slice(4), setBusy)}
        />
      )}
    </li>
  );
}

/** The handlers a section of playlist rows needs to change its order, for [keys] as listed now. */
function reordering(keys: string[], move: (from: string, to: string, after: boolean) => void) {
  return {
    onReorder: move,
    onNudge: (key: string, direction: -1 | 1) => {
      const at = keys.indexOf(key);
      const neighbour = keys[at + direction];
      if (at >= 0 && neighbour !== undefined) move(key, neighbour, direction > 0);
    },
  };
}

/** Pinned playlists on their own, for when YouTube Music isn't signed in (otherwise they sit under Playlists). */
function PinnedNav({ onNavigate }: { onNavigate: () => void }) {
  const pins = usePins((s) => s.pins);
  const move = usePins((s) => s.move);
  if (!pins.length) return null;
  const order = reordering(pins.map((p) => p.key), move);
  return (
    <>
      <h2 className={sectionHeader}>Pinned</h2>
      <ul className={list}>
        {pins.map((pin) => (
          <PlaylistRow key={pin.key} pin={pin} pinned section="pinned" {...order} onNavigate={onNavigate} />
        ))}
      </ul>
    </>
  );
}

/**
 * The "Playlists" heading with a + at its end: it opens a small name field under
 * the heading, and Create makes a new private playlist on the account and opens it.
 */
function PlaylistsHeader({ onNavigate }: { onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useCreatePlaylist();
  const navigate = useNavigate();
  const title = name.trim();
  const cancel = () => {
    setOpen(false);
    setName('');
    create.reset();
  };
  const submit = () => {
    if (!title || create.isPending) return;
    create.mutate(title, {
      onSuccess: (id) => {
        cancel();
        onNavigate();
        navigate(`/playlist/${encodeURIComponent(`VL${id}`)}`);
      },
    });
  };
  return (
    <>
      <div className="mt-4 mb-2 flex items-center justify-between pr-1">
        <h2 className="px-2 py-1 type-callout-emphasized text-secondary">Playlists</h2>
        <button
          type="button"
          className="group/create inline-flex h-6 items-center gap-1 rounded-pill bg-quaternary pr-2.5 pl-1.5 type-callout-emphasized text-primary transition-colors duration-150 ease-out hover:bg-quinary aria-expanded:bg-quinary"
          aria-label="Create Playlist"
          title="Create a new playlist"
          aria-expanded={open}
          onClick={() => (open ? cancel() : setOpen(true))}
        >
          <Plus size={15} strokeWidth={2.2} className="text-secondary transition-colors duration-150 ease-out group-hover/create:text-primary group-aria-expanded/create:text-primary" />
          <span>Create</span>
        </button>
      </div>
      {open && (
        <div className="mb-1.5 flex flex-col gap-2 rounded-nav bg-quinary p-2">
          <input
            autoFocus
            value={name}
            maxLength={150}
            placeholder="Playlist name"
            aria-label="Playlist name"
            className="h-8 w-full min-w-0 rounded-[6px] border-[0.75px] border-quaternary bg-transparent px-2 type-body text-primary outline-none placeholder:text-tertiary focus:border-key"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              else if (event.key === 'Escape') {
                event.stopPropagation();
                cancel();
              }
            }}
          />
          <p className="px-0.5 type-callout text-tertiary">It starts out private. You can make it public from the playlist.</p>
          {create.isError && (
            <p className="px-0.5 type-callout text-destructive" role="alert">
              Couldn’t create the playlist. Try again.
            </p>
          )}
          <div className="flex justify-end gap-1.5">
            <button type="button" className="h-7 rounded-[6px] px-2.5 type-callout-emphasized text-secondary hover:bg-quaternary hover:text-primary" onClick={cancel}>
              Cancel
            </button>
            <button
              type="button"
              className="h-7 rounded-[6px] bg-key px-3 type-callout-emphasized text-white disabled:opacity-40 enabled:hover:opacity-90"
              disabled={!title || create.isPending}
              onClick={submit}
            >
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Library and Playlists (report §1), once YouTube requests are made as the user. */
function LibraryNav({ onNavigate }: { onNavigate: () => void }) {
  const playlists = useLibraryPlaylists();
  const pins = usePins((s) => s.pins);
  const refresh = usePins((s) => s.refresh);
  const pinned = new Set(pins.map((p) => p.key));
  const saved = usePlaylistOrder((s) => s.order);
  const rows: PinData[] = (playlists.data ?? []).map((playlist) => ({
    key: ytmPinKey(playlist.id),
    title: playlist.title,
    thumbnail: playlist.thumbnail,
    href: hrefFor(playlist) ?? '/library/playlists',
  }));
  // A renamed playlist or a new cover reaches its pin.
  useEffect(() => {
    for (const row of rows) if (usePins.getState().pins.some((p) => p.key === row.key)) refresh(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists.data]);
  const listed = sortByOrder(
    rows.filter((row) => !pinned.has(row.key)),
    saved,
  );
  const order = reordering(
    listed.map((row) => row.key),
    (from, to, after) =>
      usePlaylistOrder.getState().move(
        listed.map((row) => row.key),
        from,
        to,
        after,
      ),
  );
  const movePin = usePins((s) => s.move);
  const pinOrder = reordering(pins.map((p) => p.key), movePin);
  return (
    <>
      <h2 className={sectionHeader}>Library</h2>
      <NavList items={LIBRARY} onNavigate={onNavigate} />
      <PlaylistsHeader onNavigate={onNavigate} />
      <ul className={list}>
        <li>
          <PrefetchNavLink to="/library/playlists" className={item} onClick={onNavigate}>
            <AllPlaylistsIcon size={24} className={icon} />
            <span className={navLabel}>{LIBRARY_SECTIONS.playlists.title}</span>
          </PrefetchNavLink>
        </li>
        {/* Pinned playlists, from either catalogue, stay at the top of Playlists with a line below them. */}
        {pins.map((pin) => (
          <PlaylistRow key={pin.key} pin={pin} pinned section="pinned" {...pinOrder} onNavigate={onNavigate} />
        ))}
        {pins.length > 0 && listed.length > 0 && <li role="separator" className="mx-2 my-1.5 border-t-[0.5px] border-t-vibrant-divider" />}
        {listed.map((row) => (
          <PlaylistRow key={row.key} pin={row} pinned={false} section="ytm" {...order} onNavigate={onNavigate} />
        ))}
      </ul>
    </>
  );
}

/** Spotify's playlists, once the extension can read them as the user (prompt §7.1). */
function SpotifyNav({ onNavigate }: { onNavigate: () => void }) {
  const playlists = useSpotifyPlaylists();
  const pins = usePins((s) => s.pins);
  const refresh = usePins((s) => s.refresh);
  const pinned = new Set(pins.map((p) => p.key));
  const saved = usePlaylistOrder((s) => s.order);
  const rows: PinData[] = (playlists.data ?? []).map((playlist) => ({
    key: spotifyPinKey(playlist.id),
    title: playlist.name,
    thumbnail: playlist.imageUrl,
    href: `/spotify/playlist/${encodeURIComponent(playlist.id)}`,
  }));
  useEffect(() => {
    for (const row of rows) if (usePins.getState().pins.some((p) => p.key === row.key)) refresh(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists.data]);
  const listed = sortByOrder(
    rows.filter((row) => !pinned.has(row.key)),
    saved,
  );
  const order = reordering(
    listed.map((row) => row.key),
    (from, to, after) =>
      usePlaylistOrder.getState().move(
        listed.map((row) => row.key),
        from,
        to,
        after,
      ),
  );
  return (
    <>
      <h2 className={sectionHeader}>Spotify</h2>
      <ul className={list}>
        <li>
          <PrefetchNavLink to="/spotify" end className={item} onClick={onNavigate}>
            <AllPlaylistsIcon size={24} className={icon} />
            <span className={navLabel}>All Spotify Playlists</span>
          </PrefetchNavLink>
        </li>
        {listed.map((row) => (
          <PlaylistRow key={row.key} pin={row} pinned={false} section="spotify" {...order} onNavigate={onNavigate} />
        ))}
      </ul>
    </>
  );
}

/** The left glass sidebar (report §1). */
export function Sidebar() {
  const drawerOpen = useUi((s) => s.drawerOpen);
  const setDrawerOpen = useUi((s) => s.setDrawerOpen);
  const signedIn = useSignedIn();
  const spotifySignedIn = useSpotifySignedIn();
  const close = () => setDrawerOpen(false);
  const width = useLayout((s) => s.sidebarWidth);
  const setWidth = useLayout((s) => s.setSidebarWidth);

  return (
    <>
      {/* Below 484px the sidebar is a drawer opened from the top bar's menu button. */}
      <nav
        className="absolute inset-y-0 left-0 z-(--z-web-chrome) flex w-(--web-navigation-width) flex-col glass-material max-sm:w-[min(300px,82vw)] max-sm:-translate-x-full max-sm:shadow-glass max-sm:transition-transform max-sm:duration-(--duration-panel) max-sm:ease-panel max-sm:data-[open=true]:translate-none"
        data-open={drawerOpen}
        aria-label="Main"
      >
        <Resizer
          edge="end"
          label="Resize sidebar"
          value={width}
          min={SIDEBAR_LIMITS.min}
          max={SIDEBAR_LIMITS.max}
          onChange={setWidth}
          onReset={() => setWidth(SIDEBAR_LIMITS.fallback)}
        />
        <div className="mt-2 ml-2 flex h-18 items-center px-5">
          <PrefetchLink to="/home" className="inline-flex items-center gap-2 rounded-[6px]" aria-label="Prismix, Home" onClick={close}>
            {/* White on dark, as Apple's own wordmark; it follows the label colour so it stays visible in light. */}
            <LogoMark size={22} className="text-primary" />
            <span className="type-[700_19px/24px] tracking-[-0.01em]">Prismix</span>
          </PrefetchLink>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-3 pl-5 [scrollbar-width:none]">
          <NavList items={PRIMARY} onNavigate={close} />
          {!signedIn && <PinnedNav onNavigate={close} />}
          {signedIn && <LibraryNav onNavigate={close} />}
          {spotifySignedIn && <SpotifyNav onNavigate={close} />}
        </div>
        <div className="flex flex-col gap-2 pt-3 pr-3 pb-5 pl-5">
          <PrefetchNavLink to="/settings/listen-together" className={item} onClick={close}>
            <span className={icon}>
              <Users size={18} strokeWidth={1.9} />
            </span>
            <span className={navLabel}>Listen Together</span>
          </PrefetchNavLink>
          <AccountButton />
          <div className="flex items-center justify-between">
            <span className="ps-1 type-callout text-tertiary">Prismix for Desktop</span>
            <PrefetchNavLink to="/settings" className="grid size-7 place-items-center rounded-nav text-secondary hover:bg-quinary hover:text-primary aria-[current=page]:bg-quinary aria-[current=page]:text-primary" aria-label="Settings" title="Settings" onClick={close}>
              <Settings size={17} strokeWidth={1.9} />
            </PrefetchNavLink>
          </div>
        </div>
      </nav>
      {drawerOpen && <div className="absolute inset-0 z-[calc(var(--z-web-chrome)-1)] hidden bg-scrim max-sm:block" onClick={close} aria-hidden="true" />}
    </>
  );
}

import { Check, ListMusic, Pin, PinOff, Settings, TriangleAlert, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { useAddToPlaylist, useLibraryPlaylists, useSignedIn } from '@/data/music/queries';
import { droppedTrack, isPrismixTrackDrag, useDragTrack } from '@/state/dragTrack';
import { useSpotifyPlaylists } from '@/data/spotify/queries';
import { useSpotifySignedIn } from '@/extension/useSpotifyAuth';
import { SIDEBAR_LIMITS, useLayout } from '@/state/layout';
import { spotifyPinKey, usePins, ytmPinKey, type Pin as PinData } from '@/state/pins';
import { useUi } from '@/state/ui';
import { Resizer } from './Resizer';
import { AccountButton } from './AccountButton';

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

/** A playlist's cover, 28px, beside its name; the list icon until it has one. */
function Cover({ src }: { src: string | null }) {
  return (
    <span className="inline-grid size-7 flex-none place-items-center overflow-hidden rounded-[5px] bg-quinary text-secondary">
      {src ? <Artwork src={src} displayWidth={28} radius="5px" /> : <ListMusic size={16} strokeWidth={1.8} />}
    </span>
  );
}

const pinButton =
  'absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-[5px] text-secondary opacity-0 hover:bg-quaternary hover:text-primary focus-visible:opacity-100 group-hover/row:opacity-100 aria-pressed:text-key';

/** The playlist id behind a YouTube Music pin (`ytm:VL…`); null for Spotify's, which can't take a drop. */
const ytmPlaylistId = (pin: PinData): string | null => (pin.key.startsWith('ytm:') ? pin.key.slice(4).replace(/^VL/, '') || null : null);

/**
 * One playlist row: cover, name, and a pin toggle that shows on hover. A song
 * dragged from a track list can be dropped on a YouTube Music playlist's row to
 * add it; the row lights up while one is over it and confirms (or says it
 * failed) afterwards.
 */
function PlaylistRow({ pin, pinned, onNavigate }: { pin: PinData; pinned: boolean; onNavigate: () => void }) {
  const toggle = usePins((s) => s.toggle);
  const playlistId = ytmPlaylistId(pin);
  const add = useAddToPlaylist();
  const dragging = useDragTrack((s) => s.track !== null);
  const [over, setOver] = useState(false);
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
      className="group/row relative"
      onDragOver={(event) => {
        // Only a song Prismix itself is dragging, and only onto a playlist that can take it.
        if (!playlistId || !isPrismixTrackDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
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
      <PrefetchNavLink
        to={pin.href}
        className={`${item} pr-8${over ? ' bg-quaternary shadow-[inset_0_0_0_1.5px_var(--keyColor)]' : ''}${
          dragging && playlistId !== null && !over ? ' bg-quinary' : ''
        }`}
        onClick={onNavigate}
        // The row is a drop target, not something to drag along.
        draggable={false}
      >
        <Cover src={pin.thumbnail} />
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
      ) : (
        <button
          type="button"
          className={pinButton}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${pin.title}` : `Pin ${pin.title}`}
          title={pinned ? 'Unpin' : 'Pin to top'}
          onClick={() => toggle(pin)}
        >
          {pinned ? <PinOff size={14} strokeWidth={2} /> : <Pin size={14} strokeWidth={2} />}
        </button>
      )}
    </li>
  );
}

/** Pinned playlists, above the rest, from either catalogue. */
function PinnedNav({ onNavigate }: { onNavigate: () => void }) {
  const pins = usePins((s) => s.pins);
  if (!pins.length) return null;
  return (
    <>
      <h2 className={sectionHeader}>Pinned</h2>
      <ul className={list}>
        {pins.map((pin) => (
          <PlaylistRow key={pin.key} pin={pin} pinned onNavigate={onNavigate} />
        ))}
      </ul>
    </>
  );
}

/** Library and Playlists (report §1), once YouTube requests are made as the user. */
function LibraryNav({ onNavigate }: { onNavigate: () => void }) {
  const playlists = useLibraryPlaylists();
  const pins = usePins((s) => s.pins);
  const refresh = usePins((s) => s.refresh);
  const pinned = new Set(pins.map((p) => p.key));
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
  return (
    <>
      <h2 className={sectionHeader}>Library</h2>
      <NavList items={LIBRARY} onNavigate={onNavigate} />
      <h2 className={sectionHeader}>Playlists</h2>
      <ul className={list}>
        <li>
          <PrefetchNavLink to="/library/playlists" className={item} onClick={onNavigate}>
            <AllPlaylistsIcon size={24} className={icon} />
            <span className={navLabel}>{LIBRARY_SECTIONS.playlists.title}</span>
          </PrefetchNavLink>
        </li>
        {rows
          .filter((row) => !pinned.has(row.key))
          .map((row) => (
            <PlaylistRow key={row.key} pin={row} pinned={false} onNavigate={onNavigate} />
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
        {rows
          .filter((row) => !pinned.has(row.key))
          .map((row) => (
            <PlaylistRow key={row.key} pin={row} pinned={false} onNavigate={onNavigate} />
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
          <PinnedNav onNavigate={close} />
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

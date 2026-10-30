import { Check, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  announceChange,
  noteAddedHere,
  useAddPlaylistToPlaylist,
  useAddToPlaylist,
  useCreatePlaylist,
  useLibraryPlaylists,
  useLikeStatus,
  useLikedCover,
  usePlaylistInfos,
  usePlaylistOptions,
  useRemoveFromPlaylist,
  useRemovePlaylistFromPlaylist,
  useSetLiked,
  useSignedIn,
} from '@/data/music/queries';
import { PLAYLIST_NAME_MAX } from '@/data/music/api';
import { LIKED_MUSIC_PLAYLIST } from '@/data/music/library';
import { forgetPlaylistInPlaylist, isPlaylistInPlaylist, rememberPlaylistInPlaylist } from '@/lib/playlistInPlaylist';
import { useAddDialog, type AddDialogPlaylist, type AddDialogTrack } from '@/state/addDialog';
import { PlaylistCover } from './PlaylistCover';

/** Liked Music's row in the list: the song's star, which is a like rather than a playlist. */
const LIKED_KEY = 'liked-music';

interface Row {
  key: string;
  title: string;
  cover: string | null;
  liked: boolean;
  /** Whether the song is in it now (before any change made in the window). */
  initial: boolean;
}

const bare = (id: string) => id.replace(/^VL/, '');

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function CheckCircle({ on }: { on: boolean }) {
  return (
    <span
      className={`grid size-[22px] flex-none place-items-center rounded-full border-[1.5px] transition-colors ${
        on ? 'border-key bg-key text-white' : 'border-tertiary text-transparent group-hover/choice:border-secondary'
      }`}
      aria-hidden="true"
    >
      <Check size={13} strokeWidth={3.4} className="-translate-x-px" />
    </span>
  );
}

function ChoiceRow({ row, on, disabled, onToggle }: { row: Row; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      className="group/choice flex w-full items-center gap-3 rounded-[8px] px-2 py-1.5 text-start hover:bg-quinary focus-visible:bg-quinary focus-visible:outline-none disabled:opacity-60"
      onClick={onToggle}
    >
      <PlaylistCover src={row.cover} liked={row.liked && !row.cover} size={40} />
      <span className="min-w-0 flex-1 truncate type-body text-primary">{row.title}</span>
      <CheckCircle on={on} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="px-2 pt-3 pb-1 type-subhead-emphasized text-secondary">{title}</h3>
      {children}
    </section>
  );
}

function Dialog({ track }: { track: AddDialogTrack }) {
  const close = useAddDialog((s) => s.close);
  const { videoId } = track;
  const signedIn = useSignedIn();
  const options = usePlaylistOptions(videoId, true);
  const infos = usePlaylistInfos(true);
  const like = useLikeStatus(videoId);
  const likedCover = useLikedCover();
  const add = useAddToPlaylist();
  const remove = useRemoveFromPlaylist();
  const setLiked = useSetLiked();
  const create = useCreatePlaylist();

  const [search, setSearch] = useState('');
  // What the user has ticked or unticked, by row key. Nothing happens until Done.
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  // Playlists made in this window, until YouTube's own list shows them.
  const [made, setMade] = useState<{ id: string; title: string }[]>([]);

  const panel = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (like.data !== undefined) list.push({ key: LIKED_KEY, title: 'Liked Music', cover: likedCover, liked: true, initial: like.data === 'LIKE' });
    const seen = new Set<string>();
    for (const option of options.data ?? []) {
      const key = bare(option.playlistId);
      seen.add(key);
      list.push({ key, title: option.title, cover: infos.get(key)?.cover ?? null, liked: false, initial: option.contains });
    }
    for (const m of made) {
      if (!seen.has(bare(m.id))) list.push({ key: bare(m.id), title: m.title, cover: infos.get(bare(m.id))?.cover ?? null, liked: false, initial: true });
    }
    return list;
  }, [like.data, likedCover, options.data, infos, made]);

  const isOn = (row: Row) => (Object.hasOwn(choices, row.key) ? choices[row.key]! : row.initial);
  // The changes Done would make: a choice that differs from how things are.
  const changes = rows.filter((row) => Object.hasOwn(choices, row.key) && choices[row.key] !== row.initial);

  const needle = search.trim().toLowerCase();
  const shown = needle ? rows.filter((row) => row.title.toLowerCase().includes(needle)) : rows;
  const saved = shown.filter((row) => row.initial);
  const others = shown.filter((row) => !row.initial);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const before = opener.current;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (making) nameField.current?.focus();
  }, [making]);

  // Escape closes (or leaves the name field); Tab stays inside the window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (making) setMaking(false);
        else if (!busy) close();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!panel.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [making, busy, close]);

  const toggle = (row: Row) => {
    setProblem(null);
    setChoices((current) => ({ ...current, [row.key]: !isOn(row) }));
  };

  const makePlaylist = () => {
    const title = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!title || title.length > PLAYLIST_NAME_MAX || create.isPending) return;
    setProblem(null);
    create.mutate(
      { title, videoIds: [videoId] },
      {
        onSuccess: (id) => {
          noteAddedHere(id, videoId);
          setMade((list) => [...list, { id, title }]);
          setMaking(false);
          setName('');
          setSearch('');
          announceChange({ text: `Added to ${title}`, cover: null });
        },
        onError: () => setProblem('Couldn’t create the playlist. Try again.'),
      },
    );
  };

  const apply = async () => {
    if (!changes.length || busy) return;
    setBusy(true);
    setProblem(null);
    const added: Row[] = [];
    const removed: Row[] = [];
    const failed: Row[] = [];
    // One at a time: YouTube edits a playlist per request, and a failure stays attributable.
    for (const row of changes) {
      const wanted = choices[row.key]!;
      try {
        if (row.liked) await setLiked.mutateAsync({ videoId, liked: wanted, silent: true });
        else if (wanted) await add.mutateAsync({ playlistId: row.key, videoId, title: row.title, silent: true });
        else await remove.mutateAsync({ playlistId: row.key, videoId, silent: true });
        (wanted ? added : removed).push(row);
      } catch {
        failed.push(row);
      }
    }
    setBusy(false);
    const done = new Set([...added, ...removed].map((row) => row.key));
    // What went through is now how things are; what failed stays chosen so Done can try it again.
    setChoices((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !done.has(key))));
    const summary = (list: Row[], verb: string) =>
      `${verb} ${list.length === 1 ? list[0]!.title : `${list.length} ${plural(list.length, 'playlist', 'playlists')}`}`;
    if (added.length || removed.length) {
      const lead = added.length ? added : removed;
      announceChange({
        text: added.length ? summary(added, 'Added to') : summary(removed, 'Removed from'),
        detail: added.length && removed.length ? summary(removed, 'Removed from') : undefined,
        cover: lead[0]!.liked && !lead[0]!.cover ? 'liked' : lead[0]!.cover,
      });
    }
    if (failed.length) {
      setProblem(`Couldn’t update ${failed.map((row) => row.title).join(', ')}. Press Done to try again.`);
      return;
    }
    close();
  };

  const loading = options.isPending && !options.data;
  const empty = !loading && !options.isError && rows.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-(--z-modal) grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade bg-scrim" onPointerDown={() => !busy && close()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Add to playlist"
        className="relative flex max-h-[min(640px,100%)] w-[min(420px,100%)] animate-zoom flex-col overflow-hidden rounded-[14px] bg-thick-material shadow-[0_0_0_0.5px_var(--vibrantDivider),0_20px_60px_var(--glassMaterialShadowColor)] outline-none [backdrop-filter:saturate(2.2)_blur(40px)]"
      >
        <header className="flex items-center gap-3 px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate type-title-3-emphasized text-primary">Add to playlist</h2>
            <p className="truncate type-callout text-secondary">{[track.title, track.artist].filter(Boolean).join(' · ')}</p>
          </div>
          <button
            type="button"
            className="grid size-7 flex-none place-items-center rounded-full text-secondary hover:bg-quaternary hover:text-primary disabled:opacity-40"
            aria-label="Close"
            disabled={busy}
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-4 pb-2">
          <label className="flex h-9 items-center gap-2 rounded-pill border border-search-border bg-page px-3 focus-within:border-key">
            <Search size={15} strokeWidth={2.4} className="flex-none text-secondary" aria-hidden="true" />
            <input
              ref={searchField}
              type="text"
              value={search}
              maxLength={150}
              placeholder="Find a playlist"
              aria-label="Find a playlist"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 type-body text-primary shadow-none outline-none placeholder:text-tertiary"
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
        </div>

        <div className="px-2 pb-1">
          {making ? (
            <div className="mx-2 flex flex-col gap-2 rounded-[10px] bg-quinary p-2.5">
              <input
                ref={nameField}
                value={name}
                maxLength={PLAYLIST_NAME_MAX}
                placeholder="Playlist name"
                aria-label="New playlist name"
                className="h-8 w-full min-w-0 rounded-[6px] border-[0.75px] border-quaternary bg-transparent px-2 type-body text-primary outline-none placeholder:text-tertiary focus:border-key"
                onChange={(event) => setName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    makePlaylist();
                  }
                }}
              />
              <p className="px-0.5 type-callout text-tertiary">It starts private and holds this song. You can make it public from the playlist.</p>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  className="h-7 rounded-[6px] px-2.5 type-callout-emphasized text-secondary hover:bg-quaternary hover:text-primary"
                  onClick={() => setMaking(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-7 rounded-[6px] bg-key px-3 type-callout-emphasized text-white disabled:opacity-40 enabled:hover:opacity-90"
                  disabled={!name.trim() || create.isPending}
                  onClick={makePlaylist}
                >
                  {create.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[8px] px-2 py-1.5 text-start hover:bg-quinary focus-visible:bg-quinary focus-visible:outline-none disabled:opacity-50"
              disabled={busy || !signedIn}
              onClick={() => setMaking(true)}
            >
              <span className="grid size-10 flex-none place-items-center rounded-[6px] bg-quaternary text-primary">
                <Plus size={20} strokeWidth={2.2} />
              </span>
              <span className="type-body text-primary">New playlist</span>
            </button>
          )}
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto border-t-[0.5px] border-t-vibrant-divider px-2 pb-2">
          {loading && <p className="px-2 py-4 type-callout text-secondary">Loading your playlists…</p>}
          {options.isError && (
            <div className="flex items-center gap-3 px-2 py-4 type-callout text-secondary">
              <span className="flex-1">Couldn’t load your playlists.</span>
              <button type="button" className="rounded-[6px] bg-quaternary px-2.5 py-1 type-callout-emphasized text-primary hover:bg-quinary" onClick={() => void options.refetch()}>
                Retry
              </button>
            </div>
          )}
          {empty && <p className="px-2 py-4 type-callout text-secondary">No playlists yet. Make one with New playlist.</p>}
          {needle && !loading && rows.length > 0 && shown.length === 0 && (
            <p className="px-2 py-4 type-callout text-secondary">No playlist called “{search.trim()}”.</p>
          )}
          {needle ? (
            shown.length > 0 && (
              <Section title="Results">
                {shown.map((row) => (
                  <ChoiceRow key={row.key} row={row} on={isOn(row)} disabled={busy} onToggle={() => toggle(row)} />
                ))}
              </Section>
            )
          ) : (
            <>
              {saved.length > 0 && (
                <Section title="Saved in">
                  {saved.map((row) => (
                    <ChoiceRow key={row.key} row={row} on={isOn(row)} disabled={busy} onToggle={() => toggle(row)} />
                  ))}
                </Section>
              )}
              {others.length > 0 && (
                <Section title={saved.length > 0 ? 'Your playlists' : 'Playlists'}>
                  {others.map((row) => (
                    <ChoiceRow key={row.key} row={row} on={isOn(row)} disabled={busy} onToggle={() => toggle(row)} />
                  ))}
                </Section>
              )}
            </>
          )}
          {options.checking && !loading && (
            <p className="px-2 pt-3 type-callout text-tertiary" role="status">
              Checking which playlists already have this song…
            </p>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t-[0.5px] border-t-vibrant-divider px-4 py-3">
          <p className="min-w-0 flex-1 truncate type-callout text-destructive" role="alert">
            {problem}
          </p>
          <button
            type="button"
            className="h-8 rounded-pill px-3.5 type-callout-emphasized text-secondary hover:bg-quaternary hover:text-primary disabled:opacity-40"
            disabled={busy}
            onClick={close}
          >
            {changes.length > 0 ? 'Cancel' : 'Close'}
          </button>
          {/* Only once something has been changed. */}
          {changes.length > 0 && (
            <button
              type="button"
              className="h-8 animate-fade rounded-pill bg-key px-4 type-callout-emphasized text-white disabled:opacity-60 enabled:hover:opacity-90"
              disabled={busy}
              onClick={() => void apply()}
            >
              {busy ? 'Saving…' : 'Done'}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function PlaylistDialog({ source }: { source: AddDialogPlaylist }) {
  const close = useAddDialog((s) => s.close);
  const signedIn = useSignedIn();
  const library = useLibraryPlaylists();
  const infos = usePlaylistInfos(true);
  const addPlaylist = useAddPlaylistToPlaylist();
  const removePlaylist = useRemovePlaylistFromPlaylist();
  const create = useCreatePlaylist();

  const [search, setSearch] = useState('');
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ id: string; title: string }[]>([]);

  const panel = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    const seen = new Set<string>();
    const sourceBare = bare(source.playlistId);

    for (const p of library.data ?? []) {
      const key = bare(p.id);
      if (key === sourceBare || key === LIKED_MUSIC_PLAYLIST) continue;
      seen.add(key);
      const initial = isPlaylistInPlaylist(sourceBare, key);
      list.push({ key, title: p.title, cover: p.thumbnail ?? infos.get(key)?.cover ?? null, liked: false, initial });
    }
    for (const m of made) {
      const key = bare(m.id);
      if (!seen.has(key) && key !== sourceBare && key !== LIKED_MUSIC_PLAYLIST) {
        const initial = isPlaylistInPlaylist(sourceBare, key);
        list.push({ key, title: m.title, cover: infos.get(key)?.cover ?? null, liked: false, initial });
      }
    }
    return list;
  }, [library.data, infos, made, source.playlistId]);

  const isOn = (row: Row) => (Object.hasOwn(choices, row.key) ? choices[row.key]! : row.initial);
  const changes = rows.filter((row) => Object.hasOwn(choices, row.key) && choices[row.key] !== row.initial);

  const needle = search.trim().toLowerCase();
  const shown = needle ? rows.filter((row) => row.title.toLowerCase().includes(needle)) : rows;
  const saved = shown.filter((row) => row.initial);
  const others = shown.filter((row) => !row.initial);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const before = opener.current;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (making) nameField.current?.focus();
  }, [making]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (making) setMaking(false);
        else if (!busy) close();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!panel.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [making, busy, close]);

  const toggle = (row: Row) => {
    setProblem(null);
    setChoices((current) => ({ ...current, [row.key]: !isOn(row) }));
  };

  const makePlaylist = () => {
    const title = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!title || title.length > PLAYLIST_NAME_MAX || create.isPending) return;
    setProblem(null);
    create.mutate(
      { title, videoIds: [] },
      {
        onSuccess: async (id) => {
          try {
            await addPlaylist.mutateAsync({
              targetId: id,
              targetTitle: title,
              sourceId: source.playlistId,
              sourceTitle: source.title,
            });
            rememberPlaylistInPlaylist(source.playlistId, id);
            setMade((list) => [...list, { id, title }]);
            setMaking(false);
            setName('');
            setSearch('');
            close();
          } catch {
            setProblem('Created the playlist, but couldn’t add songs to it.');
          }
        },
        onError: () => setProblem('Couldn’t create the playlist. Try again.'),
      },
    );
  };

  const apply = async () => {
    if (!changes.length || busy) return;
    setBusy(true);
    setProblem(null);
    const added: Row[] = [];
    const removed: Row[] = [];
    const failed: Row[] = [];
    for (const row of changes) {
      const wanted = choices[row.key]!;
      try {
        if (wanted) {
          await addPlaylist.mutateAsync({
            targetId: row.key,
            targetTitle: row.title,
            sourceId: source.playlistId,
            sourceTitle: source.title,
          });
          rememberPlaylistInPlaylist(source.playlistId, row.key);
          added.push(row);
        } else {
          await removePlaylist.mutateAsync({
            targetId: row.key,
            targetTitle: row.title,
            sourceId: source.playlistId,
            sourceTitle: source.title,
          });
          forgetPlaylistInPlaylist(source.playlistId, row.key);
          removed.push(row);
        }
      } catch {
        failed.push(row);
      }
    }
    setBusy(false);
    const done = new Set([...added, ...removed].map((r) => r.key));
    setChoices((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !done.has(key))));
    if (failed.length) {
      setProblem(`Couldn’t update ${failed.map((row) => row.title).join(', ')}. Press Done to try again.`);
      return;
    }
    close();
  };

  const loading = library.isPending && !library.data;
  const empty = !loading && !library.isError && rows.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-(--z-modal) grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade bg-scrim" onPointerDown={() => !busy && close()} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Add to playlist"
        className="relative flex max-h-[min(640px,100%)] w-[min(420px,100%)] animate-zoom flex-col overflow-hidden rounded-[14px] bg-thick-material shadow-[0_0_0_0.5px_var(--vibrantDivider),0_20px_60px_var(--glassMaterialShadowColor)] outline-none [backdrop-filter:saturate(2.2)_blur(40px)]"
      >
        <header className="flex items-center gap-3 px-4 pt-4 pb-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate type-title-3-emphasized text-primary">Add to playlist</h2>
            <p className="truncate type-callout text-secondary">Adds all songs from “{source.title}”</p>
          </div>
          <button
            type="button"
            className="grid size-7 flex-none place-items-center rounded-full text-secondary hover:bg-quaternary hover:text-primary disabled:opacity-40"
            aria-label="Close"
            disabled={busy}
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-4 pb-2">
          <label className="flex h-9 items-center gap-2 rounded-pill border border-search-border bg-page px-3 focus-within:border-key">
            <Search size={15} strokeWidth={2.4} className="flex-none text-secondary" aria-hidden="true" />
            <input
              ref={searchField}
              type="text"
              value={search}
              maxLength={150}
              placeholder="Find a playlist"
              aria-label="Find a playlist"
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 type-body text-primary shadow-none outline-none placeholder:text-tertiary"
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
        </div>

        <div className="px-2 pb-1">
          {making ? (
            <div className="mx-2 flex flex-col gap-2 rounded-[10px] bg-quinary p-2.5">
              <input
                ref={nameField}
                value={name}
                maxLength={PLAYLIST_NAME_MAX}
                placeholder="Playlist name"
                aria-label="New playlist name"
                className="h-8 w-full min-w-0 rounded-[6px] border-[0.75px] border-quaternary bg-transparent px-2 type-body text-primary outline-none placeholder:text-tertiary focus:border-key"
                onChange={(event) => setName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    makePlaylist();
                  }
                }}
              />
              <p className="px-0.5 type-callout text-tertiary">It starts private and holds all songs from this playlist. You can make it public from the playlist.</p>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  className="h-7 rounded-[6px] px-2.5 type-callout-emphasized text-secondary hover:bg-quaternary hover:text-primary"
                  onClick={() => setMaking(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-7 rounded-[6px] bg-key px-3 type-callout-emphasized text-white disabled:opacity-40 enabled:hover:opacity-90"
                  disabled={!name.trim() || create.isPending}
                  onClick={makePlaylist}
                >
                  {create.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-[8px] px-2 py-1.5 text-start hover:bg-quinary focus-visible:bg-quinary focus-visible:outline-none disabled:opacity-50"
              disabled={busy || !signedIn}
              onClick={() => setMaking(true)}
            >
              <span className="grid size-10 flex-none place-items-center rounded-[6px] bg-quaternary text-primary">
                <Plus size={20} strokeWidth={2.2} />
              </span>
              <span className="type-body text-primary">New playlist</span>
            </button>
          )}
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto border-t-[0.5px] border-t-vibrant-divider px-2 pb-2">
          {loading && <p className="px-2 py-4 type-callout text-secondary">Loading your playlists…</p>}
          {library.isError && (
            <div className="flex items-center gap-3 px-2 py-4 type-callout text-secondary">
              <span className="flex-1">Couldn’t load your playlists.</span>
              <button type="button" className="rounded-[6px] bg-quaternary px-2.5 py-1 type-callout-emphasized text-primary hover:bg-quinary" onClick={() => void library.refetch()}>
                Retry
              </button>
            </div>
          )}
          {empty && <p className="px-2 py-4 type-callout text-secondary">No playlists yet. Make one with New playlist.</p>}
          {needle && !loading && rows.length > 0 && shown.length === 0 && (
            <p className="px-2 py-4 type-callout text-secondary">No playlist called “{search.trim()}”.</p>
          )}
          {needle ? (
            shown.length > 0 && (
              <Section title="Results">
                {shown.map((row) => (
                  <ChoiceRow key={row.key} row={row} on={isOn(row)} disabled={busy} onToggle={() => toggle(row)} />
                ))}
              </Section>
            )
          ) : (
            <>
              {saved.length > 0 && (
                <Section title="Saved in">
                  {saved.map((row) => (
                    <ChoiceRow key={row.key} row={row} on={isOn(row)} disabled={busy} onToggle={() => toggle(row)} />
                  ))}
                </Section>
              )}
              {others.length > 0 && (
                <Section title={saved.length > 0 ? 'Your playlists' : 'Playlists'}>
                  {others.map((row) => (
                    <ChoiceRow key={row.key} row={row} on={isOn(row)} disabled={busy} onToggle={() => toggle(row)} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t-[0.5px] border-t-vibrant-divider px-4 py-3">
          <p className="min-w-0 flex-1 truncate type-callout text-destructive" role="alert">
            {problem}
          </p>
          <button
            type="button"
            className="h-8 rounded-pill px-3.5 type-callout-emphasized text-secondary hover:bg-quaternary hover:text-primary disabled:opacity-40"
            disabled={busy}
            onClick={close}
          >
            {changes.length > 0 ? 'Cancel' : 'Close'}
          </button>
          {changes.length > 0 && (
            <button
              type="button"
              className="h-8 animate-fade rounded-pill bg-key px-4 type-callout-emphasized text-white disabled:opacity-60 enabled:hover:opacity-90"
              disabled={busy}
              onClick={() => void apply()}
            >
              {busy ? 'Saving…' : 'Done'}
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** The Add to Playlist window, once for the whole app: opened with useAddDialog().open(song) or openPlaylist(playlist). */
export function AddToPlaylistDialog() {
  const item = useAddDialog((s) => s.item);
  if (!item) return null;
  if (item.kind === 'playlist') {
    return <PlaylistDialog key={item.playlistId} source={item} />;
  }
  return <Dialog key={item.videoId} track={item} />;
}

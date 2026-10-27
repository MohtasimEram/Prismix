import { Check, Link2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, MenuHeader, MenuItem, MenuSeparator } from '@/components/Menu';
import { PLAYLIST_NAME_MAX } from '@/data/music/api';
import { useRenamePlaylist } from '@/data/music/queries';
import { copyText } from '@/lib/share';
import { PRIVACY_CHOICES, type Privacy } from './playlistPrivacy';
import { detailButton } from './DetailHeader';

/** A name as YouTube takes it: no control characters, no padding. */
function cleanName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/**
 * Share Playlist: copies [url]. The menu stays a moment to say it did, and for a
 * private playlist (a link only its owner can open) says that too.
 */
function ShareItem({ url, isPrivate, onClose }: { url: string; isPrivate: boolean; onClose: () => void }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <MenuItem
      icon={state === 'copied' ? <Check size={15} className="text-green" /> : <Link2 size={15} />}
      onSelect={() => {
        if (state !== 'idle') return;
        void copyText(url).then((ok) => {
          setState(ok ? 'copied' : 'failed');
          timer.current = setTimeout(onClose, ok ? (isPrivate ? 2600 : 900) : 1600);
        });
      }}
    >
      {state === 'copied' ? (isPrivate ? 'Link copied · only you can open it' : 'Link copied') : state === 'failed' ? 'Couldn’t copy the link' : 'Share Playlist'}
    </MenuItem>
  );
}

/** The rename prompt: a small dialog over the page, closed by Escape or a click outside while nothing is being saved. */
function RenameDialog({ title, pending, failed, onSubmit, onClose }: { title: string; pending: boolean; failed: boolean; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(title);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const clean = cleanName(name);
  const valid = clean.length > 0 && clean.length <= PLAYLIST_NAME_MAX;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = () => {
    if (!valid || pending) return;
    if (clean === title) onClose();
    else onSubmit(clean);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-modal) grid place-items-center bg-black/40 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Rename playlist"
        className="w-full max-w-[360px] animate-menu-in rounded-[12px] bg-thick-material p-4 shadow-[0_0_0_0.5px_var(--vibrantDivider),0_10px_40px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(32px)]"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            if (!pending) onClose();
          } else if (event.key === 'Tab') {
            // Keep the focus inside the dialog.
            const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? []);
            const first = items[0];
            const last = items.at(-1);
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 className="mb-3 type-title-3-emphasized text-primary">Rename Playlist</h2>
        <input
          ref={input}
          value={name}
          maxLength={PLAYLIST_NAME_MAX}
          placeholder="Playlist name"
          aria-label="Playlist name"
          disabled={pending}
          className="h-8 w-full min-w-0 rounded-[6px] border-[0.75px] border-quaternary bg-transparent px-2 type-body text-primary outline-none placeholder:text-tertiary focus:border-key disabled:opacity-60"
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        {failed && !pending && (
          <p role="alert" className="mt-2 type-callout text-destructive">
            Couldn’t rename the playlist. Try again.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-pill bg-quaternary px-3 type-callout-emphasized text-primary transition-colors duration-150 ease-out enabled:hover:bg-quinary disabled:opacity-40"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center rounded-pill bg-key px-3 type-callout-emphasized text-white enabled:hover:brightness-[1.08] disabled:opacity-40"
            disabled={!valid || pending}
            onClick={submit}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * ⋯ in a playlist's header, after Pin. An own playlist's menu renames it, shares
 * its link, changes who can see it and deletes it (asking once more, since that
 * can't be undone); any other playlist's menu has Share.
 */
export function PlaylistMoreButton({
  playlistId,
  title,
  shareUrl,
  editable,
  privacy,
  privacyPending,
  onPrivacy,
  deletePending,
  onDelete,
}: {
  playlistId: string;
  title: string;
  shareUrl: string;
  /** An own playlist: it can be renamed, made public or private, and deleted. */
  editable: boolean;
  privacy: Privacy | null;
  privacyPending: boolean;
  onPrivacy: (next: Privacy) => void;
  deletePending: boolean;
  onDelete: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rename = useRenamePlaylist();
  const close = useCallback(() => {
    setAnchor(null);
    setConfirming(false);
  }, []);
  const closeRename = useCallback(() => setRenaming(false), []);
  const busy = deletePending || privacyPending;
  return (
    <>
      <button
        className={detailButton.circle}
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={deletePending}
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
            <>
              {editable && (
                <MenuItem
                  icon={<Pencil size={15} />}
                  disabled={busy}
                  onSelect={() => {
                    close();
                    rename.reset();
                    setRenaming(true);
                  }}
                >
                  Rename Playlist
                </MenuItem>
              )}
              <ShareItem url={shareUrl} isPrivate={privacy === 'private'} onClose={close} />
              {editable && (
                <>
                  <MenuSeparator />
                  <MenuHeader>Who can see this playlist</MenuHeader>
                  {PRIVACY_CHOICES.map((choice) => (
                    <MenuItem
                      key={choice.value}
                      checked={privacy === choice.value}
                      trailing={choice.hint}
                      disabled={busy}
                      onSelect={() => {
                        close();
                        if (choice.value !== privacy) onPrivacy(choice.value);
                      }}
                    >
                      {choice.label}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 size={15} />} destructive disabled={busy} onSelect={() => setConfirming(true)}>
                    Delete Playlist
                  </MenuItem>
                </>
              )}
            </>
          )}
        </Menu>
      )}
      {renaming && (
        <RenameDialog
          title={title}
          pending={rename.isPending}
          failed={rename.isError}
          onClose={closeRename}
          onSubmit={(name) => rename.mutate({ playlistId, name }, { onSuccess: closeRename })}
        />
      )}
    </>
  );
}

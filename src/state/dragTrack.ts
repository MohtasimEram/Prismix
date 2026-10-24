import { create } from 'zustand';

/**
 * Drag and drop of songs onto playlists. A track row starts the drag, a
 * playlist row in the sidebar takes the drop.
 *
 * Browsers hide a drag's payload until the drop (getData is empty during
 * dragover), so the track being dragged is also kept here: that is what lets a
 * playlist row light up, or refuse, while the pointer is still over it.
 * Only drags that Prismix itself started carry the MIME type below, so text,
 * links or files dropped from elsewhere are never mistaken for a song.
 */

export const TRACK_MIME = 'application/x-prismix-track';

/** What a YouTube video id looks like; anything else is never sent to the account. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface DraggedTrack {
  videoId: string;
  title: string;
}

interface DragState {
  track: DraggedTrack | null;
  start: (track: DraggedTrack) => void;
  end: () => void;
}

export const useDragTrack = create<DragState>()((set) => ({
  track: null,
  start: (track) => set({ track }),
  end: () => set({ track: null }),
}));

export const isVideoId = (value: unknown): value is string => typeof value === 'string' && VIDEO_ID.test(value);

/** Begins dragging [track] from a row; false (and no drag) for a row that can't be added. */
export function beginTrackDrag(event: React.DragEvent, track: DraggedTrack): boolean {
  if (!isVideoId(track.videoId)) {
    event.preventDefault();
    return false;
  }
  const title = track.title.slice(0, 200);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(TRACK_MIME, JSON.stringify({ videoId: track.videoId, title }));
  // Plain text too, so dropping on a text field gives the title rather than nothing.
  event.dataTransfer.setData('text/plain', title);
  useDragTrack.getState().start({ videoId: track.videoId, title });
  return true;
}

/**
 * Props that make any element a drag source for [track]: spread them on a card,
 * a shelf row, or the player's title. Nothing (so no drag) for an item that
 * isn't a song, or whose id isn't a video id, so an album or artist card is
 * never mistaken for something playlist-addable.
 */
export function trackDragProps(track: DraggedTrack | null): {
  draggable?: true;
  onDragStart?: (event: React.DragEvent) => void;
  onDragEnd?: () => void;
} {
  if (!track || !isVideoId(track.videoId)) return {};
  return {
    draggable: true,
    onDragStart: (event) => void beginTrackDrag(event, track),
    onDragEnd: () => useDragTrack.getState().end(),
  };
}

/** The track a drop carries, validated; null for anything Prismix didn't start. */
export function droppedTrack(event: React.DragEvent): DraggedTrack | null {
  // Try the MIME payload first (standard browsers).
  if (event.dataTransfer.types.includes(TRACK_MIME)) {
    try {
      const raw = JSON.parse(event.dataTransfer.getData(TRACK_MIME)) as Partial<DraggedTrack> | null;
      if (raw && isVideoId(raw.videoId)) {
        return { videoId: raw.videoId, title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '' };
      }
    } catch {
      // fall through to store fallback
    }
  }
  // Fallback for Tauri/WebView2 on Windows where custom MIME types are hidden
  // during dragover/drop but the Zustand store still carries the dragged track.
  const storeTrack = useDragTrack.getState().track;
  return storeTrack ?? null;
}

/**
 * Whether the current drag is a Prismix track drag. Works in Tauri/WebView2
 * where custom MIME types are hidden during dragover (use store state instead).
 */
export function isPrismixTrackDrag(event: React.DragEvent): boolean {
  if (event.dataTransfer.types.includes(TRACK_MIME)) return true;
  // Fallback: check the Zustand store.
  return useDragTrack.getState().track !== null;
}

// A row that unmounts mid-drag (a virtualized list scrolling) never gets its own dragend:
// these catch the end of any drag, in the capture phase so a drop handler can't hide it.
if (typeof window !== 'undefined') {
  const clear = () => useDragTrack.getState().end();
  window.addEventListener('dragend', clear, true);
  window.addEventListener('drop', () => setTimeout(clear, 0), true);
}

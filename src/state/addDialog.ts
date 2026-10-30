import { create } from 'zustand';
import { isVideoId } from './dragTrack';

/** The song the Add to Playlist window is open for (components/music/AddToPlaylistDialog.tsx). */
export interface AddDialogTrack {
  kind?: 'track';
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
}

/** A whole playlist being saved into another playlist. */
export interface AddDialogPlaylist {
  kind: 'playlist';
  playlistId: string;
  title: string;
  thumbnail: string | null;
}

export type AddDialogItem = (AddDialogTrack & { kind?: 'track' }) | AddDialogPlaylist;

interface AddDialogState {
  item: AddDialogItem | null;
  track: AddDialogTrack | null;
  open: (target: AddDialogTrack | AddDialogItem) => void;
  openPlaylist: (playlist: { playlistId: string; title: string; thumbnail?: string | null }) => void;
  close: () => void;
}

export const useAddDialog = create<AddDialogState>()((set) => ({
  item: null,
  track: null,
  open: (target) => {
    if ('videoId' in target && isVideoId(target.videoId)) {
      const track: AddDialogTrack = {
        kind: 'track',
        videoId: target.videoId,
        title: target.title,
        artist: target.artist,
        thumbnail: target.thumbnail,
      };
      set({ item: track, track });
    } else if ('kind' in target && target.kind === 'playlist') {
      set({ item: target, track: null });
    }
  },
  openPlaylist: (playlist) => {
    const item: AddDialogPlaylist = {
      kind: 'playlist',
      playlistId: playlist.playlistId,
      title: playlist.title,
      thumbnail: playlist.thumbnail ?? null,
    };
    set({ item, track: null });
  },
  close: () => set({ item: null, track: null }),
}));

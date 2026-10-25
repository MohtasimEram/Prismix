import { create } from 'zustand';
import { isVideoId } from './dragTrack';

/**
 * The songs saved from Prismix: what was saved, in which quality, and where the file went
 * (playback/download.ts adds to this when a save finishes). The list is a record kept in this
 * app; the files themselves are plain audio files in Downloads/Prismix. The player bar's
 * Download button deletes the file again (playback/download.ts removeDownload); removing a row
 * on the Downloads page only forgets it.
 */

export interface DownloadedSong {
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  /** Where the file was written; empty when the save was a browser download and the place isn't known. */
  path: string;
  /** "opus · 139 kbps". */
  quality: string;
  /** When it finished, ms since 1970. */
  at: number;
}

const KEY = 'prismix:downloads';
const MAX_KEPT = 1000;

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** The saved list, checked field by field; entries that can't be trusted are dropped. */
export function parseDownloads(raw: string | null): DownloadedSong[] {
  try {
    const list = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: DownloadedSong[] = [];
    for (const item of list.slice(0, MAX_KEPT)) {
      const e = item as Partial<DownloadedSong> | null;
      if (!e || typeof e !== 'object' || !isVideoId(e.videoId) || seen.has(e.videoId)) continue;
      seen.add(e.videoId);
      out.push({
        videoId: e.videoId,
        title: text(e.title, 300),
        artist: text(e.artist, 300),
        thumbnail: typeof e.thumbnail === 'string' && /^https:\/\//i.test(e.thumbnail) && e.thumbnail.length < 2048 ? e.thumbnail : null,
        path: text(e.path, 1024),
        quality: text(e.quality, 80),
        at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function load(): DownloadedSong[] {
  try {
    return parseDownloads(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

interface DownloadsLibraryState {
  songs: DownloadedSong[];
  /** Records a finished save; a song saved again moves to the top with its new file. */
  add: (song: DownloadedSong) => void;
  remove: (videoId: string) => void;
  clear: () => void;
}

export const useDownloadsLibrary = create<DownloadsLibraryState>()((set) => ({
  songs: load(),
  add: (song) => set((s) => ({ songs: [song, ...s.songs.filter((x) => x.videoId !== song.videoId)].slice(0, MAX_KEPT) })),
  remove: (videoId) => set((s) => ({ songs: s.songs.filter((x) => x.videoId !== videoId) })),
  clear: () => set({ songs: [] }),
}));

useDownloadsLibrary.subscribe(({ songs }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(songs));
  } catch {
    // Storage full or blocked: the list lasts for this run.
  }
});

import { create } from 'zustand';
import { isDev } from '@/lib/isDev';

/**
 * A music video's picture (playback/youtube/videoDeck.ts plays it). One muted
 * <video> element follows the audio; the surfaces that show it (the mini
 * player's preview, the full-screen player) take turns holding it, the one
 * mounted last in front, as only one can be on screen at a time.
 */
interface VideoState {
  /** The track whose picture is loaded, once its first frame is ready to show. */
  videoId: string | null;
  /** Width over height, e.g. 16/9. */
  aspect: number;
  /** How many surfaces want the picture; with none it isn't streamed. */
  surfaces: number;
  /** The track that has a picture to offer (a music video or a YouTube video), whether or not it is being watched. */
  offered: string | null;
}

export const useVideo = create<VideoState>()(() => ({ videoId: null, aspect: 16 / 9, surfaces: 0, offered: null }));

const WATCH_KEY = 'prismix:watch-video';

interface WatchState {
  /** Whether a track's picture is streamed and shown. Off: only the music plays, and no video data is fetched. */
  watch: boolean;
  setWatch: (on: boolean) => void;
  toggle: () => void;
}

function loadWatch(): boolean {
  try {
    return localStorage.getItem(WATCH_KEY) === '1';
  } catch {
    return false;
  }
}

/** Watching is a choice the listener makes; a video plays as audio until they do. */
export const useWatchVideo = create<WatchState>()((set, get) => ({
  watch: loadWatch(),
  setWatch: (watch) => set({ watch }),
  toggle: () => set({ watch: !get().watch }),
}));

useWatchVideo.subscribe(({ watch }) => {
  try {
    localStorage.setItem(WATCH_KEY, watch ? '1' : '0');
  } catch {
    // Storage full or blocked: the choice lasts for this run.
  }
});

/** Whether [videoId]'s picture is ready to show. */
export const useHasVideo = (videoId: string | null | undefined) => useVideo((s) => !!videoId && s.videoId === videoId);

let element: HTMLVideoElement | null = null;

export function getVideoElement(): HTMLVideoElement {
  if (!element) {
    element = document.createElement('video');
    element.muted = true;
    element.playsInline = true;
    element.disablePictureInPicture = true;
    element.setAttribute('aria-hidden', 'true');
    // For browser-driven tests, next to __bcAudio.
    if (isDev) Object.assign(window, { __bcVideo: element });
  }
  return element;
}

export type VideoFit = 'cover' | 'contain';

const stack: { host: HTMLElement; fit: VideoFit }[] = [];

function place() {
  const top = stack[stack.length - 1];
  const video = getVideoElement();
  if (!top) {
    video.remove();
    return;
  }
  video.className = top.fit === 'contain' ? 'block size-full object-contain' : 'block size-full object-cover';
  if (video.parentElement !== top.host) top.host.append(video);
}

/** Puts the picture in [host] until the returned release is called. */
export function claimVideoSurface(host: HTMLElement, fit: VideoFit): () => void {
  const entry = { host, fit };
  stack.push(entry);
  place();
  useVideo.setState((s) => ({ surfaces: s.surfaces + 1 }));
  return () => {
    const at = stack.indexOf(entry);
    if (at >= 0) stack.splice(at, 1);
    place();
    useVideo.setState((s) => ({ surfaces: s.surfaces - 1 }));
  };
}

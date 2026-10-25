import { create } from 'zustand';
import { invoke, invokeRaw, isDesktop } from '@/desktop/tauri';
import type { Track } from '@/data/music/types';
import { botguard } from './youtube/botguard';
import { getInnertube } from './youtube/innertube';
import { resolvePlayer, usesWebPo, UnplayableError, type PlayerClientName } from './youtube/resolver';
import { useDownloadsLibrary } from '@/state/downloadsLibrary';
import { DOWNLOAD_FORMATS, pickAudio, useQuality } from './quality';
import { defragment } from './remux';

/**
 * Saves a song's audio to the computer, at the chosen download quality
 * (playback/quality.ts). The file is the stream YouTube Music serves,
 * untouched: AAC in an .m4a by default, or Opus in a .webm (Settings › Download Format). It is fetched in ranged
 * pieces from the response's direct URLs (the clients that answer with
 * them, such as VISIONOS; SABR-only answers are skipped for the next client)
 * and handed to the browser's own save flow.
 */

export type DownloadState = 'working' | 'done' | 'failed';

export interface DownloadEntry {
  videoId: string;
  title: string;
  state: DownloadState;
  /** 0–1 while working. */
  progress: number;
  /** What was saved, e.g. "Opus · 139 kbps", or why it failed. */
  detail: string;
  /** A finished entry that is a deletion, not a save (the toast words it differently). */
  removed?: boolean | undefined;
}

interface DownloadsState {
  entries: DownloadEntry[];
  update: (entry: DownloadEntry) => void;
  dismiss: (videoId: string) => void;
}

export const useDownloads = create<DownloadsState>()((set) => ({
  entries: [],
  update: (entry) =>
    set((s) => ({
      entries: s.entries.some((e) => e.videoId === entry.videoId)
        ? s.entries.map((e) => (e.videoId === entry.videoId ? entry : e))
        : [...s.entries, entry],
    })),
  dismiss: (videoId) => set((s) => ({ entries: s.entries.filter((e) => e.videoId !== videoId) })),
}));

const CHUNK_BYTES = 1_000_000;
const MAX_CLIENT_TRIES = 3;

/** A file name Windows, macOS and Linux all accept. */
export function fileNameFor(track: Pick<Track, 'title' | 'artists'>, extension: string): string {
  const artists = track.artists.map((a) => a.name).join(', ');
  const base = [artists, track.title].filter(Boolean).join(' - ') || 'Prismix track';
  const safe = base
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return `${safe || 'Prismix track'}.${extension}`;
}

const codecOf = (mime: string) => /codecs="?([^",;]+)/.exec(mime)?.[1] ?? '';

async function fetchChunks(url: string, total: number, onProgress: (done: number) => void): Promise<Uint8Array[]> {
  const parts: Uint8Array[] = [];
  let received = 0;
  while (received < total) {
    const end = Math.min(received + CHUNK_BYTES, total) - 1;
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}range=${received}-${end}`);
    if (!response.ok) throw new Error(`The server refused part of the file (HTTP ${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error('The server sent an empty part of the file');
    parts.push(bytes);
    received += bytes.length;
    onProgress(Math.min(1, received / total));
  }
  return parts;
}

/** Joins the downloaded pieces into one buffer. */
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Saves the file. The desktop app writes it to Downloads/Prismix itself (a
 * blob link doesn't save in every webview); a plain browser uses a link.
 * Returns where it went, when that is known.
 */
async function saveFile(parts: Uint8Array[], mime: string, name: string): Promise<string | null> {
  if (isDesktop()) return invokeRaw<string>('save_download', concat(parts), { 'x-file-name': encodeURIComponent(name) });
  saveBlob(new Blob(parts as BlobPart[], { type: mime }), name);
  return null;
}

function saveBlob(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // The save has started by the time the click returns; give it a moment before freeing the bytes.
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export async function downloadTrack(track: Track): Promise<void> {
  const { videoId, title } = track;
  const { update } = useDownloads.getState();
  const existing = useDownloads.getState().entries.find((e) => e.videoId === videoId);
  if (existing?.state === 'working') return;
  const report = (state: DownloadState, progress: number, detail: string) => update({ videoId, title, state, progress, detail });
  report('working', 0, 'Preparing…');
  try {
    const yt = await getInnertube();
    const skip = new Set<PlayerClientName>();
    for (let attempt = 0; attempt < MAX_CLIENT_TRIES; attempt++) {
      const resolved = await resolvePlayer(yt, videoId, skip);
      const playable = (resolved.info.streaming_data?.adaptive_formats ?? []).filter(
        (f) => f.has_audio && !f.has_video && (f.url || f.signature_cipher || f.cipher) && !/drc/i.test(String(f.audio_track?.id ?? '')),
      );
      // The chosen file type first (M4A by default); if YouTube offers none of it for this song, whatever it does offer.
      const { download, downloadFormat } = useQuality.getState();
      const wanted = DOWNLOAD_FORMATS.find((f) => f.id === downloadFormat)!.codec;
      const ofWanted = playable.filter((f) => (wanted === 'mp4a' ? codecOf(f.mime_type).startsWith('mp4a') : codecOf(f.mime_type).startsWith('opus')));
      const formats = ofWanted.length ? ofWanted : playable;
      if (!formats.length) {
        skip.add(resolved.client);
        continue;
      }
      const index = pickAudio(
        formats.map((f) => ({ codec: codecOf(f.mime_type), kbps: Math.round((f.average_bitrate ?? f.bitrate) / 1000) })),
        download,
        [wanted, wanted === 'mp4a' ? 'opus' : 'mp4a'],
      );
      const format = formats[index];
      if (!format) throw new Error('No audio stream to save');
      const decoded = await format.decipher(yt.session.player);
      if (!decoded) throw new Error('Could not unlock the audio link');
      const url = new URL(decoded);
      if (usesWebPo(resolved.client)) {
        const pot = await botguard.mint(videoId);
        if (pot) url.searchParams.set('pot', pot);
      }
      const total = Number(format.content_length);
      if (!Number.isFinite(total) || total <= 0) throw new Error('The stream does not say how big it is');

      const parts = await fetchChunks(url.toString(), total, (done) => report('working', done, 'Downloading…'));
      const mime = format.mime_type.split(';')[0] ?? 'audio/webm';
      const extension = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'm4a' : 'audio';
      // YouTube's AAC comes as DASH fragments, which Windows Media Player and others can't open;
      // rewritten as an ordinary .m4a (same audio). If that fails, the original bytes are saved.
      const bytes = extension === 'm4a' ? defragment(concat(parts)) : null;
      const savedTo = await saveFile(bytes ? [bytes] : parts, mime, fileNameFor(track, extension));
      const codec = codecOf(format.mime_type).split('.')[0] ?? '';
      const quality = `${codec} · ${Math.round((format.average_bitrate ?? format.bitrate) / 1000)} kbps`;
      report('done', 1, savedTo ? `${quality} · ${savedTo}` : quality);
      useDownloadsLibrary.getState().add({
        videoId,
        title: track.title,
        artist: track.artists.map((a) => a.name).join(', '),
        thumbnail: track.thumbnail,
        path: savedTo ?? '',
        quality,
        at: Date.now(),
      });
      return;
    }
    throw new Error('YouTube only offers this song as a stream that can’t be saved yet');
  } catch (error) {
    const message = error instanceof UnplayableError ? error.message : error instanceof Error ? error.message : String(error);
    report('failed', 0, message);
  }
}

/**
 * Takes a saved song back off the computer: the file in Downloads/Prismix is deleted and the
 * song is forgotten, so its download button goes back to normal. If the file can't be
 * deleted the song stays marked as saved and the toast says why.
 */
export async function removeDownload(track: Pick<Track, 'videoId' | 'title'>, { quiet = false }: { quiet?: boolean } = {}): Promise<boolean> {
  const { videoId, title } = track;
  const saved = useDownloadsLibrary.getState().songs.find((s) => s.videoId === videoId);
  try {
    if (saved?.path && isDesktop()) await invoke<void>('delete_download', { path: saved.path });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!quiet) useDownloads.getState().update({ videoId, title, state: 'failed', progress: 0, detail: `Couldn’t delete the file: ${message}`, removed: true });
    return false;
  }
  useDownloadsLibrary.getState().remove(videoId);
  if (!quiet) useDownloads.getState().update({ videoId, title, state: 'done', progress: 1, detail: 'Removed from your downloads', removed: true });
  return true;
}

/**
 * Deletes the saved files of every song in [tracks] that has one, and forgets them. One toast
 * reports the whole batch. Returns how many were removed.
 */
export async function removeMany(tracks: readonly Track[], label: string): Promise<number> {
  const saved = new Set(useDownloadsLibrary.getState().songs.map((s) => s.videoId));
  const queue = tracks.filter((t) => saved.has(t.videoId));
  let removed = 0;
  for (const track of queue) if (await removeDownload(track, { quiet: true })) removed += 1;
  const failed = queue.length - removed;
  useDownloads.getState().update({
    videoId: `remove:${label}`,
    title: label,
    state: failed ? 'failed' : 'done',
    progress: 1,
    detail: failed ? `Couldn’t delete ${failed} of ${queue.length} files` : `Removed ${removed} ${removed === 1 ? 'song' : 'songs'} from your downloads`,
    removed: true,
  });
  return removed;
}

/** How many songs of a "download all" are fetched at once. */
const PARALLEL = 2;

/**
 * Saves a list of songs, two at a time. Songs already saved, and rows that aren't on
 * YouTube Music, are skipped. Returns how many were started.
 */
export async function downloadMany(tracks: readonly Track[]): Promise<number> {
  const have = new Set(useDownloadsLibrary.getState().songs.map((s) => s.videoId));
  const queue = tracks.filter((t) => !t.unavailable && !have.has(t.videoId));
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const track = queue[next++]!;
      await downloadTrack(track);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
  return queue.length;
}

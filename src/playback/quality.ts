import { create } from 'zustand';

/**
 * Audio quality for streaming and for saved files (the phone's AudioQuality
 * and DownloadQuality, adapted to what YouTube Music serves a desktop client).
 *
 * YouTube Music's streams are Opus (about 50, 70 and 130–160 kbps) and AAC
 * (128 kbps, 256 kbps with Premium). It has no FLAC and no Dolby Atmos, so
 * "Maximum" means the highest-bitrate stream on offer, and would pick a
 * lossless (FLAC) or Atmos (E-AC-3 / AC-4) rendition first if a source ever
 * listed one that this machine can decode.
 */

export type StreamQuality = 'auto' | 'low' | 'normal' | 'high' | 'max';
export type DownloadQuality = 'standard' | 'high' | 'max';
/** The file a download is saved as: AAC in an .m4a (plays almost anywhere) or Opus in a .webm. */
export type DownloadFormat = 'm4a' | 'webm';

export const DOWNLOAD_FORMATS: { id: DownloadFormat; label: string; detail: string; codec: 'mp4a' | 'opus' }[] = [
  { id: 'm4a', label: 'M4A (AAC)', detail: 'Plays on almost every phone, car, player and app', codec: 'mp4a' },
  { id: 'webm', label: 'WebM (Opus)', detail: 'Slightly more efficient, but many players can’t open it', codec: 'opus' },
];

export const STREAM_QUALITIES: { id: StreamQuality; label: string; detail: string; ceilingKbps: number }[] = [
  { id: 'auto', label: 'Automatic', detail: 'Best Opus stream (about 130–160 kbps)', ceilingKbps: Infinity },
  { id: 'low', label: 'Low', detail: 'About 64 kbps · least data', ceilingKbps: 72 },
  { id: 'normal', label: 'Normal', detail: 'About 128 kbps', ceilingKbps: 135 },
  { id: 'high', label: 'High', detail: 'Up to about 160 kbps', ceilingKbps: 180 },
  { id: 'max', label: 'Maximum', detail: 'Highest bitrate offered: 256 kbps AAC with Premium; FLAC or Dolby Atmos if ever offered', ceilingKbps: Infinity },
];

export const DOWNLOAD_QUALITIES: { id: DownloadQuality; label: string; detail: string; ceilingKbps: number }[] = [
  { id: 'standard', label: 'Standard', detail: 'About 128 kbps · about 4 MB a song', ceilingKbps: 135 },
  { id: 'high', label: 'High', detail: 'Best Opus stream · about 5–6 MB a song', ceilingKbps: Infinity },
  { id: 'max', label: 'Maximum', detail: 'Highest bitrate offered · FLAC or Atmos if a source has it', ceilingKbps: Infinity },
];

/** A decodable audio rendition, by its codec string and bitrate. */
export interface AudioChoice {
  codec: string;
  kbps: number;
}

const LOSSLESS = /^(flac|alac)/i;
const ATMOS = /^(ec-3|ac-4|ac-3)/i;
const family = (codec: string) => (codec.startsWith('mp4a') ? 'mp4a' : codec.split('.')[0]!.toLowerCase());

/**
 * The index of the rendition to play for [quality], or -1 when there is none.
 *
 * - Automatic: the first of [preferred] codecs that has a rendition, at its highest bitrate.
 * - Maximum: lossless, then Atmos, if offered; otherwise the highest bitrate of any codec.
 * - Low / Normal / High: the highest bitrate at or under the ceiling, the preferred codec first;
 *   if everything is over it, the cheapest rendition (a rung over budget beats no audio).
 */
export function pickAudio(choices: readonly AudioChoice[], quality: StreamQuality | DownloadQuality, preferred: readonly string[]): number {
  if (!choices.length) return -1;
  const indexed = choices.map((c, i) => ({ ...c, i, family: family(c.codec) }));
  const best = (list: typeof indexed) => list.reduce((a, b) => (b.kbps > a.kbps ? b : a));
  const byPreference = (list: typeof indexed) => {
    for (const codec of preferred) {
      const found = list.filter((c) => c.family === codec);
      if (found.length) return best(found).i;
    }
    return best(list).i;
  };

  if (quality === 'max') {
    const lossless = indexed.filter((c) => LOSSLESS.test(c.codec));
    if (lossless.length) return best(lossless).i;
    const atmos = indexed.filter((c) => ATMOS.test(c.codec));
    if (atmos.length) return best(atmos).i;
    return best(indexed).i;
  }
  if (quality === 'auto') return byPreference(indexed);

  const ceiling = [...STREAM_QUALITIES, ...DOWNLOAD_QUALITIES].find((q) => q.id === quality)?.ceilingKbps ?? Infinity;
  const within = indexed.filter((c) => c.kbps <= ceiling);
  if (!within.length) return indexed.reduce((a, b) => (b.kbps < a.kbps ? b : a)).i;
  return byPreference(within);
}

// ---- Stored choice -----------------------------------------------------------------

const STORAGE_KEY = 'prismix:quality';

interface Stored {
  stream: StreamQuality;
  download: DownloadQuality;
  downloadFormat: DownloadFormat;
}

const isStream = (v: unknown): v is StreamQuality => STREAM_QUALITIES.some((q) => q.id === v);
const isDownload = (v: unknown): v is DownloadQuality => DOWNLOAD_QUALITIES.some((q) => q.id === v);
const isFormat = (v: unknown): v is DownloadFormat => DOWNLOAD_FORMATS.some((f) => f.id === v);

function load(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null;
    return {
      stream: isStream(raw?.stream) ? raw.stream : 'auto',
      download: isDownload(raw?.download) ? raw.download : 'high',
      downloadFormat: isFormat(raw?.downloadFormat) ? raw.downloadFormat : 'm4a',
    };
  } catch {
    return { stream: 'auto', download: 'high', downloadFormat: 'm4a' };
  }
}

interface QualityState extends Stored {
  setStream: (quality: StreamQuality) => void;
  setDownload: (quality: DownloadQuality) => void;
  setDownloadFormat: (format: DownloadFormat) => void;
}

export const useQuality = create<QualityState>()((set) => ({
  ...load(),
  setStream: (stream) => set({ stream }),
  setDownload: (download) => set({ download }),
  setDownloadFormat: (downloadFormat) => set({ downloadFormat }),
}));

useQuality.subscribe(({ stream, download, downloadFormat }) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stream, download, downloadFormat }));
  } catch {
    // Storage full or blocked: the choice lasts for this run.
  }
});

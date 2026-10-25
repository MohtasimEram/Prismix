/**
 * Makes a fragmented MP4 (what YouTube serves as DASH audio: an init moov, then moof+mdat pairs)
 * into an ordinary one: one moov with full sample tables, then one mdat. Windows Media Player and
 * many other players only open the ordinary kind. The audio itself is copied untouched.
 *
 * Handles what YouTube sends: one audio track, fragments that locate their samples from the moof
 * (default-base-is-moof or an explicit base offset). Anything it doesn't understand returns null,
 * and the caller saves the original bytes instead.
 */

interface Box {
  type: string;
  start: number;
  /** First byte of the payload. */
  body: number;
  end: number;
}

const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const i32 = (b: Uint8Array, at: number) => u32(b, at) | 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let header = 8;
    if (size === 1) {
      size = u64(b, at + 8);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push({ type, start: at, body: at + header, end: at + size });
    at += size;
  }
  return out;
}

const child = (b: Uint8Array, parent: Box, type: string) => boxes(b, parent.body, parent.end).find((x) => x.type === type);

function write32(out: Uint8Array, at: number, value: number) {
  out[at] = (value >>> 24) & 255;
  out[at + 1] = (value >>> 16) & 255;
  out[at + 2] = (value >>> 8) & 255;
  out[at + 3] = value & 255;
}

/** A box: its size and type, then the payload parts. */
function make(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  write32(out, 0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const bytesOf = (b: Uint8Array, box: Box) => b.slice(box.start, box.end);

/** A full box payload: version/flags, then the 32-bit words. */
function fullBox(type: string, words: number[]): Uint8Array {
  const body = new Uint8Array(4 + words.length * 4);
  words.forEach((w, i) => write32(body, 4 + i * 4, w >>> 0));
  return make(type, body);
}

/** Sets the duration field of an mvhd/tkhd/mdhd copy (version 0 or 1). */
function withDuration(copy: Uint8Array, kind: 'mvhd' | 'tkhd' | 'mdhd', duration: number): Uint8Array {
  const out = copy.slice();
  const version = out[8]!;
  // Offsets from the box start: after size+type+version/flags.
  const at = version === 1 ? (kind === 'tkhd' ? 8 + 4 + 8 + 8 + 4 + 4 : 8 + 4 + 8 + 8 + 4) : kind === 'tkhd' ? 8 + 4 + 4 + 4 + 4 + 4 : 8 + 4 + 4 + 4 + 4;
  if (version === 1) {
    write32(out, at, Math.floor(duration / 2 ** 32));
    write32(out, at + 4, duration >>> 0);
  } else {
    write32(out, at, duration >>> 0);
  }
  return out;
}

interface Sample {
  size: number;
  duration: number;
}

export function defragment(file: Uint8Array): Uint8Array | null {
  try {
    return defragmentUnsafe(file);
  } catch {
    return null;
  }
}

function defragmentUnsafe(file: Uint8Array): Uint8Array | null {
  const top = boxes(file, 0, file.length);
  const ftyp = top.find((b) => b.type === 'ftyp');
  const moov = top.find((b) => b.type === 'moov');
  if (!ftyp || !moov || !top.some((b) => b.type === 'moof')) return null;

  const mvex = child(file, moov, 'mvex');
  const traks = boxes(file, moov.body, moov.end).filter((b) => b.type === 'trak');
  if (!mvex || traks.length !== 1) return null;
  const trak = traks[0]!;
  const trex = child(file, mvex, 'trex');
  const defaultDuration = trex ? u32(file, trex.body + 12) : 0;
  const defaultSize = trex ? u32(file, trex.body + 16) : 0;

  // Every fragment's samples: where their bytes are in the source, how long and how big each is.
  const samples: Sample[] = [];
  const chunks: { first: number; count: number; from: number }[] = [];
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of boxes(file, moof.body, moof.end).filter((b) => b.type === 'traf')) {
      const tfhd = child(file, traf, 'tfhd');
      if (!tfhd) return null;
      const flags = u32(file, tfhd.body) & 0xffffff;
      let at = tfhd.body + 8;
      let base = moof.start;
      if (flags & 0x1) {
        base = u64(file, at);
        at += 8;
      }
      if (flags & 0x2) at += 4;
      const fragDuration = flags & 0x8 ? u32(file, at) : defaultDuration;
      if (flags & 0x8) at += 4;
      const fragSize = flags & 0x10 ? u32(file, at) : defaultSize;
      let nextData = -1;
      for (const trun of boxes(file, traf.body, traf.end).filter((b) => b.type === 'trun')) {
        const tf = u32(file, trun.body) & 0xffffff;
        const count = u32(file, trun.body + 4);
        let p = trun.body + 8;
        let data = nextData;
        if (tf & 0x1) {
          data = base + i32(file, p);
          p += 4;
        }
        if (data < 0) return null;
        if (tf & 0x4) p += 4;
        const first = samples.length;
        const from = data;
        for (let i = 0; i < count; i++) {
          let duration = fragDuration;
          let size = fragSize;
          if (tf & 0x100) {
            duration = u32(file, p);
            p += 4;
          }
          if (tf & 0x200) {
            size = u32(file, p);
            p += 4;
          }
          if (tf & 0x400) p += 4;
          if (tf & 0x800) p += 4;
          if (!size) return null;
          samples.push({ size, duration });
          data += size;
        }
        nextData = data;
        if (count) chunks.push({ first, count, from });
      }
    }
  }
  if (!samples.length) return null;

  // The new file: ftyp, moov, mdat. The moov's size has to be known before the chunk offsets
  // inside it, so it is built twice (offsets of 0 first, only to measure it).
  const mdhd = child(file, child(file, trak, 'mdia')!, 'mdhd');
  const tkhd = child(file, trak, 'tkhd');
  const mvhd = child(file, moov, 'mvhd');
  if (!mdhd || !tkhd || !mvhd) return null;
  const mdhdVersion = file[mdhd.body]!;
  const mediaTimescale = u32(file, mdhd.body + (mdhdVersion === 1 ? 20 : 12));
  const movieTimescale = u32(file, mvhd.body + (file[mvhd.body] === 1 ? 20 : 12));
  const mediaDuration = samples.reduce((n, s) => n + s.duration, 0);
  const movieDuration = Math.round((mediaDuration / mediaTimescale) * movieTimescale);

  const mdia = child(file, trak, 'mdia')!;
  const minf = child(file, mdia, 'minf');
  const stbl = minf && child(file, minf, 'stbl');
  const stsd = stbl && child(file, stbl, 'stsd');
  const hdlr = child(file, mdia, 'hdlr');
  const smhd = minf && child(file, minf, 'smhd');
  const dinf = minf && child(file, minf, 'dinf');
  if (!minf || !stbl || !stsd || !hdlr || !smhd || !dinf) return null;

  // stts: runs of equal durations.
  const runs: number[] = [];
  for (const s of samples) {
    const last = runs.length;
    if (last && runs[last - 1] === s.duration) runs[last - 2]! += 1;
    else runs.push(1, s.duration);
  }
  const stts = fullBox('stts', [runs.length / 2, ...runs]);
  // stsc: one entry per change in samples-per-chunk.
  const stscWords: number[] = [];
  let lastCount = -1;
  chunks.forEach((chunk, i) => {
    if (chunk.count !== lastCount) {
      stscWords.push(i + 1, chunk.count, 1);
      lastCount = chunk.count;
    }
  });
  const stsc = fullBox('stsc', [stscWords.length / 3, ...stscWords]);
  const stsz = fullBox('stsz', [0, samples.length, ...samples.map((s) => s.size)]);

  const build = (offsets: number[]): Uint8Array => {
    const stco = fullBox('stco', [offsets.length, ...offsets]);
    const newStbl = make('stbl', bytesOf(file, stsd), stts, stsc, stsz, stco);
    const newMinf = make('minf', bytesOf(file, smhd), bytesOf(file, dinf), newStbl);
    const newMdia = make('mdia', withDuration(bytesOf(file, mdhd), 'mdhd', mediaDuration), bytesOf(file, hdlr), newMinf);
    const newTrak = make('trak', withDuration(bytesOf(file, tkhd), 'tkhd', movieDuration), newMdia);
    return make('moov', withDuration(bytesOf(file, mvhd), 'mvhd', movieDuration), newTrak);
  };

  const head = bytesOf(file, ftyp);
  const moovSize = build(chunks.map(() => 0)).length;
  const dataStart = head.length + moovSize + 8;
  let written = 0;
  const offsets = chunks.map((chunk) => {
    const at = dataStart + written;
    written += samples.slice(chunk.first, chunk.first + chunk.count).reduce((n, s) => n + s.size, 0);
    return at;
  });
  if (dataStart + written > 0xffffffff) return null;

  const newMoov = build(offsets);
  const out = new Uint8Array(head.length + newMoov.length + 8 + written);
  out.set(head, 0);
  out.set(newMoov, head.length);
  write32(out, head.length + newMoov.length, 8 + written);
  out.set([0x6d, 0x64, 0x61, 0x74], head.length + newMoov.length + 4);
  let at = dataStart;
  for (const chunk of chunks) {
    const length = samples.slice(chunk.first, chunk.first + chunk.count).reduce((n, s) => n + s.size, 0);
    if (chunk.from + length > file.length) return null;
    out.set(file.subarray(chunk.from, chunk.from + length), at);
    at += length;
  }
  return out;
}

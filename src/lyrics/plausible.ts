import { endMs, type LyricLine } from './model';

/**
 * Checks that guard against showing the lyrics of a different song. The providers match by
 * name and length and some take the nearest result they get, so a wrong song's lyrics
 * sometimes came back as if they were right.
 */

/** Words of a title or artist, compared without case, accents, brackets, "feat." tails or punctuation. */
function words(text: string): string[] {
  return text
    // Latin accents are dropped (Beyoncé = Beyonce); the vowel signs of Indic scripts are not.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFKC')
    // "AliSoomroMusic" is three words run together; they are compared as three.
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(?:feat|ft|featuring)\b.*$/g, ' ')
    .replace(/\s-\s.*$/, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Whether [inner] appears in [outer] as a run of whole words ("alfa" is not in "alfaaz"). */
function containsWords(outer: string[], inner: string[]): boolean {
  if (!inner.length || inner.length > outer.length) return false;
  for (let at = 0; at + inner.length <= outer.length; at++) {
    if (inner.every((w, i) => outer[at + i] === w)) return true;
  }
  return false;
}

/**
 * Whether [found] (what a provider returned) can be [wanted]: the same words, one's words inside
 * the other's as a whole-word run ("Song" and "Song (Remastered)"), or at least half of them shared.
 * Letters inside a word never count: "Alfa" is not "Alfaaz". With nothing to compare on either side
 * it can't be told apart, so it passes.
 */
export function namesAgree(found: string, wanted: string): boolean {
  const a = words(found);
  const b = words(wanted);
  if (!a.length || !b.length) return true;
  if (containsWords(a, b) || containsWords(b, a)) return true;
  const shared = a.filter((w) => b.includes(w)).length;
  return shared / Math.max(a.length, b.length) >= 0.5;
}

/** Words that sit in a channel or label name without naming anyone ("AliSoomroMusic", "Artist - Topic", "Sony Music"). */
const NOT_A_NAME = new Set(['music', 'official', 'vevo', 'records', 'topic', 'channel', 'entertainment', 'the']);
const artistWords = (credit: string) => words(credit).filter((w) => w.length > 1 && !NOT_A_NAME.has(w));

/**
 * Whether two artist credits ("Hamza Malik, Zain Zohaib" and "Hamza Malik") name someone in
 * common: they share a whole word of at least two letters. An empty credit can't be told apart.
 */
export function artistsAgree(found: string, wanted: string): boolean {
  const a = artistWords(found);
  const b = new Set(artistWords(wanted));
  if (!a.length || !b.size) return true;
  return a.some((w) => b.has(w));
}

const OVERRUN_MS = 20_000;
const SHORTEST_PLAUSIBLE = 0.3;
const LONG_ENOUGH_TO_JUDGE_MS = 90_000;

/**
 * Whether timed lyrics can belong to a song [durationMs] long. Lyrics that run on well past the
 * song's end are a longer song's; lyrics that stop at a third of it are a much shorter one's.
 * Untimed lyrics, and a song whose length isn't known, are not judged.
 */
export function lyricsFitDuration(lines: readonly LyricLine[], durationMs: number): boolean {
  if (durationMs <= 0) return true;
  const timed = lines.filter((l) => l.timeMs > 0 || l.words.length);
  if (!timed.length) return true;
  const last = Math.max(...timed.map(endMs));
  if (last > durationMs + OVERRUN_MS) return false;
  return !(durationMs > LONG_ENOUGH_TO_JUDGE_MS && last < durationMs * SHORTEST_PLAUSIBLE);
}

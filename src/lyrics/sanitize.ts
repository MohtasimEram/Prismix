/**
 * Cleans lyric text of the invisible and stray code points providers leave in
 * it. Bangla (and other Indic) lyrics are where they show: zero-width spaces,
 * direction marks, soft hyphens, BOMs and U+FFFD sit between the words and the
 * lyric font drew them as boxes or odd marks.
 *
 * - Always removed: zero-width space, word joiner, BOM, soft hyphen,
 *   directional marks/isolates, Mongolian vowel separator, object and
 *   replacement characters, control characters (newlines and tabs stay).
 * - Exotic spaces (no-break, en/em, thin, ideographic…) become a plain space.
 * - ZWNJ and ZWJ stay only between two Indic or Arabic-script characters,
 *   where they decide how a conjunct or a letter joins (র‍্য, می‌خواهم);
 *   anywhere else (next to a space, a Latin letter, a line's edge) they're noise.
 * - The result is NFC, so split two-part vowel signs are joined (ে + া → ো).
 */

const ALWAYS_REMOVED = /[\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\uFFFC\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const EXOTIC_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const JOINERS = /[\u200C\u200D]/g;
/** Indic scripts (Devanagari … Sinhala) and Arabic-script blocks, where joiners are meaningful. */
const SHAPING_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DFF]/;

export function sanitizeLyricText(text: string): string {
  if (!text) return text;
  let out = text.replace(ALWAYS_REMOVED, '').replace(EXOTIC_SPACES, ' ');
  if (/[\u200C\u200D]/.test(out)) {
    out = out.replace(JOINERS, (joiner, offset: number, whole: string) => {
      const before = whole[offset - 1];
      const after = whole[offset + 1];
      return before && after && SHAPING_SCRIPT.test(before) && SHAPING_SCRIPT.test(after) ? joiner : '';
    });
  }
  return out.normalize('NFC');
}

/** A document's markup is made of characters this never touches, so it can clean a whole TTML string. */
export const sanitizeLyricDocument = sanitizeLyricText;

/**
 * Moves characters that can't start a piece (combining marks, joiners) from
 * the front of each syllable to the end of the one before: a vowel sign cut
 * off from its consonant by a syllable boundary draws as a dotted circle.
 */
export function keepClustersWhole(pieces: string[]): string[] {
  const out = [...pieces];
  for (let i = 1; i < out.length; i++) {
    const piece = out[i] ?? '';
    const match = /^[\p{M}\u200C\u200D]+/u.exec(piece);
    if (!match) continue;
    out[i - 1] = (out[i - 1] ?? '') + (piece.length > match[0].length ? match[0] : piece);
    out[i] = piece.slice(match[0].length);
  }
  return out;
}

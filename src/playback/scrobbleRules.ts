/** The scrobbling rules with no player or network in them, so they can be tested alone. */

const MIN_LISTEN_SEC = 30;
const MAX_LISTEN_SEC = 240;

/** "A, B & C" → "A" (PrimaryArtist.kt). */
export function primaryArtist(artist: string): string {
  const first = artist.split(/\s*(?:,|&|\sfeat\.?\s|\sft\.?\s|\swith\s|\sx\s)\s*/i)[0]?.trim();
  return first || artist;
}

/** Whether a listen of `heardSec` out of a `durationSec` song counts. */
export function countsAsListen(heardSec: number, durationSec: number): boolean {
  if (!(durationSec > MIN_LISTEN_SEC)) return false;
  return heardSec >= Math.max(MIN_LISTEN_SEC, Math.min(durationSec / 2, MAX_LISTEN_SEC));
}

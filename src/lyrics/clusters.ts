/**
 * Keeps Bangla (and other Indic) letters whole once am-lyrics has drawn them.
 *
 * am-lyrics cuts every syllable into single characters to animate them one by
 * one. It cuts by code point, so a vowel sign (া ি ে ো …), a nukta (়) or a
 * virama (্) ends up alone in its own <span>, and a lone combining mark is drawn
 * on a dotted circle (◌ি) with a gap before the next letter. The lyric text
 * itself is fine; only the cut is wrong.
 *
 * `repairClusters` walks the rendered text and moves each orphaned mark back
 * onto the letter before it (and a conjunct's second consonant onto its
 * virama), so the browser shapes every cluster as a unit. It touches only the
 * text nodes' data, never the elements, so am-lyrics keeps its own bookkeeping.
 */

/** Combining marks and joiners: they can never start a piece of text. */
const LEADING_MARKS = /^[\p{M}\u200C\u200D]+/u;
/** Viramas (halants): a consonant after one belongs to the same conjunct. */
const ENDS_IN_VIRAMA = /[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D\u0DCA\u200D]$/;
/** One base character plus its marks. */
const FIRST_CLUSTER = /^[\s\S][\p{M}\u200C\u200D]*/u;

/** Splits text into whole letters: a base character with its marks, conjuncts joined. */
export function splitClusters(text: string): string[] {
  const pieces = text.match(/[\s\S][\p{M}\u200C\u200D]*/gu) ?? [];
  const out: string[] = [];
  for (const piece of pieces) {
    const last = out.length - 1;
    if (last >= 0 && ENDS_IN_VIRAMA.test(out[last]!)) out[last] += piece;
    else out.push(piece);
  }
  return out;
}

function textNodesOf(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** Moves stray marks back to the letter before them. Returns whether anything changed. */
export function repairClusters(root: Node): boolean {
  let changed = false;
  let previous: Text | null = null;
  for (const node of textNodesOf(root)) {
    const data = node.data;
    if (!data.trim() && !LEADING_MARKS.test(data)) continue; // layout whitespace between elements
    if (previous) {
      const marks = LEADING_MARKS.exec(data)?.[0];
      if (marks) {
        previous.data += marks;
        node.data = data.slice(marks.length);
        changed = true;
      } else if (ENDS_IN_VIRAMA.test(previous.data)) {
        const cluster = FIRST_CLUSTER.exec(data)?.[0];
        if (cluster && !/^\s/.test(cluster)) {
          previous.data += cluster;
          node.data = data.slice(cluster.length);
          changed = true;
        }
      }
    }
    if (node.data) previous = node;
  }
  return changed;
}

/**
 * Repairs the shadow root now and after every change to it. Edits are made
 * while the observer is disconnected so they don't trigger themselves.
 */
export function keepRenderedClustersWhole(root: ShadowRoot): () => void {
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      observer.disconnect();
      try {
        repairClusters(root);
      } finally {
        observe();
      }
    });
  });
  const observe = () => observer.observe(root, { childList: true, subtree: true, characterData: true });
  repairClusters(root);
  observe();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
  };
}

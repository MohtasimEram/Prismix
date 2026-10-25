/** The link YouTube Music's own Share gives for a song (the "si" tracking tail is optional). */
export function musicShareUrl(videoId: string): string {
  return `https://music.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** The link YouTube Music's Share gives for a playlist; [id] may carry the browse "VL" prefix. */
export function musicPlaylistShareUrl(id: string): string {
  return `https://music.youtube.com/playlist?list=${encodeURIComponent(id.replace(/^VL/, ''))}`;
}

/** Puts [text] on the clipboard; resolves false if the webview refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // A webview without clipboard permission: the old way, through a selected field.
    try {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

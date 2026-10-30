import { create } from 'zustand';

/**
 * The small confirmation above the player ("Added to Gymm"): one at a time, a newer
 * one replacing the one showing. The component (shell/PlayerNotice.tsx) times it out.
 */

export type NoticeCover = { kind: 'image'; src: string | null } | { kind: 'liked' };

export interface Notice {
  /** Changes with every notice, so the same words twice in a row still show again. */
  id: number;
  text: string;
  detail?: string | undefined;
  cover: NoticeCover;
  tone: 'ok' | 'error';
}

interface NoticeState {
  notice: Notice | null;
  dismiss: () => void;
}

export const useNotices = create<NoticeState>()((set) => ({
  notice: null,
  dismiss: () => set({ notice: null }),
}));

let counter = 0;

/** Shows a notice; [text] is capped so a long playlist name can't grow it past the screen. */
export function notify(input: { text: string; detail?: string | undefined; cover: NoticeCover; tone?: 'ok' | 'error' }): void {
  useNotices.setState({
    notice: {
      id: ++counter,
      text: input.text.slice(0, 160),
      detail: input.detail?.slice(0, 160),
      cover: input.cover,
      tone: input.tone ?? 'ok',
    },
  });
}

import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { usePlayer } from '@/state/player';
import { useUi } from '@/state/ui';

/** Typing in a field shouldn't trigger the player. */
function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}

function focusSearch(navigate: ReturnType<typeof useNavigate>) {
  const field = document.querySelector<HTMLInputElement>('input[type="search"]');
  if (field) return field.focus();
  navigate('/search');
  // The search page is lazy: focus its field once it has rendered (for up to 3 s).
  const started = performance.now();
  const attempt = () => {
    const field = document.querySelector<HTMLInputElement>('input[type="search"]');
    if (field) field.focus();
    else if (performance.now() - started < 3000) setTimeout(attempt, 50);
  };
  attempt();
}

/**
 * The web player's shortcuts, which Prismix matches (report §8): Space
 * play/pause; ⌘/Ctrl+→ / ← next/previous; ⌘/Ctrl+↑ / ↓ volume; ⌘/Ctrl+F or
 * "/" focuses search; Esc closes the full-screen player, else the side panel.
 */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    // Whether the last Space keydown was ours: its keyup must not click the focused button either.
    let swallowSpaceUp = false;
    // The button or link a mouse click last focused. A click leaves it focused, and Space would press it
    // again (restarting a song that a play button had just started); Space belongs to the player then.
    // Focus that arrived by keyboard (Tab) still lets Space press the control.
    let mouseFocused: Element | null = null;
    const onPointerDown = (event: PointerEvent) => {
      mouseFocused = (event.target as Element | null)?.closest?.('button, a') ?? null;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' && swallowSpaceUp) {
        swallowSpaceUp = false;
        event.preventDefault();
      }
    };
    // Coming back from another window (alt-tab), focus may still sit on a button; blur it
    // so the very first Space plays/pauses instead of pressing that button.
    const onWindowFocus = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !typing(active) && active.closest('button, a')) active.blur();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onWindowFocus();
    };
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisible);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab') mouseFocused = null;
      if (event.altKey && event.key === 'ArrowLeft' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (typing(event.target)) return;
        event.preventDefault();
        if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1);
        return;
      }
      if (event.defaultPrevented || event.altKey) return;
      const player = usePlayer.getState();
      const command = event.metaKey || event.ctrlKey;

      if (command && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        return focusSearch(navigate);
      }
      if (typing(event.target)) return;

      if (event.key === ' ' && !command) {
        const target = event.target as HTMLElement | null;
        // Sliders keep Space. In the full-screen player the focused control is only ever the
        // one it parked focus on (Close), so Space there is play/pause, never a button press.
        if (target?.closest('[role="slider"]')) return;
        const inTheater = !!target?.closest('[data-full-screen]');
        // Elsewhere a focused button or link answers Space itself.
        const control = target?.closest('button, a') ?? null;
        const focusedByMouse = !!control && control === mouseFocused && document.activeElement === control;
        if (!inTheater && control && !focusedByMouse) return;
        event.preventDefault();
        swallowSpaceUp = true;
        if (event.repeat) return;
        return player.togglePlay();
      }
      if (event.key === '/' && !command) {
        event.preventDefault();
        return focusSearch(navigate);
      }
      if (event.key === 'Escape') {
        const ui = useUi.getState();
        // A menu or dialog over the player closes first, on its own.
        if ((event.target as HTMLElement | null)?.closest('[role="menu"], [role="dialog"]:not([data-full-screen])')) return;
        if (ui.fullScreen) ui.setFullScreen(false);
        else if (ui.sidePanel) ui.closeSidePanel();
        return;
      }
      if (!command) return;
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          return player.next();
        case 'ArrowLeft':
          event.preventDefault();
          return player.previous();
        case 'ArrowUp':
          event.preventDefault();
          return player.setVolume(player.volume + 0.1);
        case 'ArrowDown':
          event.preventDefault();
          return player.setVolume(player.volume - 0.1);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [navigate]);
}

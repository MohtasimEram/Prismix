import { useEffect, useRef, useState } from 'react';
import { getAudio, usePlayer } from '@/state/player';

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A seek line drawn from the media clock every frame while playing, by writing
 * `--progress` on the bar and the times into their spans: no React state, so
 * nothing re-renders. Pressing or dragging on the scrubber seeks on release.
 * Shared by the LCD and the full-screen player.
 */
export function useScrubber() {
  const bar = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const remaining = useRef<HTMLSpanElement>(null);
  const status = usePlayer((s) => s.status);
  const deck = usePlayer((s) => s.deck);
  const seek = usePlayer((s) => s.seek);
  // A restored song has no audio element until play is pressed: its saved place and length stand in.
  const resumeAt = usePlayer((s) => s.resumeAt);
  const restoredDuration = usePlayer((s) => s.nowPlaying?.durationSec ?? 0);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    const audio = getAudio();
    const element = bar.current;
    if (!element) return;
    if (!audio) {
      const time = dragging !== null && restoredDuration > 0 ? dragging * restoredDuration : resumeAt;
      element.style.setProperty('--progress', String(restoredDuration > 0 ? Math.min(1, Math.max(0, time / restoredDuration)) : 0));
      if (elapsed.current) elapsed.current.textContent = clock(time);
      if (remaining.current) remaining.current.textContent = restoredDuration > 0 ? `-${clock(restoredDuration - time)}` : '';
      return;
    }
    let frame = 0;
    const draw = () => {
      const duration = audio.duration;
      const time = dragging !== null && Number.isFinite(duration) ? dragging * duration : audio.currentTime;
      const fraction = duration > 0 ? time / duration : 0;
      element.style.setProperty('--progress', String(Math.min(1, Math.max(0, fraction))));
      if (elapsed.current) elapsed.current.textContent = clock(time);
      // A live station has no end to count down to.
      if (remaining.current) remaining.current.textContent = Number.isFinite(duration) ? `-${clock((duration || 0) - time)}` : 'LIVE';
      if (!audio.paused || dragging !== null) frame = requestAnimationFrame(draw);
    };
    draw();
    const onSeeked = () => draw();
    audio.addEventListener('seeked', onSeeked);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener('seeked', onSeeked);
    };
  }, [status, deck, dragging, resumeAt, restoredDuration]);

  const fractionAt = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!getAudio() && restoredDuration <= 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(fractionAt(e));
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (dragging !== null) setDragging(fractionAt(e));
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (dragging === null) return;
      const audio = getAudio();
      if (audio && Number.isFinite(audio.duration)) seek(fractionAt(e) * audio.duration);
      else if (!audio && restoredDuration > 0) seek(fractionAt(e) * restoredDuration);
      setDragging(null);
    },
    onPointerCancel: () => setDragging(null),
  };

  return { bar, elapsed, remaining, dragging: dragging !== null, handlers };
}

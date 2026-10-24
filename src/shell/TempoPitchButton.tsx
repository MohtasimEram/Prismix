import { Gauge } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PITCH_LIMITS, TEMPO_LIMITS, useTempoPitch } from '@/playback/audioFx';

const formatTempo = (tempo: number) => `${tempo.toFixed(2).replace(/0$/, '').replace(/\.$/, '')}×`;
const formatPitch = (pitch: number) => `${pitch > 0 ? '+' : ''}${pitch} st`;

/**
 * The player bar's tempo and pitch control: a button that opens a small panel
 * with both sliders. Tempo keeps the key and pitch keeps the speed
 * (playback/audioFx.ts), so moving one never bends the other.
 */
export function TempoPitchButton({ className }: { className?: string }) {
  const { tempo, pitch, setTempo, setPitch, reset } = useTempoPitch();
  const changed = tempo !== 1 || pitch !== 0;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    setPosition({
      right: Math.max(8, window.innerWidth - rect.right - 8),
      bottom: window.innerHeight - rect.top + 10,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        className={className}
        aria-label="Tempo and Pitch"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={changed}
        title={changed ? `Tempo ${formatTempo(tempo)}, pitch ${formatPitch(pitch)}` : 'Tempo and Pitch'}
        onClick={() => setOpen((v) => !v)}
      >
        <Gauge size={18} strokeWidth={2.2} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label="Tempo and Pitch"
            className="fixed z-(--z-contextual-menus) w-[272px] animate-menu-in rounded-[12px] bg-thick-material p-4 shadow-[0_0_0_0.5px_var(--vibrantDivider),0_10px_40px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(32px)]"
            style={position}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="type-title-3-emphasized text-primary">Tempo &amp; Pitch</span>
              <button
                className="type-body-reduced text-key disabled:text-tertiary"
                disabled={!changed}
                onClick={reset}
              >
                Reset
              </button>
            </div>
            <label className="block">
              <span className="flex items-center justify-between type-body-reduced text-primary">
                <span>Tempo</span>
                <span className="tabular-nums text-secondary">{formatTempo(tempo)}</span>
              </span>
              <input
                type="range"
                className="mt-1 mb-3 w-full accent-key"
                min={TEMPO_LIMITS.min}
                max={TEMPO_LIMITS.max}
                step={TEMPO_LIMITS.step}
                value={tempo}
                aria-label="Tempo"
                onChange={(e) => setTempo(Number(e.currentTarget.value))}
                onDoubleClick={() => setTempo(1)}
              />
            </label>
            <label className="block">
              <span className="flex items-center justify-between type-body-reduced text-primary">
                <span>Pitch</span>
                <span className="tabular-nums text-secondary">{formatPitch(pitch)}</span>
              </span>
              <input
                type="range"
                className="mt-1 w-full accent-key"
                min={PITCH_LIMITS.min}
                max={PITCH_LIMITS.max}
                step={PITCH_LIMITS.step}
                value={pitch}
                aria-label="Pitch in semitones"
                onChange={(e) => setPitch(Number(e.currentTarget.value))}
                onDoubleClick={() => setPitch(0)}
              />
            </label>
            <p className="mt-3 type-caption-2 text-tertiary">
              Tempo keeps the key. Pitch keeps the speed. Double-click a slider to reset it.
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}

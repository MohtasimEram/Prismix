import { Gauge } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PITCH_LIMITS, TEMPO_LIMITS, useTempoPitch } from '@/playback/audioFx';

const formatTempo = (tempo: number) => `${tempo.toFixed(2).replace(/0$/, '').replace(/\.$/, '')}×`;
const formatPitch = (pitch: number) => `${pitch > 0 ? '+' : ''}${pitch} st`;

const TEMPO_CHOICES = [0.75, 1, 1.25, 1.5] as const;
const PITCH_CHOICES = [-2, 0, 2] as const;

/** One control: its name, a large readout (key-coloured once changed) and its content. */
function ControlSection({
  label,
  value,
  modified,
  onReset,
  className = '',
  children,
}: {
  label: string;
  value: string;
  modified: boolean;
  onReset: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-[10px] bg-quinary p-3 ${className}`}>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="type-body-reduced text-secondary">{label}</span>
        <button
          className={`type-title-2-emphasized tabular-nums transition-colors ${modified ? 'text-key' : 'text-primary'}`}
          title="Click to reset"
          onClick={onReset}
        >
          {value}
        </button>
      </div>
      {children}
    </section>
  );
}

/** A slider whose track fills from its resting value (1× or 0 st), so left and right of centre read differently. */
function Slider({
  label,
  min,
  max,
  step,
  value,
  origin,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  origin: number;
  onChange: (value: number) => void;
}) {
  const at = (v: number) => ((v - min) / (max - min)) * 100;
  const from = Math.min(at(value), at(origin));
  const to = Math.max(at(value), at(origin));
  const track = `linear-gradient(to right, transparent ${from}%, var(--systemPrimary) ${from}%, var(--systemPrimary) ${to}%, transparent ${to}%), var(--systemQuaternary)`;
  return (
    <div className="relative flex h-5 items-center">
      {/* The resting-value mark. */}
      <span className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-tertiary" style={{ left: `${at(origin)}%` }} aria-hidden="true" />
      <input
        type="range"
        className="relative h-[4px] w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgb(0_0_0/0.4),0_0_0_0.5px_rgb(0_0_0/0.2)] [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110 focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-key"
        style={{ background: track }}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        onDoubleClick={() => onChange(origin)}
      />
    </div>
  );
}

/** Quick picks under a slider; the one matching the current value is filled. */
function Chips({ options, current, onPick }: { options: { value: number; label: string }[]; current: number; onPick: (value: number) => void }) {
  return (
    <div className="mt-2.5 flex gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          className={`flex-1 rounded-[8px] py-[3px] type-callout-emphasized tabular-nums transition-colors ${
            Math.abs(current - option.value) < 0.001 ? 'bg-primary text-page' : 'bg-quaternary text-secondary hover:bg-tertiary hover:text-primary'
          }`}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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
            className="fixed z-(--z-contextual-menus) w-[296px] animate-menu-in rounded-[12px] bg-thick-material p-4 shadow-[0_0_0_0.5px_var(--vibrantDivider),0_10px_40px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(32px)]"
            style={position}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2 type-title-3-emphasized text-primary">
                <Gauge size={16} strokeWidth={2.2} className="text-secondary" aria-hidden="true" />
                Tempo &amp; Pitch
              </span>
              <button
                className="rounded-[10px] bg-quaternary px-2.5 py-[2px] type-callout-emphasized text-primary transition-opacity hover:bg-tertiary disabled:opacity-40 disabled:hover:bg-quaternary"
                disabled={!changed}
                onClick={reset}
              >
                Reset
              </button>
            </div>

            <ControlSection
              label="Tempo"
              value={formatTempo(tempo)}
              modified={tempo !== 1}
              onReset={() => setTempo(1)}
            >
              <Slider
                label="Tempo"
                min={TEMPO_LIMITS.min}
                max={TEMPO_LIMITS.max}
                step={TEMPO_LIMITS.step}
                value={tempo}
                origin={1}
                onChange={setTempo}
              />
              <Chips options={TEMPO_CHOICES.map((v) => ({ value: v, label: formatTempo(v) }))} current={tempo} onPick={setTempo} />
            </ControlSection>

            <ControlSection
              label="Pitch"
              value={formatPitch(pitch)}
              modified={pitch !== 0}
              onReset={() => setPitch(0)}
              className="mt-4"
            >
              <Slider
                label="Pitch in semitones"
                min={PITCH_LIMITS.min}
                max={PITCH_LIMITS.max}
                step={PITCH_LIMITS.step}
                value={pitch}
                origin={0}
                onChange={setPitch}
              />
              <Chips options={PITCH_CHOICES.map((v) => ({ value: v, label: v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}` }))} current={pitch} onPick={setPitch} />
            </ControlSection>

            <p className="mt-4 type-caption-2 text-tertiary">Tempo keeps the key. Pitch keeps the speed. Double-click a slider to reset it.</p>
          </div>,
          document.body,
        )}
    </>
  );
}

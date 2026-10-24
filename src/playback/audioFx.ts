import { create } from 'zustand';

/**
 * Web Audio effects for the desktop app: a 10-band equaliser, and tempo and
 * pitch control.
 *
 * - Tempo alone is the element's own `playbackRate` with `preservesPitch` on:
 *   the browser's time-stretcher changes the speed and leaves the key alone,
 *   so it needs no graph and adds no processing of ours.
 * - Pitch (semitones) runs through a SoundTouch AudioWorklet. At 0 semitones
 *   the worklet is bypassed entirely, so a track at its original pitch is
 *   never resampled.
 * - Tempo AND pitch together used to stack two time-stretchers (the browser's,
 *   then SoundTouch's), and every stretcher adds its own warble; lowering both
 *   made that audible. Now only one runs: the element plays at the tempo with
 *   `preservesPitch` OFF (a plain, artefact-free resample, which moves the
 *   pitch by 12*log2(tempo) semitones), and SoundTouch shifts by the
 *   difference, `pitch - 12*log2(tempo)`. Lowering both gives a small shift.
 *
 * The graph is opt-in. `createMediaElementSource` reroutes an element through
 * the AudioContext for good, so nothing is built until the equaliser is
 * switched on or the pitch first moved; until then audio plays exactly as it
 * would without this file.
 * Playback reaches the element through MediaSource (blob: URLs), which is
 * same-origin, so the graph is never silenced by CORS.
 */

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
const GAIN_LIMIT = 12;

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Booster': [6, 5, 4, 2.5, 1, 0, 0, 0, 0, 0],
  'Bass Reducer': [-6, -5, -4, -2.5, -1, 0, 0, 0, 0, 0],
  Acoustic: [4, 4, 3, 1, 1.5, 1.5, 3, 3.5, 3, 2],
  Classical: [4, 3, 2.5, 2, -1, -1, 0, 2, 3, 3.5],
  Dance: [3.5, 6, 4.5, 0, 1.5, 3, 4.5, 4, 3, 0],
  Electronic: [4, 3.5, 1, 0, -2, 2, 1, 1.5, 4, 4.5],
  'Hip-Hop': [5, 4, 1.5, 3, -1, -1, 1.5, -0.5, 1.5, 3],
  Jazz: [4, 3, 1.5, 2, -1.5, -1.5, 0, 1.5, 3, 3.5],
  Pop: [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5],
  Rock: [5, 4, 3, 1.5, -0.5, -1, 0.5, 2.5, 3.5, 4.5],
  'Treble Booster': [0, 0, 0, 0, 0, 1, 2.5, 4, 5, 6],
  'Vocal Booster': [-1.5, -3, -3, 1.5, 3.5, 3.5, 3, 1.5, 0, -1.5],
  Loudness: [6, 4, 0, 0, -2, 0, -1, -5, 5, 1],
  'Late Night': [3, 2.5, 1.5, 0.5, 0, -0.5, 0, 1, 2, 2.5],
};

const STORAGE_KEY = 'prismix:audio-fx';

interface Stored {
  enabled: boolean;
  preset: string;
  gains: number[];
  preamp: number;
}

function clampGain(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(-GAIN_LIMIT, Math.min(GAIN_LIMIT, n));
}

function load(): Stored {
  const fallback: Stored = { enabled: false, preset: 'Flat', gains: EQ_BANDS.map(() => 0), preamp: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      enabled: raw.enabled === true,
      preset: typeof raw.preset === 'string' ? raw.preset.slice(0, 40) : 'Custom',
      gains: EQ_BANDS.map((_, i) => clampGain(Array.isArray(raw.gains) ? raw.gains[i] : 0)),
      preamp: clampGain(raw.preamp),
    };
  } catch {
    return fallback;
  }
}

interface AudioFxState extends Stored {
  setEnabled: (enabled: boolean) => void;
  applyPreset: (name: string) => void;
  setBand: (index: number, gain: number) => void;
  setPreamp: (gain: number) => void;
}

export const useAudioFx = create<AudioFxState>()((set) => ({
  ...load(),
  setEnabled: (enabled) => set({ enabled }),
  applyPreset: (name) => {
    const gains = EQ_PRESETS[name];
    if (gains) set({ preset: name, gains: [...gains] });
  },
  setBand: (index, gain) =>
    set((s) => ({ preset: 'Custom', gains: s.gains.map((g, i) => (i === index ? clampGain(gain) : g)) })),
  setPreamp: (preamp) => set({ preamp: clampGain(preamp) }),
}));

// ---- Tempo and pitch ---------------------------------------------------------------

export const TEMPO_LIMITS = { min: 0.5, max: 2, step: 0.05 } as const;
export const PITCH_LIMITS = { min: -12, max: 12, step: 1 } as const;
const TEMPO_PITCH_KEY = 'prismix:tempo-pitch';

interface TempoPitch {
  /** Playback speed, 1 = original; the key is kept. */
  tempo: number;
  /** Semitones, 0 = original; the speed is kept. */
  pitch: number;
}

const clampTempo = (v: unknown) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  return Math.round(Math.max(TEMPO_LIMITS.min, Math.min(TEMPO_LIMITS.max, n)) * 100) / 100;
};
const clampPitch = (v: unknown) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.round(Math.max(PITCH_LIMITS.min, Math.min(PITCH_LIMITS.max, n)));
};

function loadTempoPitch(): TempoPitch {
  try {
    const raw = JSON.parse(localStorage.getItem(TEMPO_PITCH_KEY) ?? 'null') as Partial<TempoPitch> | null;
    return { tempo: clampTempo(raw?.tempo), pitch: clampPitch(raw?.pitch) };
  } catch {
    return { tempo: 1, pitch: 0 };
  }
}

interface TempoPitchState extends TempoPitch {
  setTempo: (tempo: number) => void;
  setPitch: (semitones: number) => void;
  reset: () => void;
}

export const useTempoPitch = create<TempoPitchState>()((set) => ({
  ...loadTempoPitch(),
  setTempo: (tempo) => set({ tempo: clampTempo(tempo) }),
  setPitch: (pitch) => set({ pitch: clampPitch(pitch) }),
  reset: () => set({ tempo: 1, pitch: 0 }),
}));

// ---- The graph ------------------------------------------------------------------

interface Chain {
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  filters: BiquadFilterNode[];
  /** A transparent peak limiter after the equaliser, so boosts and pitch shifting overshoot into a soft ceiling instead of hard clipping. */
  limiter: DynamicsCompressorNode;
  /** The pitch shifter, once it has loaded; created the first time the pitch moves off 0. */
  shifter: SoundTouchNode | null;
  shifterLoading: Promise<void> | null;
  /** Whether the source currently feeds the shifter (else straight to the equaliser). */
  shifted: boolean;
}

type SoundTouchNode = import('@soundtouchjs/audio-worklet').SoundTouchNode;

let context: AudioContext | null = null;
let workletReady: Promise<void> | null = null;
const elements = new Set<HTMLAudioElement>();
const chains = new Map<HTMLAudioElement, Chain>();

function ensureContext(): AudioContext | null {
  if (context) return context;
  try {
    context = new AudioContext({ latencyHint: 'playback' });
  } catch {
    return null;
  }
  return context;
}

function buildChain(audio: HTMLAudioElement): void {
  if (chains.has(audio)) return;
  const ctx = ensureContext();
  if (!ctx) return;
  let source: MediaElementAudioSourceNode;
  try {
    source = ctx.createMediaElementSource(audio);
  } catch {
    return;
  }
  const preamp = ctx.createGain();
  const filters = EQ_BANDS.map((frequency, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = 1.1;
    return filter;
  });
  // Threshold just under full scale with a hard knee: silent on normal material, it only acts on peaks.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;
  source.connect(preamp);
  filters.reduce<AudioNode>((prev, node) => (prev.connect(node), node), preamp).connect(limiter);
  limiter.connect(ctx.destination);
  chains.set(audio, { source, preamp, filters, limiter, shifter: null, shifterLoading: null, shifted: false });
  // An AudioContext created outside a gesture starts suspended.
  audio.addEventListener('play', () => void context?.resume().catch(() => undefined));
  if (!audio.paused) void ctx.resume().catch(() => undefined);
}

/** Loads the SoundTouch worklet into the context, once; a failure is retried the next time the pitch moves. */
async function loadWorklet(ctx: AudioContext): Promise<void> {
  workletReady ??= (async () => {
    const [{ SoundTouchNode: Node }, { default: url }] = await Promise.all([
      import('@soundtouchjs/audio-worklet'),
      // @ts-ignore -- Vite's `?url` import; typed by src/soundtouch-url.d.ts where vite/client is loaded
      import('@soundtouchjs/audio-worklet/processor?url'),
    ]);
    await Node.register(ctx, url);
  })().catch((error: unknown) => {
    workletReady = null;
    throw error;
  });
  return workletReady;
}

function ensureShifter(chain: Chain): Promise<void> {
  const ctx = context;
  if (chain.shifter || !ctx) return Promise.resolve();
  chain.shifterLoading ??= (async () => {
    await loadWorklet(ctx);
    const { SoundTouchNode: Node } = await import('@soundtouchjs/audio-worklet');
    // The element runs at the tempo; the shifter is told it is fed at the original speed (rate 1),
    // so it shifts the pitch and nothing else.
    const node = new Node({ context: ctx });
    node.playbackRate.value = 1;
    chain.shifter = node;
  })()
    .catch(() => undefined)
    .finally(() => {
      chain.shifterLoading = null;
    });
  return chain.shifterLoading;
}

/** Sends the source through the pitch shifter or straight to the equaliser. */
function route(chain: Chain, shifted: boolean): void {
  if (shifted === chain.shifted && (!shifted || chain.shifter)) return;
  if (shifted && !chain.shifter) return;
  try {
    chain.source.disconnect();
    chain.shifter?.disconnect();
    if (shifted && chain.shifter) {
      chain.source.connect(chain.shifter);
      chain.shifter.connect(chain.preamp);
    } else {
      chain.source.connect(chain.preamp);
    }
    chain.shifted = shifted && !!chain.shifter;
  } catch {
    // A node that can't be rewired leaves the last working route in place.
  }
}

/** What the shifter must add so the heard pitch is the chosen one, given the element resamples by the tempo. */
function shifterSemitones(): number {
  const { tempo, pitch } = useTempoPitch.getState();
  return pitch - 12 * Math.log2(tempo);
}

function applyTempo(audio: HTMLAudioElement): void {
  const { tempo } = useTempoPitch.getState();
  // load() resets playbackRate to defaultPlaybackRate, which is why both are set.
  audio.defaultPlaybackRate = tempo;
  // Through the shifter the element only resamples (the shifter corrects the key); otherwise the browser keeps the key.
  audio.preservesPitch = !chains.get(audio)?.shifted;
  // A rate of 0 is Shaka holding the element while it buffers; it restores the rate itself.
  if (audio.playbackRate !== 0 && audio.playbackRate !== tempo) audio.playbackRate = tempo;
}

function applySettings(): void {
  const { enabled, gains, preamp } = useAudioFx.getState();
  const { pitch } = useTempoPitch.getState();
  if (enabled || pitch !== 0) elements.forEach(buildChain);
  const now = context?.currentTime ?? 0;
  for (const [audio, chain] of chains) {
    chain.preamp.gain.setTargetAtTime(enabled ? Math.pow(10, preamp / 20) : 1, now, 0.03);
    chain.filters.forEach((f, i) => f.gain.setTargetAtTime(enabled ? (gains[i] ?? 0) : 0, now, 0.03));
    if (pitch === 0) {
      // Back to the browser's own stretcher: key preserved by it again.
      route(chain, false);
      applyTempo(audio);
    } else {
      void ensureShifter(chain).then(() => {
        const current = useTempoPitch.getState().pitch;
        if (chain.shifter) chain.shifter.pitchSemitones.value = shifterSemitones();
        route(chain, current !== 0);
        // Only now, with the shifter in the path, does the element stop preserving pitch: never before, or the key would jump while it loads.
        applyTempo(audio);
      });
    }
  }
  elements.forEach(applyTempo);
}

/** Called for every playback element as it is created (state/player.ts). */
export function attachAudioFx(audio: HTMLAudioElement): void {
  elements.add(audio);
  // A new source resets the element's rate; put the tempo back once its media is known.
  audio.addEventListener('loadedmetadata', () => applyTempo(audio));
  applySettings();
}

useAudioFx.subscribe((state) => {
  const { enabled, preset, gains, preamp } = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, preset, gains, preamp }));
  } catch {
    // Storage full or blocked: the setting lasts for this run.
  }
  applySettings();
});

useTempoPitch.subscribe(({ tempo, pitch }) => {
  try {
    localStorage.setItem(TEMPO_PITCH_KEY, JSON.stringify({ tempo, pitch }));
  } catch {
    // Storage full or blocked: the setting lasts for this run.
  }
  applySettings();
});

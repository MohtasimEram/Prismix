import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { importCookies, type Service } from '@/desktop/session';
import { isDesktop } from '@/desktop/tauri';
import { appVersion, useUpdater } from '@/desktop/updater';
import { desktopPrefs, setDesktopPrefs, type DesktopPrefs } from '@/desktop/window';
import { EQ_BANDS, EQ_PRESETS, PITCH_LIMITS, TEMPO_LIMITS, useAudioFx, useTempoPitch } from '@/playback/audioFx';
import { DOWNLOAD_FORMATS, DOWNLOAD_QUALITIES, STREAM_QUALITIES, useQuality } from '@/playback/quality';
import { useScrobbling, validateToken } from '@/playback/scrobbling';
import { useSleepTimer } from '@/playback/sleepTimer';
import { Select } from '@/components/Select';
import { Toggle } from './IntegrationSettings';
import { settingsUi } from './settingsStyles';

// ---- Equaliser -------------------------------------------------------------------

function bandLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/** Settings › Playback: the 10-band equaliser (playback/audioFx.ts). */
export function EqualizerSettings() {
  const { enabled, preset, gains, preamp, setEnabled, applyPreset, setBand, setPreamp } = useAudioFx();
  return (
    <>
      <Toggle
        label="Equalizer"
        detail="Shape the sound with a 10-band EQ. Applies to everything you play."
        checked={enabled}
        onChange={setEnabled}
      />
      {enabled && (
        <>
          <label className={settingsUi.controlRow}>
            <span>Preset</span>
            <Select
              label="Preset"
              value={EQ_PRESETS[preset] ? preset : 'Custom'}
              options={[...Object.keys(EQ_PRESETS), ...(EQ_PRESETS[preset] ? [] : ['Custom'])].map((name) => ({ value: name, label: name }))}
              onChange={(name) => {
                // 'Custom' is only a label for hand-set bands; it isn't a preset to apply.
                if (EQ_PRESETS[name]) applyPreset(name);
              }}
            />
          </label>
          <div className={`${settingsUi.row} flex-col items-stretch gap-3`}>
            <div className="flex items-center justify-between gap-4 type-body-reduced">
              <span>Preamp</span>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={preamp}
                onChange={(e) => setPreamp(Number(e.currentTarget.value))}
                className="w-[220px] accent-key"
                aria-label="Preamp"
              />
              <span className="w-12 text-right tabular-nums text-secondary">{preamp > 0 ? `+${preamp}` : preamp} dB</span>
            </div>
            <div className="grid grid-cols-10 gap-1 pt-1">
              {EQ_BANDS.map((hz, i) => (
                <div key={hz} className="flex flex-col items-center gap-1.5">
                  <span className="type-caption-2 tabular-nums text-secondary">{gains[i]! > 0 ? `+${gains[i]}` : gains[i]}</span>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={gains[i]}
                    onChange={(e) => setBand(i, Number(e.currentTarget.value))}
                    onDoubleClick={() => setBand(i, 0)}
                    className="h-28 w-5 accent-key [direction:rtl] [writing-mode:vertical-lr]"
                    aria-label={`${bandLabel(hz)} hertz`}
                  />
                  <span className="type-caption-2 text-secondary">{bandLabel(hz)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ---- Tempo and pitch -------------------------------------------------------------

const formatTempo = (tempo: number) => `${tempo.toFixed(2).replace(/0$/, '')}×`;
const formatPitch = (pitch: number) => (pitch > 0 ? `+${pitch}` : String(pitch));

/**
 * Settings › Sound: playback speed and key (playback/audioFx.ts). Speed keeps
 * the key (the browser's time-stretch) and pitch keeps the speed (a SoundTouch
 * worklet that is bypassed at 0), so changing one never bends the other.
 */
export function TempoPitchSettings() {
  const { tempo, pitch, setTempo, setPitch, reset } = useTempoPitch();
  const changed = tempo !== 1 || pitch !== 0;
  return (
    <div className={`${settingsUi.row} flex-col items-stretch gap-3`}>
      <div className="flex items-center justify-between gap-4 type-body-reduced">
        <span className={settingsUi.rowText}>
          <span>Tempo</span>
          <span className={settingsUi.rowDetail}>Faster or slower; the key stays the same.</span>
        </span>
        <input
          type="range"
          min={TEMPO_LIMITS.min}
          max={TEMPO_LIMITS.max}
          step={TEMPO_LIMITS.step}
          value={tempo}
          onChange={(e) => setTempo(Number(e.currentTarget.value))}
          onDoubleClick={() => setTempo(1)}
          className="w-[200px] accent-key"
          aria-label="Tempo"
        />
        <span className="w-12 text-right tabular-nums text-secondary">{formatTempo(tempo)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 type-body-reduced">
        <span className={settingsUi.rowText}>
          <span>Pitch</span>
          <span className={settingsUi.rowDetail}>Higher or lower in semitones; the speed stays the same.</span>
        </span>
        <input
          type="range"
          min={PITCH_LIMITS.min}
          max={PITCH_LIMITS.max}
          step={PITCH_LIMITS.step}
          value={pitch}
          onChange={(e) => setPitch(Number(e.currentTarget.value))}
          onDoubleClick={() => setPitch(0)}
          className="w-[200px] accent-key"
          aria-label="Pitch in semitones"
        />
        <span className="w-12 text-right tabular-nums text-secondary">{formatPitch(pitch)} st</span>
      </div>
      {changed && (
        <div>
          <button className={settingsUi.inlineButton} onClick={reset}>
            Reset Tempo and Pitch
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Audio quality ---------------------------------------------------------------

/** Settings › Sound: streaming and download quality (playback/quality.ts). */
export function QualitySettings() {
  const { stream, download, downloadFormat, setStream, setDownload, setDownloadFormat } = useQuality();
  const streamDetail = STREAM_QUALITIES.find((q) => q.id === stream)?.detail;
  const downloadDetail = DOWNLOAD_QUALITIES.find((q) => q.id === download)?.detail;
  return (
    <>
      <label className={settingsUi.controlRow}>
        <span className={settingsUi.rowText}>
          <span>Streaming Quality</span>
          {streamDetail && <span className={settingsUi.rowDetail}>{streamDetail}. Applies from the next song.</span>}
        </span>
        <Select
          label="Streaming Quality"
          value={stream}
          options={STREAM_QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
          onChange={setStream}
        />
      </label>
      <label className={settingsUi.controlRow}>
        <span className={settingsUi.rowText}>
          <span>Download Quality</span>
          {downloadDetail && <span className={settingsUi.rowDetail}>{downloadDetail}.</span>}
        </span>
        <Select
          label="Download Quality"
          value={download}
          options={DOWNLOAD_QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
          onChange={setDownload}
        />
      </label>
      <label className={settingsUi.controlRow}>
        <span className={settingsUi.rowText}>
          <span>Download Format</span>
          <span className={settingsUi.rowDetail}>{DOWNLOAD_FORMATS.find((f) => f.id === downloadFormat)?.detail}.</span>
        </span>
        <Select
          label="Download Format"
          value={downloadFormat}
          options={DOWNLOAD_FORMATS.map((f) => ({ value: f.id, label: f.label }))}
          onChange={setDownloadFormat}
        />
      </label>
    </>
  );
}

// ---- Scrobbling ------------------------------------------------------------------

/** Settings › Scrobbling: ListenBrainz (playback/scrobbling.ts). */
export function ScrobblingSettings() {
  const { enabled, token, primaryArtistOnly, setEnabled, setToken, setPrimaryArtistOnly } = useScrobbling();
  const [draft, setDraft] = useState(token);
  const [check, setCheck] = useState<{ state: 'idle' | 'checking' | 'valid' | 'invalid'; user: string | null }>({ state: 'idle', user: null });
  const verify = async () => {
    const value = draft.trim();
    setToken(value);
    if (!value) return setCheck({ state: 'idle', user: null });
    setCheck({ state: 'checking', user: null });
    const result = await validateToken(value);
    setCheck({ state: result.valid ? 'valid' : 'invalid', user: result.user });
  };
  return (
    <>
      <Toggle
        label="Scrobble to ListenBrainz"
        detail="Sends what you play to your ListenBrainz profile."
        checked={enabled}
        onChange={setEnabled}
      />
      <div className={`${settingsUi.row} gap-4`}>
        <span className={settingsUi.rowText}>
          <span>User Token</span>
          <span className={settingsUi.rowDetail}>
            {check.state === 'valid'
              ? `Connected${check.user ? ` as ${check.user}` : ''}.`
              : check.state === 'invalid'
                ? 'ListenBrainz did not accept this token.'
                : check.state === 'checking'
                  ? 'Checking…'
                  : 'Copy it from listenbrainz.org/settings.'}
          </span>
        </span>
        <span className="flex items-center">
          <input
            className={settingsUi.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder="Token"
            aria-label="ListenBrainz user token"
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void verify()}
          />
          <button className={settingsUi.inlineButton} disabled={check.state === 'checking'} onClick={() => void verify()}>
            Save
          </button>
        </span>
      </div>
      <Toggle
        label="Primary Artist Only"
        detail="Sends “A” instead of “A, B & C”."
        checked={primaryArtistOnly}
        onChange={setPrimaryArtistOnly}
      />
    </>
  );
}

// ---- Sleep timer -------------------------------------------------------------------

const SLEEP_CHOICES = [0, 5, 10, 15, 30, 45, 60, 90, 120];

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function SleepTimerSetting() {
  const { mode, start, endOfTrack, cancel } = useSleepTimer();
  const now = useNow(mode.kind === 'at');
  const remaining = mode.kind === 'at' ? Math.max(0, Math.ceil((mode.endsAt - now) / 60_000)) : 0;
  const value = mode.kind === 'off' ? '0' : mode.kind === 'end-of-track' ? 'eot' : 'running';
  return (
    <label className={settingsUi.controlRow}>
      <span className={settingsUi.rowText}>
        <span>Sleep Timer</span>
        <span className={settingsUi.rowDetail}>
          {mode.kind === 'at' ? `Pausing in ${remaining} min` : mode.kind === 'end-of-track' ? 'Pausing when this song ends' : 'Pause playback after a while.'}
        </span>
      </span>
      <Select
        label="Sleep Timer"
        value={value}
        options={[
          ...(mode.kind === 'at' ? [{ value: 'running', label: `${remaining} min left` }] : []),
          ...SLEEP_CHOICES.map((m) => ({ value: String(m), label: m === 0 ? 'Off' : `${m} minutes` })),
          { value: 'eot', label: 'End of current song' },
        ]}
        onChange={(v) => {
          if (v === 'eot') endOfTrack();
          else if (v === '0') cancel();
          else if (v !== 'running') start(Number(v));
        }}
      />
    </label>
  );
}

// ---- Window and tray ----------------------------------------------------------------

const prefsKey = ['desktop', 'prefs'] as const;

export function DesktopAppSettings() {
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: prefsKey, queryFn: desktopPrefs, enabled: isDesktop(), staleTime: Infinity });
  const update = useMutation({
    mutationFn: (patch: Partial<DesktopPrefs>) => setDesktopPrefs(patch),
    onSuccess: (next) => queryClient.setQueryData(prefsKey, next),
  });
  if (!isDesktop()) {
    return <p className={settingsUi.footer}>Run Prismix as the desktop app (npm run tauri dev) for window and tray settings.</p>;
  }
  if (!prefs.data) return null;
  return (
    <section className={settingsUi.group}>
      <label className={settingsUi.controlRow}>
        <span className={settingsUi.rowText}>
          <span>When Closing the Window</span>
          <span className={settingsUi.rowDetail}>
            {prefs.data.closeToTray
              ? 'Prismix hides in the system tray and keeps playing. Quit it from the tray icon’s menu.'
              : 'Closing the window quits Prismix and stops the music.'}
          </span>
        </span>
        <Select
          label="When Closing the Window"
          value={prefs.data.closeToTray ? 'tray' : 'quit'}
          options={[
            { value: 'tray', label: 'Minimize to the Tray' },
            { value: 'quit', label: 'Quit Prismix' },
          ]}
          onChange={(choice) => update.mutate({ closeToTray: choice === 'tray' })}
        />
      </label>
      <Toggle
        label="Media Keys"
        detail="Play/pause, next and previous keys control Prismix even when it isn’t focused."
        checked={prefs.data.globalMediaKeys}
        onChange={(globalMediaKeys) => update.mutate({ globalMediaKeys })}
      />
    </section>
  );
}

// ---- Updates -----------------------------------------------------------------------

/** Settings › Updates: the version, a manual check, and the install when one is found. */
export function UpdateSettings() {
  const { status, version, notes, progress, error, check, install } = useUpdater();
  const current = useQuery({ queryKey: ['desktop', 'version'], queryFn: appVersion, enabled: isDesktop(), staleTime: Infinity });
  if (!isDesktop()) return null;
  const busy = status === 'checking' || status === 'downloading' || status === 'installing';
  const detail =
    status === 'checking' ? 'Checking for updates…'
    : status === 'available' ? `Prismix ${version} is ready to install.`
    : status === 'downloading' ? (progress === null ? 'Downloading…' : `Downloading… ${Math.round(progress * 100)}%`)
    : status === 'installing' ? 'Installing. Prismix will restart.'
    : status === 'uptodate' ? 'You’re on the latest version.'
    : status === 'error' ? `Couldn’t update: ${error}`
    : 'Prismix checks for updates automatically.';
  return (
    <section className={settingsUi.group}>
      <div className={settingsUi.row}>
        <span className={settingsUi.rowText}>
          <span>Version {current.data ?? ''}</span>
          <span className={`${settingsUi.rowDetail} ${status === 'error' ? 'text-key' : ''}`}>{detail}</span>
        </span>
        {status === 'available' ? (
          <button className={`${settingsUi.inlineButton} bg-key! text-white!`} onClick={() => void install()}>
            Update and Restart
          </button>
        ) : (
          <button className={settingsUi.inlineButton} disabled={busy} onClick={() => void check()}>
            Check for Updates
          </button>
        )}
      </div>
      {status === 'available' && notes && (
        <div className={`${settingsUi.row} whitespace-pre-wrap ${settingsUi.rowDetail}`}>{notes}</div>
      )}
    </section>
  );
}

// ---- Cookie sign-in fallback ------------------------------------------------------------

const HELP: Record<Service, { title: string; site: string; needs: string }> = {
  youtube: { title: 'YouTube Music', site: 'music.youtube.com', needs: 'SAPISID (or __Secure-3PAPISID)' },
  spotify: { title: 'Spotify', site: 'open.spotify.com', needs: 'sp_dc' },
};

/**
 * For when Google refuses the sign-in window ("This browser or app may not be
 * secure"): paste the Cookie header from a browser that's signed in. It goes
 * straight to the encrypted vault in Rust and is never stored by the page.
 */
export function CookieSignInDialog({ service, onClose }: { service: Service; onClose: () => void }) {
  const [text, setText] = useState('');
  const save = useMutation({
    mutationFn: () => importCookies(service, text),
    onSuccess: () => {
      setText('');
      onClose();
    },
  });
  const help = HELP[service];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-(--z-modal) grid animate-fade place-items-center bg-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex w-[min(560px,calc(100vw-32px))] animate-zoom flex-col gap-3 rounded-[14px] bg-page p-5 shadow-glass" role="dialog" aria-modal="true" aria-label={`Sign in to ${help.title} with cookies`}>
        <header className="flex items-center justify-between">
          <h2 className="type-title-2-emphasized">Sign in to {help.title} with cookies</h2>
          <button className="grid size-[30px] place-items-center rounded-full bg-quaternary text-secondary" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <ol className={settingsUi.steps}>
          <li>
            In a browser where you’re signed in, open <b>{help.site}</b> and its developer tools (F12) › Network.
          </li>
          <li>Reload, click any request to {help.site}, and copy the whole <b>Cookie</b> request header.</li>
          <li>
            Paste it below. It must contain <b>{help.needs}</b>.
          </li>
        </ol>
        <textarea
          className="h-32 w-full resize-none rounded-[8px] border-0 bg-quaternary p-2.5 font-mono text-[12px] text-primary"
          placeholder="name=value; name2=value2; …"
          spellCheck={false}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        {save.error && <p className="type-callout text-destructive">{save.error instanceof Error ? save.error.message : String(save.error)}</p>}
        <p className="type-callout text-secondary">
          Cookies are kept encrypted on this computer only. Anyone with them can use your account, so never paste them anywhere else.
        </p>
        <div className="flex justify-end gap-2">
          <button className={settingsUi.inlineButton} onClick={onClose}>
            Cancel
          </button>
          <button className={`${settingsUi.inlineButton} bg-key! text-white!`} disabled={!text.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Checking…' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

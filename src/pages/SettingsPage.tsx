import { Select } from '@/components/Select';
import { ChevronRight, Users } from 'lucide-react';
import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { SiDiscord, SiSpotify, SiYoutubemusic } from 'react-icons/si';
import { PageHeader } from '@/components/PageHeader';
import { PrefetchLink } from '@/components/PrefetchLink';
import { useDiscord } from '@/extension/useDiscord';
import { signIn } from '@/desktop/session';
import { DESKTOP_VERSION } from '@/desktop/desktopBridge';
import { signOutOfYouTube } from '@/shell/AccountButton';
import { useYtAuth } from '@/extension/useYtAuth';
import { useParty } from '@/party/useParty';
import { useHistorySettings } from '@/playback/historyReporting';
import { CROSSFADE_CHOICES, usePlayer } from '@/state/player';
import { CookieSignInDialog, DesktopAppSettings, EqualizerSettings, QualitySettings, ScrobblingSettings, SleepTimerSetting, UpdateSettings } from './DesktopSettings';
import { AppleMusicToggles, CanvasToggle, SpotifyIntegration, Toggle } from './IntegrationSettings';
import { settingsUi } from './settingsStyles';

const LyricsSettings = lazy(() => import('@/shell/LyricsSettings').then((m) => ({ default: m.LyricsSettings })));

/** An integration's coloured glyph. */
function Glyph({ Icon, color, ink }: { Icon: ComponentType<{ size?: number }>; color: string; ink?: string }) {
  return (
    <span className={settingsUi.integrationIcon} style={{ backgroundColor: color, ...(ink && { color: ink }) }}>
      <Icon size={15} />
    </span>
  );
}

/** A row that opens a page of its own. */
function LinkRow({ to, icon, title, value }: { to: string; icon?: ReactNode; title: string; value?: string | null }) {
  return (
    <PrefetchLink to={to} className={`${icon ? settingsUi.integration : settingsUi.integrationPlain} ${settingsUi.linkRow}`}>
      {icon}
      <span className={settingsUi.integrationName}>{title}</span>
      <span className={settingsUi.value}>
        {value}
        <ChevronRight size={16} />
      </span>
    </PrefetchLink>
  );
}

function youtubeText(auth: ReturnType<typeof useYtAuth>): string {
  if (auth.state === 'checking') return 'Checking…';
  if (auth.state === 'unavailable') return 'Unavailable';
  const { browserSignedIn, connected, active } = auth.auth;
  if (!browserSignedIn) return 'Not signed in';
  if (!connected) return 'Disconnected';
  return active ? active.name : 'Signed in';
}

/**
 * Settings (SettingsSheet on the phone): the account and its integrations,
 * Listen Together, playback and lyrics, in the same grouped rows.
 */
export default function SettingsPage() {
  const yt = useYtAuth();
  const [cookies, setCookies] = useState<'youtube' | 'spotify' | null>(null);
  const ytSignedIn = yt.state === 'ready' && yt.auth.browserSignedIn;
  const discord = useDiscord();
  const party = useParty();
  const autoplay = usePlayer((s) => s.autoplay);
  const crossfadeSec = usePlayer((s) => s.crossfadeSec);
  const shareHistory = useHistorySettings((s) => s.share);
  const setShareHistory = useHistorySettings((s) => s.setShare);
  const { setAutoplay, setCrossfade } = usePlayer.getState();
  const [lyrics, setLyrics] = useState(false);
  const discordText =
    discord.state === 'ready' && discord.discord.connected
      ? discord.discord.enabled
        ? 'On'
        : 'Off'
      : discord.state === 'ready' && discord.discord.available
        ? 'Not connected'
        : null;

  return (
    <div className={settingsUi.centered}>
      <PageHeader title="Settings" />
      <div className={settingsUi.body}>
        <h2 className={settingsUi.sectionHeader}>Account & Integrations</h2>
        <section className={settingsUi.group}>
          <div className={settingsUi.integration}>
            <Glyph Icon={SiYoutubemusic} color="#ffffff" ink="#ff0033" />
            <span className={settingsUi.integrationName}>YouTube Music</span>
            <span className={settingsUi.value}>
              <span title={yt.state === 'ready' ? (yt.auth.problem ?? undefined) : undefined}>{youtubeText(yt)}</span>
              {ytSignedIn ? (
                <button className={settingsUi.inlineButton} onClick={() => void signOutOfYouTube()}>
                  Sign Out
                </button>
              ) : (
                <button className={settingsUi.inlineButton} onClick={() => void signIn('youtube').catch(() => setCookies('youtube'))}>
                  Sign In
                </button>
              )}
            </span>
          </div>
          <div className={settingsUi.integration}>
            <Glyph Icon={SiSpotify} color="#1ed760" />
            <span className={settingsUi.integrationName}>Spotify</span>
            <SpotifyIntegration />
          </div>
          {discord.state === 'ready' && (
            <LinkRow to="/settings/discord" icon={<Glyph Icon={SiDiscord} color="#5865f2" />} title="Discord" value={discordText ?? 'Off'} />
          )}
          <div className={settingsUi.integrationPlain}>
            <span className={settingsUi.rowText}>
              <span>Sign in with cookies</span>
              <span className={settingsUi.rowDetail}>If Google or Spotify won’t let the sign-in window through.</span>
            </span>
            <span className={settingsUi.value}>
              <button className={settingsUi.inlineButton} onClick={() => setCookies('youtube')}>
                YouTube
              </button>
              <button className={settingsUi.inlineButton} onClick={() => setCookies('spotify')}>
                Spotify
              </button>
            </span>
          </div>
        </section>
        <section className={`${settingsUi.group} mt-3 empty:hidden`}>
          <Toggle
            label="Share Listening Activity to YouTube"
            detail="Songs you play here go to your YouTube Music history and shape its recommendations."
            checked={shareHistory}
            onChange={setShareHistory}
          />
          <CanvasToggle />
        </section>

        <h2 className={settingsUi.sectionHeader}>Apple Music</h2>
        <section className={settingsUi.group}>
          <AppleMusicToggles />
        </section>
        <p className={settingsUi.footer}>From Apple Music’s public pages. No Apple Music account or sign-in needed.</p>

        <h2 className={settingsUi.sectionHeader}>Listen Together</h2>
        <section className={settingsUi.group}>
          <LinkRow
            to="/settings/listen-together"
            icon={<Glyph Icon={Users} color="#fa2d48" />}
            title="Listen Together"
            value={party.code ? `In party ${party.code}` : 'Listen in sync with friends'}
          />
        </section>

        <h2 className={settingsUi.sectionHeader}>Playback</h2>
        <section className={settingsUi.group}>
          <Toggle
            label="AutoPlay"
            detail="When the queue ends, keep playing similar music."
            checked={autoplay}
            onChange={setAutoplay}
          />
          <label className={settingsUi.controlRow}>
            <span>Crossfade</span>
            <Select
              label="Crossfade"
              value={String(crossfadeSec)}
              options={CROSSFADE_CHOICES.map((seconds) => ({ value: String(seconds), label: seconds === 0 ? 'Off' : `${seconds} seconds` }))}
              onChange={(v) => setCrossfade(Number(v))}
            />
          </label>
          <SleepTimerSetting />
        </section>

        <h2 className={settingsUi.sectionHeader}>Sound</h2>
        <section className={settingsUi.group}>
          <QualitySettings />
        </section>
        <p className={settingsUi.footer}>
          YouTube Music streams are Opus and AAC, never FLAC or Dolby Atmos, so Maximum plays the highest bitrate on offer (256 kbps AAC with Premium).
        </p>
        <section className={`${settingsUi.group} mt-3`}>
          <EqualizerSettings />
        </section>

        <h2 className={settingsUi.sectionHeader}>Scrobbling</h2>
        <section className={settingsUi.group}>
          <ScrobblingSettings />
        </section>

        <h2 className={settingsUi.sectionHeader}>Desktop</h2>
        <DesktopAppSettings />

        <h2 className={settingsUi.sectionHeader}>Updates</h2>
        <UpdateSettings />

        <h2 className={settingsUi.sectionHeader}>Lyrics</h2>
        <section className={settingsUi.group}>
          <button className={`${settingsUi.integrationPlain} ${settingsUi.linkRow}`} onClick={() => setLyrics(true)}>
            <span className={settingsUi.integrationName}>Lyric Sources</span>
            <span className={settingsUi.value}>
              Order, sources, syllable timing
              <ChevronRight size={16} />
            </span>
          </button>
        </section>
        <p className={settingsUi.footer}>Prismix for Desktop {DESKTOP_VERSION}</p>
      </div>
      {cookies && <CookieSignInDialog service={cookies} onClose={() => setCookies(null)} />}
      {lyrics && (
        <Suspense fallback={null}>
          <LyricsSettings onClose={() => setLyrics(false)} />
        </Suspense>
      )}
    </div>
  );
}

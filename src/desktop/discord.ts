import type { DiscordNowPlaying, DiscordPresenceOptions, DiscordState } from '@/bridge';
import { config } from '@/config';
import { invoke } from './tauri';

/**
 * Discord Rich Presence through the Discord desktop app's local RPC socket
 * (src-tauri/src/discord.rs), as the Compose desktop app does
 * (DesktopDiscordIpc.kt). No account token is involved: Discord itself shows
 * the activity for whoever is signed in to it.
 */

interface IpcState {
  status: 'off' | 'connecting' | 'ready' | 'error';
  user: { id: string; username: string; globalName: string | null; avatar: string | null } | null;
  problem: string | null;
}

const PREFS_KEY = 'prismix:discord.ipc';
const DEFAULT_BUTTON_1 = 'Listen on YouTube Music';
const DEFAULT_BUTTON_2 = 'Visit Prismix';
const ACTIVITY_TYPES = { playing: 0, listening: 2, watching: 3, competing: 5 } as const;

interface Prefs {
  linked: boolean;
  enabled: boolean;
}

function prefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return { linked: stored?.linked ?? false, enabled: stored?.enabled ?? false };
  } catch {
    return { linked: false, enabled: false };
  }
}

function savePrefs(change: Partial<Prefs>): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), ...change }));
}

let ipc: IpcState = { status: 'off', user: null, problem: null };
let listener: ((state: DiscordState) => void) | null = null;

export function onDiscordState(callback: (state: DiscordState) => void): void {
  listener = callback;
}

function avatarUrl(user: NonNullable<IpcState['user']>): string | null {
  if (!user.avatar || !/^\d+$/.test(user.id) || !/^[a-z0-9_]+$/i.test(user.avatar)) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
}

export function discordState(): DiscordState {
  const { linked, enabled } = prefs();
  const user = ipc.user
    ? { name: ipc.user.globalName || ipc.user.username, username: ipc.user.username, avatarUrl: avatarUrl(ipc.user) }
    : { name: 'Discord', username: 'desktop app', avatarUrl: null };
  return {
    available: true,
    connected: linked,
    enabled: linked && enabled,
    user: linked ? user : null,
    gateway: linked ? ipc.status : 'off',
    problem: linked ? ipc.problem : null,
  };
}

function adopt(next: IpcState): DiscordState {
  const changed = next.status !== ipc.status || next.problem !== ipc.problem || next.user?.id !== ipc.user?.id;
  ipc = next;
  const state = discordState();
  if (changed) listener?.(state);
  return state;
}

export async function refresh(): Promise<DiscordState> {
  try {
    return adopt(await invoke<IpcState>('discord_status'));
  } catch {
    return discordState();
  }
}

export async function connect(): Promise<DiscordState> {
  savePrefs({ linked: true, enabled: true });
  listener?.(discordState());
  return adopt(await invoke<IpcState>('discord_connect'));
}

export async function disconnect(): Promise<DiscordState> {
  savePrefs({ linked: false, enabled: false });
  const state = adopt(await invoke<IpcState>('discord_disconnect').catch(() => ({ status: 'off', user: null, problem: null }) as IpcState));
  listener?.(state);
  return state;
}

export async function setEnabled(on: boolean): Promise<DiscordState> {
  savePrefs({ enabled: on });
  if (!on) await invoke('discord_set_activity', { activity: null }).catch(() => undefined);
  const state = discordState();
  listener?.(state);
  return state;
}

function resolveVariables(text: string, track: DiscordNowPlaying): string {
  return text
    .replaceAll('{song_name}', track.title)
    .replaceAll('{artist_name}', track.artist)
    .replaceAll('{album_name}', track.album ?? '');
}

/** Discord refuses strings under 2 or over 128 characters in an activity. */
function field(text: string, max = 128): string {
  const chars = [...text.trim()];
  const clipped = chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
  return clipped.length < 2 ? `${clipped}  `.slice(0, 2) : clipped;
}

export function buildActivity(track: DiscordNowPlaying, options: DiscordPresenceOptions): Record<string, unknown> {
  const now = Date.now();
  const rate = track.playbackRate > 0 ? track.playbackRate : 1;
  const watchUrl = `https://music.youtube.com/watch?v=${encodeURIComponent(track.videoId)}`;
  const buttons: { label: string; url: string }[] = [];
  if (options.button1Visible) buttons.push({ label: field(resolveVariables(options.button1Text || DEFAULT_BUTTON_1, track), 32), url: watchUrl });
  if (options.button2Visible) buttons.push({ label: field(resolveVariables(options.button2Text || DEFAULT_BUTTON_2, track), 32), url: config.projectUrl });
  const art = track.artworkUrl?.startsWith('https://') && track.artworkUrl.length <= 256 ? track.artworkUrl : null;
  return {
    type: ACTIVITY_TYPES[options.activityType] ?? 2,
    ...(options.activityName.trim() && { name: field(options.activityName) }),
    details: field(rate !== 1 ? `${track.title} [${rate.toFixed(2)}x]` : track.title),
    state: field(track.artist || 'Unknown artist'),
    status_display_type: options.useDetails ? 2 : 1,
    timestamps: {
      start: Math.round(now - track.positionMs / rate),
      ...(track.durationMs > 0 && { end: Math.round(now + Math.max(0, track.durationMs - track.positionMs) / rate) }),
    },
    assets: {
      ...(art && { large_image: art }),
      ...(track.album && { large_text: field(track.album) }),
    },
    ...(buttons.length && { buttons }),
  };
}

export async function setPresence(track: DiscordNowPlaying | null, options: DiscordPresenceOptions): Promise<void> {
  const { linked, enabled } = prefs();
  if (!linked || !enabled) return;
  const activity = track ? buildActivity(track, options) : null;
  adopt(await invoke<IpcState>('discord_set_activity', { activity }));
}

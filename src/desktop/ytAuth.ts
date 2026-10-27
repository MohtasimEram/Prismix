import type { YtAccount, YtAuthState, YtChannel } from '@/bridge';
import { nativeFetch } from './nativeFetch';
import { sessions } from './session';

/**
 * YouTube Music sign-in, desktop edition: a port of the extension's
 * lib/ytAuth.ts. The Google cookies live in the Rust vault; a signed request
 * here only says which login (`X-Goog-AuthUser`) and which brand channel
 * (`X-Goog-PageId`) to act as, and Rust adds the cookies and the
 * SAPISIDHASH. The page only ever learns names and pictures.
 */

export const MUSIC_ORIGIN = 'https://music.youtube.com';

const WEB_REMIX_VERSION = '1.20251006.03.00';
const MAX_LOGINS = 10;
const ACCOUNTS_TTL_MS = 10 * 60_000;

interface Prefs {
  connected: boolean;
  selectedChannelId: string | null;
}

const PREFS_KEY = 'prismix:yt.prefs';

function loadPrefs(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    return { connected: stored?.connected ?? true, selectedChannelId: stored?.selectedChannelId ?? null };
  } catch {
    return { connected: true, selectedChannelId: null };
  }
}

function savePrefs(change: Partial<Prefs>): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...change }));
}

export interface Identity {
  authUser: string;
  pageId: string | null;
}

export class SignedOutError extends Error {
  readonly code = 'unauthenticated';
}

async function hasSession(): Promise<boolean> {
  return (await sessions()).youtube.signedIn;
}

/** A request made as [identity]; Rust signs it (for music.youtube.com when [signAsMusic]). */
export function signedFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null; signal?: AbortSignal | null },
  identity: Identity,
  signAsMusic = false,
): Promise<Response> {
  return nativeFetch(
    url,
    { method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ?? null, signal: init.signal ?? null },
    { auth: { kind: 'youtube', authUser: identity.authUser, pageId: identity.pageId, signAs: signAsMusic ? 'music' : null } },
  );
}

async function musicApi(endpoint: string, identity: Identity): Promise<unknown> {
  const response = await signedFetch(
    `${MUSIC_ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Youtube-Client-Name': '67',
        'X-Youtube-Client-Version': WEB_REMIX_VERSION,
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion: WEB_REMIX_VERSION, hl: 'en', gl: 'US' }, user: {} },
      }),
    },
    identity,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ---- Reading the account renderers (DesktopAccountParser) ----------------------

type Json = Record<string, unknown>;

function renderers(root: unknown, key: string, out: Json[] = []): Json[] {
  if (Array.isArray(root)) for (const item of root) renderers(item, key, out);
  else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Json);
      else renderers(v, key, out);
    }
  }
  return out;
}

function findString(root: unknown, key: string): string | null {
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = findString(item, key);
      if (found) return found;
    }
  } else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && typeof v === 'string' && v) return v;
      const found = findString(v, key);
      if (found) return found;
    }
  }
  return null;
}

function text(node: unknown): string {
  const n = node as { runs?: { text?: string }[]; simpleText?: string } | undefined;
  if (n?.runs) return n.runs.map((r) => r.text ?? '').join('');
  return n?.simpleText ?? '';
}

function photo(item: Json): string | null {
  const thumbnails = (item.accountPhoto as { thumbnails?: { url?: string }[] } | undefined)?.thumbnails;
  const url = thumbnails?.at(-1)?.url ?? null;
  return url?.startsWith('https://') ? url : null;
}

interface StoredChannel extends YtChannel {
  authUser: string;
  pageId: string | null;
  selectedOnWeb: boolean;
}

interface StoredAccount extends Omit<YtAccount, 'channels'> {
  channels: StoredChannel[];
}

function channelId(authUser: string, pageId: string | null): string {
  return `${authUser}:${pageId ?? 'own'}`;
}

/** Only digits are ever sent as X-Goog-PageId (Rust re-checks). */
const PAGE_ID = /^\d{1,32}$/;

function parseChannels(root: unknown, authUser: string): StoredChannel[] {
  const channels: StoredChannel[] = [];
  for (const item of renderers(root, 'accountItem')) {
    const name = text(item.accountName);
    if (!name) continue;
    const rawPageId = findString(item, 'pageId');
    const pageId = rawPageId && PAGE_ID.test(rawPageId) ? rawPageId : null;
    if (rawPageId && !pageId) continue;
    const handle = text(item.channelHandle) || text(item.accountByline) || null;
    const id = channelId(authUser, pageId);
    if (channels.some((c) => c.id === id)) continue;
    channels.push({ id, name, handle, avatarUrl: photo(item), brand: pageId !== null, authUser, pageId, selectedOnWeb: item.isSelected === true });
  }
  return channels;
}

let problem: string | null = null;

function describeEmpty(endpoint: string, body: unknown): string {
  const services =
    (body as { responseContext?: { serviceTrackingParams?: { params?: Json[] }[] } })?.responseContext
      ?.serviceTrackingParams ?? [];
  const loggedIn = services.flatMap((service) => service.params ?? []).find((param) => param.key === 'logged_in')?.value;
  if (loggedIn === '0') return `${endpoint}: YouTube answered as if signed out (the session wasn't accepted)`;
  const keys = body && typeof body === 'object' ? Object.keys(body).join(', ') : typeof body;
  return `${endpoint}: no account in the answer (${keys})`;
}

async function readLogin(authUser: string): Promise<{ account: StoredAccount | null; why: string | null }> {
  const identity = { authUser, pageId: null };
  let header: Json | undefined;
  try {
    const menu = await musicApi('account/account_menu', identity);
    header = renderers(menu, 'activeAccountHeaderRenderer')[0];
    if (!header) return { account: null, why: describeEmpty('account_menu', menu) };
  } catch (error) {
    return { account: null, why: `account_menu: ${error instanceof Error ? error.message : String(error)}` };
  }
  const name = text(header.accountName) || 'YouTube Music';
  const email = text(header.email) || null;
  const handle = text(header.channelHandle) || null;
  const avatarUrl = photo(header);
  let channels: StoredChannel[] = [];
  try {
    channels = parseChannels(await musicApi('account/accounts_list', identity), authUser);
  } catch {
    // The switcher isn't answered for every account; the login's own channel always exists.
  }
  if (!channels.length) {
    channels = [{ id: channelId(authUser, null), name, handle: handle ?? email, avatarUrl, brand: false, authUser, pageId: null, selectedOnWeb: true }];
  }
  return { account: { authUser, name, email, avatarUrl, channels }, why: null };
}

async function webSessionIndex(): Promise<string | null> {
  try {
    const response = await signedFetch(`${MUSIC_ORIGIN}/`, { headers: { Accept: 'text/html' } }, { authUser: '0', pageId: null });
    const html = await response.text();
    return /"SESSION_INDEX":"?(\d+)/.exec(html)?.[1] ?? null;
  } catch {
    return null;
  }
}

interface Accounts {
  list: StoredAccount[];
  webIndex: string | null;
}

async function readAccounts(): Promise<Accounts> {
  problem = null;
  const [results, webIndex] = await Promise.all([
    Promise.all(Array.from({ length: MAX_LOGINS }, (_, i) => readLogin(String(i)))),
    webSessionIndex(),
  ]);
  const list: StoredAccount[] = [];
  const seen = new Set<string>();
  for (const { account } of results) {
    if (!account) continue;
    const key = account.email ?? `${account.name}|${account.channels.map((c) => c.id.split(':')[1]).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(account);
  }
  if (!list.length) problem = results[Number(webIndex ?? 0)]?.why ?? results[0]?.why ?? 'no signed-in Google account found';
  return { list, webIndex };
}

let cache: (Accounts & { at: number; generation: number }) | null = null;
let reading: Promise<Accounts> | null = null;

const RETRY_DELAY_MS = 1_500;

/** One read, and one more shortly after when no account came back: a hiccup (a dropped request, a rate limit) shouldn't read as signed out. */
async function readAccountsWithRetry(): Promise<Accounts> {
  const first = await readAccounts();
  if (first.list.length) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return readAccounts();
}

async function accounts(refresh: boolean): Promise<Accounts> {
  const { generation } = (await sessions()).youtube;
  if (!refresh && cache && cache.generation === generation && Date.now() - cache.at < ACCOUNTS_TTL_MS) return cache;
  reading ??= readAccountsWithRetry()
    .then((read) => {
      // A read that found nobody isn't kept: the next one tries again instead of waiting out the TTL.
      cache = read.list.length ? { ...read, at: Date.now(), generation } : null;
      return read;
    })
    .finally(() => (reading = null));
  return reading;
}

export function invalidateAccounts(): void {
  cache = null;
}

function chooseChannel({ list, webIndex }: Accounts, selectedId: string | null): StoredChannel | null {
  const all = list.flatMap((a) => a.channels);
  const web = list.find((a) => a.authUser === webIndex) ?? list[0];
  return all.find((c) => c.id === selectedId) ?? web?.channels.find((c) => c.selectedOnWeb) ?? web?.channels[0] ?? null;
}

function publicChannel({ id, name, handle, avatarUrl, brand }: StoredChannel): YtChannel {
  return { id, name, handle, avatarUrl, brand };
}

export async function authState(refresh = false): Promise<YtAuthState> {
  const prefs = loadPrefs();
  const browserSignedIn = await hasSession();
  if (!browserSignedIn || !prefs.connected) {
    return { browserSignedIn, connected: prefs.connected, signedIn: false, accounts: [], active: null, problem: null };
  }
  const read = await accounts(refresh);
  const active = chooseChannel(read, prefs.selectedChannelId);
  return {
    browserSignedIn,
    connected: true,
    signedIn: active !== null,
    problem: active ? null : problem,
    accounts: read.list.map((a) => ({ ...a, channels: a.channels.map(publicChannel) })),
    active: active && { ...publicChannel(active), authUser: active.authUser },
  };
}

export async function activeIdentity(): Promise<Identity | null> {
  const prefs = loadPrefs();
  if (!prefs.connected || !(await hasSession())) return null;
  const active = chooseChannel(await accounts(false), prefs.selectedChannelId);
  return active && { authUser: active.authUser, pageId: active.pageId };
}

export async function selectChannel(id: string): Promise<YtAuthState> {
  const { list } = await accounts(false);
  if (!list.some((a) => a.channels.some((c) => c.id === id))) throw new Error(`No channel ${id} in this session`);
  savePrefs({ selectedChannelId: id });
  return authState();
}

export async function setConnected(connected: boolean): Promise<YtAuthState> {
  savePrefs({ connected });
  return authState(connected);
}

/** After a sign-out: the next sign-in starts from YouTube's own default channel. */
export function forgetSelection(): void {
  savePrefs({ selectedChannelId: null, connected: true });
  invalidateAccounts();
}

// The player's account (optional: guests play as before). Sign in with Google gives an ID token
// that Supabase Auth turns into a session; the profile keeps the reserved name, the Orb and the
// stats the game server writes. supabase-js and Google's script load only when they are needed:
// a saved session at startup, or the account window opened.
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { lang } from '../i18n';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../net/supabase';

/** The Google OAuth client (Web) of madorbs.com: public, it goes in the page. */
const GOOGLE_CLIENT_ID = '224448068826-3dfhsa8j80ab13s639g70kh0c1dafpmk.apps.googleusercontent.com';
/** Where supabase-js keeps the session in localStorage. */
const STORAGE_KEY = 'madorbs.auth';
const PROFILE_COLUMNS = 'name, skin, red, green, blue, kills, deaths, wins, matches';

export interface Profile {
  name: string | null;
  skin: string;
  red: string;
  green: string;
  blue: string;
  kills: number;
  deaths: number;
  wins: number;
  matches: number;
}

export type OrbChoice = Pick<Profile, 'skin' | 'red' | 'green' | 'blue'>;

/** Why a profile change failed: the name belongs to another account, breaks the rules, or anything else. */
export type SaveError = 'taken' | 'invalid' | 'error';

interface GoogleId {
  initialize(config: Record<string, unknown>): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

export class Account {
  session: Session | null = null;
  profile: Profile | null = null;
  private client: SupabaseClient | null = null;
  private loading: Promise<SupabaseClient> | null = null;
  private readonly listeners = new Set<() => void>();
  private orbTimer = 0;

  get signedIn(): boolean {
    return !!this.session;
  }

  get email(): string {
    return this.session?.user.email ?? '';
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Restores the session saved in this browser, if any (otherwise nothing is downloaded). */
  async restore(): Promise<void> {
    let saved = false;
    try {
      saved = localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      /* storage unavailable: no saved session */
    }
    if (!saved) return;
    try {
      await this.load();
    } catch (e) {
      console.warn('[account] cannot restore the session', e);
    }
  }

  private load(): Promise<SupabaseClient> {
    this.loading ??= (async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
      this.client = client;
      const { data } = await client.auth.getSession();
      this.session = data.session;
      client.auth.onAuthStateChange((event, session) => {
        const userChanged = session?.user.id !== this.session?.user.id;
        this.session = session;
        if (!session) this.profile = null;
        // No Supabase call inside this callback (it would wait on the auth lock)
        if (session && (userChanged || event === 'USER_UPDATED')) setTimeout(() => void this.refreshProfile(), 0);
        else this.emit();
      });
      if (this.session) await this.refreshProfile();
      else this.emit();
      return client;
    })();
    return this.loading;
  }

  async refreshProfile(): Promise<void> {
    const client = this.client;
    const id = this.session?.user.id;
    if (!client || !id) return;
    const { data, error } = await client.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle();
    if (error) console.warn('[account] cannot read the profile', error.message);
    else this.profile = data as Profile | null;
    this.emit();
  }

  /**
   * Google's "Sign in with Google" button inside `parent`. After the player picks an account,
   * the ID token becomes a Supabase session; `onError` gets the reason when that fails.
   */
  async renderGoogleButton(parent: HTMLElement, onError: (e: unknown) => void, onSignedIn: () => void): Promise<void> {
    const [google] = await Promise.all([loadGoogle(), this.load()]);
    // A new nonce for each button: Google signs its hash into the token, Supabase checks it
    const nonce = randomNonce();
    const hashed = await sha256Hex(nonce);
    google.initialize({
      client_id: GOOGLE_CLIENT_ID,
      nonce: hashed,
      ux_mode: 'popup',
      context: 'signin',
      itp_support: true,
      use_fedcm_for_button: true,
      callback: (response: { credential?: string }) => {
        if (!response.credential) return;
        void this.signInWithIdToken(response.credential, nonce).then(onSignedIn, onError);
      },
    });
    parent.replaceChildren();
    google.renderButton(parent, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', locale: lang(), width: 280 });
  }

  private async signInWithIdToken(token: string, nonce: string): Promise<void> {
    const client = await this.load();
    const { data, error } = await client.auth.signInWithIdToken({ provider: 'google', token, nonce });
    if (error) throw error;
    this.session = data.session;
    await this.refreshProfile();
  }

  async signOut(): Promise<void> {
    window.google?.accounts.id.disableAutoSelect();
    const client = this.client;
    if (client) await client.auth.signOut({ scope: 'local' });
    this.session = null;
    this.profile = null;
    this.emit();
  }

  /** Deletes the account and its profile for good (the player's own rights, see /privacy). */
  async deleteAccount(): Promise<void> {
    const client = await this.load();
    const { error } = await client.rpc('delete_my_account');
    if (error) throw error;
    await this.signOut();
  }

  /** Claims a name for the account (unique, case aside). */
  async saveName(name: string): Promise<SaveError | null> {
    return this.save({ name });
  }

  /** The Orb follows the account to other computers; saved a moment after the last change. */
  saveOrb(orb: OrbChoice, now = false): void {
    if (!this.profile) return;
    Object.assign(this.profile, orb);
    clearTimeout(this.orbTimer);
    if (now) void this.save({ ...orb });
    else this.orbTimer = window.setTimeout(() => void this.save({ ...orb }), 1500);
  }

  private async save(changes: Partial<Profile>): Promise<SaveError | null> {
    const client = this.client;
    const id = this.session?.user.id;
    if (!client || !id) return 'error';
    const { data, error } = await client.from('profiles').update(changes).eq('id', id).select(PROFILE_COLUMNS).maybeSingle();
    if (error) {
      console.warn('[account] cannot save the profile', error.message);
      // unique_violation: another account has the name; check_violation: the name's rules
      return error.code === '23505' ? 'taken' : error.code === '23514' ? 'invalid' : 'error';
    }
    if (data) this.profile = data as Profile;
    this.emit();
    return null;
  }

  /** A fresh access token for the game server (refreshed first when it is about to expire). */
  async accessToken(): Promise<string | undefined> {
    if (!this.client || !this.session) return undefined;
    try {
      const { data } = await this.client.auth.getSession();
      return data.session?.access_token;
    } catch {
      return undefined;
    }
  }
}

/** Does an account own this name? Asked while a guest types it (false when unknown). */
export async function isNameTaken(name: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/name_taken`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_name: name }),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok && (await res.json()) === true;
  } catch {
    return false;
  }
}

let googleScript: Promise<GoogleId> | null = null;

function loadGoogle(): Promise<GoogleId> {
  googleScript ??= new Promise<GoogleId>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google script without accounts.id')));
    s.onerror = () => {
      googleScript = null;
      reject(new Error('Google script failed to load'));
    };
    document.head.appendChild(s);
  });
  return googleScript;
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

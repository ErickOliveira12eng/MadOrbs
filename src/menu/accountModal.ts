// The account window: signed out, what an account gives and Google's button; signed in, the
// name, the player ID, sign out and delete the account. The stats have their own window (statsModal.ts).
import { t } from '../i18n';
import { MAX_NAME_LENGTH, cleanName, isReservedName, limitNameInput } from '../net/protocol';
import type { Account, SaveError } from './account';
import type { OrbStudio } from './orbStudio';
import { skinInfo, type Settings } from './settings';

const DEBUG_ZOOM_KEY = 'madorbs.debugZoom';
const DEBUG_BOTS_KEY = 'madorbs.debugBots';

function flagOn(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** The debug zoom was turned on in this browser (the game uses it only for the accounts allowed). */
export const debugZoomOn = (): boolean => flagOn(DEBUG_ZOOM_KEY);
/** The waves past 32 bots were turned on in this browser (the accounts allowed). */
export const debugBotsOn = (): boolean => flagOn(DEBUG_BOTS_KEY);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class AccountModal {
  private readonly root = $('accountModal');
  private readonly nameInput = $<HTMLInputElement>('accountNameInput');
  private googleShown = false;
  private deleteArmed = 0;

  constructor(
    private readonly account: Account,
    private readonly settings: Settings,
    private readonly studio: OrbStudio,
    /** The name the player typed on the start screen changed with the account's. */
    private readonly onName: (name: string) => void,
  ) {
    for (const el of this.root.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    // At most MAX_NAME_LENGTH characters (an emoji is one: the maxlength counts UTF-16 units)
    this.nameInput.maxLength = MAX_NAME_LENGTH * 2;
    this.nameInput.addEventListener('input', () => {
      const typed = limitNameInput(this.nameInput.value);
      if (typed !== this.nameInput.value) this.nameInput.value = typed;
    });
    $<HTMLFormElement>('accountNameForm').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.saveName(this.nameInput.value);
    });
    $('accountSignOut').addEventListener('click', () => void account.signOut());
    // The debug zoom (only the accounts the server allows see it): remembered in this browser
    for (const [id, key] of [['debugZoomInput', DEBUG_ZOOM_KEY], ['debugBotsInput', DEBUG_BOTS_KEY]] as const) {
      const box = $<HTMLInputElement>(id);
      box.checked = flagOn(key);
      box.addEventListener('change', () => setFlag(key, box.checked));
    }
    $('accountDelete').addEventListener('click', () => void this.deleteAccount());
    account.onChange(() => this.render());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.showError('');
    this.showNameMessage('');
    this.render();
  }

  close(): void {
    this.root.hidden = true;
    this.disarmDelete();
  }

  /** Saves the account's name; `quiet` leaves no message when it works (at sign-in). */
  async saveName(raw: string, quiet = false): Promise<SaveError | null> {
    const name = cleanName(raw);
    if (!name) return 'invalid';
    if (isReservedName(name)) {
      this.showNameMessage(t('name.reserved'), true);
      return 'invalid';
    }
    if (name === this.account.profile?.name) return null;
    const err = await this.account.saveName(name);
    if (err) this.showNameMessage(t(err === 'taken' ? 'account.taken' : err === 'invalid' ? 'account.invalid' : 'account.error'), true);
    else {
      this.onName(name);
      if (!quiet) this.showNameMessage(t('account.saved'));
    }
    return err;
  }

  private render(): void {
    const signedIn = this.account.signedIn;
    $('accountOut').hidden = signedIn;
    $('accountIn').hidden = !signedIn;
    if (!this.isOpen) return;
    if (!signedIn) {
      this.showGoogle();
      return;
    }
    const p = this.account.profile;
    $('accountName').textContent = p?.name ?? t('account.pickName');
    $('accountTag').textContent = p ? `#${p.tag}` : '';
    $('accountEmail').textContent = this.account.email;
    $('accountDebugZoom').hidden = !this.account.debugTools.zoom;
    $('accountDebugBots').hidden = !this.account.debugTools.bots;
    if (document.activeElement !== this.nameInput) this.nameInput.value = p?.name ?? this.settings.name;
    void this.studio.picture(skinInfo(this.settings), 144, undefined, true).then((src) => ($<HTMLImageElement>('accountOrb').src = src));
  }

  /** Google's button, drawn once per page (its script loads the first time). */
  private showGoogle(): void {
    if (this.googleShown) return;
    this.googleShown = true;
    const box = $('googleButton');
    box.textContent = t('menu.loading');
    this.account
      .renderGoogleButton(
        box,
        (e) => this.showError(t('account.signInFailed', { reason: (e as Error).message ?? String(e) })),
        () => void this.afterSignIn(),
      )
      .catch(() => {
        this.googleShown = false;
        box.textContent = '';
        this.showError(t('account.googleFailed'));
      });
  }

  /** A new account takes the name typed on the start screen. */
  private async afterSignIn(): Promise<void> {
    this.showError('');
    const p = this.account.profile;
    if (!p) return;
    if (p.name) {
      this.onName(p.name);
      return;
    }
    if (this.settings.name && !(await this.saveName(this.settings.name, true))) return;
    this.showNameMessage(t('account.pickName'));
    this.nameInput.focus();
  }

  private async deleteAccount(): Promise<void> {
    if (!this.deleteArmed) {
      // A second click within 5 s deletes for good
      $('accountDeleteText').textContent = t('account.deleteConfirm');
      this.deleteArmed = window.setTimeout(() => this.disarmDelete(), 5000);
      return;
    }
    this.disarmDelete();
    try {
      await this.account.deleteAccount();
      this.showError('');
      this.showNameMessage('');
      $('accountDeleteText').textContent = t('account.delete');
      this.showNotice(t('account.deleted'));
    } catch (e) {
      console.warn('[account] delete failed', e);
      this.showError(t('account.error'));
    }
  }

  private disarmDelete(): void {
    clearTimeout(this.deleteArmed);
    this.deleteArmed = 0;
    $('accountDeleteText').textContent = t('account.delete');
  }

  private showError(text: string): void {
    const box = $('accountError');
    box.classList.remove('notice');
    box.textContent = text;
    box.hidden = !text;
  }

  private showNotice(text: string): void {
    this.showError(text);
    $('accountError').classList.add('notice');
  }

  private showNameMessage(text: string, error = false): void {
    const box = $('accountNameMsg');
    box.textContent = text;
    box.hidden = !text;
    box.classList.toggle('error', error);
  }
}


// The account window: signed out, what an account gives and Google's button; signed in, the
// reserved name, the stats the game server keeps, sign out and delete the account.
import { bigNum, num, t } from '../i18n';
import type { Account, SaveError } from './account';
import type { OrbStudio } from './orbStudio';
import { skinInfo, type Settings } from './settings';

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

    $<HTMLFormElement>('accountNameForm').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.saveName(this.nameInput.value);
    });
    $('accountSignOut').addEventListener('click', () => void account.signOut());
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
    // The stats change while playing: read them again
    if (this.account.signedIn) void this.account.refreshProfile();
  }

  close(): void {
    this.root.hidden = true;
    this.disarmDelete();
  }

  /** Claims a name for the account; `quiet` leaves no message when it works (claimed at sign-in). */
  async saveName(raw: string, quiet = false): Promise<SaveError | null> {
    const name = raw.trim().slice(0, 31);
    if (!name) return 'invalid';
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
    $('accountEmail').textContent = this.account.email;
    if (document.activeElement !== this.nameInput) this.nameInput.value = p?.name ?? this.settings.name;
    $('statKills').textContent = bigNum(p?.kills ?? 0);
    $('statDeaths').textContent = bigNum(p?.deaths ?? 0);
    $('statKd').textContent = num((p?.kills ?? 0) / Math.max(1, p?.deaths ?? 0), 2);
    $('statWins').textContent = bigNum(p?.wins ?? 0);
    $('statMatches').textContent = bigNum(p?.matches ?? 0);
    void this.studio.picture(skinInfo(this.settings), 144).then((src) => ($<HTMLImageElement>('accountOrb').src = src));
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

  /** A new account takes the name typed on the start screen, if nobody has it. */
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

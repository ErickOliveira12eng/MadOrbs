// The account window: signed out, what an account gives and Google's button; signed in, the
// name, the player ID, the stats the game server keeps, sign out and delete the account.
import { modeShort } from '../client/modes';
import { bigNum, num, t } from '../i18n';
import { ROOM_MODES, type RoomMode } from '../net/protocol';
import { NO_STATS, type Account, type ModeStats, type SaveError } from './account';
import type { OrbStudio } from './orbStudio';
import { skinInfo, type Settings } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class AccountModal {
  private readonly root = $('accountModal');
  private readonly nameInput = $<HTMLInputElement>('accountNameInput');
  private googleShown = false;
  private deleteArmed = 0;
  /** The stats shown: one game mode, or all of them added up. */
  private statsMode: RoomMode | 'all' = 'all';

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
    this.buildStatsTabs();
    // A mode's row in the "All" tab opens that mode
    $('statsBody').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
      if (!row) return;
      this.statsMode = row.dataset.go as RoomMode;
      this.renderStats();
    });
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

  /** Saves the account's name; `quiet` leaves no message when it works (at sign-in). */
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
    $('accountTag').textContent = p ? `#${p.tag}` : '';
    $('accountEmail').textContent = this.account.email;
    if (document.activeElement !== this.nameInput) this.nameInput.value = p?.name ?? this.settings.name;
    this.renderStats();
    void this.studio.picture(skinInfo(this.settings), 144, undefined, true).then((src) => ($<HTMLImageElement>('accountOrb').src = src));
  }

  /** "All" and one button per game mode above the stats. */
  private buildStatsTabs(): void {
    const box = $('statsModes');
    for (const mode of ['all', ...ROOM_MODES] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = mode;
      b.setAttribute('role', 'radio');
      b.textContent = mode === 'all' ? t('account.allModes') : modeShort(mode);
      b.addEventListener('click', () => {
        this.statsMode = mode;
        this.renderStats();
      });
      box.appendChild(b);
    }
  }

  private renderStats(): void {
    for (const b of $('statsModes').querySelectorAll<HTMLElement>('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === this.statsMode));
    const all = this.account.stats;
    const mode = this.statsMode;
    const s = mode === 'all' ? sumStats(ROOM_MODES.map((m) => all[m] ?? NO_STATS)) : (all[mode] ?? NO_STATS);
    if (s.matches === 0 && s.kills === 0 && s.deaths === 0) {
      $('statsBody').innerHTML = `<p class="stats-empty">${t(mode === 'all' ? 'account.noStats' : 'account.noStatsMode')}</p>`;
      return;
    }
    const rate = s.matches ? s.wins / s.matches : 0;
    // The ring: an SVG circle drawn up to the win rate
    const C = 2 * Math.PI * 42;
    const ring =
      `<div class="stats-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" class="track"/>` +
      `<circle cx="50" cy="50" r="42" class="fill" stroke-dasharray="${(C * rate).toFixed(1)} ${C.toFixed(1)}"/></svg>` +
      `<div><b>${s.matches ? `${Math.round(rate * 100)}%` : '–'}</b><small>${t('account.winRate')}</small></div></div>`;
    const hero =
      `<div class="stats-hero">${ring}<div class="stats-side">` +
      `<p class="stats-line">${t('account.winsLine', { wins: `<b>${bigNum(s.wins)}</b>`, matches: `<b>${bigNum(s.matches)}</b>` })}</p>` +
      `<div class="stats-pair"><span>${t('account.kd')}</span><b>${num(s.kills / Math.max(1, s.deaths), 2)}</b></div>` +
      `<div class="stats-pair"><span>${t('account.killsPerMatch')}</span><b>${s.matches ? num(s.kills / s.matches, 1) : '–'}</b></div>` +
      `</div></div>`;
    const tile = (value: number, key: Parameters<typeof t>[0]) => `<div><b>${bigNum(value)}</b><span>${t(key)}</span></div>`;
    const tiles =
      `<div class="stats-tiles">${tile(s.kills, 'account.kills')}${tile(s.deaths, 'account.deaths')}${tile(s.matches, 'account.matches')}` +
      `${tile(s.wins, 'account.wins')}${mode === 'ctf' ? tile(s.captures, 'account.captures') : ''}</div>`;
    // All modes: how each one goes, side by side
    let modes = '';
    if (mode === 'all') {
      modes =
        `<div class="stats-modes"><div class="row head"><span>${t('account.mode')}</span><span>${t('account.matches')}</span><span>${t('account.winRate')}</span><span>${t('account.kd')}</span></div>` +
        ROOM_MODES.map((m) => {
          const x = all[m] ?? NO_STATS;
          const r = x.matches ? x.wins / x.matches : 0;
          return (
            `<button type="button" class="row" data-go="${m}"><span>${modeShort(m)}</span><span>${bigNum(x.matches)}</span>` +
            `<span class="rate"><i><em style="width:${Math.round(r * 100)}%"></em></i>${x.matches ? `${Math.round(r * 100)}%` : '–'}</span>` +
            `<span>${x.kills || x.deaths ? num(x.kills / Math.max(1, x.deaths), 2) : '–'}</span></button>`
          );
        }).join('') +
        `</div>`;
    }
    $('statsBody').innerHTML = hero + tiles + modes;
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

function sumStats(list: ModeStats[]): ModeStats {
  return list.reduce(
    (sum, x) => ({ kills: sum.kills + x.kills, deaths: sum.deaths + x.deaths, wins: sum.wins + x.wins, matches: sum.matches + x.matches, captures: sum.captures + x.captures }),
    NO_STATS,
  );
}

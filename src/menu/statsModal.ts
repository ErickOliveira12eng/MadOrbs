// The stats window (the start screen's "Stats" button): the account's online stats per game mode
// (win rate, K/D, kills per match, the record...), or, signed out, an invitation to sign in.
import { modeShort } from '../client/modes';
import { bigNum, num, t } from '../i18n';
import { ROOM_MODES, type RoomMode } from '../net/protocol';
import { NO_STATS, type Account, type ModeStats } from './account';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class StatsModal {
  private readonly root = $('statsModal');
  /** The stats shown: one game mode, or all of them added up. */
  private statsMode: RoomMode | 'all' = 'all';

  constructor(
    private readonly account: Account,
    /** "Sign in": opens the account window. */
    private readonly onSignIn: () => void,
  ) {
    for (const el of this.root.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    $('statsSignIn').addEventListener('click', () => {
      this.close();
      this.onSignIn();
    });
    this.buildStatsTabs();
    // A mode's row in the "All" tab opens that mode
    $('statsBody').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
      if (!row) return;
      this.statsMode = row.dataset.go as RoomMode;
      this.renderStats();
    });
    account.onChange(() => {
      if (this.isOpen) this.render();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.render();
    // The stats change while playing: read them again
    if (this.account.signedIn) void this.account.refreshProfile();
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const signedIn = this.account.signedIn;
    $('statsOut').hidden = signedIn;
    $('statsIn').hidden = !signedIn;
    if (signedIn) this.renderStats();
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
    const tile = (value: number, key: Parameters<typeof t>[0], cls = '') => `<div class="${cls}"${cls ? ` title="${t('account.recordHint')}"` : ''}><b>${bigNum(value)}</b><span>${t(key)}</span></div>`;
    const tiles =
      `<div class="stats-tiles">${tile(s.kills, 'account.kills')}${tile(s.deaths, 'account.deaths')}${tile(s.matches, 'account.matches')}` +
      `${tile(s.wins, 'account.wins')}${mode === 'ctf' ? tile(s.captures, 'account.captures') : ''}${tile(s.bestKills, 'account.record', 'record')}</div>`;
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
}

function sumStats(list: ModeStats[]): ModeStats {
  return list.reduce(
    (sum, x) => ({
      kills: sum.kills + x.kills,
      deaths: sum.deaths + x.deaths,
      wins: sum.wins + x.wins,
      matches: sum.matches + x.matches,
      captures: sum.captures + x.captures,
      // The record: the highest of the modes
      bestKills: Math.max(sum.bestKills, x.bestKills),
    }),
    NO_STATS,
  );
}

// The start screen's ranking column (Erick, 23/10/2026): tabs for the online play (the mode chosen on the
// Multiplayer card), the waves ("Survival" on this screen) and the campaign; the top 3, then the rows around the
// player's own place, the player's row lit; "See all" opens the ranking window on that mode. Under it, "Your
// performance": the place, the number it goes by and the top share ("Top 12%"); guests are asked to sign in.
// From Supabase's leaderboard_near (Account.rankingNear).
import { modeName } from '../client/modes';
import { bigNum, t, type Key } from '../i18n';
import type { RoomMode } from '../net/protocol';
import type { Account, RankingMode, RankingRow } from './account';
import { icon } from './icons';
import { COLUMNS, esc, orbStyle } from './rankingModal';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
/**
 * The waves' time to reach the best wave, beside it (Erick, 24/10/2026: the time breaks the ties, it should be seen
 * and raced); none for a run from a checkpoint never reached with a time.
 */
const wavesTime = (mode: RankingMode, r: RankingRow) => (mode === 'waves' && typeof r.stats.time === 'number' ? `<small>${clock(r.stats.time)}</small>` : '');

type Tab = 'online' | 'waves' | 'campaign';

/** What each list goes by, said under the tabs. */
const BY: Record<RankingMode, Key> = {
  dm: 'lobby.rankBy.dm',
  tdm: 'lobby.rankBy.tdm',
  ctf: 'lobby.rankBy.ctf',
  waves: 'lobby.rankBy.waves',
  campaign: 'lobby.rankBy.campaign',
};
/** The top rows (a guest sees only the top: a longer one). */
const TOP = 3;
const GUEST_TOP = 6;
/** A list read again after this long. */
const CACHE_MS = 60_000;

export class LobbyRanking {
  private tab: Tab = 'online';
  private readonly cache = new Map<string, { at: number; rows: RankingRow[]; total: number }>();
  /** Asked once the start screen has settled (not with the page's first bytes). */
  private started = false;

  constructor(
    private readonly account: Account,
    /** The mode chosen on the Multiplayer card. */
    private readonly onlineMode: () => RoomMode,
    /** "See all": the ranking window on this mode. */
    onFull: (mode: RankingMode) => void,
    onSignIn: () => void,
  ) {
    for (const b of $('lrTabs').querySelectorAll<HTMLElement>('[data-tab]')) {
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        void this.render();
      });
    }
    $('lrFull').addEventListener('click', () => onFull(this.mode));
    $('lrPerf').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-signin]')) onSignIn();
    });
    account.onChange(() => {
      this.cache.clear();
      if (this.started) void this.render();
    });
  }

  private get mode(): RankingMode {
    return this.tab === 'online' ? this.onlineMode() : this.tab;
  }

  /** The start screen showed (and the Multiplayer card's mode may have changed). */
  refresh(): void {
    if (this.started) {
      void this.render();
      return;
    }
    this.started = true;
    window.setTimeout(() => void this.render(), 600);
  }

  private async render(): Promise<void> {
    const mode = this.mode;
    for (const b of $('lrTabs').querySelectorAll<HTMLElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
    $('lrSub').textContent = this.tab === 'online' ? `${modeName(mode as RoomMode)} · ${t(BY[mode])}` : t(BY[mode]);
    const list = $('lrList');
    const signed = this.account.signedIn;
    const key = `${mode}:${signed}`;
    let got = this.cache.get(key);
    if (!got || performance.now() - got.at > CACHE_MS) {
      if (!got) list.innerHTML = `<li class="lr-note">${t('ranking.loading')}</li>`;
      try {
        const { rows, total } = await this.account.rankingNear(mode, signed ? TOP : GUEST_TOP);
        got = { at: performance.now(), rows, total };
        this.cache.set(key, got);
      } catch (e) {
        console.warn('[ranking]', e);
        if (this.mode === mode) {
          list.innerHTML = `<li class="lr-note">${t('ranking.error')}</li>`;
          this.renderPerf(mode, null, 0);
        }
        return;
      }
    }
    if (this.mode !== mode) return;
    const { rows, total } = got;
    const by = COLUMNS[mode][0];
    let html = '';
    let last = 0;
    for (const r of rows) {
      // The player's place further down: a gap before it
      if (last > 0 && r.rank > last + 1) html += `<li class="lr-gap" aria-hidden="true">⋯</li>`;
      last = r.rank;
      html +=
        `<li class="lr-row${r.is_me ? ' me' : ''}${r.rank <= 3 ? ` m${r.rank}` : ''}">` +
        `<span class="pos">${bigNum(r.rank)}</span>` +
        `<i class="orb" style="${orbStyle(r)}"></i>` +
        `<b class="who">${r.is_me ? t('ranking.you') : esc(r.name || 'Orb')}</b>` +
        `<span class="val">${by.cell(r)}${wavesTime(mode, r)}</span></li>`;
    }
    list.innerHTML = html || `<li class="lr-note">${t('ranking.empty')}</li>`;
    this.renderPerf(mode, rows.find((r) => r.is_me) ?? null, total);
  }

  /** "Your performance": the place, the number, the top share; a guest is asked to sign in. */
  private renderPerf(mode: RankingMode, me: RankingRow | null, total: number): void {
    const box = $('lrPerf');
    if (!this.account.signedIn) {
      box.innerHTML =
        `<p class="perf-text">${t('lobby.perfGuest')}</p>` +
        `<button type="button" class="pill-btn perf-signin" data-signin>${icon('user', 16)}${t('account.signIn')}</button>`;
      return;
    }
    if (!me) {
      box.innerHTML = `<p class="perf-text">${t(`lobby.perfNone.${mode === 'waves' || mode === 'campaign' ? mode : 'online'}` as Key)}</p>`;
      return;
    }
    const by = COLUMNS[mode][0];
    // The share of the ranked players ahead of this one (Erick, 24/10/2026: the first of 3 read "Top 34%"): the first
    // is in the top 1%, the 128th of 1,045 in the top 13%
    const share = total > 0 ? Math.min(100, Math.max(1, Math.ceil(((me.rank - 1) / total) * 100))) : 0;
    box.innerHTML =
      `<div class="perf-grid">` +
      `<span class="perf-cell"><small>${t('lobby.perfPlace')}</small><b>#${bigNum(me.rank)}</b></span>` +
      `<span class="perf-cell"><small>${t(by.head)}</small><b>${by.cell(me)}</b>${wavesTime(mode, me)}</span>` +
      (share ? `<span class="perf-cell top"><small>${t('lobby.perfOf', { n: bigNum(total) })}</small><b>${t('lobby.perfTop', { n: share })}</b></span>` : '') +
      `</div>`;
  }
}

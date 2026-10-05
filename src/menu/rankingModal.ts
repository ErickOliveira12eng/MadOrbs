// The ranking window (the start screen's "Ranking" button): the best players with an account, one
// tab per game mode (the online modes, the campaign, the waves), each with its name, player ID (tag)
// and numbers; the visitor's own row stands out (and shows below the list when further down).
// From Supabase's leaderboard function (supabase/migrations/..._waves_and_leaderboard.sql).
import { CAMPAIGN, LEVELS_PER_CHAPTER } from '../client/campaign';
import { modeShort } from '../client/modes';
import { bigNum, num, t, type Key } from '../i18n';
import type { Account, RankingMode, RankingRow } from './account';
import { icon } from './icons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODES: RankingMode[] = ['dm', 'tdm', 'ctf', 'campaign', 'waves'];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
const kd = (r: RankingRow) => num(r.stats.kills / Math.max(1, r.stats.deaths), 2);

/** Each mode's columns: header text and the cell; the first one is what the ranking goes by. */
const COLUMNS: Record<RankingMode, { head: Key; cell: (r: RankingRow) => string }[]> = {
  dm: [
    { head: 'account.kills', cell: (r) => bigNum(r.stats.kills) },
    { head: 'account.wins', cell: (r) => bigNum(r.stats.wins) },
    { head: 'account.kd', cell: kd },
    { head: 'account.matches', cell: (r) => bigNum(r.stats.matches) },
    { head: 'account.record', cell: (r) => bigNum(r.stats.best_kills) },
  ],
  tdm: [
    { head: 'account.wins', cell: (r) => bigNum(r.stats.wins) },
    { head: 'account.kills', cell: (r) => bigNum(r.stats.kills) },
    { head: 'account.kd', cell: kd },
    { head: 'account.matches', cell: (r) => bigNum(r.stats.matches) },
    { head: 'account.record', cell: (r) => bigNum(r.stats.best_kills) },
  ],
  ctf: [
    { head: 'account.captures', cell: (r) => bigNum(r.stats.captures) },
    { head: 'account.wins', cell: (r) => bigNum(r.stats.wins) },
    { head: 'account.kills', cell: (r) => bigNum(r.stats.kills) },
    { head: 'account.matches', cell: (r) => bigNum(r.stats.matches) },
  ],
  campaign: [
    { head: 'ranking.levels', cell: (r) => `${r.stats.levels}/${CAMPAIGN.length * LEVELS_PER_CHAPTER}` },
    { head: 'ranking.time', cell: (r) => clock(r.stats.seconds) },
  ],
  waves: [
    { head: 'ranking.wave', cell: (r) => bigNum(r.stats.wave) },
    { head: 'account.kills', cell: (r) => bigNum(r.stats.kills) },
    { head: 'ranking.runs', cell: (r) => bigNum(r.stats.runs) },
  ],
};

export class RankingModal {
  private readonly root = $('rankingModal');
  private mode: RankingMode = 'dm';
  /** Rankings already read, and when (read again after a minute). */
  private readonly cache = new Map<RankingMode, { at: number; rows: RankingRow[] }>();

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
    const tabs = $('rankingModes');
    for (const mode of MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = mode;
      b.setAttribute('role', 'radio');
      b.textContent = mode === 'campaign' ? t('menu.campaign') : mode === 'waves' ? t('menu.waves') : modeShort(mode);
      b.addEventListener('click', () => {
        this.mode = mode;
        void this.render();
      });
      tabs.appendChild(b);
    }
    $('rankingSave').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) return;
      this.close();
      this.onSignIn();
    });
    // Signing in (or out) changes the "you" row
    account.onChange(() => {
      this.cache.clear();
      if (this.isOpen) void this.render();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    void this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  private async render(): Promise<void> {
    const mode = this.mode;
    for (const b of $('rankingModes').querySelectorAll<HTMLElement>('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    $('rankingSave').innerHTML = this.account.signedIn
      ? ''
      : `<span>${t('ranking.signInText')}</span><button type="button" class="pill-btn">${icon('user', 16)}${t('account.signIn')}</button>`;
    $('rankingSave').hidden = this.account.signedIn;
    const body = $('rankingBody');
    let cached = this.cache.get(mode);
    if (!cached || performance.now() - cached.at > 60_000) {
      if (!cached) body.innerHTML = `<p class="ranking-note">${t('ranking.loading')}</p>`;
      try {
        cached = { at: performance.now(), rows: await this.account.ranking(mode) };
        this.cache.set(mode, cached);
      } catch (e) {
        console.warn('[ranking]', e);
        if (this.mode === mode) body.innerHTML = `<p class="ranking-note">${t('ranking.error')}</p>`;
        return;
      }
    }
    if (this.mode !== mode) return;
    const rows = cached.rows;
    if (!rows.length) {
      body.innerHTML = `<p class="ranking-note">${t('ranking.empty')}</p>`;
      return;
    }
    const cols = COLUMNS[mode];
    const grid = `grid-template-columns: 44px minmax(0, 1fr) repeat(${cols.length}, minmax(60px, 84px))`;
    let html = `<div class="rk-row head" style="${grid}"><span>#</span><span>${t('ranking.player')}</span>${cols.map((c, i) => `<span${i === 0 ? ' class="by"' : ''}>${t(c.head)}</span>`).join('')}</div>`;
    let last = 0;
    for (const r of rows) {
      // The visitor's own row further down: a gap before it
      if (r.rank > last + 1 && last > 0) html += `<div class="rk-gap">⋯</div>`;
      last = r.rank;
      const medal = r.rank <= 3 ? ` m${r.rank}` : '';
      const orb = `background: radial-gradient(circle at 35% 30%, ${r.red}, ${r.green} 55%, ${r.blue})`;
      html +=
        `<div class="rk-row${r.is_me ? ' me' : ''}" style="${grid}">` +
        `<span class="pos${medal}">${r.rank}</span>` +
        `<span class="who"><i class="orb" style="${orb}"></i><b>${esc(r.name || 'Orb')}</b><small>#${esc(r.tag)}</small>${r.is_me ? `<em>${t('ranking.you')}</em>` : ''}</span>` +
        cols.map((c, i) => `<span${i === 0 ? ' class="by"' : ''}>${c.cell(r)}</span>`).join('') +
        `</div>`;
    }
    body.innerHTML = `<div class="rk-table">${html}</div><p class="ranking-note small">${t(`ranking.note.${mode}` as Key)}</p>`;
  }
}

// The ranking window (the start screen's "See all"): the best players with an account, one tab per game mode (the
// online modes and the waves; the campaign's tab left on 26/10/2026). The first three on a podium with their real Orbs (Erick, 24/10/2026: the
// window was too plain), the rest in rows with the name, the player ID (tag) and the numbers; the visitor's own row
// stands out (and shows below the list when further down). From Supabase's leaderboard function
// (supabase/migrations/..._waves_and_leaderboard.sql).
import { crownFor, isCrownTier } from '../sim/crowns';
import { CAMPAIGN, LEVELS_PER_CHAPTER } from '../client/campaign';
import { modeShort } from '../client/modes';
import { bigNum, num, t, type Key } from '../i18n';
import type { Account, RankingMode, RankingRow } from './account';
import { icon, type IconName } from './icons';
import type { OrbStudio } from './orbStudio';
import { skinInfo } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODES: RankingMode[] = ['dm', 'tdm', 'ctf', 'waves'];
const MODE_ICON: Record<RankingMode, IconName> = { dm: 'crosshair', tdm: 'team', ctf: 'flag_fill', campaign: 'swords', waves: 'waves' };
/** The podium's Orbs, drawn this big (px; the first bigger). */
const PODIUM_ORB = [0, 104, 84, 84];

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
const kd = (r: RankingRow) => num(r.stats.kills / Math.max(1, r.stats.deaths), 2);

/** Each mode's columns: header text and the cell; the first one is what the ranking goes by. */
export const COLUMNS: Record<RankingMode, { head: Key; cell: (r: RankingRow) => string }[]> = {
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
    // Who reached it sooner (deaths add WAVES.deathPenalty each); none: from a checkpoint, or an older record
    { head: 'ranking.reachTime', cell: (r) => (typeof r.stats.time === 'number' ? clock(r.stats.time) : '—') },
    // The Power the record's run began with (the third order, after the time: the same wave with less of the Workshop)
    { head: 'ranking.power', cell: (r) => (typeof r.stats.power === 'number' ? bigNum(r.stats.power) : '—') },
    { head: 'ranking.runs', cell: (r) => bigNum(r.stats.runs) },
  ],
};

/** A row's Orb in its colours (a small ball). */
export const orbStyle = (r: RankingRow) => `background: radial-gradient(circle at 35% 30%, ${r.red}, ${r.green} 55%, ${r.blue})`;

export class RankingModal {
  private readonly root = $('rankingModal');
  private mode: RankingMode = 'dm';
  /** Rankings already read, and when (read again after a minute). */
  private readonly cache = new Map<RankingMode, { at: number; rows: RankingRow[] }>();
  /** Who they were read for (a token refreshed on coming back to the tab is the same player: kept). */
  private reader = '';
  /** What the body shows now: written again only when it changes (no flicker). */
  private shown = '';
  /** The podium's Orb pictures already drawn (skin and colours, size). */
  private readonly orbs = new Map<string, string>();

  constructor(
    private readonly account: Account,
    /** "Sign in": opens the account window. */
    private readonly onSignIn: () => void,
    private readonly studio?: OrbStudio,
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
      b.innerHTML = `${icon(MODE_ICON[mode], 16)}<span>${mode === 'campaign' ? t('menu.campaign') : mode === 'waves' ? t('menu.waves') : modeShort(mode)}</span>`;
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
      const reader = account.session?.user.id ?? '';
      if (reader === this.reader) return;
      this.reader = reader;
      this.cache.clear();
      if (this.isOpen) void this.render();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** `mode`: on that tab (the start screen's ranking column). */
  open(mode?: RankingMode): void {
    if (mode) this.mode = mode;
    this.root.hidden = false;
    void this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  private setBody(html: string): void {
    if (html === this.shown) return;
    $('rankingBody').innerHTML = this.shown = html;
    void this.drawOrbs();
  }

  /** The podium's Orbs: drawn by the OrbStudio (kept), the row's colours until then. */
  private async drawOrbs(): Promise<void> {
    if (!this.studio) return;
    for (const img of $('rankingBody').querySelectorAll<HTMLImageElement>('img[data-orb]')) {
      const [skin, red, green, blue, size, crown] = img.dataset.orb!.split('|');
      const key = img.dataset.orb!;
      let src = this.orbs.get(key);
      if (!src) {
        src = await this.studio.picture(skinInfo({ skin, red, green, blue }), Number(size) * 2, undefined, false, isCrownTier(crown) ? crown : null);
        this.orbs.set(key, src);
      }
      img.src = src;
      img.classList.add('ready');
    }
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
      // The list on screen stays (dimmed) until the new one comes; "loading" only on an empty window
      if (!cached) {
        if (!this.shown) this.setBody(`<p class="ranking-note">${t('ranking.loading')}</p>`);
        else body.classList.add('stale');
      }
      try {
        cached = { at: performance.now(), rows: await this.account.ranking(mode) };
        this.cache.set(mode, cached);
      } catch (e) {
        console.warn('[ranking]', e);
        if (this.mode === mode) {
          body.classList.remove('stale');
          this.setBody(`<p class="ranking-note">${t('ranking.error')}</p>`);
        }
        return;
      }
    }
    if (this.mode !== mode) return;
    body.classList.remove('stale');
    const rows = cached.rows;
    if (!rows.length) {
      this.setBody(`<p class="ranking-note">${t('ranking.empty')}</p>`);
      return;
    }
    const cols = COLUMNS[mode];
    const by = cols[0];
    const name = (r: RankingRow) => esc(r.name || 'Orb');
    const you = (r: RankingRow) => (r.is_me ? `<em>${t('ranking.you')}</em>` : '');

    // The podium: the second, the first (taller), the third
    const top = rows.filter((r) => r.rank <= 3);
    const step = (r: RankingRow) =>
      `<div class="rk-step p${r.rank}${r.is_me ? ' me' : ''}">` +
      `<span class="rk-medal">${r.rank}</span>` +
      `<img class="rk-orb" alt="" width="${PODIUM_ORB[r.rank]}" height="${PODIUM_ORB[r.rank]}" style="${orbStyle(r)}" data-orb="${[r.skin, r.red, r.green, r.blue, PODIUM_ORB[r.rank], (mode === 'waves' && crownFor(r.stats.wave ?? 0)) || ''].join('|')}" />` +
      `<b class="rk-name">${name(r)}</b><small class="rk-tag">#${esc(r.tag)}${you(r)}</small>` +
      `<span class="rk-big">${by.cell(r)}</span><span class="rk-label">${t(by.head)}</span>` +
      (cols[1] ? `<span class="rk-more">${t(cols[1].head)}: <b>${cols[1].cell(r)}</b>${mode === 'waves' && cols[2] ? ` · ${t(cols[2].head)}: <b>${cols[2].cell(r)}</b>` : ''}</span>` : '') +
      `</div>`;
    const order = [2, 1, 3].map((n) => top.find((r) => r.rank === n)).filter((r): r is RankingRow => !!r);
    const podium = `<div class="rk-podium n${order.length}">${order.map(step).join('')}</div>`;

    // The rest: rows (the visitor's own further down after a gap)
    const rest = rows.filter((r) => r.rank > 3);
    // A phone: the mode's first two numbers (what it ranks by and the next), the name keeps its room
    const narrow = matchMedia('(max-width: 520px)').matches;
    const shownCols = narrow ? cols.slice(0, 2) : cols;
    const grid = `grid-template-columns: ${narrow ? 34 : 44}px minmax(0, 1fr) repeat(${shownCols.length}, minmax(${narrow ? 46 : 60}px, ${narrow ? 66 : 84}px))`;
    let list = '';
    if (rest.length) {
      list = `<div class="rk-row head" style="${grid}"><span>#</span><span>${t('ranking.player')}</span>${shownCols.map((c, i) => `<span${i === 0 ? ' class="by"' : ''}>${t(c.head)}</span>`).join('')}</div>`;
      let last = 3;
      for (const r of rest) {
        if (r.rank > last + 1) list += `<div class="rk-gap">⋯</div>`;
        last = r.rank;
        list +=
          `<div class="rk-row${r.is_me ? ' me' : ''}" style="${grid}">` +
          `<span class="pos">${r.rank}</span>` +
          `<span class="who"><i class="orb" style="${orbStyle(r)}"></i><b>${name(r)}</b><small>#${esc(r.tag)}</small>${you(r)}</span>` +
          shownCols.map((c, i) => `<span${i === 0 ? ' class="by"' : ''}>${c.cell(r)}</span>`).join('') +
          `</div>`;
      }
      list = `<div class="rk-table">${list}</div>`;
    }
    // The waves' time: a record from before 23/10/2026 has none (until that wave is reached again)
    const noTime = mode === 'waves' && rows.some((r) => typeof r.stats.time !== 'number') ? `<p class="ranking-note small">${t('ranking.noTime')}</p>` : '';
    this.setBody(`${podium}${list}<p class="ranking-note small">${t(`ranking.note.${mode}` as Key)}</p>${noTime}`);
  }
}

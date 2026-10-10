// The campaign window: the chapters (one weapon each) as tabs on top; under them the chosen chapter's
// weapon in the spotlight (its stars as a ring, its boss) and its levels as rows: the bots, the stars,
// the best time (or the times for the stars), and a button. Locked levels wait for the one before.
import { CAMPAIGN, chapterStars, isUnlocked, loadProgress, starsFor, LEVELS_PER_CHAPTER, type CampaignLevel } from '../client/campaign';
import { t } from '../i18n';
import type { SkinInfo } from '../sim/player';
import type { Account } from './account';
import { icon } from './icons';
import type { OrbStudio } from './orbStudio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
const stars = (n: number) => [1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('');
const bots = (n: number) => `<span class="bots" title="${n === 1 ? t('campaign.oneBot') : t('campaign.bots', { n })}">${'<i></i>'.repeat(n)}</span>`;

/** The bosses' look in the game: the eye (skin14) in the red team's colours. */
export const BOSS_SKIN: SkinInfo = { skin: 'skin14', redDecal: [1, 0.5, 0.5], greenDecal: [1, 0, 0], blueDecal: [0.5, 0, 0] };

export class CampaignModal {
  private readonly root = $('campaignModal');
  private chapter = 1;
  /** The boss's picture, drawn once by the orb studio. */
  private bossPic = '';

  constructor(
    private readonly account: Account,
    private readonly studio: OrbStudio,
    private readonly onPlay: (level: CampaignLevel) => void,
    /** "Sign in": opens the account window. */
    private readonly onSignIn: () => void,
  ) {
    account.onChange(() => {
      if (this.isOpen) this.render();
    });
    $('campSave').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) return;
      this.close();
      this.onSignIn();
    });
    for (const el of this.root.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    $('campChapters').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-chapter]');
      if (!b) return;
      this.chapter = Number(b.dataset.chapter);
      this.render();
    });
    $('campLevels').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-level]');
      if (!b || b.disabled) return;
      const level = CAMPAIGN[this.chapter - 1].levels[Number(b.dataset.level) - 1];
      this.close();
      this.onPlay(level);
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens on the chapter of `level` (back from a level), or on the furthest one unlocked. */
  open(level?: CampaignLevel): void {
    const progress = loadProgress();
    if (level) this.chapter = level.chapter.n;
    else {
      this.chapter = 1;
      for (const c of CAMPAIGN) if (isUnlocked(c.levels[0], progress)) this.chapter = c.chapter.n;
    }
    this.root.hidden = false;
    this.render();
    if (!this.bossPic)
      void this.studio.picture(BOSS_SKIN, 96, undefined, true).then((src) => {
        this.bossPic = src;
        if (this.isOpen) this.render();
      });
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const progress = loadProgress();
    const total = LEVELS_PER_CHAPTER * 3;

    // The chapters: tabs with the weapon, the stars won or a lock
    $('campChapters').innerHTML = CAMPAIGN.map(({ chapter, levels }) => {
      const open = isUnlocked(levels[0], progress);
      return (
        `<button type="button" class="camp-ch${chapter.n === this.chapter ? ' on' : ''}${open ? '' : ' locked'}" data-chapter="${chapter.n}" title="${t(`w.${chapter.weaponKey}.name`)}">` +
        `<img src="/guia/${chapter.picture}" alt="" /><small>${t('campaign.chapterShort', { n: chapter.n })}</small>` +
        (open ? `<em>${chapterStars(chapter.n, progress)}/${total} ★</em>` : `<em class="lock">${icon('lock', 13)}</em>`) +
        `</button>`
      );
    }).join('');

    // Where the progress is kept: this browser only, or the account too
    $('campSave').innerHTML = this.account.signedIn
      ? `<span class="ok">${icon('check', 16)}${t('campaign.savedAccount')}</span>`
      : `<span>${t('campaign.savedLocal')}</span><button type="button" class="pill-btn">${icon('user', 16)}${t('account.signIn')}</button>`;

    // The chapter's weapon in the spotlight: its stars as a ring, its boss
    const { chapter, levels } = CAMPAIGN[this.chapter - 1];
    const chapterOpen = isUnlocked(levels[0], progress);
    const got = chapterStars(chapter.n, progress);
    const boss = t(`campaign.boss.${chapter.weaponKey}`);
    const face = this.bossPic ? `<img src="${this.bossPic}" alt="" />` : '<i class="face"></i>';
    $('campHead').innerHTML =
      `<small>${t('campaign.chapter', { n: chapter.n })}</small><b>${t(`w.${chapter.weaponKey}.name`)}</b>` +
      `<img class="weapon" src="/guia/${chapter.picture}" alt="" />` +
      `<div class="ring" style="--p:${(got / total) * 360}deg"><span>${got}/${total} ★</span></div>` +
      (chapterOpen
        ? `<div class="boss-line">${face}${t('campaign.bossOf', { name: boss })}</div>`
        : `<p class="note">${icon('lock', 15)}${t('campaign.lockedChapter', { n: chapter.n - 1 })}</p>`);

    // The levels: the next one to win stands out
    const next = levels.find((l) => isUnlocked(l, progress) && progress[l.id] === undefined);
    $('campLevels').innerHTML = levels
      .map((l) => {
        const open = isUnlocked(l, progress);
        const best = progress[l.id];
        const won = best !== undefined;
        const cls = `camp-lv${l.boss ? ' boss' : ''}${won ? ' won' : ''}${l === next ? ' next' : ''}`;
        const action = !open
          ? `<span class="lock">${icon('lock', 15)}${l.boss ? t('campaign.beatLevel', { n: l.n - 1 }) : t('campaign.locked')}</span>`
          : won
            ? `<span class="act">${t('campaign.retry')}</span>`
            : `<span class="act go">${icon('play', 15)}${t('campaign.playLevel')}</span>`;
        const info = won
          ? `<small>${t('campaign.best', { time: clock(best) })}</small>`
          : `<small>${t('campaign.thresholds', { three: clock(l.stars3), two: clock(l.stars2) })}</small>`;
        if (l.boss)
          return (
            `<button type="button" class="${cls}" data-level="${l.n}"${open ? '' : ' disabled'}>` +
            `<b class="n">${t('campaign.boss')}</b>` +
            `<span class="who">${face}<span><b>${boss}</b><small>${t('campaign.bossShort')}</small></span></span>` +
            (won ? `<span class="stars">${stars(starsFor(l, best))}</span>` : '') +
            `${action}</button>`
          );
        return (
          `<button type="button" class="${cls}" data-level="${l.n}"${open ? '' : ' disabled'}>` +
          `<b class="n">${t('campaign.level', { n: l.n })}</b>${bots(l.bots)}` +
          `<span class="stars">${stars(won ? starsFor(l, best) : 0)}</span>${open ? info : '<small></small>'}${action}</button>`
        );
      })
      .join('');
  }
}

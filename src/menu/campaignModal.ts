// The campaign window: the chapters (one weapon each) on the left, the chosen chapter's levels on the
// right, with their stars, best time and the times for the stars. Locked levels wait for the one before.
import { CAMPAIGN, chapterStars, isUnlocked, loadProgress, starsFor, LEVELS_PER_CHAPTER, type CampaignLevel } from '../client/campaign';
import { t } from '../i18n';
import type { Account } from './account';
import { icon } from './icons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
const stars = (n: number) => [1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('');

export class CampaignModal {
  private readonly root = $('campaignModal');
  private chapter = 1;

  constructor(
    private readonly account: Account,
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
  }

  close(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const progress = loadProgress();
    $('campChapters').innerHTML = CAMPAIGN.map(({ chapter, levels }) => {
      const open = isUnlocked(levels[0], progress);
      const got = chapterStars(chapter.n, progress);
      return (
        `<button type="button" class="camp-ch${chapter.n === this.chapter ? ' on' : ''}${open ? '' : ' locked'}" data-chapter="${chapter.n}">` +
        `<img src="/guia/${chapter.picture}" alt="" /><span><small>${t('campaign.chapter', { n: chapter.n })}</small><b>${t(`w.${chapter.weaponKey}.name`)}</b></span>` +
        (open ? `<em>${got}/${LEVELS_PER_CHAPTER * 3} ★</em>` : `<em class="lock">${icon('lock', 14)}</em>`) +
        `</button>`
      );
    }).join('');

    // Where the progress is kept: this browser only, or the account too
    $('campSave').innerHTML = this.account.signedIn
      ? `<span class="ok">${icon('check', 16)}${t('campaign.savedAccount')}</span>`
      : `<span>${t('campaign.savedLocal')}</span><button type="button" class="pill-btn">${icon('user', 16)}${t('account.signIn')}</button>`;

    const { chapter, levels } = CAMPAIGN[this.chapter - 1];
    const chapterOpen = isUnlocked(levels[0], progress);
    $('campHead').innerHTML =
      `<img src="/guia/${chapter.picture}" alt="" /><div><small>${t('campaign.chapter', { n: chapter.n })}</small><b>${t(`w.${chapter.weaponKey}.name`)}</b>` +
      (chapterOpen ? '' : `<span class="note">${t('campaign.lockedChapter', { n: chapter.n - 1 })}</span>`) +
      `</div>`;
    $('campLevels').innerHTML = levels
      .map((l) => {
        const open = isUnlocked(l, progress);
        const best = progress[l.id];
        const won = best !== undefined;
        const title = l.boss ? t('campaign.boss') : t('campaign.level', { n: l.n });
        const what = l.boss ? t(`campaign.boss.${chapter.weaponKey}`) : t('campaign.bots', { n: l.bots });
        return (
          `<button type="button" class="camp-lv${l.boss ? ' boss' : ''}${won ? ' won' : ''}" data-level="${l.n}"${open ? '' : ' disabled'}>` +
          `<span class="n">${title}</span><b>${what}</b>` +
          (open
            ? `<span class="stars">${stars(won ? starsFor(l, best) : 0)}</span>` +
              `<small>${won ? t('campaign.best', { time: clock(best) }) : t('campaign.thresholds', { three: clock(l.stars3), two: clock(l.stars2) })}</small>`
            : `<span class="lock">${icon('lock', 18)}<small>${t('campaign.locked')}</small></span>`) +
          (l.boss && open ? `<small class="hint">${t('campaign.bossHint')}</small>` : '') +
          `</button>`
        );
      })
      .join('');
  }
}

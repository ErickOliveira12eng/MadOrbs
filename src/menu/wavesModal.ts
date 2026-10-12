// The waves' Workshop (mockup approved by Erick, 11/10/2026), opened by the start screen's "Waves"
// card and by the end of a run: the Cores to spend, the permanent upgrades as cards (level, what the
// next one does, its price), and on the side what the run starts with: the wave (the first, or a
// checkpoint reached), the weapon (the SMG, or one a milestone gave), the milestones' track, PLAY.
import { prizeText, weaponLook } from '../client/wavesPrize';
import { loadWavesRecord, WAVES } from '../client/waves';
import {
  BREATHER,
  MILESTONES,
  UPGRADES,
  UPGRADE_STEP,
  DAILY_CORES,
  balance,
  buy,
  checkpoints,
  claimDaily,
  dailyState,
  headStartPowers,
  loadProgress,
  nextCost,
  nextMilestone,
  saveProgress,
  startWeapons,
  type Upgrade,
  type UpgradeID,
  type WavesProgress,
} from '../client/wavesProgress';
import { track } from '../client/analytics';
import { bigNum, t } from '../i18n';
import type { SkinInfo } from '../sim/player';
import type { Account } from './account';
import { icon, type IconName } from './icons';
import type { OrbStudio } from './orbStudio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const UPGRADE_ICON: Record<UpgradeID, IconName> = {
  life: 'heart',
  armor: 'shield',
  drops: 'medkit',
  damage: 'crosshair',
  fire: 'zap',
  speed: 'gauge',
  lives: 'orbs',
  grenades: 'bomb',
  luck: 'package',
  breather: 'heartPulse',
  secondWind: 'rotate',
};

/** What an upgrade gives at a level, as the card says it. */
function upgradeValue(id: UpgradeID, level: number): string {
  const pct = (x: number) => `+${Math.round(x * 100)}%`;
  switch (id) {
    case 'life':
    case 'damage':
    case 'fire':
    case 'speed':
    case 'luck':
      return pct(UPGRADE_STEP[id] * level);
    case 'armor':
      return level ? `-${Math.round(UPGRADE_STEP.armor * level * 100)}%` : '0%';
    case 'drops':
      return `${Math.round((WAVES.lifePackChance + UPGRADE_STEP.drops * level) * 100)}%`;
    case 'lives':
      return String(WAVES.lives + level);
    case 'grenades':
      return String(2 + level);
    case 'breather':
      return `${Math.round(BREATHER[level] * 100)}%`;
    case 'secondWind':
      return String(level);
  }
}

/** A Core, the waves' currency. */
export const coreIcon = (size = 18) => `<span class="core-ico">${icon('core', size)}</span>`;

export class WavesModal {
  private readonly root = $('wavesModal');
  /** The exclusive Orbs' pictures in the player's colours, drawn once each. */
  private readonly orbPics = new Map<string, string>();

  constructor(
    private readonly account: Account,
    private readonly studio: OrbStudio,
    /** The player's Orb colours (the exclusive Orbs are drawn in them). */
    private readonly colours: () => SkinInfo,
    private readonly onPlay: () => void,
    /** "Sign in": opens the account window. */
    private readonly onSignIn: () => void,
    /** The Cores or the levels changed (the start screen's card). */
    private readonly onChange: () => void,
  ) {
    account.onChange(() => {
      if (this.isOpen) this.render();
    });
    for (const el of this.root.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
    $('wvUpgrades').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (!b || b.disabled) return;
      const id = b.dataset.buy as UpgradeID;
      const p = buy(id);
      if (!p) return;
      track('waves_upgrade', { upgrade: id, level: p.levels[id] });
      void this.account.saveWavesProgress();
      this.render();
      this.onChange();
      // The card that was bought flashes
      $('wvUpgrades').querySelector(`[data-up="${id}"]`)?.classList.add('bought');
    });
    $('wvStarts').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-start]');
      if (!b || b.disabled) return;
      this.choose({ startWave: Number(b.dataset.start) });
    });
    $('wvWeapons').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-weapon]');
      if (!b || b.disabled) return;
      this.choose({ startWeapon: Number(b.dataset.weapon) });
    });
    $('wvDaily').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-claim]')) return;
      const got = claimDaily();
      if (!got) return;
      track('daily_reward', { day: got.day, cores: got.cores });
      void this.account.saveWavesProgress();
      this.render();
      this.onChange();
      $('wvDaily').classList.add('claimed-now');
      $('wvCores').classList.add('bought');
    });
    $('wvPlay').addEventListener('click', () => {
      this.close();
      this.onPlay();
    });
    $('wvSave').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button')) return;
      this.close();
      this.onSignIn();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.render();
    // The exclusive Orbs, in the player's colours
    const colours = this.colours();
    for (const m of MILESTONES) {
      if (!('skin' in m)) continue;
      const key = `${m.skin}|${colours.redDecal}|${colours.greenDecal}|${colours.blueDecal}`;
      if (this.orbPics.has(key)) continue;
      void this.studio.picture({ ...colours, skin: m.skin }, 96).then((src) => {
        this.orbPics.set(key, src);
        if (this.isOpen) this.renderTrack();
      });
    }
  }

  close(): void {
    this.root.hidden = true;
  }

  private choose(change: Partial<WavesProgress>): void {
    const p = { ...loadProgress(), ...change };
    saveProgress(p);
    this.render();
  }

  /**
   * The choices of the last run, kept when still allowed (a checkpoint or a weapon from the record):
   * else the first wave and the SMG.
   */
  static startChoice(): { startWave: number; startWeapon: number } {
    const record = loadWavesRecord()?.wave ?? 0;
    const p = loadProgress();
    return {
      startWave: checkpoints(record).includes(p.startWave) ? p.startWave : 1,
      startWeapon: startWeapons(record).includes(p.startWeapon) ? p.startWeapon : startWeapons(record)[0],
    };
  }

  private render(): void {
    const p = loadProgress();
    const record = loadWavesRecord()?.wave ?? 0;
    const cash = balance(p);
    const { startWave, startWeapon } = WavesModal.startChoice();

    $('wvCores').innerHTML = `${coreIcon(26)}<b>${bigNum(cash)}</b><span>${t('workshop.cores')}</span>`;
    $('wvRecord').innerHTML = record ? `${icon('trophy', 16)}${t('waves.record', { n: record })}` : '';
    $('wvRecord').hidden = !record;

    // The upgrade cards
    $('wvUpgrades').innerHTML = UPGRADES.map((u) => this.card(u, p, cash)).join('');

    // The wave to start from: the first, the last two checkpoints reached, the next one (locked)
    const reached = checkpoints(record).slice(1).slice(-2);
    const next = (Math.floor(record / 10) + 1) * 10;
    $('wvStarts').innerHTML =
      [1, ...reached]
        .map(
          (w) =>
            `<button type="button" class="wv-opt${w === startWave ? ' on' : ''}" data-start="${w}"><b>${w}</b><small>${w === 1 ? t('workshop.fromStart') : t('workshop.unlocked')}</small></button>`,
        )
        .join('') + `<button type="button" class="wv-opt locked" disabled><b>${icon('lock', 14)}${next}</b><small>${t('workshop.reach', { n: next })}</small></button>`;
    $('wvStartNote').textContent =
      startWave > 1 ? t('workshop.startFrom', { n: startWave, p: headStartPowers(startWave) }) : record >= 10 ? t('workshop.startHint') : t('workshop.startLocked');

    // The weapons to start with: the SMG and the milestones' (locked until reached)
    const weapons = [startWeapons(0)[0], ...MILESTONES.flatMap((m) => ('weapon' in m ? [m] : []))];
    $('wvWeapons').innerHTML = weapons
      .map((w) => {
        const id = typeof w === 'number' ? w : w.weapon;
        const at = typeof w === 'number' ? 0 : w.wave;
        const open = record >= at;
        const look = weaponLook(id);
        return (
          `<button type="button" class="wv-opt wv-weapon${open && id === startWeapon ? ' on' : ''}${open ? '' : ' locked'}" data-weapon="${id}"${open ? '' : ' disabled'} title="${look.name}">` +
          `<img src="${look.picture}" alt="" /><small>${open ? look.name : t('workshop.atWave', { n: at })}</small></button>`
        );
      })
      .join('');

    this.renderTrack();
    this.renderDaily(p);
    $('wvPlay').innerHTML = `${icon('play', 22)}${t('workshop.play', { n: startWave })}`;

    // Where the progress is kept
    $('wvSave').innerHTML = this.account.signedIn
      ? `<span class="ok">${icon('check', 16)}${t('workshop.savedAccount')}</span>`
      : `<span>${t('workshop.savedLocal')}</span><button type="button" class="pill-btn">${icon('user', 16)}${t('account.signIn')}</button>`;
  }

  private card(u: Upgrade, p: WavesProgress, cash: number): string {
    const level = p.levels[u.id];
    const max = u.costs.length;
    const cost = nextCost(u, p.levels);
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
    const value =
      cost === null
        ? `<b>${upgradeValue(u.id, level)}</b>`
        : `${upgradeValue(u.id, level)} <span class="arrow">→</span> <b>${upgradeValue(u.id, level + 1)}</b>`;
    const action =
      cost === null
        ? `<span class="wv-max">${t('workshop.max')}</span>`
        : `<button type="button" class="wv-buy" data-buy="${u.id}"${cost > cash ? ' disabled' : ''}>${coreIcon(18)}${bigNum(cost)}${cost > cash ? `<small>${t('workshop.short', { n: bigNum(cost - cash) })}</small>` : ''}</button>`;
    return (
      `<div class="wv-card ${u.tone}${cost === null ? ' maxed' : ''}" data-up="${u.id}">` +
      `<div class="wv-card-head"><span class="wv-ico">${icon(UPGRADE_ICON[u.id], 22)}</span>` +
      `<span><b>${t(`up.${u.id}`)}</b><small>${t('workshop.level', { n: level, max })}</small></span></div>` +
      `<div class="wv-pips">${pips}</div>` +
      `<p class="wv-desc">${t(`up.${u.id}.desc`)}</p>` +
      `<p class="wv-value">${value}</p>${action}</div>`
    );
  }

  /** The daily reward: the week's seven days (taken, today, to come) and the button, or "come back tomorrow". */
  private renderDaily(p: WavesProgress): void {
    const d = dailyState(p);
    const days = DAILY_CORES.map((cores, i) => {
      const n = i + 1;
      const cls = n < d.day || (n === d.day && !d.ready) ? 'got' : n === d.day ? 'now' : '';
      return `<span class="wd-day ${cls}" title="${t('daily.day', { n })}"><b>${cores}</b></span>`;
    }).join('');
    $('wvDaily').classList.remove('claimed-now');
    $('wvDaily').innerHTML =
      `<div class="wd-head"><span class="wd-ico">${icon('gift', 20)}</span><span><b>${t('daily.title')}</b><small>${t('daily.day', { n: d.day })} · ${t('daily.hint')}</small></span></div>` +
      `<div class="wd-row"><div class="wd-days">${days}</div>` +
      (d.ready
        ? `<button type="button" class="wd-claim" data-claim>${coreIcon(16)}+${d.cores}</button>`
        : `<span class="wd-done">${icon('check', 15)}${t('daily.claimed')}</span>`) +
      `</div>`;
  }

  /** The milestones: a track with each prize, the record's progress on it. */
  private renderTrack(): void {
    const record = loadWavesRecord()?.wave ?? 0;
    const colours = this.colours();
    const next = nextMilestone(record);
    $('wvNext').textContent = next ? t('workshop.nextAt', { n: next.wave }) : t('workshop.allDone');
    // The bar: whole steps for the milestones passed, a share of the next step
    const i = MILESTONES.findIndex((m) => m.wave > record);
    const fill =
      i < 0
        ? 1
        : i === 0
          ? 0
          : (i - 1 + (record - MILESTONES[i - 1].wave) / (MILESTONES[i].wave - MILESTONES[i - 1].wave)) / (MILESTONES.length - 1);
    $('wvTrack').innerHTML =
      `<span class="wv-rail"><i style="width:${Math.round(fill * 100)}%"></i></span>` +
      MILESTONES.map((m) => {
        const got = record >= m.wave;
        let art: string;
        if ('weapon' in m) art = `<img class="w" src="${weaponLook(m.weapon).picture}" alt="" />`;
        else {
          const src = this.orbPics.get(`${m.skin}|${colours.redDecal}|${colours.greenDecal}|${colours.blueDecal}`);
          art = src ? `<img class="o" src="${src}" alt="" />` : '<i class="o"></i>';
        }
        return `<span class="wv-node${got ? ' got' : ''}" title="${prizeText(m)}"><span class="dot">${art}</span><b>${m.wave}</b></span>`;
      }).join('');
  }
}

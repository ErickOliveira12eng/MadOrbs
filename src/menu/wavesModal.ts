// The waves' Workshop (proposal A approved by Erick, 12/10/2026), opened by the start screen's "Waves"
// card and by the end of a run. Three columns: the upgrades as a short list by kind (attack, defence,
// survival; abilities and limits in the other tab), the chosen one in detail (what the next level does,
// the levels after it, the button that buys it), and what the run starts with: the wave (the first, or a
// checkpoint reached), the weapon (the SMG, or one a milestone gave), the daily reward, PLAY. Under them,
// the milestones' track.
import { orbName, prizeText, weaponLook } from '../client/wavesPrize';
import { loadWavesRecord, WAVES } from '../client/waves';
import {
  BREATHER,
  CHECKPOINT,
  MILESTONES,
  UPGRADES,
  UPGRADE_STEP,
  BARRIER_SIZE,
  DASH_COOLDOWN,
  DAILY_CORES,
  PERM_CAP_BASE,
  PERM_CAP_STEP,
  SHOCK_COOLDOWN,
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
  type Milestone,
  type Upgrade,
  type UpgradeGroup,
  type UpgradeID,
  type WavesProgress,
} from '../client/wavesProgress';
import { track } from '../client/analytics';
import { bigNum, num, t } from '../i18n';
import type { SkinInfo } from '../sim/player';
import type { Account } from './account';
import { icon, type IconName } from './icons';
import type { OrbStudio } from './orbStudio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The testers' extra start (DEBUG_USER_IDS): right before the first boss, to try its cards. */
const TEST_START = 9;

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
  cap: 'chevronsUp',
  dash: 'wind',
  barrier: 'shieldHalf',
  shock: 'radio',
  reroll: 'shuffle',
};

/** The list's kinds, in order, each in its tab. */
const GROUPS: { id: UpgradeGroup; tab: Tab }[] = [
  { id: 'attack', tab: 'stats' },
  { id: 'defense', tab: 'stats' },
  { id: 'survival', tab: 'stats' },
  { id: 'abilities', tab: 'skills' },
  { id: 'cards', tab: 'skills' },
  { id: 'limits', tab: 'skills' },
];

type Tab = 'stats' | 'skills';
const tabOf = (u: Upgrade): Tab => GROUPS.find((g) => g.id === u.group)!.tab;

/** How many later levels the detail lists under the next one. */
const LATER_LEVELS = 3;

/**
 * WavesModal.fit: the window's full width (its three columns), the scale it may shrink to, and the screen
 * width below which it is a phone's single column instead.
 */
const FIT_WIDTH = 1200;
const FIT_MIN = 0.6;
const FIT_MIN_WIDTH = 700;

/** What an upgrade gives at a level, as the Workshop says it. */
function upgradeValue(id: UpgradeID, level: number): string {
  const pct = (x: number) => `+${Math.round(x * 100)}%`;
  switch (id) {
    case 'life':
      return String(Math.round(100 * (1 + UPGRADE_STEP.life * level)));
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
    case 'cap':
      return String(PERM_CAP_BASE + PERM_CAP_STEP * level);
    case 'dash':
      return level ? `${num(DASH_COOLDOWN[level])} s` : '—';
    case 'shock':
      return level ? `${num(SHOCK_COOLDOWN[level])} s` : '—';
    case 'barrier':
      return `${Math.round(BARRIER_SIZE[level] * 100)}%`;
    case 'reroll':
      return String(level);
  }
}

/** A milestone's prize in a couple of words (the track's "next" line). */
const prizeName = (m: Milestone): string => ('weapon' in m ? weaponLook(m.weapon).name : t('workshop.orbNamed', { name: orbName(m.skin) }));

/** A Core, the waves' currency. */
export const coreIcon = (size = 18) => `<span class="core-ico">${icon('core', size)}</span>`;

export class WavesModal {
  private readonly root = $('wavesModal');
  /** The tab shown: the numbers, or what only the Workshop gives (the run's limits, the abilities). */
  private tab: Tab = 'stats';
  /** The upgrade shown in detail (null: the first one worth buying, when the window opens). */
  private selected: UpgradeID | null = null;
  /** The weapon the picker shows, maybe a locked one (null: the run's starting weapon). */
  private weaponView: number | null = null;
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
    window.addEventListener('resize', () => {
      if (this.isOpen) this.fit();
    });
    $('wvUpgrades').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
      if (!b) return;
      this.selected = b.dataset.pick as UpgradeID;
      this.render();
    });
    $('wvDetail').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (!b || b.disabled) return;
      const id = b.dataset.buy as UpgradeID;
      const p = buy(id);
      if (!p) return;
      track('waves_upgrade', { upgrade: id, level: p.levels[id] });
      void this.account.saveWavesProgress();
      this.render();
      this.onChange();
      // What was bought flashes, and the Cores with it
      $('wvDetail').classList.add('bought');
      $('wvUpgrades').querySelector(`[data-pick="${id}"]`)?.classList.add('bought');
      $('wvCores').classList.add('bought');
    });
    $('wvTabs').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab === 'skills' ? 'skills' : 'stats';
      this.selected = null;
      this.render();
    });
    $('wvStarts').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-start]');
      if (!b || b.disabled) return;
      this.choose({ startWave: Number(b.dataset.start) });
    });
    $('wvWeapons').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
      if (!b) return;
      // A locked one can be looked at; the run then starts with the SMG
      const id = Number(b.dataset.view);
      this.weaponView = id;
      const open = startWeapons(loadWavesRecord()?.wave ?? 0);
      this.choose({ startWeapon: open.includes(id) ? id : open[0] });
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
    this.selected = null;
    this.weaponView = null;
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
  static startChoice(tester = false): { startWave: number; startWeapon: number } {
    const record = loadWavesRecord()?.wave ?? 0;
    const p = loadProgress();
    return {
      // Testers (DEBUG_USER_IDS) may also start on wave 9: the boss and its cards in a minute
      startWave: checkpoints(record).includes(p.startWave) || (tester && p.startWave === TEST_START) ? p.startWave : 1,
      startWeapon: startWeapons(record).includes(p.startWeapon) ? p.startWeapon : startWeapons(record)[0],
    };
  }

  private render(): void {
    const p = loadProgress();
    const record = loadWavesRecord()?.wave ?? 0;
    const cash = balance(p);
    const tester = this.account.debugTools.zoom;
    const { startWave, startWeapon } = WavesModal.startChoice(tester);

    for (const id of ['wvDetail', 'wvCores', 'wvDaily']) $(id).classList.remove('bought', 'claimed-now');
    $('wvCores').innerHTML = `${coreIcon(26)}<b>${bigNum(cash)}</b><span>${t('workshop.cores')}</span>`;
    $('wvRecord').innerHTML = record ? `${icon('trophy', 16)}${t('waves.record', { n: record })}` : '';
    $('wvRecord').hidden = !record;

    this.renderList(p, cash);
    this.renderDetail(p, cash);

    // The wave to start from: the first, the last two checkpoints open, the next one (locked: the wave that opens it)
    const open = checkpoints(record);
    const reached = open.slice(1).slice(-2);
    const next = open.length * CHECKPOINT;
    $('wvStarts').innerHTML =
      [1, ...(tester ? [TEST_START] : []), ...reached]
        .map(
          (w) =>
            `<button type="button" class="wv-opt${w === startWave ? ' on' : ''}" data-start="${w}"><b>${w}</b><small>${w === 1 ? t('workshop.fromStart') : w === TEST_START && tester ? t('workshop.testStart') : t('workshop.unlocked')}</small></button>`,
        )
        .join('') + `<button type="button" class="wv-opt locked" disabled title="${t('workshop.reach', { n: next + CHECKPOINT })}"><b>${icon('lock', 13)}${next}</b><small>${t('workshop.locked')}</small></button>`;
    $('wvStartNote').textContent =
      startWave > 1 ? t('workshop.startFrom', { n: startWave, p: headStartPowers(startWave) }) : open.length > 1 ? t('workshop.startHint') : t('workshop.startLocked');

    this.renderWeapon(record, startWeapon);
    this.renderTrack();
    this.renderDaily(p);
    $('wvPlay').innerHTML = `${icon('play', 22)}${t('workshop.play', { n: startWave })}`;

    // Where the progress is kept
    $('wvSave').innerHTML = this.account.signedIn
      ? `<span class="ok">${icon('check', 14)}${t('workshop.savedAccount')}</span>`
      : `<span title="${t('workshop.savedLocal')}">${t('workshop.savedLocalShort')}</span><button type="button" class="wv-signin">${icon('user', 14)}${t('account.signIn')}</button>`;
    this.fit();
  }

  /**
   * Smaller screens (an 18" monitor under the browser's bars, a small laptop): the window keeps its three
   * columns at their full width and shrinks to fit the screen, down to FIT_MIN, instead of being cut at the
   * bottom; past that it scrolls. Phones get their one column instead (menu.css), scrolling.
   */
  private fit(): void {
    const card = this.root.querySelector<HTMLElement>('.waves-modal')!;
    card.style.zoom = '';
    card.style.maxHeight = '';
    card.style.width = '';
    if (this.root.hidden || window.innerWidth < FIT_MIN_WIDTH) return;
    const pad = getComputedStyle(this.root);
    const roomW = window.innerWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    const roomH = window.innerHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom);
    if (roomW < FIT_WIDTH) card.style.width = `${FIT_WIDTH}px`;
    // (a pixel spare: the scaled sizes round, and a 1 px scrollbar would show)
    const need = card.scrollHeight + 1;
    const k = Math.min(1, roomW / FIT_WIDTH, roomH / need);
    if (k >= 1) {
      card.style.width = '';
      return;
    }
    const zoom = Math.max(FIT_MIN, k);
    card.style.zoom = String(zoom);
    card.style.maxHeight = `${roomH / zoom}px`;
    card.style.width = `${Math.min(FIT_WIDTH, roomW / zoom)}px`;
  }

  /** The list: the tab's upgrades by kind, each with its level and the price of the next one. */
  private renderList(p: WavesProgress, cash: number): void {
    const affordable = (tab: Tab) => UPGRADES.filter((u) => tabOf(u) === tab && (nextCost(u, p.levels) ?? Infinity) <= cash).length;
    for (const b of $('wvTabs').querySelectorAll<HTMLElement>('[data-tab]')) {
      const tab = b.dataset.tab as Tab;
      b.classList.toggle('on', tab === this.tab);
      b.setAttribute('aria-selected', String(tab === this.tab));
      const n = affordable(tab);
      b.querySelector('.n')!.textContent = n ? String(n) : '';
    }
    const shown = UPGRADES.filter((u) => tabOf(u) === this.tab);
    // Nothing chosen yet (or another tab's): the first one the Cores pay for, else the first
    if (!this.selected || !shown.some((u) => u.id === this.selected)) {
      this.selected = (shown.find((u) => (nextCost(u, p.levels) ?? Infinity) <= cash) ?? shown[0]).id;
    }
    $('wvUpgrades').innerHTML = GROUPS.filter((g) => g.tab === this.tab)
      .map((g) => {
        const rows = shown.filter((u) => u.group === g.id).map((u) => this.row(u, p, cash));
        return `<div class="wv-group ${g.id}"><h3>${t(`workshop.group.${g.id}`)}</h3>${rows.join('')}</div>`;
      })
      .join('');
  }

  private row(u: Upgrade, p: WavesProgress, cash: number): string {
    const level = p.levels[u.id];
    const cost = nextCost(u, p.levels);
    const pips =
      u.costs.length > 5 ? `<span class="wv-lvtext">${level}/${u.costs.length}</span>` : u.costs.map((_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
    const price =
      cost === null ? `<span class="wv-price max">${t('workshop.max')}</span>` : `<span class="wv-price${cost > cash ? ' off' : ''}">${coreIcon(12)}${bigNum(cost)}</span>`;
    return (
      `<button type="button" class="wv-row ${u.group}${u.id === this.selected ? ' on' : ''}" data-pick="${u.id}" title="${t(`up.${u.id}.desc`)}">` +
      `<span class="wv-ico">${icon(UPGRADE_ICON[u.id], 16)}</span><span class="wv-name">${t(`up.${u.id}`)}</span>` +
      `<span class="wv-pips">${pips}</span>${price}</button>`
    );
  }

  /** The chosen upgrade: what it does now and at the next level, the levels after, the button. */
  private renderDetail(p: WavesProgress, cash: number): void {
    const u = UPGRADES.find((x) => x.id === this.selected)!;
    const level = p.levels[u.id];
    const max = u.costs.length;
    const cost = nextCost(u, p.levels);
    const bars = u.costs.map((_, i) => `<i class="${i < level ? 'on' : i === level ? 'next' : ''}"></i>`).join('');
    let body: string;
    if (cost === null) {
      body =
        `<div class="wv-compare maxed"><div class="wv-now on"><small>${t('workshop.maxed')}</small><b>${upgradeValue(u.id, level)}</b></div></div>` +
        `<div class="wv-buyzone"><span class="wv-done">${icon('check', 18)}${t('workshop.maxed')}</span></div>`;
    } else {
      const later = [];
      for (let l = level + 2; l <= Math.min(max, level + 1 + LATER_LEVELS); l++) {
        later.push(`<li><span>${t('workshop.levelN', { n: l })}</span><b>${upgradeValue(u.id, l)}</b><span>${coreIcon(12)}${bigNum(u.costs[l - 1])}</span></li>`);
      }
      const short = cost > cash;
      body =
        `<div class="wv-compare"><div class="wv-now"><small>${t('workshop.now')}</small><b>${upgradeValue(u.id, level)}</b></div>` +
        `<span class="wv-arrow">${icon('arrowRight', 28)}</span>` +
        `<div class="wv-now on"><small>${t('workshop.levelN', { n: level + 1 })}</small><b>${upgradeValue(u.id, level + 1)}</b></div></div>` +
        (later.length ? `<ul class="wv-later">${later.join('')}</ul>` : '') +
        `<div class="wv-buyzone"><button type="button" class="wv-buy" data-buy="${u.id}"${short ? ' disabled' : ''}>` +
        `${t('workshop.upgradeTo', { n: level + 1 })}<span class="wv-cost">${coreIcon(15)}${bigNum(cost)}</span></button>` +
        `<small class="${short ? 'short' : ''}">${short ? t('workshop.need', { n: bigNum(cost - cash) }) : t('workshop.left', { n: bigNum(cash - cost) })}</small></div>`;
    }
    $('wvDetail').className = `wv-detail ${u.group}`;
    $('wvDetail').innerHTML =
      `<div class="wv-detail-head"><span class="wv-bigico">${icon(UPGRADE_ICON[u.id], 36)}</span>` +
      `<div><small>${t(`workshop.group.${u.group}`)}</small><h4>${t(`up.${u.id}`)}</h4><p>${t(`up.${u.id}.desc`)}</p></div></div>` +
      `<div class="wv-level"><span>${t('workshop.level', { n: level, max })}</span><span class="wv-bars">${bars}</span></div>` +
      body;
  }

  /**
   * The starting weapon, one at a time with arrows: all of them, the locked ones dimmed under a padlock
   * with the wave that gives them (the run then starts with the SMG), and a dot for each underneath.
   */
  private renderWeapon(record: number, startWeapon: number): void {
    const all = [
      { id: startWeapons(0)[0], at: 0 },
      ...MILESTONES.flatMap((m) => ('weapon' in m ? [{ id: m.weapon, at: m.wave }] : [])),
    ];
    let i = all.findIndex((w) => w.id === (this.weaponView ?? startWeapon));
    if (i < 0) i = Math.max(0, all.findIndex((w) => w.id === startWeapon));
    const shown = all[i];
    const open = record >= shown.at;
    const look = weaponLook(shown.id);
    const step = (d: number) => all[(i + d + all.length) % all.length].id;
    const arrow = (d: number, name: IconName, label: string) =>
      `<button type="button" class="wv-step" data-view="${step(d)}" aria-label="${label}">${icon(name, 18)}</button>`;
    const dots = all
      .map((w, k) => {
        const locked = record < w.at;
        const label = locked ? `${weaponLook(w.id).name} · ${t('workshop.reach', { n: w.at })}` : weaponLook(w.id).name;
        return `<button type="button" class="${k === i ? 'on' : ''}${locked ? ' locked' : ''}" data-view="${w.id}" aria-label="${label}" title="${label}"></button>`;
      })
      .join('');
    const openCount = all.filter((w) => record >= w.at).length;
    $('wvWeapons').innerHTML =
      arrow(-1, 'chevronLeft', t('workshop.prevWeapon')) +
      `<div class="wv-gun${open ? '' : ' locked'}"><span class="wv-gun-pic"><img src="${look.picture}" alt="" />` +
      (open ? '' : `<span class="wv-gun-lock">${icon('lock', 13)}${t('workshop.atWave', { n: shown.at })}</span>`) +
      `</span><b>${look.name}</b>` +
      `<span class="wv-dots" role="group" aria-label="${t('workshop.weaponsOpen', { n: openCount, total: all.length })}">${dots}</span></div>` +
      arrow(1, 'chevronRight', t('workshop.nextWeapon'));
  }

  /** The daily reward: one line (take it, or taken and what tomorrow brings) and the week's seven days. */
  private renderDaily(p: WavesProgress): void {
    const d = dailyState(p);
    const week = DAILY_CORES.map((_, i) => {
      const n = i + 1;
      return `<i class="${n < d.day || (n === d.day && !d.ready) ? 'got' : n === d.day ? 'now' : ''}"></i>`;
    }).join('');
    const tomorrow = DAILY_CORES[d.day % DAILY_CORES.length];
    $('wvDaily').classList.toggle('ready', d.ready);
    $('wvDaily').innerHTML =
      `<span class="wd-ico">${icon('gift', 20)}</span>` +
      `<span class="wd-text"><b>${d.ready ? t('daily.title') : t('daily.got')}</b>` +
      `<small>${d.ready ? t('daily.dayOf', { n: d.day, total: DAILY_CORES.length }) : `${t('daily.day', { n: d.day })} · ${t('daily.tomorrow', { n: tomorrow })}`}</small><span class="wd-week">${week}</span></span>` +
      (d.ready ? `<button type="button" class="wd-claim" data-claim>${coreIcon(15)}+${d.cores}</button>` : `<span class="wd-done">${icon('check', 18)}</span>`);
  }

  /** The milestones: what comes next, and a track with each prize and the record's progress on it. */
  private renderTrack(): void {
    const record = loadWavesRecord()?.wave ?? 0;
    const colours = this.colours();
    const next = nextMilestone(record);
    $('wvNext').textContent = next ? t('workshop.nextPrize', { prize: prizeName(next) }) : t('workshop.allDone');
    $('wvNextSub').textContent = next ? t('workshop.nextIn', { n: next.wave, left: next.wave - record }) : '';
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
        return `<span class="wv-node${got ? ' got' : ''}${m === next ? ' next' : ''}" title="${prizeText(m)}"><span class="dot">${art}</span><b>${m.wave}</b></span>`;
      }).join('');
  }
}

// The waves' Workshop (proposal A approved by Erick, 12/10/2026), opened by the start screen's "Waves"
// card and by the end of a run. Three columns: the upgrades as a short list by kind (attack, defence,
// survival; abilities and limits in the other tab), the chosen one in detail (what the next level does,
// the levels after it, the button that buys it), and what the run starts with: the wave (the first, or a
// checkpoint reached), the weapon (the SMG, or one a milestone gave), the daily reward, PLAY. Under them,
// the milestones' track. Since 15/11/2026 also the Horde's tab (src/client/hordeProgress.ts): the same upgrades bought
// with its own Essence, its best and PLAY on the right.
import { prizeArt, prizeName, prizeText, weaponLook } from '../client/wavesPrize';
import { bossKind, loadWavesRecord, WAVES } from '../client/waves';
import { wavesPower } from '../client/wavesPower';
import {
  BREATHER,
  CHECKPOINT,
  MAGNET,
  MILESTONES,
  UPGRADES,
  WAVES_UPGRADES,
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
  buildCards,
  headStartPowers,
  loadProgress,
  nextCost,
  nextMilestone,
  saveProgress,
  startWeapons,
  type Levels,
  type Milestone,
  type Upgrade,
  type UpgradeGroup,
  type UpgradeID,
  type WavesProgress,
  levelCost,
  topLevel,
  workshopFactor,
} from '../client/wavesProgress';
import { track } from '../client/analytics';
import { bigNum, num, t, type Key } from '../i18n';
import type { SkinInfo } from '../sim/player';
import type { Account } from './account';
import { icon, type IconName } from './icons';
import type { OrbStudio } from './orbStudio';
import { debugUnlockOn } from './accountModal';
import { versioned } from '../sim/assetVersion';
import { VESUVIUS_WAVE, vesuviusOpen, type VesuviusAccess } from '../sim/vesuvius';
import { VesuviusForge } from './vesuviusForge';
import { buyHorde, essenceBalance, loadHorde } from '../client/hordeProgress';
import { WEAPON_SMG } from '../sim/constants';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The testers' extra start (DEBUG_USER_IDS): right before the first boss, to try its cards. */
const TEST_START = 9;
/** The start picker's dots shown at once (the open checkpoints around the chosen one). */
const DOTS = 6;

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
  magnet: 'magnet',
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

/**
 * The Steam screen's Workshop (Erick, 20/11/2026: the cards of the "Oficina 1" mockup, with the "3"'s Power before and
 * after): every upgrade at once in columns by kind, the cards' and the limits' together in the last one. Its filters:
 * all by kind, or one list of those the Cores pay for, or of all of them, the cheapest first.
 */
const SHOP_COLUMNS: UpgradeGroup[][] = [['attack'], ['defense'], ['survival'], ['abilities'], ['cards', 'limits']];
type Filter = 'all' | 'afford' | 'cheap';

/**
 * How much an upgrade gives at a level, as a number that grows with it: the height of its bar in the Steam Workshop's
 * progression chart (the counts by their level; a cooldown by how often it comes back).
 */
function upgradeAmount(id: UpgradeID, level: number): number {
  switch (id) {
    case 'life':
    case 'damage':
    case 'fire':
      return workshopFactor(id, level) - 1;
    case 'armor':
      return 1 - workshopFactor('armor', level);
    case 'speed':
    case 'luck':
      return UPGRADE_STEP[id] * level;
    case 'breather':
      return BREATHER[level];
    case 'barrier':
      return BARRIER_SIZE[level];
    case 'magnet':
      return MAGNET[level];
    case 'dash':
      return level ? 1 / DASH_COOLDOWN[level] : 0;
    case 'shock':
      return level ? 1 / SHOCK_COOLDOWN[level] : 0;
    default:
      return level;
  }
}

/** How many later levels the detail lists under the next one. */
const LATER_LEVELS = 3;

/**
 * WavesModal.fit: the window's full width (its three columns), the scale it may shrink to, and the screen
 * width below which it is a phone's single column instead.
 */
const FIT_FULL_WIDTH = 1200;
const FIT_RUN_WIDTH = 620;
/** The Steam screen's Workshop (openSteam('shop')): every upgrade at once, in cards, and the chosen one beside them. */
const FIT_SHOP_WIDTH = 1460;
/** The Steam shop takes the screen's width up to this (Erick, 20/11/2026: at 1460 it felt cramped). */
const SHOP_MAX_WIDTH = 1800;
const FIT_MIN = 0.6;
const FIT_MIN_WIDTH = 700;

/** What an upgrade gives at a level, as the Workshop says it. */
function upgradeValue(id: UpgradeID, level: number): string {
  const pct = (x: number) => `+${Math.round(x * 100)}%`;
  switch (id) {
    // (damage, attack speed, life and defence go on past their top: the mastery, workshopFactor)
    case 'life':
      return String(Math.round(100 * workshopFactor('life', level)));
    case 'damage':
    case 'fire':
      return pct(workshopFactor(id, level) - 1);
    case 'speed':
    case 'luck':
      return pct(UPGRADE_STEP[id] * level);
    case 'armor':
      return level ? `-${Math.round((1 - workshopFactor('armor', level)) * 100)}%` : '0%';
    case 'drops':
      return `${Math.round((0.5 + UPGRADE_STEP.drops * level) * 100)}%`;
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
    case 'magnet':
      return level ? num(MAGNET[level]) : '—';
  }
}

/** A milestone's prize in a couple of words (the track's "next" line). */

/** A Core, the waves' currency. */
export const coreIcon = (size = 18) => `<span class="core-ico">${icon('core', size)}</span>`;
/** Essence, the Horde's currency: a violet crystal. */
export const essenceIcon = (size = 18) => `<span class="essence-ico">${icon('essence', size)}</span>`;

type Mode = 'waves' | 'vesuvius' | 'horde';

export class WavesModal {
  private readonly root = $('wavesModal');
  /** The tab shown: the numbers, or what only the Workshop gives (the run's limits, the abilities). */
  private tab: Tab = 'stats';
  /** The upgrade shown in detail (null: the first one worth buying, when the window opens). */
  private selected: UpgradeID | null = null;
  /** The Steam Workshop's filter over its cards. */
  private filter: Filter = 'all';
  /** The Steam Workshop's milestones scroll to the next one, once each time the window opens. */
  private trackToNext = false;
  /** The weapon the picker shows, maybe a locked one (null: the run's starting weapon). */
  private weaponView: number | null = null;
  /** The exclusive Orbs' pictures in the player's colours, drawn once each. */
  private readonly orbPics = new Map<string, string>();
  /** The Survival's mode shown: the Waves (the Workshop), the Vesuvius (src/sim/vesuvius.ts) or the Horde (its Workshop). */
  private mode: Mode = 'waves';
  /**
   * The server's word on the Vesuvius (GET /api/vesuvius) for this account and test switch (`key`), asked when the
   * window opens; null while it is asked; `failed`: the server couldn't be asked.
   */
  private vesuvius: { key: string; at: number; access: VesuviusAccess | null; failed: boolean } | null = null;
  /** The Vesuvius's Forge, once the server opens it. */
  private readonly forge: VesuviusForge;

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
    /** The Vesuvius's play button (the start checks with the server again). */
    private readonly onVesuvius: () => void,
    /** The Horde's play button. */
    private readonly onHorde: () => void,
  ) {
    account.onChange(() => {
      if (!this.isOpen) return;
      this.checkVesuvius();
      this.render();
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
    $('wvFilters').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-filter]');
      if (!b) return;
      this.filter = b.dataset.filter as Filter;
      this.render();
    });
    // The Steam Workshop's milestones scroll sideways: the wheel turns them too
    $('wvTrack').addEventListener(
      'wheel',
      (e) => {
        const track = e.currentTarget as HTMLElement;
        if (track.scrollWidth <= track.clientWidth + 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        track.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
    $('wvTrack').addEventListener('scroll', () => this.trackFades(), { passive: true });
    $('wvDetail').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (!b || b.disabled) return;
      const id = b.dataset.buy as UpgradeID;
      const before = this.power();
      if (this.mode === 'horde') {
        const p = buyHorde(id);
        if (!p) return;
        track('horde_upgrade', { upgrade: id, level: p.levels[id] });
        void this.account.saveHordeProgress();
      } else {
        const p = buy(id);
        if (!p) return;
        track('waves_upgrade', { upgrade: id, level: p.levels[id] });
        void this.account.saveWavesProgress();
      }
      this.render();
      this.onChange();
      // What was bought flashes, and the Cores with it
      $('wvDetail').classList.add('bought');
      $('wvUpgrades').querySelector(`[data-pick="${id}"]`)?.classList.add('bought');
      $('wvCores').classList.add('bought');
      this.popPower(this.power() - before);
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
      if (this.mode === 'horde') this.onHorde();
      else this.onPlay();
    });
    $('wvModes').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
      if (!b) return;
      this.mode = b.dataset.mode === 'vesuvius' ? 'vesuvius' : b.dataset.mode === 'horde' ? 'horde' : 'waves';
      if (this.mode === 'vesuvius') this.checkVesuvius();
      this.selected = null;
      this.render();
    });
    this.forge = new VesuviusForge(
      account,
      () => {
        if (!this.vesuvius?.access?.open) return;
        this.close();
        this.onVesuvius();
      },
      () => {
        this.close();
        this.onSignIn();
      },
    );
    $('vsState').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-signin]')) return;
      this.close();
      this.onSignIn();
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

  /**
   * The Steam start screen to try (src/menu/steamMenu.ts, Erick, 18/11/2026): the window in two halves. 'shop' is the
   * Workshop alone (the wave, the weapon and Play are the menu's Continue and New run there); 'run' is the run's choice
   * alone, narrower (the wave among the checkpoints, the weapon, the boss of that stretch, Play). The Waves only.
   */
  private steamView: 'shop' | 'run' | null = null;

  openSteam(view: 'shop' | 'run'): void {
    this.steamView = view;
    const card = this.root.querySelector<HTMLElement>('.waves-modal')!;
    card.classList.toggle('steam-shop', view === 'shop');
    card.classList.toggle('steam-run', view === 'run');
    this.open('waves');
  }

  /** Opens on the Waves' Workshop, or on the Vesuvius or the Horde (back from a run there that asked for its Workshop). */
  open(mode: Mode = 'waves'): void {
    // The run starts on the highest checkpoint open, whatever was chosen last time (Erick, 04/11/2026); changed here, it
    // stays until the window opens again
    const open = checkpoints(loadWavesRecord()?.wave ?? 0);
    const last = open[open.length - 1] ?? 1;
    const p = loadProgress();
    if (p.startWave !== last) saveProgress({ ...p, startWave: last });
    this.root.hidden = false;
    this.selected = null;
    this.weaponView = null;
    this.filter = 'all';
    this.trackToNext = true;
    this.mode = mode;
    this.forge.reset();
    // (the Vesuvius's tab shows whether it is open)
    this.checkVesuvius();
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
    if (this.steamView) {
      this.steamView = null;
      this.root.querySelector('.waves-modal')!.classList.remove('steam-shop', 'steam-run');
    }
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

  /** The levels and the balance of the Workshop shown: the Waves' (Cores) or the Horde's (Essence). */
  private wallet(): { levels: Levels; cash: number } {
    if (this.mode === 'horde') {
      const h = loadHorde();
      return { levels: h.levels, cash: essenceBalance(h) };
    }
    const p = loadProgress();
    return { levels: p.levels, cash: balance(p) };
  }

  /** The upgrades of the Workshop shown: the Horde's has its own too (Upgrade.horde). */
  private upgrades(): typeof UPGRADES {
    return this.mode === 'horde' ? UPGRADES : WAVES_UPGRADES;
  }

  /** The run's starting weapon for the Power: the Horde always starts with the SMG. */
  private powerWeapon(): number {
    return this.mode === 'horde' ? WEAPON_SMG : WavesModal.startChoice(this.account.debugTools.zoom).startWeapon;
  }

  /** The currency's icon in the Workshop shown. */
  private cur(size: number): string {
    return this.mode === 'horde' ? essenceIcon(size) : coreIcon(size);
  }

  private render(): void {
    const p = loadProgress();
    const record = loadWavesRecord()?.wave ?? 0;
    const { levels, cash } = this.wallet();
    const tester = this.account.debugTools.zoom;
    const { startWave, startWeapon } = WavesModal.startChoice(tester);
    const horde = this.mode === 'horde';

    for (const id of ['wvDetail', 'wvCores', 'wvDaily']) $(id).classList.remove('bought', 'claimed-now');
    $('wvCores').classList.toggle('hd-essence', horde);
    $('wvCores').innerHTML = `${this.cur(26)}<b>${bigNum(cash)}</b><span>${t(horde ? 'horde.essence' : 'workshop.cores')}</span>`;
    const h = horde ? loadHorde() : null;
    const shown = h ? h.bestWave : record;
    $('wvRecord').innerHTML = shown ? `${icon('trophy', 16)}${t('waves.record', { n: shown })}` : '';
    $('wvRecord').hidden = !shown;
    // The Power (src/client/wavesPower.ts): the starting weapon and the Workshop, 100 for a new player
    const pow = wavesPower(levels, this.powerWeapon());
    $('wvPower').classList.remove('bought');
    $('wvPower').title = t('workshop.powerTip', { a: num(pow.attack, 1), d: num(pow.toughness, 1) });
    $('wvPower').innerHTML = `${icon('zap', 18)}<b>${bigNum(pow.power)}</b><span>${t('workshop.power')}</span><i class="wv-pop" hidden></i>`;

    this.renderModes(record);
    this.renderList(levels, cash);
    this.renderDetail(levels, cash);

    this.renderStarts(record, startWave, tester);

    this.renderWeapon(record, startWeapon);
    this.renderTrack();
    this.renderDaily(p);
    $('wvPlay').innerHTML =
      this.steamView === 'shop'
        ? // The Steam shop: the menu's Continue, the highest checkpoint with the last weapon (Erick, 20/11/2026)
          `${icon('play', 22)}<span class="wv-cont">${t(startWave > 1 ? 'steam.continue' : 'steam.play')}<small>${startWave > 1 ? t('steam.continueWeapon', { n: startWave, weapon: weaponLook(startWeapon).name }) : t('steam.fromOne')}</small></span>`
        : `${icon('play', 22)}${horde ? t('horde.play') : t('workshop.play', { n: startWave })}`;
    // The Horde's side: its best wave and level, its runs
    if (h) {
      $('hdRecord').innerHTML =
        `<div><small>${t('horde.bestWave')}</small><b>${h.bestWave ? bigNum(h.bestWave) : '—'}</b></div>` +
        `<div><small>${t('horde.bestLevel')}</small><b>${h.bestWave ? bigNum(h.bestLevel) : '—'}</b></div>` +
        `<div><small>${t('horde.runs')}</small><b>${bigNum(h.runs)}</b></div>`;
    }

    // Where the progress is kept
    $('wvSave').innerHTML = this.account.signedIn
      ? `<span class="ok">${icon('check', 14)}${t(horde ? 'horde.savedAccount' : 'workshop.savedAccount')}</span>`
      : `<span title="${t(horde ? 'horde.savedLocal' : 'workshop.savedLocal')}">${t('workshop.savedLocalShort')}</span><button type="button" class="wv-signin">${icon('user', 14)}${t('account.signIn')}</button>`;
    this.fit();
    this.scrollTrack();
    this.trackFades();
  }

  /** Asks the server about the Vesuvius for this account and the test switch, a minute's answer kept. */
  private checkVesuvius(): void {
    const test = debugUnlockOn(this.account.debugTools.zoom);
    const key = `${this.account.email}|${test}`;
    const v = this.vesuvius;
    if (v?.key === key && (Date.now() - v.at < 60_000 || (!v.access && !v.failed))) return;
    const asked: NonNullable<WavesModal['vesuvius']> = { key, at: Date.now(), access: null, failed: false };
    this.vesuvius = asked;
    void this.account.vesuviusAccess(test).then((access) => {
      if (this.vesuvius !== asked) return;
      asked.access = access;
      asked.failed = !access;
      asked.at = Date.now();
      if (this.isOpen) this.render();
    });
  }

  /** The mode tabs (the Vesuvius's with a lock until the server opens it), and the Waves' parts or the Vesuvius's. */
  private renderModes(record: number): void {
    const ves = this.mode === 'vesuvius';
    const horde = this.mode === 'horde';
    for (const b of $('wvModes').querySelectorAll<HTMLElement>('[data-mode]')) {
      const on = b.dataset.mode === this.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    const open = !!this.vesuvius?.access?.open;
    const tab = $('wvModes').querySelector<HTMLElement>('[data-mode="vesuvius"]')!;
    tab.classList.toggle('locked', !open);
    tab.querySelector('.vs-tab-ico')!.innerHTML = icon(open ? 'flame' : 'lock', 16);
    this.root.querySelector<HTMLElement>('.wv-body')!.hidden = ves;
    this.root.querySelector<HTMLElement>('.wv-milestones')!.hidden = ves || horde;
    // The Horde: no checkpoint, weapon nor daily reward; its own box
    for (const box of this.root.querySelectorAll<HTMLElement>('.wv-side > .wv-box:not(.hd-side)')) box.hidden = horde;
    $('wvDaily').hidden = horde;
    $('hdSide').hidden = !horde;
    // (the guide's link keeps its place: the tabs don't move)
    this.root.querySelector<HTMLElement>('.wv-guide')!.style.visibility = ves || horde ? 'hidden' : '';
    $('wvPower').hidden = ves;
    $('wvCores').hidden = ves;
    // (the Obsidian: the Vesuvius's currency, once it is open)
    $('vsObsidian').hidden = !ves || !open;
    $('wvVesuvius').hidden = !ves;
    $('wvKicker').textContent = t(ves ? 'vesuvius.kicker' : horde ? 'horde.name' : 'menu.waves');
    $('wvHeading').textContent = t(ves ? 'vesuvius.name' : this.steamView === 'run' ? 'steam.newRun' : 'workshop.title');
    if (ves) this.renderVesuvius(record);
  }

  /**
   * The Vesuvius: open (the server said so: a checked record past wave 100, or a tester's account) or locked, with
   * how far the record is from it and what is missing.
   */
  private renderVesuvius(record: number): void {
    const v = this.vesuvius;
    const access = v?.access ?? null;
    // Open: its Forge (the map's picture beside it), and how it opened
    $('vsLocked').hidden = !!access?.open;
    $('vsForge').hidden = !access?.open;
    if (access?.open) {
      $('vsMini').style.backgroundImage = `url('${versioned('/menu/card-vesuvius.webp')}')`;
      $('vsHow').textContent = access.test ? t('vesuvius.openTest') : t('vesuvius.openRecord', { n: access.wave ?? record });
      this.forge.setAccess(access);
      this.forge.render();
      return;
    }
    $('vsPic').style.backgroundImage = `url('${versioned('/menu/card-vesuvius.webp')}')`;
    const play = $<HTMLButtonElement>('vsLockedBtn');
    const state = $('vsState');
    const wave = Math.min(VESUVIUS_WAVE, Math.max(record, access?.wave ?? 0));
    const signin = access?.reason === 'signin';
    const note = !v || (!access && !v.failed)
      ? t('vesuvius.checking')
      : !access || access.reason === 'unknown'
        ? t('vesuvius.offline')
        : signin
          ? t('vesuvius.signin')
          : vesuviusOpen(record)
            ? t('vesuvius.unchecked')
            : t('vesuvius.beat');
    state.className = 'vs-state';
    state.innerHTML =
      `<div class="vs-lock">${icon('lock', 26)}<b>${t('vesuvius.locked')}</b></div>` +
      `<div class="vs-bar"><i style="width:${(wave / VESUVIUS_WAVE) * 100}%"></i></div>` +
      `<p class="vs-progress">${t('vesuvius.progress', { n: wave })}</p>` +
      `<p class="vs-note">${note}</p>` +
      (signin ? `<button type="button" class="wv-signin" data-signin>${icon('user', 14)}${t('account.signIn')}</button>` : '');
    play.disabled = true;
    play.innerHTML = `${icon('lock', 22)}${t('vesuvius.lockedButton')}`;
  }

  /**
   * The wave to start from (layout A, chosen by Erick on 27/10/2026: the row of small buttons squeezed and hid the
   * older checkpoints): the wave big between two arrows, the best time to it and the run's upgrades it gives, a row of
   * dots with every open checkpoint (up to DOTS around the chosen one) and the next one locked, and the next goal.
   */
  private renderStarts(record: number, startWave: number, tester: boolean): void {
    const open = checkpoints(record);
    const options = [1, ...(tester ? [TEST_START] : []), ...open.slice(1)];
    const at = Math.max(0, options.indexOf(startWave));
    const next = open.length * CHECKPOINT;
    // A checkpoint's best time to reach it: a run begun there starts the ranking's clock from it (WavesRecord.splits)
    const splits = loadWavesRecord()?.splits ?? {};
    const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const time = startWave === 1 ? '0:00' : tester && startWave === TEST_START ? t('workshop.testStart') : splits[startWave] !== undefined ? clock(splits[startWave]) : '—';
    // What the run begins with: the build saved when a run last beat this checkpoint, else random upgrades
    const build = startWave > 1 ? loadProgress().builds[startWave] : undefined;
    const perms = startWave === 1 ? '—' : `+${build ? Object.values(build.perms).reduce((n, v) => n + (v ?? 0), 0) : headStartPowers(startWave)}`;
    const cards = startWave === 1 || !build ? '—' : String(Object.keys(buildCards(build, startWave)).length);
    const arrow = (to: number | undefined, name: 'chevron_left' | 'chevron_right', label: Key) =>
      `<button type="button" class="wv-arrow"${to === undefined ? ' disabled' : ` data-start="${to}"`} aria-label="${t(label)}">${icon(name, 20)}</button>`;
    // The dots: a window of DOTS around the chosen wave when there are more
    const from = Math.max(0, Math.min(at - Math.floor(DOTS / 2), options.length - DOTS));
    const dots =
      options
        .slice(from, from + DOTS)
        .map((w) => `<button type="button" class="wv-cp${w === startWave ? ' on' : ''}" data-start="${w}" aria-label="${t('workshop.waveN', { n: w })}"><i></i><span>${w}</span></button>`)
        .join('') + `<span class="wv-cp locked" title="${t('workshop.nextGoal', { n: next })}">${icon('lock', 12)}<span>${next}</span></span>`;
    $('wvStarts').innerHTML =
      `<div class="wv-pick">${arrow(options[at - 1], 'chevron_left', 'workshop.prevWave')}<div class="wv-wave"><span>${t('workshop.waveLabel')}</span><b>${startWave}</b></div>${arrow(options[at + 1], 'chevron_right', 'workshop.nextWave')}</div>` +
      `<div class="wv-facts"><div><small>${t('workshop.timeShort')}</small><b>${time}</b></div><div><small>${t('workshop.permsShort')}</small><b class="gain">${perms}</b></div><div><small>${t('workshop.cardsShort')}</small><b class="gain">${cards}</b></div></div>` +
      `<div class="wv-cps">${dots}</div>`;
    const about = startWave === 1 ? '' : ` ${t(build ? 'workshop.buildNote' : 'workshop.noBuild', { n: startWave })} ${t('workshop.skipped')}`;
    // The boss of the stretch it begins (the Steam screen's run choice shows its picture): the checkpoint's own, played
    // again, or the first one's
    const bossWave = Math.max(WAVES.bossEvery, Math.ceil(startWave / WAVES.bossEvery) * WAVES.bossEvery);
    const kind = bossKind(bossWave);
    $('wvBoss').innerHTML = `<img src="${versioned(`/menu/card-waves-${kind}.webp`)}" alt="" /><span>${t('lobby.nextBoss', { name: t(`boss.${kind}`), n: num(bossWave) })}</span>`;
    $('wvStartNote').textContent = (open.length > 1 ? t('workshop.nextGoal', { n: next }) : t('workshop.startLocked')) + about;
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
    // (the Steam screen's run choice is the narrow half)
    const FIT_WIDTH = this.steamView === 'run' ? FIT_RUN_WIDTH : this.steamView === 'shop' ? FIT_SHOP_WIDTH : FIT_FULL_WIDTH;
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
    // (scaled down for the height, the shop still spans the screen's width: wider cards, not empty sides)
    const maxW = this.steamView === 'shop' ? SHOP_MAX_WIDTH : FIT_WIDTH;
    let zoom = Math.max(FIT_MIN, k);
    const apply = () => {
      card.style.zoom = String(zoom);
      card.style.maxHeight = `${roomH / zoom}px`;
      card.style.width = `${Math.min(maxW, roomW / zoom)}px`;
    };
    apply();
    // (the scaled layout can come out a few pixels taller than measured, and a scrollbar showed for nothing: a little
    // smaller until it fits)
    // (even 1 px over shows a scrollbar)
    for (let i = 0; i < 6 && zoom > FIT_MIN && card.scrollHeight > card.clientHeight; i++) {
      zoom = Math.max(FIT_MIN, Math.min(zoom - 0.004, roomH / (card.scrollHeight + 3)));
      apply();
    }
  }

  /** The list: the tab's upgrades by kind, each with its level and the price of the next one. */
  private renderList(levels: Levels, cash: number): void {
    if (this.steamView === 'shop') {
      this.renderCards(levels, cash);
      return;
    }
    const affordable = (tab: Tab) => this.upgrades().filter((u) => tabOf(u) === tab && (nextCost(u, levels) ?? Infinity) <= cash).length;
    for (const b of $('wvTabs').querySelectorAll<HTMLElement>('[data-tab]')) {
      const tab = b.dataset.tab as Tab;
      b.classList.toggle('on', tab === this.tab);
      b.setAttribute('aria-selected', String(tab === this.tab));
      const n = affordable(tab);
      b.querySelector('.n')!.textContent = n ? String(n) : '';
    }
    const shown = this.upgrades().filter((u) => tabOf(u) === this.tab);
    // Nothing chosen yet (or another tab's): the first one the Cores pay for, else the first
    if (!this.selected || !shown.some((u) => u.id === this.selected)) {
      this.selected = (shown.find((u) => (nextCost(u, levels) ?? Infinity) <= cash) ?? shown[0]).id;
    }
    $('wvUpgrades').innerHTML = GROUPS.filter((g) => g.tab === this.tab)
      .map((g) => {
        const rows = shown.filter((u) => u.group === g.id).map((u) => this.row(u, levels, cash));
        return `<div class="wv-group ${g.id}"><h3>${t(`workshop.group.${g.id}`)}</h3>${rows.join('')}</div>`;
      })
      .join('');
  }

  private row(u: Upgrade, levels: Levels, cash: number): string {
    const level = levels[u.id];
    const cost = nextCost(u, levels);
    // Past the top, the mastery's levels (MASTERY)
    const mastery = level > u.costs.length ? `<span class="wv-lvtext wv-mastery">+${level - u.costs.length}</span>` : '';
    const pips =
      (u.costs.length > 5 ? `<span class="wv-lvtext">${Math.min(level, u.costs.length)}/${u.costs.length}</span>` : u.costs.map((_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')) + mastery;
    const price =
      cost === null ? `<span class="wv-price max">${t('workshop.max')}</span>` : `<span class="wv-price${cost > cash ? ' off' : ''}">${this.cur(12)}${bigNum(cost)}</span>`;
    return (
      `<button type="button" class="wv-row ${u.group}${u.id === this.selected ? ' on' : ''}" data-pick="${u.id}" title="${t(`up.${u.id}.desc`)}">` +
      `<span class="wv-ico">${icon(UPGRADE_ICON[u.id], 16)}</span><span class="wv-name">${t(`up.${u.id}`)}</span>` +
      `<span class="wv-pips">${pips}</span>${price}</button>`
    );
  }

  /** The Steam Workshop: the filters and every upgrade in a card (by kind, or one list by price). */
  private renderCards(levels: Levels, cash: number): void {
    const all = this.upgrades();
    const cost = (u: Upgrade) => nextCost(u, levels) ?? Infinity;
    if (!this.selected || !all.some((u) => u.id === this.selected)) this.selected = (all.find((u) => cost(u) <= cash) ?? all[0]).id;
    const afford = all.filter((u) => cost(u) <= cash).length;
    const chip = (f: Filter, label: string) => `<button type="button" class="${this.filter === f ? 'on' : ''}" data-filter="${f}" aria-pressed="${this.filter === f}">${label}</button>`;
    $('wvFilters').innerHTML =
      chip('all', `${t('workshop.filterAll')} · ${all.length}`) + chip('afford', `${t('workshop.filterAfford')} · ${afford}`) + chip('cheap', t('workshop.filterCheap'));
    if (this.filter === 'all') {
      $('wvUpgrades').innerHTML =
        '<div class="wv-cols">' +
        SHOP_COLUMNS.map(
          (col) =>
            '<div class="wv-col">' +
            col
              .map((g) => {
                const us = all.filter((u) => u.group === g);
                if (!us.length) return '';
                return `<h3 class="wv-ghead ${g}">${t(`workshop.group.${g}`)}<span>${us.length}</span></h3>` + us.map((u) => this.card(u, levels, cash)).join('');
              })
              .join('') +
            '</div>',
        ).join('') +
        '</div>';
      return;
    }
    // One list by price, the maxed ones last (the sort keeps the kinds' order between equal prices)
    const list = all.filter((u) => this.filter === 'cheap' || cost(u) <= cash).sort((a, b) => Math.min(cost(a), 1e12) - Math.min(cost(b), 1e12));
    $('wvUpgrades').innerHTML = list.length
      ? `<div class="wv-flat">${list.map((u) => this.card(u, levels, cash)).join('')}</div>`
      : `<p class="wv-none">${t('workshop.filterNone')}</p>`;
  }

  /** One upgrade's card: its icon and the next level's price, its name, what it gives now and next, its levels. */
  private card(u: Upgrade, levels: Levels, cash: number): string {
    const level = levels[u.id];
    const top = u.costs.length;
    const cost = nextCost(u, levels);
    const off = cost !== null && cost > cash;
    const pips = u.costs.map((_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('') + (level > top ? `<span class="wv-lvtext wv-mastery">+${level - top}</span>` : '');
    const price = cost === null ? `<span class="wv-price max">${t('workshop.max')}</span>` : `<span class="wv-price${off ? ' off' : ''}">${this.cur(12)}${bigNum(cost)}</span>`;
    const value = cost === null ? `<b>${upgradeValue(u.id, level)}</b>` : `${upgradeValue(u.id, level)} → <b>${upgradeValue(u.id, level + 1)}</b>`;
    return (
      `<button type="button" class="wv-card ${u.group}${u.id === this.selected ? ' on' : ''}${off ? ' off' : ''}${cost === null ? ' maxed' : ''}" data-pick="${u.id}" title="${t(`up.${u.id}.desc`)}">` +
      `<span class="wv-card-top"><span class="wv-ico">${icon(UPGRADE_ICON[u.id], 19)}</span>${price}</span>` +
      `<span class="wv-card-name">${t(`up.${u.id}`)}</span><span class="wv-card-val">${value}</span><span class="wv-pips">${pips}</span></button>`
    );
  }

  /** The Steam Workshop's milestones, once each time the window opens: the next one in the middle of the strip. */
  private scrollTrack(): void {
    if (this.steamView !== 'shop' || !this.trackToNext) return;
    this.trackToNext = false;
    const track = $('wvTrack');
    const got = track.querySelectorAll<HTMLElement>('.wv-node.got');
    const node = track.querySelector<HTMLElement>('.wv-node.next') ?? got[got.length - 1];
    if (node) track.scrollLeft = Math.max(0, node.offsetLeft + node.offsetWidth / 2 - track.clientWidth / 2);
  }

  /** The milestones fade out at an edge with more of them past it (the Steam Workshop's strip scrolls). */
  private trackFades(): void {
    const track = $('wvTrack');
    track.classList.toggle('fade-l', track.scrollLeft > 2);
    track.classList.toggle('fade-r', track.scrollLeft < track.scrollWidth - track.clientWidth - 2);
  }

  /** The Power now, with the starting weapon chosen. */
  private power(): number {
    return wavesPower(this.wallet().levels, this.powerWeapon()).power;
  }

  /** A purchase: the Power chip flashes and shows what it gained. */
  private popPower(gain: number): void {
    const chip = $('wvPower');
    chip.classList.add('bought');
    const pop = chip.querySelector<HTMLElement>('.wv-pop');
    if (!pop || gain <= 0) return;
    pop.textContent = `+${bigNum(gain)}`;
    pop.hidden = false;
  }

  /** The chosen upgrade: what it does now and at the next level, the levels after, the button. */
  private renderDetail(levels: Levels, cash: number): void {
    const u = this.upgrades().find((x) => x.id === this.selected) ?? this.upgrades()[0];
    const level = levels[u.id];
    const top = u.costs.length;
    const max = topLevel(u);
    const cost = nextCost(u, levels);
    const horde = this.mode === 'horde';
    const bars = u.costs.map((_, i) => `<i class="${i < level ? 'on' : i === level ? 'next' : ''}"></i>`).join('');
    // A level's name: its number, or past the top its mastery's
    const name = (l: number) => (l > top ? t('workshop.mastery', { n: l - top }) : t('workshop.levelN', { n: l }));
    let body: string;
    if (cost === null) {
      body =
        `<div class="wv-compare maxed"><div class="wv-now on"><small>${t('workshop.maxed')}</small><b>${upgradeValue(u.id, level)}</b></div></div>` +
        `<div class="wv-buyzone"><span class="wv-done">${icon('check', 18)}${t('workshop.maxed')}</span></div>`;
    } else {
      const later = [];
      for (let l = level + 2; l <= Math.min(max, level + 1 + LATER_LEVELS); l++) {
        later.push(`<li><span>${name(l)}</span><b>${upgradeValue(u.id, l)}</b><span>${this.cur(12)}${bigNum(levelCost(u, l - 1))}</span></li>`);
      }
      const short = cost > cash;
      // What its next level adds to the Power
      const weapon = this.powerWeapon();
      const powerNow = wavesPower(levels, weapon).power;
      const gain = wavesPower({ ...levels, [u.id]: level + 1 }, weapon).power - powerNow;
      // The Steam screen: the levels as a chart, and the Power as it is and as it will be (the "ficha" mockup's)
      const extra =
        this.steamView === 'shop'
          ? this.chart(u, level) +
            (gain > 0
              ? `<div class="wv-powerrow">${icon('zap', 18)}<span>${t('workshop.power')}</span><b>${bigNum(powerNow)}</b>${icon('chevronRight', 18)}<b class="to">${bigNum(powerNow + gain)}</b><small>+${bigNum(gain)}</small></div>`
              : '')
          : (gain > 0 ? `<div class="wv-gain">${icon('zap', 15)}${t('workshop.powerGain', { n: bigNum(gain) })}</div>` : '') +
            (later.length ? `<ul class="wv-later">${later.join('')}</ul>` : '');
      body =
        `<div class="wv-compare"><div class="wv-now"><small>${t('workshop.now')}</small><b>${upgradeValue(u.id, level)}</b></div>` +
        `<span class="wv-to" aria-hidden="true">${icon('chevronRight', 30)}</span>` +
        `<div class="wv-now on"><small>${name(level + 1)}</small><b>${upgradeValue(u.id, level + 1)}</b></div></div>` +
        extra +
        `<div class="wv-buyzone"><button type="button" class="wv-buy" data-buy="${u.id}"${short ? ' disabled' : ''}>` +
        `${level + 1 > top ? t('workshop.masteryTo', { n: level + 1 - top }) : t('workshop.upgradeTo', { n: level + 1 })}<span class="wv-cost">${this.cur(15)}${bigNum(cost)}</span></button>` +
        `<small class="${short ? 'short' : ''}">${short ? t(horde ? 'horde.need' : 'workshop.need', { n: bigNum(cost - cash) }) : t(horde ? 'horde.left' : 'workshop.left', { n: bigNum(cash - cost) })}</small></div>`;
    }
    $('wvDetail').className = `wv-detail ${u.group}`;
    $('wvDetail').innerHTML =
      `<div class="wv-detail-head"><span class="wv-bigico">${icon(UPGRADE_ICON[u.id], 36)}</span>` +
      `<div><small>${t(`workshop.group.${u.group}`)}</small><h4>${t(`up.${u.id}`)}</h4><p>${t(`up.${u.id}.desc`)}</p></div></div>` +
      `<div class="wv-level"><span>${level > top ? t('workshop.mastery', { n: level - top }) : t('workshop.level', { n: level, max: top })}</span><span class="wv-bars">${bars}</span></div>` +
      (max > top && level >= top - 1 ? `<p class="wv-mhint">${t('workshop.masteryHint')}</p>` : '') +
      body;
  }

  /**
   * The Steam Workshop's progression chart: a bar a level, its value over it (the levels bought filled, the next one
   * outlined), and for the upgrades without end three Mastery levels after the top, from the one reached.
   */
  private chart(u: Upgrade, level: number): string {
    const top = u.costs.length;
    const mastery = topLevel(u) > top;
    const shown: number[] = [];
    for (let l = 1; l <= top; l++) shown.push(l);
    const from = Math.max(top + 1, level);
    if (mastery) for (let l = from; l < from + 3; l++) shown.push(l);
    const amounts = shown.map((l) => upgradeAmount(u.id, l));
    const most = Math.max(...amounts, 1e-9);
    const bars = shown
      .map((l, k) => {
        const state = l <= level ? ' on' : l === level + 1 ? ' next' : '';
        const h = Math.round(8 + (amounts[k] / most) * 62);
        return `<span class="wv-bar${state}${l > top ? ' m' : ''}"><small>${upgradeValue(u.id, l)}</small><i style="height:${h}%"></i><b>${l > top ? `M${l - top}` : l}</b></span>`;
      })
      .join('');
    return `<div class="wv-chart"><h5>${t(mastery ? 'workshop.progressionMastery' : 'workshop.progression')}</h5><div class="wv-chart-bars">${bars}</div></div>`;
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
    // (an inner strip: the Steam Workshop's scrolls sideways, each prize named under its wave)
    $('wvTrack').innerHTML =
      `<div class="wv-track-in"><span class="wv-rail"><i style="width:${Math.round(fill * 100)}%"></i></span>` +
      MILESTONES.map((m) => {
        const got = record >= m.wave;
        const pic = 'skin' in m ? this.orbPics.get(`${m.skin}|${colours.redDecal}|${colours.greenDecal}|${colours.blueDecal}`) : undefined;
        const art = 'skin' in m && !pic ? '<i class="o"></i>' : prizeArt(m, pic);
        return `<span class="wv-node${got ? ' got' : ''}${m === next ? ' next' : ''}" title="${prizeText(m)}"><span class="dot">${art}</span><b>${m.wave}</b><small class="nm">${prizeName(m)}</small></span>`;
      }).join('') +
      '</div>';
  }
}

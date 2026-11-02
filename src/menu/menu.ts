// The start screen, a lobby (layout D, chosen by Erick on 02/11/2026: Survival in front, the ranking and the PvP kept;
// before it, mockup F of 23/10/2026 with Multiplayer and Survival side by side): the logo and the page's buttons on top
// (how many play now, sound, language, full screen, the account); the player's orb on its pedestal (arrows switch
// the style, "Customize Orb" opens the full picker), the name and the record, the stats and the tutorial beside them;
// the Survival card, the run set up in it (the wave, the weapon, PLAY); under it the Workshop (what it is for, the
// Cores, the levels: Erick found it unclear), the Vesuvius and the Multiplayer (the mode, PLAY NOW, a room with
// friends); the ranking on the right (src/menu/lobbyRanking.ts); a banner in a gutter on the left. The background is
// a picture of a fight rendered by the game itself (tools/make-menu-bg.mjs), with drifting orbs and sparks on top.
import * as THREE from 'three';
import { modeName, modeShort, modeTagline } from '../client/modes';
import { bestKills } from '../client/records';
import { loadWavesRecord } from '../client/waves';
import { weaponLook } from '../client/wavesPrize';
import { MILESTONES, UPGRADES, affordable, balance, dailyState, loadProgress as loadWavesProgress, nextCost, saveProgress, startWeapons } from '../client/wavesProgress';
import { LANG_KEY, bigNum, lang, num, t, type Key, type Lang } from '../i18n';
import { MAX_NAME_LENGTH, ROOM_MODES, cleanName, isReservedName, limitNameInput, type RoomMode, type RoomStatus } from '../net/protocol';
import type { Account } from './account';
import { AccountModal, debugUnlockOn } from './accountModal';
import { StatsModal } from './statsModal';
import { AdblockModal } from './adblockModal';
import { RankingModal } from './rankingModal';
import { LobbyRanking } from './lobbyRanking';
import { PcOnlyModal, sendLink, touchOnly } from './pcOnly';
import { RoomModal, type PrivateRoomJoin } from './roomModal';
import { isOldGeneratedName, randomGuestName } from './guestNames';
import { Embers } from './embers';
import { icon, type IconName } from './icons';
import { OrbPicker } from './orbPicker';
import { crownSway, turning, type OrbStudio } from './orbStudio';
import { FREE_SKINS, availableSkins, liveSkin, saveSettings, setTestUnlock, skinInfo, wornCrown, type Settings } from './settings';
import { TrainingModal } from './training';
import { TutorialModal, tutorialSeen, type TutorialAnswer } from './tutorialModal';
import type { TutorialKind } from '../client/tutorial';
import { UPGRADE_ICON, WavesModal, coreIcon, startFacts, startOptions } from './wavesModal';
import { VESUVIUS_WAVE, type VesuviusAccess } from '../sim/vesuvius';
import { versioned } from '../sim/assetVersion';
import { adBlocked, adsAllowed, mountAd, onAdBlockFound, onAdsAllowed, refreshAd, type AdSlot } from '../client/ads';
import { track } from '../client/analytics';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type PlayMode = 'online' | 'offline';

/** The lobby is laid out at this size (design px) and zoomed into the window. */
const LOBBY_W = 1290;
const LOBBY_H = 680;
/** Room the top bar takes above the lobby, and the footer below it (real px). */
const TOP_ROOM = 74;
const BOTTOM_ROOM = 30;
/** Below this width the lobby stacks in one column (and shows no banner). */
const NARROW_WIDTH = 980;
/** The lobby is never squeezed narrower than this to make room for a banner (real px). */
const MIN_LOBBY_W = 1000;
/** A banner is centred on the window's height (.ad-slot): this much of it stays clear, above (the top bar) and below. */
const AD_CLEAR = 132;
/** The orb on the pedestal is drawn this big (design px: the stage's 190 px, zoomed 0.7 in menu.css). */
const ORB_PX = 190 * 0.7;
/** The Workshop card's upgrades: the ones every run feels, each with its level. */
const CARD_UPGRADES = ['damage', 'fire', 'life', 'armor'] as const;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

/** The banners of the left gutter: their element, ad unit and size (with the label above). */
interface SideAd {
  id: string;
  slot: AdSlot;
  width: number;
  height: number;
}
const SKY: SideAd = { id: 'adSky', slot: 'sky', width: 160, height: 600 };
const RECT: SideAd = { id: 'adRect', slot: 'rect', width: 300, height: 250 };
const SIDE_ADS = [SKY, RECT];
/** Room kept around a banner (the gap to the lobby and to the window's edge), and the label's height. */
const AD_MARGIN = 28;
const AD_LABEL = 18;
/** Back on the start screen after this long, the banners load again. */
const AD_REFRESH_MS = 60_000;

export class StartScreen {
  private readonly root = $('start');
  private readonly preview = $<HTMLCanvasElement>('orbPreview');
  private readonly nameInput = $<HTMLInputElement>('name');
  private readonly controls = $('controlsModal');
  private readonly picker: OrbPicker;
  private readonly training: TrainingModal;
  private readonly accountModal: AccountModal;
  private readonly statsModal: StatsModal;
  private readonly waves: WavesModal;
  private readonly adblock = new AdblockModal();
  /** Phones and tablets: the window that says where to play (src/menu/pcOnly.ts) */
  private readonly pcModal = new PcOnlyModal(() => this.ranking.open());
  /** The first time in the waves or online: the tutorial, or play now */
  private readonly tutorialAsk = new TutorialModal();
  private readonly ranking: RankingModal;
  private readonly lobbyRanking: LobbyRanking;
  /** The ranking tab of the mode being played, for the way back (null: leave it as it is). */
  private playedTab: 'online' | 'waves' | 'vesuvius' | null = null;
  private readonly room: RoomModal;
  /** The account whose Orb was already brought into this page's settings. */
  private orbSyncedFor = '';
  private readonly embers: Embers | null;
  private statusTimer = 0;
  /** The server's rooms (/health), null while unknown or unreachable. */
  private rooms: Partial<Record<RoomMode, RoomStatus>> | null = null;
  /** Players in private rooms (they count in "who plays now"). */
  private privatePlayers = 0;
  private serverUp: boolean | null = null;
  private rafId = 0;
  /** When the side banners were loaded (0: not yet). */
  private adsAt = 0;
  /** The banner the left gutter holds now (null: none, and no gutter). */
  private adSlot: SideAd | null = null;
  /** The Orb drawn in the account button (its skin and colours), not to draw it again. */
  private avatarKey = '';
  /** The server's word on the Vesuvius for its card (`key`: the account and the test switch), a minute's answer kept. */
  private vesuvius: { key: string; at: number; access: VesuviusAccess | null } | null = null;
  private spin = 0;
  private lastTime = 0;

  constructor(
    private readonly settings: Settings,
    private readonly studio: OrbStudio,
    private readonly account: Account,
    private readonly onPlay: (mode: PlayMode) => void,
    onWaves: () => void,
    /** A private room to join (made here, or an invitation). */
    onPrivate: (room: PrivateRoomJoin) => void,
    /** A tutorial (src/client/tutorial.ts): asked the first time, or chosen in Training. */
    onTutorial: (kind: TutorialKind) => void,
    /** The Vesuvius (src/sim/vesuvius.ts), from the Survival window's tab once the server opened it. */
    onVesuvius: () => void,
  ) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) el.innerHTML = icon(el.dataset.icon as IconName, 20);

    this.nameInput.value = settings.name;
    this.nameInput.maxLength = MAX_NAME_LENGTH * 2;
    // The name's rules (cleanName): what is kept as it is typed; a name that would pass for the game's
    // staff isn't (the hint says why)
    this.nameInput.addEventListener('input', () => {
      const typed = limitNameInput(this.nameInput.value);
      if (typed !== this.nameInput.value) this.nameInput.value = typed;
      const name = cleanName(typed);
      const reserved = isReservedName(name);
      settings.name = reserved ? '' : name;
      saveSettings(settings);
      this.showNameHint(reserved ? t('name.reserved') : '');
    });
    // Left: the field shows the name as it will be used; signed in, it is saved to the account
    this.nameInput.addEventListener('change', () => {
      if (!isReservedName(cleanName(this.nameInput.value))) this.nameInput.value = this.settings.name;
      void this.claimName();
    });

    this.accountModal = new AccountModal(account, settings, studio, (name) => this.setName(name), () => this.applyTestUnlock());
    // The testers' switch follows the account (its debug tools come a moment after signing in)
    account.onChange(() => this.applyTestUnlock());
    $('btnAccount').addEventListener('click', () => this.accountModal.open());
    // Which windows of the start screen are opened (analytics)
    const opens: [string, string][] = [['btnAccount', 'account'], ['btnStats', 'stats'], ['lrFull', 'ranking'], ['training', 'training'], ['btnControls', 'controls'], ['orbButton', 'orb'], ['orbCustomize', 'orb'], ['btnPrivate', 'private'], ['cardWorkshop', 'waves'], ['cardVesuvius', 'vesuvius']];
    for (const [id, name] of opens) $(id).addEventListener('click', () => track('menu_open', { window: name }));
    this.statsModal = new StatsModal(account, () => this.accountModal.open());
    $('btnStats').addEventListener('click', () => this.statsModal.open());
    this.ranking = new RankingModal(account, () => this.accountModal.open(), studio);
    this.lobbyRanking = new LobbyRanking(
      account,
      () => this.settings.mode,
      (mode) => this.ranking.open(mode),
      () => this.accountModal.open(),
    );
    this.room = new RoomModal(
      () => this.settings.mode,
      account,
      () => this.accountModal.open(),
      (room) => {
        this.play('online', false);
        onPrivate(room);
      },
    );
    $('btnPrivate').addEventListener('click', () => this.room.open());
    // The Workshop's and the Vesuvius's cards are buttons, all of them: the Survival window on that tab
    $('cardWorkshop').addEventListener('click', () => this.openWaves());
    $('cardVesuvius').addEventListener('click', () => this.openWaves('vesuvius'));
    // The run set up on the Survival card: the wave and the weapon, the same choice as the Workshop's (saved in the progress)
    $('svStarts').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-start]');
      if (b && !b.disabled) this.chooseRun({ startWave: Number(b.dataset.start) });
    });
    $('svWeapon').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-weapon]');
      if (b && !b.disabled) this.chooseRun({ startWeapon: Number(b.dataset.weapon) });
    });
    this.waves = new WavesModal(
      account,
      studio,
      () => skinInfo(this.settings),
      () => {
        this.play('offline', false);
        this.playedTab = 'waves';
        onWaves();
      },
      () => this.accountModal.open(),
      () => this.renderProgress(),
      () => {
        this.play('offline', false);
        this.playedTab = 'vesuvius';
        onVesuvius();
      },
    );
    // The first time: the tutorial, or a run at once (no Workshop yet: nothing to buy)
    const tutorial = (kind: TutorialKind) => {
      this.play('offline', false);
      onTutorial(kind);
    };
    // PLAY on the Survival card: the run as set up there (the first time, the tutorial is offered first)
    $('wavesPlay').addEventListener('click', () => {
      void this.firstTime('waves').then((a) => {
        if (a === 'tutorial') tutorial('waves');
        else if (a === 'play' || a === 'none') {
          this.play('offline', false);
          this.playedTab = 'waves';
          onWaves();
        }
      });
    });
    account.onChange(() => this.renderAccount());
    this.renderAccount();

    this.picker = new OrbPicker(studio, settings, () => this.saveOrb());
    this.training = new TrainingModal(
      settings,
      () => {
        saveSettings(settings);
        this.play('offline');
      },
      () => this.markMode(),
      tutorial,
    );
    this.buildModes();
    for (const id of ['orbButton', 'orbCustomize']) $(id).addEventListener('click', () => this.picker.open());
    $('orbPrev').addEventListener('click', () => this.cycleSkin(-1));
    $('orbNext').addEventListener('click', () => this.cycleSkin(1));
    $('training').addEventListener('click', () => this.training.open());
    $<HTMLFormElement>('startForm').addEventListener('submit', (e) => {
      e.preventDefault();
      // The first time: the shooting range's tutorial, or the match
      void this.firstTime('pvp').then((a) => {
        if (a === 'tutorial') tutorial('pvp');
        else if (a === 'play' || a === 'none') this.play('online');
      });
    });

    // Controls window (a link in the footer, beside How to play)
    $('btnControls').addEventListener('click', (e) => {
      e.preventDefault();
      this.controls.hidden = false;
    });
    for (const el of this.controls.querySelectorAll('[data-close]')) el.addEventListener('click', () => (this.controls.hidden = true));
    this.controls.addEventListener('pointerdown', (e) => {
      if (e.target === this.controls) this.controls.hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.controls.hidden = true;
    });

    const fullscreen = $('btnFullscreen');
    const updateFullscreen = () => {
      const on = !!document.fullscreenElement;
      fullscreen.innerHTML = icon(on ? 'minimize' : 'maximize', 20);
      fullscreen.title = t(on ? 'menu.exitFullscreen' : 'menu.fullscreen');
    };
    fullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    });
    document.addEventListener('fullscreenchange', updateFullscreen);
    updateFullscreen();
    if (!document.documentElement.requestFullscreen) fullscreen.hidden = true;

    this.setupLanguage();

    // Phones and tablets: the game needs a keyboard and a mouse; the rest of the page works (src/menu/pcOnly.ts)
    $('touchNotice').hidden = !touchOnly();
    $('touchShare').addEventListener('click', () => void sendLink('card', $('touchCopied')));

    this.fit();
    window.addEventListener('resize', () => this.fit());
    onAdsAllowed(() => {
      this.fit(true);
      this.checkAdBlock();
    });
    // Found later by the banners themselves: their spots go (the request waits for a match, beforePlay)
    onAdBlockFound(() => this.fit());
    // The Survival card: the waves' boss and its wave, a moment of the game (tools/make-menu-cards.mjs --waves); the
    // Vesuvius's arena (--vesuvius)
    $('wavesPic').style.backgroundImage = `url('${versioned('/menu/card-waves.webp')}')`;
    $('vesPic').style.backgroundImage = `url('${versioned('/menu/card-vesuvius.webp')}')`;
    this.embers = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : new Embers($<HTMLCanvasElement>('bgSparks'));
    void this.makeBackground();
  }

  /**
   * The language button and its menu: real links to each language's page (crawlers follow them
   * too); a click also saves the choice, which the script at the top of index.html reads at "/".
   */
  private setupLanguage(): void {
    const button = $('btnLang');
    const menu = $('langMenu');
    $('langCode').textContent = lang().toUpperCase();
    for (const a of menu.querySelectorAll<HTMLAnchorElement>('a[data-lang]')) {
      const l = a.dataset.lang as Lang;
      if (l === lang()) a.setAttribute('aria-current', 'true');
      a.addEventListener('click', () => {
        if (l !== lang()) track('language_change', { from: lang(), to: l });
        try {
          localStorage.setItem(LANG_KEY, l);
        } catch {
          /* storage unavailable: the address keeps the language */
        }
      });
    }
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('pointerdown', (e) => {
      const target = e.target as Node;
      if (!menu.hidden && !menu.contains(target) && !button.contains(target)) menu.hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.hidden = true;
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(message = ''): void {
    this.root.hidden = false;
    // Always the lobby first (not the text below it, where the page may have been scrolled)
    this.root.scrollTop = 0;
    const box = $('message');
    box.textContent = message;
    box.hidden = !message;
    this.lastTime = performance.now();
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    void this.refreshStatus();
    this.renderProgress();
    // Back from a run: the ranking of the mode just played
    this.lobbyRanking.refresh(this.playedTab ?? undefined);
    this.playedTab = null;
    this.fit(this.adsAt > 0 && performance.now() - this.adsAt > AD_REFRESH_MS);
    this.checkAdBlock();
  }

  /**
   * Every time the start screen opens: whether an ad blocker is on (its banners' spots go). It no longer asks
   * here (20/10/2026: the window covered the page for visitors the ad network sent nothing to): beforePlay.
   */
  private checkAdBlock(): void {
    void adBlocked().then(() => this.fit());
  }

  /** A match is about to start (src/main.ts startGame): counted, and from the second one an ad blocker asks first. */
  beforePlay(): Promise<void> {
    return this.adblock.beforePlay();
  }

  /**
   * The first time in a mode (the waves, online), the tutorial or play now (src/menu/tutorialModal.ts); 'none': not
   * asked (asked before, played the mode before, or a touch-only device, which plays nothing).
   */
  private firstTime(kind: TutorialKind): Promise<TutorialAnswer | 'none'> {
    if (touchOnly() || tutorialSeen(kind) || this.playedBefore(kind)) return Promise.resolve('none');
    return this.tutorialAsk.ask(kind);
  }

  /** That mode played before: this browser's records and Cores, the account's. */
  private playedBefore(kind: TutorialKind): boolean {
    if (kind === 'waves') return !!loadWavesRecord() || loadWavesProgress().earned > 0 || !!this.account.waves;
    return ROOM_MODES.some((m) => bestKills(m) > 0 || (this.account.stats[m]?.matches ?? 0) > 0);
  }

  hide(): void {
    this.root.hidden = true;
    this.picker.close();
    this.training.close();
    this.accountModal.close();
    this.statsModal.close();
    this.ranking.close();
    this.adblock.close();
    this.pcModal.close();
    this.tutorialAsk.close();
    this.controls.hidden = true;
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.statusTimer);
    this.embers?.clear();
  }

  /** A phone or a tablet tried to play (src/main.ts startGame): `from`, what (for the analytics). */
  pcOnly(from: string): void {
    this.pcModal.open(from);
  }

  /** `start`: false only gives the player a name (the waves start on their own). */
  private play(mode: PlayMode, start = true): void {
    if (!this.settings.name || isOldGeneratedName(this.settings.name)) {
      // Like the .io games: a name for those who don't pick one (a war word and three digits)
      this.settings.name = randomGuestName();
      this.nameInput.value = this.settings.name;
      saveSettings(this.settings);
    }
    if (start) {
      if (mode === 'online') this.playedTab = 'online';
      this.onPlay(mode);
    }
  }

  /** The private room window: making one, or joining this one (an invitation link). */
  openRoom(code?: string): void {
    this.room.open(code);
  }

  /** The arrows beside the orb: the previous or next style, same colours. */
  private cycleSkin(step: number): void {
    const skins = availableSkins();
    const i = Math.max(0, skins.indexOf(this.settings.skin));
    this.settings.skin = skins[(i + step + skins.length) % skins.length];
    this.saveOrb();
  }

  /** The Orb is kept in this browser and, signed in, in the account. */
  private saveOrb(): void {
    saveSettings(this.settings);
    const { skin, red, green, blue } = this.settings;
    if (this.account.signedIn) this.account.saveOrb({ skin, red, green, blue });
    this.renderAvatar();
  }

  /** Signed in, the account button shows the player's Orb. */
  private renderAvatar(): void {
    const img = $<HTMLImageElement>('accountAvatar');
    const signed = this.account.signedIn;
    img.hidden = !signed;
    $('accountIcon').hidden = signed;
    if (!signed) return;
    const { skin, red, green, blue } = this.settings;
    const key = [skin, red, green, blue].join();
    if (key === this.avatarKey) return;
    this.avatarKey = key;
    void this.studio.picture(skinInfo(this.settings), 72).then((src) => {
      if (this.avatarKey === key) img.src = src;
    });
  }

  /**
   * The lobby's numbers, from this browser and the account: the waves' record (else the online record of the chosen
   * mode), the run set up on the Survival card, the Workshop's Cores and levels, the Vesuvius.
   */
  private renderProgress(): void {
    const waves = loadWavesRecord();
    const mode = this.settings.mode;
    const kills = Math.max(bestKills(mode), this.account.stats[mode]?.bestKills ?? 0);
    $('heroChips').innerHTML = waves
      ? `<span class="hero-chip">${t('menu.wavesChip', { n: `<b>${waves.wave}</b>` })}${waves.time !== null ? ` · ${clock(waves.time)}` : ''}</span>`
      : kills > 0
        ? `<span class="hero-chip">${t('menu.recordChip', { mode: modeShort(mode), n: `<b>${num(kills)}</b>` })}</span>`
        : '';
    this.renderRun();
    this.renderWorkshop();
    this.renderVesuvius();
  }

  /**
   * The run on the Survival card: the wave to start on (the first or a checkpoint reached, between two arrows, like the
   * Workshop's picker), what that start brings, the starting weapon (the open ones), and PLAY with the wave.
   */
  private renderRun(): void {
    const record = loadWavesRecord()?.wave ?? 0;
    const tester = this.account.debugTools.zoom;
    const { startWave, startWeapon } = WavesModal.startChoice(tester);
    const options = startOptions(record, tester);
    const at = Math.max(0, options.indexOf(startWave));
    const arrow = (to: number | undefined, name: IconName, label: Key) =>
      `<button type="button" class="sv-arrow"${to === undefined ? ' disabled' : ` data-start="${to}"`} aria-label="${t(label)}">${icon(name, 18)}</button>`;
    $('svStarts').innerHTML =
      arrow(options[at - 1], 'chevron_left', 'workshop.prevWave') +
      `<div class="sv-wave"><span>${t('workshop.waveLabel')}</span><b>${startWave}</b></div>` +
      arrow(options[at + 1], 'chevron_right', 'workshop.nextWave');
    // No checkpoint yet: how to get one; else what this start brings (the Workshop says the same)
    const f = startFacts(startWave, tester);
    $('svFacts').innerHTML =
      options.length < 2
        ? `<p class="sv-note">${t('workshop.startLocked')}</p>`
        : `<div><small>${t('workshop.timeShort')}</small><b>${f.time}</b></div><div><small>${t('workshop.permsShort')}</small><b>${f.perms}</b></div><div><small>${t('workshop.cardsShort')}</small><b>${f.cards}</b></div>`;
    // The weapon: the open ones, one at a time (the locked ones and their waves are in the Workshop)
    const open = startWeapons(record);
    const i = Math.max(0, open.indexOf(startWeapon));
    const look = weaponLook(open[i]);
    // (one open: the wave that gives the next one, on hover)
    const next = MILESTONES.find((m) => 'weapon' in m && m.wave > record);
    const hint = next ? ` title="${t('workshop.reach', { n: next.wave })}"` : '';
    const step = (d: number, name: IconName, label: Key) =>
      `<button type="button" class="sv-arrow"${open.length < 2 ? ' disabled' : ` data-weapon="${open[(i + d + open.length) % open.length]}"`} aria-label="${t(label)}">${icon(name, 18)}</button>`;
    $('svWeapon').innerHTML =
      step(-1, 'chevron_left', 'workshop.prevWeapon') +
      `<div class="sv-gun"${open.length < 2 ? hint : ''}>${look.picture ? `<img src="${look.picture}" alt="" />` : ''}<b>${look.name}</b></div>` +
      step(1, 'chevron_right', 'workshop.nextWeapon');
    $('wavesPlayText').textContent = t('workshop.play', { n: startWave });
  }

  /** A wave or a weapon chosen on the Survival card (the Workshop shows the same choice). */
  private chooseRun(change: { startWave?: number; startWeapon?: number }): void {
    saveProgress({ ...loadWavesProgress(), ...change });
    this.renderRun();
  }

  /**
   * The Workshop's card (Erick, 02/11/2026: what it is had to be clear): the Cores, the upgrades every run feels with
   * their levels (lit when the Cores pay for the next one), and the badge: today's reward waiting, else how many
   * upgrades the Cores pay for.
   */
  private renderWorkshop(): void {
    const wp = loadWavesProgress();
    const cash = balance(wp);
    $('wavesCores').innerHTML = `${coreIcon(16)}${t('menu.wavesCores', { n: bigNum(cash) })}`;
    $('wsLevels').innerHTML = CARD_UPGRADES.map((id) => {
      const u = UPGRADES.find((x) => x.id === id)!;
      const level = wp.levels[id];
      const cost = nextCost(u, wp.levels);
      const can = cost !== null && cost <= cash;
      return `<span class="ws-lv${can ? ' can' : ''}" title="${t(`up.${id}`)} · ${t('workshop.levelN', { n: level })}">${icon(UPGRADE_ICON[id], 16)}<b>${t('waves.permLevel', { n: level })}</b></span>`;
    }).join('');
    const canBuy = affordable(wp);
    const daily = dailyState(wp).ready;
    const badge = $('wavesBadge');
    badge.hidden = !daily && canBuy === 0;
    badge.classList.toggle('daily', daily);
    badge.textContent = daily ? t('menu.dailyReady') : t('lobby.canBuy', { n: canBuy });
  }

  /**
   * The Vesuvius's card: open when the server says so (a checked record past wave 100, or a tester's switch: asked
   * here for signed-in players, a minute's answer kept), else locked with the record's way to wave 100.
   */
  private renderVesuvius(): void {
    const test = debugUnlockOn(this.account.debugTools.zoom);
    const key = `${this.account.session?.user.id ?? ''}|${test}`;
    const v = this.vesuvius;
    if (this.account.signedIn && (v?.key !== key || Date.now() - v.at > 60_000)) {
      const asked = { key, at: Date.now(), access: v?.key === key ? v.access : null };
      this.vesuvius = asked;
      void this.account.vesuviusAccess(test).then((access) => {
        if (this.vesuvius !== asked) return;
        asked.access = access;
        if (this.visible) this.renderVesuvius();
      });
    }
    const open = this.account.signedIn && this.vesuvius?.key === key && !!this.vesuvius.access?.open;
    $('cardVesuvius').classList.toggle('locked', !open);
    $('vesIco').innerHTML = icon(open ? 'flame' : 'lock', 20);
    const wave = Math.min(VESUVIUS_WAVE, loadWavesRecord()?.wave ?? 0);
    $('vesBody').innerHTML = open
      ? `<span class="mc-btn vesuvius">${t('lobby.vesuviusForge')}</span>`
      : `<b class="ves-lock">${t('vesuvius.locked')}</b><span class="ves-bar"><i style="width:${(wave / VESUVIUS_WAVE) * 100}%"></i></span><small>${t('vesuvius.progress', { n: wave })}</small>`;
  }

  /** The testers' "every style and crown open" (the account window), on an account the server allows. */
  private applyTestUnlock(): void {
    setTestUnlock(debugUnlockOn(this.account.debugTools.zoom));
  }

  /** The waves' Workshop (its card, or back from a run that asked for it): the ranking beside it on the Survival tab. */
  openWaves(mode: 'waves' | 'vesuvius' = 'waves'): void {
    this.lobbyRanking.showTab(mode);
    this.waves.open(mode);
  }

  private setName(name: string): void {
    this.settings.name = name;
    this.nameInput.value = name;
    saveSettings(this.settings);
  }

  /**
   * The top bar's account button (the name once signed in). The first time an account's profile
   * arrives, an existing account brings its Orb and name; a new one takes this browser's Orb.
   */
  private renderAccount(): void {
    const button = $('btnAccount');
    const label = $('accountLabel');
    const account = this.account;
    const p = account.profile;
    button.classList.toggle('signed-in', account.signedIn);
    label.textContent = account.signedIn ? (p?.name ?? t('account.mine')) : t('account.signIn');
    button.title = account.signedIn ? t('account.mine') : t('account.signIn');
    // The account's player ID: in the button and beside the name under the Orb
    const tag = account.signedIn && p?.tag ? `#${p.tag}` : '';
    for (const id of ['accountChipTag', 'playerTag']) {
      const el = $(id);
      el.textContent = tag;
      el.hidden = !tag;
    }
    const id = account.session?.user.id ?? '';
    if (p && id && this.orbSyncedFor !== id) {
      this.orbSyncedFor = id;
      const { skin, red, green, blue } = this.settings;
      if (p.name) {
        Object.assign(this.settings, { skin: liveSkin(p.skin), red: p.red, green: p.green, blue: p.blue });
        this.setName(p.name);
      } else account.saveOrb({ skin, red, green, blue }, true);
    }
    if (!account.signedIn) this.orbSyncedFor = '';
    this.renderAvatar();
    this.renderProgress();
    // The account button's width changed: a narrow window's top bar may wrap differently
    requestAnimationFrame(() => this.fit());
  }

  /** Signed in: the name typed is saved to the account (back to the old one if it can't be). */
  private async claimName(): Promise<void> {
    const p = this.account.profile;
    if (!this.account.signedIn || !p) return;
    const name = this.settings.name;
    if (!name || name === p.name) {
      if (p.name) this.setName(p.name);
      return;
    }
    const err = await this.accountModal.saveName(name, true);
    if (err) {
      this.showNameHint(t(err === 'taken' ? 'account.taken' : err === 'invalid' ? 'account.invalid' : 'account.error'));
      if (p.name) this.setName(p.name);
    }
  }

  private showNameHint(text: string): void {
    const hint = $('nameHint');
    hint.textContent = text;
    hint.hidden = !text;
  }

  /**
   * The lobby (LOBBY_W x LOBBY_H design px) zoomed into the window under the top bar, beside the
   * banner's gutter on the left; below NARROW_WIDTH it stacks in one column, zoomed by the width. Then
   * the banner: loaded the first time it shows, and again when `reloadAds`.
   */
  private fit(reloadAds = false): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // (a tablet too, however wide: one column, the card on top)
    const narrow = w < NARROW_WIDTH || touchOnly();
    this.root.classList.toggle('narrow', narrow);
    // The lobby starts under the top bar: a narrow window's may take two rows; a wide one's logo and tagline, on the
    // left above your Orb, may be taller than TOP_ROOM
    const top = narrow
      ? Math.ceil(document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect().bottom) + 18
      : Math.max(TOP_ROOM, Math.ceil(document.querySelector<HTMLElement>('.topbar .brand')!.getBoundingClientRect().bottom - this.root.getBoundingClientRect().top) + 6);
    document.documentElement.style.setProperty('--top-room', `${top}px`);
    // The skyscraper where the window is tall enough, else the rectangle, never squeezing the lobby too much
    const room = h - (narrow ? TOP_ROOM : top) - BOTTOM_ROOM;
    const fits = (ad: SideAd) => w - (ad.width + AD_MARGIN * 2) >= MIN_LOBBY_W && h >= ad.height + AD_LABEL + AD_CLEAR;
    this.adSlot = narrow || !adsAllowed() ? null : fits(SKY) ? SKY : fits(RECT) ? RECT : null;
    const gutter = this.adSlot ? this.adSlot.width + AD_MARGIN * 2 : 0;
    document.documentElement.style.setProperty('--ad-gutter', `${gutter}px`);
    const k = narrow ? Math.max(0.5, Math.min(1, (w - 24) / 560)) : Math.max(0.55, Math.min(1.5, room / LOBBY_H, (w - gutter - 32) / LOBBY_W));
    document.documentElement.style.setProperty('--menu-k', k.toFixed(3));
    // The orb's canvas as sharp as the screen shows it (zoomed, times the pixel ratio)
    const px = Math.min(768, Math.max(190, Math.ceil(ORB_PX * k * (window.devicePixelRatio || 1))));
    if (this.preview.width !== px) this.preview.width = this.preview.height = px;
    this.placeAds(reloadAds);
  }

  /** The banner in the left gutter (fit chose it): shown and loaded, the other one hidden. */
  private placeAds(reload = false): void {
    if (!this.visible && !reload) return;
    let any = false;
    for (const ad of SIDE_ADS) {
      const el = $(ad.id);
      const on = this.adSlot === ad;
      el.hidden = !on;
      if (!on) continue;
      const frame = el.querySelector<HTMLElement>('.ad-frame')!;
      // A new ad replaces the old one only once it is loaded (refreshAd): no blank moment
      if (!frame.firstChild) {
        mountAd(frame, ad.slot);
        any = true;
      } else if (reload) {
        refreshAd(frame, ad.slot);
        any = true;
      }
    }
    if (any) this.adsAt = performance.now();
  }

  /** The Multiplayer card's modes: one button each (its short name, how many play it now). */
  private buildModes(): void {
    const box = $('modes');
    for (const mode of ROOM_MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mode mode-${mode}`;
      b.dataset.mode = mode;
      b.setAttribute('role', 'radio');
      b.title = `${modeName(mode)} · ${modeTagline(mode)}`;
      b.innerHTML = `<span>${modeShort(mode)}</span><span class="mode-count" hidden></span>`;
      b.addEventListener('click', () => {
        if (this.settings.mode !== mode) track('select_mode', { mode });
        this.settings.mode = mode;
        saveSettings(this.settings);
        this.markMode();
      });
      box.appendChild(b);
    }
    this.markMode();
  }

  private markMode(): void {
    const mode = this.settings.mode;
    for (const b of $('modes').querySelectorAll<HTMLElement>('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    // The card's picture: a moment of a match in that mode (tools/make-menu-cards.mjs)
    $('onlinePic').style.backgroundImage = `url('${versioned(`/menu/card-${mode}.webp`)}')`;
    this.renderStatus();
    this.renderProgress();
    if (this.visible) this.lobbyRanking?.refresh();
  }

  /** The game server of this page: is it up, and who plays in each mode. */
  private async refreshStatus(): Promise<void> {
    clearTimeout(this.statusTimer);
    if (this.root.hidden) return;
    try {
      const res = await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(String(res.status));
      const st = (await res.json()) as RoomStatus & { rooms?: Partial<Record<RoomMode, RoomStatus>>; privatePlayers?: number };
      this.privatePlayers = st.privatePlayers ?? 0;
      // An older server has one Deathmatch room only
      this.rooms = st.rooms ?? { dm: { map: st.map, players: st.players, maxPlayers: st.maxPlayers } };
      this.serverUp = true;
    } catch {
      this.rooms = null;
      this.serverUp = false;
    }
    this.renderStatus();
    this.statusTimer = window.setTimeout(() => void this.refreshStatus(), 5000);
  }

  /** The "online" pill, the count on each mode card, and the line under JOGAR AGORA (online, multiplayer). */
  private renderStatus(): void {
    const pill = $('serverStatus');
    const text = pill.querySelector('.status-text')!;
    const sub = $('playSub');
    for (const b of $('modes').querySelectorAll<HTMLElement>('[data-mode]')) {
      const room = this.rooms?.[b.dataset.mode as RoomMode];
      const count = b.querySelector<HTMLElement>('.mode-count')!;
      count.hidden = !room || room.players === 0;
      count.textContent = room ? String(room.players) : '';
      count.title = room ? t('menu.playing', { n: room.players }) : '';
      b.classList.toggle('closed', this.serverUp === true && !room);
    }
    sub.textContent = t('menu.playMode', { mode: modeName(this.settings.mode) });
    if (this.serverUp === null) return;
    if (!this.serverUp) {
      text.textContent = t('menu.serverDown');
      pill.className = 'online-pill down';
      return;
    }
    const total = Object.values(this.rooms ?? {}).reduce((n, r) => n + (r?.players ?? 0), this.privatePlayers);
    text.textContent = total === 0 ? t('menu.nobody') : total === 1 ? t('menu.onePlayer') : t('menu.players', { n: total });
    pill.className = 'online-pill ok';
    const room = this.rooms?.[this.settings.mode];
    if (!room) sub.textContent = t('menu.modeClosed', { mode: modeName(this.settings.mode) });
    // maxPlayers counts every free seat of the server (all the rooms of the mode, and the ones it can still open)
    else if (room.maxPlayers && room.players >= room.maxPlayers) sub.textContent = t('menu.full');
  }

  private drawing = false;

  /** The player's orb rolls slowly on its pedestal, the sparks drift. */
  private frame(now: number): void {
    if (this.root.hidden) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.embers?.step(dt);
    if (this.picker.isOpen || this.drawing) return; // the picker has its own preview
    this.spin += dt;
    this.drawing = true;
    void this.studio
      .texture(skinInfo(this.settings), true)
      .then((tex) => this.studio.draw(this.preview, tex, turning(this.settings.skin, this.spin, 1.1), wornCrown(this.settings), crownSway(this.spin)))
      .finally(() => (this.drawing = false));
  }

  /** The rendered fight fades in; orbs of every style drift far behind the menu. */
  private async makeBackground(): Promise<void> {
    const scene = $('bgScene');
    const img = new Image();
    img.src = versioned('/menu-bg.webp');
    img
      .decode()
      .then(() => {
        scene.style.backgroundImage = `url("${img.src}")`;
        scene.classList.add('ready');
      })
      .catch(() => {});

    const layer = $('bgOrbs');
    // [left %, top %, size px, far]
    const spots = [
      [3, 8, 84, false], [15, 22, 46, true], [26, 5, 38, true], [72, 6, 44, true],
      [83, 17, 70, false], [93, 8, 40, true], [58, 20, 30, true],
    ] as const;
    for (const [x, y, size, far] of spots) {
      const hue = Math.random();
      const base = hsl(hue, 0.85, 0.45);
      const info = skinInfo({
        skin: FREE_SKINS[Math.floor(Math.random() * FREE_SKINS.length)],
        red: hsl(hue, 0.9, 0.75),
        green: base,
        blue: hsl(hue, 0.9, 0.22),
      });
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
      const img = document.createElement('img');
      img.src = await this.studio.picture(info, 160, rot);
      img.className = far ? 'bg-orb far' : 'bg-orb';
      img.alt = '';
      img.style.left = `${x}%`;
      img.style.top = `${y}%`;
      img.style.width = img.style.height = `${size}px`;
      img.style.setProperty('--dur', `${16 + Math.random() * 12}s`);
      img.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 80)}px`);
      img.style.setProperty('--dy', `${Math.round((Math.random() - 0.5) * 60)}px`);
      img.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 400)}deg`);
      img.style.animationDelay = `${-Math.random() * 20}s`;
      layer.appendChild(img);
    }
  }
}

function hsl(h: number, s: number, l: number): string {
  const c = new THREE.Color().setHSL(h, s, l);
  return `#${c.getHexString()}`;
}

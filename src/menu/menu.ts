// The start screen, a lobby (mockup A, approved by Erick): the logo and the page's buttons on top (how
// many play now, sound, language, full screen, the account); the player's orb big on its pedestal in
// the middle (arrows switch the style, "Customize Orb" opens the full picker), the name and the online
// record; on the right the online play (the mode, PLAY NOW, a private room, the offline training);
// below, the campaign and the waves with the player's progress, the ranking, the stats and the
// controls; a banner in a gutter on the left. The background is a picture of a fight rendered by the
// game itself (tools/make-menu-bg.mjs), with drifting orbs and sparks on top.
import * as THREE from 'three';
import { modeName, modeShort, modeTagline } from '../client/modes';
import { CAMPAIGN, LEVELS_PER_CHAPTER, loadProgress } from '../client/campaign';
import { bestKills } from '../client/records';
import { loadWavesRecord } from '../client/waves';
import { LANG_KEY, lang, num, t, type Lang } from '../i18n';
import { ROOM_MODES, type RoomMode, type RoomStatus } from '../net/protocol';
import type { Account } from './account';
import { AccountModal } from './accountModal';
import { StatsModal } from './statsModal';
import { BOSS_SKIN, CampaignModal } from './campaignModal';
import { AdblockModal } from './adblockModal';
import { RankingModal } from './rankingModal';
import { RoomModal, type PrivateRoomJoin } from './roomModal';
import type { CampaignLevel } from '../client/campaign';
import { isOldGeneratedName, randomGuestName } from './guestNames';
import { Embers } from './embers';
import { icon, type IconName } from './icons';
import { OrbPicker } from './orbPicker';
import { turning, type OrbStudio } from './orbStudio';
import { SKINS, saveSettings, skinInfo, type Settings } from './settings';
import { TrainingModal } from './training';
import { versioned } from '../sim/assetVersion';
import { adsAllowed, mountAd, onAdBlockFound, onAdsAllowed, refreshAd, type AdSlot } from '../client/ads';
import { track } from '../client/analytics';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type PlayMode = 'online' | 'offline';

/** The lobby is laid out at this size (design px) and zoomed into the window. */
const LOBBY_W = 1240;
const LOBBY_H = 700;
/** Room the top bar takes above the lobby, and the footer below it (real px). */
const TOP_ROOM = 74;
const BOTTOM_ROOM = 30;
/** Below this width the lobby stacks in one column (and shows no banner). */
const NARROW_WIDTH = 980;
/** The lobby is never squeezed narrower than this to make room for a banner (real px). */
const MIN_LOBBY_W = 1000;
/** A banner is centred on the window's height (.ad-slot): this much of it stays clear, above (the top bar) and below. */
const AD_CLEAR = 132;
/** The orb on the pedestal is drawn this big (design px: the stage's 190 px, zoomed 1.7 in menu.css). */
const ORB_PX = 190 * 1.7;

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
  private readonly campaign: CampaignModal;
  private readonly adblock = new AdblockModal();
  private readonly ranking: RankingModal;
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
  private spin = 0;
  private lastTime = 0;

  constructor(
    private readonly settings: Settings,
    private readonly studio: OrbStudio,
    private readonly account: Account,
    private readonly onPlay: (mode: PlayMode) => void,
    /** A campaign level chosen (src/menu/campaignModal.ts). */
    onCampaign: (level: CampaignLevel) => void,
    onWaves: () => void,
    /** A private room to join (made here, or an invitation). */
    onPrivate: (room: PrivateRoomJoin) => void,
  ) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) el.innerHTML = icon(el.dataset.icon as IconName, 20);

    this.nameInput.value = settings.name;
    this.nameInput.addEventListener('input', () => {
      settings.name = this.nameInput.value.trim().slice(0, 31);
      saveSettings(settings);
      this.showNameHint('');
    });
    // Signed in, the name is saved to the account when the field is left
    this.nameInput.addEventListener('change', () => void this.claimName());

    this.accountModal = new AccountModal(account, settings, studio, (name) => this.setName(name));
    $('btnAccount').addEventListener('click', () => this.accountModal.open());
    // Which windows of the start screen are opened (analytics)
    const opens: [string, string][] = [['btnAccount', 'account'], ['btnStats', 'stats'], ['btnRanking', 'ranking'], ['btnCampaign', 'campaign'], ['training', 'training'], ['btnControls', 'controls'], ['orbButton', 'orb'], ['orbCustomize', 'orb'], ['btnPrivate', 'private']];
    for (const [id, name] of opens) $(id).addEventListener('click', () => track('menu_open', { window: name }));
    this.statsModal = new StatsModal(account, () => this.accountModal.open());
    $('btnStats').addEventListener('click', () => this.statsModal.open());
    this.ranking = new RankingModal(account, () => this.accountModal.open());
    $('btnRanking').addEventListener('click', () => this.ranking.open());
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
    this.campaign = new CampaignModal(
      account,
      studio,
      (level) => {
        if (!this.settings.name) this.play('offline', false);
        onCampaign(level);
      },
      () => this.accountModal.open(),
    );
    $('btnCampaign').addEventListener('click', () => this.campaign.open());
    $('btnWaves').addEventListener('click', () => {
      track('menu_open', { window: 'waves' });
      this.play('offline', false);
      onWaves();
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
    );
    this.buildModes();
    for (const id of ['orbButton', 'orbCustomize']) $(id).addEventListener('click', () => this.picker.open());
    $('orbPrev').addEventListener('click', () => this.cycleSkin(-1));
    $('orbNext').addEventListener('click', () => this.cycleSkin(1));
    $('training').addEventListener('click', () => this.training.open());
    $<HTMLFormElement>('startForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.play('online');
    });

    // Controls window
    $('btnControls').addEventListener('click', () => (this.controls.hidden = false));
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

    // Phones and tablets: the game needs a keyboard and a mouse
    $('touchNotice').hidden = !(matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);

    this.fit();
    window.addEventListener('resize', () => this.fit());
    onAdsAllowed(() => {
      this.fit(true);
      this.checkAdBlock();
    });
    // Found later by the banners themselves (Brave): the request now, if the start screen shows
    onAdBlockFound(() => {
      this.fit();
      if (this.visible) this.adblock.open();
    });
    // The waves card's boss: the campaign's eye
    void studio.picture(BOSS_SKIN, 144, undefined, true).then((src) => {
      const img = $<HTMLImageElement>('wavesArt');
      img.src = src;
      img.hidden = false;
    });
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
    const box = $('message');
    box.textContent = message;
    box.hidden = !message;
    this.lastTime = performance.now();
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    void this.refreshStatus();
    this.renderProgress();
    this.fit(this.adsAt > 0 && performance.now() - this.adsAt > AD_REFRESH_MS);
    this.checkAdBlock();
  }

  /** Every time the start screen opens: an ad blocker found asks (kindly) to be turned off. */
  private checkAdBlock(): void {
    void this.adblock.check(() => this.visible).then(() => this.fit());
  }

  hide(): void {
    this.root.hidden = true;
    this.picker.close();
    this.training.close();
    this.accountModal.close();
    this.statsModal.close();
    this.campaign.close();
    this.ranking.close();
    this.adblock.close();
    this.controls.hidden = true;
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.statusTimer);
    this.embers?.clear();
  }

  /** `start`: false only gives the player a name (the campaign starts on its own). */
  private play(mode: PlayMode, start = true): void {
    if (!this.settings.name || isOldGeneratedName(this.settings.name)) {
      // Like the .io games: a name for those who don't pick one (a war word and three digits)
      this.settings.name = randomGuestName();
      this.nameInput.value = this.settings.name;
      saveSettings(this.settings);
    }
    if (start) this.onPlay(mode);
  }

  /** The private room window: making one, or joining this one (an invitation link). */
  openRoom(code?: string): void {
    this.room.open(code);
  }

  /** The campaign window (back from a level: on its chapter). */
  openCampaign(level?: CampaignLevel): void {
    this.campaign.open(level);
  }

  /** The arrows beside the orb: the previous or next style, same colours. */
  private cycleSkin(step: number): void {
    const i = Math.max(0, SKINS.indexOf(this.settings.skin));
    this.settings.skin = SKINS[(i + step + SKINS.length) % SKINS.length];
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
   * The lobby's numbers, from this browser and the account: the online record of the chosen mode, the
   * campaign's progress (and the weapon of the chapter being played), the waves' record.
   */
  private renderProgress(): void {
    const mode = this.settings.mode;
    const record = Math.max(bestKills(mode), this.account.stats[mode]?.bestKills ?? 0);
    $('heroChips').innerHTML = record > 0 ? `<span class="hero-chip">${t('menu.recordChip', { mode: modeShort(mode), n: `<b>${num(record)}</b>` })}</span>` : '';

    const progress = loadProgress();
    const total = CAMPAIGN.length * LEVELS_PER_CHAPTER;
    const done = CAMPAIGN.reduce((n, c) => n + c.levels.filter((l) => progress[l.id] !== undefined).length, 0);
    // The chapter being played: the first one with a level still to win (all won: the last)
    const chapter = (CAMPAIGN.find((c) => c.levels.some((l) => progress[l.id] === undefined)) ?? CAMPAIGN[CAMPAIGN.length - 1]).chapter;
    const art = $<HTMLImageElement>('campaignArt');
    if (!art.src.endsWith(`/guia/${chapter.picture}`)) art.src = `/guia/${chapter.picture}`;
    $('campaignLine').textContent = done ? t('menu.campaignProgress', { n: chapter.n, weapon: t(`w.${chapter.weaponKey}.name`) }) : t('menu.campaignSolo');
    $('campaignCount').textContent = t('menu.campaignLevels', { done, total });
    $('campaignBarBox').hidden = !done;
    $('campaignBar').style.width = `${Math.round((done / total) * 100)}%`;

    const waves = loadWavesRecord();
    $('wavesLine').textContent = waves ? t('menu.wavesRecord', { n: waves.wave }) : t('menu.wavesSolo');
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
        Object.assign(this.settings, { skin: p.skin, red: p.red, green: p.green, blue: p.blue });
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
    const name = this.nameInput.value.trim();
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
    const narrow = w < NARROW_WIDTH;
    this.root.classList.toggle('narrow', narrow);
    // A narrow window's top bar may take two rows: the lobby starts under it
    if (narrow) document.documentElement.style.setProperty('--top-room', `${Math.ceil(document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect().bottom) + 18}px`);
    // The skyscraper where the window is tall enough, else the rectangle, never squeezing the lobby too much
    const room = h - TOP_ROOM - BOTTOM_ROOM;
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

  /** One row per game mode (a moment of a match, name, one line, how many play it now). */
  private buildModes(): void {
    const box = $('modes');
    for (const mode of ROOM_MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mode mode-${mode}`;
      b.dataset.mode = mode;
      b.setAttribute('role', 'radio');
      b.innerHTML =
        `<span class="mode-thumb" style="background-image: url('${versioned(`/menu/mode-${mode}.webp`)}')"></span>` +
        `<span class="mode-text"><b>${modeName(mode)}</b><small>${modeTagline(mode)}</small></span><span class="mode-count" hidden></span>`;
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
    for (const b of $('modes').querySelectorAll<HTMLElement>('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === this.settings.mode));
    this.renderStatus();
    this.renderProgress();
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
      count.textContent = room ? t('menu.playing', { n: room.players }) : '';
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
      .then((tex) => this.studio.draw(this.preview, tex, turning(this.settings.skin, this.spin, 1.1)))
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
        skin: SKINS[Math.floor(Math.random() * SKINS.length)],
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

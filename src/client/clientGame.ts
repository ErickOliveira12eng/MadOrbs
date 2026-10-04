// The game in the browser: ties the simulation (src/sim) to rendering, audio, input and UI.
// Mirrors the client side of the original (Client.cpp / ClientRecv.cpp / Game::update client parts).
//
// Two modes:
//  - offline: the whole simulation runs here, against bots;
//  - online:  the simulation runs in 'client' mode: our babo is driven here and sent to the server
//             every 2 frames, the server's snapshots and events drive everything else.
import * as THREE from 'three';
import {
  GAME_PLAYING,
  ITEM_GRENADE,
  ITEM_LIFE_PACK,
  ITEM_WEAPON,
  PLAYER_STATUS_ALIVE,
  PLAYER_TEAM_AUTO_ASSIGN,
  PLAYER_TEAM_BLUE,
  PLAYER_TEAM_RED,
  PLAYER_TEAM_SPECTATOR,
  GAME_TYPE_TDM,
  WEAPON_KNIVES,
  PROJECTILE_COCKTAIL_MOLOTOV,
  PROJECTILE_DIRECT,
  PROJECTILE_DROPED_GRENADE,
  PROJECTILE_DROPED_WEAPON,
  PROJECTILE_FLAME,
  PROJECTILE_GRENADE,
  PROJECTILE_LIFE_PACK,
  PROJECTILE_ROCKET,
  SOUND_MOLOTOV,
  SOUND_OVERHEAT,
  SOUND_PHOTON_START,
  TICK,
  WEAPON_BAZOOKA,
  WEAPON_FLAME_THROWER,
  WEAPON_GRENADE,
  WEAPON_NUCLEAR,
  WEAPON_SNIPER,
} from '../sim/constants';
import { BOSS, HEALTH_PACKS, loadProgress, nextLevel, saveWin, starsFor, type CampaignLevel } from './campaign';
import { bestKills, saveBestKills } from './records';
import { loadAnnouncer, playAnnouncer } from './featSounds';
import { applyFeatCounts, isAnnouncedToAll } from '../sim/feats';
import type { GameEvent } from '../sim/events';
import { Game, type ClientNet } from '../sim/game';
import { sv, weaponDefs } from '../sim/gameVar';
import { BotController, BOT_NAMES } from '../sim/bot';
import { GameMap, THEME_LAVA, WEATHER_RAIN, loadMap } from '../sim/map';
import { MiniBot, type Player, type SkinInfo } from '../sim/player';
import { Projectile } from '../sim/projectile';
import { Vec3, distanceSquared, rotateAboutAxis } from '../sim/vec';
import { WEAPON_MODEL_SCALE } from '../sim/weapon';
import { weaponDummies } from '../sim/weaponDummies';
import {
  CF_SEND_INTERVAL,
  MAX_CHAT_LENGTH,
  decodeEvent,
  ROOM_GAME_TYPE,
  v3,
  type NetEvent,
  type NetPlayerInfo,
  type NetPlayerState,
  type NetProjectile,
  type NetTeams,
  type NetVote,
  type RoomMode,
  type ServerMessage,
} from '../net/protocol';
import { audio } from './audio/audio';
import { preloadAssets, getModel, MODEL_DOUILLE, MODEL_GIB } from './assets';
import { GameCamera, LENS_HEIGHT } from './camera';
import { createDkoObject3D } from './engine/dko';
import { addGameLights, createRenderer } from './engine/renderer';
import { Effects, type BrassEjection } from './fx/effects';
import { bindings, Input } from './input';
import { Connection, defaultServerUrl, type WelcomeMessage } from './net/connection';
import { MapRenderer } from './render/mapRender';
import { BaboVisual } from './render/baboRenderer';
import { FlagRenderer } from './render/flagRenderer';
import { ProjectileRenderer } from './render/projectileRenderer';
import { gameSounds } from './sounds';
import type { OrbPictureFn } from './hud/hudArt';
import { HudLayer, type CampaignHud, type HudFrame } from './hud/hudLayer';
import { ViewOverlay, scopeAlpha } from './ui/viewOverlay';
import { VIEW_ASPECT, fitView, type ViewRect } from './view';
import { teamName } from './modes';
import { t } from '../i18n';

const Z_AXIS = new Vec3(0, 0, 1);

export interface ClientGameOptions {
  playerName: string;
  skin: SkinInfo;
  /** Game mode: the room joined online, the rules offline. */
  mode: RoomMode;
  /** Called when the game ends (menu, disconnect); `reason` explains an unexpected end. */
  onQuit?: (reason?: string) => void;
  /** The Esc menu opened or closed (the page shows its sound button meanwhile). */
  onMenuVisibility?: (visible: boolean) => void;
  /** M key: music on/off. */
  onToggleMusic?: () => void;
  /** Draws a player's orb for the HUD (the start screen's OrbStudio). */
  orbPicture?: OrbPictureFn;
  // --- offline only
  mapName?: string;
  botCount?: number;
  botSkill?: number;
  /** Maps played in rotation after the first one. */
  mapRotation?: string[];
  // --- online only
  serverUrl?: string;
  /** The signed-in player's session (Supabase access token): the server checks it. */
  authToken?: string;
  /** The most kills we made in one online match of this mode, before this game (records.ts, account). */
  bestKills?: number;
  // --- campaign (offline)
  /** A campaign level: Team Deathmatch alone against the bots, nobody respawns (src/client/campaign.ts). */
  campaign?: CampaignLevel;
  /** A campaign level won (the account keeps it too); `signedIn`: else the end says how to keep the progress. */
  onCampaignWin?: (level: CampaignLevel, seconds: number) => void;
  signedIn?: boolean;
  /** The end of a campaign level: what the player chose (next level, again, back to the menu). */
  onCampaignAction?: (action: 'next' | 'retry' | 'menu', level: CampaignLevel) => void;
}

export class ClientGame {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam = new GameCamera();
  private readonly input: Input;
  private readonly hud: HudLayer;
  private readonly overlay: ViewOverlay;
  private readonly effects: Effects;
  private readonly projectileRenderer: ProjectileRenderer;
  private readonly flagRenderer: FlagRenderer;
  private readonly opts: ClientGameOptions;
  private readonly sounds = gameSounds();
  private game!: Game;
  private mapRenderer: MapRenderer | null = null;
  private me!: Player;
  private bots: BotController[] = [];
  private babos = new Map<number, BaboVisual>();
  private flameTimers = new Map<number, number>();
  private acc = 0;
  private lastTime = 0;
  private running = false;
  private rafId = 0;
  private mouseWorld = new Vec3();
  private requireFreshPress = true;
  private mapIndex = 0;
  private loadingMap = false;
  private resizeObserver: ResizeObserver;
  /** Part of the canvas the 3D view uses, in CSS pixels: VIEW_ASPECT, centred with black bars. */
  private view: ViewRect = { x: 0, y: 0, w: 1, h: 1 };
  // --- online
  private conn: Connection | null = null;
  private sendCounter = 0;
  private spawnRequestTime = 0;
  private chat = { active: false, text: '' };
  private svBackup: typeof sv | null = null;
  private pendingMap: string | null = null;
  /** Hits our shots made on our screen, per victim (time), waiting for the server's 'hit'. */
  private predictedHits = new Map<number, number[]>();
  /**
   * Our rockets, grenades and molotovs fly on our screen from the click (Game.predictProjectile);
   * each is paired with the server's copy when it arrives, which then stays hidden.
   */
  private predictedLaunches: { type: number; ghost: Projectile; at: number; serverID: number }[] = [];
  /** Blasts (radius) and molotov crashes (-1) our predicted projectiles showed: the server's repeat is skipped. */
  private predictedBlasts: { position: Vec3; radius: number; at: number }[] = [];

  private constructor(container: HTMLElement, opts: ClientGameOptions, online: boolean) {
    this.container = container;
    this.opts = opts;
    this.renderer = createRenderer();
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.cursor = 'none';
    this.input = new Input(this.renderer.domElement);
    addGameLights(this.scene);
    this.effects = new Effects(this.scene, { showCasing: true, showGroundMark: true });
    // DKO roots use a fixed model matrix: wrap them so the effects can place/scale the clones.
    const wrap = (o: THREE.Object3D) => new THREE.Group().add(o);
    this.effects.setDouilleModel(0, wrap(createDkoObject3D(getModel(MODEL_DOUILLE), 0)));
    this.effects.setDouilleModel(1, wrap(createDkoObject3D(getModel(MODEL_GIB), 0)));
    this.projectileRenderer = new ProjectileRenderer(this.scene);
    this.flagRenderer = new FlagRenderer(this.scene);
    this.overlay = new ViewOverlay(this.renderer.domElement, VIEW_ASPECT);
    this.hud = new HudLayer(container, { orbPicture: opts.orbPicture, online });
    // The banner of the death screen and the Esc menu loads now (the campaign has its own, at its end)
    if (!opts.campaign) this.hud.preloadSideAd();

    const menu = this.hud.picker;
    menu.serverName = online ? '' : t('pick.offline');
    menu.onWeaponSelect = (choice) => {
      this.me.nextSpawnWeapon = choice.primary;
      this.me.nextMeleeWeapon = choice.secondary;
    };
    menu.onTeamSelect = (team) => this.selectTeam(team);
    this.hud.onVote = (i) => this.castVote(i);
    menu.onVisibilityChange = (visible) => {
      if (!visible) {
        // The mouse is captured again by the first click in the arena, not by the click that closed
        // the menu: the browser puts the cursor back where the capture started when Escape frees it,
        // and that was the "back to the game" button.
        this.requireFreshPress = true;
      } else {
        this.closeChat();
        this.input.exitPointerLock();
      }
      this.opts.onMenuVisibility?.(visible);
    };
    menu.onQuit = () => this.quit();
    // Pressing Escape while the mouse is captured releases it: open the menu like k_menuAccess.
    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.running && !menu.visible && !this.camp?.over) menu.show();
    };
    // Capture the mouse on a click in the arena (also after the menu closes, see onVisibilityChange)
    this.renderer.domElement.addEventListener('mousedown', () => {
      if (this.running && !menu.visible && !this.input.locked && !this.camp?.over) this.input.requestPointerLock();
    });
    window.addEventListener('keydown', this.onChatKey, true);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Offline game against bots. */
  static async create(container: HTMLElement, opts: ClientGameOptions, onProgress?: (text: string) => void): Promise<ClientGame> {
    onProgress?.(t('loading.assets'));
    await preloadAssets((d, total) => onProgress?.(t('loading.assetsN', { d, t: total })));
    onProgress?.(t('loading.map'));
    const map = await loadMap(opts.mapName ?? 'DM-Arena');
    const cg = new ClientGame(container, opts, false);
    await cg.hud.ready;
    cg.startOffline(map);
    return cg;
  }

  /** Online game on the server this page comes from (or `opts.serverUrl`). */
  static async createOnline(container: HTMLElement, opts: ClientGameOptions, onProgress?: (text: string) => void): Promise<ClientGame> {
    onProgress?.(t('loading.assets'));
    await preloadAssets((d, total) => onProgress?.(t('loading.assetsN', { d, t: total })));
    onProgress?.(t('loading.connecting'));
    const { conn, welcome } = await Connection.open(opts.serverUrl ?? defaultServerUrl(opts.mode), opts.playerName, opts.skin, opts.authToken);
    try {
      onProgress?.(t('loading.mapName', { map: welcome.map }));
      const map = await loadMap(welcome.map);
      const cg = new ClientGame(container, opts, true);
      await cg.hud.ready;
      cg.startOnline(map, conn, welcome);
      return cg;
    } catch (e) {
      conn.close();
      throw e;
    }
  }

  get online(): boolean {
    return this.conn !== null;
  }

  // ---------------------------------------------------------------- setup

  private startOffline(map: GameMap): void {
    if (this.opts.campaign) {
      this.startCampaign(map, this.opts.campaign);
      return;
    }
    this.game = new Game(map, { gameType: ROOM_GAME_TYPE[this.opts.mode], onMapChangeRequest: () => void this.nextMap() });
    this.me = this.game.addPlayer(this.opts.playerName || 'Orb')!;
    this.me.skin = this.opts.skin;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < (this.opts.botCount ?? 0); i++) {
      const p = this.game.addPlayer(names[i % names.length], true);
      if (!p) break;
      p.skin = randomSkin();
      this.bots.push(new BotController(p, this.opts.botSkill ?? 0.5));
    }
    this.onMapLoaded(map);
    this.beginLoop();
  }

  // ---------------------------------------------------------------- campaign

  /** When our own Mission Failed feat was announced (the campaign's loss doesn't say it twice). */
  private missionFailedAt = -1e9;

  /** The level being played: its clock, the boss and its guards, and how it ended. */
  private camp: {
    level: CampaignLevel;
    /** Seconds since the player spawned (stops at the end). */
    elapsed: number;
    started: boolean;
    boss: Player | null;
    guards: BotController[];
    nextGuard: number;
    over: 'won' | 'lost' | null;
    overAt: number;
    /** The health packs on the map, and when the next one comes. */
    packs: Projectile[];
    nextPack: number;
  } | null = null;

  /**
   * A campaign level: Team Deathmatch with us alone on blue and the bots on red, everybody with the
   * chapter's weapon and a single life; no score or time limit, no team balance.
   */
  private startCampaign(map: GameMap, level: CampaignLevel): void {
    this.svBackup = { ...sv };
    sv.sv_scoreLimit = 0;
    sv.sv_winLimit = 0;
    sv.sv_gameTimeLimit = 0;
    sv.sv_autoBalance = false;
    sv.sv_forceRespawn = false;
    this.game = new Game(map, { gameType: GAME_TYPE_TDM, onMapChangeRequest: () => {} });
    const weapon = level.chapter.weaponID;
    this.me = this.game.addPlayer(this.opts.playerName || 'Orb')!;
    this.me.skin = this.opts.skin;
    this.me.teamID = PLAYER_TEAM_BLUE;
    this.me.lives = 1;
    this.me.damageScale = level.playerDamage;
    this.me.nextSpawnWeapon = weapon;
    this.me.nextMeleeWeapon = WEAPON_KNIVES;
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const loadout = { primary: weapon, secondary: WEAPON_KNIVES };
    const guards: BotController[] = [];
    for (let i = 0; i < level.bots; i++) {
      const p = this.game.addPlayer(names[i % names.length], true);
      if (!p) break;
      p.teamID = PLAYER_TEAM_RED;
      p.lives = 1;
      p.skin = randomSkin();
      const bot = new BotController(p, level.skill, loadout);
      this.bots.push(bot);
      guards.push(bot);
    }
    let boss: Player | null = null;
    if (level.boss) {
      boss = this.game.addPlayer(t(`campaign.boss.${level.chapter.weaponKey}` as const), true);
      if (boss) {
        boss.teamID = PLAYER_TEAM_RED;
        boss.lives = 1;
        boss.radius = BOSS.radius;
        boss.damageScale = BOSS.damageScale;
        // No healing: the map's life packs and the ones its guards drop stay for the player
        boss.takesLifePacks = false;
        // Every boss is the eye (skin14), in the red team's colours
        boss.skin = { ...randomSkin(), skin: 'skin14' };
        this.bots.push(new BotController(boss, Math.min(1, level.skill + 0.1), loadout));
      }
    }
    this.camp = { level, elapsed: 0, started: false, boss, guards: level.boss ? guards : [], nextGuard: BOSS.guardEvery, over: null, overAt: 0, packs: [], nextPack: -1 };
    this.onMapLoaded(map);
    this.beginLoop();
    // We start right away, no weapon menu; the bots too, far from us
    this.hud.picker.hide();
    this.game.requestSpawn(this.me);
    for (const b of this.bots) this.game.requestSpawn(b.player);
    // The banner of the level's end loads now, while it is played
    this.hud.preloadCampaignAd();
  }

  /** Every tick of a campaign level: the clock, the boss's guards, the win and the loss. */
  private updateCampaign(): void {
    const c = this.camp;
    if (!c || c.over) return;
    const game = this.game;
    if (!c.started && this.me.isAlive) c.started = true;
    if (!c.started) return;
    c.elapsed += TICK;
    // A few health packs to get away and come back to: all of them at the start, then one comes
    // back a while after it is taken
    if (c.nextPack < 0) {
      for (let i = 0; i < HEALTH_PACKS.count; i++) this.dropHealthPack();
      c.nextPack = HEALTH_PACKS.every;
    }
    c.packs = c.packs.filter((p) => !p.needToBeDeleted);
    if (c.packs.length < HEALTH_PACKS.count) {
      c.nextPack -= TICK;
      if (c.nextPack <= 0) {
        this.dropHealthPack();
        c.nextPack = HEALTH_PACKS.every;
      }
    }
    // Boss: a guard comes back now and then while it lives
    if (c.boss && c.boss.isAlive && c.guards.length) {
      c.nextGuard -= TICK;
      if (c.nextGuard <= 0) {
        c.nextGuard = BOSS.guardEvery;
        const alive = c.guards.filter((g) => g.player.isAlive).length;
        const down = c.guards.find((g) => !g.player.isAlive && g.player.lives <= 0);
        if (alive < BOSS.maxGuards && down) {
          down.player.lives = 1;
          down.player.spawnRequested = false;
          down.player.timeToSpawn = 0;
        }
      }
    }
    const reds = game.players.filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_RED);
    const redsLeft = reds.filter((p) => p.isAlive || p.lives > 0).length;
    if (!this.me.isAlive && this.me.lives <= 0) this.endCampaign('lost');
    else if (c.boss ? !c.boss.isAlive && c.boss.lives <= 0 : redsLeft === 0) this.endCampaign('won');
  }

  /** A health pack on a free floor cell, away from us and from the other packs; it doesn't expire. */
  private dropHealthPack(): void {
    const c = this.camp!;
    const map = this.game.map;
    const [w, h] = map.size;
    const me = this.me.currentCF.position;
    const far = (x: number, y: number, d: number) =>
      Math.hypot(x - me.x, y - me.y) >= d && c.packs.every((p) => Math.hypot(x - p.currentCF.position.x, y - p.currentCF.position.y) >= d);
    for (let tries = 0; tries < 200; tries++) {
      const x = Math.floor(Math.random() * w);
      const y = Math.floor(Math.random() * h);
      // Far away if the map allows it, closer on a small one
      if (!map.cells[y * w + x]?.passable || !far(x + 0.5, y + 0.5, tries < 100 ? 5 : tries < 170 ? 2.5 : 0.8)) continue;
      if (!this.game.spawnProjectile(new Vec3(x + 0.5, y + 0.5, 0.3), new Vec3(), this.me.playerID, PROJECTILE_LIFE_PACK, 0)) return;
      const pack = this.game.projectiles[this.game.projectiles.length - 1];
      pack.duration = Infinity;
      c.packs.push(pack);
      return;
    }
  }

  private endCampaign(result: 'won' | 'lost'): void {
    const c = this.camp!;
    c.over = result;
    c.overAt = performance.now();
    const best = loadProgress()[c.level.id];
    const isBest = result === 'won' && saveWin(c.level, c.elapsed);
    if (result === 'won') this.opts.onCampaignWin?.(c.level, c.elapsed);
    const next = nextLevel(c.level);
    // "Mission failed", unless the feat (a streak lost) just said it
    if (result === 'lost' && performance.now() - this.missionFailedAt > 1500) playAnnouncer('missionFailed');
    if (result === 'won') playAnnouncer('objectiveCompleted');
    // The mouse comes back for the buttons, with the system's cursor
    this.input.exitPointerLock();
    this.renderer.domElement.style.cursor = 'auto';
    this.hud.showCampaignEnd({
      won: result === 'won',
      level: c.level,
      seconds: c.elapsed,
      stars: result === 'won' ? starsFor(c.level, c.elapsed) : 0,
      best: isBest ? null : (best ?? null),
      isBest,
      hasNext: result === 'won' && !!next,
      guest: !this.opts.signedIn,
      onAction: (action) => this.opts.onCampaignAction?.(action, action === 'next' && next ? next : c.level),
    });
  }

  /** The campaign's header on the HUD: the level, the clock, the bots left and the boss's life. */
  private campaignHud(): CampaignHud | null {
    const c = this.camp;
    if (!c) return null;
    const reds = this.game.players.filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_RED && p !== c.boss);
    return {
      level: c.level,
      seconds: c.elapsed,
      botsLeft: reds.filter((p) => p.isAlive || p.lives > 0).length,
      botsTotal: c.boss ? reds.length : c.level.bots,
      // Not born yet: a full bar
      boss: c.boss ? { name: c.boss.name, life: c.boss.isAlive ? c.boss.life : c.boss.lives > 0 ? 1 : 0 } : null,
      enemies: this.game.players
        .filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_RED)
        .sort((a, b) => Number(b === c.boss) - Number(a === c.boss))
        .map((p) => ({
          name: p.name,
          skin: p.displaySkin,
          // Not born yet, or a guard coming back: still to beat
          alive: p.isAlive || p.lives > 0,
          boss: p === c.boss,
          life: p.isAlive ? p.life : 1,
        })),
      over: !!c.over,
    };
  }

  private startOnline(map: GameMap, conn: Connection, welcome: WelcomeMessage): void {
    this.conn = conn;
    // The server's rules drive our simulation too
    this.svBackup = { ...sv };
    sv.sv_timeToSpawn = welcome.rules.timeToSpawn;
    sv.sv_scoreLimit = welcome.rules.scoreLimit;
    sv.sv_winLimit = welcome.rules.winLimit;
    sv.sv_gameTimeLimit = welcome.rules.gameTimeLimit;
    sv.sv_enableMolotov = welcome.rules.enableMolotov;
    sv.sv_enableSecondary = welcome.rules.enableSecondary;
    sv.sv_forceRespawn = welcome.rules.forceRespawn;

    this.game = new Game(map, { mode: 'client', net: this.makeNet(conn), gameType: welcome.gameType });
    this.applyTeams(welcome.teams);
    welcome.flags.forEach(([state, x, y], i) => this.game.applyFlag(i, state, new Vec3(x, y, 0)));
    this.applyPlayers(welcome.players);
    if (welcome.vote) this.setVote(welcome.vote);
    this.me = this.game.players[welcome.id]!;
    this.me.locallyControlled = true;
    this.me.skin = this.opts.skin;
    this.me.timeToSpawn = 0;
    for (const p of welcome.projectiles) this.addNetProjectile(p);
    this.game.gameTimeLeft = welcome.gt;
    this.game.roundState = welcome.rs;
    this.game.events.drain(); // join messages of the players already there
    this.hud.picker.serverName = welcome.server;
    conn.onClose = (reason) => this.quit(reason);
    this.onMapLoaded(map);
    this.beginLoop();
  }

  /** A match begins: the announcer's "Start". */
  private announceStart(): void {
    playAnnouncer('start');
  }

  private beginLoop(): void {
    this.hud.setGameType(this.game.gameType);
    if (this.online) this.hud.setRecord(this.opts.bestKills ?? bestKills(this.opts.mode));
    loadAnnouncer();
    // Offline the match starts now; online only when joining in its first seconds
    if (!this.online || this.game.gameTimeLeft > sv.sv_gameTimeLimit - 5) setTimeout(() => this.announceStart(), 600);
    // Like the original, the weapon menu opens when joining
    this.hud.picker.show();
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  /** What our 'client' game sends to the server. */
  private makeNet(conn: Connection): ClientNet {
    return {
      shoot: (o, n, w, b) => conn.send({ t: 'shoot', o: v3(o), n, w, b: b.map((bullet) => bullet.map((x) => Math.round(x * 1000) / 1000)) }),
      projectile: (k, o, d, n, w) => conn.send({ t: 'proj', k, o: v3(o), d: v3(d), n, w }),
      melee: () => conn.send({ t: 'melee' }),
      pickup: () => conn.send({ t: 'pickup' }),
      spawn: (w, m) => {
        this.spawnRequestTime = performance.now();
        conn.send({ t: 'spawn', w, m });
      },
      sound: (id, p) => conn.send({ t: 'snd', id, p: v3(p) }),
    };
  }

  private onMapLoaded(map: GameMap): void {
    this.mapRenderer?.dispose();
    this.mapRenderer = new MapRenderer(map);
    this.scene.add(this.mapRenderer.group);
    this.mapRenderer.applyFog(this.scene, 7 * LENS_HEIGHT);
    this.effects.clear();
    this.effects.setMap(map);
    this.effects.setWeather(map.weather);
    this.projectileRenderer.clear();
    this.flameTimers.clear();
    this.cam.setMapSize(map.size);
    this.cam.setCameraPos(new Vec3(map.size[0] / 2, map.size[1] / 2, 0));
    this.hud.setMap(map);
    // Game::createMap: s_inGameMusic plays Music.ogg at volume 60
    void audio.playMusic(this.sounds.gameMusic, 60);
  }

  private async nextMap(): Promise<void> {
    if (this.loadingMap) return;
    this.loadingMap = true;
    const rotation = this.opts.mapRotation?.length ? this.opts.mapRotation : [this.game.map.name];
    this.mapIndex = (this.mapIndex + 1) % rotation.length;
    try {
      const map = await loadMap(rotation[this.mapIndex]);
      this.game.changeMap(map);
    } finally {
      this.loadingMap = false;
    }
  }

  /** The end-of-match map vote (online): the maps offered and their votes, or null when it closes. */
  private vote: NetVote | null = null;
  private myVote = -1;

  private setVote(vote: NetVote | null): void {
    // A new vote (other maps): our choice starts over
    if (!vote || !this.vote || vote.maps.join() !== this.vote.maps.join()) this.myVote = -1;
    this.vote = vote ? { maps: vote.maps, counts: vote.counts } : null;
    this.hud.setVote(this.vote ? { ...this.vote, mine: this.myVote } : null);
  }

  private castVote(i: number): void {
    if (!this.vote || !this.conn || i < 0 || i >= this.vote.maps.length || i === this.myVote) return;
    this.myVote = i;
    this.conn.send({ t: 'vote', i });
    this.hud.setVote({ ...this.vote, mine: i });
    audio.play(this.sounds.chat, 120);
  }

  /** The server moved to another map: load it, then reset our game on it. */
  private async changeMapOnline(name: string): Promise<void> {
    this.pendingMap = name;
    try {
      const map = await loadMap(name);
      if (!this.running || this.pendingMap !== name) return;
      this.game.changeMap(map);
      for (const p of this.game.players) if (p && p !== this.me) p.netCF1.frameID = 0;
    } catch (e) {
      console.error('map load failed', e);
    } finally {
      if (this.pendingMap === name) this.pendingMap = null;
    }
  }

  private selectTeam(team: number): void {
    if (this.online) return; // teams are auto-assigned on the server
    if (team === PLAYER_TEAM_SPECTATOR) {
      this.me.kill(true);
      this.me.teamID = PLAYER_TEAM_SPECTATOR;
    } else if (team === PLAYER_TEAM_AUTO_ASSIGN && this.me.teamID === PLAYER_TEAM_SPECTATOR) {
      this.game.assignPlayerTeam(this.me);
      this.me.timeToSpawn = 0;
      this.me.spawnRequested = false;
    }
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    // Everybody sees the same area of the map, whatever the screen shape
    this.view = fitView(w, h);
    this.cam.setAspect(VIEW_ASPECT);
    this.hud.setView(this.view);
    // The page's own fixed controls (sound button and panel, notices) stay inside the view, not
    // in the black bars (the container fills the window)
    const root = document.documentElement.style;
    root.setProperty('--view-x', `${this.view.x}px`);
    root.setProperty('--view-y', `${this.view.y}px`);
  }

  quit(reason?: string): void {
    if (!this.running) return;
    this.running = false;
    if (this.conn) {
      this.conn.onClose = undefined;
      this.conn.close();
    }
    if (this.svBackup) Object.assign(sv, this.svBackup);
    window.removeEventListener('keydown', this.onChatKey, true);
    audio.stopMusic();
    cancelAnimationFrame(this.rafId);
    this.input.exitPointerLock();
    this.resizeObserver.disconnect();
    document.documentElement.style.removeProperty('--view-x');
    document.documentElement.style.removeProperty('--view-y');
    for (const b of this.babos.values()) b.dispose();
    this.babos.clear();
    this.mapRenderer?.dispose();
    this.flagRenderer.dispose();
    this.effects.dispose();
    this.hud.dispose();
    this.overlay.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.opts.onQuit?.(reason);
  }

  // ---------------------------------------------------------------- chat (online)

  private onChatKey = (e: KeyboardEvent): void => {
    if (!this.running) return;
    if (!this.chat.active) {
      if (e.code === 'KeyM' && !e.repeat) {
        this.opts.onToggleMusic?.();
        return;
      }
      if (this.online && e.code === bindings.chatAll && !e.repeat && !this.hud.picker.visible) {
        this.chat.active = true;
        this.chat.text = '';
        this.input.enabled = false;
        e.preventDefault();
      }
      return;
    }
    e.preventDefault();
    if (e.key === 'Enter') {
      const text = this.chat.text.trim();
      if (text) this.conn?.send({ t: 'chat', text });
      this.closeChat();
    } else if (e.key === 'Escape') {
      this.closeChat();
      this.input.endTick(); // don't let this Escape open the menu
    } else if (e.key === 'Backspace') {
      this.chat.text = this.chat.text.slice(0, -1);
    } else if (e.key.length === 1 && this.chat.text.length < MAX_CHAT_LENGTH) {
      this.chat.text += e.key;
    }
  };

  private closeChat(): void {
    if (!this.chat.active) return;
    this.chat.active = false;
    this.chat.text = '';
    this.input.enabled = true;
  }

  // ---------------------------------------------------------------- loop

  private frame(now: number): void {
    if (!this.running) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;

    // Client::render: the camera target follows the babo and the aim point
    this.cam.followPlayer(this.me);
    while (this.acc >= TICK && this.running) {
      this.tick();
      this.acc -= TICK;
    }
    if (!this.running) return;
    const alpha = this.acc / TICK;
    this.cam.apply(alpha);

    // GameRender.cpp: find the mouse position on the ground with the current camera
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const view = this.view;
    this.cam.unproject(this.input.mouseX - view.x, this.input.mouseY - view.y, view.w, view.h, this.mouseWorld);
    const menuOpen = this.hud.picker.visible;
    if (this.me.isAlive && !menuOpen) this.me.currentCF.mousePosOnMap.copy(this.mouseWorld);

    for (const p of this.game.players) {
      if (p) this.babos.get(p.playerID)?.render(p, alpha);
    }
    this.projectileRenderer.render(this.shownProjectiles(), alpha);
    this.flagRenderer.render(this.game, dt, (id) => {
      const carrier = this.game.players[id];
      const v = this.babos.get(id);
      return carrier && carrier.isAlive && v ? { position: v.renderPosition, angle: carrier.currentCF.angle } : null;
    });
    this.effects.render(this.cam.camera, alpha);
    this.renderer.setViewport(view.x, h - view.y - view.h, view.w, view.h);
    this.renderer.render(this.scene, this.cam.camera);
    this.renderer.setViewport(0, 0, w, h);

    const me = this.me;
    const scope = me.isAlive && me.weapon?.weaponID === WEAPON_SNIPER ? scopeAlpha(this.cam.renderHeight) : 0;
    this.overlay.render(this.renderer, { scope, mouseX: this.input.mouseX, mouseY: this.input.mouseY, screenHit: me.screenHit, menuOpen });
    this.hud.update(dt, this.hudFrame(scope));
  }

  private tick(): void {
    const game = this.game;
    const me = this.me;
    const input = this.input;

    if (this.conn) this.applyServerMessages();
    if (!this.running) return;

    const menuOpen = this.hud.picker.visible;
    if (input.rawPressed(bindings.menuAccess) && !input.locked && !this.chat.active) {
      this.hud.picker.toggle();
    }

    // --- Our input (Player::controlIt reads dki states)
    const inp = me.input;
    const playing = !menuOpen && !this.chat.active;
    // The death screen's weapon cards, clicked with the game's cursor while the mouse is captured:
    // that click must not also respawn us
    const cardClick = playing && input.locked && !me.isAlive && input.wasPressed(bindings.shoot) && this.hud.clickAt(input.mouseX, input.mouseY);
    // The map vote at the end of a match: the game's cursor clicks its cards, or keys 1, 2, 3
    const voting = playing && this.vote !== null && game.roundState !== GAME_PLAYING;
    const voteClick = voting && input.locked && input.wasPressed(bindings.shoot) && this.hud.clickAt(input.mouseX, input.mouseY);
    if (voting) {
      for (let k = 1; k <= this.vote!.maps.length; k++) if (input.rawPressed(`Digit${k}`) || input.rawPressed(`Numpad${k}`)) this.castVote(k - 1);
    }
    if (this.requireFreshPress && !input.isDown(bindings.shoot)) this.requireFreshPress = false;
    if (cardClick || voteClick) this.requireFreshPress = true;
    const canShoot = playing && !this.requireFreshPress;
    inp.up = playing && input.isDown(bindings.moveUp);
    inp.down = playing && input.isDown(bindings.moveDown);
    inp.left = playing && input.isDown(bindings.moveLeft);
    inp.right = playing && input.isDown(bindings.moveRight);
    inp.shoot = canShoot && input.isDown(bindings.shoot);
    inp.shootPressed = canShoot && input.wasPressed(bindings.shoot);
    inp.melee = playing && input.isDown(bindings.melee);
    inp.throwGrenadePressed = playing && input.wasPressed(bindings.throwGrenade);
    inp.throwMolotovPressed = playing && input.wasPressed(bindings.throwMolotov);
    inp.pickUpPressed = playing && input.wasPressed(bindings.pickUp);
    inp.mousePosOnMap.copy(me.isAlive ? me.currentCF.mousePosOnMap : this.mouseWorld);
    inp.camPosZ = this.cam.camPos.z;

    for (const b of this.bots) b.think(TICK);
    game.update(TICK);
    for (const e of game.events.drain()) this.handleEvent(e, false);
    this.updateCampaign();

    if (this.conn) {
      // NET_CLSV_SVCL_PLAYER_COORD_FRAME every sv_minSendInterval frames
      this.sendCounter++;
      if (me.isAlive && this.sendCounter >= CF_SEND_INTERVAL) {
        this.sendCounter = 0;
        const cf = me.currentCF;
        this.conn.send({ t: 'cf', f: cf.frameID, p: v3(cf.position), v: v3(cf.vel), m: [cf.mousePosOnMap.x, cf.mousePosOnMap.y], z: this.cam.camPos.z });
      }
      // Our spawn request got no answer (too early, round over...): allow asking again
      if (me.spawnRequested && !me.isAlive && performance.now() - this.spawnRequestTime > 1500) me.spawnRequested = false;
    }

    // --- Visual state after the tick
    for (const p of game.players) {
      if (!p) continue;
      let v = this.babos.get(p.playerID);
      if (!v) {
        v = new BaboVisual(this.scene);
        this.babos.set(p.playerID, v);
      }
      v.tick(p, TICK);
    }
    for (const [id, v] of this.babos) {
      if (!game.players[id]) {
        v.dispose();
        this.babos.delete(id);
      }
    }
    this.projectileRenderer.tick(this.shownProjectiles());
    this.projectileEffects();
    this.mapEffects();
    this.effects.update(TICK, this.cam.eye, this.cam.camera);
    this.mapRenderer?.update(TICK);

    const spectator =
      me.teamID === PLAYER_TEAM_SPECTATOR && playing
        ? {
            x: (input.isDown(bindings.moveRight) ? 10 : 0) - (input.isDown(bindings.moveLeft) ? 10 : 0),
            y: (input.isDown(bindings.moveUp) ? 10 : 0) - (input.isDown(bindings.moveDown) ? 10 : 0),
          }
        : undefined;
    this.cam.tick(TICK, me, spectator);
    audio.setListener(this.cam.camPos);
    input.endTick();
  }

  // ---------------------------------------------------------------- server messages (online)

  private applyServerMessages(): void {
    for (const msg of this.conn!.drain()) {
      switch (msg.t) {
        case 'tick':
          this.applyTick(msg);
          break;
        case 'players':
          this.applyPlayers(msg.list);
          break;
        case 'vote':
          this.setVote(msg);
          break;
        case 'scores':
          for (const [id, kills, deaths, score, dmg, ping, returns, ...feats] of msg.s) {
            const p = this.game.players[id];
            if (!p) continue;
            p.kills = kills;
            p.deaths = deaths;
            p.score = score;
            p.dmg = dmg;
            p.pingFrames = ping;
            p.returns = returns ?? 0;
            applyFeatCounts(p.feats, feats);
          }
          if (msg.ts) this.applyTeams(msg.ts);
          break;
      }
      if (!this.running) return;
    }
  }

  private applyTick(msg: Extract<ServerMessage, { t: 'tick' }>): void {
    const game = this.game;
    if (msg.gt !== undefined) game.gameTimeLeft = msg.gt;
    if (msg.rs !== undefined && this.pendingMap === null) game.roundState = msg.rs;
    for (const ne of msg.e ?? []) this.handleEvent(decodeEvent(ne), true, ne);
    for (const s of msg.pr ?? []) {
      const p = game.getProjectile(s[0]);
      if (!p) continue;
      p.currentCF.position.set(s[1], s[2], s[3]);
      p.currentCF.vel.set(s[4], s[5], s[6]);
      p.currentCF.angle = s[7];
    }
    for (const s of msg.p ?? []) this.applyPlayerState(s);
  }

  /** The team scores the server keeps (frags in TDM, captures in CTF). */
  private applyTeams([blueScore, redScore, blueWin, redWin]: NetTeams): void {
    const g = this.game;
    g.blueScore = blueScore;
    g.redScore = redScore;
    g.blueWin = blueWin;
    g.redWin = redWin;
  }

  /** Players list (join, leave, names, skins, teams). */
  private applyPlayers(list: NetPlayerInfo[]): void {
    const game = this.game;
    const present = new Set<number>();
    for (const info of list) {
      present.add(info.id);
      let p = game.players[info.id];
      if (!p || (p !== this.me && p.isBot !== info.bot && p.name !== info.name)) {
        if (p) game.removePlayer(info.id);
        p = game.addRemotePlayer(info.id, info.name, info.team, info.bot);
      }
      p.name = info.name;
      p.tag = info.tag ?? '';
      p.teamID = info.team;
      if (p !== this.me) p.skin = info.skin;
    }
    for (const p of game.players) {
      if (p && p !== this.me && !present.has(p.playerID)) game.removePlayer(p.playerID);
    }
  }

  private applyPlayerState(s: NetPlayerState): void {
    const [id, status, frameID, x, y, z, vx, vy, mx, my, life, weaponID, meleeID, flags, bx, by] = s;
    const p = this.game.players[id];
    if (!p) return;
    p.life = life;
    // Nuke bot (ours too)
    if (flags & 2) {
      if (!p.minibot) {
        p.minibot = new MiniBot();
        p.minibot.currentCF.position.set(bx, by, 0.15);
        p.minibot.lastCF.copyFrom(p.minibot.currentCF);
      } else p.minibot.currentCF.position.set(bx, by, 0.15);
    } else p.minibot = null;
    if (p === this.me) {
      // The server decides deaths; spawns come with their event
      if (status !== PLAYER_STATUS_ALIVE && p.isAlive) p.kill(true);
      return;
    }
    if (status === PLAYER_STATUS_ALIVE && !p.isAlive) {
      p.nextSpawnWeapon = weaponID >= 0 ? weaponID : p.nextSpawnWeapon;
      p.nextMeleeWeapon = meleeID >= 0 ? meleeID : p.nextMeleeWeapon;
      p.spawn(new Vec3(x, y, 0.25));
    } else if (status !== PLAYER_STATUS_ALIVE && p.isAlive) {
      p.kill(true);
    }
    if (!p.isAlive) return;
    if (weaponID >= 0 && p.weapon?.weaponID !== weaponID) p.switchWeapon(weaponID);
    if (meleeID >= 0 && p.meleeWeapon?.weaponID !== meleeID) p.switchMeleeWeapon(meleeID);
    p.setCoordFrame(frameID, new Vec3(x, y, z), new Vec3(vx, vy, 0), new Vec3(mx, my, 0));
    if (flags & 1) p.firedShowDelay = Math.max(p.firedShowDelay, 0.5);
  }

  private addNetProjectile(n: NetProjectile): Projectile | null {
    if (this.game.getProjectile(n.id)) return null;
    const p = Projectile.fromNetwork(n.id, n.k, n.from, n.w, Vec3.from(n.p), Vec3.from(n.v), n.a, n.r);
    this.game.projectiles.push(p);
    return p;
  }

  /** Projectile launched by another player: what their weapon did on our screen (ClientRecv). */
  private remoteLaunchEffects(proj: Projectile, nuzzleID: number, origin: Vec3): void {
    const shooter = this.game.players[proj.fromID];
    if (!shooter || shooter === this.me) return;
    const type = proj.projectileType;
    if (type === PROJECTILE_LIFE_PACK || type === PROJECTILE_DROPED_WEAPON || type === PROJECTILE_DROPED_GRENADE || type === PROJECTILE_FLAME) return;
    shooter.firedShowDelay = 2;
    if (type === PROJECTILE_ROCKET && shooter.weapon?.weaponID === WEAPON_BAZOOKA) {
      // Weapon::shoot(playerShoot): nuzzle flash, sound, firing smoke
      this.babos.get(shooter.playerID)?.fire(WEAPON_BAZOOKA, nuzzleID);
      audio.play3D(this.sounds.weapon[WEAPON_BAZOOKA], 5, origin, 150);
      this.effects.firingSmoke(origin, rotateAboutAxis(new Vec3(0, 1, 0), shooter.currentCF.angle, Z_AXIS), 45);
    } else if (type === PROJECTILE_GRENADE || type === PROJECTILE_COCKTAIL_MOLOTOV) {
      audio.play3D(this.sounds.weapon[WEAPON_GRENADE], 5, origin, 255);
    }
  }

  /** The projectiles to draw: the server's copies of the ones we predicted stay hidden. */
  private shownProjectiles(): Projectile[] {
    const all = this.game.projectiles;
    return all.some((p) => p.hidden) ? all.filter((p) => !p.hidden) : all;
  }

  /** The server's copy of a projectile we fired: hidden when ours already flies (or flew). */
  private pairPredicted(proj: Projectile): void {
    const now = performance.now();
    // Launches the server never answered (refused) are forgotten
    this.predictedLaunches = this.predictedLaunches.filter((l) => l.serverID >= 0 || now - l.at < 2000);
    const launch = this.predictedLaunches.find((l) => l.serverID < 0 && l.type === proj.projectileType);
    if (launch) {
      launch.serverID = proj.uniqueID;
      proj.hidden = true;
    } else if (proj.projectileType === PROJECTILE_ROCKET) {
      this.me.rocketInAir = true; // launched by the server without our prediction
    }
  }

  /** The server's copy is gone: if ours still flies, the server's hit something ours missed. */
  private serverCopyRemoved(uniqueID: number): void {
    const k = this.predictedLaunches.findIndex((l) => l.serverID === uniqueID);
    if (k < 0) return;
    const { ghost } = this.predictedLaunches[k];
    this.predictedLaunches.splice(k, 1);
    const i = this.game.projectiles.indexOf(ghost);
    if (i < 0 || ghost.needToBeDeleted) return;
    this.game.projectiles.splice(i, 1);
    if (ghost.projectileType === PROJECTILE_ROCKET) this.me.rocketInAir = false;
  }

  /** True (and forgotten) when our predicted projectiles already showed this blast or crash. */
  private takePredictedBlast(position: Vec3, radius: number): boolean {
    const now = performance.now();
    this.predictedBlasts = this.predictedBlasts.filter((b) => now - b.at < 2000);
    const i = this.predictedBlasts.findIndex((b) => b.radius === radius && distanceSquared(b.position, position) < 1.5 * 1.5);
    if (i < 0) return false;
    this.predictedBlasts.splice(i, 1);
    return true;
  }

  private hasPredicted(type: number): boolean {
    return this.game.projectiles.some((p) => p.predicted && p.projectileType === type && !p.needToBeDeleted);
  }

  // ---------------------------------------------------------------- effects every tick

  /** Client-side particles spawned by projectiles every tick (Projectile::update, remoteEntity). */
  private projectileEffects(): void {
    const game = this.game;
    for (const p of this.shownProjectiles()) {
      const pos = p.currentCF.position;
      const owner = game.players[p.fromID];
      switch (p.projectileType) {
        case PROJECTILE_ROCKET:
          this.effects.rocketSmoke(pos, game.gameType, owner ? owner.teamID : null);
          break;
        case PROJECTILE_GRENADE:
          this.effects.grenadeTrail(pos, game.gameType, owner ? owner.teamID : null);
          break;
        case PROJECTILE_COCKTAIL_MOLOTOV:
          this.effects.molotovFire(pos, p.currentCF.vel, p.rotation);
          break;
        case PROJECTILE_FLAME: {
          const t = this.flameTimers.get(p.uniqueID) ?? 0;
          this.flameTimers.set(p.uniqueID, this.effects.flameProjectile(pos, t));
          break;
        }
      }
    }
  }

  /** Game::update client part: rain drips, lava steam under the babos. */
  private mapEffects(): void {
    const game = this.game;
    const map = game.map;
    if (map.weather === WEATHER_RAIN) {
      this.effects.rainDrips(this.cam.camPos);
      for (const p of game.players) {
        if (p && p.isAlive && p.onSplatter() && p.currentCF.vel.length() >= 2.25) this.effects.playerDrip(p.currentCF.position);
      }
    }
    if (map.theme === THEME_LAVA) {
      for (const p of game.players) {
        if (p && p.isAlive && Math.floor(Math.random() * 32768) % 50 === 5 && p.onSplatter()) this.effects.lavaSteam(p.currentCF.position);
      }
    }
  }

  // ---------------------------------------------------------------- events

  /**
   * Reactions to the simulation events. `fromServer`: the event came from the online server
   * (then the state changes it carries are applied here, like ClientRecv did).
   */
  private handleEvent(e: GameEvent, fromServer: boolean, raw?: NetEvent): void {
    const game = this.game;
    const me = this.me;
    const S = this.sounds;
    const online = this.online;
    switch (e.type) {
      case 'fire': {
        const p = game.players[e.playerID];
        if (!p) break;
        this.babos.get(p.playerID)?.fire(e.weaponID, e.nuzzleID);
        audio.play3D(S.weapon[e.weaponID], 5, p.currentCF.position, 255);
        if (e.weaponID === WEAPON_GRENADE || e.weaponID === 9) {
          this.effects.firingSmoke(e.origin, e.direction, 45);
          break;
        }
        const brass = this.brassFor(p, e.weaponID, e.nuzzleID);
        this.effects.weaponFireLocal(e.weaponID, weaponDefs[e.weaponID].damage, e.origin, e.direction, brass);
        break;
      }
      case 'shoot': {
        const shooter = game.players[e.playerID];
        const damage = weaponDefs[e.weaponID]?.damage ?? 0;
        if (fromServer && shooter === me) {
          // Our own shot: drawn when we fired (Game.predictShot), the server's copy is for the others
        } else if (online && shooter && shooter !== me) {
          // Weapon::shoot(net_svcl_player_shoot): another player's shot as seen by us
          shooter.firedShowDelay = 2;
          if (e.weaponID !== WEAPON_FLAME_THROWER) this.babos.get(shooter.playerID)?.fire(e.weaponID, e.nuzzleID);
          const brass = this.brassFor(shooter, e.weaponID, e.nuzzleID);
          this.effects.weaponFireRemote(e.weaponID, damage, shooter.teamID, e.p1, e.p2, e.normal, shooter.currentCF.angle, brass, S.weapon[e.weaponID]);
        } else if (e.weaponID === WEAPON_FLAME_THROWER) this.effects.flameThrowerFire(e.p1, e.p2, e.normal);
        else this.effects.spawnImpact(e.p1, e.p2, e.normal, e.weaponID, damage, shooter ? shooter.teamID : 0);
        // We got hit: we get pushed (ClientRecv NET_SVCL_PLAYER_SHOOT)
        if (fromServer && e.hitPlayerID === me.playerID && me.isAlive) {
          const dir = e.p2.sub(e.p1).normalizeIn();
          me.currentCF.vel.addIn(dir.mul(damage * 2));
        }
        break;
      }
      case 'photonCharge':
        audio.play3D(S.photonStart, 5, e.position, 150);
        break;
      case 'overheat':
        audio.play3D(S.overHeat, 5, e.position, 150);
        break;
      case 'shotgunReload':
        audio.play3D(S.shotgunReload, 5, e.position, 230);
        break;
      case 'melee': {
        const p = game.players[e.playerID];
        if (!p) break;
        if (fromServer) p.meleeWeapon?.shootMelee();
        const pos = e.weaponID === WEAPON_NUCLEAR && p.minibot ? p.minibot.currentCF.position : p.currentCF.position;
        audio.play3D(S.weapon[e.weaponID], 5, pos, 255);
        break;
      }
      case 'switchWeapon': {
        const p = game.players[e.playerID];
        if (p) audio.play3D(S.equip, 1, p.currentCF.position, 255);
        break;
      }
      case 'grenadeRebound':
        // Our own grenade's bounces were heard on our predicted one
        if (fromServer && game.projectiles.some((p) => p.hidden && distanceSquared(p.currentCF.position, e.position) < 1.5 * 1.5)) break;
        audio.play3D(S.grenadeRebond, 1, e.position, 200);
        break;
      case 'projectileSpawn': {
        let proj: Projectile | null | undefined = game.getProjectile(e.uniqueID);
        if (fromServer && raw?.proj) {
          proj = this.addNetProjectile(raw.proj as NetProjectile);
          if (proj) this.remoteLaunchEffects(proj, e.nuzzleID, e.launchPosition);
          if (proj && proj.fromID === me.playerID) this.pairPredicted(proj);
        } else if (proj?.predicted) {
          this.predictedLaunches.push({ type: proj.projectileType, ghost: proj, at: performance.now(), serverID: -1 });
        }
        if (proj && !proj.hidden && proj.projectileType === PROJECTILE_ROCKET) {
          this.effects.rocketLaunchSmoke(proj.currentCF.position, proj.currentCF.vel.mul(1 / 2.5));
        }
        break;
      }
      case 'projectileRemoved':
        if (fromServer) {
          const i = game.projectiles.findIndex((p) => p.uniqueID === e.uniqueID);
          if (i >= 0) game.projectiles.splice(i, 1);
          this.serverCopyRemoved(e.uniqueID);
        }
        this.flameTimers.delete(e.uniqueID);
        break;
      case 'explosion':
        // Online, the blasts of our predicted projectiles show at once and the server's repeat is skipped
        if (!fromServer && this.online) this.predictedBlasts.push({ position: e.position.clone(), radius: e.radius, at: performance.now() });
        if (!(fromServer && this.takePredictedBlast(e.position, e.radius))) this.effects.spawnExplosion(e.position, e.normal, e.radius);
        if (fromServer && e.playerID === me.playerID && !this.hasPredicted(PROJECTILE_ROCKET)) me.rocketInAir = false;
        break;
      case 'sound':
        if (e.playerID !== undefined && e.playerID === me.playerID) break; // we already heard it
        if (e.soundID === SOUND_MOLOTOV) {
          // Same as the blasts: our predicted molotov already crashed on our screen
          if (!fromServer && this.online) this.predictedBlasts.push({ position: e.position.clone(), radius: -1, at: performance.now() });
          if (!(fromServer && this.takePredictedBlast(e.position, -1))) audio.play3D(S.cocktailMolotov, e.range, e.position, e.volume);
        }
        else if (e.soundID === SOUND_PHOTON_START) audio.play3D(S.photonStart, e.range, e.position, e.volume);
        else if (e.soundID === SOUND_OVERHEAT) audio.play3D(S.overHeat, e.range, e.position, e.volume);
        break;
      case 'hitPredicted': {
        // Our shot touched this babo on our screen: blood and hit marker now, the server confirms
        this.effects.playerHit(e.position, weaponDefs[e.weaponID]?.damage ?? 0.1);
        this.hud.hitMarker();
        audio.play(S.hitConfirm, 250);
        const pending = this.predictedHits.get(e.playerID) ?? [];
        pending.push(performance.now());
        this.predictedHits.set(e.playerID, pending);
        break;
      }
      case 'hit': {
        const victim = game.players[e.playerID];
        if (fromServer && victim) {
          victim.life = e.life;
          if (victim === me) {
            me.screenHit += e.damage;
            if (me.screenHit > 1) me.screenHit = 1;
            if (e.damage > 1) me.screenHit = 0;
          }
        }
        // Our direct shots already showed their hits when we fired
        const shown = fromServer && e.fromID === me.playerID && weaponDefs[e.weaponID]?.projectileType === PROJECTILE_DIRECT && this.takePredictedHit(e.playerID);
        if (!shown) {
          this.effects.playerHit(e.position, e.damage);
          if (e.fromID === me.playerID && e.playerID !== me.playerID) {
            this.hud.hitMarker();
            audio.play(S.hitConfirm, 250);
          }
        }
        if (e.playerID === me.playerID && (e.weaponID === WEAPON_BAZOOKA || e.weaponID === WEAPON_GRENADE || e.weaponID === WEAPON_NUCLEAR)) {
          const realDamage = e.weaponID === WEAPON_BAZOOKA ? sv.sv_zookaDamage : weaponDefs[e.weaponID].damage;
          this.cam.viewShake += 2 - e.life / realDamage;
        }
        break;
      }
      case 'death': {
        this.effects.playerDeath(e.position);
        const victim = game.players[e.playerID];
        const killer = game.players[e.fromID];
        if (fromServer && victim && victim.isAlive) {
          victim.kill(true);
          if (victim === me) me.spawnRequested = false;
        }
        // Player::hit: the kill message (the killer may have left already)
        if (victim) this.hud.kill(killer ?? null, victim, e.weaponID, me);
        break;
      }
      case 'spawn': {
        const p = game.players[e.playerID];
        if (fromServer && p) {
          // NET_SVCL_PLAYER_SPAWN: the server chose the place
          p.nextSpawnWeapon = e.weaponID;
          p.nextMeleeWeapon = e.meleeID;
          p.spawn(e.position);
        }
        if (e.playerID === me.playerID) this.cam.setCameraPos(me.currentCF.position);
        break;
      }
      case 'pickup': {
        const p = game.players[e.playerID];
        if (fromServer && p) {
          // NET_SVCL_PICKUP_ITEM
          if (e.itemType === ITEM_LIFE_PACK) p.life = Math.min(1, p.life + 0.5);
          else if (e.itemType === ITEM_WEAPON) p.switchWeapon(e.itemFlag);
          else if (e.itemType === ITEM_GRENADE) p.nbGrenadeLeft = Math.min(3, p.nbGrenadeLeft + 1);
        }
        if (e.playerID === me.playerID) {
          if (e.itemType === ITEM_LIFE_PACK) audio.play(S.lifePack, 255);
          else if (e.itemType === ITEM_WEAPON || e.itemType === ITEM_GRENADE) audio.play(S.equip, 255);
        }
        break;
      }
      case 'nukeBeep': {
        const p = game.players[e.playerID];
        if (p?.minibot) audio.play3D(S.weapon[WEAPON_NUCLEAR], 5, p.minibot.currentCF.position, 255);
        break;
      }
      case 'playerJoin': {
        const p = game.players[e.playerID];
        // Offline the page says who joined; not in the campaign (the bots are the level itself)
        if (p && !online && !this.camp) this.hud.addChat(null, t('chat.joined', { name: p.name }));
        break;
      }
      case 'chat': {
        const p = game.players[e.playerID];
        // The server's own lines come as a kind and a name, written here in our language
        if (e.sys === 'join') this.hud.addChat(null, e.team !== undefined && e.team >= 0 ? t('chat.joinedTeam', { name: e.text, team: teamName(e.team) }) : t('chat.joined', { name: e.text }));
        else if (e.sys === 'leave') this.hud.addChat(null, t('chat.left', { name: e.text }));
        else if (e.sys === 'admin') this.hud.addChat(t('chat.admin'), e.text, 'admin');
        else this.hud.addChat(p ? p.name : null, e.text);
        audio.play(S.chat, 150);
        break;
      }
      case 'feat': {
        // Not in the campaign: dying ends the level there, the announcer has its own lines
        if (this.camp) break;
        // The big ones for everybody, the others only for the one who made them
        const who = game.players[e.playerID] ?? null;
        if (who !== me && !isAnnouncedToAll(e.feat)) break;
        const kind = e.feat;
        if (kind === 'missionFailed' && who === me) this.missionFailedAt = performance.now();
        this.hud.announce(kind, who, game.players[e.victimID] ?? null, e.n, () => playAnnouncer(kind));
        break;
      }
      case 'mapChange':
        this.announceStart();
        // The match that just ended may hold a new personal record (online, 30 s played at least)
        if (this.online && me.timePlayedCurGame >= 30 && me.kills > 0) {
          saveBestKills(this.opts.mode, me.kills);
          this.hud.setRecord(Math.max(this.opts.bestKills ?? 0, bestKills(this.opts.mode)));
        }
        if (fromServer) {
          this.setVote(null);
          void this.changeMapOnline(e.mapName);
          break;
        }
        this.onMapLoaded(game.map);
        this.hud.resetMatch();
        for (const b of this.babos.values()) b.dispose();
        this.babos.clear();
        break;
      case 'roundState':
        if (fromServer) game.roundState = e.state;
        break;
      case 'flag': {
        // ClientRecv NET_SVCL_CHANGE_FLAG_STATE / NET_SVCL_DROP_FLAG
        if (fromServer) game.applyFlag(e.flagID, e.state, e.position);
        const p = game.players[e.playerID] ?? null;
        if (e.reason === 'took' && p) audio.play(p.teamID === me.teamID ? S.flagTookFriend : S.flagTookEnemy, 255);
        else if (e.reason === 'returned') audio.play(S.flagReturn, 255);
        else if (e.reason === 'captured' && p && (p.teamID === 0 || p.teamID === 1)) audio.play(S.cheer[p.teamID], 255);
        this.hud.flagEvent(e.reason, e.flagID, p, me);
        break;
      }
      case 'teamChange': {
        const p = game.players[e.playerID];
        if (!p) break;
        if (fromServer) p.teamID = e.teamID;
        this.hud.addChat(null, t('chat.balanced', { name: p.name, team: teamName(e.teamID) }));
        break;
      }
    }
  }

  /** Consumes one hit we predicted on this victim (recent ones only). */
  private takePredictedHit(victimID: number): boolean {
    const pending = this.predictedHits.get(victimID);
    if (!pending) return false;
    const now = performance.now();
    while (pending.length && now - pending[0] > 1500) pending.shift();
    if (!pending.length) return false;
    pending.shift();
    return true;
  }

  /** Casing ejection data (Weapon::shoot, ejectingBrass dummy). */
  private brassFor(p: Player, weaponID: number, nuzzleID: number): BrassEjection | null {
    const ejects = weaponDummies[weaponID]?.ejects ?? [];
    const d = ejects[nuzzleID] ?? ejects[0];
    if (!d) return null;
    const angle = p.currentCF.angle;
    const pos = rotateAboutAxis(Vec3.from(d.position).mul(WEAPON_MODEL_SCALE), angle, Z_AXIS).add(p.currentCF.position).sub(new Vec3(0, 0, 0.25));
    const up = new Vec3(d.matrix[6], d.matrix[7], d.matrix[8]);
    const right = new Vec3(d.matrix[0], d.matrix[1], d.matrix[2]);
    return { pos, dir: rotateAboutAxis(up, angle, Z_AXIS), right: rotateAboutAxis(right, angle, Z_AXIS) };
  }

  // ---------------------------------------------------------------- HUD

  /** What the HTML HUD shows this frame. */
  private hudFrame(scope: number): HudFrame {
    const view = this.view;
    const top = new Vec3();
    return {
      game: this.game,
      players: this.game.players,
      me: this.me,
      online: this.online,
      timeLeft: this.game.gameTimeLeft,
      roundState: this.game.roundState,
      pingMs: this.conn ? this.conn.rtt : null,
      mouseX: this.input.mouseX,
      mouseY: this.input.mouseY,
      showScores: this.input.isDown(bindings.showScore) && !this.chat.active,
      campaign: this.campaignHud(),
      chatInput: this.chat.active ? this.chat.text : null,
      scope,
      // Player::renderName: where a babo is on the screen (its drawn position), and just above it
      project: (p) => {
        const v = this.babos.get(p.playerID);
        const pos = v ? v.renderPosition : p.currentCF.position;
        const c = this.cam.project(pos, view.w, view.h);
        if (!c.visible) return null;
        const t = this.cam.project(top.set(pos.x, pos.y + 0.3, pos.z + 0.25), view.w, view.h);
        return { x: c.x + view.x, y: c.y + view.y, top: t.y + view.y };
      },
    };
  }
}

/** Random skin + decal colours for bots (the player picks them in the start screen). */
export function randomSkin(): SkinInfo {
  const skins = Array.from({ length: 23 }, (_, i) => `skin${String(i + 1).padStart(2, '0')}`);
  const c = (): [number, number, number] => [Math.random(), Math.random(), Math.random()];
  const base = c();
  return {
    skin: skins[Math.floor(Math.random() * skins.length)],
    redDecal: [Math.min(1, base[0] + 0.5), Math.min(1, base[1] + 0.5), Math.min(1, base[2] + 0.5)],
    greenDecal: base,
    blueDecal: [base[0] * 0.5, base[1] * 0.5, base[2] * 0.5],
  };
}

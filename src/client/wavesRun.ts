// One run of the waves mode (src/client/waves.ts), driven by ClientGame every tick: the waves (bots
// joining a few at a time, a boss every 5th), the breaks between them, the crates (new ones at each
// break and now and then), the power-ups they drop and their effects, the lives and the end.
import * as THREE from 'three';
import { BotController } from '../sim/bot';
import { PLAYER_STATUS_DEAD, PLAYER_TEAM_BLUE, PLAYER_TEAM_RED, PROJECTILE_DROPED_WEAPON, PROJECTILE_ROCKET, TICK, WEAPON_BAZOOKA, WEAPON_GRENADE, WEAPON_KNIVES, WEAPON_NUCLEAR } from '../sim/constants';
import type { Game } from '../sim/game';
import { weaponDefs } from '../sim/gameVar';
import type { Player, SkinInfo } from '../sim/player';
import { Vec3 } from '../sim/vec';
import { track } from './analytics';
import { WavesRenderer, type FloorPower } from './render/wavesRenderer';
import { BOMB, BOOSTS, ICE_MAX, ICE_SLOW, PERM_KINDS, PERM_STEP, POISON_DPS, POWERS, POWER_WEAPONS, WAVES, bossStrength, eliteStrength, loadWavesRecord, rollElite, rollPerm, rollPower, saveWavesRun, waveSpec, type PermKind, type PowerKind, type WaveSpec, type WavesRecord } from './waves';
import { BLAST_RADIUS, CARDS, CARD_LEVELS, MISSILE_EVERY, MISSILE_GAP, MISSILE_RANGE, NECRO_MAX, NECRO_TIME, REFLECT_EVERY, SHADOW_ALLY, SHADOW_TINT, SILVER_LIFE, UNDEAD_TINT, COMMON_CARDS_EVERY, BERSERK_BELOW, cardDef, offerCards as dealCards, type CardID, type CardLevels, type CardOffer } from './wavesCards';
import { BARRIER_SIZE, BREATHER, DASH_COOLDOWN, MILESTONES, PERM_CAP_BASE, PERM_CAP_STEP, SHOCK, SHOCK_COOLDOWN, UPGRADES, UPGRADE_STEP, addCores, headStartPowers, loadProgress, runCores, type UpgradeID, type Levels, type Milestone, type RunCores, type WavesProgress } from './wavesProgress';

/** What the HUD shows of a run (HudLayer). */
export interface WavesHud {
  wave: number;
  boss: boolean;
  /** 'break': between waves (breakLeft seconds to the next one); 'fight': a wave is on. */
  phase: 'break' | 'fight';
  breakLeft: number;
  /** Seconds before the next wave comes anyway (during a wave). */
  waveLeft: number;
  /** Enemies of the wave still to beat (standing or still to come), and how many it had. */
  left: number;
  total: number;
  lives: number;
  /** The lives at WAVES.maxLives: the hearts say so. */
  livesFull: boolean;
  kills: number;
  /** The timed power-ups on, with their seconds left. */
  powers: { kind: PowerKind; left: number }[];
  /** The permanent ones taken, with their levels; `full`: at the limit the Workshop allows. */
  perms: { kind: PermKind; level: number; full: boolean }[];
  /** The Workshop's abilities bought: their key, and how ready they are (1: ready). */
  abilities: { kind: 'dash' | 'shock'; ready: number }[];
  /** The Workshop's recharging shield (share of a life), or null without it. */
  barrier: { now: number; max: number } | null;
  /**
   * The Reflector card (null without it): whether its shield is up, the seconds it has left (up) or before it comes
   * (down: the clock runs only while a wave is on), and how far that clock is (1: up).
   */
  reflector: { on: boolean; left: number; ready: number } | null;
  /** The cards taken (after each boss), with their levels. */
  cards: { id: CardID; level: number }[];
  bossLife: { name: string; life: number } | null;
  /** The best wave before this run. */
  record: number | null;
  /** The wave's bots against wave 1's: their life (as the damage they take shrinks) and their damage. */
  scale: { life: number; hit: number };
  /** Cores earned so far (the waves survived, the kills, the bosses; a new record adds more at the end). */
  cores: number;
  over: boolean;
}

/** The end of a run. */
export interface WavesEnd {
  wave: number;
  kills: number;
  seconds: number;
  isBest: boolean;
  /** The record before this run (when this one isn't better). */
  best: WavesRecord | null;
  /** The wave the run began on (1, or a checkpoint), and the record before it (0: none). */
  startWave: number;
  recordBefore: number;
  /** The Cores it earned, and the progress with them added. */
  cores: RunCores;
  progress: WavesProgress;
  /** Milestones reached for the first time. */
  unlocked: Milestone[];
  /** The cards taken in the run, with their levels. */
  cards: { id: CardID; level: number }[];
  /** A tester changed the run (WavesRun.setCard, goToWave): it counts for nothing (no record, Cores or ranking). */
  test: boolean;
  /** The ranking's time to reach `wave` (WavesRecord.time; null: begun at a checkpoint, or a tester's), and the deaths it counts. */
  time: number | null;
  deaths: number;
}

type TimedPower = 'speed' | 'rapid' | 'shield' | 'fury';

/** A bot still in the wave: standing, or with a life left to spawn. */
const inWave = (p: Player) => p.isAlive || p.lives > 0;

export interface WavesContext {
  game: Game;
  me: Player;
  /** ClientGame's bots (they think every tick); the run adds and replaces its own here. */
  bots: BotController[];
  scene: THREE.Scene;
  names: string[];
  bossName: string;
  randomSkin: () => SkinInfo;
  /** A wave begins (the banner, the siren). */
  onWave: (spec: WaveSpec) => void;
  /** A wave is cleared. */
  onCleared: (n: number) => void;
  /** A power-up was taken (the sound, the HUD's line); `weaponID` for a new weapon. */
  onPower: (kind: PowerKind, weaponID?: number) => void;
  /** A crate dropped a weapon on the floor (the player takes it with F, or not). */
  onWeaponDrop: (weaponID: number) => void;
  /** The bomb's blast, at the player. */
  onBomb: (position: Vec3) => void;
  /** The Workshop's second wind saved the player. */
  onSecondWind: () => void;
  /**
   * Three cards to choose from (the game waits for WavesRun.pick): the boss fell, or wave `afterWave`
   * (5, 15, 25...) ended (the commons only).
   */
  onCards: (offer: CardOffer[], afterWave?: number) => void;
  /** The Blast card: a kill's blast went off there, this far (drawn light, a few a second at most). */
  onKillBlast: (position: Vec3, radius: number) => void;
  /** The Shadow card's allies' name, the Necromancer's risen enemies' one. */
  allyName: string;
  undeadName: string;
  /** The Silver bullet card: a silver bullet went from p1 to p2. */
  onSilver: (p1: Vec3, p2: Vec3) => void;
  /** The Reflector card: the shield came up on the player. */
  onReflect: () => void;
  /** The Necromancer card: an enemy rose there, or one went back to dust (`gone`). */
  onRise: (position: Vec3, gone: boolean) => void;
  /** The Workshop's abilities: a dash, a shock wave (where it went off). */
  onDash: () => void;
  onShock: (position: Vec3) => void;
  onEnd: (end: WavesEnd) => void;
  /** The wave to begin on (1, or a checkpoint reached), the weapon to spawn with, the Workshop's levels. */
  startWave: number;
  startWeapon: number;
  levels: Levels;
}

export class WavesRun {
  private readonly renderer: WavesRenderer;
  private wave = 0;
  private spec: WaveSpec = waveSpec(1);
  private phase: 'break' | 'fight' = 'break';
  private breakLeft = WAVES.firstBreak;
  private waveLeft = 0;
  /** Bots of the wave still to come, and the wait before the next one joins. */
  private pending = 0;
  private spawnWait = 0;
  private boss: Player | null = null;
  private bossPending = false;
  private nextCrate = WAVES.crates.every;
  private powers: FloorPower[] = [];
  private nextPowerID = 1;
  private timers: Record<TimedPower, number> = { speed: 0, rapid: 0, shield: 0, fury: 0 };
  /** Levels of the permanent power-ups, for the rest of the run. */
  private perms: Record<PermKind, number> = { permFire: 0, permDamage: 0, permArmor: 0, permSpeed: 0, poison: 0, ice: 0 };
  private readonly record = loadWavesRecord();
  /** Bosses beaten, and whether the boss was standing last tick. */
  private bosses = 0;
  private bossUp = false;
  /** Whether the player was alive last tick (a spawn: the Workshop's grenades), the second winds left. */
  private wasAlive = false;
  private windLeft: number;
  /** The run's limit on each permanent power-up (the Workshop), the abilities' cooldowns left. */
  private permCap: number;
  private dashWait = 0;
  private shockWait = 0;
  /** The cards taken, the offer waiting for a choice (null: none), the kills already paid by Vampire, the Grenadier's clock. */
  private readonly cards: CardLevels = {};
  private offer: CardOffer[] | null = null;
  /** What the offer on screen is (the wave of a common one, undefined: the boss's), and the rerolls left (the Workshop). */
  private offerAfter: number | undefined = undefined;
  private rerolls = 0;
  /** The last wave (5, 15, 25...) whose common cards were offered; one whose cards wait for the offer on screen (0: none). */
  private commonCardsAt = 0;
  private owedCards = 0;
  private killsSeen = 0;
  private grenadeClock = 0;
  /** The Blast card: enemies a blast killed (their own death makes no blast: no chain); the Missiles card's clock. */
  private readonly blastKills = new Set<number>();
  private missileClock = 0;
  /** The Shadow card's allies (blue bots walking beside the player), and on which side the next one goes. */
  private readonly allies: Player[] = [];
  /** The Silver bullet card's firing time loaded, the Reflector's clock, the Necromancer's risen (and their seconds left). */
  private silverCharge = 0;
  private reflectClock = 0;
  private readonly risen: { p: Player; left: number }[] = [];
  /** Seconds before the Shadow card's fallen allies come back. */
  private allyClock = 0;
  /** A tester changed the run (the waves' Esc screen, DEBUG_USER_IDS accounts): it counts for nothing. */
  tested = false;
  /** Seconds since the first spawn (dead time too; not the pauses: Esc, the cards). */
  elapsed = 0;
  /**
   * The ranking's time when the wave being played began: the clock, plus WAVES.deathPenalty for each death before it,
   * and the deaths that counts. Null: a run begun at a checkpoint (its time isn't comparable).
   */
  private reachedAt: number | null = null;
  private deathsBefore = 0;
  over = false;

  constructor(private readonly ctx: WavesContext) {
    this.renderer = new WavesRenderer(ctx.scene);
    ctx.game.lifePackHeal = WAVES.lifePackHeal;
    // A run from a checkpoint: the wave before it counts as done, and a head start of power-ups
    this.wave = ctx.startWave - 1;
    this.spec = waveSpec(ctx.startWave);
    this.permCap = PERM_CAP_BASE + PERM_CAP_STEP * ctx.levels.cap;
    this.rerolls = ctx.levels.reroll;
    for (let i = 0; i < headStartPowers(ctx.startWave); i++) {
      const k = rollPerm(this.full);
      if (k) this.perms[k]++;
    }
    // The Workshop's recharging shield, full at the start
    ctx.me.barrierMax = BARRIER_SIZE[ctx.levels.barrier];
    ctx.me.barrier = ctx.me.barrierMax;
    ctx.me.secondWind = ctx.levels.secondWind;
    // The Workshop's grenades make the bag bigger too: what lies on the floor fills it up to that
    ctx.me.maxGrenades = Math.max(ctx.me.maxGrenades, 2 + ctx.levels.grenades);
    // and get only part of the damage bonuses
    ctx.me.grenadeBonus = WAVES.grenadeBonus;
    // The player's own death leaves nothing on the floor (the life and the grenades come from the crates)
    ctx.me.lifePackChance = 0;
    ctx.me.grenadeDropChance = 0;
    this.windLeft = ctx.levels.secondWind;
    this.dropCrates(WAVES.crates.perBreak);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** The page closes mid-run: the wave reached and the Cores stay in this browser (the account gets them at the next sign-in). */
  private readonly onPageHide = (): void => {
    if (!this.over) this.leave();
  };

  /** A permanent power-up at the limit the Workshop allows. */
  private readonly full = (k: PermKind): boolean => this.perms[k] >= this.permCap;

  /** Every tick; `keys`: the Workshop's abilities asked for this tick. */
  update(keys: { dash: boolean; shock: boolean } = { dash: false, shock: false }): void {
    if (this.over) return;
    const me = this.ctx.me;
    this.dashWait = Math.max(0, this.dashWait - TICK);
    this.shockWait = Math.max(0, this.shockWait - TICK);
    if (me.isAlive && keys.dash && this.ctx.levels.dash > 0 && this.dashWait <= 0) this.dash();
    if (me.isAlive && keys.shock && this.ctx.levels.shock > 0 && this.shockWait <= 0) this.shock();
    if (me.isAlive || this.elapsed > 0) this.elapsed += TICK;
    // The same weapons at every spawn (the menu can't change them; a new weapon lasts one life)
    if (!me.isAlive) {
      me.nextSpawnWeapon = this.ctx.startWeapon;
      me.nextMeleeWeapon = WEAPON_KNIVES;
    }
    // A spawn: the Workshop's grenades on top of the usual ones
    if (me.isAlive && !this.wasAlive && this.ctx.levels.grenades > 0) me.nbGrenadeLeft = Math.min(me.maxGrenades, me.nbGrenadeLeft + this.ctx.levels.grenades);
    this.wasAlive = me.isAlive;
    // The second wind saved the player
    if (me.secondWind < this.windLeft) {
      this.windLeft = me.secondWind;
      this.ctx.onSecondWind();
    }
    // A boss beaten
    const bossUp = !!this.boss?.isAlive;
    if (this.bossUp && !bossUp && this.boss && this.boss.lives <= 0) {
      this.bosses++;
      // The boss fell: three cards of every rarity, the game waits for the choice
      this.offerCards();
    }
    this.bossUp = bossUp;
    // Out of lives: the end
    if (!me.isAlive && me.lives <= 0 && this.elapsed > 0) {
      this.end();
      return;
    }

    // The clocks of the break and of the wave stop while the player is dead: dying (and waiting)
    // doesn't bring the waves on, so it can't climb the record
    if (this.phase === 'break') {
      if (me.isAlive) this.breakLeft -= TICK;
      if (this.breakLeft <= 0) this.startWave();
    } else {
      this.updateFight();
    }

    // Crates now and then during a wave
    if (this.phase === 'fight') {
      this.nextCrate -= TICK;
      if (this.nextCrate <= 0) {
        this.nextCrate = WAVES.crates.every;
        this.dropCrates(1);
      }
    }

    // Power-ups on the floor: taken by walking over them, gone after a while
    for (const p of this.powers) p.age += TICK;
    this.powers = this.powers.filter((p) => {
      if (p.age >= p.life) return false;
      if (me.isAlive && Math.hypot(me.currentCF.position.x - p.x, me.currentCF.position.y - p.y) < me.radius + 0.3) {
        this.take(p.kind);
        return false;
      }
      return true;
    });

    // Power-ups: the permanent levels, times the timed ones while they last
    for (const k of Object.keys(this.timers) as TimedPower[]) this.timers[k] = Math.max(0, this.timers[k] - TICK);
    // and the Workshop's levels under them all
    const perm = this.perms;
    const lv = this.ctx.levels;
    me.speedBoost = Math.min(2, (1 + UPGRADE_STEP.speed * lv.speed) * (1 + PERM_STEP * perm.permSpeed) * (this.timers.speed > 0 ? BOOSTS.speed : 1));
    me.fireBoost = (1 + UPGRADE_STEP.fire * lv.fire) * (1 + PERM_STEP * perm.permFire) * (this.timers.rapid > 0 ? BOOSTS.rapid : 1);
    me.armorBoost = (1 - PERM_STEP) ** perm.permArmor * (this.timers.shield > 0 ? BOOSTS.shield : 1) * (1 - UPGRADE_STEP.armor * lv.armor);
    // The Workshop's Life: a bigger bar (100 to 150 points), not a smaller blow
    me.lifeMax = 1 + UPGRADE_STEP.life * lv.life;
    me.damageBoost = (1 + UPGRADE_STEP.damage * lv.damage) * (1 + PERM_STEP * perm.permDamage) * (this.timers.fury > 0 ? BOOSTS.fury : 1);
    // The cards (wavesCards.ts)
    const card = (id: CardID) => CARD_LEVELS[id][this.cards[id] ?? 0];
    me.extraShotChance = card('double');
    me.parallelShot = card('parallel');
    me.fanShot = card('fan');
    me.pierce = card('pierce');
    me.critChance = card('crit');
    me.dodgeChance = card('dodge');
    me.ricochet = card('ricochet');
    // Reflector: the shield comes up by itself now and then (its clock waits while it's up)
    if (!me.isAlive) me.reflectTime = 0;
    if (this.cards.reflect && me.isAlive && this.phase === 'fight' && me.reflectTime <= 0) {
      this.reflectClock += TICK;
      if (this.reflectClock >= REFLECT_EVERY) {
        this.reflectClock = 0;
        me.reflectTime = me.reflectSpan = card('reflect');
        this.ctx.onReflect();
      }
    }
    // Necromancer: the risen go back to dust after a while
    for (const r of this.risen) {
      if (!r.p.isAlive) continue;
      r.left -= TICK;
      if (r.left <= 0) this.vanish(r.p);
    }
    // Shadow: the allies follow the player's strength; a fallen one comes back a few seconds later
    for (const p of this.allies) if (p.isAlive) this.allyStrength(p);
    if (this.allies.some((p) => !p.isAlive) && me.isAlive && this.phase === 'fight') {
      this.allyClock += TICK;
      if (this.allyClock >= SHADOW_ALLY.respawn) {
        this.allyClock = 0;
        this.reviveAllies();
      }
    } else this.allyClock = 0;
    // Missiles: a volley falls on enemies around now and then
    if (this.cards.missiles && me.isAlive && this.phase === 'fight') {
      this.missileClock += TICK;
      if (this.missileClock >= MISSILE_EVERY) {
        this.missileClock = 0;
        this.missiles(card('missiles'));
      }
    }
    // Berserker: below half the life, more damage (Erick, 15/10/2026; it was "Rage", more the less life was left)
    if (this.cards.rage && me.life < BERSERK_BELOW) me.damageBoost *= 1 + card('rage');
    // Vampire: life back for each kill
    if (me.kills > this.killsSeen) {
      // (points of life: a bigger bar fills less of it)
      if (this.cards.vampire && me.isAlive) me.life = Math.min(1, me.life + (card('vampire') * (me.kills - this.killsSeen)) / me.lifeMax);
      this.killsSeen = me.kills;
    }
    // Grenadier: a grenade comes back by itself now and then
    if (this.cards.grenadier && me.isAlive) {
      this.grenadeClock += TICK;
      if (this.grenadeClock >= card('grenadier')) {
        this.grenadeClock = 0;
        if (me.nbGrenadeLeft < me.maxGrenades) me.nbGrenadeLeft++;
      }
    }
    me.poisonShot = POISON_DPS * perm.poison;
    me.iceShot = Math.min(ICE_MAX, ICE_SLOW * perm.ice);
  }

  // ---------------------------------------------------------------- waves

  /**
   * Three cards to choose from, the game waiting (offerCards: one of them a card already taken, maybe two
   * levels at once): of every rarity when the boss falls, the commons only after wave `afterWave` (5, 15, 25...:
   * a choice every 5 waves, Erick, 13/10/2026).
   */
  private offerCards(afterWave?: number): void {
    const offer = dealCards(this.wave, this.cards, afterWave !== undefined);
    if (!offer.length) return;
    this.offer = offer;
    this.offerAfter = afterWave;
    track('waves_cards', { wave: this.wave, offer: offer.map((o) => (o.up > 1 ? `${o.id}+${o.up}` : o.id)).join(','), boss: afterWave === undefined });
    this.ctx.onCards(offer, afterWave);
  }

  /**
   * Waves 5, 15, 25... (COMMON_CARDS_EVERY, not the boss's 10, 20, 30...): their common cards once the wave is over (cleared, or its
   * time up), once; after the boss's if both come at the same moment (a late boss falling as the last enemy).
   */
  private commonCardsAfter(n: number): void {
    if (n % COMMON_CARDS_EVERY !== 0 || n % 10 === 0 || this.commonCardsAt >= n) return;
    this.commonCardsAt = n;
    if (this.offer) this.owedCards = n;
    else this.offerCards(n);
  }

  private startWave(): void {
    // The wave that ends on its time: its cards (waves 5, 15, 25...) if it wasn't cleared
    this.commonCardsAfter(this.wave);
    // The bots (and the boss) the last wave still had to send come too
    const carried = this.pending;
    const bossLate = this.bossPending;
    this.wave++;
    this.spec = waveSpec(this.wave);
    this.phase = 'fight';
    this.deathsBefore = this.ctx.me.deaths;
    this.reachedAt = this.ctx.startWave === 1 ? this.elapsed + WAVES.deathPenalty * this.deathsBefore : null;
    this.waveLeft = this.spec.seconds;
    this.pending = this.spec.total + carried;
    this.spawnWait = 0.5;
    this.bossPending = this.spec.boss || bossLate;
    this.nextCrate = WAVES.crates.every;
    track('wave_start', { wave: this.wave, boss: this.spec.boss });
    this.ctx.onWave(this.spec);
    // The Shadow card's allies fallen in the last wave come back
    this.reviveAllies();
  }

  private updateFight(): void {
    const reds = this.reds();
    // In the wave: standing, or with a life left to spawn. A fallen bot with no life left keeps
    // "pressing" to respawn (spawnRequested stays on, the game refuses): it must not count, else
    // the fallen ones filled the wave's limit and nobody came any more (the wave 3 that never began)
    const standing = reds.filter(inWave).length;
    // Bots join a few each second, all of them (only the game's player slots can hold some back)
    this.spawnWait -= TICK;
    if (this.spawnWait <= 0 && this.pending > 0) {
      this.spawnWait = this.spec.spawnGap;
      if (this.spawnBot()) this.pending--;
    }
    // The boss comes after the first bots
    if (this.bossPending && this.wave > 0 && this.spec.total - this.pending >= Math.min(2, this.spec.total)) {
      this.bossPending = false;
      this.spawnBoss();
    }
    // Cleared: nobody left to come or standing
    // Time's up: the next wave comes, whoever is still standing stays (the clock waits while the player is dead)
    if (this.ctx.me.isAlive) this.waveLeft -= TICK;
    if (this.waveLeft <= 0) {
      this.startWave();
      return;
    }
    if (this.pending === 0 && !this.bossPending && standing === 0) {
      this.phase = 'break';
      this.breakLeft = WAVES.breakSeconds;
      this.dropCrates(WAVES.crates.perBreak);
      // The Workshop's breather: some life back
      const me = this.ctx.me;
      if (me.isAlive) me.life = Math.min(1, me.life + BREATHER[this.ctx.levels.breather]);
      this.ctx.onCleared(this.wave);
      this.commonCardsAfter(this.wave);
    }
  }

  private reds(): Player[] {
    return this.ctx.game.players.filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_RED);
  }

  /**
   * One more bot for the wave: a fallen one comes back with new weapons and skill, or a new one.
   * `escort`: it walks beside that one (the boss), on that side.
   */
  private spawnBot(escort?: { of: Player; side: number }): boolean {
    const { game, bots } = this.ctx;
    const loadout = { primary: this.spec.weapons[Math.floor(Math.random() * this.spec.weapons.length)], secondary: WEAPON_KNIVES };
    let i = bots.findIndex((b) => b.player !== this.boss && !b.player.isAlive && b.player.lives <= 0);
    let p: Player | null = i >= 0 ? bots[i].player : null;
    if (!p) {
      p = game.addPlayer(this.ctx.names[bots.length % this.ctx.names.length], true);
      if (!p) return false;
      p.teamID = PLAYER_TEAM_RED;
      i = bots.length;
    }
    p.skin = this.ctx.randomSkin();
    p.lives = 1;
    p.spawnRequested = false;
    p.timeToSpawn = 0;
    // Tougher and harder hitting each wave (waveSpec), a little slower than the player
    p.damageScale = this.spec.toughness;
    p.damageBoost = this.spec.hitBoost;
    p.speedBoost = WAVES.botSpeed;
    // What lies on the floor (life packs, grenades) is the player's; a fallen bot doesn't always leave one
    p.takesLifePacks = false;
    p.lifePackChance = WAVES.lifePackChance + UPGRADE_STEP.drops * this.ctx.levels.drops;
    // Grenades: none (only the crates give them, since 19/10/2026; one at the life pack's chance before)
    p.grenadeDropChance = 0;
    // They come in from the map's edges, never out of its middle
    p.edgeSpawn = true;
    // An elite, maybe (waves.ts): its traits on top of the wave's numbers
    const traits = rollElite(this.wave);
    const strength = eliteStrength(this.wave);
    p.badges = traits;
    p.radius = 0.25;
    if (traits.includes('fast')) p.speedBoost = Math.min(1.9, WAVES.botSpeed * strength.speed);
    if (traits.includes('brute')) {
      p.damageBoost *= strength.hit;
      p.radius = 0.3;
    }
    if (traits.includes('tank')) p.damageScale *= strength.tough;
    bots[i] = new BotController(p, traits.includes('sniper') ? 1 : this.spec.skill, loadout);
    if (traits.includes('sniper')) bots[i].aimScale = strength.aim;
    if (escort) {
      bots[i].escort = escort.of;
      bots[i].escortSide = escort.side;
      // A little faster than the boss, to catch up with it
      p.speedBoost = Math.max(p.speedBoost, WAVES.botSpeed * 1.15);
    }
    // They come for the player, wherever they are
    bots[i].hunt = this.ctx.me;
    game.requestSpawn(p);
    return true;
  }

  private spawnBoss(): void {
    const { game, bots } = this.ctx;
    if (!this.boss) {
      const p = game.addPlayer(this.ctx.bossName, true);
      if (!p) return;
      p.teamID = PLAYER_TEAM_RED;
      p.radius = WAVES.boss.radius;
      p.edgeSpawn = true;
      p.damageScale = WAVES.boss.damageScale;
      p.takesLifePacks = false;
      // It always leaves a life pack, never its grenades (only the crates give them)
      p.grenadeDropChance = 0;
      // The eye (skin14), in the red team's colours
      p.skin = { ...this.ctx.randomSkin(), skin: 'skin14' };
      this.boss = p;
    }
    const p = this.boss;
    p.lives = 1;
    p.spawnRequested = false;
    p.timeToSpawn = 0;
    // Bigger and much harder hitting each time it comes (bossStrength); its size against the walls stays
    const strength = bossStrength(this.wave);
    p.radius = strength.radius;
    p.wallRadius = WAVES.boss.radius;
    p.damageScale = WAVES.boss.damageScale * this.spec.toughness * strength.tough;
    p.damageBoost = this.spec.hitBoost * strength.hit;
    p.speedBoost = WAVES.botSpeed;
    // Its weapon, and the best shot of the wave (WAVES.boss)
    p.spreadScale = WAVES.boss.spread;
    const bot = new BotController(p, 1, { primary: WAVES.boss.weapon, secondary: WEAPON_KNIVES });
    bot.aimScale = WAVES.boss.aim;
    bot.lead = 0;
    bot.hunt = this.ctx.me;
    const i = bots.findIndex((b) => b.player === p);
    if (i >= 0) bots[i] = bot;
    else bots.push(bot);
    game.requestSpawn(p);
    // Its escorts, one on each side
    for (let k = 0; k < WAVES.escorts; k++) this.spawnBot({ of: p, side: k % 2 === 0 ? 1 : -1 });
  }

  // ---------------------------------------------------------------- crates and power-ups

  /** Up to `n` crates more (at most WAVES.crates.max), on open floor away from us, the spawns and each other. */
  private dropCrates(n: number): void {
    const { game, me } = this.ctx;
    const map = game.map;
    const [w, h] = map.size;
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && map.cells[y * w + x].passable;
    for (let k = 0; k < n && game.crates.length < WAVES.crates.max; k++) {
      for (let tries = 0; tries < 300; tries++) {
        const x = Math.floor(Math.random() * w);
        const y = Math.floor(Math.random() * h);
        // Open floor: the cell and its 8 neighbours
        let open = true;
        for (let dy = -1; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1 && open; dx++) open = free(x + dx, y + dy);
        if (!open) continue;
        const cx = x + 0.5;
        const cy = y + 0.5;
        const far = (px: number, py: number, d: number) => Math.hypot(cx - px, cy - py) >= d;
        if (!far(me.currentCF.position.x, me.currentCF.position.y, 3)) continue;
        if (!map.dmSpawns.every((s) => far(s.x, s.y, 1.5))) continue;
        if (!game.crates.every((c) => far(c.position.x, c.position.y, 2.5))) continue;
        if (!game.players.every((p) => !p || !p.isAlive || far(p.currentCF.position.x, p.currentCF.position.y, 1))) continue;
        game.addCrate(cx, cy);
        break;
      }
    }
  }

  /** A crate was hit (the game's 'crate' event): it shakes; broken, it drops a power-up. */
  onCrate(crateID: number, position: Vec3, broken: boolean): void {
    this.renderer.crateHit(crateID, position.x, position.y, broken);
    if (!broken || this.over) return;
    // Hurt (below WAVES.lowLife.below of the life), more of the crates give life
    const me = this.ctx.me;
    const { below, most } = WAVES.lowLife;
    const hurt = me.isAlive && me.life < below ? 1 - Math.max(0, me.life) / below : 0;
    let kind = rollPower(this.full, 1 + (most - 1) * hurt, this.livesFull);
    // The Workshop's crate luck: a better chance of a permanent one (not one at its limit; not the life a hurt player got)
    if (!POWERS[kind].perm && !(kind === 'life' && hurt > 0) && Math.random() < UPGRADE_STEP.luck * this.ctx.levels.luck) kind = rollPerm(this.full) ?? kind;
    if (kind === 'weapon') {
      // A real weapon on the floor: the player takes it (F) or leaves it
      const options = POWER_WEAPONS.filter((w) => w !== this.ctx.me.weapon?.weaponID);
      const weaponID = options[Math.floor(Math.random() * options.length)];
      this.ctx.game.spawnProjectile(position.clone(), new Vec3(0, 0, 2), this.ctx.me.playerID, PROJECTILE_DROPED_WEAPON, weaponID);
      track('crate_break', { wave: this.wave, drop: 'weapon' });
      this.ctx.onWeaponDrop(weaponID);
      return;
    }
    this.powers.push({ id: this.nextPowerID++, kind, x: position.x, y: position.y, age: 0, life: WAVES.powerOnFloor });
    track('crate_break', { wave: this.wave, drop: kind });
  }

  private take(kind: PowerKind): void {
    const me = this.ctx.me;
    let weaponID: number | undefined;
    switch (kind) {
      case 'life':
        me.life = Math.min(1, me.life + 0.5);
        break;
      case 'ammo':
        me.nbGrenadeLeft = Math.min(Math.max(5, me.maxGrenades), me.nbGrenadeLeft + 2);
        me.nbMolotovLeft = Math.min(3, me.nbMolotovLeft + 1);
        break;
      case 'weapon': {
        const options = POWER_WEAPONS.filter((w) => w !== me.weapon?.weaponID);
        weaponID = options[Math.floor(Math.random() * options.length)];
        me.switchWeapon(weaponID, true);
        break;
      }
      case 'extraLife':
        // Up to WAVES.maxLives (one already on the floor when the lives filled up gives nothing)
        if (!this.livesFull) me.lives++;
        break;
      case 'bomb':
        this.bomb();
        break;
      default:
        if (POWERS[kind].perm) this.perms[kind as PermKind] = Math.min(this.permCap, this.perms[kind as PermKind] + 1);
        else this.timers[kind as TimedPower] = WAVES.powerSeconds;
    }
    track('powerup_pick', { kind, wave: this.wave });
    this.ctx.onPower(kind, weaponID);
  }

  /** The lives at WAVES.maxLives (the one being played counted): no extra life from the crates. */
  get livesFull(): boolean {
    const me = this.ctx.me;
    return me.lives + (me.isAlive ? 1 : 0) >= WAVES.maxLives;
  }

  /** Cards to choose from now (the game waits), or null. */
  get choosing(): CardOffer[] | null {
    return this.offer;
  }

  /** The level of a card taken (0: not taken). */
  cardLevel(id: CardID): number {
    return this.cards[id] ?? 0;
  }

  /** The player took card `i` of the offer: its levels (one, or two), and the run goes on (or the next offer comes). */
  pick(i: number): void {
    const o = this.offer?.[i];
    if (!o) return;
    const id = o.id;
    this.cards[id] = Math.min(cardDef(id).max, (this.cards[id] ?? 0) + o.up);
    this.offer = null;
    track('waves_card', { card: id, level: this.cards[id]!, up: o.up, wave: this.wave });
    if (id === 'shadow') this.reviveAllies();
    if (this.owedCards) {
      const n = this.owedCards;
      this.owedCards = 0;
      this.offerCards(n);
    }
  }

  /** Rerolls left in this run, and a run's (the Workshop's Reroll cards level; 0: no button). */
  get rerollsLeft(): number {
    return this.rerolls;
  }

  get rerollsBought(): number {
    return this.ctx.levels.reroll;
  }

  /** The offer on screen is swapped for three other cards of the same kind (a reroll spent). */
  reroll(): boolean {
    if (!this.offer || this.rerolls <= 0) return false;
    const offer = dealCards(this.wave, this.cards, this.offerAfter !== undefined);
    if (!offer.length) return false;
    this.rerolls--;
    this.offer = offer;
    track('waves_reroll', { wave: this.wave, left: this.rerolls, boss: this.offerAfter === undefined });
    this.ctx.onCards(offer, this.offerAfter);
    return true;
  }

  // ---------------------------------------------------------------- the testers' tools

  /** Every card with its level now (the testers' tools). */
  cardLevels(): { id: CardID; level: number; max: number }[] {
    return CARDS.map((c) => ({ id: c.id, level: this.cards[c.id] ?? 0, max: c.max }));
  }

  /** The testers' tools: a card at any level (0: none). The run then counts for nothing. */
  setCard(id: CardID, level: number): void {
    this.tested = true;
    const lv = Math.max(0, Math.min(cardDef(id).max, Math.round(level)));
    if (lv) this.cards[id] = lv;
    else delete this.cards[id];
    if (id !== 'shadow') return;
    // Fewer allies: the extra ones go; more: they come now
    for (const p of this.allies.splice(CARD_LEVELS.shadow[lv])) this.remove(p);
    this.reviveAllies();
  }

  /** The crates' permanent power-ups of this run, with the Workshop's limit (the testers' tools). */
  permLevels(): { id: PermKind; level: number; max: number }[] {
    return PERM_KINDS.map((k) => ({ id: k, level: this.perms[k], max: this.permCap }));
  }

  /** The testers' tools: a crate's permanent power-up at a level (up to the limit). */
  setPerm(kind: PermKind, level: number): void {
    this.tested = true;
    this.perms[kind] = Math.max(0, Math.min(this.permCap, Math.round(level)));
  }

  /** The testers' tools: a crate's power-up taken now (the timed ones for their seconds, a life, a bomb...). */
  testPower(kind: PowerKind): void {
    this.tested = true;
    this.take(kind);
  }

  /** The Workshop's levels in this run (the testers' tools). */
  workshopLevels(): { id: UpgradeID; level: number; max: number }[] {
    return UPGRADES.map((u) => ({ id: u.id, level: this.ctx.levels[u.id], max: u.costs.length }));
  }

  /**
   * The testers' tools: a Workshop upgrade at a level for this run only (what was bought stays as it was),
   * applied now, also what a run only sets when it begins (the shield, the second wind, the bag, the limit, the lives).
   */
  setWorkshopLevel(id: UpgradeID, level: number): void {
    this.tested = true;
    const u = UPGRADES.find((x) => x.id === id);
    if (!u) return;
    const lv = Math.max(0, Math.min(u.costs.length, Math.round(level)));
    const before = this.ctx.levels[id];
    this.ctx.levels[id] = lv;
    const me = this.ctx.me;
    switch (id) {
      case 'barrier':
        me.barrierMax = BARRIER_SIZE[lv];
        me.barrier = me.barrierMax;
        break;
      case 'secondWind':
        me.secondWind = this.windLeft = lv;
        break;
      case 'grenades':
        me.maxGrenades = Math.max(3, 2 + lv);
        me.nbGrenadeLeft = Math.min(me.nbGrenadeLeft, me.maxGrenades);
        break;
      case 'cap':
        this.permCap = PERM_CAP_BASE + PERM_CAP_STEP * lv;
        for (const k of PERM_KINDS) this.perms[k] = Math.min(this.perms[k], this.permCap);
        break;
      case 'lives':
        me.lives = Math.max(0, me.lives + lv - before);
        break;
      case 'reroll':
        this.rerolls = lv;
        break;
    }
  }

  /**
   * The testers' tools: wave `n` begins as soon as the game goes on (its bots, its boss), the enemies
   * standing gone first when `clear`. The run then counts for nothing.
   */
  goToWave(n: number, clear: boolean): void {
    this.tested = true;
    if (clear) {
      for (const p of this.reds()) this.remove(p);
      // Gone, not beaten: no cards for it
      this.bossUp = false;
      this.pending = 0;
      this.bossPending = false;
    }
    this.wave = Math.max(0, Math.round(n) - 1);
    // A jump gives no cards for the wave before it (and the waves after it give theirs again)
    this.commonCardsAt = this.wave;
    this.owedCards = 0;
    this.phase = 'break';
    this.breakLeft = 0;
  }

  /**
   * An enemy went down (the game's 'death' event). The Blast card: killed by the player, it blows up and
   * hurts the enemies around (in sight); those a blast kills don't blow up in turn.
   */
  onEnemyDown(victimID: number, fromID: number, position: Vec3): void {
    const chained = this.blastKills.delete(victimID);
    const { game, me } = this.ctx;
    if (this.over || fromID !== me.playerID) return;
    const victim = game.players[victimID];
    if (!victim || victim.teamID !== PLAYER_TEAM_RED) return;
    // Necromancer: it may rise there on the player's side (never the boss)
    if (this.cards.necro && victim !== this.boss) this.raise(victim, position);
    const level = this.cards.blast ?? 0;
    if (chained || !level) return;
    const radius = BLAST_RADIUS[level];
    const power = CARD_LEVELS.blast[level];
    for (const p of this.reds()) {
      if (!p.isAlive || p.playerID === victimID) continue;
      const d = Math.hypot(p.currentCF.position.x - position.x, p.currentCF.position.y - position.y);
      if (d >= radius + p.radius || game.map.rayTest(position.clone(), p.currentCF.position.clone(), new Vec3())) continue;
      p.hitSV(WEAPON_GRENADE, me, power * (1 - d / (radius * 1.5)));
      if (!p.isAlive) this.blastKills.add(p.playerID);
    }
    // A ring of fire out to the blast's reach (a few at once at most), and the fire and the sound
    this.renderer.blastRing(position.x, position.y, radius);
    this.ctx.onKillBlast(position, radius);
  }

  /**
   * The Missiles card: `n` bazooka rockets falling from the sky at an angle around the player (MISSILE_RANGE),
   * their blast sparing him. Spread out (13/10/2026, they all fell on the same spot): one on each enemy around
   * first, then on the floor around them, never two closer than MISSILE_GAP.
   */
  private missiles(n: number): void {
    const { game, me } = this.ctx;
    const at = me.currentCF.position;
    const targets = this.reds()
      .filter((p) => p.isAlive && Math.hypot(p.currentCF.position.x - at.x, p.currentCF.position.y - at.y) < MISSILE_RANGE)
      .sort(() => Math.random() - 0.5);
    if (!targets.length) {
      // Nobody around yet: the volley waits a little
      this.missileClock = MISSILE_EVERY - 2;
      return;
    }
    const points: Vec3[] = [];
    const apart = (x: number, y: number) => points.every((q) => Math.hypot(q.x - x, q.y - y) >= MISSILE_GAP);
    for (const t of targets) {
      const p = t.currentCF.position;
      if (points.length < n && apart(p.x, p.y)) points.push(new Vec3(p.x, p.y, 0));
    }
    for (let tries = 0; points.length < n && tries < n * 12; tries++) {
      const c = targets[tries % targets.length].currentCF.position;
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 1.6;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r;
      if (game.map.cellAt(Math.floor(x), Math.floor(y))?.passable && apart(x, y)) points.push(new Vec3(x, y, 0));
    }
    for (let i = 0; i < points.length; i++) {
      const to = points[i];
      const from = new Vec3(to.x - 2.5 + Math.random(), to.y + 2.5 + Math.random(), 7 + i * 0.6);
      if (!game.spawnProjectile(from, to.sub(from).normalizeIn().mul(4), me.playerID, PROJECTILE_ROCKET, WEAPON_BAZOOKA)) continue;
      game.projectiles[game.projectiles.length - 1].rain = true;
    }
    track('waves_ability', { ability: 'missiles', wave: this.wave });
  }

  /**
   * The player fired (the game's 'fire' event, its weapon only): the Silver bullet card loads with the
   * firing time (the same for every weapon), and a full load fires a silver bullet along the aim.
   */
  onFire(weaponID: number, origin: Vec3, direction: Vec3): void {
    const me = this.ctx.me;
    const every = CARD_LEVELS.silver[this.cards.silver ?? 0];
    if (this.over || !every || !me.isAlive || weaponID !== me.weapon?.weaponID) return;
    this.silverCharge += weaponDefs[weaponID].fireDelay / me.fireBoost;
    if (this.silverCharge < every) return;
    this.silverCharge = 0;
    // An ordinary enemy of the wave drops (its toughness undone); the tanks and the boss lose a share
    const { p1, p2 } = this.ctx.game.silverShot(me, origin, direction, SILVER_LIFE / this.spec.toughness);
    this.ctx.onSilver(p1, p2);
  }

  /** The Necromancer card: maybe the enemy just killed rises there, on the player's side, for a while. */
  private raise(victim: Player, position: Vec3): void {
    const level = this.cards.necro ?? 0;
    if (Math.random() >= CARD_LEVELS.necro[level]) return;
    if (this.risen.filter((r) => r.p.isAlive).length >= NECRO_MAX[level]) return;
    const { game, me, bots } = this.ctx;
    let r = this.risen.find((x) => !x.p.isAlive);
    if (!r) {
      const p = game.addPlayer(this.ctx.undeadName, true);
      if (!p) return;
      p.teamID = PLAYER_TEAM_BLUE;
      p.ghost = true;
      // The enemy's Orb, in a ghostly green (not the player's blue)
      p.teamTint = UNDEAD_TINT;
      p.takesLifePacks = false;
      p.lifePackChance = 0;
      p.grenadeDropChance = 0;
      r = { p, left: 0 };
      this.risen.push(r);
    }
    const p = r.p;
    p.skin = victim.skin;
    p.lives = 1;
    p.spawnRequested = false;
    p.timeToSpawn = 0;
    // As tough and as strong as the wave's enemies, with the weapon it had
    p.damageScale = this.spec.toughness;
    p.damageBoost = this.spec.hitBoost;
    p.speedBoost = 1;
    const bot = new BotController(p, Math.min(1, this.spec.skill + 0.1), { primary: victim.weapon?.weaponID ?? this.ctx.startWeapon, secondary: WEAPON_KNIVES });
    bot.escort = me;
    bot.escortSide = this.risen.indexOf(r) % 2 === 0 ? 1 : -1;
    bot.escortSlack = SHADOW_ALLY.slack;
    bot.escortGap = SHADOW_ALLY.gap;
    const i = bots.findIndex((b) => b.player === p);
    if (i >= 0) bots[i] = bot;
    else bots.push(bot);
    game.requestSpawn(p);
    if (!p.isAlive) return;
    // Up where it fell
    p.currentCF.position.set(position.x, position.y, 0.25);
    p.lastCF.position.copy(p.currentCF.position);
    p.currentCF.vel.set(0, 0, 0);
    r.left = NECRO_TIME;
    this.ctx.onRise(p.currentCF.position.clone(), false);
  }

  /** A risen enemy goes back to dust: gone without a death (no kill, no line in the feed, nothing dropped). */
  private vanish(p: Player): void {
    this.ctx.onRise(p.currentCF.position.clone(), true);
    this.remove(p);
  }

  /** A babo out of the run at once, without a death (no kill, no line in the feed, nothing dropped). */
  private remove(p: Player): void {
    p.status = PLAYER_STATUS_DEAD;
    p.lives = 0;
    p.currentCF.position.set(-999, -999, 0);
    p.lastCF.position.copy(p.currentCF.position);
  }

  /**
   * A Shadow ally's strength, from the player's as it is now (the Workshop, the run's power-ups, the cards):
   * SHADOW_ALLY.share of each of his bonuses (damage, attack speed, speed, protection from his defence and life,
   * criticals, poison, ice). Never stronger than him.
   */
  private allyStrength(p: Player): void {
    const me = this.ctx.me;
    const share = SHADOW_ALLY.share;
    const part = (mine: number) => 1 + (mine - 1) * share;
    // What reaches him of a blow (defence, timed shield, a bigger life bar), from his own base
    const protect = Math.min(1, me.armorBoost / me.lifeMax);
    p.damageScale = me.damageScale * (1 - (1 - protect) * share);
    p.armorBoost = 1;
    p.damageBoost = part(me.damageBoost);
    p.fireBoost = part(me.fireBoost);
    p.speedBoost = part(me.speedBoost);
    p.critChance = me.critChance * share;
    p.poisonShot = me.poisonShot * share;
    p.iceShot = me.iceShot * share;
    p.grenadeBonus = me.grenadeBonus;
  }

  /** The Shadow card: as many allies as its level, the fallen ones back beside the player. */
  private reviveAllies(): void {
    const { game, me, bots } = this.ctx;
    const want = CARD_LEVELS.shadow[this.cards.shadow ?? 0];
    while (this.allies.length < want) {
      const p = game.addPlayer(this.ctx.allyName, true);
      if (!p) break;
      p.teamID = PLAYER_TEAM_BLUE;
      // The player walks and shoots through them (they bumped him and took his bullets)
      p.ghost = true;
      // Not his Orb nor his blue: an Orb of their own, in a light cyan blue (he lost himself among them);
      // never the eye, the bosses' Orb
      do p.skin = this.ctx.randomSkin();
      while (p.skin.skin === 'skin14');
      p.teamTint = SHADOW_TINT;
      p.takesLifePacks = false;
      p.lifePackChance = 0;
      p.grenadeDropChance = 0;
      p.lives = 0;
      this.allies.push(p);
    }
    this.allies.forEach((p, k) => {
      if (p.isAlive) return;
      p.lives = 1;
      p.spawnRequested = false;
      p.timeToSpawn = 0;
      // As strong as the player, a little less (kept so every tick: allyStrength)
      this.allyStrength(p);
      p.speedBoost = 1;
      const bot = new BotController(p, Math.min(1, Math.max(SHADOW_ALLY.skill, this.spec.skill + 0.1)), { primary: this.ctx.startWeapon, secondary: WEAPON_KNIVES });
      bot.escort = me;
      bot.escortSide = k % 2 === 0 ? 1 : -1;
      // Off to fight whoever is in sight near the player, a step away from him otherwise
      bot.escortSlack = SHADOW_ALLY.slack;
      bot.escortGap = SHADOW_ALLY.gap;
      const i = bots.findIndex((b) => b.player === p);
      if (i >= 0) bots[i] = bot;
      else bots.push(bot);
      game.requestSpawn(p);
      // Right beside the player when the floor there is free
      const x = me.currentCF.position.x + bot.escortSide * 0.8;
      const y = me.currentCF.position.y - 0.3 * k;
      const cell = game.map.cellAt(Math.floor(x), Math.floor(y));
      if (p.isAlive && me.isAlive && cell?.passable) {
        p.currentCF.position.set(x, y, 0.25);
        p.lastCF.position.copy(p.currentCF.position);
      }
    });
  }

  /** The Workshop's dash: the way the keys go (else towards the aim), past the speed limit for a moment. */
  private dash(): void {
    const me = this.ctx.me;
    const i = me.input;
    let dir = new Vec3((i.right ? 1 : 0) - (i.left ? 1 : 0), (i.up ? 1 : 0) - (i.down ? 1 : 0), 0);
    if (dir.lengthSq() < 1e-6) dir = me.currentCF.mousePosOnMap.sub(me.currentCF.position);
    me.dash(dir);
    this.dashWait = DASH_COOLDOWN[this.ctx.levels.dash];
    track('waves_ability', { ability: 'dash', wave: this.wave });
    this.ctx.onDash();
  }

  /** The Workshop's shock wave: hurts and throws back the enemies around (in sight), breaks the crates near. */
  private shock(): void {
    const { game, me } = this.ctx;
    const pos = me.currentCF.position.clone();
    for (const p of this.reds()) {
      if (!p.isAlive) continue;
      const d = Math.hypot(p.currentCF.position.x - pos.x, p.currentCF.position.y - pos.y);
      if (d >= SHOCK.radius + p.radius || game.map.rayTest(pos.clone(), p.currentCF.position.clone(), new Vec3())) continue;
      const away = new Vec3(p.currentCF.position.x - pos.x, p.currentCF.position.y - pos.y, 0);
      if (away.lengthSq() > 1e-6) p.currentCF.vel.addIn(away.normalizeIn().mul(SHOCK.push));
      p.hitSV(WEAPON_NUCLEAR, me, SHOCK.damage * (1 - d / (SHOCK.radius * 1.5)));
    }
    for (const c of [...game.crates]) {
      if (Math.hypot(c.position.x - pos.x, c.position.y - pos.y) < SHOCK.radius) game.hitCrate(c, 10, me);
    }
    this.shockWait = SHOCK_COOLDOWN[this.ctx.levels.shock];
    track('waves_ability', { ability: 'shock', wave: this.wave });
    this.ctx.onShock(pos);
  }

  /** The bomb: a big blast around the player that hurts only the enemies (and breaks crates). */
  private bomb(): void {
    const { game, me } = this.ctx;
    const pos = me.currentCF.position.clone();
    const { radius, lives } = BOMB;
    for (const p of this.reds()) {
      if (!p.isAlive) continue;
      const d = Math.hypot(p.currentCF.position.x - pos.x, p.currentCF.position.y - pos.y);
      if (d >= radius || game.map.rayTest(pos.clone(), p.currentCF.position.clone(), new Vec3())) continue;
      p.hitSV(WEAPON_NUCLEAR, me, (lives / this.spec.toughness) * (1 - d / (radius * 2)));
    }
    for (const c of [...game.crates]) {
      if (Math.hypot(c.position.x - pos.x, c.position.y - pos.y) < radius) game.hitCrate(c, 10, me);
    }
    // Its reach on the floor, as the Blast card's ring
    this.renderer.blastRing(pos.x, pos.y, radius);
    this.ctx.onBomb(pos);
  }

  // ---------------------------------------------------------------- end, HUD, drawing

  /**
   * The player leaves before the end (the menu, a closed page): the wave being fought counts as
   * reached, kept here (the record, the Cores) and returned for the account.
   */
  leave(): WavesEnd | null {
    if (this.over || this.wave < this.ctx.startWave) return null;
    return this.finish();
  }

  private end(): void {
    this.ctx.onEnd(this.finish());
  }

  /** The run is over: the record and the Cores are saved (not for a tester's run: it counts for nothing). */
  private finish(): WavesEnd {
    this.over = true;
    const kills = this.ctx.me.kills;
    const wave = Math.max(this.ctx.startWave, this.wave);
    const test = this.tested;
    const time = test || this.reachedAt === null ? null : Math.round(this.reachedAt);
    const isBest = !test && saveWavesRun(wave, kills, time);
    const cores = test
      ? { waves: 0, waveCores: 0, kills, killCores: 0, bosses: this.bosses, bossCores: 0, recordCores: 0, total: 0 }
      : runCores(this.ctx.startWave, wave, kills, this.bosses, isBest);
    const before = this.record?.wave ?? 0;
    return {
      wave,
      kills,
      seconds: this.elapsed,
      isBest,
      best: isBest ? null : this.record,
      startWave: this.ctx.startWave,
      recordBefore: before,
      cores,
      progress: test ? loadProgress() : addCores(cores.total),
      unlocked: test ? [] : MILESTONES.filter((m) => m.wave > before && m.wave <= wave),
      cards: this.cardList(),
      test,
      time,
      deaths: this.deathsBefore,
    };
  }

  hud(): WavesHud {
    const me = this.ctx.me;
    const reds = this.reds();
    const standing = reds.filter(inWave).length;
    const boss = this.boss;
    return {
      wave: Math.max(this.ctx.startWave, this.wave),
      boss: this.spec.boss && this.phase === 'fight',
      phase: this.phase,
      breakLeft: Math.max(0, this.breakLeft),
      waveLeft: Math.max(0, this.waveLeft),
      left: this.phase === 'fight' ? this.pending + standing + (this.bossPending ? 1 : 0) : 0,
      total: this.spec.total + (this.spec.boss ? 1 + WAVES.escorts : 0),
      lives: me.lives + (me.isAlive ? 1 : 0),
      livesFull: this.livesFull,
      kills: me.kills,
      powers: (Object.keys(this.timers) as TimedPower[]).filter((k) => this.timers[k] > 0).map((k) => ({ kind: k, left: this.timers[k] })),
      perms: PERM_KINDS.filter((k) => this.perms[k] > 0).map((k) => ({ kind: k, level: this.perms[k], full: this.perms[k] >= this.permCap })),
      abilities: [
        ...(this.ctx.levels.dash > 0 ? [{ kind: 'dash' as const, ready: 1 - this.dashWait / DASH_COOLDOWN[this.ctx.levels.dash] }] : []),
        ...(this.ctx.levels.shock > 0 ? [{ kind: 'shock' as const, ready: 1 - this.shockWait / SHOCK_COOLDOWN[this.ctx.levels.shock] }] : []),
      ],
      barrier: me.barrierMax > 0 ? { now: me.barrier, max: me.barrierMax } : null,
      reflector: !this.cards.reflect
        ? null
        : me.reflectTime > 0
          ? { on: true, left: me.reflectTime, ready: 1 }
          : { on: false, left: REFLECT_EVERY - this.reflectClock, ready: this.reflectClock / REFLECT_EVERY },
      cards: this.cardList(),
      bossLife: boss && this.spec.boss && this.phase === 'fight' && (boss.isAlive || boss.lives > 0) ? { name: boss.name, life: boss.isAlive ? boss.life : 1 } : null,
      record: this.record?.wave ?? null,
      // How much tougher and harder hitting the wave's bots are than on wave 1
      scale: { life: 1 / this.spec.toughness, hit: this.spec.hitBoost },
      cores: runCores(this.ctx.startWave, Math.max(this.ctx.startWave, this.wave), me.kills, this.bosses, false).total,
      over: this.over,
    };
  }

  private cardList(): { id: CardID; level: number }[] {
    return (Object.keys(this.cards) as CardID[]).map((id) => ({ id, level: this.cards[id]! }));
  }

  /** The wave being fought, for analytics. */
  get waveNumber(): number {
    return Math.max(this.ctx.startWave, this.wave);
  }

  render(dt: number, time: number): void {
    // Enemies hit by the poison or ice shots: a ring under them
    const marks = this.reds()
      .filter((p) => p.isAlive && (p.poisonLeft > 0 || p.chillLeft > 0))
      .map((p) => ({ id: p.playerID, x: p.currentCF.position.x, y: p.currentCF.position.y, poison: p.poisonLeft > 0, ice: p.chillLeft > 0 }));
    this.renderer.render(this.ctx.game.crates, this.powers, marks, dt, time);
  }

  dispose(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    this.renderer.dispose();
  }
}


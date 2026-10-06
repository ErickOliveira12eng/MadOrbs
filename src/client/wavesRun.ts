// One run of the waves mode (src/client/waves.ts), driven by ClientGame every tick: the waves (bots
// joining a few at a time, a boss every 5th), the breaks between them, the crates (new ones at each
// break and now and then), the power-ups they drop and their effects, the lives and the end.
import * as THREE from 'three';
import { BotController } from '../sim/bot';
import { PLAYER_TEAM_RED, PROJECTILE_DROPED_WEAPON, TICK, WEAPON_KNIVES, WEAPON_NUCLEAR } from '../sim/constants';
import type { Game } from '../sim/game';
import type { Player, SkinInfo } from '../sim/player';
import { Vec3 } from '../sim/vec';
import { track } from './analytics';
import { WavesRenderer, type FloorPower } from './render/wavesRenderer';
import { BOOSTS, ICE_MAX, ICE_SLOW, PERM_KINDS, PERM_STEP, POISON_DPS, POWERS, POWER_WEAPONS, WAVES, loadWavesRecord, rollPower, saveWavesRun, waveSpec, type PermKind, type PowerKind, type WaveSpec, type WavesRecord } from './waves';

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
  kills: number;
  /** The timed power-ups on, with their seconds left. */
  powers: { kind: PowerKind; left: number }[];
  /** The permanent ones taken, with their levels. */
  perms: { kind: PermKind; level: number }[];
  bossLife: { name: string; life: number } | null;
  /** The best wave before this run. */
  record: number | null;
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
  onEnd: (end: WavesEnd) => void;
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
  /** Seconds since the first spawn. */
  elapsed = 0;
  over = false;

  constructor(private readonly ctx: WavesContext) {
    this.renderer = new WavesRenderer(ctx.scene);
    this.dropCrates(WAVES.crates.perBreak);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** The page closes mid-run: the wave reached stays in this browser (the account gets it at the next sign-in). */
  private readonly onPageHide = (): void => {
    if (!this.over && this.wave > 0) saveWavesRun(this.wave, this.ctx.me.kills);
  };

  /** Every tick. */
  update(): void {
    if (this.over) return;
    const me = this.ctx.me;
    if (me.isAlive || this.elapsed > 0) this.elapsed += TICK;
    // The same weapons at every spawn (the menu can't change them; a new weapon lasts one life)
    if (!me.isAlive) {
      me.nextSpawnWeapon = WAVES.primary;
      me.nextMeleeWeapon = WEAPON_KNIVES;
    }
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
    const perm = this.perms;
    me.speedBoost = Math.min(2, (1 + PERM_STEP * perm.permSpeed) * (this.timers.speed > 0 ? BOOSTS.speed : 1));
    me.fireBoost = (1 + PERM_STEP * perm.permFire) * (this.timers.rapid > 0 ? BOOSTS.rapid : 1);
    me.armorBoost = (1 - PERM_STEP) ** perm.permArmor * (this.timers.shield > 0 ? BOOSTS.shield : 1);
    me.damageBoost = (1 + PERM_STEP * perm.permDamage) * (this.timers.fury > 0 ? BOOSTS.fury : 1);
    me.poisonShot = POISON_DPS * perm.poison;
    me.iceShot = Math.min(ICE_MAX, ICE_SLOW * perm.ice);
  }

  // ---------------------------------------------------------------- waves

  private startWave(): void {
    // The bots (and the boss) the last wave still had to send come too
    const carried = this.pending;
    const bossLate = this.bossPending;
    this.wave++;
    this.spec = waveSpec(this.wave);
    this.phase = 'fight';
    this.waveLeft = this.spec.seconds;
    this.pending = this.spec.total + carried;
    this.spawnWait = 0.5;
    this.bossPending = this.spec.boss || bossLate;
    this.nextCrate = WAVES.crates.every;
    track('wave_start', { wave: this.wave, boss: this.spec.boss });
    this.ctx.onWave(this.spec);
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
      this.ctx.onCleared(this.wave);
    }
  }

  private reds(): Player[] {
    return this.ctx.game.players.filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_RED);
  }

  /** One more bot for the wave: a fallen one comes back with new weapons and skill, or a new one. */
  private spawnBot(): boolean {
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
    // What lies on the floor (life packs, grenades) is the player's
    p.takesLifePacks = false;
    bots[i] = new BotController(p, this.spec.skill, loadout);
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
      p.damageScale = WAVES.boss.damageScale;
      p.takesLifePacks = false;
      // The eye (skin14), in the red team's colours
      p.skin = { ...this.ctx.randomSkin(), skin: 'skin14' };
      this.boss = p;
    }
    const p = this.boss;
    p.lives = 1;
    p.spawnRequested = false;
    p.timeToSpawn = 0;
    p.damageScale = WAVES.boss.damageScale * this.spec.toughness;
    p.damageBoost = this.spec.hitBoost;
    const heavy = this.spec.weapons[this.spec.weapons.length - 1];
    p.speedBoost = WAVES.botSpeed;
    const bot = new BotController(p, Math.min(1, this.spec.skill + 0.1), { primary: heavy, secondary: WEAPON_KNIVES });
    bot.hunt = this.ctx.me;
    const i = bots.findIndex((b) => b.player === p);
    if (i >= 0) bots[i] = bot;
    else bots.push(bot);
    game.requestSpawn(p);
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
    const kind = rollPower();
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
        me.nbGrenadeLeft = Math.min(5, me.nbGrenadeLeft + 2);
        me.nbMolotovLeft = Math.min(3, me.nbMolotovLeft + 1);
        break;
      case 'weapon': {
        const options = POWER_WEAPONS.filter((w) => w !== me.weapon?.weaponID);
        weaponID = options[Math.floor(Math.random() * options.length)];
        me.switchWeapon(weaponID, true);
        break;
      }
      case 'extraLife':
        me.lives++;
        break;
      case 'bomb':
        this.bomb();
        break;
      default:
        if (POWERS[kind].perm) this.perms[kind as PermKind]++;
        else this.timers[kind as TimedPower] = WAVES.powerSeconds;
    }
    track('powerup_pick', { kind, wave: this.wave });
    this.ctx.onPower(kind, weaponID);
  }

  /** The bomb: a big blast around the player that hurts only the enemies (and breaks crates). */
  private bomb(): void {
    const { game, me } = this.ctx;
    const pos = me.currentCF.position.clone();
    const radius = 6;
    for (const p of this.reds()) {
      if (!p.isAlive) continue;
      const d = Math.hypot(p.currentCF.position.x - pos.x, p.currentCF.position.y - pos.y);
      if (d >= radius || game.map.rayTest(pos.clone(), p.currentCF.position.clone(), new Vec3())) continue;
      p.hitSV(WEAPON_NUCLEAR, me, 3 * (1 - d / (radius * 1.5)));
    }
    for (const c of [...game.crates]) {
      if (Math.hypot(c.position.x - pos.x, c.position.y - pos.y) < radius) game.hitCrate(c, 10, me);
    }
    this.ctx.onBomb(pos);
  }

  // ---------------------------------------------------------------- end, HUD, drawing

  /**
   * The player leaves before the end (the menu, a closed page): the wave being fought counts as
   * reached, kept here (the record) and returned for the account.
   */
  leave(): { wave: number; kills: number; isBest: boolean } | null {
    if (this.over || this.wave === 0) return null;
    this.over = true;
    const wave = this.wave;
    const kills = this.ctx.me.kills;
    return { wave, kills, isBest: saveWavesRun(wave, kills) };
  }

  private end(): void {
    this.over = true;
    const kills = this.ctx.me.kills;
    const wave = Math.max(1, this.wave);
    const isBest = saveWavesRun(wave, kills);
    this.ctx.onEnd({ wave, kills, seconds: this.elapsed, isBest, best: isBest ? null : this.record });
  }

  hud(): WavesHud {
    const me = this.ctx.me;
    const reds = this.reds();
    const standing = reds.filter(inWave).length;
    const boss = this.boss;
    return {
      wave: Math.max(1, this.wave),
      boss: this.spec.boss && this.phase === 'fight',
      phase: this.phase,
      breakLeft: Math.max(0, this.breakLeft),
      waveLeft: Math.max(0, this.waveLeft),
      left: this.phase === 'fight' ? this.pending + standing + (this.bossPending ? 1 : 0) : 0,
      total: this.spec.total + (this.spec.boss ? 1 : 0),
      lives: me.lives + (me.isAlive ? 1 : 0),
      kills: me.kills,
      powers: (Object.keys(this.timers) as TimedPower[]).filter((k) => this.timers[k] > 0).map((k) => ({ kind: k, left: this.timers[k] })),
      perms: PERM_KINDS.filter((k) => this.perms[k] > 0).map((k) => ({ kind: k, level: this.perms[k] })),
      bossLife: boss && this.spec.boss && this.phase === 'fight' && (boss.isAlive || boss.lives > 0) ? { name: boss.name, life: boss.isAlive ? boss.life : 1 } : null,
      record: this.record?.wave ?? null,
      over: this.over,
    };
  }

  /** The wave being fought, for analytics. */
  get waveNumber(): number {
    return Math.max(1, this.wave);
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


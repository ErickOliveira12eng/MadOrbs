// The Vesuvius (the prize past wave 100 of the Waves; Erick, 31/10/2026): alone (blue) in the crater of BOSS-Vesuvio
// against the volcano, a huge Orb that never leaves the middle of the map. It shoots what can be dodged, every attack
// marked on the floor before it lands: rockets along a red line, lava bombs and missiles from the sky on circles, a ring
// of fire with a gap, a beam that sweeps the arena; and its lava burns. Enemies come in from the map's edges. Three
// phases by its life (2/3 and 1/3: the volcano erupts between them and gets worse); it ends when it falls (the time is
// the result) or when the lives run out. Its own currency and Forge (src/client/vesuviusProgress.ts): nothing of the
// Waves' Workshop counts here. Driven by ClientGame every tick, like the waves' run.
import * as THREE from 'three';
import { BotController } from '../sim/bot';
import {
  PLAYER_STATUS_DEAD,
  PLAYER_TEAM_RED,
  PROJECTILE_COCKTAIL_MOLOTOV,
  PROJECTILE_DROPED_GRENADE,
  PROJECTILE_FLAME,
  PROJECTILE_LIFE_PACK,
  PROJECTILE_ROCKET,
  TICK,
  WEAPON_BAZOOKA,
  WEAPON_COCKTAIL_MOLOTOV,
  WEAPON_KNIVES,
  WEAPON_SNIPER,
} from '../sim/constants';
import type { Game } from '../sim/game';
import type { Player, SkinInfo } from '../sim/player';
import { VESUVIUS_BOSS_LIFE, VESUVIUS_DEATH_PENALTY, VESUVIUS_ERUPTION, VESUVIUS_LEVEL_WAVES, vesuviusScale } from '../sim/vesuvius';
import { Vec3 } from '../sim/vec';
import { track } from './analytics';
import { VesuviusRenderer, type VesuviusMarks } from './render/vesuviusRenderer';
import { WavesRenderer, type FloorPower } from './render/wavesRenderer';
import { BOOSTS, ELITE, WAVES, eliteStrength, rollElite, waveSpec, type PowerKind, type WaveSpec } from './waves';
import { FORGE_BARRIER, FORGE_DASH, FORGE_STEP, VESUVIUS_LIVES, loadVesuvius, runObsidian, saveVesuviusRun, type ForgeLevels, type RunObsidian, type VesuviusProgress, forgeFactor } from './vesuviusProgress';

/** The rules. Damage in shares of the player's bar (100 points), before his defence. */
export const VES = {
  /** Where the volcano stands: the middle of BOSS-Vesuvio (tools/make-boss-map.mjs). */
  centre: { x: 15.5, y: 15.5 },
  /** Its size (hit and drawn; against the walls a little one), and its bar: so many of an ordinary Orb's (150: 15,000 points). */
  bossRadius: 1.4,
  bossLife: VESUVIUS_BOSS_LIFE,
  /** Its skin: the Flames (skin25) in lava's colours. */
  bossSkin: { skin: 'skin25', redDecal: [1, 0.5, 0.06], greenDecal: [0.32, 0.03, 0.01], blueDecal: [1, 0.86, 0.25] } as SkinInfo,
  /** Its life where a phase begins (2 and 3), and the seconds it erupts in between, untouchable. */
  phaseAt: [2 / 3, 1 / 3],
  eruption: VESUVIUS_ERUPTION,
  /** The share of the enemies' damage the player takes (as in the Waves: their bots are the waves' ones). */
  playerDamage: WAVES.playerDamage,
  /** Seconds a death adds to the time, and before the player is back. */
  deathPenalty: VESUVIUS_DEATH_PENALTY,
  respawn: 5,
  /** A life pack heals this much; a fallen enemy leaves one at this chance, a grenade at this one. */
  lifePackHeal: 0.35,
  lifePackChance: 0.18,
  grenadeChance: 0.08,
  /**
   * Crates (Erick, 31/10/2026: some power-ups and life, fewer than in the Waves, whose crates come 3 at each break and
   * one every 20 s, up to 6): `start` at the start, one every `every` seconds and `eruption` at each eruption, at most
   * `max` on the map, never in the lava. What they drop: life, grenades and the 15 s ones (CRATE_POWERS), never the
   * Waves' permanent ones (the Forge is this mode's progress).
   */
  crates: { start: 2, every: 30, eruption: 1, max: 3 },
  /** The lava: its reach from the middle in each phase (it rises in the third), its burn a second, how often. */
  // (the attacks' damage 25% less since 01/11/2026: Erick never won; tools/vesuvius-sim.ts, half the Forge took a third
  // of the bar, the whole Forge won 3 runs of 4 with 3 to 5 deaths; their first numbers in the comments)
  lava: { radius: [2.4, 2.4, 3.4], dps: 0.225, every: 0.4 }, // 0.3
  /**
   * Rockets along a red line: the warning's seconds, their speed (starting, at most, how fast they get there), their
   * share of the bazooka's damage, the angle between two of a volley (degrees).
   */
  rocket: { windup: 0.85, speed: 3, cap: 6.5, accel: 1.5, share: 0.315, spread: 13 }, // 0.42
  /** Lava bombs (molotovs) in a high arc onto circles: their flight, the circle, how long their fire burns, its share of a molotov's. */
  mortar: { flight: 1.4, radius: 1.1, fire: 4.5, spread: 3, burn: 0.2625 }, // 0.35
  /**
   * Missiles from the sky onto circles: the warning, the circle (their blast's reach: the bazooka's 2 times their size),
   * their fall's speed and height, their share, their size.
   */
  missile: { windup: 1.5, radius: 1.3, speed: 12, height: 9, share: 0.45, size: 0.65, gap: 1.4 }, // 0.6
  /** The ring of fire: the warning, how many small rockets, the gap's width (rockets left out), their speed and share. */
  ring: { windup: 1.2, count: 28, gap: 4, speed: 3.2, share: 0.2625, size: 0.6 }, // 0.35
  /** The beam: the warning, the sweep (seconds, degrees a second), its width, its burn a second. */
  beam: { windup: 1.3, sweep: 3.4, turn: 55, width: 0.42, dps: 0.4125, every: 0.15 }, // 0.55
};

/** What a crate drops, by weight: life most of the time (more when hurt), grenades, one of the 15 s ones. */
const CRATE_POWERS: Partial<Record<PowerKind, number>> = { life: 10, ammo: 5, speed: 3, rapid: 3, shield: 3, fury: 3 };
type TimedPower = 'speed' | 'rapid' | 'shield' | 'fury';

/** The attacks that take turns (the rockets come on their own clock besides). */
type Major = 'mortar' | 'missiles' | 'ring' | 'beam';

export interface PhaseSpec {
  /** Rockets: every so many seconds, so many at once. */
  volley: { every: number; count: number };
  /** The attacks that take turns, and the seconds between two. */
  majors: Major[];
  majorEvery: number;
  /** Lava bombs and missiles at once. */
  mortars: number;
  missiles: number;
  /** Rings of fire one after the other. */
  rings: number;
  /** Enemies from the edges: every so many seconds, so many, at most so many standing, as strong as a wave's. */
  adds: { every: number; count: number; max: number; wave: number };
}

/**
 * The volcano gets worse with each phase (Erick, 31/10/2026: the dynamic changes with its life). The adds since
 * 01/11/2026 (Erick: too many of them, his damage didn't kill them, no time left for the volcano) as waves 4, 8 and 12's,
 * at most 3, 5 and 6 standing, a little less often (they were waves 6, 12 and 16's, 4, 6 and 8, every 14, 12 and 11 s).
 */
export const PHASES: PhaseSpec[] = [
  { volley: { every: 2.6, count: 1 }, majors: ['mortar'], majorEvery: 6.5, mortars: 3, missiles: 0, rings: 1, adds: { every: 16, count: 2, max: 3, wave: 4 } },
  { volley: { every: 2.8, count: 3 }, majors: ['missiles', 'ring', 'mortar'], majorEvery: 6, mortars: 4, missiles: 5, rings: 1, adds: { every: 14, count: 2, max: 5, wave: 8 } },
  { volley: { every: 2.5, count: 5 }, majors: ['beam', 'missiles', 'ring', 'mortar'], majorEvery: 5.5, mortars: 4, missiles: 7, rings: 2, adds: { every: 13, count: 3, max: 6, wave: 12 } },
];

/** What the HUD shows of a run (HudLayer). */
export interface VesuviusHud {
  /** The level played. */
  level: number;
  /** 1 to 3; `erupting`: between two, the volcano untouchable. */
  phase: number;
  erupting: boolean;
  bossName: string;
  /** Its life (share of the whole bar) and in points. */
  bossLife: number;
  bossPoints: number;
  bossMax: number;
  lives: number;
  kills: number;
  /** The run's time so far (the deaths counted), the best one before. */
  time: number;
  best: number | null;
  /** Obsidian earned so far (a win and a record add theirs at the end). */
  obsidian: number;
  /** The crates' 15 s power-ups on, with their seconds left. */
  powers: { kind: PowerKind; left: number }[];
  abilities: { kind: 'dash' | 'shock'; ready: number }[];
  barrier: { now: number; max: number } | null;
  reflector: null;
  over: boolean;
  won: boolean;
}

/** The end of a run. */
export interface VesuviusEnd {
  won: boolean;
  /** The phase it ended in, and the share of the volcano's bar taken. */
  phase: number;
  share: number;
  /** The time (seconds played, a death's penalty each), the seconds played alone, the deaths it counts, the kills. */
  time: number;
  seconds: number;
  deaths: number;
  kills: number;
  /** A win faster than the best one before on this level (`best`, null: none). */
  isBest: boolean;
  /** The level played, and whether this win opened the next one. */
  level: number;
  opened: boolean;
  best: number | null;
  firstWin: boolean;
  obsidian: RunObsidian;
  progress: VesuviusProgress;
}

export interface VesuviusContext {
  game: Game;
  me: Player;
  /** ClientGame's bots (they think every tick); the run adds and replaces its own here. */
  bots: BotController[];
  scene: THREE.Scene;
  names: string[];
  bossName: string;
  randomSkin: () => SkinInfo;
  levels: ForgeLevels;
  weapon: number;
  /** The level played (1 and up: vesuviusScale). */
  level: number;
  /** A phase begins (2 and 3: the eruption), the volcano fell. */
  onPhase: (phase: number) => void;
  onWin: (position: Vec3) => void;
  /** Sounds: a rocket leaves, a beam lights up, a missile falls. */
  onLaunch: (position: Vec3) => void;
  onBeam: (position: Vec3) => void;
  onDash: () => void;
  /** A crate's power-up was taken (the banner, the sound). */
  onPower: (kind: PowerKind) => void;
  /** The page closes mid-run: the run's end as it stands (the server's numbers). */
  onClosed: (end: VesuviusEnd) => void;
  onEnd: (end: VesuviusEnd) => void;
}

/** A warning on the floor: a rocket's line, or a circle where something falls; it shows from `from` to `at` (the run's clock). */
type Mark =
  | { kind: 'line'; x: number; y: number; angle: number; length: number; from: number; at: number }
  | { kind: 'circle'; x: number; y: number; radius: number; from: number; at: number };

const DEG = Math.PI / 180;

export class VesuviusRun {
  private readonly renderer: VesuviusRenderer;
  /** The crates and the power-ups on the floor, drawn as the Waves' (src/client/render/wavesRenderer.ts). */
  private readonly crateRenderer: WavesRenderer;
  private powers: FloorPower[] = [];
  private nextPowerID = 1;
  private crateAt: number = VES.crates.every;
  private timers: Record<TimedPower, number> = { speed: 0, rapid: 0, shield: 0, fury: 0 };
  private readonly boss: Player;
  private phase = 1;
  /** The attacks' clock: it runs while the player and the volcano are up (not the pauses, not while he is dead). */
  private clock = 0;
  /** What is coming: actions at a time of the clock, and their warnings. */
  private tasks: { at: number; run: () => void }[] = [];
  private marks: Mark[] = [];
  private ring: { from: number; at: number; gap: number; gapWidth: number } | null = null;
  private beam: { from: number; on: number; end: number; angle: number; dir: number; hitClock: number } | null = null;
  /** The clocks of the rockets, of the attacks that take turns (and whose turn it is), of the enemies. */
  private volleyAt = 2.5;
  private majorAt = 5;
  private majorTurn = 0;
  private addsAt = 6;
  private addGap = 0;
  private addsDue = 0;
  /** The eruption between two phases: when it ends (the clock). */
  private eruptUntil = 0;
  private lavaRadius = VES.lava.radius[0];
  private lavaClock = 0;
  private dashWait = 0;
  private wasAlive = false;
  /** Seconds since the first spawn (dead time too; not the pauses), the deaths. */
  elapsed = 0;
  private won = false;
  private endIn = 0;
  over = false;
  private readonly before = loadVesuvius();
  /** The level's scale of the volcano's life and damage, of the Obsidian (vesuviusScale). */
  private get scale(): number {
    return vesuviusScale(this.ctx.level);
  }

  constructor(private readonly ctx: VesuviusContext) {
    this.renderer = new VesuviusRenderer(ctx.scene);
    this.crateRenderer = new WavesRenderer(ctx.scene);
    const { game, me, levels } = ctx;
    game.lifePackHeal = VES.lifePackHeal;
    // The player: his own colours, the Forge's shield, bag of grenades; his death leaves nothing
    me.ownColors = true;
    me.barrierMax = FORGE_BARRIER[levels.barrier];
    me.barrier = me.barrierMax;
    me.maxGrenades = Math.max(me.maxGrenades, 2 + levels.grenades);
    me.lifePackChance = 0;
    me.grenadeDropChance = 0;
    // The volcano: huge, standing in the middle, a bar of many (its damage numbers in points), two phases to go before
    // it can fall (Player.secondWind: a blow that would kill it stops at the next phase instead)
    const boss = game.addPlayer(ctx.bossName, true)!;
    boss.teamID = PLAYER_TEAM_RED;
    boss.spawnImmune = false;
    boss.radius = VES.bossRadius;
    boss.wallRadius = 0.5;
    // (its life and its attacks' damage times the level's scale)
    boss.damageScale = 1 / (VES.bossLife * this.scale);
    boss.pointScale = VES.bossLife * this.scale;
    // Its attacks are given in shares of the player's bar: undo the player's share of the enemies' damage
    boss.damageBoost = this.scale / VES.playerDamage;
    boss.takesLifePacks = false;
    boss.lifePackChance = 0;
    boss.grenadeDropChance = 0;
    boss.lives = 1;
    boss.secondWind = 2;
    boss.ownColors = true;
    boss.skin = VES.bossSkin;
    game.requestSpawn(boss);
    // Nothing in its hands: its attacks are its own (a bazooka its size covered it)
    boss.weapon = null;
    boss.meleeWeapon = null;
    this.boss = boss;
    this.holdBoss();
    this.dropCrates(VES.crates.start);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** The page closes mid-run: the Obsidian stays in this browser. */
  private readonly onPageHide = (): void => {
    if (this.over) return;
    const end = this.leave();
    if (end) this.ctx.onClosed(end);
  };

  /** The volcano in its place, looking at the player. */
  private holdBoss(): void {
    const b = this.boss;
    if (!b.isAlive) return;
    b.currentCF.position.set(VES.centre.x, VES.centre.y, 0.25);
    b.currentCF.vel.set(0, 0, 0);
    const at = this.ctx.me.currentCF.position;
    b.input.mousePosOnMap.set(at.x, at.y, 0);
    b.currentCF.mousePosOnMap.set(at.x, at.y, 0);
  }

  /** Every tick; `keys`: the Forge's dash asked for this tick. */
  update(keys: { dash: boolean } = { dash: false }): void {
    if (this.over) return;
    const { me, levels } = this.ctx;
    const boss = this.boss;
    this.elapsed += TICK;
    // The Forge, every tick (the dash and the shield are the waves' own)
    // (and the crates' 15 s power-ups on top)
    for (const k of Object.keys(this.timers) as TimedPower[]) this.timers[k] = Math.max(0, this.timers[k] - TICK);
    // (with its mastery past the top: forgeFactor)
    me.damageBoost = forgeFactor('damage', levels.damage) * (this.timers.fury > 0 ? BOOSTS.fury : 1);
    me.fireBoost = forgeFactor('fire', levels.fire) * (this.timers.rapid > 0 ? BOOSTS.rapid : 1);
    me.armorBoost = forgeFactor('armor', levels.armor) * (this.timers.shield > 0 ? BOOSTS.shield : 1);
    me.lifeMax = forgeFactor('life', levels.life);
    me.speedBoost = (1 + FORGE_STEP.speed * levels.speed) * (this.timers.speed > 0 ? BOOSTS.speed : 1);
    this.dashWait = Math.max(0, this.dashWait - TICK);
    if (me.isAlive && keys.dash && levels.dash > 0 && this.dashWait <= 0) this.dash();
    // The same weapon at every spawn, the Forge's grenades on top of the usual ones
    if (!me.isAlive) {
      me.nextSpawnWeapon = this.ctx.weapon;
      me.nextMeleeWeapon = WEAPON_KNIVES;
    }
    if (me.isAlive && !this.wasAlive && levels.grenades > 0) me.nbGrenadeLeft = Math.min(me.maxGrenades, me.nbGrenadeLeft + levels.grenades);
    // Dead: what was coming goes (no attack waits for him at his spawn)
    if (!me.isAlive && this.wasAlive) this.calm();
    this.wasAlive = me.isAlive;
    this.holdBoss();

    // The volcano fell: a moment to see it, then the end
    if (this.won) {
      this.endIn -= TICK;
      if (this.endIn <= 0) this.end();
      return;
    }
    if (!boss.isAlive && this.phase === 3) {
      this.win();
      return;
    }
    // Out of lives: the end
    if (!me.isAlive && me.lives <= 0) {
      this.end();
      return;
    }
    // A phase reached: its threshold, or a blow that would have killed it (its second wind went)
    if (this.phase < 3 && (boss.secondWind < 3 - this.phase || boss.life <= VES.phaseAt[this.phase - 1])) this.nextPhase();

    // The power-ups on the floor: taken by walking over them, gone after a while
    for (const p of this.powers) p.age += TICK;
    this.powers = this.powers.filter((p) => {
      if (p.age >= p.life) return false;
      if (me.isAlive && Math.hypot(me.currentCF.position.x - p.x, me.currentCF.position.y - p.y) < me.radius + 0.3) {
        this.take(p.kind);
        return false;
      }
      return true;
    });

    if (!me.isAlive) return;
    this.clock += TICK;
    this.updateLava();
    // A crate now and then
    if (this.clock >= this.crateAt) {
      this.crateAt = this.clock + VES.crates.every;
      this.dropCrates(1);
    }
    // The eruption: the volcano untouchable until it ends
    if (this.eruptUntil && this.clock >= this.eruptUntil) {
      this.eruptUntil = 0;
      boss.hurtOnlyBy = null;
    }
    // The lava bombs' fire: weaker than a molotov's, and it burns out
    for (const p of this.ctx.game.projectiles) {
      if (p.projectileType !== PROJECTILE_FLAME || p.fromID !== boss.playerID) continue;
      p.share = VES.mortar.burn;
      if (p.timeSinceThrown > VES.mortar.fire) p.needToBeDeleted = true;
    }
    // What was coming, at its time
    const due = this.tasks.filter((t) => t.at <= this.clock);
    if (due.length) {
      this.tasks = this.tasks.filter((t) => t.at > this.clock);
      for (const t of due) t.run();
    }
    this.marks = this.marks.filter((m) => m.at > this.clock);
    if (this.ring && this.ring.at <= this.clock) this.ring = null;
    this.updateBeam();
    if (this.eruptUntil) return;

    const spec = PHASES[this.phase - 1];
    // The rockets (not while the beam burns)
    if (this.clock >= this.volleyAt && !this.beam) {
      this.volleyAt = this.clock + spec.volley.every;
      this.volley(spec.volley.count);
    }
    // The attacks that take turns, one at a time
    if (this.clock >= this.majorAt && !this.beam && !this.ring) {
      const kind = spec.majors[this.majorTurn % spec.majors.length];
      this.majorTurn++;
      this.majorAt = this.clock + spec.majorEvery;
      this.major(kind, spec);
    }
    // The enemies from the edges, a few at a time, never more than so many standing
    if (this.clock >= this.addsAt) {
      this.addsAt = this.clock + spec.adds.every;
      this.addsDue += spec.adds.count;
    }
    this.addGap -= TICK;
    if (this.addsDue > 0 && this.addGap <= 0) {
      this.addGap = 0.6;
      if (this.enemies().filter((p) => p.isAlive).length < spec.adds.max) this.spawnAdd(spec.adds.wave + VESUVIUS_LEVEL_WAVES * (this.ctx.level - 1));
      this.addsDue--;
    }
  }

  // ---------------------------------------------------------------- phases

  private nextPhase(): void {
    const boss = this.boss;
    this.phase++;
    boss.life = VES.phaseAt[this.phase - 2];
    boss.secondWind = 3 - this.phase;
    // The eruption: untouchable, missiles all over the arena, life packs and grenades thrown out, then worse
    boss.hurtOnlyBy = [];
    this.calm();
    this.eruptUntil = this.clock + VES.eruption;
    this.volleyAt = this.eruptUntil + 1;
    this.majorAt = this.eruptUntil + 2.5;
    this.addsAt = this.clock + 1;
    this.majorTurn = 0;
    this.missiles(14, true);
    for (let i = 0; i < 3; i++) this.throwOut(i < 2 ? PROJECTILE_LIFE_PACK : PROJECTILE_DROPED_GRENADE);
    this.dropCrates(VES.crates.eruption);
    track('vesuvius_phase', { phase: this.phase, seconds: Math.round(this.elapsed) });
    this.ctx.onPhase(this.phase);
  }

  /** What was coming goes: the warnings, the actions, the ring, the beam. */
  private calm(): void {
    this.tasks = [];
    this.marks = [];
    this.ring = null;
    this.beam = null;
  }

  /** The third phase: the lava rises to its new reach in a few seconds; it burns the player in it. */
  private updateLava(): void {
    const want = VES.lava.radius[this.phase - 1];
    this.lavaRadius += Math.max(-TICK, Math.min(TICK, (want - this.lavaRadius) * TICK * 2 + Math.sign(want - this.lavaRadius) * TICK * 0.2));
    if (Math.abs(want - this.lavaRadius) < 0.01) this.lavaRadius = want;
    const me = this.ctx.me;
    const d = Math.hypot(me.currentCF.position.x - VES.centre.x, me.currentCF.position.y - VES.centre.y);
    if (d > this.lavaRadius) {
      this.lavaClock = 0;
      return;
    }
    this.lavaClock -= TICK;
    if (this.lavaClock > 0) return;
    this.lavaClock = VES.lava.every;
    me.hitSV(WEAPON_COCKTAIL_MOLOTOV, this.boss, VES.lava.dps * VES.lava.every);
  }

  private win(): void {
    this.won = true;
    this.endIn = 3;
    this.calm();
    const { game } = this.ctx;
    // Its enemies go with it; nothing of its own stays on the floor
    for (const p of this.enemies()) if (p !== this.boss) this.remove(p);
    for (const p of game.projectiles) if (p.fromID === this.boss.playerID) p.needToBeDeleted = true;
    this.ctx.onWin(new Vec3(VES.centre.x, VES.centre.y, 0.5));
  }

  // ---------------------------------------------------------------- attacks

  /** The volcano's mouth towards an angle (radians), at its edge. */
  private mouth(angle: number, out = 0.35): Vec3 {
    const r = VES.bossRadius + out;
    return new Vec3(VES.centre.x + Math.cos(angle) * r, VES.centre.y + Math.sin(angle) * r, 0.3);
  }

  private angleToMe(): number {
    const p = this.ctx.me.currentCF.position;
    return Math.atan2(p.y - VES.centre.y, p.x - VES.centre.x);
  }

  /** How far a line from the volcano's edge goes along `angle` before a wall (at most `max`). */
  private reach(angle: number, max = 30): number {
    const from = this.mouth(angle, 0.05);
    const to = new Vec3(from.x + Math.cos(angle) * max, from.y + Math.sin(angle) * max, from.z);
    this.ctx.game.map.rayTest(from.clone(), to, new Vec3());
    return Math.hypot(to.x - from.x, to.y - from.y);
  }

  /** A rocket of the volcano: its speed, its share of the damage, its size; its blast spares the volcano. */
  private rocket(from: Vec3, dir: Vec3, speed: number, cap: number, accel: number, share: number, size = 1): void {
    const game = this.ctx.game;
    // (the projectile starts at 2.5 times what it is given)
    if (!game.spawnProjectile(from, dir.normalizeIn().mul(speed / 2.5), this.boss.playerID, PROJECTILE_ROCKET, WEAPON_BAZOOKA)) return;
    const p = game.projectiles[game.projectiles.length - 1];
    p.rain = true;
    p.speedCap = cap;
    p.accel = accel;
    p.share = share;
    p.size = size;
  }

  /** Rockets along red lines at the player: one, a fan of three, of five. */
  private volley(n: number): void {
    const { rocket } = VES;
    const base = this.angleToMe();
    const fire = this.clock + rocket.windup;
    const angles = Array.from({ length: n }, (_, i) => base + (i - (n - 1) / 2) * rocket.spread * DEG);
    for (const a of angles) {
      const from = this.mouth(a, 0.05);
      this.marks.push({ kind: 'line', x: from.x, y: from.y, angle: a, length: this.reach(a, 16), from: this.clock, at: fire });
    }
    this.tasks.push({
      at: fire,
      run: () => {
        for (const a of angles) this.rocket(this.mouth(a), new Vec3(Math.cos(a), Math.sin(a), 0), rocket.speed, rocket.cap, rocket.accel, rocket.share);
        this.ctx.onLaunch(this.mouth(base));
      },
    });
  }

  private major(kind: Major, spec: PhaseSpec): void {
    switch (kind) {
      case 'mortar':
        this.mortars(spec.mortars);
        break;
      case 'missiles':
        this.missiles(spec.missiles, false);
        break;
      case 'ring':
        for (let i = 0; i < spec.rings; i++) this.fireRing(i * 1.6);
        break;
      case 'beam':
        this.startBeam();
        break;
    }
  }

  /** Points on open floor around (x, y), up to `spread` away, never closer than `gap` to each other; the first right there. */
  private spots(x: number, y: number, n: number, spread: number, gap: number, first = true): Vec3[] {
    const map = this.ctx.game.map;
    const out: Vec3[] = [];
    const open = (px: number, py: number) => map.cellAt(Math.floor(px), Math.floor(py))?.passable === true;
    const apart = (px: number, py: number) => out.every((q) => Math.hypot(q.x - px, q.y - py) >= gap);
    if (first && open(x, y)) out.push(new Vec3(x, y, 0));
    for (let tries = 0; out.length < n && tries < n * 30; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * spread;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      // (not in the volcano itself)
      if (Math.hypot(px - VES.centre.x, py - VES.centre.y) < VES.bossRadius + 0.6) continue;
      if (open(px, py) && apart(px, py)) out.push(new Vec3(px, py, 0));
    }
    return out;
  }

  /** Lava bombs in a high arc onto circles around the player (one where he is heading), their fire left there a while. */
  private mortars(n: number): void {
    const { me, game } = this.ctx;
    const { mortar } = VES;
    const p = me.currentCF.position;
    const v = me.currentCF.vel;
    const lead = 0.5 * mortar.flight;
    for (const to of this.spots(p.x + v.x * lead, p.y + v.y * lead, n, mortar.spread, 1.6)) {
      const a = Math.atan2(to.y - VES.centre.y, to.x - VES.centre.x);
      const from = this.mouth(a, -0.6);
      from.z = 2.2;
      const T = mortar.flight;
      this.boss.nbMolotovLeft = 99;
      if (!game.spawnProjectile(from, new Vec3(0, 0, 0), this.boss.playerID, PROJECTILE_COCKTAIL_MOLOTOV, WEAPON_COCKTAIL_MOLOTOV)) continue;
      // Its own throw: there in `flight` seconds (the floor at 0, gravity 9.8)
      const proj = game.projectiles[game.projectiles.length - 1];
      proj.currentCF.vel.set((to.x - from.x) / T, (to.y - from.y) / T, (0 - from.z) / T + 0.5 * 9.8 * T);
      proj.lastCF.copyFrom(proj.currentCF);
      this.marks.push({ kind: 'circle', x: to.x, y: to.y, radius: mortar.radius, from: this.clock, at: this.clock + T });
    }
    this.ctx.onLaunch(this.mouth(this.angleToMe()));
  }

  /**
   * Missiles falling from the sky (Erick: "em algum momento tem que cair míssil do céu") onto circles around the player
   * (one right on him), or, at an eruption (`storm`), all over the arena.
   */
  private missiles(n: number, storm: boolean): void {
    const { missile } = VES;
    const p = this.ctx.me.currentCF.position;
    const points = storm ? this.spots(VES.centre.x, VES.centre.y, n, 9, missile.gap, false) : this.spots(p.x, p.y, n, 4, missile.gap);
    const fall = missile.height / missile.speed;
    points.forEach((to, i) => {
      // At an eruption they come one after the other
      const start = this.clock + (storm ? 0.4 + i * 0.16 : i * 0.12);
      const at = start + missile.windup;
      this.marks.push({ kind: 'circle', x: to.x, y: to.y, radius: missile.radius, from: start, at });
      this.tasks.push({
        at: at - fall,
        run: () => {
          const from = new Vec3(to.x + 0.8, to.y - 0.8, missile.height);
          const dir = to.sub(from);
          this.rocket(from, dir, missile.speed, missile.speed, 0, missile.share, missile.size);
          if (i % 3 === 0) this.ctx.onLaunch(from);
        },
      });
    });
  }

  /** A ring of small rockets out of the volcano with a gap to go through (or a wall to hide behind), `delay` from now. */
  private fireRing(delay: number): void {
    const { ring } = VES;
    const gap = Math.random() * Math.PI * 2;
    const step = (Math.PI * 2) / ring.count;
    const at = this.clock + delay + ring.windup;
    const show = () => {
      this.ring = { from: this.clock, at, gap, gapWidth: step * (ring.gap + 0.6) };
    };
    if (delay > 0) this.tasks.push({ at: this.clock + delay, run: show });
    else show();
    this.tasks.push({
      at,
      run: () => {
        for (let i = 0; i < ring.count; i++) {
          const a = gap + (i + 0.5) * step;
          // The gap: the rockets around its angle are left out
          const off = Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap)));
          if (off < (step * ring.gap) / 2) continue;
          this.rocket(this.mouth(a, 0.1), new Vec3(Math.cos(a), Math.sin(a), 0), ring.speed, ring.speed, 0, ring.share, ring.size);
        }
        this.ctx.onLaunch(this.mouth(gap + Math.PI));
      },
    });
  }

  /** The beam: a thin warning where it starts (away from the player), then it burns and sweeps over him. */
  private startBeam(): void {
    const { beam } = VES;
    const dir = Math.random() < 0.5 ? 1 : -1;
    // It starts 70 degrees before the player and turns through him
    const angle = this.angleToMe() - dir * 70 * DEG;
    this.beam = { from: this.clock, on: this.clock + beam.windup, end: this.clock + beam.windup + beam.sweep, angle, dir, hitClock: 0 };
  }

  private updateBeam(): void {
    const b = this.beam;
    if (!b) return;
    const { beam } = VES;
    if (this.clock >= b.end) {
      this.beam = null;
      return;
    }
    if (this.clock < b.on) return;
    if (this.clock - TICK < b.on) this.ctx.onBeam(this.mouth(b.angle));
    b.angle += b.dir * beam.turn * DEG * TICK;
    // The player in it (a wall between stops it): burned a little at a time
    b.hitClock -= TICK;
    if (b.hitClock > 0) return;
    const me = this.ctx.me;
    if (!me.isAlive) return;
    const dx = me.currentCF.position.x - VES.centre.x;
    const dy = me.currentCF.position.y - VES.centre.y;
    const along = dx * Math.cos(b.angle) + dy * Math.sin(b.angle);
    const across = Math.abs(-dx * Math.sin(b.angle) + dy * Math.cos(b.angle));
    if (along < VES.bossRadius || along > VES.bossRadius + this.reach(b.angle) || across > beam.width / 2 + me.radius) return;
    b.hitClock = beam.every;
    me.hitSV(WEAPON_COCKTAIL_MOLOTOV, this.boss, beam.dps * beam.every);
  }

  /** Something thrown out of the volcano (at an eruption): a life pack or a grenade, landing a few steps away. */
  private throwOut(type: number): void {
    const a = Math.random() * Math.PI * 2;
    const v = new Vec3(Math.cos(a) * (2.2 + Math.random()), Math.sin(a) * (2.2 + Math.random()), 4);
    this.ctx.game.spawnProjectile(this.mouth(a, 0.2), v, this.boss.playerID, type, 0);
  }

  // ---------------------------------------------------------------- crates

  /**
   * Up to `n` crates more (at most VES.crates.max), on open floor away from the player, the spawns, each other and the
   * lava at its highest.
   */
  private dropCrates(n: number): void {
    const { game, me } = this.ctx;
    const map = game.map;
    const [w, h] = map.size;
    const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && map.cells[y * w + x].passable;
    const lava = VES.lava.radius[2] + 1.2;
    for (let k = 0; k < n && game.crates.length < VES.crates.max; k++) {
      for (let tries = 0; tries < 300; tries++) {
        const x = Math.floor(Math.random() * w);
        const y = Math.floor(Math.random() * h);
        let open = true;
        for (let dy = -1; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1 && open; dx++) open = free(x + dx, y + dy);
        if (!open) continue;
        const cx = x + 0.5;
        const cy = y + 0.5;
        const far = (px: number, py: number, d: number) => Math.hypot(cx - px, cy - py) >= d;
        if (!far(VES.centre.x, VES.centre.y, lava)) continue;
        if (!far(me.currentCF.position.x, me.currentCF.position.y, 3)) continue;
        if (!map.dmSpawns.every((s) => far(s.x, s.y, 1.5))) continue;
        if (!game.crates.every((c) => far(c.position.x, c.position.y, 4))) continue;
        game.addCrate(cx, cy);
        break;
      }
    }
  }

  /** A crate was hit (the game's 'crate' event): it shakes; broken, it drops a power-up (more often life when hurt). */
  onCrate(crateID: number, position: Vec3, broken: boolean): void {
    this.crateRenderer.crateHit(crateID, position.x, position.y, broken);
    if (!broken || this.over) return;
    const me = this.ctx.me;
    const hurt = me.isAlive && me.life < 0.5 ? 2 : 1;
    const kinds = Object.keys(CRATE_POWERS) as PowerKind[];
    const weight = (k: PowerKind) => CRATE_POWERS[k]! * (k === 'life' ? hurt : 1);
    let r = Math.random() * kinds.reduce((s, k) => s + weight(k), 0);
    let kind: PowerKind = 'life';
    for (const k of kinds) {
      r -= weight(k);
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    this.powers.push({ id: this.nextPowerID++, kind, x: position.x, y: position.y, age: 0, life: WAVES.powerOnFloor });
  }

  /** A power-up taken: half a bar of life, grenades and a molotov, or one of the 15 s ones (as in the Waves). */
  private take(kind: PowerKind): void {
    const me = this.ctx.me;
    if (kind === 'life') me.life = Math.min(1, me.life + 0.5);
    else if (kind === 'ammo') {
      me.nbGrenadeLeft = Math.min(Math.max(5, me.maxGrenades), me.nbGrenadeLeft + 2);
      me.nbMolotovLeft = Math.min(3, me.nbMolotovLeft + 1);
    } else if (kind in this.timers) this.timers[kind as TimedPower] = WAVES.powerSeconds;
    this.ctx.onPower(kind);
  }

  /** The Forge's dash: the way the keys go (else towards the aim), untouchable for a moment. */
  private dash(): void {
    const me = this.ctx.me;
    const i = me.input;
    let dir = new Vec3((i.right ? 1 : 0) - (i.left ? 1 : 0), (i.up ? 1 : 0) - (i.down ? 1 : 0), 0);
    if (dir.lengthSq() < 1e-6) dir = me.currentCF.mousePosOnMap.sub(me.currentCF.position);
    me.dash(dir);
    this.dashWait = FORGE_DASH[this.ctx.levels.dash];
    this.ctx.onDash();
  }

  // ---------------------------------------------------------------- enemies

  private enemies(): Player[] {
    return this.ctx.game.players.filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_RED);
  }

  /** An enemy from the edges, as strong as wave `wave`'s bots (an elite maybe): a fallen one again, or a new one. */
  private spawnAdd(wave: number): void {
    const { game, bots } = this.ctx;
    const spec: WaveSpec = waveSpec(wave);
    const loadout = { primary: spec.weapons[Math.floor(Math.random() * spec.weapons.length)], secondary: WEAPON_KNIVES };
    let i = bots.findIndex((b) => b.player !== this.boss && !b.player.isAlive && b.player.lives <= 0);
    let p: Player | null = i >= 0 ? bots[i].player : null;
    if (!p) {
      p = game.addPlayer(this.ctx.names[bots.length % this.ctx.names.length], true);
      if (!p) return;
      p.teamID = PLAYER_TEAM_RED;
      i = bots.length;
    }
    p.spawnImmune = false;
    p.skin = this.ctx.randomSkin();
    p.lives = 1;
    p.spawnRequested = false;
    p.timeToSpawn = 0;
    p.damageScale = spec.toughness;
    p.damageBoost = spec.hitBoost;
    p.speedBoost = WAVES.botSpeed;
    p.takesLifePacks = false;
    p.lifePackChance = VES.lifePackChance;
    p.grenadeDropChance = VES.grenadeChance;
    p.edgeSpawn = true;
    const traits = rollElite(wave);
    const strength = eliteStrength(wave);
    p.badges = traits;
    p.radius = 0.25;
    p.lifeMax = 1;
    p.teamTint = null;
    if (traits.length) {
      p.lifeMax = ELITE.life;
      p.damageBoost *= ELITE.hit;
      p.damageScale *= ELITE.tough;
      p.radius = ELITE.radius;
      p.teamTint = ELITE.tint;
    }
    if (traits.includes('fast')) p.speedBoost = Math.min(1.9, WAVES.botSpeed * strength.speed);
    if (traits.includes('brute')) {
      p.damageBoost *= strength.hit;
      p.radius = 0.33;
    }
    if (traits.includes('tank')) p.damageScale *= strength.tough;
    bots[i] = new BotController(p, traits.includes('sniper') ? 1 : spec.skill, loadout);
    if (traits.includes('sniper')) bots[i].aimScale = strength.aim;
    const keeps = traits.includes('sniper') || loadout.primary === WEAPON_SNIPER;
    bots[i].rush = !keeps && (traits.includes('brute') || traits.includes('fast') || Math.random() < WAVES.rushShare);
    bots[i].hunt = this.ctx.me;
    game.requestSpawn(p);
  }

  /** An Orb out of the run at once, without a death (no kill, no line in the feed, nothing dropped). */
  private remove(p: Player): void {
    p.status = PLAYER_STATUS_DEAD;
    p.lives = 0;
    p.currentCF.position.set(-999, -999, 0);
    p.lastCF.position.copy(p.currentCF.position);
  }

  // ---------------------------------------------------------------- end, HUD, drawing

  /** The run's time: seconds played, a death's penalty each. */
  private get time(): number {
    return this.elapsed + VES.deathPenalty * this.ctx.me.deaths;
  }

  /** The share of the volcano's bar taken so far. */
  private get share(): number {
    if (this.won) return 1;
    return 1 - Math.max(0, this.boss.isAlive ? this.boss.life : 0);
  }

  /** The player leaves before the end (the menu, a closed page): what the run earned is kept, returned for the account. */
  leave(): VesuviusEnd | null {
    if (this.over || this.elapsed <= 0) return null;
    return this.finish();
  }

  private end(): void {
    this.ctx.onEnd(this.finish());
  }

  private finish(): VesuviusEnd {
    this.over = true;
    this.calm();
    const me = this.ctx.me;
    const won = this.won;
    const time = Math.round(this.time);
    const level = this.ctx.level;
    const best = this.before.bests[level] ?? null;
    const isBest = won && (best === null || time < best);
    const obsidian = runObsidian(this.share, this.phase - 1, me.kills, won, isBest, level);
    const { progress } = saveVesuviusRun(obsidian.total, won, won ? time : null, level);
    track('vesuvius_end', { result: won ? 'won' : 'lost', phase: this.phase, seconds: time, deaths: me.deaths, kills: me.kills, obsidian: obsidian.total, new_best: isBest, level });
    return {
      won, phase: this.phase, share: obsidian.share, time, seconds: this.elapsed, deaths: me.deaths, kills: me.kills, isBest, best,
      firstWin: won && this.before.wins === 0, obsidian, progress, level, opened: won && level > this.before.level,
    };
  }

  hud(): VesuviusHud {
    const me = this.ctx.me;
    const boss = this.boss;
    const life = this.won ? 0 : boss.isAlive ? Math.max(0, boss.life) : 0;
    return {
      level: this.ctx.level,
      phase: this.phase,
      erupting: this.eruptUntil > 0,
      bossName: boss.name,
      bossLife: life,
      bossPoints: Math.ceil(life * VES.bossLife * this.scale * 100),
      bossMax: Math.round(VES.bossLife * this.scale * 100),
      lives: me.lives + (me.isAlive ? 1 : 0),
      kills: me.kills,
      time: this.time,
      best: this.before.bests[this.ctx.level] ?? null,
      obsidian: runObsidian(this.share, this.phase - 1, me.kills, false, false, this.ctx.level).total,
      powers: (Object.keys(this.timers) as TimedPower[]).filter((k) => this.timers[k] > 0).map((k) => ({ kind: k, left: this.timers[k] })),
      abilities: this.ctx.levels.dash > 0 ? [{ kind: 'dash', ready: 1 - this.dashWait / FORGE_DASH[this.ctx.levels.dash] }] : [],
      barrier: me.barrierMax > 0 ? { now: me.barrier, max: me.barrierMax } : null,
      reflector: null,
      over: this.over,
      won: this.won,
    };
  }

  render(dt: number, time: number): void {
    const k = (from: number, at: number) => Math.max(0, Math.min(1, (this.clock - from) / Math.max(1e-6, at - from)));
    const marks: VesuviusMarks = {
      lines: [],
      circles: [],
      ring: null,
      beam: null,
      lava: { x: VES.centre.x, y: VES.centre.y, radius: this.lavaRadius },
    };
    for (const m of this.marks) {
      if (m.from > this.clock) continue;
      if (m.kind === 'line') marks.lines.push({ x: m.x, y: m.y, angle: m.angle, length: m.length, k: k(m.from, m.at) });
      else marks.circles.push({ x: m.x, y: m.y, radius: m.radius, k: k(m.from, m.at) });
    }
    if (this.ring) marks.ring = { x: VES.centre.x, y: VES.centre.y, radius: VES.bossRadius + 0.5, k: k(this.ring.from, this.ring.at), gap: this.ring.gap, gapWidth: this.ring.gapWidth };
    const b = this.beam;
    if (b) {
      const from = this.mouth(b.angle, 0);
      marks.beam = { x: from.x, y: from.y, angle: b.angle, length: this.reach(b.angle), on: this.clock >= b.on, k: k(b.from, b.on) };
    }
    this.renderer.render(marks, time);
    this.crateRenderer.render(this.ctx.game.crates, this.powers, [], dt, time);
  }

  /** The run being played, for analytics. */
  get phaseNumber(): number {
    return this.phase;
  }

  dispose(): void {
    window.removeEventListener('pagehide', this.onPageHide);
    this.renderer.dispose();
    this.crateRenderer.dispose();
  }
}

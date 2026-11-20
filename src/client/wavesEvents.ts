// What happens between the bosses in the waves (Erick, 16/11/2026: the ten waves before a boss were monotonous): a
// wave's modifier (WAVE_MODS: fast, elite, snipers, kamikazes, bombardment, darkness) and its challenge (GOALS: a golden
// crate to break, a frenzy of kills, a zone to hold), driven every tick by the WavesRun (src/client/wavesRun.ts). The
// modifiers that change who comes (fast, elite, snipers, kamikazes) are applied where the bots spawn, in the WavesRun;
// here: the bombardment's missiles, the darkness's flag for the HUD, the challenges and their Cores. The mini-bosses are
// the WavesRun's (they are bots of the wave).
import type * as THREE from 'three';
import { PROJECTILE_ROCKET, TICK, WEAPON_BAZOOKA } from '../sim/constants';
import type { Game } from '../sim/game';
import type { Player } from '../sim/player';
import { Vec3 } from '../sim/vec';
import { VesuviusRenderer, type VesuviusMarks } from './render/vesuviusRenderer';
import { BOSS_MOVE, GOALS, WAVE_MODS, goalCores, rollGoal, rollWaveMod, type GoalKind, type WaveMod, type WaveSpec } from './waves';

export interface EventsHost {
  game: Game;
  me: Player;
  scene: THREE.Scene;
  /** The enemies, standing or not. */
  reds(): Player[];
  /** A crate of the given kind and life there (the golden one: kind 3); its id. */
  addCrate(x: number, y: number, life: number): number;
  removeCrate(id: number): void;
  /** A permanent power-up dropped there (a challenge done). */
  dropPerm(x: number, y: number): void;
  /** The zone held: a golden energy there. */
  goldEnergy(x: number, y: number): void;
  /** Banners: what the wave brings, a challenge done or lost. */
  announce(key: EventKey, params?: Record<string, number>): void;
  /** A rocket leaves (its sound). */
  onLaunch(position: Vec3): void;
}

export type EventKey = `mod.${WaveMod}` | `goal.${GoalKind}` | 'goal.done' | 'goal.fail' | 'mini';

/** A challenge going on: what it asks, how far it is, its seconds left. */
export interface Goal {
  kind: GoalKind;
  wave: number;
  have: number;
  need: number;
  left: number;
  /** The golden crate's id; the zone's place and size; the kills when it began. */
  crate?: number;
  zone?: { x: number; y: number; radius: number };
  kills0?: number;
}

/** What the HUD shows of it. */
export interface EventsHud {
  mod: WaveMod | null;
  goal: { kind: GoalKind; have: number; need: number; left: number } | null;
  dark: boolean;
}

export class WaveEvents {
  mod: WaveMod | null = null;
  goal: Goal | null = null;
  /** Cores of the challenges done and the modifiers' waves gone by. */
  cores = 0;
  private bombClock = 0;
  private clock = 0;
  private tasks: { at: number; run: () => void }[] = [];
  private marks: { x: number; y: number; radius: number; from: number; at: number }[] = [];
  private renderer: VesuviusRenderer | null = null;

  constructor(private readonly host: EventsHost) {}

  /** A wave begins: its modifier (WAVE_MODS), maybe a challenge (GOALS) when it has none. */
  rollMod(n: number): WaveMod | null {
    this.mod = rollWaveMod(n);
    this.bombClock = WAVE_MODS.bombard.every * 0.6;
    return this.mod;
  }

  /** The wave's bots are known (`spec`): its banner, and maybe a challenge. */
  begin(spec: WaveSpec): void {
    if (this.mod) {
      this.host.announce(`mod.${this.mod}`);
      return;
    }
    if (this.goal) return;
    const kind = rollGoal(spec.n, false);
    if (!kind) return;
    const { me } = this.host;
    if (kind === 'gold') {
      const spot = this.spot(GOALS.gold.near[0], GOALS.gold.near[1], 1);
      if (!spot) return;
      const id = this.host.addCrate(spot.x, spot.y, GOALS.gold.life * Math.max(1, me.damageBoost));
      this.goal = { kind, wave: spec.n, have: 0, need: 1, left: GOALS.gold.seconds, crate: id };
      this.host.announce('goal.gold', { s: GOALS.gold.seconds });
    } else if (kind === 'frenzy') {
      const need = Math.max(GOALS.frenzy.least, Math.round(spec.total * GOALS.frenzy.share));
      this.goal = { kind, wave: spec.n, have: 0, need, left: GOALS.frenzy.seconds, kills0: me.kills };
      this.host.announce('goal.frenzy', { n: need, s: GOALS.frenzy.seconds });
    } else {
      const spot = this.spot(GOALS.zone.near[0], GOALS.zone.near[1], 2);
      if (!spot) return;
      this.goal = { kind, wave: spec.n, have: 0, need: GOALS.zone.hold, left: GOALS.zone.seconds, zone: { x: spot.x, y: spot.y, radius: GOALS.zone.radius } };
      this.host.announce('goal.zone', { s: GOALS.zone.hold });
    }
  }

  /** The wave is over (the next one begins): a modifier's wave gone by is worth more Cores. */
  waveOver(waveCores: number): void {
    if (this.mod) this.cores += Math.round(waveCores * WAVE_MODS.cores);
    this.mod = null;
  }

  /** A crate broke: the golden one is the challenge done. */
  onCrate(id: number): void {
    const g = this.goal;
    if (g?.kind === 'gold' && g.crate === id) {
      g.have = 1;
      this.finish(true);
    }
  }

  /** Every tick while the run plays (`fighting`: a wave is on). */
  update(fighting: boolean): void {
    const { me } = this.host;
    this.clock += TICK;
    // The bombardment
    if (this.mod === 'bombard' && fighting && me.isAlive) {
      this.bombClock += TICK;
      if (this.bombClock >= WAVE_MODS.bombard.every) {
        this.bombClock = 0;
        this.bombard();
      }
    }
    const due = this.tasks.filter((t) => t.at <= this.clock);
    if (due.length) {
      this.tasks = this.tasks.filter((t) => t.at > this.clock);
      for (const t of due) t.run();
    }
    this.marks = this.marks.filter((m) => m.at > this.clock);
    // The challenge: its clock runs while the player stands
    const g = this.goal;
    if (!g || !me.isAlive) return;
    g.left -= TICK;
    if (g.kind === 'frenzy') g.have = Math.min(g.need, me.kills - (g.kills0 ?? me.kills));
    if (g.kind === 'zone' && g.zone) {
      const p = me.currentCF.position;
      if (Math.hypot(p.x - g.zone.x, p.y - g.zone.y) <= g.zone.radius) g.have = Math.min(g.need, g.have + TICK);
    }
    if (g.have >= g.need) this.finish(true);
    else if (g.left <= 0) this.finish(false);
  }

  private finish(done: boolean): void {
    const g = this.goal;
    if (!g) return;
    this.goal = null;
    if (g.crate !== undefined && !done) this.host.removeCrate(g.crate);
    if (done) {
      const n = goalCores(g.wave);
      this.cores += n;
      const at = this.host.me.currentCF.position;
      this.host.dropPerm(at.x, at.y);
      if (g.zone) this.host.goldEnergy(g.zone.x, g.zone.y);
      this.host.announce('goal.done', { n });
    } else this.host.announce('goal.fail');
  }

  /** The run is over: what is still on the floor goes. */
  stop(): void {
    if (this.goal?.crate !== undefined) this.host.removeCrate(this.goal.crate);
    this.goal = null;
    this.mod = null;
    this.tasks = [];
    this.marks = [];
  }

  get hud(): EventsHud {
    const g = this.goal;
    return { mod: this.mod, goal: g ? { kind: g.kind, have: g.have, need: g.need, left: Math.max(0, g.left) } : null, dark: this.mod === 'dark' };
  }

  /** The zone to hold, for the renderer (k: how far along). */
  get zone(): { x: number; y: number; radius: number; k: number } | null {
    const g = this.goal;
    return g?.zone ? { ...g.zone, k: g.have / g.need } : null;
  }

  // ---------------------------------------------------------------- the bombardment

  /** Missiles from the sky onto circles around the player (one right on him), from one of the enemies standing. */
  private bombard(): void {
    const reds = this.host.reds().filter((p) => p.isAlive);
    if (!reds.length) return;
    const from = reds[Math.floor(Math.random() * reds.length)];
    const m = BOSS_MOVE.missiles;
    const p = this.host.me.currentCF.position;
    const fall = m.height / m.speed;
    this.spots(p.x, p.y, WAVE_MODS.bombard.n, m.spread, m.gap).forEach((to, i) => {
      const start = this.clock + i * 0.15;
      const at = start + m.windup;
      this.marks.push({ x: to.x, y: to.y, radius: m.radius, from: start, at });
      this.tasks.push({
        at: at - fall,
        run: () => {
          if (!from.isAlive) return;
          const sky = new Vec3(to.x + 0.8, to.y - 0.8, m.height);
          this.rocket(from, sky, to.sub(sky), m.speed, m.share * WAVE_MODS.bombard.share, m.size);
          if (i === 0) this.host.onLaunch(sky);
        },
      });
    });
  }

  private rocket(owner: Player, from: Vec3, dir: Vec3, speed: number, share: number, size: number): void {
    const { game } = this.host;
    // (the projectile starts at 2.5 times what it is given)
    if (!game.spawnProjectile(from, dir.normalizeIn().mul(speed / 2.5), owner.playerID, PROJECTILE_ROCKET, WEAPON_BAZOOKA)) return;
    const p = game.projectiles[game.projectiles.length - 1];
    p.rain = true;
    p.speedCap = speed;
    p.accel = 0;
    p.share = share;
    p.size = size;
  }

  /** Points on open floor around (x, y), up to `spread` away and `gap` apart; the first right there. */
  private spots(x: number, y: number, n: number, spread: number, gap: number): Vec3[] {
    const map = this.host.game.map;
    const out: Vec3[] = [];
    const open = (px: number, py: number) => map.cellAt(Math.floor(px), Math.floor(py))?.passable === true;
    if (open(x, y)) out.push(new Vec3(x, y, 0));
    for (let tries = 0; out.length < n && tries < n * 30; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * spread;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (open(px, py) && out.every((q) => Math.hypot(q.x - px, q.y - py) >= gap)) out.push(new Vec3(px, py, 0));
    }
    return out;
  }

  /** A roomy spot `near` to `far` cells from the player, in his sight (the golden crate, the zone): `room` cells of floor around. */
  private spot(near: number, far: number, room: number): Vec3 | null {
    // (cramped there: closer or farther, less room, and at last out of sight)
    return this.trySpot(near, far, room, true) ?? this.trySpot(near * 0.6, far * 1.4, 0, true) ?? this.trySpot(near * 0.6, far * 1.4, 0, false);
  }

  private trySpot(near: number, far: number, room: number, sight: boolean): Vec3 | null {
    const { game, me } = this.host;
    const map = game.map;
    const at = me.currentCF.position;
    const free = (x: number, y: number) => map.cellAt(x, y)?.passable === true;
    for (let tries = 0; tries < 200; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = near + Math.random() * (far - near);
      const x = Math.floor(at.x + Math.cos(a) * d);
      const y = Math.floor(at.y + Math.sin(a) * d);
      let ok = true;
      for (let dx = -room; dx <= room && ok; dx++) for (let dy = -room; dy <= room && ok; dy++) ok = free(x + dx, y + dy);
      if (!ok) continue;
      const p = new Vec3(x + 0.5, y + 0.5, 0.25);
      // (on his screen: it shows less up and down than to the sides, and the HUD sits at the bottom)
      if (sight && (Math.abs(p.y - at.y) > 3 || map.rayTest(new Vec3(at.x, at.y, 0.25), p.clone(), new Vec3()))) continue;
      return p;
    }
    return null;
  }

  // ---------------------------------------------------------------- drawing

  render(time: number): void {
    if (!this.marks.length && !this.renderer) return;
    this.renderer ??= new VesuviusRenderer(this.host.scene);
    const k = (from: number, at: number) => Math.max(0, Math.min(1, (this.clock - from) / Math.max(1e-6, at - from)));
    const marks: VesuviusMarks = { lines: [], circles: [], ring: null, beam: null, lava: null };
    for (const m of this.marks) if (m.from <= this.clock) marks.circles.push({ x: m.x, y: m.y, radius: m.radius, k: k(m.from, m.at) });
    this.renderer.render(marks, time);
  }

  dispose(): void {
    this.renderer?.dispose();
  }
}

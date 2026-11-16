// The Horde's own cards (Erick, 15/11/2026: "things that fire by themselves from me, things turning around me"): what
// they do every tick, driven by the WavesRun (src/client/wavesRun.ts) in the Horde. Blades turning around the player,
// a ring of bullets now and then, a field burning around him, drones shooting the nearest enemy, homing rockets. Their
// damage is in lives of an ordinary enemy of the wave with half the damage bonuses and no critical hit (HORDE_ARMS), as
// the Orbital and the grenades: it grows with the wave. Drawn by src/client/render/hordeArmsRenderer.ts.
import { PROJECTILE_ROCKET, TICK, WEAPON_BAZOOKA, WEAPON_KNIVES, WEAPON_PHOTON_RIFLE, WEAPON_SMG } from '../sim/constants';
import type { Game } from '../sim/game';
import type { Player } from '../sim/player';
import type { Projectile } from '../sim/projectile';
import { Vec3 } from '../sim/vec';
import { WAVES } from './waves';
import { CARD_LEVELS, HORDE_ARMS, type CardLevels } from './wavesCards';

export interface ArmsHost {
  game: Game;
  me: Player;
  /** The enemies, standing or not. */
  reds(): Player[];
  /** The wave's toughness (WaveSpec.toughness): a life of an ordinary enemy of it. */
  toughness(): number;
  /** A shot of theirs (a drone's, the ring's), from `p1` to where it stopped. */
  onShot(p1: Vec3, p2: Vec3): void;
  /** Rockets left (their sound). */
  onRockets(position: Vec3): void;
}

/** What the renderer draws: the drones and the blades where they are, the field's reach. */
export interface ArmsView {
  drones: { x: number; y: number; z: number }[];
  blades: { x: number; y: number; angle: number }[];
  aura: { x: number; y: number; radius: number } | null;
}

const level = (cards: CardLevels, id: 'blades' | 'nova' | 'aura' | 'drone' | 'homing') => CARD_LEVELS[id][cards[id] ?? 0] ?? 0;

export class HordeArms {
  private time = 0;
  private bladeAngle = 0;
  private readonly bladeHit = new Map<Player, number>();
  private novaClock = 0;
  private auraClock = 0;
  private homingClock = 0;
  private droneClocks: number[] = [];
  /** The homing rockets in the air, each with the enemy it goes after. */
  private rockets: { p: Projectile; target: Player }[] = [];
  private view: ArmsView = { drones: [], blades: [], aura: null };

  constructor(private readonly host: ArmsHost) {}

  /** Every tick: `fighting` (a wave on: the clocks run, the shots go), the player's cards. */
  update(cards: CardLevels, fighting: boolean): void {
    this.time += TICK;
    const me = this.host.me;
    const at = me.currentCF.position;
    const view: ArmsView = { drones: [], blades: [], aura: null };
    if (!me.isAlive) {
      this.view = view;
      return;
    }
    const enemies = this.host.reds().filter((p) => p.isAlive);

    // Blades: turning around him, cutting whom they touch (again after a while)
    const blades = level(cards, 'blades');
    if (blades) {
      const B = HORDE_ARMS.blades;
      const radius = B.radius[cards.blades ?? 0];
      this.bladeAngle += ((B.turn * Math.PI) / 180) * TICK;
      for (let k = 0; k < blades; k++) {
        const a = this.bladeAngle + (k * Math.PI * 2) / blades;
        const x = at.x + Math.cos(a) * radius;
        const y = at.y + Math.sin(a) * radius;
        view.blades.push({ x, y, angle: a });
        if (!fighting) continue;
        for (const p of enemies) {
          if ((this.bladeHit.get(p) ?? -Infinity) > this.time) continue;
          if (Math.hypot(p.currentCF.position.x - x, p.currentCF.position.y - y) > p.radius + B.size) continue;
          this.bladeHit.set(p, this.time + B.gap);
          this.hurt(p, B.lives, WEAPON_KNIVES);
        }
      }
    }

    // The field: whom it reaches, every so often
    const reach = level(cards, 'aura');
    if (reach) {
      view.aura = { x: at.x, y: at.y, radius: reach };
      this.auraClock += TICK;
      if (fighting && this.auraClock >= HORDE_ARMS.aura.gap) {
        this.auraClock = 0;
        for (const p of enemies) {
          if (Math.hypot(p.currentCF.position.x - at.x, p.currentCF.position.y - at.y) <= reach + p.radius) this.hurt(p, HORDE_ARMS.aura.lives, WEAPON_PHOTON_RIFLE);
        }
      }
    }

    // The ring of bullets, when there's someone to hit around
    const bullets = level(cards, 'nova');
    if (bullets && fighting) {
      this.novaClock += TICK;
      const R = HORDE_ARMS.nova;
      if (this.novaClock >= R.every && enemies.some((p) => this.dist(p, at) < R.range + 2)) {
        this.novaClock = 0;
        const turn = Math.random() * Math.PI * 2;
        for (let k = 0; k < bullets; k++) {
          const a = turn + (k * Math.PI * 2) / bullets;
          this.bullet(new Vec3(at.x, at.y, 0.25), new Vec3(Math.cos(a), Math.sin(a), 0), R.range, R.lives, enemies);
        }
      }
    }

    // Drones: turning around him, each shooting the nearest enemy in sight
    const drones = level(cards, 'drone');
    while (this.droneClocks.length < drones) this.droneClocks.push((this.droneClocks.length * HORDE_ARMS.drone.gap) / 3);
    for (let k = 0; k < drones; k++) {
      const D = HORDE_ARMS.drone;
      const a = this.time * 1.8 + (k * Math.PI * 2) / drones;
      const pos = new Vec3(at.x + Math.cos(a) * D.orbit, at.y + Math.sin(a) * D.orbit, 0.55 + Math.sin(this.time * 4 + k) * 0.05);
      view.drones.push({ x: pos.x, y: pos.y, z: pos.z });
      if (!fighting) continue;
      this.droneClocks[k] += TICK;
      if (this.droneClocks[k] < D.gap) continue;
      const target = this.nearest(new Vec3(pos.x, pos.y, 0.25), enemies, D.range, 1)[0];
      if (!target) continue;
      this.droneClocks[k] = 0;
      this.hurt(target, D.lives, WEAPON_SMG);
      this.host.onShot(pos, target.currentCF.position.clone());
    }

    // Homing rockets: a volley at the nearest enemies, each one turning after its own
    const volley = level(cards, 'homing');
    if (volley && fighting) {
      const H = HORDE_ARMS.homing;
      this.homingClock += TICK;
      if (this.homingClock >= H.every) {
        const targets = this.nearest(new Vec3(at.x, at.y, 0.25), enemies, H.range, volley);
        if (targets.length) {
          this.homingClock = 0;
          targets.forEach((target, k) => {
            const to = target.currentCF.position;
            const dir = new Vec3(to.x - at.x, to.y - at.y, 0).normalizeIn();
            // (fanned out a little: they come round to their targets)
            const side = (k - (targets.length - 1) / 2) * 0.6;
            const start = new Vec3(dir.x - dir.y * side, dir.y + dir.x * side, 0).normalizeIn();
            if (!this.host.game.spawnProjectile(new Vec3(at.x, at.y, 0.35), start.mul(3), me.playerID, PROJECTILE_ROCKET, WEAPON_BAZOOKA)) return;
            const p = this.host.game.projectiles[this.host.game.projectiles.length - 1];
            p.rain = true;
            p.size = 0.6;
            p.share = H.share;
            this.rockets.push({ p, target });
          });
          this.host.onRockets(at.clone());
        }
      }
    }
    this.steer();
    this.view = view;
  }

  /** Where the drones and blades are now, the field's reach. */
  get look(): ArmsView {
    return this.view;
  }

  /** The homing rockets turn toward their targets (a fallen one: straight on). */
  private steer(): void {
    this.rockets = this.rockets.filter(({ p, target }) => {
      if (p.needToBeDeleted || !this.host.game.projectiles.includes(p)) return false;
      if (!target.isAlive) return true;
      const v = p.currentCF.vel;
      const speed = Math.hypot(v.x, v.y);
      if (speed < 1e-3) return true;
      const to = target.currentCF.position;
      const pos = p.currentCF.position;
      const want = new Vec3(to.x - pos.x, to.y - pos.y, 0).normalizeIn();
      const k = HORDE_ARMS.homing.steer;
      const nx = (v.x / speed) * (1 - k) + want.x * k;
      const ny = (v.y / speed) * (1 - k) + want.y * k;
      const n = Math.hypot(nx, ny) || 1;
      v.x = (nx / n) * speed;
      v.y = (ny / n) * speed;
      v.z = (to.z - pos.z) * 2;
      return true;
    });
  }

  /** A straight bullet from `p1` along `dir`: the walls stop it, it hits the first enemy on its way. */
  private bullet(p1: Vec3, dir: Vec3, range: number, lives: number, enemies: Player[]): void {
    const end = p1.add(dir.mul(range));
    this.host.game.map.rayTest(p1.clone(), end, new Vec3());
    const length = Math.hypot(end.x - p1.x, end.y - p1.y);
    let hit: Player | null = null;
    let best = length;
    for (const p of enemies) {
      const dx = p.currentCF.position.x - p1.x;
      const dy = p.currentCF.position.y - p1.y;
      const along = dx * dir.x + dy * dir.y;
      if (along < 0 || along > best) continue;
      if (Math.abs(-dx * dir.y + dy * dir.x) > p.radius) continue;
      best = along;
      hit = p;
    }
    if (hit) this.hurt(hit, lives, WEAPON_SMG);
    this.host.onShot(p1, new Vec3(p1.x + dir.x * best, p1.y + dir.y * best, 0.25));
  }

  /** Up to `n` enemies in sight from `from` within `range`, the nearest first. */
  private nearest(from: Vec3, enemies: Player[], range: number, n: number): Player[] {
    const map = this.host.game.map;
    return enemies
      .map((p) => ({ p, d: this.dist(p, from) }))
      .filter(({ p, d }) => d < range && !map.rayTest(from.clone(), p.currentCF.position.clone(), new Vec3()))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map(({ p }) => p);
  }

  private dist(p: Player, at: Vec3): number {
    return Math.hypot(p.currentCF.position.x - at.x, p.currentCF.position.y - at.y);
  }

  private hurt(p: Player, lives: number, weaponID: number): void {
    p.hitSV(weaponID, this.host.me, lives / this.host.toughness(), WAVES.grenadeBonus, false);
  }
}

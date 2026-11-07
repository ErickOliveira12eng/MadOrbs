// What makes each boss of the waves different (Erick, 07/11/2026: the boss should change as the waves go on; it was the
// same eye with a chain gun every ten waves): its signature attacks, driven every tick by WavesRun, each marked on the
// floor before it lands, as the Vesuvius's (src/client/vesuviusRun.ts, whose drawing it shares). Who comes on which wave,
// with which weapon and which of these: BOSSES and bossMoves in src/client/waves.ts. Their damage is given before the
// boss's own strength (Player.damageBoost: it grows with the wave, as its gun's does) and the player's defence.
import type * as THREE from 'three';
import type { BotController } from '../sim/bot';
import { PROJECTILE_COCKTAIL_MOLOTOV, PROJECTILE_FLAME, PROJECTILE_ROCKET, TICK, WEAPON_BAZOOKA, WEAPON_COCKTAIL_MOLOTOV, WEAPON_KNIVES } from '../sim/constants';
import type { Game } from '../sim/game';
import type { Player } from '../sim/player';
import { Vec3 } from '../sim/vec';
import { VesuviusRenderer, type VesuviusMarks } from './render/vesuviusRenderer';
import { BOSS_MOVE as M, type BossMove } from './waves';

/** What the attacks need of the run. */
export interface BossHost {
  game: Game;
  me: Player;
  scene: THREE.Scene;
  /** A bot of the wave right there (the Summoner's), not one of its count. */
  summon: (at: Vec3) => Player | null;
  /** Sounds: a rocket or a lava bomb leaves, a beam lights up. */
  onLaunch: (position: Vec3) => void;
  onBeam: (position: Vec3) => void;
}

type Mark =
  | { kind: 'line'; x: number; y: number; angle: number; length: number; width: number; from: number; at: number }
  | { kind: 'circle'; x: number; y: number; radius: number; from: number; at: number };

const DEG = Math.PI / 180;

/** The attacks of one boss, for as long as it stands. */
export class BossMoves {
  /** The run's clock of these attacks: it runs while the player and the boss are up (never the pauses). */
  private clock = 0;
  private nextAt: number = M.first;
  private turn = 0;
  private tasks: { at: number; run: () => void }[] = [];
  private marks: Mark[] = [];
  private ring: { from: number; at: number; gap: number; gapWidth: number } | null = null;
  private beam: { from: number; on: number; end: number; angle: number; dir: number; hitClock: number } | null = null;
  private charge: { from: number; at: number; angle: number; length: number; gone: number; hit: boolean; restUntil: number; x: number; y: number } | null = null;
  /** Which of the Pyromancer's two comes next. */
  private ringNext = false;
  /** The bots it called that still stand. */
  private readonly summoned = new Set<Player>();

  constructor(
    private readonly host: BossHost,
    private readonly boss: Player,
    private readonly bot: BotController,
    private readonly moves: readonly BossMove[],
    /** How many times this boss came before: a little more often and more of each. */
    private readonly cycle: number,
    private readonly renderer: VesuviusRenderer,
  ) {}

  /** Every tick while the run plays. */
  update(): void {
    const { me } = this.host;
    if (!this.boss.isAlive || !me.isAlive) {
      this.calm();
      return;
    }
    this.clock += TICK;
    // Its lava bombs' fire: weaker than a molotov's, and it burns out
    for (const p of this.host.game.projectiles) {
      if (p.projectileType !== PROJECTILE_FLAME || p.fromID !== this.boss.playerID) continue;
      p.share = M.fire.burn;
      if (p.timeSinceThrown > M.fire.seconds) p.needToBeDeleted = true;
    }
    const due = this.tasks.filter((t) => t.at <= this.clock);
    if (due.length) {
      this.tasks = this.tasks.filter((t) => t.at > this.clock);
      for (const t of due) t.run();
    }
    this.marks = this.marks.filter((m) => m.at > this.clock);
    if (this.ring && this.ring.at <= this.clock) this.ring = null;
    this.updateBeam();
    this.updateCharge();
    for (const p of this.summoned) if (!p.isAlive) this.summoned.delete(p);
    // It stands still only while a ring is about to go or a beam burns
    if (!this.charge) this.bot.still = !!this.ring || !!this.beam;
    // One attack at a time, taking turns
    if (this.moves.length && this.clock >= this.nextAt && !this.beam && !this.ring && !this.charge) {
      // (the next one it can do now; none: its gun, and another try soon)
      this.nextAt = this.clock + 1;
      for (let i = 0; i < this.moves.length; i++) {
        const move = this.moves[(this.turn + i) % this.moves.length];
        if (!this.can(move)) continue;
        this.turn += i + 1;
        this.nextAt = this.clock + Math.max(M.minEvery, M.every - M.faster * this.cycle);
        this.start(move);
        break;
      }
    }
  }

  /**
   * What comes out of the boss itself needs the player in its sight and reach, the charge some room to run too (the
   * missiles fall from the sky and the bots come anywhere).
   */
  private can(move: BossMove): boolean {
    if (move === 'fire') return this.seesMe(M.fire.reach);
    if (move === 'beam') return this.seesMe(M.beam.length);
    if (move === 'charge') return this.seesMe(M.beam.length) && this.chargeRoom(this.angleToMe()) >= M.charge.least;
    return true;
  }

  /** How far its middle can run along an angle, stopping short of the wall. */
  private chargeRoom(angle: number): number {
    return this.reach(angle, M.charge.length) - (this.boss.wallRadius || this.boss.radius) - 0.05;
  }

  private start(move: BossMove): void {
    switch (move) {
      case 'missiles':
        this.missiles(M.missiles.count + this.cycle);
        break;
      case 'fire':
        if (this.ringNext) this.fireRing();
        else this.mortars(M.fire.mortars + this.cycle);
        this.ringNext = !this.ringNext;
        break;
      case 'beam':
        this.startBeam();
        break;
      case 'charge':
        this.startCharge();
        break;
      case 'summon':
        this.callBots(M.summon.count + this.cycle);
        break;
    }
  }

  /** The player or the boss fell: what was coming goes, the boss walks again. */
  calm(): void {
    this.tasks = [];
    this.marks = [];
    this.ring = null;
    this.beam = null;
    this.charge = null;
    this.bot.still = false;
  }

  // ---------------------------------------------------------------- helpers

  private get at(): Vec3 {
    return this.boss.currentCF.position;
  }

  /** The boss's edge towards an angle (radians). */
  private mouth(angle: number, out = 0.2): Vec3 {
    const r = this.boss.radius + out;
    return new Vec3(this.at.x + Math.cos(angle) * r, this.at.y + Math.sin(angle) * r, 0.3);
  }

  private angleToMe(): number {
    const p = this.host.me.currentCF.position;
    return Math.atan2(p.y - this.at.y, p.x - this.at.x);
  }

  private seesMe(within: number): boolean {
    const p = this.host.me.currentCF.position;
    if (Math.hypot(p.x - this.at.x, p.y - this.at.y) > within) return false;
    return !this.host.game.map.rayTest(new Vec3(this.at.x, this.at.y, 0.3), new Vec3(p.x, p.y, 0.3), new Vec3());
  }

  /** How far a line from the boss's middle goes along `angle` before a wall (at most `max`). */
  private reach(angle: number, max: number): number {
    const from = new Vec3(this.at.x, this.at.y, 0.3);
    const to = new Vec3(from.x + Math.cos(angle) * max, from.y + Math.sin(angle) * max, from.z);
    this.host.game.map.rayTest(from.clone(), to, new Vec3());
    return Math.hypot(to.x - from.x, to.y - from.y);
  }

  /** A rocket of its own: its blast spares the boss's side, its share of the bazooka's damage. */
  private rocket(from: Vec3, dir: Vec3, speed: number, share: number, size: number): void {
    const { game } = this.host;
    // (the projectile starts at 2.5 times what it is given)
    if (!game.spawnProjectile(from, dir.normalizeIn().mul(speed / 2.5), this.boss.playerID, PROJECTILE_ROCKET, WEAPON_BAZOOKA)) return;
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

  // ---------------------------------------------------------------- the attacks

  /** The Gunner's: missiles from the sky onto circles around the player, one right on him. */
  private missiles(n: number): void {
    const m = M.missiles;
    const p = this.host.me.currentCF.position;
    const fall = m.height / m.speed;
    this.spots(p.x, p.y, n, m.spread, m.gap).forEach((to, i) => {
      const start = this.clock + i * 0.12;
      const at = start + m.windup;
      this.marks.push({ kind: 'circle', x: to.x, y: to.y, radius: m.radius, from: start, at });
      this.tasks.push({
        at: at - fall,
        run: () => {
          const from = new Vec3(to.x + 0.8, to.y - 0.8, m.height);
          this.rocket(from, to.sub(from), m.speed, m.share, m.size);
          if (i % 3 === 0) this.host.onLaunch(from);
        },
      });
    });
  }

  /** The Pyromancer's: lava bombs in a high arc onto circles around the player (one where he is heading), their fire left there a while. */
  private mortars(n: number): void {
    const { me, game } = this.host;
    const f = M.fire;
    const p = me.currentCF.position;
    const v = me.currentCF.vel;
    const lead = 0.5 * f.flight;
    for (const to of this.spots(p.x + v.x * lead, p.y + v.y * lead, n, f.spread, 1.6)) {
      const a = Math.atan2(to.y - this.at.y, to.x - this.at.x);
      const from = this.mouth(a, -0.3);
      from.z = 2.2;
      // (the throw asks for a molotov in the bag; its own bag stays as it was)
      const bag = this.boss.nbMolotovLeft;
      this.boss.nbMolotovLeft = 99;
      const thrown = game.spawnProjectile(from, new Vec3(0, 0, 0), this.boss.playerID, PROJECTILE_COCKTAIL_MOLOTOV, WEAPON_COCKTAIL_MOLOTOV);
      this.boss.nbMolotovLeft = bag;
      if (!thrown) continue;
      // Its own throw: there in `flight` seconds (the floor at 0, gravity 9.8)
      const proj = game.projectiles[game.projectiles.length - 1];
      proj.currentCF.vel.set((to.x - from.x) / f.flight, (to.y - from.y) / f.flight, (0 - from.z) / f.flight + 0.5 * 9.8 * f.flight);
      proj.lastCF.copyFrom(proj.currentCF);
      this.marks.push({ kind: 'circle', x: to.x, y: to.y, radius: f.radius, from: this.clock, at: this.clock + f.flight });
    }
    this.host.onLaunch(this.mouth(this.angleToMe()));
  }

  /** And its other one: a ring of small rockets out of the boss with a gap to go through. */
  private fireRing(): void {
    const r = M.ring;
    const gap = Math.random() * Math.PI * 2;
    const step = (Math.PI * 2) / r.count;
    const at = this.clock + r.windup;
    this.ring = { from: this.clock, at, gap, gapWidth: step * (r.gap + 0.6) };
    this.tasks.push({
      at,
      run: () => {
        for (let i = 0; i < r.count; i++) {
          const a = gap + (i + 0.5) * step;
          if (Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap))) < (step * r.gap) / 2) continue;
          this.rocket(this.mouth(a), new Vec3(Math.cos(a), Math.sin(a), 0), r.speed, r.share, r.size);
        }
        this.host.onLaunch(this.mouth(gap + Math.PI));
      },
    });
  }

  /** The Eye's, once it comes back: a thin warning where it starts (away from the player), then it burns and sweeps over him. */
  private startBeam(): void {
    const b = M.beam;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const angle = this.angleToMe() - dir * b.before * DEG;
    this.beam = { from: this.clock, on: this.clock + b.windup, end: this.clock + b.windup + b.sweep, angle, dir, hitClock: 0 };
  }

  private updateBeam(): void {
    const s = this.beam;
    if (!s) return;
    const b = M.beam;
    if (this.clock >= s.end) {
      this.beam = null;
      return;
    }
    if (this.clock < s.on) return;
    if (this.clock - TICK < s.on) this.host.onBeam(this.mouth(s.angle));
    s.angle += s.dir * b.turn * DEG * TICK;
    s.hitClock -= TICK;
    if (s.hitClock > 0) return;
    const me = this.host.me;
    const dx = me.currentCF.position.x - this.at.x;
    const dy = me.currentCF.position.y - this.at.y;
    const along = dx * Math.cos(s.angle) + dy * Math.sin(s.angle);
    const across = Math.abs(-dx * Math.sin(s.angle) + dy * Math.cos(s.angle));
    // (a wall between stops it)
    if (along < this.boss.radius || along > this.reach(s.angle, b.length) || across > b.width / 2 + me.radius) return;
    s.hitClock = b.every;
    me.hitSV(WEAPON_COCKTAIL_MOLOTOV, this.boss, b.dps * b.every);
  }

  /** The Bull's: it stops, a wide red line shows its way, and it runs along it to the wall, whatever is in between. */
  private startCharge(): void {
    const c = M.charge;
    const angle = this.angleToMe();
    const length = this.chargeRoom(angle);
    this.charge = { from: this.clock, at: this.clock + c.windup, angle, length, gone: 0, hit: false, restUntil: 0, x: this.at.x, y: this.at.y };
    this.bot.still = true;
    this.marks.push({ kind: 'line', x: this.at.x, y: this.at.y, angle, length: length + this.boss.radius, width: (this.boss.radius + 0.1) * 2, from: this.clock, at: this.clock + c.windup });
  }

  private updateCharge(): void {
    const s = this.charge;
    if (!s) return;
    const c = M.charge;
    const boss = this.boss;
    const hold = () => {
      boss.currentCF.position.x = s.x + Math.cos(s.angle) * s.gone;
      boss.currentCF.position.y = s.y + Math.sin(s.angle) * s.gone;
      boss.currentCF.vel.set(0, 0, 0);
    };
    // Winded at the end of its run: a moment to hit it back
    if (s.restUntil) {
      hold();
      if (this.clock >= s.restUntil) {
        this.charge = null;
        this.bot.still = false;
      }
      return;
    }
    hold();
    if (this.clock < s.at) return;
    s.gone = Math.min(s.length, s.gone + c.speed * TICK);
    hold();
    const { me, game } = this.host;
    const pos = boss.currentCF.position;
    if (!s.hit && Math.hypot(me.currentCF.position.x - pos.x, me.currentCF.position.y - pos.y) < boss.radius + me.radius) {
      s.hit = true;
      me.currentCF.vel.x += Math.cos(s.angle) * c.push;
      me.currentCF.vel.y += Math.sin(s.angle) * c.push;
      me.hitSV(WEAPON_KNIVES, boss, c.damage);
    }
    // The crates in its way break
    for (const crate of [...game.crates]) {
      if (Math.hypot(crate.position.x - pos.x, crate.position.y - pos.y) < boss.radius + 0.35) game.hitCrate(crate, 99, boss);
    }
    if (s.gone >= s.length) s.restUntil = this.clock + c.rest;
  }

  /** The Summoner's: circles on the floor around it, and a bot of the wave in each when they fill up. */
  private callBots(n: number): void {
    const s = M.summon;
    const room = s.max + this.cycle - this.summoned.size;
    if (room <= 0) return;
    const spots = this.spots(this.at.x, this.at.y, Math.min(n, room) + 1, s.spread, 1).slice(1);
    const at = this.clock + s.windup;
    for (const to of spots) {
      this.marks.push({ kind: 'circle', x: to.x, y: to.y, radius: s.radius, from: this.clock, at });
      this.tasks.push({
        at,
        run: () => {
          const p = this.host.summon(to);
          if (p) this.summoned.add(p);
        },
      });
    }
  }

  // ---------------------------------------------------------------- drawing

  render(time: number): void {
    const k = (from: number, at: number) => Math.max(0, Math.min(1, (this.clock - from) / Math.max(1e-6, at - from)));
    const marks: VesuviusMarks = { lines: [], circles: [], ring: null, beam: null, lava: null };
    for (const m of this.marks) {
      if (m.from > this.clock) continue;
      if (m.kind === 'line') marks.lines.push({ x: m.x, y: m.y, angle: m.angle, length: m.length, width: m.width, k: k(m.from, m.at) });
      else marks.circles.push({ x: m.x, y: m.y, radius: m.radius, k: k(m.from, m.at) });
    }
    if (this.ring) marks.ring = { x: this.at.x, y: this.at.y, radius: this.boss.radius + 0.5, k: k(this.ring.from, this.ring.at), gap: this.ring.gap, gapWidth: this.ring.gapWidth };
    const b = this.beam;
    if (b) {
      const from = this.mouth(b.angle, 0);
      marks.beam = { x: from.x, y: from.y, angle: b.angle, length: Math.max(0, this.reach(b.angle, M.beam.length) - this.boss.radius), on: this.clock >= b.on, k: k(b.from, b.on) };
    }
    this.renderer.render(marks, time);
  }
}

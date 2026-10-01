// Simple AI opponents for local play (not part of the original game). A bot only produces
// PlayerInput, exactly like a human, so it obeys the same movement/weapon rules.
import {
  FLAG_DROPPED,
  GAME_TYPE_CTF,
  PRIMARY_WEAPONS,
  WEAPON_BAZOOKA,
  WEAPON_FLAME_THROWER,
  WEAPON_KNIVES,
  WEAPON_NUCLEAR,
  WEAPON_SHIELD,
  WEAPON_SHOTGUN,
  WEAPON_SNIPER,
} from './constants';
import { isWeaponEnabled } from './gameVar';
import { emptyInput } from './input';
import type { Game } from './game';
import type { Player } from './player';
import { Vec3, distance, randRange } from './vec';

interface Node {
  x: number;
  y: number;
}

/** A* on the map grid (8-connected, no corner cutting). Returns cell centres. */
function findPath(game: Game, from: Vec3, to: Vec3): Vec3[] {
  const map = game.map;
  const [w, h] = map.size;
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y);
  const passable = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && map.cells[y * w + x].passable;
  if (!passable(tx, ty) || !passable(sx, sy)) return [];
  const idx = (x: number, y: number) => y * w + x;
  const g = new Float32Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const open: { n: Node; f: number }[] = [{ n: { x: sx, y: sy }, f: 0 }];
  g[idx(sx, sy)] = 0;
  let iterations = 0;
  while (open.length && iterations++ < 5000) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const { n } = open.splice(best, 1)[0];
    const ni = idx(n.x, n.y);
    if (closed[ni]) continue;
    closed[ni] = 1;
    if (n.x === tx && n.y === ty) break;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = n.x + dx;
        const y = n.y + dy;
        if (!passable(x, y)) continue;
        if (dx && dy && (!passable(n.x + dx, n.y) || !passable(n.x, n.y + dy))) continue;
        const cost = g[ni] + (dx && dy ? 1.414 : 1);
        const i = idx(x, y);
        if (cost < g[i]) {
          g[i] = cost;
          came[i] = ni;
          open.push({ n: { x, y }, f: cost + Math.hypot(tx - x, ty - y) });
        }
      }
    }
  }
  const path: Vec3[] = [];
  let cur = idx(tx, ty);
  if (came[cur] < 0 && cur !== idx(sx, sy)) return [];
  while (cur >= 0 && cur !== idx(sx, sy)) {
    path.push(new Vec3((cur % w) + 0.5, Math.floor(cur / w) + 0.5, 0));
    cur = came[cur];
  }
  return path.reverse();
}

export class BotController {
  readonly player: Player;
  private path: Vec3[] = [];
  private repathTimer = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private aimError = new Vec3();
  private aimErrorTimer = 0;
  private stuckTimer = 0;
  private lastPos = new Vec3();
  private shootHold = 0;
  private reaction = 0;
  private lastTarget: Player | null = null;
  private wasShooting = false;
  private skill: number;
  /** CTF: guards its team's flag instead of going for the enemy's (one bot in three). */
  private readonly defender: boolean;
  private goalAt = new Vec3(-999, -999, 0);
  private guardSpot: Vec3 | null = null;

  constructor(player: Player, skill = 0.5) {
    this.player = player;
    this.skill = skill;
    this.defender = player.playerID % 3 === 0;
    this.pickLoadout();
  }

  /**
   * CTF: where the bot must go, and whether it is urgent (carrying the flag, bringing ours back or
   * chasing its thief: no stopping to duel). Null outside CTF: roam and fight.
   */
  private objective(): { at: Vec3; urgent: boolean } | null {
    const p = this.player;
    const game = p.game;
    if (game.gameType !== GAME_TYPE_CTF) return null;
    const own = p.teamID;
    const enemy = 1 - own;
    if (game.carriedFlag(p) === enemy) return { at: game.map.flagPodPos[own], urgent: true };
    if (game.flagState[own] === FLAG_DROPPED) return { at: game.flagPos[own], urgent: true };
    if (game.flagState[own] >= 0) return { at: game.flagPosition(own), urgent: true };
    if (this.defender) {
      // Around our pod, somewhere new now and then
      const pod = game.map.flagPodPos[own];
      if (!this.guardSpot || distance(this.guardSpot, p.currentCF.position) < 0.6) this.guardSpot = this.randomDestination(pod, 4);
      return { at: this.guardSpot, urgent: false };
    }
    return { at: game.flagPosition(enemy), urgent: false };
  }

  private pickLoadout(): void {
    const primaries = PRIMARY_WEAPONS.filter((w) => isWeaponEnabled(w));
    this.player.nextSpawnWeapon = primaries[Math.floor(Math.random() * primaries.length)] ?? 0;
    const secondaries = [WEAPON_KNIVES, WEAPON_SHIELD, WEAPON_NUCLEAR].filter((w) => isWeaponEnabled(w));
    this.player.nextMeleeWeapon = secondaries[Math.floor(Math.random() * secondaries.length)] ?? WEAPON_KNIVES;
  }

  /** Fills player.input for the next tick. */
  think(delay: number): void {
    const p = this.player;
    const game = p.game;
    const input = emptyInput();
    p.input = input;

    if (!p.isAlive) {
      // Respawn with a (maybe) new weapon
      if (p.timeToSpawn <= 0 && !p.spawnRequested) {
        if (Math.random() < 0.02) {
          if (Math.random() < 0.3) this.pickLoadout();
          input.shootPressed = true;
          input.shoot = true;
        }
      }
      this.path = [];
      return;
    }

    const pos = p.currentCF.position;
    // --- Target selection: closest visible enemy
    let target: Player | null = null;
    let best = Infinity;
    for (const o of game.players) {
      if (!o || o === p || !o.isAlive) continue;
      if (game.isTeamGame && o.teamID === p.teamID) continue;
      const d = distance(pos, o.currentCF.position);
      if (d > 14 || d >= best) continue;
      const n = new Vec3();
      if (game.map.rayTest(pos.clone(), o.currentCF.position.clone(), n)) continue;
      best = d;
      target = o;
    }
    if (target !== this.lastTarget) {
      this.reaction = 0.25 + (1 - this.skill) * 0.5;
      this.lastTarget = target;
    }
    if (this.reaction > 0) this.reaction -= delay;

    // --- Movement: duel the target, or go where the objective (CTF) or the wandering leads
    this.repathTimer -= delay;
    let moveTo: Vec3 | null = null;
    const goal = this.objective();
    const duel = !!target && (!goal || (!goal.urgent && best < 7));
    if (target && duel) {
      const toT = target.currentCF.position.sub(pos);
      const d = toT.length();
      const weapon = p.weapon?.weaponID ?? 0;
      const ideal = weapon === WEAPON_SHOTGUN || weapon === WEAPON_FLAME_THROWER ? 2.5 : weapon === WEAPON_SNIPER ? 9 : weapon === WEAPON_BAZOOKA ? 6 : 5;
      this.strafeTimer -= delay;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = randRange(0.4, 1.5);
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const dir = toT.clone().normalizeIn();
      const side = new Vec3(-dir.y, dir.x, 0).mul(this.strafeDir);
      const radial = dir.mul(d > ideal + 1 ? 1 : d < ideal - 1 ? -1 : 0);
      moveTo = pos.add(side.add(radial));
      this.path = [];
    } else if (goal) {
      // Follow the goal, which may move (a carrier): new path every second and a half
      if (this.path.length === 0 || this.repathTimer <= 0 || distance(goal.at, this.goalAt) > 1) {
        this.repathTimer = 1.5;
        this.goalAt.copy(goal.at);
        this.path = findPath(game, pos, goal.at);
      }
      while (this.path.length && distance(this.path[0], new Vec3(pos.x, pos.y, 0)) < 0.35) this.path.shift();
      moveTo = this.path.length ? this.path[0] : new Vec3(goal.at.x, goal.at.y, 0);
    } else {
      if (this.path.length === 0 || this.repathTimer <= 0) {
        this.repathTimer = 6;
        this.path = findPath(game, pos, this.randomDestination());
      }
      while (this.path.length && distance(this.path[0], new Vec3(pos.x, pos.y, 0)) < 0.35) this.path.shift();
      if (this.path.length) moveTo = this.path[0];
    }
    if (moveTo) {
      const d = moveTo.sub(pos);
      // Flags are touched within a quarter of a cell: aim finely at the end of the path
      const t = goal && !duel && this.path.length === 0 ? 0.04 : 0.2;
      input.right = d.x > t;
      input.left = d.x < -t;
      input.up = d.y > t;
      input.down = d.y < -t;
    }
    // Unstick
    if (distance(pos, this.lastPos) < 0.01) {
      this.stuckTimer += delay;
      if (this.stuckTimer > 0.6) {
        this.path = [];
        this.repathTimer = 0;
        this.strafeDir = -this.strafeDir;
        this.stuckTimer = 0;
      }
    } else this.stuckTimer = 0;
    this.lastPos.copy(pos);

    // --- Aiming / shooting
    this.aimErrorTimer -= delay;
    if (this.aimErrorTimer <= 0) {
      this.aimErrorTimer = randRange(0.2, 0.6);
      const e = (1 - this.skill) * 1.2 + 0.1;
      this.aimError.set(randRange(-e, e), randRange(-e, e), 0);
    }
    if (target) {
      // Lead the target a bit
      const lead = target.currentCF.vel.mul(Math.min(0.4, best / 20));
      input.mousePosOnMap = target.currentCF.position.add(lead).add(this.aimError);
      input.mousePosOnMap.z = 0;
      const weapon = p.weapon?.weaponID ?? 0;
      const inRange = weapon === WEAPON_SHOTGUN ? best < 5 : weapon === WEAPON_FLAME_THROWER ? best < 4.5 : true;
      if (this.reaction <= 0 && inRange) {
        this.shootHold = 0.3;
      }
      // Occasional grenade / molotov / secondary
      if (best > 3 && best < 7 && Math.random() < 0.004) input.throwGrenadePressed = true;
      if (best > 2 && best < 6 && Math.random() < 0.002) input.throwMolotovPressed = true;
      const melee = p.meleeWeapon?.weaponID;
      if (melee === WEAPON_KNIVES && best < 1.1) input.melee = true;
      if (melee === WEAPON_SHIELD && p.life < 0.5 && Math.random() < 0.05) input.melee = true;
      if (melee === WEAPON_NUCLEAR && best < 3 && Math.random() < 0.01) input.melee = true;
    } else {
      // Look where we go
      const look = moveTo ? moveTo.sub(pos).normalizeIn().mul(3).add(pos) : pos.add(new Vec3(0, 3, 0));
      input.mousePosOnMap = new Vec3(look.x, look.y, 0);
    }
    if (this.shootHold > 0) {
      this.shootHold -= delay;
      input.shoot = true;
      input.shootPressed = !this.wasShooting;
    }
    this.wasShooting = input.shoot;
    input.camPosZ = p.weapon?.weaponID === WEAPON_SNIPER ? 10 : 7;
  }

  /** A random free cell of the map, or around `near` within `radius` cells. */
  private randomDestination(near?: Vec3, radius = 0): Vec3 {
    const map = this.player.game.map;
    const [w, h] = map.size;
    for (let i = 0; i < 50; i++) {
      const x = near ? Math.floor(near.x + randRange(-radius, radius)) : Math.floor(Math.random() * w);
      const y = near ? Math.floor(near.y + randRange(-radius, radius)) : Math.floor(Math.random() * h);
      if (x >= 0 && y >= 0 && x < w && y < h && map.cells[y * w + x].passable) return new Vec3(x + 0.5, y + 0.5, 0);
    }
    return near ? near.clone() : this.player.currentCF.position.clone();
  }
}

export const BOT_NAMES = [
  'Bobo', 'Rolling Thunder', 'Ball Buster', 'Sir Rolls-a-Lot', 'Pinball', 'Bowling Ball', 'Meatball',
  'Snowball', 'Fireball', 'Oddball', 'Screwball', 'Hairball', 'Goofball', 'Gumball', 'Cannonball', 'Eyeball',
];

// The tutorials (Erick, 23/10/2026): asked once, the first time a player opens the waves or plays online
// (src/menu/tutorialModal.ts), and always in the Training window. Each one is a script of steps on a real game:
// a card says what to do (the game waits while it shows), the objective box keeps it on screen, and the step ends
// when it's done. Nobody can hurt the player, and nothing counts (no record, Cores, stats or reports).
//
//   waves  the waves mode on its map (WavesRun in its scripted mode, wavesRun.ts): an orb walking a fixed path; the
//          siren and wave 2, two orbs coming; a crate and its upgrade; wave 3, three orbs standing close together
//          that only a grenade or a molotov takes down; a crate and its weapon (F); and a horde around a crate that
//          holds the Bomb
//   pvp    a shooting range (Deathmatch, RANGE_MAP): orbs walking from side to side that come back a few seconds after
//          they fall, with the damage and the DPS under each one; then every weapon on the floor to take with F, the
//          knife, and a grenade
import { BotController, findPath } from '../sim/bot';
import {
  ITEM_WEAPON, PLAYER_TEAM_RED, PRIMARY_WEAPONS, PROJECTILE_COCKTAIL_MOLOTOV, PROJECTILE_DROPED_WEAPON, PROJECTILE_FLAME, PROJECTILE_GRENADE, TICK,
  WEAPON_COCKTAIL_MOLOTOV, WEAPON_GRENADE, WEAPON_KNIVES, WEAPON_NUCLEAR, WEAPON_SMG,
} from '../sim/constants';
import type { GameEvent } from '../sim/events';
import type { Game } from '../sim/game';
import { isWeaponEnabled, weaponDefs } from '../sim/gameVar';
import { emptyInput } from '../sim/input';
import type { Player, SkinInfo } from '../sim/player';
import { Vec3 } from '../sim/vec';
import { bigNum, t } from '../i18n';
import { track } from './analytics';
import { mouseIcon } from './hud/icons';
import type { PowerKind } from './waves';
import type { WavesRun } from './wavesRun';

export type TutorialKind = 'waves' | 'pvp';

/** The shooting range's map: the biggest open floor of all (13 x 13 cells). */
export const RANGE_MAP = 'KOTH-Imp';

/** What a card's button does: go on; at the end, play for real, keep practicing (the range) or the menu; leave. */
export type TutorialAction = 'next' | 'play' | 'practice' | 'menu' | 'leave';

export interface TutorialCard {
  /** Its lesson (1 of `steps`), or null: the end. */
  step: number | null;
  steps: number;
  title: string;
  /** Plain text. */
  text: string;
  /** The keys under the text: the key (HTML) and what it does. */
  keys: { key: string; does: string }[];
  /** Its buttons, the main one first (Enter). */
  buttons: { action: TutorialAction; label: string }[];
}

/** What the HUD shows of a tutorial (HudLayer). */
export interface TutorialHud {
  /** The lesson (1 of `steps`; 0: the end, free practice). */
  step: number;
  steps: number;
  /** The objective (HTML: its keys), its count (null: none), and whether it was just done. */
  goal: string;
  count: { n: number; of: number } | null;
  done: boolean;
  /** The range: its title in the header; under each target, its damage and DPS (by player id). */
  title: string | null;
  meters: ReadonlyMap<number, string>;
}

/** What a tutorial needs from the game (ClientGame). */
export interface TutorialHost {
  game: Game;
  me: Player;
  /** ClientGame's bots (they think every tick): the tutorial's targets go here. */
  bots: BotController[];
  /** The waves tutorial's run (its scripted mode), or null. */
  waves: WavesRun | null;
  names: string[];
  randomSkin: () => SkinInfo;
  /** A card low in the middle of the screen: the game waits until one of its buttons (then resume()). */
  showCard: (card: TutorialCard) => void;
  /** A step's objective was done (a sound). */
  onGoal: () => void;
  /** The last lesson was done (the browser keeps it). */
  onDone: () => void;
  /** The view straight onto the player (a tutorial put him somewhere else, during a card). */
  snapCamera: () => void;
}

const key = (k: string) => `<span class="h-key">${k}</span>`;
/** Seconds of play before the first card. */
const FIRST_CARD = 0.5;
/** What is thrown (and the molotov's fire): none of it left before the grenades come back, a moment later. */
const THROWN = new Set([PROJECTILE_GRENADE, PROJECTILE_COCKTAIL_MOLOTOV, PROJECTILE_FLAME]);
const REFILL_WAIT = 1.2;

/** A step of a tutorial: set up as it begins (before its card: the scene shows behind it), done when `done` says. */
interface Step {
  id: string;
  begin?: () => void;
  card?: Omit<TutorialCard, 'step' | 'steps'>;
  goal: () => string;
  count?: () => { n: number; of: number };
  /** Every tick while it lasts. */
  tick?: () => void;
  done: () => boolean;
  /** Seconds between its end and the next step (the kill, the blast: seen first). */
  wait?: number;
  /** The end: no lesson of its own. */
  end?: boolean;
}

/**
 * A tutorial's orb: it walks where the script says (a loop of points, or up to the player), watches the player and
 * never shoots. It doesn't come back by itself either: the script brings it.
 */
class Target extends BotController {
  /** The points it walks in a loop (none: it stands). */
  route: Vec3[] = [];
  private leg = 0;
  /** Comes towards this one, down to `near` cells (null: it doesn't). */
  chase: Player | null = null;
  near = 2.5;
  private way: Vec3[] = [];
  private wayIn = 0;
  /** Its gun points at this one. */
  watch: Player | null = null;

  override think(delay: number): void {
    const p = this.player;
    const input = emptyInput();
    p.input = input;
    if (!p.isAlive) return;
    const pos = p.currentCF.position;
    let to: Vec3 | null = null;
    const prey = this.chase?.isAlive ? this.chase.currentCF.position : null;
    if (prey && Math.hypot(prey.x - pos.x, prey.y - pos.y) > this.near) {
      // The way to the player, again every second
      this.wayIn -= delay;
      if (this.wayIn <= 0 || !this.way.length) {
        this.wayIn = 1;
        this.way = findPath(p.game, pos, prey.clone());
      }
      while (this.way.length && Math.hypot(this.way[0].x - pos.x, this.way[0].y - pos.y) < 0.35) this.way.shift();
      to = this.way[0] ?? null;
    } else if (!prey && this.route.length) {
      if (Math.hypot(this.route[this.leg].x - pos.x, this.route[this.leg].y - pos.y) < 0.25) this.leg = (this.leg + 1) % this.route.length;
      to = this.route[this.leg];
    }
    if (to) {
      const dx = to.x - pos.x;
      const dy = to.y - pos.y;
      input.right = dx > 0.08;
      input.left = dx < -0.08;
      input.up = dy > 0.08;
      input.down = dy < -0.08;
    }
    const look = this.watch?.isAlive ? this.watch.currentCF.position : (to ?? pos.add(new Vec3(0, -1, 0)));
    input.mousePosOnMap = new Vec3(look.x, look.y, 0);
    input.camPosZ = 7;
  }

  /** Walks this loop from its point nearest to where it stands. */
  walk(points: Vec3[]): void {
    this.route = points;
    const pos = this.player.currentCF.position;
    let best = 0;
    points.forEach((q, i) => {
      if (Math.hypot(q.x - pos.x, q.y - pos.y) < Math.hypot(points[best].x - pos.x, points[best].y - pos.y)) best = i;
    });
    this.leg = best;
  }
}

/** Puts a babo there at once (no slide from where it was). */
function place(p: Player, x: number, y: number): void {
  p.currentCF.position.set(x, y, 0.25);
  p.currentCF.vel.set(0, 0, 0);
  p.lastCF.position.copy(p.currentCF.position);
}

export abstract class Tutorial {
  protected readonly steps: Step[] = [];
  private index = -1;
  /** Seconds since the step was done (-1: not yet). */
  private doneFor = -1;
  /** The game's own seconds since the start (the pauses don't count). */
  protected clock = 0;
  /** A card is up: the game waits (ClientGame.paused). */
  waiting = false;
  private readonly startedAt = performance.now();
  private ended = false;
  /** The targets the tutorial brought, by player id (what they drop is cleared away). */
  protected readonly targets = new Map<number, Target>();
  /** What the player did: kills of targets (and with the knife), the weapons taken, the power-ups taken. */
  protected kills = 0;
  protected knifeKills = 0;
  protected grenadeKills = 0;
  /** Seconds before the thrown ones come back (refill). */
  private refillIn = -1;
  protected readonly weaponsTaken = new Set<number>();
  protected readonly powersTaken = new Set<PowerKind>();

  constructor(
    protected readonly host: TutorialHost,
    readonly kind: TutorialKind,
  ) {}

  /** The scene at the start: where the player is, what lies around. */
  protected abstract setup(): void;

  start(): void {
    this.setup();
  }

  /** The lessons (the end left out). */
  get lessons(): number {
    return this.steps.filter((s) => !s.end).length;
  }

  /** Every tick of the game (not while a card or the pause screen is up). */
  update(): void {
    this.clock += TICK;
    this.clearDrops();
    this.always();
    // A moment of the game before the first card: the scene drawn behind it
    if (this.index < 0) {
      if (this.clock >= FIRST_CARD) this.advance();
      return;
    }
    const s = this.steps[this.index];
    if (!s || this.waiting) return;
    s.tick?.();
    if (this.doneFor < 0) {
      if (!s.done()) return;
      this.doneFor = 0;
      this.host.onGoal();
    }
    this.doneFor += TICK;
    if (this.doneFor >= (s.wait ?? 1.2)) this.advance();
  }

  /** Every tick, whatever the step (the range: the targets coming back). */
  protected always(): void {}

  /**
   * What the targets drop is cleared away (they always drop their weapon: Player.dieSV); the weapons the player drops
   * (taking another) stay on the floor.
   */
  private clearDrops(): void {
    for (const p of this.host.game.projectiles) {
      if (p.projectileType !== PROJECTILE_DROPED_WEAPON || p.needToBeDeleted) continue;
      if (this.targets.has(p.fromID)) p.needToBeDeleted = true;
      else p.duration = Infinity;
    }
  }

  private advance(): void {
    this.index++;
    this.doneFor = -1;
    const s = this.steps[this.index];
    if (!s) return;
    if (s.end) {
      this.ended = true;
      track('tutorial_end', { kind: this.kind, done: true, seconds: this.seconds });
      this.host.onDone();
    } else track('tutorial_step', { kind: this.kind, step: s.id, n: this.index + 1 });
    s.begin?.();
    if (!s.card) return;
    this.waiting = true;
    this.host.showCard({ ...s.card, step: s.end ? null : this.index + 1, steps: this.lessons });
  }

  /** The card's button: the game goes on. */
  resume(): void {
    this.waiting = false;
  }

  /** Left before the end (the menu, a closed page): for analytics, once. */
  left(): void {
    if (this.ended) return;
    this.ended = true;
    track('tutorial_end', { kind: this.kind, done: false, step: this.steps[this.index]?.id ?? '', seconds: this.seconds });
  }

  private get seconds(): number {
    return Math.round((performance.now() - this.startedAt) / 1000);
  }

  /** The game's events (offline): the kills, the weapons and power-ups taken. */
  onEvent(e: GameEvent): void {
    const me = this.host.me;
    if (e.type === 'death' && e.fromID === me.playerID && this.targets.has(e.playerID)) {
      this.kills++;
      if (e.weaponID === WEAPON_KNIVES) this.knifeKills++;
      if (e.weaponID === WEAPON_GRENADE) this.grenadeKills++;
    } else if (e.type === 'pickup' && e.playerID === me.playerID && e.itemType === ITEM_WEAPON) {
      this.weaponsTaken.add(e.itemFlag);
    }
  }

  /** A waves power-up taken (WavesRun's onPower). */
  onPower(kind: PowerKind): void {
    this.powersTaken.add(kind);
  }

  hud(): TutorialHud | null {
    const s = this.steps[this.index];
    if (!s) return null;
    return {
      step: s.end ? 0 : this.index + 1,
      steps: this.lessons,
      goal: s.goal(),
      count: s.count?.() ?? null,
      done: this.doneFor >= 0,
      title: this.title(),
      meters: this.meters(),
    };
  }

  protected title(): string | null {
    return null;
  }

  protected meters(): ReadonlyMap<number, string> {
    return NO_METERS;
  }

  /** A target of the tutorial's own, standing there (red in the waves, anyone's enemy in Deathmatch). */
  protected addTarget(x: number, y: number, red: boolean): Target | null {
    const { game, bots, names } = this.host;
    const p = game.addPlayer(names[this.targets.size % names.length], true);
    if (!p) return null;
    if (red) p.teamID = PLAYER_TEAM_RED;
    p.skin = this.host.randomSkin();
    // What lies on the floor is the player's; what it drops goes (clearDrops)
    p.takesLifePacks = false;
    p.lifePackChance = 0;
    p.grenadeDropChance = 0;
    const bot = new Target(p, 0.5, { primary: WEAPON_SMG, secondary: WEAPON_KNIVES });
    bot.watch = this.host.me;
    bots.push(bot);
    this.targets.set(p.playerID, bot);
    this.revive(bot, x, y);
    return bot;
  }

  /** A target back in the game there (its one life: it doesn't come back by itself). */
  protected revive(bot: Target, x: number, y: number): void {
    const p = bot.player;
    p.lives = 1;
    p.spawnRequested = false;
    p.timeToSpawn = 0;
    this.host.game.requestSpawn(p);
    if (!p.isAlive) return;
    place(p, x, y);
    // No spawn protection: the player's first shots must count (the protection outlasted a card, the game waiting)
    p.immuneTime = 0;
  }

  /**
   * The grenades (and molotovs) given back a moment after the last one is gone, nothing thrown still flying or burning:
   * up to `grenades` and `molotovs`.
   */
  protected refill(grenades: number, molotovs: number): void {
    const me = this.host.me;
    if (me.nbGrenadeLeft > 0 || (molotovs > 0 && me.nbMolotovLeft > 0)) {
      this.refillIn = -1;
      return;
    }
    const thrown = this.host.game.projectiles.some((p) => !p.needToBeDeleted && p.fromID === me.playerID && THROWN.has(p.projectileType));
    if (thrown) return;
    if (this.refillIn < 0) this.refillIn = REFILL_WAIT;
    this.refillIn -= TICK;
    if (this.refillIn > 0) return;
    this.refillIn = -1;
    me.nbGrenadeLeft = Math.max(me.nbGrenadeLeft, grenades);
    me.nbMolotovLeft = Math.max(me.nbMolotovLeft, molotovs);
  }

  /** Puts the player there, the view with him (during a card: what it speaks of shows above it). */
  protected bringBack([x, y]: [number, number]): void {
    place(this.host.me, x, y);
    this.host.snapCamera();
  }

  /** Of these spots, the first one far enough from the player and in sight (else just far enough, else the farthest). */
  protected spot(spots: [number, number][], away: number): [number, number] {
    const at = this.host.me.currentCF.position;
    const d = (s: [number, number]) => Math.hypot(s[0] - at.x, s[1] - at.y);
    return spots.find((s) => d(s) >= away && this.inSight(s)) ?? spots.find((s) => d(s) >= away) ?? spots.reduce((a, b) => (d(b) > d(a) ? b : a));
  }

  /** No wall between the player and there. */
  protected inSight([x, y]: [number, number]): boolean {
    return !this.host.game.map.rayTest(this.host.me.currentCF.position.clone(), new Vec3(x, y, 0.25), new Vec3());
  }
}

const NO_METERS: ReadonlyMap<number, string> = new Map();

// ---------------------------------------------------------------- the waves

/**
 * CTF-Invaders (the waves' map), its open floor on the right (x 27 to 32, y 13 to 18), far enough from the map's edges
 * for the view to keep the scene in its middle (near an edge it stopped there, under the HUD's banners). Cells: x to
 * the right, y up; the crates' spots are tried in order (the first one far enough from the player). The three of the
 * grenade and the horde stand in the middle of it: the player too close is put back at the start (during the card).
 */
const WAVES_PLACES = {
  // (in sight of the middle and 4 cells away: from the left the wall at x 24 to 26 hid it)
  start: [33.5, 17.8] as [number, number],
  walk: [[27.5, 17.5], [31.5, 17.5], [31.5, 14], [27.5, 14]] as [number, number][],
  comers: [[35.5, 17.5], [34.5, 19.5], [23.5, 18.5], [28, 13.5]] as [number, number][],
  crates: [[28.5, 16], [30.5, 17], [27.5, 14.5], [25.5, 17.5], [33.5, 16.5]] as [number, number][],
  middle: [30, 15.5] as [number, number],
};

/** The three of the grenade's lesson: how close together, and how much a blast takes from them (one grenade near them all). */
const GROUP_GAP = 0.32;
const GROUP_DAMAGE = 1.5;
/** The horde around the Bomb's crate: its rings (radius, orbs) and the way left open towards the player. */
const HORDE_RINGS: [number, number][] = [
  [1, 6],
  [1.85, 10],
];
const HORDE_GAP = (100 * Math.PI) / 180;

export class WavesTutorial extends Tutorial {
  private walker: Target | null = null;
  private comers: Target[] = [];
  private group: Target[] = [];
  private horde: Target[] = [];
  constructor(host: TutorialHost) {
    super(host, 'waves');
    const run = host.waves!;
    const me = host.me;
    const alive = (list: Target[]) => list.filter((b) => b.player.isAlive).length;
    const down = (list: Target[]) => list.length > 0 && alive(list) === 0;
    const grenade = mouseIcon('right');
    const molotov = mouseIcon('middle');
    this.steps.push(
      {
        id: 'shoot',
        begin: () => {
          run.scriptWave(1, 1);
          const [x, y] = WAVES_PLACES.walk[0];
          this.walker = this.addTarget(x, y, true);
          if (this.walker) {
            this.walker.player.speedBoost = 0.55;
            this.walker.walk(WAVES_PLACES.walk.map(([px, py]) => new Vec3(px, py, 0)));
          }
        },
        card: {
          title: t('tut.w.intro.title'),
          text: t('tut.w.intro.text'),
          keys: [
            { key: key('W A S D'), does: t('tut.key.move') },
            { key: mouseIcon('left'), does: t('tut.key.shoot') },
          ],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.w.intro.goal'),
        done: () => !!this.walker && !this.walker.player.isAlive,
      },
      {
        id: 'wave',
        begin: () => {
          run.scriptWave(2, 2);
          const at = me.currentCF.position;
          const far = [...WAVES_PLACES.comers].sort((a, b) => Math.hypot(b[0] - at.x, b[1] - at.y) - Math.hypot(a[0] - at.x, a[1] - at.y));
          this.comers = far.slice(0, 2).flatMap(([x, y]) => {
            const b = this.addTarget(x, y, true);
            if (!b) return [];
            b.player.speedBoost = 0.6;
            b.chase = me;
            return [b];
          });
        },
        card: {
          title: t('tut.w.wave.title'),
          text: t('tut.w.wave.text'),
          keys: [],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.w.wave.goal'),
        count: () => ({ n: this.comers.length - alive(this.comers), of: this.comers.length }),
        done: () => down(this.comers),
      },
      {
        id: 'crate',
        begin: () => {
          run.scriptBreak();
          const [x, y] = this.spot(WAVES_PLACES.crates, 2.5);
          run.scriptCrate(x, y, 'permDamage');
        },
        card: {
          title: t('tut.w.crate.title'),
          text: t('tut.w.crate.text'),
          keys: [{ key: mouseIcon('left'), does: t('tut.key.break') }],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.w.crate.goal'),
        done: () => this.powersTaken.has('permDamage'),
      },
      {
        id: 'grenade',
        begin: () => {
          run.scriptWave(3, 3);
          const [cx, cy] = this.stage(3);
          this.group = [0, 1, 2].flatMap((k) => {
            const a = (k * 2 * Math.PI) / 3;
            const b = this.addTarget(cx + Math.cos(a) * GROUP_GAP, cy + Math.sin(a) * GROUP_GAP, true);
            if (!b) return [];
            // Standing still, close together: only what is thrown takes them down
            b.player.hurtOnlyBy = [WEAPON_GRENADE, WEAPON_COCKTAIL_MOLOTOV];
            b.player.damageScale = GROUP_DAMAGE;
            return [b];
          });
          me.nbGrenadeLeft = Math.max(me.nbGrenadeLeft, 2);
          me.nbMolotovLeft = Math.max(me.nbMolotovLeft, 1);
        },
        card: {
          title: t('tut.w.grenade.title'),
          text: t('tut.w.grenade.text'),
          keys: [
            { key: grenade, does: t('tut.key.grenade') },
            { key: molotov, does: t('tut.key.molotov') },
          ],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.w.grenade.goal', { grenade, molotov }),
        count: () => ({ n: this.group.length - alive(this.group), of: this.group.length }),
        // None left and nothing burning or flying: two more grenades and a molotov a moment later
        tick: () => {
          if (!down(this.group)) this.refill(2, 1);
        },
        done: () => down(this.group),
      },
      {
        id: 'weapon',
        begin: () => {
          run.scriptBreak();
          const [x, y] = this.spot(WAVES_PLACES.crates, 2.5);
          run.scriptCrate(x, y, 'weapon');
        },
        card: {
          title: t('tut.w.weapon.title'),
          text: t('tut.w.weapon.text'),
          keys: [{ key: key('F'), does: t('tut.key.take') }],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.w.weapon.goal', { f: key('F') }),
        done: () => this.weaponsTaken.size > 0,
      },
      {
        id: 'bomb',
        begin: () => {
          const [cx, cy] = this.stage(3.6);
          const at = me.currentCF.position;
          const toward = Math.atan2(at.y - cy, at.x - cx);
          for (const [r, n] of HORDE_RINGS) {
            for (let k = 0; k < n; k++) {
              // Around the crate, the side facing the player left open (to shoot the crate, to walk in)
              const a = toward + HORDE_GAP / 2 + ((2 * Math.PI - HORDE_GAP) * k) / (n - 1);
              const x = cx + Math.cos(a) * r;
              const y = cy + Math.sin(a) * r;
              if (!this.host.game.map.cellAt(Math.floor(x), Math.floor(y))?.passable) continue;
              const b = this.addTarget(x, y, true);
              if (!b) continue;
              // Nothing but the Bomb takes them down
              b.player.hurtOnlyBy = [WEAPON_NUCLEAR];
              this.horde.push(b);
            }
          }
          run.scriptWave(4, this.horde.length);
          run.scriptCrate(cx, cy, 'bomb');
        },
        card: {
          title: t('tut.w.bomb.title'),
          text: t('tut.w.bomb.text'),
          keys: [],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.w.bomb.goal'),
        count: () => ({ n: this.horde.length - alive(this.horde), of: this.horde.length }),
        done: () => down(this.horde),
        wait: 2.2,
      },
      {
        id: 'end',
        end: true,
        begin: () => run.scriptBreak(),
        card: {
          title: t('tut.w.end.title'),
          text: t('tut.w.end.text'),
          keys: [],
          buttons: [
            { action: 'play', label: t('tut.w.end.play') },
            { action: 'menu', label: t('waves.menu') },
          ],
        },
        goal: () => t('tut.done'),
        done: () => false,
      },
    );
  }

  protected setup(): void {
    const [x, y] = WAVES_PLACES.start;
    place(this.host.me, x, y);
  }

  /**
   * The middle of the scene (the grenade's three, the horde): the player is put back at the start (during the card)
   * when closer than `room`, or where a wall hides it.
   */
  private stage(room: number): [number, number] {
    const middle = WAVES_PLACES.middle;
    const me = this.host.me;
    if (Math.hypot(me.currentCF.position.x - middle[0], me.currentCF.position.y - middle[1]) < room || !this.inSight(middle)) this.bringBack(WAVES_PLACES.start);
    return middle;
  }
}

// ---------------------------------------------------------------- the shooting range

/**
 * KOTH-Imp's open floor (x 16 to 29, y 2 to 14), at its bottom edge, where the view shows from y 0 to 8.8: the player at
 * the bottom, the weapons in a row in front of him (from the second lesson, Erick: above the cards, which sit low), the
 * lanes above them.
 */
const RANGE = {
  start: [23, 2.8] as [number, number],
  weaponsY: 4.5,
  /** The lanes: their y and the targets' speed (the nearest one slow); they walk from x0 to x1 and back. */
  lanes: [
    { y: 5.7, speed: 0.45 },
    { y: 6.8, speed: 0.62 },
    { y: 7.9, speed: 0.8 },
  ],
  x0: 17.5,
  x1: 28.5,
  /** The grenade's lesson: all of them slowly, from x 21.5 to 24.5 (a throw from the start reaches them all). */
  near: [21.5, 24.5] as [number, number],
};
/** Seconds before a fallen target comes back; how slow the nearest one walks for the knife, and all for the grenade. */
const COME_BACK = 3;
const KNIFE_SPEED = 0.3;
const GRENADE_SPEED = 0.2;
/** The grenades the player gets back for that lesson (a spawn's). */
const GRENADES = 2;
/** A pause this long between hits starts a new burst (its damage and DPS). */
const BURST_GAP = 2;
const KILLS_TO_DO = 3;
const WEAPONS_TO_TAKE = 2;

interface Meter {
  /** The burst: when it began and its last hit (the tutorial's clock), its damage, with which weapon. */
  first: number;
  last: number;
  damage: number;
  weaponID: number;
  /** Damage a second of the burst: its damage over its length plus one shot's delay. */
  dps: number;
}

export class PvpTutorial extends Tutorial {
  /** The targets with their lane, and how long each has been down. */
  private lanes: { bot: Target; lane: number; downFor: number }[] = [];
  private readonly bursts = new Map<number, Meter>();
  /** The lesson that slows the targets down (the knife: the nearest one; the grenade: all of them, near the middle). */
  private lesson: 'knife' | 'grenade' | null = null;

  constructor(host: TutorialHost) {
    super(host, 'pvp');
    const shoot = mouseIcon('left');
    this.steps.push(
      {
        id: 'shoot',
        card: {
          title: t('tut.p.intro.title'),
          text: t('tut.p.intro.text'),
          keys: [
            { key: key('W A S D'), does: t('tut.key.move') },
            { key: shoot, does: t('tut.key.shoot') },
          ],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.p.intro.goal', { n: KILLS_TO_DO }),
        count: () => ({ n: Math.min(KILLS_TO_DO, this.kills), of: KILLS_TO_DO }),
        done: () => this.kills >= KILLS_TO_DO,
      },
      {
        id: 'weapons',
        // Only now on the floor: in front of the player, back at the start, the row above the card
        begin: () => this.layWeapons(),
        card: {
          title: t('tut.p.weapons.title'),
          text: t('tut.p.weapons.text'),
          keys: [{ key: key('F'), does: t('tut.key.take') }],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.p.weapons.goal', { n: WEAPONS_TO_TAKE, f: key('F') }),
        count: () => ({ n: Math.min(WEAPONS_TO_TAKE, this.weaponsTaken.size), of: WEAPONS_TO_TAKE }),
        done: () => this.weaponsTaken.size >= WEAPONS_TO_TAKE,
      },
      {
        id: 'knife',
        // The nearest target slows down: easier to reach
        begin: () => this.teach('knife'),
        card: {
          title: t('tut.p.knife.title'),
          text: t('tut.p.knife.text'),
          keys: [{ key: key(t('hud.space')), does: t('tut.key.knife') }],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.p.knife.goal', { space: key(t('hud.space')) }),
        done: () => this.knifeKills > 0,
      },
      {
        id: 'grenade',
        // The last lesson (Erick): all of them slowly, near the middle; the grenades back whenever they run out
        begin: () => {
          this.teach('grenade');
          this.host.me.nbGrenadeLeft = Math.max(this.host.me.nbGrenadeLeft, GRENADES);
        },
        card: {
          title: t('tut.p.grenade.title'),
          text: t('tut.p.grenade.text'),
          keys: [{ key: mouseIcon('right'), does: t('tut.key.grenade') }],
          buttons: [{ action: 'next', label: t('tut.go') }],
        },
        goal: () => t('tut.p.grenade.goal', { grenade: mouseIcon('right') }),
        tick: () => this.refill(GRENADES, 0),
        done: () => this.grenadeKills > 0,
      },
      {
        id: 'end',
        end: true,
        begin: () => this.teach(null),
        card: {
          title: t('tut.p.end.title'),
          text: t('tut.p.end.text'),
          keys: [],
          buttons: [
            { action: 'play', label: t('tut.p.end.play') },
            { action: 'practice', label: t('tut.p.end.practice') },
            { action: 'menu', label: t('waves.menu') },
          ],
        },
        goal: () => t('tut.practice', { esc: key('Esc') }),
        done: () => false,
      },
    );
  }

  protected setup(): void {
    place(this.host.me, ...RANGE.start);
    RANGE.lanes.forEach((_, lane) => {
      const bot = this.addTarget(RANGE.x0 + Math.random() * (RANGE.x1 - RANGE.x0), RANGE.lanes[lane].y, false);
      if (!bot) return;
      this.lanes.push({ bot, lane, downFor: 0 });
      this.sendOff(bot, lane);
    });
  }

  /** Every weapon on the floor, in a row just in front of the start (the player back there; they stay: clearDrops). */
  private layWeapons(): void {
    const { game, me } = this.host;
    const [x, y] = RANGE.start;
    if (Math.hypot(me.currentCF.position.x - x, me.currentCF.position.y - y) > 1) this.bringBack(RANGE.start);
    const weapons = PRIMARY_WEAPONS.filter((w) => isWeaponEnabled(w));
    weapons.forEach((w, i) => {
      const wx = x + (i - (weapons.length - 1) / 2);
      if (game.spawnProjectile(new Vec3(wx, RANGE.weaponsY, 0.3), new Vec3(), me.playerID, PROJECTILE_DROPED_WEAPON, w)) game.projectiles[game.projectiles.length - 1].duration = Infinity;
    });
  }

  /** A lesson that changes how the targets walk (null: back to their lanes): the standing ones set off again. */
  private teach(lesson: 'knife' | 'grenade' | null): void {
    this.lesson = lesson;
    for (const l of this.lanes) if (l.bot.player.isAlive) this.sendOff(l.bot, l.lane);
  }

  private speedOf(lane: number): number {
    return this.lesson === 'grenade' ? GRENADE_SPEED : this.lesson === 'knife' && lane === 0 ? KNIFE_SPEED : RANGE.lanes[lane].speed;
  }

  /** Where the lanes run now (the grenade's lesson: near the middle). */
  private ends(): [number, number] {
    return this.lesson === 'grenade' ? RANGE.near : [RANGE.x0, RANGE.x1];
  }

  /** Off along its lane, one way or the other. */
  private sendOff(bot: Target, lane: number): void {
    const y = RANGE.lanes[lane].y;
    const [x0, x1] = this.ends();
    bot.player.speedBoost = this.speedOf(lane);
    const ends = [new Vec3(x0, y, 0), new Vec3(x1, y, 0)];
    bot.walk(Math.random() < 0.5 ? ends : ends.reverse());
  }

  /** The fallen targets come back a few seconds later, at an end of their lane. */
  protected override always(): void {
    for (const l of this.lanes) {
      if (l.bot.player.isAlive) {
        l.downFor = 0;
        continue;
      }
      l.downFor += TICK;
      if (l.downFor < COME_BACK) continue;
      l.downFor = 0;
      const [x0, x1] = this.ends();
      this.revive(l.bot, Math.random() < 0.5 ? x0 : x1, RANGE.lanes[l.lane].y);
      this.sendOff(l.bot, l.lane);
    }
  }

  override onEvent(e: GameEvent): void {
    super.onEvent(e);
    if (e.type !== 'hit' || e.fromID !== this.host.me.playerID || !this.targets.has(e.playerID) || e.damage <= 0) return;
    // The burst on this target: a new one after a pause or with another weapon
    let m = this.bursts.get(e.playerID);
    if (!m || m.weaponID !== e.weaponID || this.clock - m.last > BURST_GAP) {
      m = { first: this.clock, last: this.clock, damage: 0, weaponID: e.weaponID, dps: 0 };
      this.bursts.set(e.playerID, m);
    }
    m.damage += e.damage;
    m.last = this.clock;
    const delay = (weaponDefs[e.weaponID]?.fireDelay ?? 0.1) / Math.max(0.1, this.host.me.fireBoost);
    m.dps = m.damage / (m.last - m.first + delay);
  }

  protected override title(): string {
    return t('tut.range');
  }

  /** Under each target: the damage of its last burst and its DPS, in points (100: a bar). */
  protected override meters(): ReadonlyMap<number, string> {
    const out = new Map<number, string>();
    for (const [id, m] of this.bursts) out.set(id, t('tut.meter', { damage: bigNum(Math.round(m.damage * 100)), dps: bigNum(Math.round(m.dps * 100)) }));
    return out;
  }
}

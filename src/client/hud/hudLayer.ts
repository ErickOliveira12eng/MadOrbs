// The in-game HUD, in HTML over the game view: kill feed, clock, scores, chat, minimap, life,
// weapons, names over the orbs, crosshair, death screen, score table and the Esc weapon menu.
// What it shows comes from the original (ClientRender.cpp, GameRender.cpp, GameShowStats.cpp:
// the same data, the same rules for the minimap and the respawn); the layout is new.
//
// Everything is laid out in a stage 900 design pixels high, scaled to the game view. While the
// mouse is captured (pointer lock) the page gets no clicks: the death screen's weapon cards are
// then clicked through clickAt() with the game's own cursor.
import { starsFor, type CampaignLevel } from '../campaign';
import type { FeatKind } from '../../sim/feats';
import { drawMapPreview } from '../mapPreview';
import { adsAllowed, mountAd, refreshAd } from '../ads';
import type { WavesEnd, WavesHud } from '../wavesRun';
import { powerIconUrl } from '../powerIcons';
import { loadMap } from '../../sim/map';
import './hud.css';
import {
  FLAG_DROPPED, FLAG_ON_POD, GAME_BLUE_WIN, GAME_DRAW, GAME_PLAYING, GAME_RED_WIN, GAME_TYPE_CTF, GAME_TYPE_DM,
  PLAYER_TEAM_BLUE, PLAYER_TEAM_RED, PLAYER_TEAM_SPECTATOR, PROJECTILE_DROPED_WEAPON, WEAPON_CHAIN_GUN, WEAPON_COCKTAIL_MOLOTOV, WEAPON_GRENADE, WEAPON_SHOTGUN,
} from '../../sim/constants';
import type { FlagReason } from '../../sim/events';
import type { Game } from '../../sim/game';
import { sv, weaponDefs } from '../../sim/gameVar';
import type { GameMap } from '../../sim/map';
import type { Player, SkinInfo } from '../../sim/player';
import { flagName, modeName, modeOfGameType, teamName } from '../modes';
import { bigNum, capitalize, t, type Key } from '../../i18n';
import type { ViewRect } from '../view';
import { HudArt, type OrbPictureFn } from './hudArt';
import { esc, mouseIcon, pingColor, plain, signalIcon, weaponIcon } from './icons';
import { WeaponPicker } from './weaponPicker';
import { enabledPrimaries, enabledSecondaries, weaponInfo } from './weaponInfo';

const STAGE_H = 900;
const FEED_LIFE = 8;
const CHAT_LIFE = 10; // TimedMessage in the original
const MINIMAP_SIZE = 146;
const RING_C = 2 * Math.PI * 17;
const RESPAWN_C = 2 * Math.PI * 30;

/** A player on the screen, in canvas CSS pixels: the centre of the orb and the top of it. */
export interface ScreenPoint {
  x: number;
  y: number;
  top: number;
}

/** What the HUD reads every frame. */
/** A campaign level as the HUD shows it (ClientGame.campaignHud). */
export interface CampaignHud {
  level: CampaignLevel;
  /** Seconds since the start. */
  seconds: number;
  botsLeft: number;
  botsTotal: number;
  boss: { name: string; life: number } | null;
  /** The red team, the boss first: who is still standing. */
  enemies: { name: string; skin: SkinInfo | null; alive: boolean; boss: boolean; life: number }[];
  /** Won or lost: the end panel is up. */
  over: boolean;
}

/** The end of a campaign level (ClientGame.endCampaign). */
export interface CampaignEnd {
  won: boolean;
  level: CampaignLevel;
  seconds: number;
  stars: number;
  /** The best time before this one, when this one isn't better. */
  best: number | null;
  isBest: boolean;
  hasNext: boolean;
  /** Not signed in: a line on keeping the progress with an account. */
  guest: boolean;
  onAction: (action: 'next' | 'retry' | 'menu') => void;
}

export interface HudFrame {
  /** Game type, team scores, flags. */
  game: Game;
  players: readonly (Player | null)[];
  me: Player;
  online: boolean;
  /** game.gameTimeLeft, seconds. */
  timeLeft: number;
  roundState: number;
  /** Round trip to the server (online). */
  pingMs: number | null;
  /** Cursor in canvas CSS pixels. */
  mouseX: number;
  mouseY: number;
  /** Tab held. */
  showScores: boolean;
  /** A campaign level (offline), else null. */
  campaign: CampaignHud | null;
  /** A run of the waves mode (offline), else null. */
  waves: WavesHud | null;
  /** A private room's warm-up (host: we run the room), else null. */
  warmup: { host: boolean } | null;
  /** The chat line being typed, or null. */
  chatInput: string | null;
  /** Sniper scope opacity: the crosshair fades out behind it. */
  scope: number;
  project: (p: Player) => ScreenPoint | null;
}

/** A kill, or something that happened to a CTF flag. Teams are -1 outside team games. */
type FeedEntry =
  | { kind: 'kill'; killer: string | null; killerTeam: number; killerMe: boolean; victim: string; victimTeam: number; victimMe: boolean; weaponID: number; t: number }
  | { kind: 'flag'; who: string; team: number; me: boolean; good: boolean; reason: FlagReason; flagID: number; t: number };

interface ChatEntry {
  name: string | null;
  text: string;
  t: number;
  /** 'admin': a message from the admin page (src/server/admin.ts). */
  kind?: 'admin';
}

interface DeathInfo {
  killerID: number;
  killerName: string;
  killerSkin: SkinInfo | null;
  weaponID: number;
  suicide: boolean;
  /** How many times this killer got us in this match. */
  count: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${pad2(Math.floor(seconds) % 60)}`;
const rgb = (c: readonly number[]): string => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`;

/** Sets a property only when it changes (the HUD is updated every frame). */
function setText(el: HTMLElement, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}
const htmlCache = new WeakMap<HTMLElement, string>();
function setHTML(el: HTMLElement, s: string): void {
  if (htmlCache.get(el) === s) return;
  htmlCache.set(el, s);
  el.innerHTML = s;
}
/** Shows or hides with the `hidden` attribute (SVG elements have no `hidden` property). */
function show(el: Element, on: boolean): void {
  if (el.hasAttribute('hidden') === on) el.toggleAttribute('hidden', !on);
}
function setStyle(el: HTMLElement | SVGElement, prop: string, v: string): void {
  if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v);
}

/** Players ranked like GameShowStats.cpp: by score, the earlier one first on ties. */
function ranked(players: readonly (Player | null)[]): Player[] {
  return players.filter((p): p is Player => !!p && p.teamID !== PLAYER_TEAM_SPECTATOR).sort((a, b) => b.score - a.score);
}

/** Team colour class of a player in team games ("t0" blue, "t1" red), "" otherwise. */
const teamClass = (game: Game, teamID: number): string => (game.isTeamGame && (teamID === PLAYER_TEAM_BLUE || teamID === PLAYER_TEAM_RED) ? `t${teamID}` : '');

/** The team scores that count: captures in CTF, frags in TDM. */
function teamScores(game: Game): [blue: number, red: number, limit: number] {
  return game.gameType === GAME_TYPE_CTF ? [game.blueWin, game.redWin, sv.sv_winLimit] : [game.blueScore, game.redScore, sv.sv_scoreLimit];
}

export class HudLayer {
  readonly root: HTMLElement;
  readonly picker: WeaponPicker;
  readonly art: HudArt;
  /** Resolves once the weapon pictures are ready. */
  readonly ready: Promise<void>;

  private readonly stage: HTMLElement;
  private readonly r: Record<string, HTMLElement> = {};
  private readonly tagEls: HTMLElement[] = [];
  private view: ViewRect = { x: 0, y: 0, w: 1, h: 1 };
  private k = 1;
  private time = 0;
  private hit = 0;
  private feed: FeedEntry[] = [];
  private chat: ChatEntry[] = [];
  private nemesis = new Map<number, number>();
  private death: DeathInfo | null = null;
  private life = { kills: 0, dmgAtSpawn: 0, start: 0, length: 0 };
  private wasAlive = false;
  private reload: { total: number } | null = null;
  private reloadPrev = 0;
  private roundOverAt: number | null = null;
  private mapName = '';
  private mapSize: [number, number] = [1, 1];
  private walls: HTMLCanvasElement | null = null;
  private isWall: ((x: number, y: number) => boolean) | null = null;
  private deadScreen = false;
  private hovered: HTMLElement | null = null;
  /** The end-of-match map vote (online), with our choice (-1: none yet). */
  private vote: { maps: string[]; counts: number[]; mine: number } | null = null;
  private voting = false;
  private voteHtml = '';
  /** Top views of the maps offered (data URLs; null while loading). */
  private readonly previews = new Map<string, string | null>();
  /** A map card of the vote was clicked. */
  onVote?: (index: number) => void;
  /**
   * Our record of kills in one match before this one (online; null offline, where records don't
   * count): the end of a match says "new personal record" when it is beaten.
   */
  private recordBefore: number | null = null;
  private mineHtml = '';
  /** Kill feat announcements waiting, and the one on screen (until `until`, HUD time). */
  private featQueue: { html: string; dur: number; prio: number; onShow?: () => void }[] = [];
  private featShown: { html: string; until: number } | null = null;
  /** Team modes: names take their team's colour. */
  private teamGame = false;
  /** The banner on the right (death screen, Esc menu): showing now, and when it was loaded (HUD time, -1: not yet). */
  private sideAdOn = false;
  private sideAdAt = -1;

  constructor(
    private readonly container: HTMLElement,
    opts: { orbPicture?: OrbPictureFn; online: boolean },
  ) {
    this.art = new HudArt(opts.orbPicture);
    this.root = document.createElement('div');
    this.root.className = 'mo-hud';
    this.stage = document.createElement('div');
    this.stage.className = 'h-stage';
    this.stage.innerHTML = this.template(opts.online);
    this.root.appendChild(this.stage);
    container.appendChild(this.root);
    for (const el of this.stage.querySelectorAll<HTMLElement>('[data-r]')) this.r[el.dataset.r!] = el;
    this.picker = new WeaponPicker(this.stage, this.art);
    this.picker.canSpectate = !opts.online;
    this.ready = this.art.load().then(() => {
      for (const [key, name] of [['grenImg', 'grenade'], ['moloImg', 'molotov']] as const) {
        const url = this.art.icon(name);
        const img = this.r[key] as HTMLImageElement;
        if (url) img.src = url;
        else img.hidden = true;
      }
      if (this.picker.visible) this.picker.render();
    });
    this.r.chips.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.h-chip');
      if (b) this.picker.select(b.dataset.slot as 'primary' | 'secondary', Number(b.dataset.id));
    });
    this.r.vote.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.h-vcard');
      if (b) this.onVote?.(Number(b.dataset.i));
    });
  }

  private template(online: boolean): string {
    return `
<div class="h-tags" data-r="tags"></div>
<div class="h-kring" data-r="kring" hidden></div>
<span class="h-tag killer" data-r="ktag" hidden></span>
<svg class="h-xhair" data-r="xhair" viewBox="-28 -28 56 56" aria-hidden="true">
  <circle data-r="reload" r="21" fill="none" stroke="#9dffb0" stroke-width="3" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 21} ${2 * Math.PI * 21}" transform="rotate(-90)" opacity=".9"/>
  <g stroke="#000" stroke-opacity=".55" stroke-width="4.5" stroke-linecap="round" fill="none"><circle r="8"/><path d="M0 -17V-12M0 12V17M-17 0H-12M12 0H17"/></g>
  <g stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"><circle r="8"/><path d="M0 -17V-12M0 12V17M-17 0H-12M12 0H17"/></g>
  <g data-r="hitmark" stroke="#ff4d4d" stroke-width="3" stroke-linecap="round" opacity="0"><path d="M6 6L11 11M-6 6L-11 11M6 -6L11 -11M-6 -6L-11 -11"/></g>
</svg>
<svg class="h-arrow" data-r="arrow" viewBox="0 0 22 28" aria-hidden="true" hidden><path d="M2 2L2 23L7.5 17.5L11.5 26L15 24.4L11.2 16.2L19 16.2Z" fill="#fff" stroke="#0b1020" stroke-width="2" stroke-linejoin="round"/></svg>

<div class="h-abs h-feed" data-r="feed"></div>
<div class="h-abs h-match" data-r="match"></div>
<div class="h-abs h-carry" data-r="carry" hidden></div>
<div class="h-abs h-panel h-board" data-r="board"></div>

<div class="h-abs h-chat" data-r="chat"></div>
<div class="h-abs h-panel h-minimap" data-r="minimap"><canvas data-r="mini"></canvas></div>
<div class="h-abs h-pickhint" data-r="pickHint" hidden></div>
<div class="h-abs h-panel h-health" data-r="health">
  <svg class="plus" viewBox="0 0 24 24" aria-hidden="true"><rect data-r="plus" x="1" y="1" width="22" height="22" rx="7" fill="#47b800"/><path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>
  <b class="h-hp" data-r="hp"></b>
  <div class="h-hpcol"><span class="h-label">${t('hud.health')}</span><div class="h-hpbar"><i data-r="hpbar"></i><span class="tk" style="left:25%"></span><span class="tk" style="left:50%"></span><span class="tk" style="left:75%"></span></div></div>
</div>
<div class="h-abs h-weapons" data-r="weapons">
  <div class="h-panel h-wbox"><div class="h-wtop"><span data-r="wicon"></span><span class="h-wextra" data-r="wextra"></span></div><div class="name" data-r="wname"></div></div>
  <div class="h-panel h-slot" data-r="sec">
    <div class="h-cd"><svg class="ring" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="17" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3"/><circle data-r="secRing" cx="19" cy="19" r="17" fill="none" stroke="#7aa2ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="0"/></svg><span data-r="secIcon"></span></div>
    <span class="h-key">${t('hud.space')}</span>
  </div>
  <div class="h-panel h-slot" data-r="gren"><img data-r="grenImg" alt="${t('hud.grenades')}"><div class="cnt"><span data-r="grenN"></span>${mouseIcon('right')}</div><i class="h-cool" data-r="grenCool" hidden></i></div>
  <div class="h-panel h-slot" data-r="molo"><img data-r="moloImg" alt="Molotov"><div class="cnt"><span data-r="moloN"></span>${mouseIcon('middle')}</div><i class="h-cool" data-r="moloCool" hidden></i></div>
</div>
<div class="h-abs h-panel h-spec" data-r="spec" hidden>${t('hud.spectating')} <span>${t('hud.specHint')}</span></div>

<div class="h-abs h-panel h-dead" data-r="deadCard" hidden></div>
<div class="h-abs h-panel h-respawn" data-r="respawn" hidden></div>
<div class="h-abs h-panel h-next" data-r="next" hidden>
  <div class="h-nhead"><span class="h-label">${t('hud.nextLife')}</span><span class="hint">${t('hud.nextHint', { esc: '<span class="h-key">Esc</span>' })}</span></div>
  <div class="h-chips" data-r="chips"></div>
</div>

<div class="h-abs h-feat" data-r="feat" hidden></div>
<div class="h-abs h-campend" data-r="campend" hidden><div class="h-campcard" data-r="campcard"></div><div class="h-campad" data-r="campad" hidden><span>${t('ads.label')}</span><div></div></div></div>
<div class="h-abs h-sidead" data-r="sidead" hidden><span>${t('ads.label')}</span><div></div></div>
<div class="h-abs h-banner" data-r="banner" hidden></div>
<div class="h-abs h-endside" data-r="endside" hidden>
  <div class="h-panel h-mine" data-r="mine"></div>
  <div class="h-panel h-vote" data-r="vote" hidden></div>
</div>
<div class="h-abs h-panel h-scores" data-r="scores" hidden>
  <div class="h-thead"><div><h2>${t('table.title')}</h2><p data-r="tsub"></p></div><div class="h-tclock" data-r="tclock"></div></div>
  <table class="h-table"><thead data-r="thead"></thead><tbody data-r="table"></tbody></table>
  <div class="h-tfoot" data-r="tfoot"></div>
</div>`;
  }

  // ---------------------------------------------------------------- setup

  /** The game view in the canvas (CSS pixels): the HUD covers it and scales with its height. */
  setView(view: ViewRect): void {
    this.view = view;
    this.k = view.h / STAGE_H;
    const s = this.root.style;
    s.left = `${view.x}px`;
    s.top = `${view.y}px`;
    s.width = `${view.w}px`;
    s.height = `${view.h}px`;
    this.stage.style.width = `${view.w / this.k}px`;
    this.stage.style.transform = `scale(${this.k})`;
    // Things kept at their real size whatever the scale (the banner at the end of a campaign level)
    this.stage.style.setProperty('--hud-k', String(this.k));
    this.sizeMinimap();
  }

  /** A new map: its name and the minimap walls (Map::regenTex). */
  setMap(map: GameMap): void {
    this.mapName = map.name;
    this.picker.mapName = map.name;
    this.mapSize = [map.size[0], map.size[1]];
    this.isWall = (x, y) => !map.cells[y * map.size[0] + x]?.passable;
    this.sizeMinimap();
  }

  /** Scores and grudges start over (map change). */
  resetMatch(): void {
    this.feed = [];
    this.nemesis.clear();
    this.death = null;
  }

  private sizeMinimap(): void {
    const cv = this.r.mini as HTMLCanvasElement;
    const px = Math.max(16, Math.round(MINIMAP_SIZE * this.k * (window.devicePixelRatio || 1)));
    cv.width = cv.height = px;
    if (!this.isWall) return;
    // Walls in white at 50%, like the original minimap texture
    const [w, h] = this.mapSize;
    const cell = px / Math.max(w, h);
    const ox = (px - w * cell) / 2;
    const oy = (px - h * cell) / 2;
    const walls = document.createElement('canvas');
    walls.width = walls.height = px;
    const ctx = walls.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(ox, oy, w * cell, h * cell);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (this.isWall(x, y)) ctx.fillRect(ox + x * cell, oy + (h - 1 - y) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    this.walls = walls;
  }

  // ---------------------------------------------------------------- events

  /** A death (Player::hit): the kill feed, our grudges and the stats of our life. */
  kill(killer: Player | null, victim: Player, weaponID: number, me: Player): void {
    const other = killer && killer !== victim ? killer : null;
    const team = (p: Player | null): number => (p && p.game.isTeamGame ? p.teamID : -1);
    this.feed.push({
      kind: 'kill',
      killer: other ? other.name : null,
      killerTeam: team(other),
      killerMe: other === me,
      victim: victim.name,
      victimTeam: team(victim),
      victimMe: victim === me,
      weaponID,
      t: this.time,
    });
    if (this.feed.length > 5) this.feed.shift();
    if (victim === me) {
      let count = 0;
      if (other) {
        count = (this.nemesis.get(other.playerID) ?? 0) + 1;
        this.nemesis.set(other.playerID, count);
      }
      this.death = {
        killerID: other ? other.playerID : -1,
        killerName: other ? other.name : me.name,
        killerSkin: other ? other.displaySkin : null,
        weaponID,
        suicide: !other,
        count,
      };
    } else if (other === me) {
      this.life.kills++;
    }
  }

  /** CTF (ClientRecv NET_SVCL_CHANGE_FLAG_STATE): "Fulano pegou a bandeira vermelha" in the feed. */
  flagEvent(reason: FlagReason, flagID: number, player: Player | null, me: Player): void {
    this.feed.push({
      kind: 'flag',
      who: player ? (player === me ? t('feed.you') : player.name) : t('feed.someone'),
      team: player ? player.teamID : -1,
      me: player === me,
      // Good news for our team: we took, returned or captured, or they dropped it
      good: !!player && (player.teamID === me.teamID) === (reason !== 'dropped'),
      reason,
      flagID,
      t: this.time,
    });
    if (this.feed.length > 5) this.feed.shift();
  }

  /** The game type: the weapon menu's header says which mode this is. */
  setGameType(gameType: number): void {
    this.picker.modeName = modeName(modeOfGameType(gameType));
    this.teamGame = modeOfGameType(gameType) !== 'dm';
  }

  /** A chat line; `name` null for the server's own messages; `kind` 'admin' stands out. */
  addChat(name: string | null, text: string, kind?: 'admin'): void {
    this.chat.push({ name, text: plain(text), t: this.time, kind });
    if (this.chat.length > 6) this.chat.shift();
  }

  /** Client::hitIndicator: our shot hit someone. */
  hitMarker(): void {
    this.hit = 1;
  }

  /**
   * A click with the game's cursor while the mouse is captured (canvas CSS pixels). Returns true
   * when it pressed a card of the death screen (the click must not respawn us then).
   */
  clickAt(x: number, y: number): boolean {
    const el = this.cardAt(x, y);
    if (!el) return false;
    el.click();
    return true;
  }

  private cardAt(x: number, y: number): HTMLElement | null {
    // The death screen's weapon cards, or the map vote's cards
    const selector = this.deadScreen ? '.h-chip' : this.voting ? '.h-vcard' : null;
    if (!selector) return null;
    const rect = this.container.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + x, rect.top + y);
    return hit ? (hit.closest(selector) as HTMLElement | null) : null;
  }

  /**
   * A kill feat (src/sim/feats.ts) to announce at the top of the screen: its name, who made it below
   * (avatar and name) and a line about it. Several in a row wait in a queue.
   */
  announce(kind: FeatKind, who: Player | null, victim: Player | null, n?: number, onShow?: () => void): void {
    const style = FEAT_STYLE[kind];
    const name = who ? `<span class="who">${this.avatar(who.displaySkin)}<b class="${this.teamGame ? `t${who.teamID}` : ''}">${esc(who.name)}</b></span>` : '';
    const v = victim ? esc(victim.name) : '';
    const sub =
      kind === 'missionFailed'
        ? victim && victim !== who
          ? t('feat.subMissionFailedBy', { name: v, n: n ?? 0 })
          : t('feat.subMissionFailed', { n: n ?? 0 })
        : kind === 'revenge'
          ? t('feat.subRevenge', { victim: v })
          : kind === 'firstBlood'
            ? t('feat.subFirstBlood')
            : style.streak && n
              ? t('feat.subStreak', { n })
              : '';
    const html =
      `<div class="ft" style="--c1:${style.c1};--c2:${style.c2};--glow:${style.glow}">${t(`feat.${kind}` as const)}</div>` +
      name +
      (sub ? `<div class="fs">${sub}</div>` : '');
    if (this.featQueue.length >= 4) {
      // Too many at once: the least important waiting one goes
      let low = 0;
      for (let i = 1; i < this.featQueue.length; i++) if (this.featQueue[i].prio < this.featQueue[low].prio) low = i;
      if (this.featQueue[low].prio > style.prio) return;
      this.featQueue.splice(low, 1);
    }
    this.featQueue.push({ html, dur: style.dur, prio: style.prio, onShow });
  }

  /**
   * One announcement at a time, each with its voice. `visible`: false while the score table or the
   * menu covers the top: the queue goes on (the voices keep their timing), the banner just isn't shown.
   */
  private updateFeat(playing: boolean, visible: boolean): void {
    if (!playing) {
      this.featQueue = [];
      this.featShown = null;
      show(this.r.feat, false);
      return;
    }
    if (this.featShown && this.time >= this.featShown.until) this.featShown = null;
    if (!this.featShown && this.featQueue.length) {
      const next = this.featQueue.shift()!;
      this.featShown = { html: next.html, until: this.time + next.dur };
      next.onShow?.();
      // A new element each time: its entrance animation plays again
      setHTML(this.r.feat, `<div class="fbox">${next.html}</div>`);
    }
    show(this.r.feat, visible && !!this.featShown);
  }

  /** The campaign's header: the clock, the stars still possible, the bots left, the boss's life. */
  private updateCampaignHeader(c: CampaignHud): void {
    const l = c.level;
    const now = starsFor(l, c.seconds);
    const stars = [1, 2, 3].map((i) => `<i class="${i <= now ? 'on' : ''}">★</i>`).join('');
    const next = now === 3 ? l.stars3 : now === 2 ? l.stars2 : 0;
    let html =
      `<div class="h-clock">${clock(c.seconds)}</div>` +
      `<div class="h-mode">${(l.boss ? t('campaign.bossTitle', { c: l.chapter.n }) : t('campaign.levelTitle', { c: l.chapter.n, n: l.n }))} · ${t(`w.${l.chapter.weaponKey}.name` as const)}</div>` +
      `<div class="h-camp"><span class="stars">${stars}</span>${next ? `<span>${t('campaign.until', { time: clock(next) })}</span>` : ''}</div>`;
    if (c.boss) {
      html += `<div class="h-boss"><b>${esc(c.boss.name)}</b><span><i style="width:${Math.round(Math.max(0, c.boss.life) * 100)}%"></i></span></div>`;
    }
    setHTML(this.r.match, html);
  }

  private campEndKeys: ((e: KeyboardEvent) => void) | null = null;
  /** The end of a campaign level: the system's cursor, no crosshair. */
  private cursorFree = false;

  /**
   * A campaign level starts: the banner of its end is loaded now, in its place under the (still
   * invisible) panel, so it is there when the level ends. Moving an ad's frame would load it again.
   */
  preloadCampaignAd(): void {
    const ad = this.r.campad;
    if (!mountAd(ad.lastElementChild as HTMLElement, 'wide')) return;
    ad.hidden = false;
    this.r.campend.classList.add('preload');
    show(this.r.campend, true);
  }

  /** The end of a campaign level: won (stars, time) or lost, and what to do next. */
  showCampaignEnd(e: CampaignEnd): void {
    const l = e.level;
    const title = `${(l.boss ? t('campaign.bossTitle', { c: l.chapter.n }) : t('campaign.levelTitle', { c: l.chapter.n, n: l.n }))} · ${t(`w.${l.chapter.weaponKey}.name` as const)}`;
    const stars = [1, 2, 3].map((i) => `<i class="${i <= e.stars ? 'on' : ''}">★</i>`).join('');
    const body = e.won
      ? `<div class="stars">${stars}</div><div class="time">${t('campaign.time', { time: clock(e.seconds) })}</div>` +
        (e.isBest ? `<div class="best new">${t('campaign.newBest')}</div>` : e.best ? `<div class="best">${t('campaign.best', { time: clock(e.best) })}</div>` : '') +
        `<div class="thr">${t('campaign.thresholds', { three: clock(l.stars3), two: clock(l.stars2) })}</div>` +
        (e.guest ? `<div class="save">${t('campaign.saveHint')}</div>` : '')
      : `<div class="sub">${t('campaign.lostText')}</div>`;
    // A breath before going on (next level, again): the buttons count down; the levels window at once
    const wait = `<span class="wait">${CAMPAIGN_NEXT_WAIT}</span>`;
    const buttons =
      `<button type="button" data-a="menu"><span class="h-key">Esc</span>${t('campaign.menu')}</button>` +
      (e.won && e.hasNext
        ? `<button type="button" data-a="retry" disabled><span class="h-key">R</span>${t('campaign.retry')}</button><button type="button" class="primary" data-a="next" disabled><span class="h-key">Enter</span>${t('campaign.next')}${wait}</button>`
        : `<button type="button" class="primary" data-a="retry" disabled><span class="h-key">Enter</span>${t(e.won ? 'campaign.retry' : 'campaign.tryAgain')}${wait}</button>`);
    this.openEndPanel(
      `<div class="t ${e.won ? 'won' : 'lost'}">${t(e.won ? 'campaign.won' : 'campaign.lost')}</div><div class="lvl">${title}</div>${body}<div class="btns">${buttons}</div>`,
      e.won && e.hasNext ? 'next' : 'retry',
      (a) => e.onAction(a as 'next' | 'retry' | 'menu'),
    );
  }

  /** The end of a waves run: the wave reached, the kills, the record; play again or the menu. */
  showWavesEnd(e: WavesEnd & { onAction: (action: 'retry' | 'menu') => void }): void {
    const kills = t(e.kills === 1 ? 'end.oneKill' : 'end.kills', { n: e.kills });
    const body =
      `<div class="wave-reached"><span>${t('waves.label')}</span><b>${e.wave}</b></div>` +
      `<div class="time">${kills} · ${clock(e.seconds)}</div>` +
      (e.isBest ? `<div class="best new">${t('waves.newBest')}</div>` : e.best ? `<div class="best">${t('waves.record', { n: e.best.wave })}</div>` : '');
    const wait = `<span class="wait">${CAMPAIGN_NEXT_WAIT}</span>`;
    const buttons =
      `<button type="button" data-a="menu"><span class="h-key">Esc</span>${t('waves.menu')}</button>` +
      `<button type="button" class="primary" data-a="retry" disabled><span class="h-key">Enter</span>${t('waves.retry')}${wait}</button>`;
    this.openEndPanel(
      `<div class="t lost">${t('waves.over')}</div><div class="lvl">${t('waves.reached', { n: e.wave })}</div>${body}<div class="btns">${buttons}</div>`,
      'retry',
      (a) => e.onAction(a === 'menu' ? 'menu' : 'retry'),
    );
  }

  /**
   * The end panel (a campaign level, a waves run): its card, the banner under it, the buttons that
   * wait CAMPAIGN_NEXT_WAIT seconds (all but the menu), the keys (Enter: `primary`, R: again, Esc: menu)
   * and the system's cursor.
   */
  private openEndPanel(card: string, primary: string, onAction: (action: string) => void): void {
    const waitUntil = performance.now() + CAMPAIGN_NEXT_WAIT * 1000;
    setHTML(this.r.campcard, card);
    this.r.campend.classList.remove('preload');
    show(this.r.campend, true);
    // The banner under the panel: loaded when the level started (preloadCampaignAd), or now
    const ad = this.r.campad;
    if (ad.hidden && mountAd(ad.lastElementChild as HTMLElement, 'wide')) ad.hidden = false;
    const waiting = [...this.r.campcard.querySelectorAll<HTMLButtonElement>('button:disabled')];
    const count = this.r.campcard.querySelector<HTMLElement>('.wait');
    const tick = () => {
      const left = Math.ceil((waitUntil - performance.now()) / 1000);
      if (left > 0) {
        if (count) count.textContent = String(left);
        setTimeout(tick, 100);
      } else {
        count?.remove();
        for (const b of waiting) b.disabled = false;
      }
    };
    tick();
    // The system's cursor instead of the game's
    this.cursorFree = true;
    this.root.classList.add('free-cursor');
    const act = (a: string) => {
      if (a !== 'menu' && performance.now() < waitUntil) return;
      if (this.campEndKeys) window.removeEventListener('keydown', this.campEndKeys, true);
      this.campEndKeys = null;
      onAction(a);
    };
    this.r.campend.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (b) act(b.dataset.a!);
    };
    this.campEndKeys = (ev: KeyboardEvent) => {
      const a = ev.code === 'Enter' || ev.code === 'NumpadEnter' ? primary : ev.code === 'KeyR' ? 'retry' : ev.code === 'Escape' ? 'menu' : null;
      if (!a) return;
      ev.preventDefault();
      ev.stopPropagation();
      act(a);
    };
    // A moment before the keys work: the shot or key that ended the level must not skip the panel
    setTimeout(() => {
      if (this.campEndKeys) window.addEventListener('keydown', this.campEndKeys, true);
    }, 600);
  }

  /** A line in the big banner at the top (the waves: a wave starts, is cleared, a power-up taken). */
  announceText(title: string, sub: string, color: { c1: string; c2: string; glow: string }, dur = 2.2, onShow?: () => void): void {
    const html = `<div class="ft" style="--c1:${color.c1};--c2:${color.c2};--glow:${color.glow}">${esc(title)}</div>` + (sub ? `<div class="fs">${esc(sub)}</div>` : '');
    if (this.featQueue.length >= 4) this.featQueue.shift();
    this.featQueue.push({ html, dur, prio: 9, onShow });
  }

  /** The waves' header: the wave, what is going on (the break's countdown, the enemies left), the lives, the power-ups on. */
  private updateWavesHeader(w: WavesHud): void {
    const hearts = '♥'.repeat(Math.min(6, Math.max(0, w.lives))) + (w.lives > 6 ? `+${w.lives - 6}` : '');
    const doing =
      w.phase === 'break'
        ? t('waves.nextIn', { s: Math.ceil(w.breakLeft) })
        : `${w.left === 1 ? t('waves.leftOne') : t('waves.left', { n: w.left })} · ${t('waves.nextIn', { s: Math.ceil(w.waveLeft) })}`;
    const powers = w.powers.length
      ? `<span class="h-powers">` +
        w.powers.map((p) => `<span title="${t(`power.${p.kind}` as Key)}"><img src="${powerIconUrl(p.kind)}" alt="" /><i style="width:${Math.round((p.left / 15) * 100)}%"></i></span>`).join('') +
        `</span>`
      : '';
    let html =
      `<div class="h-wave"><span>${t('waves.label')}</span><b>${w.wave}</b></div>` +
      `<div class="h-mode">${doing}</div>` +
      `<div class="h-camp"><span class="hearts" title="${t('waves.lives')}">${hearts || '—'}</span><span>${t(w.kills === 1 ? 'end.oneKill' : 'end.kills', { n: w.kills })}</span>${powers}</div>`;
    if (w.bossLife) html += `<div class="h-boss"><b>${esc(w.bossLife.name)}</b><span><i style="width:${Math.round(Math.max(0, w.bossLife.life) * 100)}%"></i></span></div>`;
    setHTML(this.r.match, html);
  }

  /** The waves' corner panel: the enemies of the wave still to beat, the record. */
  private updateWavesBoard(w: WavesHud): void {
    let html = `<div class="h-bhead"><span class="h-label">${t('campaign.enemies')}</span><span class="sp"></span></div>`;
    html +=
      w.phase === 'fight'
        ? `<div class="h-ecount"><b>${w.left}</b><span>/ ${w.total}</span><small>${t('waves.toBeat')}</small></div>`
        : `<div class="h-wbreak">${t('waves.breakHint')}</div>`;
    // The permanent power-ups taken: +10% a level (poison and ice: their level)
    if (w.perms.length)
      html +=
        `<div class="h-perms"><span class="h-label">${t('waves.upgrades')}</span><div>` +
        w.perms
          .map((p) => `<span title="${t(`power.${p.kind}` as Key)}"><img src="${powerIconUrl(p.kind)}" alt="" /><b>${p.kind === 'poison' || p.kind === 'ice' ? `×${p.level}` : `+${p.level * 10}%`}</b></span>`)
          .join('') +
        `</div></div>`;
    if (w.record) html += `<div class="h-wrec">${t('waves.record', { n: w.record })}</div>`;
    setHTML(this.r.board, html);
  }

  /** Our record before this match (online), or null (offline: no record). */
  setRecord(kills: number | null): void {
    this.recordBefore = kills;
  }

  /** End of a match, "Your match": our kills (a new personal record?), longest streak and deaths. */
  private updateMine(f: HudFrame): void {
    const me = f.me;
    const before = this.recordBefore;
    // Like the account's stats: a match counts after 30 s played
    const isRecord = before !== null && me.kills > before && me.kills > 0 && me.timePlayedCurGame >= 30;
    const kills = t(me.kills === 1 ? 'end.oneKill' : 'end.kills', { n: me.kills });
    const head = isRecord
      ? `<div class="rec"><span>${t('end.newRecord')}</span><b>${kills}</b></div>`
      : `<div class="kills"><b>${kills}</b>${before ? `<small>${t('end.record', { n: before })}</small>` : ''}</div>`;
    const html =
      `<span class="h-label">${t('end.title')}</span>${head}` +
      `<div class="row"><span>${t('end.bestStreak')}</span><b>${me.feats.bestStreak}</b></div>` +
      `<div class="row"><span>${t('table.deaths')}</span><b>${me.deaths}</b></div>`;
    if (html !== this.mineHtml) {
      this.mineHtml = html;
      setHTML(this.r.mine, html);
    }
  }

  /** The map vote opened, its counts changed, or it closed (null). */
  setVote(vote: { maps: string[]; counts: number[]; mine: number } | null): void {
    this.vote = vote;
  }

  // ---------------------------------------------------------------- every frame

  update(dt: number, f: HudFrame): void {
    this.time += dt;
    this.hit = Math.max(0, this.hit - dt);
    const me = f.me;
    const alive = me.isAlive;
    if (alive && !this.wasAlive) {
      this.death = null;
      this.life = { kills: 0, dmgAtSpawn: me.dmg, start: this.time, length: 0 };
      this.picker.joined = true;
    } else if (!alive && this.wasAlive) {
      this.life.length = this.time - this.life.start;
    }
    this.wasAlive = alive;

    const playing = f.roundState === GAME_PLAYING;
    if (playing) this.roundOverAt = null;
    else this.roundOverAt ??= this.time;
    const spectator = me.teamID === PLAYER_TEAM_SPECTATOR;
    if (spectator) this.death = null; // back from watching: no old death card
    if (this.picker.spectating !== spectator) {
      this.picker.spectating = spectator;
      if (this.picker.visible) this.picker.render();
    }
    const menu = this.picker.visible;
    const table = !menu && (f.showScores || !playing);
    // The campaign has no respawn: its end panel instead of the death screen
    const deadScreen = !menu && !table && playing && !alive && !spectator && !f.campaign && !f.waves?.over;
    const liveHud = !menu && !table && alive && !spectator;
    this.deadScreen = deadScreen;

    const r = this.r;
    show(r.feed, !menu && !table);
    show(r.match, !menu && !table);
    show(r.board, !menu && !table);
    show(r.chat, !menu && !table);
    show(r.minimap, !menu && !table && !deadScreen);
    show(r.health, liveHud);
    show(r.weapons, liveHud);
    show(r.spec, !menu && !table && spectator);
    show(r.tags, !menu && !table && !deadScreen);
    show(r.deadCard, deadScreen && !!this.death);
    show(r.respawn, deadScreen);
    // The waves: the same weapons at every spawn, no choice
    show(r.next, deadScreen && enabledPrimaries().length > 0 && !f.waves);
    show(r.scores, table);
    show(r.banner, !menu && !playing);
    this.updateFeat(playing, !menu && !table && !f.campaign?.over && !f.waves?.over);
    // End of a match: our summary, then the map vote, beside the score table
    const endSide = !menu && !playing;
    this.voting = endSide && !!this.vote;
    show(r.endside, endSide);
    show(r.vote, this.voting);
    r.scores.classList.toggle('voting', endSide);
    if (endSide) this.updateMine(f);
    if (this.voting) this.updateVote(f);
    const carrying = liveHud && f.game.gameType === GAME_TYPE_CTF && f.game.carriedFlag(me) >= 0;
    show(r.carry, carrying);
    if (carrying) this.updateCarry(f);

    if (!menu && !table) {
      this.updateFeed();
      this.updateMatch(f);
      this.updateBoard(f);
      this.updateChat(f, deadScreen);
    }
    if (!menu && !table && !deadScreen) this.updateTags(f);
    if (!menu && !table && !deadScreen) this.drawMinimap(f);
    if (liveHud) {
      this.updateHealth(me);
      this.updateWeapons(me);
    }
    this.updatePickHint(f, liveHud);
    if (deadScreen) this.updateDeath(f);
    this.updateKiller(f, deadScreen);
    if (table) this.updateTable(f, playing);
    if (!menu && !playing) this.updateBanner(f);
    this.updateCursors(f, !menu && alive && !spectator, !menu && deadScreen);
    // A banner on the right, every mode but the campaign: on the death screen and in the Esc menu
    this.updateSideAd(!f.campaign && !f.waves?.over && (menu || deadScreen), menu);
  }

  /**
   * The side banner (300x250, src/client/ads.ts: only where ads are allowed). One frame for the
   * death screen and the Esc menu, loaded again when it shows after SIDE_AD_REFRESH seconds, not at
   * every death. In the menu the weapon cards move left to make room.
   */
  private updateSideAd(want: boolean, menu: boolean): void {
    const host = this.r.sidead.lastElementChild as HTMLElement;
    let on = want && adsAllowed();
    if (on && !this.sideAdOn) {
      // Loaded at the start of the match (preloadSideAd); a new ad after a while, swapped in once loaded
      if (!host.firstChild) {
        if (mountAd(host, 'rect')) this.sideAdAt = this.time;
        else on = false;
      } else if (this.time - this.sideAdAt > SIDE_AD_REFRESH) {
        refreshAd(host, 'rect');
        this.sideAdAt = this.time;
      }
    }
    if (on !== this.sideAdOn) {
      this.sideAdOn = on;
      // Off: kept laid out but unseen while it has an ad, so it is ready for the next time
      this.r.sidead.classList.toggle('preload', !on);
      show(this.r.sidead, on || (!!host.firstChild && adsAllowed()));
    }
    this.picker.el.classList.toggle('with-ad', on && menu);
  }

  /** A match starts: the side banner loads now, unseen, so the first death or Esc shows it ready. */
  preloadSideAd(): void {
    const host = this.r.sidead.lastElementChild as HTMLElement;
    if (!mountAd(host, 'rect')) return;
    this.sideAdAt = this.time;
    this.r.sidead.classList.add('preload');
    show(this.r.sidead, true);
  }

  /** "F · Take the shotgun": over a weapon on the floor (the game takes it within half a cell). */
  private pickHintFor = -1;
  private updatePickHint(f: HudFrame, live: boolean): void {
    let id = -1;
    if (live) {
      const pos = f.me.currentCF.position;
      for (const p of f.game.projectiles) {
        if (p.projectileType !== PROJECTILE_DROPED_WEAPON || p.needToBeDeleted) continue;
        if (Math.hypot(p.currentCF.position.x - pos.x, p.currentCF.position.y - pos.y) <= 0.5) {
          id = p.weaponID;
          break;
        }
      }
    }
    if (id === this.pickHintFor) return;
    this.pickHintFor = id;
    if (id >= 0) setHTML(this.r.pickHint, `<span class="h-key">F</span>${t('hud.pickup', { weapon: weaponInfo(id).name })}`);
    show(this.r.pickHint, id >= 0);
  }

  private toStage(x: number, y: number): [number, number] {
    return [(x - this.view.x) / this.k, (y - this.view.y) / this.k];
  }

  private avatar(skin: SkinInfo | null): string {
    const url = skin ? this.art.orb(skin) : undefined;
    if (url) return `<img src="${url}" alt="">`;
    return `<span class="h-av" style="--av:${skin ? rgb(skin.greenDecal) : '#6b7bd6'}"></span>`;
  }

  // ---------------------------------------------------------------- top

  private flagImg(flagID: number): string {
    const url = this.art.icon(flagID === 0 ? 'blueFlag' : 'redFlag');
    return url ? `<img class="flag" src="${url}" alt="">` : `<i class="h-fdot t${flagID}"></i>`;
  }

  private updateFeed(): void {
    this.feed = this.feed.filter((e) => this.time - e.t < FEED_LIFE);
    const html = this.feed
      .map((e) => {
        const age = this.time - e.t;
        const aged = [age > FEED_LIFE - 3 ? 'old' : '', age > FEED_LIFE - 0.6 ? 'fade' : ''].join(' ');
        const name = (text: string, team: number, me: boolean): string => `<span class="${[me ? 'me' : '', team >= 0 ? `t${team}` : ''].join(' ')}">${esc(text)}</span>`;
        if (e.kind === 'flag') {
          // Good news for our team in gold, bad news in red
          const tone = e.good ? 'mine' : 'died';
          const line = t(`feed.${e.reason}${e.me ? '.me' : ''}` as Key, { who: name(e.who, e.team, e.me), flag: flagName(e.flagID) });
          return `<div class="h-frow flagev ${tone} ${aged}">${this.flagImg(e.flagID)}${line}</div>`;
        }
        const cls = [e.killerMe ? 'mine' : e.victimMe ? 'died' : '', aged].join(' ');
        const killer = e.killer !== null ? name(e.killer, e.killerTeam, e.killerMe) : '';
        return `<div class="h-frow ${cls}">${killer}${weaponIcon(this.art, e.weaponID, 'white')}${name(e.victim, e.victimTeam, e.victimMe)}</div>`;
      })
      .join('');
    setHTML(this.r.feed, html);
  }

  /** The clock and the mode, with the team scores (and the flags in CTF) around it in team games. */
  private updateMatch(f: HudFrame): void {
    if (f.campaign) {
      this.updateCampaignHeader(f.campaign);
      return;
    }
    if (f.waves) {
      this.updateWavesHeader(f.waves);
      return;
    }
    const g = f.game;
    const time = sv.sv_gameTimeLimit > 0 ? `<div class="h-clock">${clock(f.timeLeft + 1)}</div>` : '';
    const mode = modeName(modeOfGameType(g.gameType));
    // A private room's warm-up: until its host starts the match
    const warm = f.warmup
      ? `<div class="h-warm"><b>${t('room.warmup')}</b><span>${f.warmup.host ? t('room.warmupHost', { esc: '<span class="h-key">Esc</span>' }) : t('room.warmupWait')}</span></div>`
      : '';
    if (!g.isTeamGame) {
      const goal = sv.sv_scoreLimit > 0 ? ` · <b>${t('hud.firstTo', { n: sv.sv_scoreLimit })}</b>` : '';
      setHTML(this.r.match, `${time}<div class="h-mode">${mode} · ${esc(this.mapName)}${goal}</div>${warm}`);
      return;
    }
    const ctf = g.gameType === GAME_TYPE_CTF;
    const [blue, red, limit] = teamScores(g);
    const goal = limit > 0 ? ` · <b>${t('hud.goal', { n: limit, what: t(ctf ? 'words.captures' : 'words.kills') })}</b>` : '';
    let html =
      `<div class="h-tscore"><span class="h-tpill t0">${this.flagImg(0)}<b>${blue}</b></span>${time || '<span class="h-vs">x</span>'}` +
      `<span class="h-tpill t1"><b>${red}</b>${this.flagImg(1)}</span></div><div class="h-mode">${mode} · ${esc(this.mapName)}${goal}</div>`;
    if (ctf) {
      // Where each flag is (the pods on the minimap blink when theirs is away)
      html += '<div class="h-fstats">';
      for (let i = 0; i < 2; ++i) {
        const s = g.flagState[i];
        const carrier = s >= 0 ? g.players[s] : null;
        const where =
          s === FLAG_ON_POD
            ? t('flagState.base')
            : s === FLAG_DROPPED
              ? t('flagState.ground')
              : carrier
                ? carrier === f.me
                  ? t('flagState.withYou')
                  : t('flagState.with', { name: esc(carrier.name) })
                : t('flagState.gone');
        html += `<span class="h-fstat t${i}${s === FLAG_ON_POD ? '' : ' away'}">${this.flagImg(i)}${where}</span>`;
      }
      html += '</div>';
    }
    setHTML(this.r.match, html + warm);
  }

  /** CTF: carrying the enemy flag. */
  private updateCarry(f: HudFrame): void {
    const own = f.me.teamID;
    const home = f.game.flagState[own] === FLAG_ON_POD;
    setHTML(
      this.r.carry,
      `${this.flagImg(1 - own)}<div><strong>${t('carry.title')}</strong><span>${t(home ? 'carry.home' : 'carry.away')}</span></div>`,
    );
  }

  private updateBoard(f: HudFrame): void {
    if (f.campaign) {
      this.updateEnemies(f.campaign);
      return;
    }
    if (f.waves) {
      this.updateWavesBoard(f.waves);
      return;
    }
    const g = f.game;
    const rows = ranked(f.players);
    const top = rows.slice(0, 4);
    const mine = rows.indexOf(f.me);
    if (mine >= 4) top[3] = f.me;
    let html = `<div class="h-bhead"><span class="h-label">${t('board.title')}</span><span class="h-key">Tab</span><span class="sp"></span>`;
    if (f.online && f.pingMs !== null) {
      const ms = Math.round(f.pingMs);
      html += `<span class="h-ping" style="color:${pingColor(ms)}">${signalIcon(ms)} ${ms} ms</span>`;
    }
    html += '</div>';
    if (g.isTeamGame) {
      // Blue against red, as a bar
      const [blue, red] = teamScores(g);
      const share = blue + red > 0 ? Math.round((blue / (blue + red)) * 100) : 50;
      html += `<div class="h-bteams"><b class="t0">${blue}</b><span class="bar"><i style="width:${share}%"></i></span><b class="t1">${red}</b></div>`;
    }
    for (const p of top) {
      const rank = rows.indexOf(p) + 1;
      const cls = [p === f.me ? 'me' : '', rank === 1 ? 'first' : '', p.isAlive ? '' : 'dead', teamClass(g, p.teamID)].join(' ');
      html += `<div class="h-brow ${cls}"><span class="rk">${rank}</span>${this.avatar(p.displaySkin)}<span class="nm">${esc(p.name)}</span><span class="kl">${p.score}</span></div>`;
    }
    const more = rows.length - top.length;
    const foot = [
      more > 0 ? t('board.more', { n: more, players: t(more === 1 ? 'words.player' : 'words.players') }) : '',
      g.isTeamGame && f.me.teamID >= 0 ? `<span class="t${f.me.teamID}">${t('board.you', { team: teamName(f.me.teamID) })}</span>` : '',
    ].filter(Boolean);
    if (foot.length) html += `<div class="h-bfoot">${foot.join(' · ')}</div>`;
    setHTML(this.r.board, html);
  }

  /** The campaign's corner panel: how many enemies are still standing, and each one. */
  private updateEnemies(c: CampaignHud): void {
    const alive = c.enemies.filter((e) => e.alive).length;
    let html =
      `<div class="h-bhead"><span class="h-label">${t('campaign.enemies')}</span><span class="sp"></span></div>` +
      `<div class="h-ecount"><b>${alive}</b><span>/ ${c.enemies.length}</span><small>${t(alive === 1 ? 'campaign.aliveOne' : 'campaign.alive')}</small></div>`;
    for (const e of c.enemies) {
      html +=
        `<div class="h-erow${e.alive ? '' : ' down'}${e.boss ? ' boss' : ''}">${this.avatar(e.skin)}<span class="nm">${esc(e.name)}</span>` +
        (e.alive ? (e.boss ? `<span class="lf"><i style="width:${Math.round(e.life * 100)}%"></i></span>` : '') : `<span class="sk">${SKULL}</span>`) +
        `</div>`;
    }
    setHTML(this.r.board, html);
  }

  // ---------------------------------------------------------------- bottom

  private updateChat(f: HudFrame, deadScreen: boolean): void {
    this.chat = this.chat.filter((c) => this.time - c.t < CHAT_LIFE);
    let html = this.chat
      .map((c) => {
        const fade = this.time - c.t > CHAT_LIFE - 0.6 ? ' fade' : '';
        if (c.name === null) return `<p class="sys${fade}">${esc(c.text)}</p>`;
        return `<p class="${c.kind ?? ''}${fade}"><b>${esc(c.name)}:</b> ${esc(c.text)}</p>`;
      })
      .join('');
    if (f.chatInput !== null) html += `<p class="input"><b>${t('chat.say')}</b> ${esc(f.chatInput)}<span class="caret"></span></p>`;
    else if (f.online && !deadScreen) html += `<p class="hint"><span class="h-key">T</span> ${t('chat.hint')}</p>`;
    setHTML(this.r.chat, html);
    // While dead the death screen takes the left side and the respawn button the bottom centre:
    // the chat goes to the bottom right (the minimap and the weapons are hidden then)
    setStyle(this.r.chat, 'left', deadScreen ? 'auto' : '14px');
    setStyle(this.r.chat, 'right', deadScreen ? '14px' : 'auto');
  }

  private drawMinimap(f: HudFrame): void {
    const cv = this.r.mini as HTMLCanvasElement;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const px = cv.width;
    ctx.clearRect(0, 0, px, px);
    if (this.walls) ctx.drawImage(this.walls, 0, 0);
    const [w, h] = this.mapSize;
    const cell = px / Math.max(w, h);
    const ox = (px - w * cell) / 2;
    const oy = (px - h * cell) / 2;
    const X = (x: number): number => ox + x * cell;
    const Y = (y: number): number => oy + (h - y) * cell;
    const me = f.me;
    const g = f.game;
    const s = px / MINIMAP_SIZE;
    const TEAM_RGB = ['77,141,255', '255,90,90'];
    const blink = this.time % 0.5 < 0.25;

    // CTF (Game::renderMiniMap): a pod whose flag is away, and each flag where it is now
    if (g.gameType === GAME_TYPE_CTF) {
      for (let i = 0; i < 2; ++i) {
        const pod = g.map.flagPodPos[i];
        ctx.fillStyle = `rgba(${TEAM_RGB[i]},${g.flagState[i] === FLAG_ON_POD ? 0.45 : 0.9})`;
        ctx.fillRect(X(pod.x) - 3 * s, Y(pod.y) - 3 * s, 6 * s, 6 * s);
        if (g.flagState[i] !== FLAG_ON_POD && !blink) continue;
        const at = g.flagPosition(i);
        ctx.save();
        ctx.translate(X(at.x), Y(at.y));
        ctx.scale(s, s);
        ctx.fillStyle = `rgb(${TEAM_RGB[i]})`;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-2, 5);
        ctx.lineTo(-2, -7);
        ctx.lineTo(7, -3.5);
        ctx.lineTo(-2, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    if (me.teamID !== PLAYER_TEAM_SPECTATOR) {
      for (const p of f.players) {
        if (!p || p === me || !p.isAlive) continue;
        const pos = p.currentCF.position;
        // Team games: the allies always show, in the team's colour
        if (g.isTeamGame && p.teamID === me.teamID) {
          ctx.fillStyle = `rgb(${TEAM_RGB[p.teamID]})`;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1 * s;
          ctx.beginPath();
          ctx.arc(X(pos.x), Y(pos.y), 3 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          continue;
        }
        // Enemies only show while they shoot (Player::firedShowDelay), fading out
        if (p.firedShowDelay <= 0) continue;
        const a = Math.min(1, p.firedShowDelay * 0.5);
        const rgbText = g.isTeamGame ? TEAM_RGB[p.teamID] ?? '255,107,107' : '255,107,107';
        ctx.fillStyle = `rgba(${rgbText},${a})`;
        ctx.beginPath();
        ctx.arc(X(pos.x), Y(pos.y), 3.4 * s, 0, Math.PI * 2);
        ctx.fill();
        if (p.firedShowDelay > 1.5) {
          ctx.strokeStyle = `rgba(${rgbText},${a * 0.6})`;
          ctx.lineWidth = 1.2 * s;
          ctx.beginPath();
          ctx.arc(X(pos.x), Y(pos.y), 7 * s, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    if (me.isAlive) {
      const pos = me.currentCF.position;
      ctx.save();
      ctx.translate(X(pos.x), Y(pos.y));
      ctx.rotate((-me.currentCF.angle * Math.PI) / 180);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      // The original's own arrow: cyan, or yellow in the red team
      ctx.fillStyle = g.isTeamGame && me.teamID === PLAYER_TEAM_RED ? '#ffff55' : '#66ffff';
      ctx.strokeStyle = '#001';
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private updateHealth(me: Player): void {
    const life = Math.max(0, Math.min(1, me.life));
    const n = life > 0 ? Math.max(1, Math.round(life * 100)) : 0;
    setText(this.r.hp, String(n));
    // The original colours: (1 - life, life, 0), blinking below a quarter
    const color = rgb([1 - life, life, 0]);
    setStyle(this.r.hpbar, 'width', `${(life * 100).toFixed(1)}%`);
    setStyle(this.r.hpbar, 'background-color', color);
    this.r.hpbar.classList.toggle('low', life <= 0.25);
    this.r.plus.setAttribute('fill', color);
  }

  private updateWeapons(me: Player): void {
    const r = this.r;
    const w = me.weapon;
    const id = w ? w.weaponID : -1;
    if (id >= 0) {
      setHTML(r.wicon, weaponIcon(this.art, id, 'white'));
      setText(r.wname, weaponInfo(id).name);
    }
    let extra = '';
    if (w && id === WEAPON_SHOTGUN && sv.sv_enableShotgunReload) {
      const left = Math.max(0, 6 - w.shotInc);
      for (let i = 0; i < 6; i++) extra += `<span class="h-pip${i >= left ? ' off' : ''}"></span>`;
    } else if (w && id === WEAPON_CHAIN_GUN) {
      extra = `<span class="h-label" style="font-size:10px">${t('hud.heat')}</span><span class="h-heat${w.overHeated ? ' hot' : ''}"><i style="width:${Math.round((1 - w.chainOverHeat) * 100)}%"></i></span>`;
    }
    setHTML(r.wextra, extra);

    const melee = me.meleeWeapon;
    show(r.sec, !!melee && sv.sv_enableSecondary);
    if (melee) {
      setHTML(r.secIcon, weaponIcon(this.art, melee.weaponID, 'white'));
      const ready = me.meleeDelay <= 0;
      const progress = ready ? 1 : 1 - me.meleeDelay / Math.max(0.01, melee.fireDelay);
      setStyle(r.secRing, 'stroke-dashoffset', (RING_C * (1 - progress)).toFixed(1));
      setStyle(r.secRing, 'stroke', ready ? '#7aa2ff' : 'rgba(152,163,199,.7)');
    }

    setText(r.grenN, `×${me.nbGrenadeLeft}`);
    r.gren.classList.toggle('empty', me.nbGrenadeLeft <= 0);
    show(r.molo, sv.sv_enableMolotov);
    setText(r.moloN, `×${me.nbMolotovLeft}`);
    r.molo.classList.toggle('empty', me.nbMolotovLeft <= 0);
    // Player::grenadeDelay: the last thrown kind cools down
    const cool = (el: HTMLElement, on: boolean, total: number): void => {
      show(el, on);
      if (on) setStyle(el, '--p', `${Math.round((1 - me.grenadeDelay / total) * 100)}%`);
    };
    cool(r.grenCool, me.grenadeDelay > 0 && me.lastShootWasNade, weaponDefs[WEAPON_GRENADE].fireDelay);
    cool(r.moloCool, me.grenadeDelay > 0 && !me.lastShootWasNade, weaponDefs[WEAPON_COCKTAIL_MOLOTOV].fireDelay);
  }

  // ---------------------------------------------------------------- world labels and cursors

  private updateTags(f: HudFrame): void {
    let n = 0;
    for (const p of f.players) {
      if (!p || p === f.me || !p.isAlive) continue;
      const pt = f.project(p);
      if (!pt) continue;
      let el = this.tagEls[n];
      if (!el) {
        el = document.createElement('span');
        el.className = 'h-tag';
        this.r.tags.appendChild(el);
        this.tagEls.push(el);
      }
      n++;
      show(el, true);
      const cls = `h-tag ${teamClass(f.game, p.teamID)}`.trim();
      if (el.className !== cls) el.className = cls;
      // ping > 12 network frames: the original's *LAGGER* tag
      setHTML(el, esc(p.name) + (p.pingFrames > 12 ? '<span class="lag">LAG</span>' : ''));
      const [x, y] = this.toStage(pt.x, pt.top);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (let i = n; i < this.tagEls.length; i++) show(this.tagEls[i], false);
  }

  /** The ring on the orb that killed us, and its name. */
  private updateKiller(f: HudFrame, deadScreen: boolean): void {
    const d = this.death;
    const killer = deadScreen && d && !d.suicide ? f.players[d.killerID] : null;
    const pt = killer && killer.isAlive ? f.project(killer) : null;
    show(this.r.kring, !!pt);
    show(this.r.ktag, !!pt);
    if (!pt || !killer) return;
    const [x, y] = this.toStage(pt.x, pt.y);
    const [, top] = this.toStage(pt.x, pt.top);
    this.r.kring.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    setText(this.r.ktag, killer.name);
    this.r.ktag.style.transform = `translate(${x.toFixed(1)}px, ${(top - 30).toFixed(1)}px) translate(-50%, -100%)`;
  }

  private updateCursors(f: HudFrame, crosshair: boolean, arrow: boolean): void {
    if (this.cursorFree) crosshair = arrow = false;
    const r = this.r;
    const [mx, my] = this.toStage(f.mouseX, f.mouseY);
    show(r.xhair, crosshair);
    show(r.arrow, arrow);
    if (crosshair) {
      r.xhair.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
      setStyle(r.xhair, 'opacity', (1 - f.scope).toFixed(2));
      setStyle(r.hitmark, 'opacity', this.hit.toFixed(2));
      // Reloads (fireDelay >= 1, the shotgun's 6-shell reload): a ring instead of "Reloading"
      const w = f.me.weapon;
      const cfd = w ? w.currentFireDelay : 0;
      if (!w || cfd <= 0) this.reload = null;
      else if (cfd > this.reloadPrev + 1e-4) this.reload = w.fireDelay >= 1 || cfd > w.fireDelay + 0.01 ? { total: cfd } : null;
      this.reloadPrev = cfd;
      show(r.reload, !!this.reload);
      if (this.reload) {
        const c = 2 * Math.PI * 21;
        setStyle(r.reload, 'stroke-dashoffset', (c * (cfd / this.reload.total)).toFixed(1));
      }
    }
    if (arrow) {
      r.arrow.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
      // The game's cursor hovers the cards too
      const el = this.cardAt(f.mouseX, f.mouseY);
      if (el !== this.hovered) {
        this.hovered?.classList.remove('vhover');
        el?.classList.add('vhover');
        this.hovered = el;
      }
    }
  }

  // ---------------------------------------------------------------- death screen

  private updateDeath(f: HudFrame): void {
    const r = this.r;
    const me = f.me;
    const d = this.death;
    if (d) {
      const w = weaponInfo(d.weaponID);
      const how = `${w.article} ${weaponIcon(this.art, d.weaponID, 'white')} <b>${esc(w.name)}</b>`;
      const lifeDmg = Math.max(0, Math.round((me.dmg - this.life.dmgAtSpawn) * 100));
      setHTML(
        r.deadCard,
        `<div class="h-eyebrow">${t('death.eliminated')}</div>` +
          (d.suicide
            ? `<div class="h-krow"><div class="h-kav">${this.avatar(me.displaySkin)}</div><div><div class="h-kname">${t('death.you')}</div><div class="h-kwith">${t('death.self', { how })}</div></div></div>`
            : `<div class="h-krow"><div class="h-kav">${this.avatar(d.killerSkin)}</div><div><div class="h-kname">${esc(d.killerName)}</div><div class="h-kwith">${t('death.by', { how })}</div></div></div>` +
              (d.count >= 2 ? `<span class="h-nemesis">${t('death.nemesis', { n: d.count, name: esc(d.killerName) })}</span>` : '')) +
          `<div class="h-divider"></div><span class="h-label">${t('death.thisLife')}</span><div class="h-life">` +
          `<div><b>${this.life.kills}</b><span>${t(this.life.kills === 1 ? 'words.kill' : 'words.kills')}</span></div>` +
          `<div><b>${lifeDmg}</b><span>${t('death.damage')}</span></div>` +
          `<div><b>${clock(this.life.length)}</b><span>${t('death.alive')}</span></div></div>`,
      );
    }

    // Player::update: the respawn countdown, then the shoot key (or sv_forceRespawn)
    const toSpawn = me.timeToSpawn;
    const mode = toSpawn > 0 ? 'count' : me.spawnRequested ? 'wait' : sv.sv_forceRespawn ? 'force' : 'click';
    const first = !d;
    let html: string;
    if (mode === 'count') {
      html =
        `<div class="h-ringwrap"><svg viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="6"/>` +
        `<circle data-ring cx="36" cy="36" r="30" fill="none" stroke="#5fe27d" stroke-width="6" stroke-linecap="round" stroke-dasharray="${RESPAWN_C}"/></svg><b data-num></b></div>` +
        `<div class="h-rtext"><strong data-title></strong><span>${t(f.waves ? 'waves.deathHint' : 'death.pickBelow')}</span></div>`;
    } else if (mode === 'click') {
      html = `<span class="h-play pulse">${t(first ? 'death.clickJoin' : 'death.clickRespawn')}</span><div class="h-rtext"><span>${t('death.anywhere')}</span></div>`;
    } else {
      html = `<div class="h-rtext"><strong>${t(mode === 'wait' ? 'death.entering' : 'death.respawning')}</strong></div>`;
    }
    setHTML(r.respawn, html);
    r.respawn.classList.toggle('alone', !d);
    // "Click to join / respawn": a big button at the bottom centre, above the next life's weapons
    r.respawn.classList.toggle('click', mode === 'click');
    if (mode === 'count') {
      const secs = Math.ceil(toSpawn);
      setText(r.respawn.querySelector<HTMLElement>('[data-num]')!, String(secs));
      setText(r.respawn.querySelector<HTMLElement>('[data-title]')!, t('death.respawnIn', { n: secs }));
      const ring = r.respawn.querySelector<SVGElement>('[data-ring]')!;
      setStyle(ring, 'stroke-dashoffset', (RESPAWN_C * (1 - toSpawn / Math.max(0.01, sv.sv_timeToSpawn))).toFixed(1));
    }

    const p = this.picker;
    const chip = (id: number, slot: 'primary' | 'secondary', sel: boolean): string =>
      `<button type="button" class="h-chip${sel ? ' sel' : ''}" data-slot="${slot}" data-id="${id}" title="${esc(weaponInfo(id).name)}">${weaponIcon(this.art, id, 'white')}<span>${esc(weaponInfo(id).short)}</span></button>`;
    const secondaries = enabledSecondaries();
    setHTML(
      r.chips,
      enabledPrimaries().map((id) => chip(id, 'primary', id === p.primary)).join('') +
        (secondaries.length ? '<span class="sep"></span>' + secondaries.map((id) => chip(id, 'secondary', id === p.secondary)).join('') : ''),
    );
  }

  // ---------------------------------------------------------------- score table

  /** Game::renderStats: everybody by score, or each team under its own header (the leader first). */
  private updateTable(f: HudFrame, playing: boolean): void {
    const r = this.r;
    const g = f.game;
    const ctf = g.gameType === GAME_TYPE_CTF;
    const limit = g.isTeamGame ? teamScores(g)[2] : sv.sv_scoreLimit;
    const goal = limit <= 0 ? '' : g.isTeamGame ? t('table.teamGoal', { n: limit, what: t(ctf ? 'words.captures' : 'words.kills') }) : t('table.goal', { n: limit });
    setText(r.tsub, `${modeName(modeOfGameType(g.gameType))} · ${this.mapName}${goal}`);
    setHTML(r.tclock, sv.sv_gameTimeLimit > 0 ? `<b>${clock(f.timeLeft + 1)}</b><span>${t('table.left')}</span>` : '');
    const cols = [
      '#',
      t('table.player'),
      t('table.kills'),
      t('table.deaths'),
      ...(ctf ? [t('table.captures'), t('table.returns')] : []),
      t('table.damage'),
      t('table.feats'),
      ...(f.online ? [t('table.ping')] : []),
    ];
    setHTML(r.thead, `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`);
    const row = (p: Player, i: number): string => {
      const cls = [p === f.me ? 'me' : '', i === 0 ? 'first' : '', p.isAlive ? '' : 'dead'].join(' ');
      const ms = p.pingFrames * 33;
      // CTF scores are captures: the frags are the kills there (GameShowStats "Kills" / "Caps")
      return (
        `<tr class="${cls}"><td>${i + 1}</td><td class="pl"><div>${this.avatar(p.displaySkin)}<span>${esc(p.name)}</span>${p.tag ? `<em class="tag${p.tag.startsWith('ANON-') ? ' anon' : ''}">#${esc(p.tag)}</em>` : ''}${p.isAlive ? '' : `<small>${t('table.dead')}</small>`}</div></td>` +
        `<td class="k">${ctf ? p.kills : p.score}</td><td>${p.deaths}</td>` +
        (ctf ? `<td class="k">${p.score}</td><td>${p.returns}</td>` : '') +
        `<td>${bigNum(Math.round(p.dmg * 100))}</td>` +
        `<td class="fx">${featChips(p)}</td>` +
        (f.online ? `<td style="color:${pingColor(ms)}"><span class="h-pdot"></span>${ms} ms</td>` : '') +
        '</tr>'
      );
    };
    let html = '';
    if (!g.isTeamGame) html = ranked(f.players).map(row).join('');
    else {
      const [blue, red] = teamScores(g);
      for (const team of blue >= red ? [PLAYER_TEAM_BLUE, PLAYER_TEAM_RED] : [PLAYER_TEAM_RED, PLAYER_TEAM_BLUE]) {
        const members = ranked(f.players).filter((p) => p.teamID === team);
        html +=
          `<tr class="h-tteam t${team}"><td colspan="${cols.length}"><div>${this.flagImg(team)}<span>${capitalize(teamName(team))}</span>` +
          `<b>${team === PLAYER_TEAM_BLUE ? blue : red}</b><small>${members.length} ${t(members.length === 1 ? 'words.player' : 'words.players')}</small></div></td></tr>`;
        html += members.map(row).join('');
      }
    }
    setHTML(r.table, html);
    const specs = f.players.filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_SPECTATOR).map((p) => p.name);
    setHTML(
      r.tfoot,
      `<span>${t('table.spectators', { list: specs.length ? esc(specs.join(', ')) : t('table.nobody') })}</span>` +
        (playing ? `<span>${t('table.releaseTab', { tab: '<span class="h-key">Tab</span>' })}</span>` : ''),
    );
    r.scores.classList.toggle('over', !playing);
  }

  /** The map vote: one card per map offered, with its top view, its votes and the key to press. */
  private updateVote(f: HudFrame): void {
    const v = this.vote!;
    const ctf = f.game.gameType === GAME_TYPE_CTF;
    const total = v.counts.reduce((a, b) => a + b, 0);
    const best = Math.max(...v.counts);
    const cards = v.maps
      .map((name, i) => {
        const preview = this.preview(name, ctf);
        const n = v.counts[i];
        const cls = ['h-vcard', i === v.mine ? 'mine' : '', n > 0 && n === best ? 'lead' : ''].join(' ');
        const votes = n === 0 ? t('vote.zero') : n === 1 ? t('vote.one') : t('vote.many', { n });
        return (
          `<button type="button" class="${cls}" data-i="${i}"><span class="h-key">${i + 1}</span>` +
          (preview ? `<img src="${preview}" alt="">` : '<span class="ph"></span>') +
          `<span class="info"><b>${esc(name)}</b><small>${i === v.mine ? `${t('vote.yours')} · ` : ''}${votes}</small>` +
          `<span class="bar"><i style="width:${total ? Math.round((n / total) * 100) : 0}%"></i></span></span></button>`
        );
      })
      .join('');
    const keys = v.maps.map((_, i) => `<span class="h-key">${i + 1}</span>`).join('');
    const html = `<div class="h-vhead"><span class="h-label">${t('vote.title')}</span><span class="hint">${t('vote.hint', { keys })}</span></div>${cards}`;
    if (html !== this.voteHtml) {
      this.voteHtml = html;
      setHTML(this.r.vote, html);
      this.hovered = null;
    }
  }

  /** A map's top view for the vote (loaded once; null until it is drawn). */
  private preview(name: string, ctf: boolean): string | null {
    const key = `${name}|${ctf}`;
    if (!this.previews.has(key)) {
      this.previews.set(key, null);
      loadMap(name)
        .then((map) => {
          const c = document.createElement('canvas');
          c.width = c.height = 168;
          drawMapPreview(c, map, ctf);
          this.previews.set(key, c.toDataURL());
        })
        .catch(() => {});
    }
    return this.previews.get(key) ?? null;
  }

  /** Game over: who won (a player, or a team), and the next map after sv.changeMapDelay. */
  private updateBanner(f: HudFrame): void {
    const g = f.game;
    const left = Math.max(0, Math.ceil(sv.changeMapDelay - (this.time - (this.roundOverAt ?? this.time))));
    let result: string;
    if (g.isTeamGame) {
      // GAME_BLUE_WIN / GAME_RED_WIN / GAME_DRAW, or the time ran out (GAME_DONT_SHOW): the scores decide
      const [blue, red] = teamScores(g);
      const rs = g.roundState;
      const winner = rs === GAME_BLUE_WIN ? PLAYER_TEAM_BLUE : rs === GAME_RED_WIN ? PLAYER_TEAM_RED : rs === GAME_DRAW || blue === red ? -1 : blue > red ? PLAYER_TEAM_BLUE : PLAYER_TEAM_RED;
      const ours = winner >= 0 && winner === f.me.teamID ? t('banner.yourTeam') : '';
      const score = t('banner.score', { a: Math.max(blue, red), b: Math.min(blue, red) });
      result =
        winner < 0
          ? `${t('banner.draw')} <span>${score}</span>`
          : `${t('banner.teamWon', { team: `<b class="t${winner}">${capitalize(teamName(winner))}</b>`, ours })} <span>${score}</span>`;
    } else {
      const winner = ranked(f.players)[0];
      const who = !winner ? '' : winner === f.me ? t('banner.youWon') : t('banner.playerWon', { name: esc(winner.name) });
      result = who + (winner ? ` <span>${t('banner.with', { n: winner.score, kills: t(winner.score === 1 ? 'words.kill' : 'words.kills') })}</span>` : '');
    }
    const next = left > 0 ? t('banner.nextMap', { n: left }) : t('banner.loadingNext');
    const highlights = matchHighlights(f.players, this.teamGame);
    setHTML(
      this.r.banner,
      `<div class="t">${t('banner.over')}</div><div class="s">${result}</div>` +
        (highlights ? `<div class="hl">${highlights}</div>` : '') +
        `<div class="s"><span>${next}</span></div>`,
    );
  }

  dispose(): void {
    if (this.campEndKeys) window.removeEventListener('keydown', this.campEndKeys, true);
    this.root.remove();
  }
}

/** Seconds before "Next level" / "Try again" work at the end of a campaign level. */
const CAMPAIGN_NEXT_WAIT = 3;

/** Seconds before the side banner loads a new ad when it shows again. */
const SIDE_AD_REFRESH = 60;

/** Each feat's look on screen: colours of its name, glow, how long it stays (the voice fits), how much it matters. */
const FEAT_STYLE: Record<FeatKind, { c1: string; c2: string; glow: string; dur: number; prio: number; streak?: boolean }> = {
  double: { c1: '#bfe3ff', c2: '#5aa9ff', glow: '#5aa9ff66', dur: 2.0, prio: 1, streak: true },
  triple: { c1: '#c8ffd4', c2: '#2fd35c', glow: '#2fd35c66', dur: 2.1, prio: 2, streak: true },
  dominating: { c1: '#ffe2b8', c2: '#ff8a1c', glow: '#ff8a1c77', dur: 2.2, prio: 4, streak: true },
  unstoppable: { c1: '#ffe066', c2: '#ff3b5c', glow: '#ff3b5c88', dur: 2.6, prio: 6, streak: true },
  firstBlood: { c1: '#ffc2c8', c2: '#ff2f4a', glow: '#ff2f4a77', dur: 2.3, prio: 3 },
  revenge: { c1: '#ffc9d5', c2: '#ff3d6e', glow: '#ff3d6e77', dur: 2.3, prio: 2 },
  missionFailed: { c1: '#e2e4ee', c2: '#b3122e', glow: '#b3122e88', dur: 2.6, prio: 5 },
};

/** The score table's Highlights: the rarest feats first, four at most. */
function featChips(p: Player): string {
  const f = p.feats;
  const chips: string[] = [];
  const times = (n: number) => (n > 1 ? ` ×${n}` : '');
  if (f.unstoppable) chips.push(`<span class="fc unstoppable">UNSTOPPABLE${times(f.unstoppable)}</span>`);
  if (f.dominating) chips.push(`<span class="fc dominating">DOMINATING${times(f.dominating)}</span>`);
  if (f.triple) chips.push(`<span class="fc triple">TRIPLE${times(f.triple)}</span>`);
  if (f.double) chips.push(`<span class="fc double">DOUBLE${times(f.double)}</span>`);
  if (f.bestStreak >= 3) chips.push(`<span class="fc streak">${t('feat.chipStreak', { n: f.bestStreak })}</span>`);
  if (f.revenges) chips.push(`<span class="fc rev">${t('feat.chipRevenge', { n: f.revenges })}</span>`);
  if (f.firstBlood) chips.push(`<span class="fc fb">${t('feat.chipFirstBlood')}</span>`);
  return chips.slice(0, 4).join('');
}

/** End of the match: the biggest streak feat, the longest streak, the most revenges, and First Blood. */
function matchHighlights(players: readonly (Player | null)[], teamGame: boolean): string {
  const list = players.filter((p): p is Player => !!p);
  const items: string[] = [];
  const best = (key: 'unstoppable' | 'dominating' | 'triple' | 'bestStreak' | 'revenges' | 'firstBlood') =>
    list.reduce<Player | null>((b, p) => (p.feats[key] > (b?.feats[key] ?? 0) ? p : b), null);
  const name = (p: Player) => `<b class="${teamGame ? `t${p.teamID}` : ''}">${esc(p.name)}</b>`;
  // The match's best player: the score (captures in CTF), then the kills
  const mvp = list.reduce<Player | null>((b, p) => (!b || p.score > b.score || (p.score === b.score && p.kills > b.kills) ? p : b), null);
  if (mvp && (mvp.score > 0 || mvp.kills > 0)) items.push(`<span class="hi mvp">${t('banner.mvp', { name: name(mvp) })}</span>`);
  for (const kind of ['unstoppable', 'dominating', 'triple'] as const) {
    const p = best(kind);
    if (p) {
      items.push(`<span class="hi ${kind}">${t('banner.featBy', { feat: t(`feat.${kind}`), name: name(p) })}</span>`);
      break;
    }
  }
  const streak = best('bestStreak');
  if (streak && streak.feats.bestStreak >= 3) items.push(`<span class="hi">${t('banner.bestStreak', { name: name(streak), n: streak.feats.bestStreak })}</span>`);
  const rev = best('revenges');
  if (rev) items.push(`<span class="hi">${t('banner.revenges', { name: name(rev), n: rev.feats.revenges })}</span>`);
  const fb = best('firstBlood');
  if (fb) items.push(`<span class="hi">${t('banner.featBy', { feat: t('feat.firstBlood'), name: name(fb) })}</span>`);
  return items.join('');
}

/** A small skull: an enemy down in the campaign's panel. */
const SKULL =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a8.5 8.5 0 0 0-5.3 15.14v2.36A2.5 2.5 0 0 0 9.2 22h5.6a2.5 2.5 0 0 0 2.5-2.5v-2.36A8.5 8.5 0 0 0 12 2z"/><circle cx="8.7" cy="11.2" r="2.3" fill="#171236"/><circle cx="15.3" cy="11.2" r="2.3" fill="#171236"/></svg>';

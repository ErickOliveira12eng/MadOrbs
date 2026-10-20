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
import { adBlockFound, adsAllowed, mountAd, refreshAd } from '../ads';
import type { WavesEnd, WavesHud } from '../wavesRun';
import { MILESTONES, affordable, balance, checkpoints, nextMilestone } from '../wavesProgress';
import { orbName, prizeText, weaponLook } from '../wavesPrize';
import { cardDef, cardValue, type CardID } from '../wavesCards';
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
import { bigNum, capitalize, num, t, type Key } from '../../i18n';
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
  /** Online with bots in this match: our kills on people, the ones that count (record, stats); else null. */
  vsPeople: { kills: number } | null;
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
  /** Each name tag's life bar: the white trail of the last damage (its life, and until when it holds). */
  private readonly hpTrail = new Map<number, { life: number; holdUntil: number }>();
  private hpTime = 0;
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
  <div class="h-hpcol"><span class="h-label">${t('hud.health')}</span><div class="h-shbar" data-r="shbar" hidden><i data-r="shfill"></i></div><div class="h-hpbar"><i data-r="hpbar"></i><span class="tk" style="left:25%"></span><span class="tk" style="left:50%"></span><span class="tk" style="left:75%"></span></div></div>
</div>
<div class="h-abs h-weapons" data-r="weapons">
  <div class="h-panel h-wbox"><div class="h-wtop"><span data-r="wicon"></span><span class="h-wextra" data-r="wextra"></span></div><div class="name" data-r="wname"></div></div>
  <div class="h-panel h-slot" data-r="sec">
    <div class="h-cd"><svg class="ring" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="17" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3"/><circle data-r="secRing" cx="19" cy="19" r="17" fill="none" stroke="#7aa2ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="0"/></svg><span data-r="secIcon"></span></div>
    <span class="h-key">${t('hud.space')}</span>
  </div>
  <div class="h-panel h-slot" data-r="gren"><img data-r="grenImg" alt="${t('hud.grenades')}"><div class="cnt"><span data-r="grenN"></span>${mouseIcon('right')}</div><i class="h-cool" data-r="grenCool" hidden></i></div>
  <div class="h-panel h-slot" data-r="molo"><img data-r="moloImg" alt="Molotov"><div class="cnt"><span data-r="moloN"></span>${mouseIcon('middle')}</div><i class="h-cool" data-r="moloCool" hidden></i></div>
  <div class="h-panel h-slot h-abil" data-r="dash" hidden title="${t('up.dash')}">${ABILITY_ICON.dash}<span class="h-key">Shift</span><i class="h-cool" data-r="dashCool" hidden></i></div>
  <div class="h-panel h-slot h-abil" data-r="shock" hidden title="${t('up.shock')}">${ABILITY_ICON.shock}<span class="h-key">Q</span><i class="h-cool" data-r="shockCool" hidden></i></div>
  <div class="h-panel h-slot h-abil h-refl" data-r="refl" hidden title="${t('card.reflect')}">${cardIcon('reflect', 'h-abico')}<span class="h-key" data-r="reflLeft"></span><i class="h-cool" data-r="reflCool" hidden></i></div>
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
    // The announcements go down under the boss's bar (they shared the spot)
    this.r.feat.classList.toggle('low', !!c.boss);
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
    if (!this.adOrPlea(ad.lastElementChild as HTMLElement, 'wide')) return;
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

  /**
   * The end of a waves run: the wave reached, the kills, the record; the Cores it earned (and what
   * they buy now), the milestones reached, the next one; the Workshop, play again or the menu.
   */
  showWavesEnd(e: WavesEnd & { skin: SkinInfo; onAction: (action: 'retry' | 'shop' | 'menu') => void }): void {
    const kills = t(e.kills === 1 ? 'end.oneKill' : 'end.kills', { n: e.kills });
    const head =
      `<div class="wave-reached"><span>${t('waves.label')}</span><b>${e.wave}</b></div>` +
      `<div class="time">${kills} · ${clock(e.seconds)}</div>` +
      // A tester's run (the Esc screen's tools) counts for nothing
      (e.test
        ? `<div class="best">${t('test.run')}</div>`
        : e.isBest
          ? `<div class="best new">${t('waves.newBest')}</div>`
          : e.best
            ? `<div class="best">${t('waves.record', { n: e.best.wave })}</div>`
            : '') +
      (e.cards.length
        ? `<div class="h-wcards end">${e.cards.map((c) => `<span class="${cardDef(c.id).rarity}" title="${t(`card.${c.id}`)}">${cardIcon(c.id, 'h-cardmini')}<b>${c.level}</b></span>`).join('')}</div>`
        : '');

    // The Cores: where they came from, the total, the balance
    const c = e.cores;
    const row = (label: string, n: number) => `<div class="wc-row"><span>${label}</span><b>+${bigNum(n)}</b></div>`;
    const canBuy = affordable(e.progress);
    const cores =
      `<div class="wc-box"><div class="wc-head"><span class="wc-ico"></span>${t('wend.cores')}</div>` +
      row(t('wend.waves', { n: c.waves }), c.waveCores) +
      row(t('wend.kills', { n: c.kills }), c.killCores) +
      (c.bosses ? row(t(c.bosses === 1 ? 'wend.boss' : 'wend.bosses', { n: c.bosses }), c.bossCores) : '') +
      (c.recordCores ? row(t('wend.record'), c.recordCores) : '') +
      `<div class="wc-total"><span>${t('wend.total')}</span><b>+${bigNum(c.total)}</b></div>` +
      `<div class="wc-bal">${t('wend.balance', { n: bigNum(balance(e.progress)) })}${canBuy ? ` · <b>${t(canBuy === 1 ? 'wend.canBuyOne' : 'wend.canBuy', { n: canBuy })}</b>` : ''}</div></div>`;

    // The milestones: those reached now, the next one with how far it is
    const prizeArt = (m: (typeof MILESTONES)[number]) =>
      'weapon' in m ? `<img class="w" src="${weaponLook(m.weapon).picture}" alt="" />` : `<img class="o" data-orb="${m.skin}" alt="" />`;
    let side = '';
    // One prize: a card; several (a first long run): small chips, two a row, so the panel stays on screen
    if (e.unlocked.length === 1) {
      const m = e.unlocked[0];
      side += `<div class="wu-got">${prizeArt(m)}<span><small>${t('wend.unlocked')}</small><b>${'skin' in m ? orbName(m.skin) : prizeText(m)}</b><em>${t('wend.atWave', { n: m.wave })}</em></span></div>`;
    } else if (e.unlocked.length > 1)
      side +=
        `<div class="wu-gots"><small>${t('wend.unlocked')}</small><div>` +
        e.unlocked
          .map((m) => `<span class="wu-chip">${prizeArt(m)}<span><b>${'skin' in m ? orbName(m.skin) : weaponLook(m.weapon).name}</b><em>${t('workshop.atWave', { n: m.wave })}</em></span></span>`)
          .join('') +
        `</div></div>`;
    const record = Math.max(e.wave, e.recordBefore);
    const before = checkpoints(e.recordBefore);
    const newCheckpoint = checkpoints(e.wave).filter((w) => w > 1 && !before.includes(w)).pop();
    const next = nextMilestone(record);
    if (next) {
      const prev = [...MILESTONES].reverse().find((m) => m.wave < next.wave)?.wave ?? 0;
      const share = Math.max(0, Math.min(1, (record - prev) / (next.wave - prev)));
      side +=
        `<div class="wu-next"><small>${t('wend.next')}</small><div class="wu-line">${prizeArt(next)}<span><b>${prizeText(next)}</b>` +
        `<em>${t(next.wave - record === 1 ? 'wend.nextOne' : 'wend.nextLeft', { n: next.wave, left: next.wave - record })}</em></span></div>` +
        `<span class="wu-bar"><i style="width:${Math.round(share * 100)}%"></i></span></div>`;
    }
    // A new checkpoint: under the Cores (the left column has the room)
    const checkpoint = newCheckpoint ? `<div class="wu-cp">${t('wend.checkpoint', { n: newCheckpoint })}</div>` : '';

    const wait = `<span class="wait">${CAMPAIGN_NEXT_WAIT}</span>`;
    const buttons =
      `<button type="button" data-a="menu"><span class="h-key">Esc</span>${t('waves.menu')}</button>` +
      `<button type="button" class="shop" data-a="shop"><span class="h-key">W</span>${t('waves.shop')}</button>` +
      `<button type="button" class="primary" data-a="retry" disabled><span class="h-key">Enter</span>${t('waves.retry')}${wait}</button>`;
    this.openEndPanel(
      `<div class="t lost">${t('waves.over')}</div><div class="lvl">${t('waves.reached', { n: e.wave })}</div>${head}` +
        `<div class="wend-split"><div class="wu-side">${cores}${checkpoint}</div><div class="wu-side">${side}</div></div><div class="btns">${buttons}</div>`,
      'retry',
      (a) => e.onAction(a === 'menu' ? 'menu' : a === 'shop' ? 'shop' : 'retry'),
      { KeyW: 'shop' },
    );
    this.r.campcard.classList.add('waves');
    // The Core's icon, and the exclusive Orbs in the player's colours (drawn on demand: asked again a moment later)
    for (const el of this.r.campcard.querySelectorAll<HTMLElement>('.wc-ico')) el.innerHTML = CORE_SVG;
    const fill = () => {
      let missing = false;
      for (const img of this.r.campcard.querySelectorAll<HTMLImageElement>('img[data-orb]')) {
        if (img.src) continue;
        const url = this.art.orb({ ...e.skin, skin: img.dataset.orb! });
        if (url) img.src = url;
        else missing = true;
      }
      if (missing) setTimeout(fill, 250);
    };
    fill();
  }

  /** The waves' cards waiting for a choice: their keys (1, 2, 3), the moment they start to answer. */
  private cardKeys: ((ev: KeyboardEvent) => void) | null = null;

  /**
   * The boss fell, or wave 5, 15, 25... ended (`wave`: the commons only) (the waves): three cards in the
   * middle of the screen, the game stopped, the banner under them and the system's cursor. A click or the
   * keys 1, 2, 3 take one (after a moment: the shot that killed the boss must not pick a card by itself).
   */
  showCards(offer: { id: CardID; level: number; up: number }[], onPick: (i: number) => void, wave?: number, reroll?: { left: number; onReroll: () => void }): void {
    const cards = offer
      .map(({ id, level, up }, i) => {
        const def = cardDef(id);
        const next = Math.min(def.max, level + up);
        const lv = level ? t('cards.level', { from: level, to: next }) : t('cards.new');
        // A card of yours two levels at once: a ribbon, and it glows
        const double = next - level > 1;
        return (
          `<button type="button" class="h-card ${def.rarity}${double ? ' double' : ''}" data-card="${i}">` +
          (double ? `<span class="up2">${t('cards.double', { n: next - level })}</span>` : '') +
          `<span class="rar">${t(`cards.${def.rarity}`)}</span>${cardIcon(id)}` +
          `<b>${t(`card.${id}`)}</b><em>${lv}</em>` +
          `<p>${next === 1 && (id === 'pierce' || id === 'ricochet' || id === 'shadow') ? t(`card.${id}.descOne`) : t(`card.${id}.desc`, { v: cardValue(id, next) })}</p>` +
          `<span class="h-key">${i + 1}</span></button>`
        );
      })
      .join('');
    const sub = wave === undefined ? t('cards.sub') : t('cards.subWave', { n: wave });
    // The Workshop's Reroll cards: three others (R)
    const swapButton = reroll
      ? `<button type="button" class="h-reroll" data-reroll${reroll.left > 0 ? '' : ' disabled'}><span>${t('cards.reroll', { n: reroll.left })}</span><span class="h-key">R</span></button>`
      : '';
    setHTML(this.r.campcard, `<div class="t">${t('cards.title')}</div><div class="lvl">${sub}</div><div class="h-cards">${cards}</div>${swapButton}`);
    this.r.campcard.classList.remove('waves');
    this.r.campcard.classList.add('cards');
    this.r.campend.classList.remove('preload');
    show(this.r.campend, true);
    const ad = this.r.campad;
    if (ad.hidden && this.adOrPlea(ad.lastElementChild as HTMLElement, 'wide')) ad.hidden = false;
    this.cursorFree = true;
    this.root.classList.add('free-cursor');
    const readyAt = performance.now() + 700;
    const pick = (i: number) => {
      if (performance.now() < readyAt || i < 0 || i >= offer.length) return;
      onPick(i);
    };
    const swap = () => {
      if (performance.now() < readyAt || !reroll || reroll.left <= 0) return;
      reroll.onReroll();
    };
    this.r.campend.onclick = (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest('[data-reroll]')) {
        swap();
        return;
      }
      const b = target.closest<HTMLElement>('[data-card]');
      if (b) pick(Number(b.dataset.card));
    };
    this.cardKeys = (ev: KeyboardEvent) => {
      if (ev.code === 'KeyR') {
        ev.preventDefault();
        ev.stopPropagation();
        swap();
        return;
      }
      const m = /^(?:Digit|Numpad)([1-3])$/.exec(ev.code);
      if (!m) return;
      ev.preventDefault();
      ev.stopPropagation();
      pick(Number(m[1]) - 1);
    };
    window.addEventListener('keydown', this.cardKeys, true);
  }

  /** The card was taken: the panel goes back to waiting unseen (its banner stays loaded for the end). */
  hideCards(): void {
    if (this.cardKeys) window.removeEventListener('keydown', this.cardKeys, true);
    this.cardKeys = null;
    this.r.campend.onclick = null;
    this.r.campcard.classList.remove('cards');
    this.r.campend.classList.add('preload');
    this.cursorFree = false;
    this.root.classList.remove('free-cursor');
  }

  /**
   * The end panel (a campaign level, a waves run): its card, the banner under it, the buttons that
   * wait CAMPAIGN_NEXT_WAIT seconds (all but the menu), the keys (Enter: `primary`, R: again, Esc: menu)
   * and the system's cursor.
   */
  private openEndPanel(card: string, primary: string, onAction: (action: string) => void, keys: Record<string, string> = {}): void {
    const waitUntil = performance.now() + CAMPAIGN_NEXT_WAIT * 1000;
    setHTML(this.r.campcard, card);
    this.r.campcard.classList.remove('waves', 'cards');
    this.r.campend.classList.remove('preload');
    show(this.r.campend, true);
    // The banner under the panel: loaded when the level started (preloadCampaignAd), or now
    const ad = this.r.campad;
    if (ad.hidden && this.adOrPlea(ad.lastElementChild as HTMLElement, 'wide')) ad.hidden = false;
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
      if (a !== 'menu' && a !== 'shop' && performance.now() < waitUntil) return;
      if (this.campEndKeys) window.removeEventListener('keydown', this.campEndKeys, true);
      this.campEndKeys = null;
      onAction(a);
    };
    this.r.campend.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (b) act(b.dataset.a!);
    };
    this.campEndKeys = (ev: KeyboardEvent) => {
      const a = ev.code === 'Enter' || ev.code === 'NumpadEnter' ? primary : ev.code === 'KeyR' ? 'retry' : ev.code === 'Escape' ? 'menu' : (keys[ev.code] ?? null);
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
    const hearts = '♥'.repeat(Math.min(6, Math.max(0, w.lives))) + (w.lives > 6 ? `+${w.lives - 6}` : '') + (w.livesFull ? `<b class="max">${t('waves.livesMax')}</b>` : '');
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
    // The announcements go down under the boss's bar (they shared the spot)
    this.r.feat.classList.toggle('low', !!w.bossLife);
  }

  /** The waves' corner panel: the enemies of the wave still to beat, the record. */
  private updateWavesBoard(w: WavesHud): void {
    let html = `<div class="h-bhead"><span class="h-label">${t('campaign.enemies')}</span><span class="sp"></span></div>`;
    html +=
      w.phase === 'fight'
        ? `<div class="h-ecount"><b>${w.left}</b><span>/ ${w.total}</span><small>${t('waves.toBeat')}</small></div>`
        : `<div class="h-wbreak">${t('waves.breakHint')}</div>`;
    // How strong the wave's bots are against wave 1's
    if (w.scale.life > 1.01)
      html += `<div class="h-wscale" title="${t('waves.scaleHint')}">${t('waves.scale', { life: num(w.scale.life), hit: num(w.scale.hit) })}</div>`;
    // The permanent power-ups taken: +10% a level (poison and ice: their level)
    if (w.perms.length)
      html +=
        `<div class="h-perms"><span class="h-label">${t('waves.upgrades')}</span><div>` +
        w.perms
          .map((p) => `<span class="${p.full ? 'full' : ''}" title="${t(`power.${p.kind}` as Key)}${p.full ? ` · ${t('waves.permFull')}` : ''}"><img src="${powerIconUrl(p.kind)}" alt="" /><b>${p.kind === 'poison' || p.kind === 'ice' ? `×${p.level}` : `+${p.level * 10}%`}</b></span>`)
          .join('') +
        `</div></div>`;
    if (w.record) html += `<div class="h-wrec">${t('waves.record', { n: w.record })}</div>`;
    if (w.cores) html += `<div class="h-wcores">${CORE_SVG}${t('waves.coresRun', { n: bigNum(w.cores) })}</div>`;
    // The cards taken, with their levels
    if (w.cards.length)
      html += `<div class="h-wcards">${w.cards.map((c) => `<span class="${cardDef(c.id).rarity}" title="${t(`card.${c.id}`)}">${cardIcon(c.id, 'h-cardmini')}<b>${c.level}</b></span>`).join('')}</div>`;
    setHTML(this.r.board, html);
  }

  /** Our record before this match (online), or null (offline: no record). */
  setRecord(kills: number | null): void {
    this.recordBefore = kills;
  }

  /**
   * End of a match, "Your match": our kills (a new personal record?), longest streak and deaths. With bots
   * in the room only the kills on people count (as for the account's stats): those, and a note saying so.
   */
  private updateMine(f: HudFrame): void {
    const me = f.me;
    const before = this.recordBefore;
    const n = f.vsPeople ? f.vsPeople.kills : me.kills;
    // Like the account's stats: a match counts after 30 s played
    const isRecord = before !== null && n > before && n > 0 && me.timePlayedCurGame >= 30;
    const kills = t(n === 1 ? 'end.oneKill' : 'end.kills', { n });
    const head = isRecord
      ? `<div class="rec"><span>${t('end.newRecord')}</span><b>${kills}</b></div>`
      : `<div class="kills"><b>${kills}</b>${before ? `<small>${t('end.record', { n: before })}</small>` : ''}</div>`;
    const html =
      `<span class="h-label">${t('end.title')}</span>${head}` +
      (f.vsPeople ? `<p class="note">${t('end.botsNote')}</p>` : '') +
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
    this.updateAbilities(f.waves, liveHud);
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
    // An ad blocker on: the spot asks for support instead (nothing to load)
    const plea = want && !adsAllowed() && adBlockFound();
    if (plea && !host.querySelector('.h-plea')) this.adOrPlea(host, 'rect');
    let on = plea || (want && adsAllowed());
    if (on && !plea && !this.sideAdOn) {
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

  /**
   * A banner in `host`, or with an ad blocker on, a kind word in its place (Erick, 20/10/2026: "want to support this
   * free project? Turn off the ad blocker"); false: neither, the spot stays hidden (no ads here, or refused).
   */
  private adOrPlea(host: HTMLElement, slot: 'rect' | 'wide'): boolean {
    const plea = !mountAd(host, slot) && adBlockFound();
    host.parentElement?.classList.toggle('plea', plea);
    if (!plea) return !!host.firstChild;
    host.innerHTML =
      `<div class="h-plea${slot === 'wide' ? ' wide' : ''}">${PLEA_HEART}` +
      `<div><b>${esc(t('ads.pleaTitle'))}</b><span>${esc(t('ads.pleaText'))}</span></div></div>`;
    return true;
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
    // The points: a full bar holds 100 (the waves' Workshop Life: up to 150)
    const n = life > 0 ? Math.max(1, Math.round(life * 100 * me.lifeMax)) : 0;
    setText(this.r.hp, String(n));
    // The original colours: (1 - life, life, 0), blinking below a quarter
    const color = rgb([1 - life, life, 0]);
    setStyle(this.r.hpbar, 'width', `${(life * 100).toFixed(1)}%`);
    setStyle(this.r.hpbar, 'background-color', color);
    this.r.hpbar.classList.toggle('low', life <= 0.25);
    this.r.plus.setAttribute('fill', color);
  }

  /** The waves' Workshop abilities (Shift, Q) and its recharging shield, over the life bar. */
  private updateAbilities(w: WavesHud | null, live: boolean): void {
    const r = this.r;
    for (const kind of ['dash', 'shock'] as const) {
      const a = live ? w?.abilities.find((x) => x.kind === kind) : undefined;
      show(r[kind], !!a);
      if (!a) continue;
      const ready = a.ready >= 1;
      r[kind].classList.toggle('ready', ready);
      const cool = r[`${kind}Cool`];
      show(cool, !ready);
      if (!ready) setStyle(cool, '--p', `${Math.round(a.ready * 100)}%`);
    }
    // The Reflector card: the seconds before its shield comes up, or (lit) before it goes down
    const rf = live ? w?.reflector : null;
    show(r.refl, !!rf);
    if (rf) {
      r.refl.classList.toggle('on', rf.on);
      show(r.reflCool, !rf.on);
      if (!rf.on) setStyle(r.reflCool, '--p', `${Math.round(rf.ready * 100)}%`);
      setText(r.reflLeft, `${Math.ceil(rf.left)} s`);
    }
    const b = live ? w?.barrier : null;
    show(r.shbar, !!b);
    if (b) setStyle(r.shfill, 'width', `${((b.now / b.max) * 100).toFixed(1)}%`);
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

  /**
   * The names over the other orbs, with a life bar under the name once they are hurt (all modes; ours
   * is the HUD's big bar). The life lost stays white a moment, then shrinks: how much a hit took.
   */
  private updateTags(f: HudFrame): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - this.hpTime));
    this.hpTime = now;
    let n = 0;
    for (const p of f.players) {
      if (!p || p === f.me || !p.isAlive) continue;
      const pt = f.project(p);
      if (!pt) continue;
      let el = this.tagEls[n];
      if (!el) {
        el = document.createElement('span');
        el.className = 'h-tag';
        el.innerHTML = '<span class="nm"></span><span class="h-tbar"><i class="g"></i><i class="f"></i></span>';
        this.r.tags.appendChild(el);
        this.tagEls.push(el);
      }
      n++;
      show(el, true);
      const life = Math.max(0, Math.min(1, p.life));
      // The trail: held 0.45 s after a hit, then down to the life; a heal moves it up at once
      let trail = this.hpTrail.get(p.playerID);
      if (!trail || life > trail.life) this.hpTrail.set(p.playerID, (trail = { life, holdUntil: 0 }));
      else if (life < trail.life - 0.001 && trail.holdUntil < now - 0.05) trail.holdUntil = now + 0.45;
      if (now > trail.holdUntil) trail.life = Math.max(life, trail.life - dt * 1.2);
      const hurt = life < 0.995 || trail.life > life + 0.005;
      const big = p.radius > 0.3;
      const cls = `h-tag ${teamClass(f.game, p.teamID)}${hurt ? ' hurt' : ''}${big ? ' big' : ''}`.replace(/\s+/g, ' ').trim();
      if (el.className !== cls) el.className = cls;
      // ping > 12 network frames: the original's *LAGGER* tag; online, the bots filling the room say so
      const mark = f.online && p.isBot ? `<span class="bot">${t('table.bot')}</span>` : p.pingFrames > 12 ? '<span class="lag">LAG</span>' : '';
      setHTML(el.firstElementChild as HTMLElement, p.badges.map((b) => BADGE_ICON[b] ?? '').join('') + esc(p.name) + mark);
      if (hurt) {
        const bar = el.lastElementChild as HTMLElement;
        const fill = bar.lastElementChild as HTMLElement;
        (bar.firstElementChild as HTMLElement).style.width = `${(trail.life * 100).toFixed(1)}%`;
        fill.style.width = `${(life * 100).toFixed(1)}%`;
        const tone = life > 0.6 ? 'hi' : life > 0.3 ? 'mid' : 'lo';
        if (fill.className !== `f ${tone}`) fill.className = `f ${tone}`;
      }
      const [x, y] = this.toStage(pt.x, pt.top);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (let i = n; i < this.tagEls.length; i++) show(this.tagEls[i], false);
    // Trails of players gone (left, dead) are forgotten
    if (this.hpTrail.size > 64) this.hpTrail.clear();
    for (const [id] of this.hpTrail) if (!f.players[id]?.isAlive) this.hpTrail.delete(id);
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
      // A person's player ID; online, a bot filling the room says it is one
      const bot = f.online && p.isBot;
      const id = bot ? `<em class="tag bot">${t('table.bot')}</em>` : p.tag ? `<em class="tag${p.tag.startsWith('ANON-') ? ' anon' : ''}">#${esc(p.tag)}</em>` : '';
      // CTF scores are captures: the frags are the kills there (GameShowStats "Kills" / "Caps")
      return (
        `<tr class="${cls}"><td>${i + 1}</td><td class="pl"><div>${this.avatar(p.displaySkin)}<span>${esc(p.name)}</span>${id}${p.isAlive ? '' : `<small>${t('table.dead')}</small>`}</div></td>` +
        `<td class="k">${ctf ? p.kills : p.score}</td><td>${p.deaths}</td>` +
        (ctf ? `<td class="k">${p.score}</td><td>${p.returns}</td>` : '') +
        `<td>${bigNum(Math.round(p.dmg * 100))}</td>` +
        `<td class="fx">${featChips(p)}</td>` +
        (f.online ? (bot ? '<td>—</td>' : `<td style="color:${pingColor(ms)}"><span class="h-pdot"></span>${ms} ms</td>`) : '') +
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
/** The waves' cards (wavesCards.ts): each one's picture. */
const CARD_PATHS: Record<CardID, string> = {
  double: '<path d="M3 8h11M3 16h11"/><path d="m12 4 4 4-4 4M12 12l4 4-4 4"/><path d="M19 6v12"/>',
  parallel: '<path d="M3 7h15M3 12h15M3 17h15"/><path d="m16 4 3 3-3 3M16 9l3 3-3 3M16 14l3 3-3 3"/>',
  fan: '<path d="M3 12h17M3 12l15-7M3 12l15 7"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/>',
  pierce: '<circle cx="12" cy="12" r="4.5"/><path d="M2 12h20M17 7l5 5-5 5"/>',
  crit: '<path d="m12 2 2.4 6.9H22l-6 4.4 2.3 7L12 16l-6.3 4.3 2.3-7-6-4.4h7.6z"/>',
  vampire: '<path d="M12 2.7s7 7.3 7 12a7 7 0 0 1-14 0c0-4.7 7-12 7-12z"/><path d="M9.5 15.5a2.5 2.5 0 0 0 2.5 2.5"/>',
  rage: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  dodge: '<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
  grenadier: '<circle cx="11" cy="13" r="8"/><path d="M14.35 4.65 16.3 2.7a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95"/><path d="m22 2-1.5 1.5"/>',
  blast: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  ricochet: '<circle cx="4" cy="18" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="20" cy="16" r="2"/><path d="M5.5 16.5 10.5 7.5M13.5 7.5l5 7"/>',
  missiles: '<path d="M14 3 8 9l1.5 1.5L16 4.5z"/><path d="M8 9 4 13l2 1 1 2 4-4"/><path d="M6 18l-3 3M9 19l-2 2M5 15l-2 2"/><path d="m16 4.5 3-1.5-1.5 3"/>',
  shadow: '<circle cx="9" cy="9" r="5"/><circle cx="16" cy="15" r="5" stroke-dasharray="3 2"/>',
  reflect: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M14.5 15a2.5 2.5 0 0 0 0-5H9"/><path d="m11 8-2 2 2 2"/>',
  silver: '<path d="M3 9h10a5 3 0 0 1 0 6H3z"/><path d="M7 9v6"/><path d="M20 3v4M18 5h4"/>',
  necro: '<path d="m12.5 17-.5-1-.5 1h1z"/><path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="12" r="1"/>',
};
const cardIcon = (id: CardID, cls = 'h-cardico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CARD_PATHS[id]}</svg>`;

/** The ad spots' plea while an ad blocker is on (HudLayer.adOrPlea). */
const PLEA_HEART =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

/** The waves' Workshop abilities on the HUD: the dash (Shift), the shock wave (Q). */
const ABILITY_ICON = {
  dash: '<svg class="h-abico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/></svg>',
  shock: '<svg class="h-abico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>',
};

/** The waves' elites' traits before their name (waves.ts): fast, brute, sharpshooter, tank. */
const BADGE_ICON: Record<string, string> = {
  fast: '<svg class="h-trait fast" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
  brute: '<svg class="h-trait brute" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m13 19 6-6M14.5 17.5 3.6 6.6A2 2 0 0 1 3 5.2V3h2.2a2 2 0 0 1 1.4.6l10.9 10.9M16 16l4 4M19 21l2-2M14.8 6.2l2.6-2.6A2 2 0 0 1 18.8 3H21v2.2a2 2 0 0 1-.6 1.4l-2.6 2.6M5 14l4 4M7.5 16.5 4 20M5 21l-2-2"/></svg>',
  sniper: '<svg class="h-trait sniper" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  tank: '<svg class="h-trait tank" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
};

/** A Core, the waves' currency (as src/menu/icons.ts draws it). */
const CORE_SVG =
  '<svg class="h-core" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".45"/><circle cx="12" cy="12" r="7" fill="currentColor"/><circle cx="9.8" cy="9.6" r="2.4" fill="#fff" opacity=".75"/></svg>';
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

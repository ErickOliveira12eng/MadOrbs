// The in-game HUD, in HTML over the game view: kill feed, clock, scores, chat, minimap, life,
// weapons, names over the orbs, crosshair, death screen, score table and the Esc weapon menu.
// What it shows comes from the original (ClientRender.cpp, GameRender.cpp, GameShowStats.cpp:
// the same data, the same rules for the minimap and the respawn); the layout is new.
//
// Everything is laid out in a stage 900 design pixels high, scaled to the game view. While the
// mouse is captured (pointer lock) the page gets no clicks: the death screen's weapon cards are
// then clicked through clickAt() with the game's own cursor.
import { drawMapPreview } from '../mapPreview';
import { loadMap } from '../../sim/map';
import './hud.css';
import {
  FLAG_DROPPED, FLAG_ON_POD, GAME_BLUE_WIN, GAME_DRAW, GAME_PLAYING, GAME_RED_WIN, GAME_TYPE_CTF, GAME_TYPE_DM,
  PLAYER_TEAM_BLUE, PLAYER_TEAM_RED, PLAYER_TEAM_SPECTATOR, WEAPON_CHAIN_GUN, WEAPON_COCKTAIL_MOLOTOV, WEAPON_GRENADE, WEAPON_SHOTGUN,
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

<div class="h-abs h-banner" data-r="banner" hidden></div>
<div class="h-abs h-panel h-vote" data-r="vote" hidden></div>
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
    const deadScreen = !menu && !table && playing && !alive && !spectator;
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
    show(r.next, deadScreen && enabledPrimaries().length > 0);
    show(r.scores, table);
    show(r.banner, !menu && !playing);
    this.voting = !menu && !playing && !!this.vote;
    show(r.vote, this.voting);
    r.scores.classList.toggle('voting', this.voting);
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
    if (deadScreen) this.updateDeath(f);
    this.updateKiller(f, deadScreen);
    if (table) this.updateTable(f, playing);
    if (!menu && !playing) this.updateBanner(f);
    this.updateCursors(f, !menu && alive && !spectator, !menu && deadScreen);
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
    const g = f.game;
    const time = sv.sv_gameTimeLimit > 0 ? `<div class="h-clock">${clock(f.timeLeft + 1)}</div>` : '';
    const mode = modeName(modeOfGameType(g.gameType));
    if (!g.isTeamGame) {
      const goal = sv.sv_scoreLimit > 0 ? ` · <b>${t('hud.firstTo', { n: sv.sv_scoreLimit })}</b>` : '';
      setHTML(this.r.match, `${time}<div class="h-mode">${mode} · ${esc(this.mapName)}${goal}</div>`);
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
    setHTML(this.r.match, html);
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
        `<div class="h-rtext"><strong data-title></strong><span>${t('death.pickBelow')}</span></div>`;
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
    setHTML(this.r.banner, `<div class="t">${t('banner.over')}</div><div class="s">${result}</div><div class="s"><span>${next}</span></div>`);
  }

  dispose(): void {
    this.root.remove();
  }
}

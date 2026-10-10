// The Esc menu: the weapons the player spawns with, as cards. Replaces the original clientRoot menu
// (Client.cpp); like there, the choice applies at the next spawn (nextSpawnWeapon /
// nextMeleeWeapon) and the menu shows when joining a game. In a private room it has a second tab,
// the room: the invitation link, the players and, for its host, the controls (start the match after
// the warm-up, map, teams, kick, lock).
import { PLAYER_TEAM_AUTO_ASSIGN, PLAYER_TEAM_BLUE, PLAYER_TEAM_RED, PLAYER_TEAM_SPECTATOR, WEAPON_KNIVES, WEAPON_SMG } from '../../sim/constants';
import { sv } from '../../sim/gameVar';
import type { HostAction } from '../../net/protocol';
import { teamName } from '../modes';
import type { HudArt } from './hudArt';
import { CHECK, esc, mouseIcon, plain, weaponIcon } from './icons';
import { enabledPrimaries, enabledSecondaries, weaponInfo } from './weaponInfo';
import { t } from '../../i18n';

/** A private room as its tab shows it (src/client/clientGame.ts roomView). */
export interface RoomView {
  code: string;
  /** The invitation link. */
  link: string;
  /** The host's name ('' while nobody). */
  host: string;
  isHost: boolean;
  warmup: boolean;
  locked: boolean;
  /** A team mode (the host moves players between the teams). */
  teams: boolean;
  mode: string;
  map: string;
  /** Every map the host can switch to. */
  maps: string[];
  /** What wins a match ("20 kills") and its length ("10 min"), or "no limit". */
  goal: string;
  time: string;
  maxPlayers: number;
  players: { id: number; name: string; tag: string; team: number; host: boolean; me: boolean }[];
}

const CROWN =
  '<svg class="h-crown" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#ffd34d" stroke="#8a5a00" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export interface WeaponChoice {
  primary: number;
  secondary: number;
}

export type WeaponSlot = 'primary' | 'secondary';

export class WeaponPicker {
  readonly el: HTMLElement;
  visible = false;
  primary: number = WEAPON_SMG;
  secondary: number = WEAPON_KNIVES;
  /** Header texts. */
  modeName = 'Deathmatch';
  serverName = '';
  mapName = '';
  /** The spectator button (offline only: online, the server assigns the teams). */
  canSpectate = false;
  /** A pause screen instead of the weapons (the waves mode: always the same weapons; the game stops meanwhile). */
  pauseOnly = false;
  spectating = false;
  /** The player already entered the game once (label of the main button). */
  joined = false;
  /** A private room (its tab), or null. */
  room: (() => RoomView | null) | null = null;
  /** Which tab shows (the room's only in a private room). */
  tab: 'weapons' | 'room' = 'weapons';
  /** The host's controls: an action, with its player, team or map. */
  onRoomAction: ((action: HostAction, extra?: { id?: number; team?: number; map?: string }) => void) | null = null;
  private copiedAt = 0;

  /** Every pick, with the complete choice. */
  onWeaponSelect: ((choice: WeaponChoice) => void) | null = null;
  /** PLAYER_TEAM_SPECTATOR to watch, PLAYER_TEAM_AUTO_ASSIGN to play again. */
  onTeamSelect: ((team: number) => void) | null = null;
  onQuit: (() => void) | null = null;
  onVisibilityChange: ((visible: boolean) => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly art: HudArt,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'h-abs h-pick';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      const id = Number(b.dataset.id);
      switch (b.dataset.act) {
        case 'primary':
          this.select('primary', id);
          break;
        case 'secondary':
          this.select('secondary', id);
          break;
        case 'back':
          this.hide();
          break;
        case 'spectate':
          this.hide();
          this.onTeamSelect?.(this.spectating ? PLAYER_TEAM_AUTO_ASSIGN : PLAYER_TEAM_SPECTATOR);
          break;
        case 'quit':
          this.hide();
          this.onQuit?.();
          break;
        case 'tab':
          this.tab = b.dataset.tab === 'room' ? 'room' : 'weapons';
          this.render();
          break;
        case 'copy':
          void this.copyLink();
          break;
        case 'host': {
          const action = b.dataset.a as HostAction;
          if (action === 'map') {
            const select = this.el.querySelector<HTMLSelectElement>('.h-rmap select');
            if (select?.value) this.onRoomAction?.('map', { map: select.value });
          } else this.onRoomAction?.(action, { id: b.dataset.id ? id : undefined, team: b.dataset.team ? Number(b.dataset.team) : undefined });
          break;
        }
      }
    });
  }

  /** The room changed (players, host, warm-up): the room's tab shows it at once. */
  refreshRoom(): void {
    // Not while the host's map list is open (a new list would close it)
    if (this.visible && this.tab === 'room' && !this.el.querySelector('.h-rmap select:focus')) this.render();
  }

  /** The invitation link goes to the clipboard (else it gets selected for Ctrl+C). */
  private async copyLink(): Promise<void> {
    const room = this.room?.();
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.link);
    } catch {
      const input = this.el.querySelector<HTMLInputElement>('.h-invite input');
      input?.select();
      return;
    }
    this.copiedAt = performance.now();
    this.render();
    setTimeout(() => this.visible && this.tab === 'room' && this.render(), 1700);
  }

  get choice(): WeaponChoice {
    return { primary: this.primary, secondary: this.secondary };
  }

  show(): void {
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
  }

  /** The menu key (k_menuAccess = Escape). */
  toggle(): void {
    this.setVisible(!this.visible);
  }

  private setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    if (v) this.render();
    else if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); // Space must not press a button
    this.el.hidden = !v;
    this.onVisibilityChange?.(v);
  }

  /** Picks a weapon for the next spawn (also used by the death screen's cards). */
  select(slot: WeaponSlot, id: number): void {
    if (slot === 'primary') this.primary = id;
    else this.secondary = id;
    if (this.visible) this.render();
    this.onWeaponSelect?.(this.choice);
  }

  render(): void {
    const room = this.room?.() ?? null;
    if (!room) this.tab = 'weapons';
    if (room && this.tab === 'room') {
      this.renderRoom(room);
      return;
    }
    if (this.pauseOnly) {
      const where = [this.modeName, this.mapName].filter(Boolean).map(esc).join(' · ');
      this.el.innerHTML =
        `<div class="h-pickin pause"><div class="h-pausecard"><span class="h-label">${where}</span><h2>${t('pause.title')}</h2>` +
        `<p class="sub">${t('pause.sub')}</p><div class="h-pfoot">` +
        `<button type="button" class="h-ghost danger" data-act="quit">${t('pick.quit')}</button>` +
        `<button type="button" class="h-play" data-act="back">${t('pick.back')} <span class="h-key">Esc</span></button>` +
        `</div></div></div>`;
      return;
    }
    const art = this.art;
    const primaries = enabledPrimaries();
    const secondaries = enabledSecondaries();
    const badge = `<span class="h-badge">${CHECK}${t('pick.selected')}</span>`;
    const cards = primaries
      .map((id) => {
        const w = weaponInfo(id);
        const sel = id === this.primary;
        const stats = w.stats
          .map((s) => `<span>${s.label}</span><span class="bar"><i style="width:${Math.max(6, Math.round(s.value * 100))}%"></i></span><b>${esc(s.text)}</b>`)
          .join('');
        return (
          `<button type="button" class="h-wcard${sel ? ' sel' : ''}" data-act="primary" data-id="${id}" aria-pressed="${sel}">${sel ? badge : ''}` +
          `<div class="h-wart">${w.original !== w.name ? `<small>${esc(w.original)}</small>` : ''}${weaponIcon(art, id, 'color')}</div>` +
          `<strong>${esc(w.name)}</strong><div class="h-stats">${stats}</div><p class="h-tip">${esc(w.tip)}</p></button>`
        );
      })
      .join('');
    const scards = secondaries
      .map((id) => {
        const w = weaponInfo(id);
        const sel = id === this.secondary;
        return (
          `<button type="button" class="h-scard${sel ? ' sel' : ''}" data-act="secondary" data-id="${id}" aria-pressed="${sel}">${sel ? badge : ''}` +
          `<div class="h-wart">${weaponIcon(art, id, 'color')}</div>` +
          `<div class="h-stxt"><strong>${esc(w.name)}</strong><p class="h-tip">${esc(w.tip)}</p><span class="meta">${esc(w.cooldown ?? '')} · ${esc(w.original)}</span></div></button>`
        );
      })
      .join('');

    const p = weaponInfo(this.primary);
    const hasSecondary = secondaries.includes(this.secondary);
    const s = weaponInfo(this.secondary);
    const loadout =
      `<span class="h-label">${t('pick.loadout')}</span>` +
      `<div class="h-lorow">${weaponIcon(art, p.id, 'white')}${esc(p.name)}` +
      (hasSecondary ? `<span class="plus">+</span>${weaponIcon(art, s.id, 'white')}${esc(s.name)}` : '') +
      `</div><div class="h-lorow"><small>${t(sv.sv_enableMolotov ? 'pick.alwaysMolotov' : 'pick.always')}</small></div>`;

    const where = [this.modeName, this.mapName, this.serverName].filter(Boolean).map(esc).join(' · ');
    this.el.innerHTML =
      `<div class="h-pickin${room ? ' tabbed' : ''}">` +
      (room ? this.tabs(room) : '') +
      `<div class="h-phead"><div><span class="h-label">${where}</span><h2>${t('pick.title')}</h2>` +
      `<span class="sub">${t('pick.sub')}</span></div><div class="h-panel h-loadout">${loadout}</div></div>` +
      `<div class="h-shead"><span class="h-label">${t('pick.primary')}</span><span class="hint">${mouseIcon('left')} ${t('pick.shoot')}</span></div>` +
      `<div class="h-grid">${cards}</div>` +
      (scards ? `<div class="h-shead"><span class="h-label">${t('pick.secondary')}</span><span class="hint"><span class="h-key">${t('hud.space')}</span> ${t('pick.use')}</span></div><div class="h-srow">${scards}</div>` : '') +
      `<div class="h-pfoot">` +
      `<button type="button" class="h-ghost danger" data-act="quit">${t('pick.quit')}</button>` +
      (this.canSpectate ? `<button type="button" class="h-ghost" data-act="spectate">${t(this.spectating ? 'pick.playAgain' : 'pick.spectate')}</button>` : '') +
      `<button type="button" class="h-play" data-act="back">${t(this.joined ? 'pick.back' : 'pick.join')} <span class="h-key">Esc</span></button>` +
      `</div></div>`;
  }

  /** The two tabs of a private room's menu: the weapons and the room. */
  private tabs(room: RoomView): string {
    const tab = (id: 'weapons' | 'room', label: string) => `<button type="button" class="${this.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}" aria-pressed="${this.tab === id}">${label}</button>`;
    const dot = room.warmup ? '<i class="warm"></i>' : '';
    return `<div class="h-ptabs">${tab('weapons', t('pick.title'))}${tab('room', `${dot}${t('room.tab')} <b>${room.code}</b>`)}</div>`;
  }

  /** The room's tab: the invitation, the players and the match, with the host's controls. */
  private renderRoom(room: RoomView): void {
    const host = room.isHost;
    const otherTeam = (team: number) => (team === PLAYER_TEAM_BLUE ? PLAYER_TEAM_RED : PLAYER_TEAM_BLUE);
    const rows = room.players
      .map((p) => {
        const inTeam = room.teams && (p.team === PLAYER_TEAM_BLUE || p.team === PLAYER_TEAM_RED);
        const team = inTeam ? `<span class="h-rteam t${p.team}">${esc(teamName(p.team))}</span>` : '';
        let tools = '';
        if (host && inTeam) tools += `<button type="button" class="h-mini" data-act="host" data-a="team" data-id="${p.id}" data-team="${otherTeam(p.team)}">${t('room.toTeam', { team: esc(teamName(otherTeam(p.team))) })}</button>`;
        if (host && !p.me) tools += `<button type="button" class="h-mini danger" data-act="host" data-a="kick" data-id="${p.id}">${t('room.kick')}</button>`;
        return (
          `<div class="h-rrow${p.me ? ' me' : ''}">${team}<b>${esc(plain(p.name))}</b>${p.tag ? `<small>#${esc(p.tag)}</small>` : ''}` +
          `${p.host ? `${CROWN}<span class="h-rhost">${t('room.hostTag')}</span>` : ''}<span class="sp"></span>${tools}</div>`
        );
      })
      .join('');
    const facts: [string, string][] = [
      [t('room.mode'), room.mode],
      [t('room.map'), room.map],
      [t('room.goal'), room.goal],
      [t('room.time'), room.time],
      [t('room.access'), t(room.locked ? 'room.locked' : 'room.open')],
    ];
    let controls = '';
    if (host) {
      const options = room.maps.map((m) => `<option value="${esc(m)}"${m === room.map ? ' selected' : ''}>${esc(m)}</option>`).join('');
      controls =
        (room.warmup
          ? `<button type="button" class="h-play h-rstart" data-act="host" data-a="start">${t('room.start')}</button><p class="h-rnote">${t('room.startHint')}</p>`
          : `<button type="button" class="h-ghost" data-act="host" data-a="restart">${t('room.restart')}</button>`) +
        `<div class="h-rmap"><select aria-label="${t('room.map')}">${options}</select><button type="button" class="h-ghost" data-act="host" data-a="map">${t('room.changeMap')}</button></div>` +
        `<div class="h-rbtns"><button type="button" class="h-ghost" data-act="host" data-a="${room.locked ? 'unlock' : 'lock'}">${t(room.locked ? 'room.unlock' : 'room.lock')}</button>` +
        (room.teams ? `<button type="button" class="h-ghost" data-act="host" data-a="shuffle">${t('room.shuffle')}</button>` : '') +
        `</div>`;
    } else {
      controls = `<p class="h-rnote">${room.host ? t(room.warmup ? 'room.waitHost' : 'room.onlyHost', { name: esc(plain(room.host)) }) : t('room.noHost')}</p>`;
    }
    const copied = performance.now() - this.copiedAt < 1600;
    const where = [this.modeName, this.mapName].filter(Boolean).map(esc).join(' · ');
    this.el.innerHTML =
      `<div class="h-pickin tabbed">` +
      this.tabs(room) +
      `<div class="h-phead"><div><span class="h-label">${where}</span><h2>${t('room.title')}</h2>` +
      `<span class="sub">${t(room.warmup ? 'room.warmupSub' : 'room.playingSub')}</span></div>` +
      `<div class="h-panel h-invite"><span class="h-label">${t('room.invite')}</span>` +
      `<div class="h-irow"><input type="text" readonly value="${esc(room.link)}" aria-label="${t('room.invite')}" />` +
      `<button type="button" class="h-ghost${copied ? ' ok' : ''}" data-act="copy">${copied ? CHECK + t('room.copied') : t('room.copy')}</button></div>` +
      `<small>${t('room.codeIs', { code: `<b>${room.code}</b>` })}</small></div></div>` +
      `<div class="h-room">` +
      `<div class="h-panel h-rplayers"><span class="h-label">${t('room.players', { n: room.players.length, max: room.maxPlayers })}</span><div class="h-rlist">${rows}</div></div>` +
      `<div class="h-panel h-rmatch"><span class="h-label">${t('room.match')}</span>` +
      `<dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${controls}</div>` +
      `</div>` +
      `<div class="h-pfoot">` +
      `<button type="button" class="h-ghost danger" data-act="quit">${t('pick.quit')}</button>` +
      `<button type="button" class="h-play" data-act="back">${t(this.joined ? 'pick.back' : 'pick.join')} <span class="h-key">Esc</span></button>` +
      `</div></div>`;
  }
}

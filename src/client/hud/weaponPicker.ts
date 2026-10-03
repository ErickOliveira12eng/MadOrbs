// The Esc menu: the weapons the player spawns with, as cards. Replaces the original clientRoot menu
// (Client.cpp); like there, the choice applies at the next spawn (nextSpawnWeapon /
// nextMeleeWeapon) and the menu shows when joining a game.
import { PLAYER_TEAM_AUTO_ASSIGN, PLAYER_TEAM_SPECTATOR, WEAPON_KNIVES, WEAPON_SMG } from '../../sim/constants';
import { sv } from '../../sim/gameVar';
import type { HudArt } from './hudArt';
import { CHECK, esc, mouseIcon, weaponIcon } from './icons';
import { enabledPrimaries, enabledSecondaries, weaponInfo } from './weaponInfo';
import { t } from '../../i18n';

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
  spectating = false;
  /** The player already entered the game once (label of the main button). */
  joined = false;

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
      }
    });
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
      `<div class="h-pickin">` +
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
}

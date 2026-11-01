// The Vesuvius's Forge (src/client/vesuviusProgress.ts), in the Survival window's Vesuvius tab once the server opens
// it: its own upgrades bought with its own currency, Obsidian (Erick, 31/10/2026: the Waves' Workshop doesn't count
// there). The Waves' Workshop's layout: the list by kind, the chosen one in detail with the button that buys it, and
// what the run goes in with (the weapon), the best time, PLAY.
import { track } from '../client/analytics';
import { weaponLook } from '../client/wavesPrize';
import { FORGE, FORGE_BARRIER, FORGE_DASH, FORGE_GROUPS, FORGE_STEP, VESUVIUS_LIVES, VESUVIUS_WEAPONS, buyForge, forgeCost, loadVesuvius, obsidianBalance, saveVesuvius, type ForgeGroup, type ForgeID, type ForgeUpgrade, type VesuviusProgress } from '../client/vesuviusProgress';
import { bigNum, num, t } from '../i18n';
import type { Account } from './account';
import { icon, type IconName } from './icons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const FORGE_ICON: Record<ForgeID, IconName> = {
  damage: 'crosshair',
  fire: 'zap',
  grenades: 'bomb',
  life: 'heart',
  armor: 'shield',
  barrier: 'shieldHalf',
  lives: 'orbs',
  speed: 'gauge',
  dash: 'wind',
};

/** Each kind's colour (the Workshop's tones): moving is the survival's green. */
const TONE: Record<ForgeGroup, string> = { attack: 'attack', defense: 'defense', moving: 'survival' };

/** Obsidian, the Vesuvius's currency: a dark glass gem with an ember's glow. */
export const obsidianIcon = (size = 18) => `<span class="obsidian-ico">${icon('obsidian', size)}</span>`;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

/** What an upgrade gives at a level, as the Forge says it. */
function forgeValue(id: ForgeID, level: number): string {
  const pct = (x: number) => `+${Math.round(x * 100)}%`;
  switch (id) {
    case 'damage':
    case 'fire':
    case 'speed':
      return pct(FORGE_STEP[id] * level);
    case 'life':
      return String(Math.round(100 * (1 + FORGE_STEP.life * level)));
    case 'armor':
      return level ? `-${Math.round(FORGE_STEP.armor * level * 100)}%` : '0%';
    case 'barrier':
      return `${Math.round(FORGE_BARRIER[level] * 100)}%`;
    case 'lives':
      return String(VESUVIUS_LIVES + level);
    case 'grenades':
      return String(2 + level);
    case 'dash':
      return level ? `${num(FORGE_DASH[level])} s` : '—';
  }
}

/** How many later levels the detail lists under the next one. */
const LATER_LEVELS = 3;

export class VesuviusForge {
  private selected: ForgeID | null = null;

  constructor(
    private readonly account: Account,
    /** PLAY: the window closes, the start checks with the server again. */
    private readonly onPlay: () => void,
    /** "Sign in": the account window. */
    private readonly onSignIn: () => void,
  ) {
    $('vsUpgrades').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
      if (!b) return;
      this.selected = b.dataset.pick as ForgeID;
      this.render();
    });
    $('vsDetail').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (!b || b.disabled) return;
      const id = b.dataset.buy as ForgeID;
      const p = buyForge(id);
      if (!p) return;
      track('vesuvius_upgrade', { upgrade: id, level: p.levels[id] });
      void this.account.saveVesuviusProgress();
      this.render();
      $('vsDetail').classList.add('bought');
      $('vsUpgrades').querySelector(`[data-pick="${id}"]`)?.classList.add('bought');
      $('vsObsidian').classList.add('bought');
    });
    $('vsWeapons').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-weapon]');
      if (!b) return;
      const p = loadVesuvius();
      p.weapon = Number(b.dataset.weapon);
      saveVesuvius(p);
      this.render();
    });
    $('vsPlay').addEventListener('click', () => this.onPlay());
    $('vsSave').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.onSignIn();
    });
  }

  /** The window opens on the Vesuvius: the first upgrade worth buying chosen. */
  reset(): void {
    this.selected = null;
  }

  render(): void {
    const p = loadVesuvius();
    const cash = obsidianBalance(p);
    for (const id of ['vsDetail', 'vsObsidian']) $(id).classList.remove('bought');
    $('vsObsidian').innerHTML = `${obsidianIcon(24)}<b>${bigNum(cash)}</b><span>${t('vesuvius.obsidian')}</span>`;
    if (!this.selected) this.selected = (FORGE.find((u) => (forgeCost(u, p.levels) ?? Infinity) <= cash) ?? FORGE[0]).id;
    $('vsUpgrades').innerHTML = FORGE_GROUPS.map((g) => {
      const rows = FORGE.filter((u) => u.group === g).map((u) => this.row(u, p, cash));
      return `<div class="wv-group ${TONE[g]}"><h3>${t(g === 'moving' ? 'vesuvius.groupMoving' : g === 'attack' ? 'workshop.group.attack' : 'workshop.group.defense')}</h3>${rows.join('')}</div>`;
    }).join('');
    this.renderDetail(p, cash);
    this.renderSide(p);
    $('vsSave').innerHTML = this.account.signedIn
      ? `<span class="ok">${icon('check', 14)}${t('vesuvius.savedAccount')}</span>`
      : `<span>${t('workshop.savedLocalShort')}</span><button type="button" class="wv-signin">${icon('user', 14)}${t('account.signIn')}</button>`;
  }

  private row(u: ForgeUpgrade, p: VesuviusProgress, cash: number): string {
    const level = p.levels[u.id];
    const cost = forgeCost(u, p.levels);
    const pips = u.costs.map((_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
    const price =
      cost === null ? `<span class="wv-price max">${t('workshop.max')}</span>` : `<span class="wv-price${cost > cash ? ' off' : ''}">${obsidianIcon(12)}${bigNum(cost)}</span>`;
    return (
      `<button type="button" class="wv-row ${TONE[u.group]}${u.id === this.selected ? ' on' : ''}" data-pick="${u.id}" title="${t(`up.${u.id}.desc`)}">` +
      `<span class="wv-ico">${icon(FORGE_ICON[u.id], 16)}</span><span class="wv-name">${t(`up.${u.id}`)}</span>` +
      `<span class="wv-pips">${pips}</span>${price}</button>`
    );
  }

  private renderDetail(p: VesuviusProgress, cash: number): void {
    const u = FORGE.find((x) => x.id === this.selected) ?? FORGE[0];
    const level = p.levels[u.id];
    const max = u.costs.length;
    const cost = forgeCost(u, p.levels);
    const bars = u.costs.map((_, i) => `<i class="${i < level ? 'on' : i === level ? 'next' : ''}"></i>`).join('');
    let body: string;
    if (cost === null) {
      body =
        `<div class="wv-compare maxed"><div class="wv-now on"><small>${t('workshop.maxed')}</small><b>${forgeValue(u.id, level)}</b></div></div>` +
        `<div class="wv-buyzone"><span class="wv-done">${icon('check', 18)}${t('workshop.maxed')}</span></div>`;
    } else {
      const later = [];
      for (let l = level + 2; l <= Math.min(max, level + 1 + LATER_LEVELS); l++) {
        later.push(`<li><span>${t('workshop.levelN', { n: l })}</span><b>${forgeValue(u.id, l)}</b><span>${obsidianIcon(12)}${bigNum(u.costs[l - 1])}</span></li>`);
      }
      const short = cost > cash;
      body =
        `<div class="wv-compare"><div class="wv-now"><small>${t('workshop.now')}</small><b>${forgeValue(u.id, level)}</b></div>` +
        `<span class="wv-arrow">${icon('arrowRight', 28)}</span>` +
        `<div class="wv-now on"><small>${t('workshop.levelN', { n: level + 1 })}</small><b>${forgeValue(u.id, level + 1)}</b></div></div>` +
        (later.length ? `<ul class="wv-later">${later.join('')}</ul>` : '') +
        `<div class="wv-buyzone"><button type="button" class="wv-buy vs-buy" data-buy="${u.id}"${short ? ' disabled' : ''}>` +
        `${t('workshop.upgradeTo', { n: level + 1 })}<span class="wv-cost">${obsidianIcon(15)}${bigNum(cost)}</span></button>` +
        `<small class="${short ? 'short' : ''}">${short ? t('vesuvius.need', { n: bigNum(cost - cash) }) : t('vesuvius.left', { n: bigNum(cash - cost) })}</small></div>`;
    }
    $('vsDetail').className = `wv-detail ${TONE[u.group]}`;
    $('vsDetail').innerHTML =
      `<div class="wv-detail-head"><span class="wv-bigico">${icon(FORGE_ICON[u.id], 36)}</span>` +
      `<div><small>${t(u.group === 'moving' ? 'vesuvius.groupMoving' : u.group === 'attack' ? 'workshop.group.attack' : 'workshop.group.defense')}</small><h4>${t(`up.${u.id}`)}</h4><p>${t(`up.${u.id}.desc`)}</p></div></div>` +
      `<div class="wv-level"><span>${t('workshop.level', { n: level, max })}</span><span class="wv-bars">${bars}</span></div>` +
      body;
  }

  /** The best time and the wins, the weapon to go in with (one at a time, with arrows), PLAY. */
  private renderSide(p: VesuviusProgress): void {
    $('vsRecord').innerHTML =
      `<div><small>${t('vesuvius.bestLabel')}</small><b>${p.best !== null ? clock(p.best) : '—'}</b></div>` +
      `<div><small>${t('vesuvius.winsLabel')}</small><b>${bigNum(p.wins)}</b></div>`;
    const all = VESUVIUS_WEAPONS;
    const i = Math.max(0, all.indexOf(p.weapon));
    const look = weaponLook(all[i]);
    const step = (d: number) => all[(i + d + all.length) % all.length];
    const arrow = (d: number, name: IconName, label: string) =>
      `<button type="button" class="wv-step" data-weapon="${step(d)}" aria-label="${label}">${icon(name, 18)}</button>`;
    const dots = all.map((w, k) => `<button type="button" class="${k === i ? 'on' : ''}" data-weapon="${w}" aria-label="${weaponLook(w).name}" title="${weaponLook(w).name}"></button>`).join('');
    $('vsWeapons').innerHTML =
      arrow(-1, 'chevronLeft', t('workshop.prevWeapon')) +
      `<div class="wv-gun"><span class="wv-gun-pic"><img src="${look.picture}" alt="" /></span><b>${look.name}</b><span class="wv-dots">${dots}</span></div>` +
      arrow(1, 'chevronRight', t('workshop.nextWeapon'));
    $('vsPlay').innerHTML = `${icon('play', 22)}${t('vesuvius.play')}`;
  }
}

// Small pieces of HTML shared by the HUD and the weapon picker.
import { WEAPON_COCKTAIL_MOLOTOV, WEAPON_GRENADE, WEAPON_KNIVES, WEAPON_SHIELD } from '../../sim/constants';
import type { HudArt } from './hudArt';
import { weaponInfo } from './weaponInfo';

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Text from the server without the original's colour codes (\x01..\x09). */
export const plain = (s: string): string => s.replace(/[\x00-\x09\x0b-\x1f]/g, '');

function knives(color: boolean): string {
  const b = color ? '#e9eef8' : 'currentColor';
  const e = color ? '#8f9bb3' : 'currentColor';
  const h = color ? '#8a5a2b' : 'currentColor';
  const blade = `<path d="M52 8L56 12L26 44L19 46L21 39Z" fill="${b}"/><path d="M52 8L56 12L26 44L24 42Z" fill="${e}" opacity=".55"/><path d="M22 42L12 52" stroke="${h}" stroke-width="7" stroke-linecap="round"/><path d="M16 37L27 48" stroke="${h}" stroke-width="3.5" stroke-linecap="round"/>`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${blade}<g transform="translate(64 0) scale(-1 1)">${blade}</g></svg>`;
}

function shield(color: boolean): string {
  if (!color) {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="5"/><path d="M19 28a14 14 0 0 1 12-11" stroke="currentColor" stroke-width="4.5" fill="none" stroke-linecap="round"/></svg>';
  }
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="h-shg" cx=".38" cy=".34" r=".72"><stop offset="0" stop-color="#eaffff" stop-opacity=".95"/><stop offset=".45" stop-color="#5fe6ff" stop-opacity=".6"/><stop offset="1" stop-color="#0a7bd6" stop-opacity=".4"/></radialGradient></defs><circle cx="32" cy="32" r="25" fill="url(#h-shg)" stroke="#9ff4ff" stroke-width="2"/><path d="M18 27a15 15 0 0 1 13-11" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85"/></svg>';
}

/**
 * A weapon as HTML: its rendered model (white silhouette on the HUD, in colour on the cards), the
 * original icon for grenades and molotovs, or its short name when there is no picture.
 */
export function weaponIcon(art: HudArt, id: number, mode: 'white' | 'color'): string {
  if (id === WEAPON_KNIVES) return `<span class="h-svg">${knives(mode === 'color')}</span>`;
  if (id === WEAPON_SHIELD) return `<span class="h-svg">${shield(mode === 'color')}</span>`;
  if (id === WEAPON_GRENADE || id === WEAPON_COCKTAIL_MOLOTOV) {
    const url = art.icon(id === WEAPON_GRENADE ? 'grenade' : 'molotov');
    if (url) return `<img class="icon" src="${url}" alt="">`;
  } else {
    const url = art.weapon(id);
    if (url) return `<img class="${mode === 'white' ? 'h-white' : ''}" src="${url}" alt="">`;
  }
  return `<span class="h-wname">${esc(weaponInfo(id).short)}</span>`;
}

export type MouseButton = 'left' | 'right' | 'middle';

/** A mouse with one button lit. */
export function mouseIcon(button: MouseButton): string {
  const lit =
    button === 'left'
      ? '<path d="M6.4 1.9C3.9 2.3 1.9 4.3 1.8 7.2V8h4.6z" fill="#ffe066"/>'
      : button === 'right'
        ? '<path d="M7.6 1.9c2.5.4 4.5 2.4 4.6 5.3V8H7.6z" fill="#ffe066"/>'
        : '<rect x="5.8" y="2.6" width="2.4" height="4.4" rx="1.2" fill="#ffe066"/>';
  const split = button === 'middle' ? '<path d="M1.2 8H12.8" stroke="currentColor" stroke-width="1.2"/>' : '<path d="M1.2 8H12.8M7 1.5V8" stroke="currentColor" stroke-width="1.2"/>';
  return `<svg class="h-mouse" viewBox="0 0 14 20" aria-hidden="true"><rect x="1" y="1" width="12" height="18" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>${split}${lit}</svg>`;
}

/** Connection bars for a ping in ms. */
export function signalIcon(ms: number): string {
  const n = ms < 100 ? 4 : ms < 200 ? 3 : 1;
  let bars = '';
  for (let i = 0; i < 4; i++) {
    bars += `<rect x="${i * 3.6}" y="${9 - i * 3}" width="2.4" height="${3 + i * 3}" rx="1" fill="currentColor" opacity="${i < n ? 1 : 0.25}"/>`;
  }
  return `<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">${bars}</svg>`;
}

/** The scoreboard colours of the original: green < 100 ms, yellow < 200, red above. */
export function pingColor(ms: number): string {
  return ms < 100 ? 'var(--h-ping-good)' : ms < 200 ? 'var(--h-ping-mid)' : 'var(--h-ping-bad)';
}

export const CHECK = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5L5 9.2L10 3" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The crosshair's look (Erick, 02/11/2026: players found it hard to see), chosen in the Esc menu (WeaponPicker's
// crosshair view, also on the waves' pause) and in the account window: its shape, colour and size, kept in this
// browser. HudLayer draws it.
import { t } from '../i18n';

export type CrosshairShape = 'circle' | 'circleDot' | 'cross' | 'dot';
export type CrosshairColor = 'white' | 'green' | 'yellow' | 'cyan' | 'blue' | 'pink';
export type CrosshairSize = 's' | 'm' | 'l';

export interface Crosshair {
  shape: CrosshairShape;
  color: CrosshairColor;
  size: CrosshairSize;
}

export const CROSSHAIR_SHAPES: CrosshairShape[] = ['circle', 'circleDot', 'cross', 'dot'];
export const CROSSHAIR_COLORS: Record<CrosshairColor, string> = {
  white: '#ffffff',
  green: '#5dff7a',
  yellow: '#ffe14d',
  cyan: '#4df2ff',
  blue: '#9fd8ff',
  pink: '#ff6bd6',
};
/** How big each size draws it (the HUD's 56 px crosshair, its reload ring with it). */
export const CROSSHAIR_SIZES: Record<CrosshairSize, number> = { s: 0.75, m: 1, l: 1.3 };

/** The game's crosshair until 02/11/2026: the white ring with four ticks. */
const DEFAULT: Crosshair = { shape: 'circle', color: 'white', size: 'm' };
const KEY = 'madorbs.crosshair';

function load(): Crosshair {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Crosshair> | null;
    if (!raw) return { ...DEFAULT };
    return {
      shape: CROSSHAIR_SHAPES.includes(raw.shape as CrosshairShape) ? (raw.shape as CrosshairShape) : DEFAULT.shape,
      color: raw.color && raw.color in CROSSHAIR_COLORS ? raw.color : DEFAULT.color,
      size: raw.size && raw.size in CROSSHAIR_SIZES ? raw.size : DEFAULT.size,
    };
  } catch {
    return { ...DEFAULT };
  }
}

let current = load();

/** The crosshair chosen (a new object at every change: HudLayer redraws when it isn't the one it drew). */
export function crosshair(): Crosshair {
  return current;
}

export function setCrosshair(change: Partial<Crosshair>): void {
  current = { ...current, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: this visit keeps it */
  }
}

/** A shape's lines (viewBox -28 -28 56 56, stroked; a dot is a tiny stroked circle). */
const SHAPE_PATHS: Record<CrosshairShape, string> = {
  circle: '<circle r="8"/><path d="M0 -17V-12M0 12V17M-17 0H-12M12 0H17"/>',
  circleDot: '<circle r="8"/><path d="M0 -17V-12M0 12V17M-17 0H-12M12 0H17"/><circle r="1.1"/>',
  cross: '<path d="M0 -15V-5M0 5V15M-15 0H-5M5 0H15"/>',
  dot: '<circle r="2.6"/>',
};

/** The shape drawn twice: a dark outline under it (it shows on light floors), the colour on top. */
export function crosshairShapes(c: Crosshair, colour = CROSSHAIR_COLORS[c.color]): string {
  const lines = SHAPE_PATHS[c.shape];
  return (
    `<g stroke="#000" stroke-opacity=".55" stroke-width="4.5" stroke-linecap="round" fill="none">${lines}</g>` +
    `<g stroke="${colour}" stroke-width="2" stroke-linecap="round" fill="none">${lines}</g>`
  );
}

/**
 * The crosshair's choices, the same in the Esc menu (WeaponPicker) and in the account window: a preview on a light floor
 * and a dark one, the shapes (each drawn in the colour chosen), the colours and the sizes, as buttons with data-act
 * xshape, xcolor or xsize and the choice in data-v (pickCrosshair takes a click on them).
 */
export function crosshairPicker(): string {
  const c = current;
  const svg = (look: Crosshair, px: number) => `<svg viewBox="-28 -28 56 56" width="${px}" height="${px}" aria-hidden="true">${crosshairShapes(look)}</svg>`;
  const opt = (act: string, v: string, on: boolean, label: string, inner: string) =>
    `<button type="button" class="xh-opt${on ? ' on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${on}" title="${label}" aria-label="${label}">${inner}</button>`;
  const shapes = CROSSHAIR_SHAPES.map((shape) => opt('xshape', shape, shape === c.shape, t(`xhair.s.${shape}`), svg({ ...c, shape }, 44))).join('');
  const colours = (Object.keys(CROSSHAIR_COLORS) as CrosshairColor[])
    .map((color) => opt('xcolor', color, color === c.color, t(`xhair.c.${color}`), `<i style="background:${CROSSHAIR_COLORS[color]}"></i>`))
    .join('');
  const sizes = (Object.keys(CROSSHAIR_SIZES) as CrosshairSize[]).map((size) => opt('xsize', size, size === c.size, t(`xhair.z.${size}`), t(`xhair.z.${size}`))).join('');
  const px = Math.round(56 * CROSSHAIR_SIZES[c.size]);
  return (
    `<div class="xh-body"><div class="xh-prev"><span class="floor light">${svg(c, px)}</span><span class="floor dark">${svg(c, px)}</span></div>` +
    `<div class="xh-opts"><span class="xh-label">${t('xhair.shape')}</span><div class="xh-row">${shapes}</div>` +
    `<span class="xh-label">${t('xhair.color')}</span><div class="xh-row">${colours}</div>` +
    `<span class="xh-label">${t('xhair.size')}</span><div class="xh-row sizes">${sizes}</div></div></div>`
  );
}

/** A click on one of crosshairPicker's buttons: the choice saved (true), else nothing (false). */
export function pickCrosshair(target: EventTarget | null): boolean {
  const b = (target as Element | null)?.closest<HTMLElement>('[data-act^="x"][data-v]');
  const v = b?.dataset.v;
  if (!b || !v) return false;
  if (b.dataset.act === 'xshape' && CROSSHAIR_SHAPES.includes(v as CrosshairShape)) setCrosshair({ shape: v as CrosshairShape });
  else if (b.dataset.act === 'xcolor' && v in CROSSHAIR_COLORS) setCrosshair({ color: v as CrosshairColor });
  else if (b.dataset.act === 'xsize' && v in CROSSHAIR_SIZES) setCrosshair({ size: v as CrosshairSize });
  else return false;
  return true;
}

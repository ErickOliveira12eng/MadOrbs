// The Orb picker: every skin drawn as a real orb with the player's colours, the colours, a few
// ready-made colour sets and a big preview that rolls.
import * as THREE from 'three';
import { crownSway, frontFor, turning, type OrbStudio } from './orbStudio';
import { SKINS, availableCrowns, availableSkins, randomOrb, skinInfo, wornCrown, type Settings } from './settings';
import { CROWN_TIERS, CROWN_WAVES, type CrownTier } from '../sim/crowns';
import { crownName, crownPicture } from '../client/wavesPrize';
import { skinWave } from '../client/wavesProgress';
import { icon } from './icons';
import { t } from '../i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The crown buttons say only the metal (the section's title says crown); the full name is the tooltip. */
const CROWN_LABEL = { bronze: 'orb.crownBronze', silver: 'orb.crownSilver', gold: 'orb.crownGold' } as const satisfies Record<CrownTier, string>;

/** Ready-made colour sets: [colour 1, colour 2, colour 3]. */
const PRESETS: [string, string, string][] = [
  ['#8080ff', '#0000ff', '#000080'],
  ['#ff8080', '#ff0000', '#800000'],
  ['#80ff80', '#00c000', '#006000'],
  ['#ffff80', '#ffd000', '#806000'],
  ['#ffc080', '#ff8000', '#804000'],
  ['#d080ff', '#8000ff', '#400080'],
  ['#ffa0d0', '#ff40a0', '#802050'],
  ['#80ffff', '#00c0ff', '#006080'],
  ['#ffffff', '#d0d0d0', '#808080'],
  ['#808080', '#202020', '#000000'],
];

const THUMB = 140;

export class OrbPicker {
  private readonly modal = $('orbModal');
  private readonly grid = $('orbGrid');
  private readonly big = $<HTMLCanvasElement>('orbBig');
  private readonly colorInputs: HTMLInputElement[] = [$<HTMLInputElement>('red'), $<HTMLInputElement>('green'), $<HTMLInputElement>('blue')];
  private readonly thumbs = new Map<string, HTMLCanvasElement>();
  private thumbsDirty = true;
  private thumbQueue: string[] = [];
  private rafId = 0;
  private spin = 0;
  private lastTime = 0;

  constructor(
    private readonly studio: OrbStudio,
    private readonly settings: Settings,
    /** The skin or its colours changed. */
    private readonly onChange: () => void,
  ) {
    for (const skin of SKINS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      const wave = skinWave(skin);
      b.title = wave ? t(`orb.${skin}` as 'orb.skin24') : t('orb.styleN', { n: +skin.slice(4) });
      const c = document.createElement('canvas');
      c.width = c.height = THUMB;
      b.appendChild(c);
      // The waves' exclusive Orbs: a badge, and a lock until their milestone
      if (wave) {
        b.classList.add('exclusive');
        b.insertAdjacentHTML('beforeend', `<span class="orb-lock">${icon('lock', 14)}${t('orb.atWave', { n: wave })}</span>`);
      }
      b.addEventListener('click', () => {
        if (b.classList.contains('locked')) return;
        this.settings.skin = skin;
        this.changed(false);
      });
      this.grid.appendChild(b);
      this.thumbs.set(skin, c);
    }
    const presets = $('orbPresets');
    for (const [c1, c2, c3] of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = t('orb.useColors');
      b.style.background = `linear-gradient(135deg, ${c1} 0 34%, ${c2} 34% 67%, ${c3} 67%)`;
      b.addEventListener('click', () => this.setColors(c1, c2, c3));
      presets.appendChild(b);
    }
    const keys = ['red', 'green', 'blue'] as const;
    this.colorInputs.forEach((input, i) =>
      input.addEventListener('input', () => {
        this.settings[keys[i]] = input.value;
        this.changed(true);
      }),
    );
    // The crowns (src/sim/crowns.ts): none, or one won in the waves
    const crowns = $('orbCrowns');
    for (const tier of ['none', ...CROWN_TIERS] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.crown = tier;
      b.innerHTML =
        tier === 'none'
          ? `<span class="none">${icon('x', 20)}</span><b>${t('orb.crownNone')}</b>`
          : `<img src="${crownPicture(tier)}" alt="" /><b>${t(CROWN_LABEL[tier])}</b><span class="orb-lock">${icon('lock', 12)}${t('orb.atWave', { n: CROWN_WAVES[tier] })}</span>`;
      if (tier !== 'none') b.title = crownName(tier);
      b.addEventListener('click', () => {
        if (b.classList.contains('locked')) return;
        this.settings.crown = tier;
        this.changed(false);
      });
      crowns.appendChild(b);
    }
    $('orbRandom').addEventListener('click', () => this.randomize());
    for (const el of this.modal.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.modal.hidden;
  }

  open(): void {
    const s = this.settings;
    this.colorInputs[0].value = s.red;
    this.colorInputs[1].value = s.green;
    this.colorInputs[2].value = s.blue;
    this.modal.hidden = false;
    this.thumbsDirty = true;
    // The exclusive Orbs won so far
    const open = availableSkins();
    for (const [skin, canvas] of this.thumbs) {
      const b = canvas.parentElement!;
      const locked = !open.includes(skin);
      b.classList.toggle('locked', locked);
      if (skinWave(skin)) b.title = locked ? t('orb.lockedTitle', { name: t(`orb.${skin}` as 'orb.skin24'), n: skinWave(skin)! }) : t(`orb.${skin}` as 'orb.skin24');
    }
    this.markSelected();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  close(): void {
    if (this.modal.hidden) return;
    this.modal.hidden = true;
    cancelAnimationFrame(this.rafId);
  }

  private setColors(c1: string, c2: string, c3: string): void {
    this.settings.red = this.colorInputs[0].value = c1;
    this.settings.green = this.colorInputs[1].value = c2;
    this.settings.blue = this.colorInputs[2].value = c3;
    this.changed(true);
  }

  /** A random style in one vivid colour (settings.randomOrb, like a first visit). */
  private randomize(): void {
    const orb = randomOrb();
    this.settings.skin = orb.skin;
    this.setColors(orb.red, orb.green, orb.blue);
  }

  private changed(colours: boolean): void {
    if (colours) this.thumbsDirty = true;
    this.markSelected();
    this.onChange();
  }

  private markSelected(): void {
    for (const [skin, canvas] of this.thumbs) canvas.parentElement!.setAttribute('aria-selected', String(skin === this.settings.skin));
    const worn = wornCrown(this.settings);
    const open = availableCrowns();
    for (const b of $('orbCrowns').querySelectorAll<HTMLButtonElement>('[data-crown]')) {
      const tier = b.dataset.crown as CrownTier | 'none';
      b.classList.toggle('locked', tier !== 'none' && !open.includes(tier));
      b.setAttribute('aria-checked', String(tier === (worn ?? 'none')));
    }
  }

  private frame(now: number): void {
    if (this.modal.hidden) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.spin += dt;
    void this.drawAll();
  }

  private drawing = false;

  private async drawAll(): Promise<void> {
    if (this.drawing) return;
    this.drawing = true;
    try {
      const s = this.settings;
      // Rolls slowly towards the viewer, like on the ground (the eye looks at us)
      this.studio.draw(this.big, await this.studio.texture(skinInfo(s), true), turning(s.skin, this.spin, 1.4), wornCrown(s), crownSway(this.spin));
      // The gallery is redrawn a few orbs per frame, so the page stays responsive
      if (this.thumbsDirty) {
        this.thumbsDirty = false;
        this.thumbQueue = [...this.thumbs.keys()];
      }
      for (const skin of this.thumbQueue.splice(0, 6)) {
        this.studio.draw(this.thumbs.get(skin)!, await this.studio.texture(skinInfo({ ...s, skin })), frontFor(skin));
      }
    } finally {
      this.drawing = false;
    }
  }
}

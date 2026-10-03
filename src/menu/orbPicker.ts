// The Orb picker: every skin drawn as a real orb with the player's colours, the colours, a few
// ready-made colour sets and a big preview that rolls.
import * as THREE from 'three';
import { FRONT, type OrbStudio } from './orbStudio';
import { SKINS, skinInfo, type Settings } from './settings';
import { t } from '../i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
      b.title = t('orb.styleN', { n: +skin.slice(4) });
      const c = document.createElement('canvas');
      c.width = c.height = THUMB;
      b.appendChild(c);
      b.addEventListener('click', () => {
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

  /** Like the bots' random look: a colour, a lighter and a darker version. */
  private randomize(): void {
    this.settings.skin = SKINS[Math.floor(Math.random() * SKINS.length)];
    const base = [Math.random(), Math.random(), Math.random()];
    const hex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
    this.setColors(hex(base.map((v) => v + 0.5)), hex(base), hex(base.map((v) => v * 0.5)));
  }

  private changed(colours: boolean): void {
    if (colours) this.thumbsDirty = true;
    this.markSelected();
    this.onChange();
  }

  private markSelected(): void {
    for (const [skin, canvas] of this.thumbs) canvas.parentElement!.setAttribute('aria-selected', String(skin === this.settings.skin));
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
      // Rolls slowly towards the viewer, like on the ground
      const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0.2).normalize(), -this.spin * 1.4);
      this.studio.draw(this.big, await this.studio.texture(skinInfo(s)), roll.multiply(FRONT));
      // The gallery is redrawn a few orbs per frame, so the page stays responsive
      if (this.thumbsDirty) {
        this.thumbsDirty = false;
        this.thumbQueue = [...this.thumbs.keys()];
      }
      for (const skin of this.thumbQueue.splice(0, 6)) {
        this.studio.draw(this.thumbs.get(skin)!, await this.studio.texture(skinInfo({ ...s, skin })), FRONT);
      }
    } finally {
      this.drawing = false;
    }
  }
}

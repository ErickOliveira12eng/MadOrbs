// Sparks drifting up over the start screen's background: small glowing dots in a 2D canvas,
// orange like the fire, a few pink and blue like the neon.

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  phase: number;
  sprite: number;
}

const COLORS = ['255,150,60', '255,190,90', '255,110,50', '255,90,140', '110,190,255'];
const WEIGHTS = [0.34, 0.22, 0.2, 0.12, 0.12];

export class Embers {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites: HTMLCanvasElement[];
  private readonly embers: Ember[] = [];
  private w = 0;
  private h = 0;
  private time = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly count = 55,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.sprites = COLORS.map((c) => glow(c));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private spawn(anywhere: boolean): Ember {
    let r = Math.random();
    let sprite = 0;
    while (sprite < WEIGHTS.length - 1 && r > WEIGHTS[sprite]) r -= WEIGHTS[sprite++];
    const maxLife = 5 + Math.random() * 7;
    // Mostly from the sides, where the fighting orbs are
    const side = Math.random();
    const x = side < 0.4 ? Math.random() * 0.3 : side < 0.8 ? 0.7 + Math.random() * 0.3 : Math.random();
    return {
      x: x * this.w,
      y: anywhere ? Math.random() * this.h : this.h * (0.55 + Math.random() * 0.5),
      vx: (Math.random() - 0.5) * 14,
      vy: -(18 + Math.random() * 42),
      size: 5 + Math.random() * 9,
      life: anywhere ? Math.random() * maxLife : maxLife,
      maxLife,
      phase: Math.random() * Math.PI * 2,
      sprite,
    };
  }

  /** Moves and draws the sparks (dt in seconds). */
  step(dt: number): void {
    this.time += dt;
    while (this.embers.length < this.count) this.embers.push(this.spawn(this.embers.length < this.count && this.time < 0.5));
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      e.life -= dt;
      if (e.life <= 0 || e.y < -20) {
        this.embers[i] = this.spawn(false);
        continue;
      }
      e.x += (e.vx + Math.sin(this.time * 1.3 + e.phase) * 12) * dt;
      e.y += e.vy * dt;
      const t = e.life / e.maxLife;
      // Fade in, flicker, fade out
      const a = Math.min(1, (1 - t) * 6) * Math.min(1, t * 2.5) * (0.65 + 0.35 * Math.sin(this.time * 9 + e.phase * 3));
      ctx.globalAlpha = Math.max(0, a);
      const s = e.size;
      ctx.drawImage(this.sprites[e.sprite], e.x - s / 2, e.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }
}

/** A soft dot with a bright core. */
function glow(rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,240,1)');
  r.addColorStop(0.18, `rgba(${rgb},1)`);
  r.addColorStop(0.45, `rgba(${rgb},0.35)`);
  r.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return c;
}

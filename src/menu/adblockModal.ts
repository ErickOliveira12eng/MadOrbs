// A friendly request to turn the ad blocker off: shown every time the start screen opens while a
// blocker is found (src/client/ads.ts adBlocked: only where banners would show and the visitor agreed
// to ads). It promises what is true: no ads during a match, no pop-ups. Closing it lets the visitor play.
import { adBlocked } from '../client/ads';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class AdblockModal {
  private readonly root = $('adblockModal');

  constructor() {
    for (const el of this.root.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    $('adblockReload').addEventListener('click', () => location.reload());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens when a blocker is found and `stillWanted()` (the start screen is still showing). */
  async check(stillWanted: () => boolean): Promise<void> {
    if ((await adBlocked()) && stillWanted()) this.open();
  }

  open(): void {
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }
}

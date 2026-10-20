// A friendly request to turn the ad blocker off. Since 20/10/2026 (Erick: shown every time the start screen
// opened, it covered the page for whoever the ad network sent nothing to, the AdSense reviewer too) it comes
// only when a match starts, from the second one this browser plays (madorbs.plays), once a visit, while a
// blocker is found (src/client/ads.ts adBlocked: only where banners would show and the visitor agreed to ads).
// It promises what is true: no ads during a match, no pop-ups. Closing it starts the match; "I turned it off"
// reloads the page.
import { adBlocked } from '../client/ads';
import { track } from '../client/analytics';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Matches started in this browser (the start of each one counts). */
const PLAYS_KEY = 'madorbs.plays';
/** From this match on, a blocker is asked about. */
const ASK_FROM = 2;

function countPlay(): number {
  try {
    const n = Math.max(0, Number(localStorage.getItem(PLAYS_KEY)) || 0) + 1;
    localStorage.setItem(PLAYS_KEY, String(n));
    return n;
  } catch {
    return 0;
  }
}

export class AdblockModal {
  private readonly root = $('adblockModal');
  private asked = false;
  private onClosed: (() => void) | null = null;

  constructor() {
    for (const el of this.root.querySelectorAll('[data-close]'))
      el.addEventListener('click', () => {
        track('adblock_action', { action: 'continue' });
        this.close();
      });
    $('adblockReload').addEventListener('click', () => {
      track('adblock_action', { action: 'reload' });
      location.reload();
    });
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

  /** A match is about to start: counted, and from the second one, once a visit, a blocker found asks first (resolves when closed). */
  async beforePlay(): Promise<void> {
    if (countPlay() < ASK_FROM || this.asked || !(await adBlocked())) return;
    this.asked = true;
    this.root.hidden = false;
    await new Promise<void>((done) => (this.onClosed = done));
  }

  close(): void {
    this.root.hidden = true;
    this.onClosed?.();
    this.onClosed = null;
  }
}

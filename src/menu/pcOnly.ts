// Phones and tablets: Mad Orbs is played with a keyboard and a mouse (Erick, 18/10/2026). On a touch-only device the
// start screen still shows everything else (the ranking, the stats, the account, the Orb, the Workshop, the text
// about the game), with a card on top saying so; trying to play (any mode: src/main.ts startGame) opens this window
// instead, with a way to send the link to oneself. The admin page (/admin) is a page of its own: not affected.
import { track } from '../client/analytics';
import { lang, t } from '../i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** A device with touch and nothing finer to point with (no mouse, no trackpad): a phone, a tablet. */
export function touchOnly(): boolean {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
}

/** The start page in this page's language, to open on the computer. */
const homeUrl = () => `${location.origin}${lang() === 'en' ? '' : `/${lang()}`}/`;

/**
 * Sends the link onwards (the phone's share sheet: WhatsApp, e-mail... to oneself), or copies it where there's none.
 * `copied`: the element that says it was copied.
 */
export async function sendLink(from: string, copied: HTMLElement): Promise<void> {
  const url = homeUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Mad Orbs', text: t('pc.shareText'), url });
      track('pc_only', { action: 'share', from });
      return;
    } catch (e) {
      // Closed by the visitor: nothing else to do
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    copied.hidden = false;
    track('pc_only', { action: 'copy', from });
  } catch {
    // No clipboard either: the address is in the text
  }
}

export class PcOnlyModal {
  private readonly root = $('pcModal');
  private from = '';

  constructor(openRanking: () => void) {
    for (const el of this.root.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    $('pcShare').addEventListener('click', () => void sendLink(this.from, $('pcCopied')));
    $('pcRanking').addEventListener('click', () => {
      track('pc_only', { action: 'ranking', from: this.from });
      this.close();
      openRanking();
    });
    $('pcAbout').addEventListener('click', () => {
      track('pc_only', { action: 'about', from: this.from });
      this.close();
      document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  /** `from`: what the visitor tried to play (for the analytics). */
  open(from: string): void {
    this.from = from;
    $('pcCopied').hidden = true;
    this.root.hidden = false;
    track('pc_only', { action: 'open', from });
  }

  close(): void {
    this.root.hidden = true;
  }
}

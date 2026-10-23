// The tutorials' question (Erick, 23/10/2026): the first time a player opens the waves (the Waves card) or plays online
// (PLAY NOW), "the tutorial, or play now?" (src/client/tutorial.ts), and never again. Whoever played that mode before
// (a waves record or Cores, an online record or stats: this browser's or the account's) isn't asked; the Training
// window always has both tutorials. What was asked and done stays in this browser (madorbs.tutorials).
import { track } from '../client/analytics';
import type { TutorialKind } from '../client/tutorial';
import { t } from '../i18n';
import { icon } from './icons';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const KEY = 'madorbs.tutorials';

interface Seen {
  /** The question came (or the tutorial was played from Training). */
  asked: TutorialKind[];
  /** The tutorial's last lesson was done. */
  done: TutorialKind[];
}

function read(): Seen {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Seen>;
    return { asked: Array.isArray(raw.asked) ? raw.asked : [], done: Array.isArray(raw.done) ? raw.done : [] };
  } catch {
    return { asked: [], done: [] };
  }
}

export function tutorialSeen(kind: TutorialKind, what: keyof Seen = 'asked'): boolean {
  return read()[what].includes(kind);
}

export function markTutorial(kind: TutorialKind, what: keyof Seen): void {
  const s = read();
  for (const list of what === 'done' ? [s.done, s.asked] : [s.asked]) if (!list.includes(kind)) list.push(kind);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: asked again at the next visit */
  }
}

/** The answer: the tutorial, play now, or nothing (closed). */
export type TutorialAnswer = 'tutorial' | 'play' | null;

export class TutorialModal {
  private readonly root = $('tutorialModal');
  private kind: TutorialKind = 'pvp';
  private answer: ((a: TutorialAnswer) => void) | null = null;

  constructor() {
    $('tutorialYes').addEventListener('click', () => this.close('tutorial'));
    $('tutorialNo').addEventListener('click', () => this.close('play'));
    for (const el of this.root.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.root.hidden) this.close();
    });
  }

  /** The question (once: it's kept as asked at once), answered when a button or the close is pressed. */
  ask(kind: TutorialKind): Promise<TutorialAnswer> {
    this.kind = kind;
    markTutorial(kind, 'asked');
    const waves = kind === 'waves';
    $('tutorialIcon').innerHTML = icon(waves ? 'waves' : 'crosshair', 34);
    $('tutorialTitle').textContent = t(waves ? 'tut.ask.wavesTitle' : 'tut.ask.pvpTitle');
    $('tutorialText').textContent = t(waves ? 'tut.ask.wavesText' : 'tut.ask.pvpText');
    this.root.hidden = false;
    $('tutorialYes').focus();
    return new Promise((done) => (this.answer = done));
  }

  close(answer: TutorialAnswer = null): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    track('tutorial_prompt', { kind: this.kind, choice: answer ?? 'close' });
    this.answer?.(answer);
    this.answer = null;
  }
}

// Sound settings: music, effects and ambience (rain, wind, lava) volume with mute buttons, from the
// start screen's gear button or, in game, from the button shown while the Esc menu is open. The
// start screen's speaker turns every sound off and on; M toggles the music.
import { icon, type IconName } from './icons';
import { applyAudioSettings, type Settings } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Channel = 'music' | 'sfx' | 'ambient';
const MUTED = { music: 'musicMuted', sfx: 'sfxMuted', ambient: 'ambientMuted' } as const;
const ICONS: Record<Channel, IconName> = { music: 'music', sfx: 'volume_2', ambient: 'cloud_rain' };

export class AudioPanel {
  private readonly panel = $('audioPanel');
  /** Start screen: all sound off / on. */
  private readonly muteButton = $('btnAudio');
  private readonly startButton = $('btnSettings');
  private readonly gameButton = $('gameAudioBtn');
  private readonly toast = $('toast');
  private toastTimer = 0;

  constructor(
    private readonly settings: Settings,
    private readonly save: () => void,
  ) {
    const s = settings;
    for (const kind of ['music', 'sfx', 'ambient'] as const) {
      const slider = $<HTMLInputElement>(`${kind}Volume`);
      slider.value = String(s[kind]);
      slider.addEventListener('input', () => {
        s[kind] = +slider.value;
        // Moving the slider means "I want to hear it"
        s[MUTED[kind]] = false;
        this.changed();
      });
      $(`${kind}Mute`).addEventListener('click', () => {
        s[MUTED[kind]] = !s[MUTED[kind]];
        this.changed();
      });
    }
    this.muteButton.addEventListener('click', () => this.toggleAll());
    for (const b of [this.startButton, this.gameButton]) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.panel.hidden = !this.panel.hidden;
      });
    }
    // Clicking elsewhere or Escape closes the panel
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!this.panel.hidden && !this.panel.contains(t) && !this.startButton.contains(t) && !this.gameButton.contains(t)) this.panel.hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.panel.hidden = true;
    });
    this.refresh();
  }

  /** In game the button is shown while the Esc menu is open (the mouse is free). */
  setInGame(menuOpen: boolean): void {
    this.gameButton.hidden = !menuOpen;
    if (!menuOpen) this.panel.hidden = true;
  }

  /** Everything off, or (when everything is off) everything back on. */
  private toggleAll(): void {
    const s = this.settings;
    const off = !this.allOff();
    for (const kind of ['music', 'sfx', 'ambient'] as const) {
      s[MUTED[kind]] = off;
      if (!off && s[kind] === 0) s[kind] = 50;
    }
    this.changed();
    this.showToast(off ? 'Som desligado' : 'Som ligado');
  }

  private allOff(): boolean {
    const s = this.settings;
    return (s.musicMuted || s.music === 0) && (s.sfxMuted || s.sfx === 0) && (s.ambientMuted || s.ambient === 0);
  }

  /** M key: music on/off, with a short notice. */
  toggleMusic(): void {
    this.settings.musicMuted = !this.settings.musicMuted;
    this.changed();
    this.showToast(this.settings.musicMuted ? 'Música desligada (M)' : 'Música ligada (M)');
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 1600);
  }

  private changed(): void {
    applyAudioSettings(this.settings);
    this.save();
    this.refresh();
  }

  private refresh(): void {
    const s = this.settings;
    for (const kind of ['music', 'sfx', 'ambient'] as const) {
      const muted = s[MUTED[kind]];
      $<HTMLInputElement>(`${kind}Volume`).value = String(s[kind]);
      $(`${kind}Value`).textContent = muted ? '—' : `${Math.round(s[kind])}%`;
      const mute = $(`${kind}Mute`);
      mute.innerHTML = icon(muted ? 'volume_x' : ICONS[kind], 18);
      mute.classList.toggle('off', muted);
    }
    const allOff = this.allOff();
    for (const b of [this.muteButton, this.gameButton]) {
      b.innerHTML = icon(allOff ? 'volume_x' : 'volume_2', 20);
      b.classList.toggle('off', allOff);
    }
    this.muteButton.title = allOff ? 'Ligar o som' : 'Desligar o som';
  }
}

// Sound settings in one small window: a main switch for every sound, then the music, effects and
// ambience (rain, wind, lava) volumes with their own mute buttons. It opens from the start screen's
// speaker or, in game, from the button shown while the Esc menu is open. M toggles the music.
import { icon, type IconName } from './icons';
import { applyAudioSettings, type Settings } from './settings';
import { t } from '../i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Channel = 'music' | 'sfx' | 'ambient';
const CHANNELS = ['music', 'sfx', 'ambient'] as const;
const MUTED = { music: 'musicMuted', sfx: 'sfxMuted', ambient: 'ambientMuted' } as const;
const ICONS: Record<Channel, IconName> = { music: 'music', sfx: 'volume_2', ambient: 'cloud_rain' };

export class AudioPanel {
  private readonly panel = $('audioPanel');
  private readonly master = $('masterMute');
  private readonly startButton = $('btnAudio');
  private readonly gameButton = $('gameAudioBtn');
  private readonly toast = $('toast');
  private toastTimer = 0;

  constructor(
    private readonly settings: Settings,
    private readonly save: () => void,
  ) {
    const s = settings;
    for (const kind of CHANNELS) {
      const slider = $<HTMLInputElement>(`${kind}Volume`);
      slider.value = String(s[kind]);
      slider.addEventListener('input', () => {
        s[kind] = +slider.value;
        // Moving the slider means "I want to hear it"
        s[MUTED[kind]] = false;
        s.muted = false;
        this.changed();
      });
      $(`${kind}Mute`).addEventListener('click', () => {
        s[MUTED[kind]] = !s[MUTED[kind]];
        if (!s[MUTED[kind]]) s.muted = false;
        this.changed();
      });
    }
    this.master.addEventListener('click', () => {
      s.muted = !s.muted;
      // Turning the sound on with every channel silent would still be silent
      if (!s.muted && CHANNELS.every((k) => s[MUTED[k]] || s[k] === 0)) {
        for (const k of CHANNELS) {
          s[MUTED[k]] = false;
          if (s[k] === 0) s[k] = 50;
        }
      }
      this.changed();
    });
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

  /** M key: music on/off, with a short notice. */
  toggleMusic(): void {
    const s = this.settings;
    s.musicMuted = !s.musicMuted;
    if (!s.musicMuted) s.muted = false;
    this.changed();
    this.showToast(t(s.musicMuted ? 'audio.musicOffM' : 'audio.musicOnM'));
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
    for (const kind of CHANNELS) {
      const muted = s[MUTED[kind]];
      $<HTMLInputElement>(`${kind}Volume`).value = String(s[kind]);
      $(`${kind}Value`).textContent = muted ? '—' : `${Math.round(s[kind])}%`;
      const mute = $(`${kind}Mute`);
      mute.innerHTML = icon(muted ? 'volume_x' : ICONS[kind], 18);
      mute.classList.toggle('off', muted);
    }
    this.master.setAttribute('aria-checked', String(!s.muted));
    $('masterState').textContent = t(s.muted ? 'audio.off' : 'audio.on');
    $('audioChannels').classList.toggle('dimmed', s.muted);
    const silent = s.muted || CHANNELS.every((k) => s[MUTED[k]] || s[k] === 0);
    for (const b of [this.startButton, this.gameButton]) {
      b.innerHTML = icon(silent ? 'volume_x' : 'volume_2', 20);
      b.classList.toggle('off', silent);
      b.title = t(silent ? 'audio.soundOff' : 'audio.title');
    }
  }
}

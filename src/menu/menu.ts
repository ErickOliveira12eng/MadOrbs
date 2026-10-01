// The start screen: the player's orb on its pedestal (arrows switch the style, "Personalizar Orb"
// opens the full picker), the name, play online in the chosen mode, the offline training, the
// controls, and how many play now. The background is a picture of a fight rendered by the game
// itself (tools/make-menu-bg.mjs), with drifting orbs and sparks on top.
import * as THREE from 'three';
import { MODE_INFO } from '../client/modes';
import { ROOM_MODES, type RoomMode, type RoomStatus } from '../net/protocol';
import { Embers } from './embers';
import { icon, type IconName } from './icons';
import { OrbPicker } from './orbPicker';
import { FRONT, type OrbStudio } from './orbStudio';
import { SKINS, saveSettings, skinInfo, type Settings } from './settings';
import { TrainingModal } from './training';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type PlayMode = 'online' | 'offline';

const MODE_ICONS: Record<RoomMode, IconName> = { dm: 'skull', tdm: 'team', ctf: 'flag_fill' };

/** The column is laid out for a window this high (top bar included) and zoomed to the real one. */
const DESIGN_HEIGHT = 940;
const DESIGN_WIDTH = 1400;

export class StartScreen {
  private readonly root = $('start');
  private readonly preview = $<HTMLCanvasElement>('orbPreview');
  private readonly nameInput = $<HTMLInputElement>('name');
  private readonly controls = $('controlsModal');
  private readonly picker: OrbPicker;
  private readonly training: TrainingModal;
  private readonly embers: Embers | null;
  private statusTimer = 0;
  /** The server's rooms (/health), null while unknown or unreachable. */
  private rooms: Partial<Record<RoomMode, RoomStatus>> | null = null;
  private serverUp: boolean | null = null;
  private rafId = 0;
  private spin = 0;
  private lastTime = 0;

  constructor(
    private readonly settings: Settings,
    private readonly studio: OrbStudio,
    private readonly onPlay: (mode: PlayMode) => void,
  ) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) el.innerHTML = icon(el.dataset.icon as IconName, 20);

    this.nameInput.value = settings.name;
    this.nameInput.addEventListener('input', () => {
      settings.name = this.nameInput.value.trim().slice(0, 31);
      saveSettings(settings);
    });

    this.picker = new OrbPicker(studio, settings, () => saveSettings(settings));
    this.training = new TrainingModal(
      settings,
      () => {
        saveSettings(settings);
        this.play('offline');
      },
      () => this.markMode(),
    );
    this.buildModes();
    for (const id of ['orbButton', 'orbCustomize']) $(id).addEventListener('click', () => this.picker.open());
    $('orbPrev').addEventListener('click', () => this.cycleSkin(-1));
    $('orbNext').addEventListener('click', () => this.cycleSkin(1));
    $('training').addEventListener('click', () => this.training.open());
    $<HTMLFormElement>('startForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.play('online');
    });

    // Controls window
    $('btnControls').addEventListener('click', () => (this.controls.hidden = false));
    for (const el of this.controls.querySelectorAll('[data-close]')) el.addEventListener('click', () => (this.controls.hidden = true));
    this.controls.addEventListener('pointerdown', (e) => {
      if (e.target === this.controls) this.controls.hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.controls.hidden = true;
    });

    const fullscreen = $('btnFullscreen');
    const updateFullscreen = () => {
      const on = !!document.fullscreenElement;
      fullscreen.innerHTML = icon(on ? 'minimize' : 'maximize', 20);
      fullscreen.title = on ? 'Sair da tela cheia' : 'Tela cheia';
    };
    fullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    });
    document.addEventListener('fullscreenchange', updateFullscreen);
    updateFullscreen();
    if (!document.documentElement.requestFullscreen) fullscreen.hidden = true;

    // Phones and tablets: the game needs a keyboard and a mouse
    $('touchNotice').hidden = !(matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);

    this.fit();
    window.addEventListener('resize', () => this.fit());
    this.embers = matchMedia('(prefers-reduced-motion: reduce)').matches ? null : new Embers($<HTMLCanvasElement>('bgSparks'));
    void this.makeBackground();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(message = ''): void {
    this.root.hidden = false;
    const box = $('message');
    box.textContent = message;
    box.hidden = !message;
    this.lastTime = performance.now();
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    void this.refreshStatus();
  }

  hide(): void {
    this.root.hidden = true;
    this.picker.close();
    this.training.close();
    this.controls.hidden = true;
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.statusTimer);
    this.embers?.clear();
  }

  private play(mode: PlayMode): void {
    if (!this.settings.name) {
      // Like the .io games: a name for those who don't pick one
      this.settings.name = `Orb${100 + Math.floor(Math.random() * 900)}`;
      this.nameInput.value = this.settings.name;
      saveSettings(this.settings);
    }
    this.onPlay(mode);
  }

  /** The arrows beside the orb: the previous or next style, same colours. */
  private cycleSkin(step: number): void {
    const i = Math.max(0, SKINS.indexOf(this.settings.skin));
    this.settings.skin = SKINS[(i + step + SKINS.length) % SKINS.length];
    saveSettings(this.settings);
  }

  /** Zoom of the centre column: laid out for DESIGN_HEIGHT, it fills the window's height. */
  private fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Narrow screens scroll: then the width decides
    const k = w < 760 ? Math.max(0.5, Math.min(1, w / 720)) : Math.max(0.6, Math.min(1.4, h / DESIGN_HEIGHT, w / DESIGN_WIDTH));
    document.documentElement.style.setProperty('--menu-k', k.toFixed(3));
  }

  /** One card per game mode (icon, name, one line, how many play it now). */
  private buildModes(): void {
    const box = $('modes');
    for (const mode of ROOM_MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `mode mode-${mode}`;
      b.dataset.mode = mode;
      b.setAttribute('role', 'radio');
      b.innerHTML =
        `<span class="mode-icon">${icon(MODE_ICONS[mode], 30)}</span><b>${MODE_INFO[mode].name}</b>` +
        `<small>${MODE_INFO[mode].tagline}</small><span class="mode-count" hidden></span>`;
      b.addEventListener('click', () => {
        this.settings.mode = mode;
        saveSettings(this.settings);
        this.markMode();
      });
      box.appendChild(b);
    }
    this.markMode();
  }

  private markMode(): void {
    for (const b of $('modes').querySelectorAll<HTMLElement>('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === this.settings.mode));
    this.renderStatus();
  }

  /** The game server of this page: is it up, and who plays in each mode. */
  private async refreshStatus(): Promise<void> {
    clearTimeout(this.statusTimer);
    if (this.root.hidden) return;
    try {
      const res = await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(String(res.status));
      const st = (await res.json()) as RoomStatus & { rooms?: Partial<Record<RoomMode, RoomStatus>> };
      // An older server has one Deathmatch room only
      this.rooms = st.rooms ?? { dm: { map: st.map, players: st.players, maxPlayers: st.maxPlayers } };
      this.serverUp = true;
    } catch {
      this.rooms = null;
      this.serverUp = false;
    }
    this.renderStatus();
    this.statusTimer = window.setTimeout(() => void this.refreshStatus(), 5000);
  }

  /** The "online" pill, the count on each mode card, and the line under JOGAR AGORA. */
  private renderStatus(): void {
    const pill = $('serverStatus');
    const text = pill.querySelector('.status-text')!;
    const sub = $('playSub');
    for (const b of $('modes').querySelectorAll<HTMLElement>('[data-mode]')) {
      const room = this.rooms?.[b.dataset.mode as RoomMode];
      const count = b.querySelector<HTMLElement>('.mode-count')!;
      count.hidden = !room || room.players === 0;
      count.textContent = room ? `${room.players} jogando` : '';
      b.classList.toggle('closed', this.serverUp === true && !room);
    }
    sub.textContent = 'Partida rápida';
    if (this.serverUp === null) return;
    if (!this.serverUp) {
      text.textContent = 'Servidor fora do ar';
      pill.className = 'online-pill down';
      return;
    }
    const total = Object.values(this.rooms ?? {}).reduce((n, r) => n + (r?.players ?? 0), 0);
    text.textContent = total === 0 ? 'Ninguém jogando agora' : total === 1 ? '1 jogador online' : `${total} jogadores online`;
    pill.className = 'online-pill ok';
    const room = this.rooms?.[this.settings.mode];
    if (!room) sub.textContent = `${MODE_INFO[this.settings.mode].name} fechado neste servidor`;
    else if (room.maxPlayers && room.players >= room.maxPlayers) sub.textContent = `Partida cheia · ${room.players}/${room.maxPlayers}`;
  }

  private drawing = false;

  /** The player's orb rolls slowly on its pedestal, the sparks drift. */
  private frame(now: number): void {
    if (this.root.hidden) return;
    this.rafId = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.embers?.step(dt);
    if (this.picker.isOpen || this.drawing) return; // the picker has its own preview
    this.spin += dt;
    this.drawing = true;
    void this.studio
      .texture(skinInfo(this.settings))
      .then((tex) => {
        const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0.2).normalize(), -this.spin * 1.1);
        this.studio.draw(this.preview, tex, roll.multiply(FRONT));
      })
      .finally(() => (this.drawing = false));
  }

  /** The rendered fight fades in; orbs of every style drift far behind the menu. */
  private async makeBackground(): Promise<void> {
    const scene = $('bgScene');
    const img = new Image();
    img.src = '/menu-bg.webp';
    img
      .decode()
      .then(() => {
        scene.style.backgroundImage = `url("${img.src}")`;
        scene.classList.add('ready');
      })
      .catch(() => {});

    const layer = $('bgOrbs');
    // [left %, top %, size px, far]
    const spots = [
      [3, 8, 84, false], [15, 22, 46, true], [26, 5, 38, true], [72, 6, 44, true],
      [83, 17, 70, false], [93, 8, 40, true], [58, 20, 30, true],
    ] as const;
    for (const [x, y, size, far] of spots) {
      const hue = Math.random();
      const base = hsl(hue, 0.85, 0.45);
      const info = skinInfo({
        skin: SKINS[Math.floor(Math.random() * SKINS.length)],
        red: hsl(hue, 0.9, 0.75),
        green: base,
        blue: hsl(hue, 0.9, 0.22),
      });
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
      const img = document.createElement('img');
      img.src = await this.studio.picture(info, 160, rot);
      img.className = far ? 'bg-orb far' : 'bg-orb';
      img.alt = '';
      img.style.left = `${x}%`;
      img.style.top = `${y}%`;
      img.style.width = img.style.height = `${size}px`;
      img.style.setProperty('--dur', `${16 + Math.random() * 12}s`);
      img.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 80)}px`);
      img.style.setProperty('--dy', `${Math.round((Math.random() - 0.5) * 60)}px`);
      img.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 400)}deg`);
      img.style.animationDelay = `${-Math.random() * 20}s`;
      layer.appendChild(img);
    }
  }
}

function hsl(h: number, s: number, l: number): string {
  const c = new THREE.Color().setHSL(h, s, l);
  return `#${c.getHexString()}`;
}

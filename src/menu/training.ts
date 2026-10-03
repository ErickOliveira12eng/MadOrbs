// Offline training: game mode, map (with a top view drawn from the map file), number of bots,
// difficulty.
import { CTF_MAPS, DM_MAPS, MAP_LIST } from '../client/mapList';
import { modeName, modeShort } from '../client/modes';
import { t } from '../i18n';
import { ROOM_MODES, type RoomMode } from '../net/protocol';
import { loadMap, type GameMap } from '../sim/map';
import type { Settings } from './settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The maps offered for a mode: Capture the Flag needs flag pods (the CTF maps). */
export function trainingMaps(mode: RoomMode): string[] {
  return mode === 'ctf' ? CTF_MAPS : MAP_LIST;
}

export class TrainingModal {
  private readonly modal = $('trainingModal');
  private readonly mapSelect = $<HTMLSelectElement>('map');
  private readonly bots = $<HTMLInputElement>('bots');
  private readonly preview = $<HTMLCanvasElement>('mapPreview');
  private readonly maps = new Map<string, Promise<GameMap>>();

  constructor(
    private readonly settings: Settings,
    private readonly onStart: () => void,
    private readonly onModeChange: () => void,
  ) {
    const modes = $('trainingMode');
    for (const mode of ROOM_MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.value = mode;
      b.textContent = modeShort(mode);
      b.title = modeName(mode);
      b.addEventListener('click', () => {
        this.settings.mode = mode;
        this.fillMaps();
        this.markMode();
        this.onModeChange();
        void this.drawPreview();
      });
      modes.appendChild(b);
    }
    this.mapSelect.addEventListener('change', () => {
      if (this.settings.mode === 'ctf') this.settings.ctfMap = this.mapSelect.value;
      else this.settings.map = this.mapSelect.value;
      void this.drawPreview();
    });
    this.bots.addEventListener('input', () => {
      this.settings.bots = +this.bots.value;
      $('botsValue').textContent = this.bots.value;
    });
    for (const b of $('skill').querySelectorAll<HTMLButtonElement>('button')) {
      b.addEventListener('click', () => {
        this.settings.skill = +b.dataset.value!;
        this.markSkill();
      });
    }
    $<HTMLFormElement>('trainingForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.close();
      this.onStart();
    });
    for (const el of this.modal.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) this.close();
    });
  }

  open(): void {
    const s = this.settings;
    this.fillMaps();
    this.bots.value = String(s.bots);
    $('botsValue').textContent = String(s.bots);
    this.markMode();
    this.markSkill();
    this.modal.hidden = false;
    void this.drawPreview();
  }

  close(): void {
    this.modal.hidden = true;
  }

  /** The map list of the chosen mode, with the mode's remembered map selected. */
  private fillMaps(): void {
    const s = this.settings;
    const list = trainingMaps(s.mode);
    this.mapSelect.replaceChildren();
    const option = (m: string, suffix: boolean): HTMLOptionElement => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m.replace(/^[A-Z]+-/, '') + (suffix ? ` (${m.split('-')[0]})` : '');
      return o;
    };
    if (s.mode === 'ctf') {
      for (const m of list) this.mapSelect.appendChild(option(m, false));
      if (!list.includes(s.ctfMap)) s.ctfMap = list[0];
      this.mapSelect.value = s.ctfMap;
      return;
    }
    const dm = document.createElement('optgroup');
    dm.label = 'Deathmatch';
    const others = document.createElement('optgroup');
    others.label = t('training.otherMaps');
    for (const m of list) (DM_MAPS.includes(m) ? dm : others).appendChild(option(m, !DM_MAPS.includes(m)));
    this.mapSelect.append(dm, others);
    if (!list.includes(s.map)) s.map = 'DM-Arena';
    this.mapSelect.value = s.map;
  }

  private markMode(): void {
    for (const b of $('trainingMode').querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.value === this.settings.mode));
  }

  private markSkill(): void {
    const buttons = [...$('skill').querySelectorAll<HTMLButtonElement>('button')];
    // The closest level to the saved value
    let best = buttons[1];
    for (const b of buttons) if (Math.abs(+b.dataset.value! - this.settings.skill) < Math.abs(+best.dataset.value! - this.settings.skill)) best = b;
    for (const b of buttons) b.setAttribute('aria-checked', String(b === best));
  }

  /** Walls, floor and spawn points seen from above, and the flag pods in Capture the Flag. */
  private async drawPreview(): Promise<void> {
    const name = this.mapSelect.value;
    let p = this.maps.get(name);
    if (!p) {
      p = loadMap(name);
      this.maps.set(name, p);
    }
    let map: GameMap;
    try {
      map = await p;
    } catch {
      return;
    }
    if (this.mapSelect.value !== name) return;
    const c = this.preview;
    const ctx = c.getContext('2d')!;
    const [w, h] = map.size;
    const cell = Math.max(1, Math.floor(Math.min(c.width / w, c.height / h)));
    const ox = Math.floor((c.width - w * cell) / 2);
    const oy = Math.floor((c.height - h * cell) / 2);
    ctx.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Map y grows upwards
        ctx.fillStyle = map.cells[y * w + x].passable ? '#23305c' : '#9fb4ff';
        ctx.fillRect(ox + x * cell, oy + (h - 1 - y) * cell, cell, cell);
      }
    }
    ctx.fillStyle = '#ffe066';
    for (const s of map.dmSpawns) {
      ctx.beginPath();
      ctx.arc(ox + s.x * cell, oy + (h - s.y) * cell, Math.max(2, cell * 0.45), 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.settings.mode === 'ctf') {
      map.flagPodPos.forEach((pod, i) => {
        const r = Math.max(4, cell * 0.9);
        ctx.fillStyle = i === 0 ? '#5b95ff' : '#ff5d5d';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.fillRect(ox + pod.x * cell - r, oy + (h - pod.y) * cell - r, r * 2, r * 2);
        ctx.strokeRect(ox + pod.x * cell - r, oy + (h - pod.y) * cell - r, r * 2, r * 2);
      });
    }
  }
}

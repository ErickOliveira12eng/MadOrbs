// The private room window (the start screen's "Private room" button, and the invitation link
// /r/<code>): make a room for your friends (mode, map or rotation, goal, time, players), join one
// with its code, or go back to (or close) the rooms this browser made, still open ("My rooms"). The
// server makes the room (POST /api/rooms) and gives a key that makes this browser its host, kept here
// so a reload (or coming back) still runs the room.
import { modeName, modeShort } from '../client/modes';
import { drawMapPreview } from '../client/mapPreview';
import { trainingMaps } from './training';
import { t } from '../i18n';
import { track } from '../client/analytics';
import {
  PRIVATE_CHOICES,
  ROOM_CODE_LENGTH,
  ROOM_MODES,
  isRoomCode,
  type CreateRoomAnswer,
  type PrivateRoomInfo,
  type PrivateRoomSettings,
  type RoomMode,
} from '../net/protocol';
import { loadMap, type GameMap } from '../sim/map';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The room to join: its code, the host key if this browser made it, and its mode. */
export interface PrivateRoomJoin {
  code: string;
  key?: string;
  mode: RoomMode;
}

/** The last settings used (a new room starts from them). */
const SETTINGS_KEY = 'madorbs.privateRoom';
/** The host keys of the rooms this browser made: { code: key } (the last few). */
const KEYS_KEY = 'madorbs.roomKeys';
const KEYS_KEPT = 10;

type Tab = 'create' | 'join' | 'mine';

/** A new room's settings when nothing was used before. */
const DEFAULTS: Record<RoomMode, { scoreLimit: number; timeLimit: number }> = {
  dm: { scoreLimit: 20, timeLimit: 10 },
  tdm: { scoreLimit: 50, timeLimit: 15 },
  ctf: { scoreLimit: 5, timeLimit: 15 },
};

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: it lasts for this page */
  }
}

/** The host key this browser keeps for a room it made. */
export function roomKey(code: string): string | undefined {
  return readJson<Record<string, string>>(KEYS_KEY)?.[code];
}

function saveRoomKey(code: string, key: string): void {
  const keys = Object.entries(readJson<Record<string, string>>(KEYS_KEY) ?? {}).filter(([c]) => c !== code);
  keys.push([code, key]);
  writeJson(KEYS_KEY, Object.fromEntries(keys.slice(-KEYS_KEPT)));
}

/** A room that closed: its key is of no use any more. */
function forgetRoomKey(code: string): void {
  const keys = readJson<Record<string, string>>(KEYS_KEY) ?? {};
  if (!(code in keys)) return;
  delete keys[code];
  writeJson(KEYS_KEY, keys);
}

/** The rooms this browser made (newest first). */
function myRoomCodes(): string[] {
  return Object.keys(readJson<Record<string, string>>(KEYS_KEY) ?? {}).reverse();
}

export class RoomModal {
  private readonly modal = $('roomModal');
  private readonly mapSelect = $<HTMLSelectElement>('roomMap');
  private readonly goal = $<HTMLSelectElement>('roomGoal');
  private readonly time = $<HTMLSelectElement>('roomTime');
  private readonly players = $<HTMLSelectElement>('roomPlayers');
  private readonly codeInput = $<HTMLInputElement>('roomCode');
  private readonly preview = $<HTMLCanvasElement>('roomPreview');
  private readonly maps = new Map<string, Promise<GameMap>>();
  private tab: Tab = 'create';
  /** The rooms of "My rooms" still open (read from the server), null while reading. */
  private mine: PrivateRoomInfo[] | null = null;
  private settings: PrivateRoomSettings;
  /** The room the code field points at (read from the server), null while unknown. */
  private info: PrivateRoomInfo | null = null;
  private busy = false;

  constructor(
    /** The mode chosen on the start screen (a new room starts with it). */
    private readonly currentMode: () => RoomMode,
    private readonly onJoin: (room: PrivateRoomJoin) => void,
  ) {
    const saved = readJson<Partial<PrivateRoomSettings>>(SETTINGS_KEY);
    const mode = saved?.mode && ROOM_MODES.includes(saved.mode) ? saved.mode : currentMode();
    this.settings = { mode, map: '', maxPlayers: 8, ...DEFAULTS[mode], ...saved };

    for (const b of $('roomTabs').querySelectorAll<HTMLButtonElement>('[data-tab]')) b.addEventListener('click', () => this.setTab(b.dataset.tab as Tab));
    $('roomMine').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-room]');
      if (!b) return;
      if (b.dataset.act === 'enter') this.enterMine(b.dataset.room!);
      else void this.closeMine(b.dataset.room!);
    });
    const modes = $('roomMode');
    for (const m of ROOM_MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.value = m;
      b.textContent = modeShort(m);
      b.title = modeName(m);
      b.addEventListener('click', () => {
        if (this.settings.mode === m) return;
        this.settings = { ...this.settings, mode: m, map: '', ...DEFAULTS[m] };
        this.fill();
      });
      modes.appendChild(b);
    }
    this.mapSelect.addEventListener('change', () => {
      this.settings.map = this.mapSelect.value;
      void this.drawPreview();
    });
    this.goal.addEventListener('change', () => this.pickLimits('goal'));
    this.time.addEventListener('change', () => this.pickLimits('time'));
    this.players.addEventListener('change', () => (this.settings.maxPlayers = Number(this.players.value)));
    this.codeInput.addEventListener('input', () => {
      const code = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
      if (code !== this.codeInput.value) this.codeInput.value = code;
      this.showError('');
      void this.lookUp(code);
    });
    $<HTMLFormElement>('roomForm').addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    for (const el of this.modal.querySelectorAll('[data-close]')) el.addEventListener('click', () => this.close());
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.hidden) this.close();
    });
  }

  /** Opens on "create", or on "join" with this room's code (an invitation link). */
  open(code?: string): void {
    this.showError('');
    this.busy = false;
    this.modal.hidden = false;
    if (code) {
      this.setTab('join');
      this.codeInput.value = code;
      void this.lookUp(code);
      return;
    }
    // A new room starts in the mode chosen on the start screen
    const mode = this.currentMode();
    if (mode !== this.settings.mode) this.settings = { ...this.settings, mode, map: '', ...DEFAULTS[mode] };
    this.setTab('create');
  }

  close(): void {
    this.modal.hidden = true;
  }

  private setTab(tab: Tab, error = ''): void {
    this.tab = tab;
    for (const b of $('roomTabs').querySelectorAll<HTMLButtonElement>('[data-tab]')) b.setAttribute('aria-checked', String(b.dataset.tab === tab));
    $('roomCreate').hidden = tab !== 'create';
    $('roomJoin').hidden = tab !== 'join';
    $('roomMine').hidden = tab !== 'mine';
    // "My rooms" has a button per room instead of the one below
    $('roomSubmit').hidden = tab === 'mine';
    this.showError(error);
    if (tab === 'create') this.fill();
    else if (tab === 'join') {
      this.renderInfo();
      setTimeout(() => this.codeInput.focus(), 0);
    } else void this.loadMine();
    this.updateSubmit();
  }

  /** "My rooms": the rooms this browser made that are still open (the closed ones are forgotten). */
  private async loadMine(): Promise<void> {
    this.mine = null;
    this.renderMine();
    const found: PrivateRoomInfo[] = [];
    await Promise.all(
      myRoomCodes().map(async (code) => {
        try {
          const res = await fetch(`/api/rooms/${code}`, { cache: 'no-store' });
          if (res.status === 404) forgetRoomKey(code);
          else if (res.ok) found.push((await res.json()) as PrivateRoomInfo);
        } catch {
          /* unreachable now: shown next time */
        }
      }),
    );
    const order = myRoomCodes();
    this.mine = found.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
    if (this.tab === 'mine') this.renderMine();
  }

  private renderMine(): void {
    const box = $('roomMine');
    box.replaceChildren();
    if (!this.mine || !this.mine.length) {
      const p = document.createElement('p');
      p.className = 'room-mine-empty';
      p.textContent = this.mine ? t('room.mineEmpty') : t('room.mineLoading');
      box.append(p);
      return;
    }
    for (const i of this.mine) {
      const row = document.createElement('div');
      row.className = 'room-mine-row';
      const text = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = `${modeName(i.mode)} · ${i.map}`;
      const line = document.createElement('span');
      const status = i.locked ? t('room.locked') : i.warmup ? t('room.warmupShort') : t('room.inProgress');
      line.textContent = [i.code, t('room.playersOf', { n: i.players, max: i.maxPlayers }), status].join(' · ');
      text.append(title, line);
      const enter = document.createElement('button');
      enter.type = 'button';
      enter.className = 'pill-btn';
      enter.dataset.room = i.code;
      enter.dataset.act = 'enter';
      enter.textContent = t('room.enter');
      const shut = document.createElement('button');
      shut.type = 'button';
      shut.className = 'btn-ghost danger';
      shut.dataset.room = i.code;
      shut.dataset.act = 'shut';
      shut.textContent = t('room.closeRoom');
      row.append(text, enter, shut);
      box.append(row);
    }
    const note = document.createElement('p');
    note.className = 'room-mine-empty';
    note.textContent = t('room.mineNote');
    box.append(note);
  }

  /** Back into one of our rooms, as its host. */
  private enterMine(code: string): void {
    const info = this.mine?.find((i) => i.code === code);
    if (!info) return;
    track('private_room_join', { mode: info.mode, host: true });
    this.close();
    this.onJoin({ code, key: roomKey(code), mode: info.mode });
  }

  /** Closes one of our rooms now (whoever is in it is told so): its place is free at once. */
  private async closeMine(code: string): Promise<void> {
    const info = this.mine?.find((i) => i.code === code);
    if (info && info.players > 0 && !window.confirm(t('room.closeConfirm', { n: info.players }))) return;
    try {
      const res = await fetch(`/api/rooms/${code}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: roomKey(code) }) });
      if (res.ok || res.status === 404) forgetRoomKey(code);
      else throw new Error(String(res.status));
    } catch {
      this.showError(t('room.errNet'));
      return;
    }
    track('private_room_close', { mode: info?.mode ?? '' });
    // A place is free again
    this.showError('');
    void this.loadMine();
  }

  /** The create tab's fields, from the settings. */
  private fill(): void {
    const s = this.settings;
    for (const b of $('roomMode').querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-checked', String(b.dataset.value === s.mode));
    // The rotation, then every map of the mode
    const maps = trainingMaps(s.mode);
    if (s.map && !maps.includes(s.map)) s.map = '';
    this.mapSelect.replaceChildren(new Option(t('room.rotation'), ''), ...maps.map((m) => new Option(m.replace(/^[A-Z]+-/, '') + (s.mode !== 'ctf' && !m.startsWith('DM-') ? ` (${m.split('-')[0]})` : ''), m)));
    this.mapSelect.value = s.map;
    const ctf = s.mode === 'ctf';
    $('roomGoalLabel').textContent = t(ctf ? 'room.goalCapturesLabel' : 'room.goalKillsLabel');
    const scores: readonly number[] = ctf ? PRIVATE_CHOICES.captures : PRIVATE_CHOICES.kills;
    if (!scores.includes(s.scoreLimit)) s.scoreLimit = DEFAULTS[s.mode].scoreLimit;
    if (!(PRIVATE_CHOICES.minutes as readonly number[]).includes(s.timeLimit)) s.timeLimit = DEFAULTS[s.mode].timeLimit;
    if (!(PRIVATE_CHOICES.players as readonly number[]).includes(s.maxPlayers)) s.maxPlayers = 8;
    this.goal.replaceChildren(...scores.map((n) => new Option(n ? String(n) : t('room.noLimit'), String(n))));
    this.time.replaceChildren(...PRIVATE_CHOICES.minutes.map((n) => new Option(n ? t('room.minutes', { n }) : t('room.noLimit'), String(n))));
    this.players.replaceChildren(...PRIVATE_CHOICES.players.map((n) => new Option(String(n), String(n))));
    this.goal.value = String(s.scoreLimit);
    this.time.value = String(s.timeLimit);
    this.players.value = String(s.maxPlayers);
    void this.drawPreview();
  }

  /** A match must end somehow: "no limit" on both switches the other one back. */
  private pickLimits(changed: 'goal' | 'time'): void {
    const s = this.settings;
    s.scoreLimit = Number(this.goal.value);
    s.timeLimit = Number(this.time.value);
    if (s.scoreLimit === 0 && s.timeLimit === 0) {
      if (changed === 'goal') s.timeLimit = DEFAULTS[s.mode].timeLimit;
      else s.scoreLimit = DEFAULTS[s.mode].scoreLimit;
      this.goal.value = String(s.scoreLimit);
      this.time.value = String(s.timeLimit);
    }
  }

  /** The chosen map from above (the rotation: its name only). */
  private async drawPreview(): Promise<void> {
    const name = this.settings.map;
    const c = this.preview;
    if (!name) {
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#cdd5f5';
      g.font = '800 17px Nunito Variable, sans-serif';
      g.textAlign = 'center';
      g.fillText(t('room.rotation'), c.width / 2, c.height / 2 - 4);
      g.font = '700 13px Nunito Variable, sans-serif';
      g.fillStyle = '#98a3c7';
      g.fillText(t('room.rotationSub'), c.width / 2, c.height / 2 + 18);
      return;
    }
    let p = this.maps.get(name);
    if (!p) {
      p = loadMap(name);
      this.maps.set(name, p);
    }
    try {
      const map = await p;
      if (this.settings.map === name) drawMapPreview(c, map, this.settings.mode === 'ctf');
    } catch {
      /* the preview stays as it was */
    }
  }

  /** Reads the room a full code points at, for the card above the field. */
  private async lookUp(code: string): Promise<void> {
    this.info = null;
    this.renderInfo();
    this.updateSubmit();
    if (!isRoomCode(code)) return;
    try {
      const res = await fetch(`/api/rooms/${code}`, { cache: 'no-store' });
      if (this.codeInput.value !== code) return;
      if (res.status === 404) {
        this.showError(t('room.errNoRoom'));
        return;
      }
      this.info = (await res.json()) as PrivateRoomInfo;
    } catch {
      if (this.codeInput.value === code) this.showError(t('room.errNet'));
      return;
    }
    this.renderInfo();
    this.updateSubmit();
  }

  /** The room about to be joined: mode, map, players, host. */
  private renderInfo(): void {
    const box = $('roomInfo');
    const i = this.info;
    box.hidden = !i;
    if (!i) return;
    const status = i.locked ? t('room.locked') : i.warmup ? t('room.warmupShort') : t('room.inProgress');
    box.replaceChildren();
    const title = document.createElement('b');
    title.textContent = `${modeName(i.mode)} · ${i.map}`;
    const line = document.createElement('span');
    line.textContent = [t('room.playersOf', { n: i.players, max: i.maxPlayers }), i.host ? t('room.hostIs', { name: i.host }) : '', status].filter(Boolean).join(' · ');
    box.append(title, line);
  }

  private updateSubmit(): void {
    const join = this.tab === 'join';
    $('roomSubmitText').textContent = t(join ? 'room.joinButton' : 'room.createButton');
    $<HTMLButtonElement>('roomSubmit').disabled = this.busy || (join && (!this.info || this.info.locked || this.info.players >= this.info.maxPlayers) && !roomKey(this.codeInput.value));
  }

  private showError(text: string): void {
    const el = $('roomError');
    el.textContent = text;
    el.hidden = !text;
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (this.tab === 'join') {
      const code = this.codeInput.value;
      if (!isRoomCode(code) || !this.info) return;
      track('private_room_join', { mode: this.info.mode, host: !!roomKey(code) });
      this.close();
      this.onJoin({ code, key: roomKey(code), mode: this.info.mode });
      return;
    }
    this.busy = true;
    this.updateSubmit();
    this.showError('');
    const s = { ...this.settings };
    writeJson(SETTINGS_KEY, s);
    let answer: CreateRoomAnswer;
    try {
      const res = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
      answer = (await res.json()) as CreateRoomAnswer;
    } catch {
      answer = { error: 'bad' };
      this.showError(t('room.errNet'));
    } finally {
      this.busy = false;
      this.updateSubmit();
    }
    if ('error' in answer) {
      // Too many rooms of ours open: the list of them, to go back to one or close one
      if (answer.error === 'limit') this.setTab('mine', t('room.errLimit'));
      else if (!$('roomError').textContent) this.showError(t(answer.error === 'full' ? 'room.errFull' : 'room.errNet'));
      return;
    }
    saveRoomKey(answer.code, answer.key);
    track('private_room_create', { mode: s.mode, map: s.map || 'rotation', players: s.maxPlayers });
    this.close();
    this.onJoin({ code: answer.code, key: answer.key, mode: s.mode });
  }
}

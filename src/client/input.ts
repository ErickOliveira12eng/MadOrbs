// Keyboard / mouse state (port of the dki input module usage).
//
// The original clipped the OS cursor to the game window while playing (dkwClipMouse). In the
// browser we emulate it with pointer lock and a virtual cursor clamped to the canvas; without
// pointer lock the real cursor position is used.

export type KeyBinding = string; // KeyboardEvent.code, or "Mouse0" / "Mouse1" / "Mouse2"

/** Default bindings from GameVar.cpp (W A S D, Mouse1 shoot, Mouse2 grenade, Mouse3 molotov...). */
export const bindings = {
  moveUp: 'KeyW',
  moveDown: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  shoot: 'Mouse0',
  throwGrenade: 'Mouse2',
  throwMolotov: 'Mouse1',
  pickUp: 'KeyF',
  melee: 'Space',
  showScore: 'Tab',
  menuAccess: 'Escape',
  chatAll: 'KeyT',
};

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  /** Cursor in canvas pixels (top-left origin). */
  mouseX = 0;
  mouseY = 0;
  wheel = 0;
  locked = false;
  /** When true, game keys are ignored (chat box focused, menus...). */
  enabled = true;
  private el: HTMLElement;
  onPointerLockChange?: (locked: boolean) => void;

  constructor(el: HTMLElement) {
    this.el = el;
    this.mouseX = el.clientWidth / 2;
    this.mouseY = el.clientHeight / 2;

    window.addEventListener('keydown', (e) => {
      if (this.isGameKey(e.code)) e.preventDefault();
      if (!e.repeat) this.press(e.code);
    });
    window.addEventListener('keyup', (e) => this.release(e.code));
    window.addEventListener('blur', () => {
      for (const k of this.down) this.released.add(k);
      this.down.clear();
    });

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.press(`Mouse${e.button}`);
    });
    window.addEventListener('mouseup', (e) => this.release(`Mouse${e.button}`));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('auxclick', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        this.wheel += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );

    window.addEventListener('mousemove', (e) => {
      const rect = this.el.getBoundingClientRect();
      if (this.locked) {
        this.mouseX = Math.max(0, Math.min(rect.width - 1, this.mouseX + e.movementX));
        this.mouseY = Math.max(0, Math.min(rect.height - 1, this.mouseY + e.movementY));
      } else {
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      this.onPointerLockChange?.(this.locked);
    });
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.el) return;
    try {
      const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* not supported */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  private isGameKey(code: string): boolean {
    return code === 'Tab' || code === 'Space' || code.startsWith('Arrow');
  }

  private press(code: string): void {
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  }

  private release(code: string): void {
    if (this.down.has(code)) this.released.add(code);
    this.down.delete(code);
  }

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  /** Edge-triggered press since the last `endTick()` (DKI_DOWN). */
  wasPressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  /** Raw access ignoring `enabled` (for menus/chat). */
  rawPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Clears edge states; call once per simulation tick after reading them. */
  endTick(): void {
    this.pressed.clear();
    this.released.clear();
    this.wheel = 0;
  }
}

// A map seen from above: walls, floor, spawn points and, in Capture the Flag, the flag pods. Used by
// the training window and the end-of-match map vote.
import type { GameMap } from '../sim/map';

export function drawMapPreview(c: HTMLCanvasElement, map: GameMap, ctf: boolean): void {
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
  if (ctf) {
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

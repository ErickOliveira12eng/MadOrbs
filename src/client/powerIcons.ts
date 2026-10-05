// The waves mode's power-up icons, drawn on a canvas: a coloured disc with a white symbol. Used on
// the floor (a sprite, src/client/render/wavesRenderer.ts) and on the HUD (a data URL).
import { POWERS, type PowerKind } from './waves';

const cache = new Map<PowerKind, HTMLCanvasElement>();
const urls = new Map<PowerKind, string>();

/** The icon of `kind` (128 x 128), drawn once. */
export function powerIcon(kind: PowerKind): HTMLCanvasElement {
  const done = cache.get(kind);
  if (done) return done;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // Disc with a darker rim and a light top
  const color = POWERS[kind].color;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.arc(64, 68, 58, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  const shine = g.createLinearGradient(0, 8, 0, 120);
  shine.addColorStop(0, 'rgba(255,255,255,0.45)');
  shine.addColorStop(0.5, 'rgba(255,255,255,0)');
  shine.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = shine;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.stroke();
  // The symbol
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  symbol(g, kind);
  cache.set(kind, c);
  return c;
}

/** The icon as an image address, for the HUD. */
export function powerIconUrl(kind: PowerKind): string {
  let url = urls.get(kind);
  if (!url) {
    url = powerIcon(kind).toDataURL('image/png');
    urls.set(kind, url);
  }
  return url;
}

function symbol(g: CanvasRenderingContext2D, kind: PowerKind): void {
  const poly = (pts: number[][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  };
  switch (kind) {
    case 'life':
      g.fillRect(53, 30, 22, 68);
      g.fillRect(30, 53, 68, 22);
      break;
    case 'ammo':
      // A grenade: body, lever, pin ring
      g.beginPath();
      g.arc(64, 74, 24, 0, Math.PI * 2);
      g.fill();
      g.fillRect(54, 38, 20, 14);
      g.lineWidth = 6;
      g.beginPath();
      g.arc(86, 40, 9, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'weapon':
      // A gun from the side
      poly([[24, 52], [100, 52], [104, 62], [72, 62], [66, 84], [52, 84], [56, 62], [24, 62]]);
      g.fillRect(96, 44, 6, 10);
      break;
    case 'speed':
      poly([[72, 22], [36, 72], [60, 72], [52, 106], [92, 52], [66, 52]]);
      break;
    case 'rapid':
      g.lineWidth = 12;
      for (const x of [34, 62]) {
        g.beginPath();
        g.moveTo(x, 38);
        g.lineTo(x + 26, 64);
        g.lineTo(x, 90);
        g.stroke();
      }
      break;
    case 'shield':
      poly([[64, 24], [96, 36], [92, 72], [64, 104], [36, 72], [32, 36]]);
      g.fillStyle = POWERS.shield.color;
      poly([[64, 40], [82, 47], [79, 70], [64, 88]]);
      break;
    case 'fury':
      g.font = '900 54px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('×2', 64, 68);
      break;
    case 'extraLife':
      g.beginPath();
      g.moveTo(64, 100);
      g.bezierCurveTo(14, 66, 30, 22, 64, 46);
      g.bezierCurveTo(98, 22, 114, 66, 64, 100);
      g.fill();
      break;
    case 'permFire':
      // A crosshair with an up arrow: fire rate, for good
      g.lineWidth = 7;
      g.beginPath();
      g.arc(56, 70, 22, 0, Math.PI * 2);
      g.stroke();
      g.fillRect(53, 40, 6, 14);
      g.fillRect(53, 86, 6, 14);
      g.fillRect(26, 67, 14, 6);
      g.fillRect(72, 67, 14, 6);
      upArrow(g);
      break;
    case 'permDamage':
      // A blade with an up arrow
      poly([[30, 92], [72, 50], [80, 42], [84, 46], [76, 58], [36, 98]]);
      g.fillRect(28, 82, 22, 6);
      upArrow(g);
      break;
    case 'permArmor':
      poly([[56, 30], [82, 40], [79, 70], [56, 96], [33, 70], [30, 40]]);
      upArrow(g);
      break;
    case 'permSpeed':
      // Three speed lines and an up arrow
      g.lineWidth = 8;
      for (const [y, w] of [[48, 40], [66, 50], [84, 34]]) {
        g.beginPath();
        g.moveTo(26, y);
        g.lineTo(26 + w, y);
        g.stroke();
      }
      upArrow(g);
      break;
    case 'poison':
      // A drop
      g.beginPath();
      g.moveTo(64, 26);
      g.bezierCurveTo(70, 46, 92, 62, 92, 78);
      g.arc(64, 78, 28, 0, Math.PI, false);
      g.bezierCurveTo(36, 62, 58, 46, 64, 26);
      g.fill();
      g.fillStyle = POWERS.poison.color;
      g.beginPath();
      g.arc(56, 82, 8, 0, Math.PI * 2);
      g.fill();
      break;
    case 'ice':
      // A snowflake
      g.lineWidth = 7;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        g.beginPath();
        g.moveTo(64 - Math.cos(a) * 36, 64 - Math.sin(a) * 36);
        g.lineTo(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36);
        g.stroke();
      }
      g.beginPath();
      g.arc(64, 64, 9, 0, Math.PI * 2);
      g.fill();
      break;
    case 'bomb':
      g.beginPath();
      g.arc(58, 74, 28, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(74, 52);
      g.quadraticCurveTo(84, 30, 98, 34);
      g.stroke();
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(100, 32, 8, 0, Math.PI * 2);
      g.fill();
      break;
  }
}

/** The permanent ones' mark: a small up arrow in the top right corner. */
function upArrow(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(98, 22);
  g.lineTo(114, 42);
  g.lineTo(104, 42);
  g.lineTo(104, 56);
  g.lineTo(92, 56);
  g.lineTo(92, 42);
  g.lineTo(82, 42);
  g.closePath();
  g.fill();
}

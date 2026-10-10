import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

// The game server listens on PORT (3000). In development Vite serves the page and
// forwards the WebSocket and /health to it; in production the server serves everything itself.
const gameServer = `localhost:${process.env.PORT || 3000}`;

/**
 * A hash of the game files and the start screen's pictures (src/sim/assetVersion.ts): their
 * addresses carry it, so browsers fetch them again only when they change.
 */
function assetVersion(): string {
  const hash = createHash('sha256');
  const files = [
    ...readdirSync('public/assets', { recursive: true, encoding: 'utf8' }).map((f) => join('public/assets', f)),
    'public/menu-bg.webp',
    ...readdirSync('public/menu', { encoding: 'utf8' }).map((f) => join('public/menu', f)),
  ].sort();
  for (const f of files) {
    if (!statSync(f).isFile()) continue;
    hash.update(f.replace(/\\/g, '/'));
    hash.update(readFileSync(f));
  }
  return hash.digest('hex').slice(0, 10);
}

export default defineConfig(({ isSsrBuild }) => ({
  define: { __ASSET_VERSION__: JSON.stringify(isSsrBuild ? '' : assetVersion()) },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: `ws://${gameServer}`, ws: true },
      '/health': `http://${gameServer}`,
      '/admin': `http://${gameServer}`,
      '/api': `http://${gameServer}`,
    },
  },
  build: isSsrBuild
    ? // "vite build --ssr src/server/index.ts": the Node server in dist-server/ (ws stays external)
      { outDir: 'dist-server', target: 'node22', copyPublicDir: false, emptyOutDir: true }
    : // public/assets holds the original game files; keep Vite's bundles out of that folder.
      { target: 'es2022', assetsDir: 'bundle', chunkSizeWarningLimit: 2000 },
}));

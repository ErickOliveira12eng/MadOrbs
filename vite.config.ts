import { defineConfig } from 'vite';

// The game server listens on PORT (3000). In development Vite serves the page and
// forwards the WebSocket and /health to it; in production the server serves everything itself.
const gameServer = `localhost:${process.env.PORT || 3000}`;

export default defineConfig(({ isSsrBuild }) => ({
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: `ws://${gameServer}`, ws: true },
      '/health': `http://${gameServer}`,
    },
  },
  build: isSsrBuild
    ? // "vite build --ssr src/server/index.ts": the Node server in dist-server/ (ws stays external)
      { outDir: 'dist-server', target: 'node22', copyPublicDir: false, emptyOutDir: true }
    : // public/assets holds the original game files; keep Vite's bundles out of that folder.
      { target: 'es2022', assetsDir: 'bundle', chunkSizeWarningLimit: 2000 },
}));

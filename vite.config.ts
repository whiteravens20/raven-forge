import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const __dirname = import.meta.dirname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      // Artwork lives at the repo root because electron-builder needs it there
      // for packaging; the renderer reaches it through this alias.
      '@assets': path.resolve(__dirname, 'assets'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@components': path.resolve(__dirname, 'src/renderer/components'),
      '@hooks': path.resolve(__dirname, 'src/renderer/hooks'),
      '@stores': path.resolve(__dirname, 'src/renderer/stores'),
      '@pages': path.resolve(__dirname, 'src/renderer/pages'),
    },
  },
  server: {
    // Pinned to IPv4: `localhost` resolves to ::1 first on modern Node, so the
    // default bind leaves 127.0.0.1 closed and the dev script's readiness check
    // never fires. An explicit host keeps both ends talking about one address.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      // The dev server's root is src/renderer; assets/ sits above it.
      allow: [path.resolve(__dirname)],
    },
  },
});

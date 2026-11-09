import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  optimizeDeps: { include: ['socket.io-client', 'three'] },
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
    // three.js alone is ~550 kB minified (~150 kB gzipped).
    chunkSizeWarningLimit: 900,
  },
});

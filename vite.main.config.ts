import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  define: {
    __DOCSTEWARD_API_URL__: JSON.stringify(process.env.DOCSTEWARD_API_URL ?? ''),
  },
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    sourcemap: true,
    ssr: resolve('apps/desktop/src/main/main.ts'),
    rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'main.js' } },
  },
});

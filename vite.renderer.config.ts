import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve('apps/renderer'),
  plugins: [react()],
  resolve: { alias: { '@docsteward/contracts': resolve('packages/contracts/src/index.ts') } },
  build: { outDir: resolve('.vite/renderer/main_window'), emptyOutDir: true },
});

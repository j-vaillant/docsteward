import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFile, readdir } from 'node:fs/promises';

function copyLiteParseRuntime() {
  return {
    name: 'copy-liteparse-runtime',
    async closeBundle() {
      const source = resolve('node_modules/@llamaindex/liteparse');
      const files = await readdir(source);
      await Promise.all(
        files
          .filter((file) => /\.(?:node|dylib|so|dll)$/.test(file))
          .map((file) => copyFile(resolve(source, file), resolve('build/server', file))),
      );
    },
  };
}

export default defineConfig({
  plugins: [copyLiteParseRuntime()],
  ssr: { noExternal: true },
  resolve: {
    alias: {
      '@docsteward/contracts': resolve('packages/contracts/src/index.ts'),
      '@docsteward/filesystem-policy': resolve('packages/filesystem-policy/src/index.ts'),
    },
  },
  build: {
    outDir: 'build/server',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    ssr: resolve('apps/server/src/process.ts'),
    rollupOptions: {
      output: { format: 'cjs', entryFileNames: 'server.cjs' },
      external: ['electron'],
    },
  },
});

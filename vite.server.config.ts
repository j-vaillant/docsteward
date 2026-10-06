import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';

const LITEPARSE_NATIVE_PACKAGES: Record<string, string> = {
  'darwin-arm64': '@llamaindex/liteparse-darwin-arm64',
  'darwin-x64': '@llamaindex/liteparse-darwin-x64',
  'linux-arm64': '@llamaindex/liteparse-linux-arm64-gnu',
  'linux-x64': '@llamaindex/liteparse-linux-x64-gnu',
  'win32-arm64': '@llamaindex/liteparse-win32-arm64-msvc',
  'win32-x64': '@llamaindex/liteparse-win32-x64-msvc',
};

function copyLiteParseRuntime() {
  return {
    name: 'copy-liteparse-runtime',
    async closeBundle() {
      const target = `${process.platform}-${process.arch}`;
      const nativePackage = LITEPARSE_NATIVE_PACKAGES[target];
      if (!nativePackage) throw new Error(`Unsupported LiteParse build target: ${target}`);

      const source = resolve('node_modules', nativePackage);
      const files = await readdir(source).catch(() => {
        throw new Error(
          `Missing optional dependency ${nativePackage}; reinstall dependencies on ${target}.`,
        );
      });
      const nativeFiles = files.filter((file) => /\.(?:node|dylib|so|dll)$/.test(file));
      if (!nativeFiles.some((file) => file.endsWith('.node'))) {
        throw new Error(`No native LiteParse module found in ${nativePackage}.`);
      }

      await Promise.all(
        nativeFiles.map((file) => copyFile(resolve(source, file), resolve('build/server', file))),
      );

      const workerDirectory = resolve('build/server/assets');
      await mkdir(workerDirectory, { recursive: true });
      await copyFile(
        resolve('node_modules/@llamaindex/liteparse/dist/pool-worker.js'),
        resolve(workerDirectory, 'pool-worker.js'),
      );
      await writeFile(resolve(workerDirectory, 'package.json'), '{"type":"module"}\n');
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
      output: {
        format: 'cjs',
        entryFileNames: 'server.cjs',
        chunkFileNames: 'assets/[name]-[hash].cjs',
      },
      external: ['electron'],
    },
  },
});

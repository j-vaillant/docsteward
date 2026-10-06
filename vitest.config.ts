import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@docsteward/contracts': resolve('packages/contracts/src/index.ts'),
      '@docsteward/filesystem-policy': resolve('packages/filesystem-policy/src/index.ts'),
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 10_000 },
});

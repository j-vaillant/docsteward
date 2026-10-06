import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'DocSteward',
    executableName: 'docsteward',
    extraResource: ['build/server'],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'docsteward', setupExe: 'DocSteward-Setup.exe' }),
    new MakerDMG({ name: 'DocSteward' }, ['darwin']),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'apps/desktop/src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
        {
          entry: 'apps/desktop/src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const appIcon = process.platform === 'win32' ? 'assets/icon.ico' : 'assets/icon.icns';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'DocSteward',
    appBundleId: 'fr.independentweb.docsteward',
    appCategoryType: 'public.app-category.productivity',
    executableName: 'DocSteward',
    icon: appIcon,
    extendInfo: {
      CFBundleDisplayName: 'DocSteward',
      CFBundleName: 'DocSteward',
      CFBundleIconFile: 'DocSteward.icns',
    },
    extraResource: ['build/server'],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'docsteward',
      setupExe: 'DocSteward-Setup.exe',
      setupIcon: 'assets/icon.ico',
      loadingGif: 'assets/installer-loading.gif',
    }),
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

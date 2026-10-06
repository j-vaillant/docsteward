import type { DesktopBridge } from '@docsteward/contracts';

declare global {
  interface Window {
    docSteward: DesktopBridge;
  }
}

export {};

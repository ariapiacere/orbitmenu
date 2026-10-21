// Fallback backend for platforms without a native integration yet. Launching,
// opening files and URLs still work (they use Electron APIs); input injection
// and window focusing report a clear "not supported" error.
import type { Platform } from './types';
import { UnsupportedError } from './types';

export function createGenericPlatform(): Platform {
  const name = process.platform;
  return {
    name,
    capabilities: {
      sendKeys: false,
      typeText: false,
      focusWindows: false,
      warpPointer: false,
      modifierPolling: false,
      restoreFocus: false,
    },
    getForegroundWindow: () => null,
    isWindow: () => false,
    bringToForeground: () => false,
    allowForegroundForNewProcesses: () => {},
    sendShortcut: async () => {
      throw new UnsupportedError('Sending keyboard shortcuts', name);
    },
    typeText: async () => {
      throw new UnsupportedError('Typing text', name);
    },
    waitForModifiersReleased: async () => true,
    isModifierDown: () => false,
    isKeyDown: () => false,
    listWindows: () => [],
    warpPointer: () => {},
  };
}

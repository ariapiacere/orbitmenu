import type { Platform } from './types';
import { createGenericPlatform } from './generic';
import { log } from '../log';

let instance: Platform | null = null;

/** Loads the native backend for this OS, falling back to the generic one. */
export function getPlatform(): Platform {
  if (instance) return instance;
  if (process.platform === 'win32') {
    try {
      // Loaded lazily so a missing native module degrades instead of crashing.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createWin32Platform } = require('./win32') as typeof import('./win32');
      instance = createWin32Platform();
      log.info('Windows integration loaded (koffi).');
      return instance;
    } catch (err) {
      log.error('Windows integration failed to load; input actions are disabled.', err);
    }
  }
  instance = createGenericPlatform();
  log.info(`Using the generic platform backend on ${process.platform}; input actions are unavailable.`);
  return instance;
}

export type { Platform, NativeWindow } from './types';

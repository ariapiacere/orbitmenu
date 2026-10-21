import type { SettingsBridge } from '@shared/ipc';

/** The preload bridge (or the dev mock when running in a plain browser). */
export function api(): SettingsBridge {
  return window.orbit;
}

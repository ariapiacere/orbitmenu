/// <reference types="vite/client" />
import type { MenuBridge, SettingsBridge } from '../shared/ipc';

declare global {
  interface Window {
    orbitMenu: MenuBridge;
    orbit: SettingsBridge;
  }
}

export {};

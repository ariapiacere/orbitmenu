// System tray icon: the app's only permanent UI surface.
import { Menu, Tray, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import type { MenuDefinition } from '@shared/types';
import type { UpdateState } from '@shared/ipc';
import { displayShortcut } from '@shared/accelerator';
import { assetPath } from './paths';

export interface TrayActions {
  openSettings(): void;
  testMenu(menuId: string): void;
  setPaused(paused: boolean): void;
  cancelMacro(): void;
  openConfigFolder(): void;
  setLaunchAtLogin(on: boolean): void;
  checkForUpdates(): void;
  installUpdate(): void;
  quit(): void;
}

export interface TrayState {
  menus: readonly MenuDefinition[];
  paused: boolean;
  macroRunning: boolean;
  launchAtLogin: boolean;
  update: UpdateState | null;
}

export class AppTray {
  private tray: Tray | null = null;

  constructor(private readonly actions: TrayActions) {}

  create(state: TrayState): void {
    const iconFile = assetPath('icons', 'tray.ico');
    const image = existsSync(iconFile) ? nativeImage.createFromPath(iconFile) : nativeImage.createEmpty();
    this.tray = new Tray(image);
    this.tray.on('click', () => this.actions.openSettings());
    this.update(state);
  }

  update(state: TrayState): void {
    if (!this.tray) return;
    const main = state.menus.find((m) => m.enabled && m.shortcut);
    const hint = main ? `${main.name}: ${displayShortcut(main.shortcut)}` : 'No shortcut set';
    this.tray.setToolTip(
      state.macroRunning ? 'OrbitMenu — macro running (Esc to cancel)' : state.paused ? 'OrbitMenu — shortcuts paused' : `OrbitMenu — ${hint}`,
    );
    const enabled = state.menus.filter((m) => m.enabled);
    const u = state.update;
    const updateItems: Electron.MenuItemConstructorOptions[] =
      u?.status === 'ready'
        ? [{ label: `Restart to update to ${u.latestVersion}`, click: () => this.actions.installUpdate() }, { type: 'separator' }]
        : u?.status === 'available'
          ? [{ label: `Update ${u.latestVersion} available…`, click: () => this.actions.openSettings() }, { type: 'separator' }]
          : [];
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        ...updateItems,
        { label: 'Open settings', click: () => this.actions.openSettings() },
        {
          label: 'Test menu',
          enabled: enabled.length > 0,
          submenu: enabled.map((m) => ({
            label: m.shortcut ? `${m.name}\t${displayShortcut(m.shortcut)}` : m.name,
            click: () => this.actions.testMenu(m.id),
          })),
        },
        { type: 'separator' },
        {
          label: 'Pause shortcuts',
          type: 'checkbox',
          checked: state.paused,
          click: (item) => this.actions.setPaused(item.checked),
        },
        { label: 'Cancel running macro', enabled: state.macroRunning, click: () => this.actions.cancelMacro() },
        { label: 'Open config folder', click: () => this.actions.openConfigFolder() },
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: state.launchAtLogin,
          click: (item) => this.actions.setLaunchAtLogin(item.checked),
        },
        { label: 'Check for updates', enabled: u?.status !== 'downloading', click: () => this.actions.checkForUpdates() },
        { type: 'separator' },
        { label: 'Quit OrbitMenu', click: () => this.actions.quit() },
      ]),
    );
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

// IPC routing. Every message is checked against the window it must come from:
// overlay messages are only accepted from the overlay, editor requests only
// from the settings window, and both only from our own renderer files.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '@shared/ipc';
import type {
  MenuSelectRequest,
  MenuSwitchRequest,
  PickRequest,
  WarpRequest,
} from '@shared/ipc';
import type { ActionConfig, OrbitConfig } from '@shared/types';
import { trustedRendererPrefixes } from './paths';
import { log } from './log';
import type { OrbitApp } from './app';

type AnyEvent = IpcMainEvent | IpcMainInvokeEvent;

function fromTrustedFile(event: AnyEvent): boolean {
  const url = (event.senderFrame?.url ?? '').toLowerCase();
  return trustedRendererPrefixes().some((p) => url.startsWith(p.toLowerCase()));
}

export function registerIpc(app: OrbitApp): void {
  const fromOverlay = (e: AnyEvent) => fromTrustedFile(e) && e.sender.id === app.menuWindow.webContentsId;
  const fromSettings = (e: AnyEvent) => fromTrustedFile(e) && e.sender.id === app.settingsWindow.webContentsId;

  const onOverlay = <T>(channel: string, fn: (payload: T) => void) =>
    ipcMain.on(channel, (e, payload: T) => {
      if (!fromOverlay(e)) return log.warn(`Rejected ${channel} from an untrusted sender.`);
      fn(payload);
    });

  const handleSettings = <A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) =>
    ipcMain.handle(channel, async (e, ...args: unknown[]) => {
      if (!fromSettings(e)) {
        log.warn(`Rejected ${channel} from an untrusted sender.`);
        throw new Error('Untrusted sender');
      }
      return fn(...(args as A));
    });

  onOverlay<void>(IPC.menuReady, () => app.menuWindow.markReady());
  onOverlay<void>(IPC.menuCleared, () => app.menuWindow.markCleared());
  onOverlay<number>(IPC.menuPainted, (sessionId) => app.onPainted(sessionId));
  onOverlay<MenuSelectRequest>(IPC.menuSelect, (req) => void app.onSelect(req));
  onOverlay<number>(IPC.menuCancel, (sessionId) => void app.onCancel(sessionId));
  onOverlay<MenuSwitchRequest>(IPC.menuSwitch, (req) => app.onSwitch(req));
  onOverlay<WarpRequest>(IPC.menuWarp, (req) => app.onWarp(req));

  handleSettings(IPC.cfgGet, () => app.snapshot());
  handleSettings(IPC.cfgSave, (config: OrbitConfig) => app.saveConfig(config));
  handleSettings(IPC.cfgExport, () => app.exportConfig());
  handleSettings(IPC.cfgImport, () => app.importConfig());
  handleSettings(IPC.cfgReset, () => app.resetConfig());
  handleSettings(IPC.cfgOpenFolder, () => app.openConfigFolder());
  handleSettings(IPC.openLog, () => app.openLog());
  handleSettings(IPC.pickPath, (req: PickRequest) => app.pickPath(req));
  handleSettings(IPC.importIcon, () => app.importIcon());
  handleSettings(IPC.resolveIcons, (paths: string[]) => app.resolveIconPaths(paths));
  handleSettings(IPC.testAction, (action: ActionConfig) => app.testAction(action));
  handleSettings(IPC.testMenu, (menuId: string) => app.openMenu(menuId, { source: 'editor' }));
  handleSettings(IPC.suspendHotkeys, (suspended: boolean) => app.suspendHotkeys(Boolean(suspended)));
  handleSettings(IPC.listWindows, () => app.listWindows());
  handleSettings(IPC.openExternal, (url: string) => app.openExternal(url));
  handleSettings(IPC.updateGet, () => app.getUpdateState());
  handleSettings(IPC.updateCheck, () => app.checkForUpdates());
  handleSettings(IPC.updateDownload, () => app.downloadUpdate());
  handleSettings(IPC.updateInstall, () => app.installUpdate());
  handleSettings(IPC.updateSetToken, (token: unknown) => app.setUpdateToken(token));
}

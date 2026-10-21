// Preload for the overlay: exposes a minimal, typed bridge. The renderer can
// only report what the user picked (by item id); it cannot run arbitrary actions.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type MenuBridge } from '../shared/ipc';

const on = (channel: string, cb: (...args: never[]) => void) => {
  ipcRenderer.on(channel, (_e, ...args) => (cb as (...a: unknown[]) => void)(...args));
};

const bridge: MenuBridge = {
  onShow: (cb) => on(IPC.menuShow, cb),
  onClose: (cb) => on(IPC.menuClose, cb),
  onClear: (cb) => on(IPC.menuClear, cb),
  onTurboReleased: (cb) => on(IPC.menuTurboReleased, cb),
  ready: () => ipcRenderer.send(IPC.menuReady),
  cleared: () => ipcRenderer.send(IPC.menuCleared),
  painted: (sessionId) => ipcRenderer.send(IPC.menuPainted, sessionId),
  select: (req) => ipcRenderer.send(IPC.menuSelect, req),
  cancel: (sessionId) => ipcRenderer.send(IPC.menuCancel, sessionId),
  switchMenu: (req) => ipcRenderer.send(IPC.menuSwitch, req),
  warpPointer: (req) => ipcRenderer.send(IPC.menuWarp, req),
};

contextBridge.exposeInMainWorld('orbitMenu', bridge);

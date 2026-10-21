// Preload for the settings / editor window.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ConfigSnapshot, type SettingsBridge, type UpdateState } from '../shared/ipc';

const bridge: SettingsBridge = {
  getConfig: () => ipcRenderer.invoke(IPC.cfgGet),
  saveConfig: (config) => ipcRenderer.invoke(IPC.cfgSave, config),
  onConfigChanged: (cb) => {
    const listener = (_e: unknown, snapshot: ConfigSnapshot) => cb(snapshot);
    ipcRenderer.on(IPC.cfgChanged, listener);
    return () => ipcRenderer.removeListener(IPC.cfgChanged, listener);
  },
  exportConfig: () => ipcRenderer.invoke(IPC.cfgExport),
  importConfig: () => ipcRenderer.invoke(IPC.cfgImport),
  resetConfig: () => ipcRenderer.invoke(IPC.cfgReset),
  openConfigFolder: () => ipcRenderer.invoke(IPC.cfgOpenFolder),
  openLog: () => ipcRenderer.invoke(IPC.openLog),
  pickPath: (req) => ipcRenderer.invoke(IPC.pickPath, req),
  importIcon: () => ipcRenderer.invoke(IPC.importIcon),
  importIconData: (bytes) => ipcRenderer.invoke(IPC.importIconData, bytes),
  resolveIcons: (paths) => ipcRenderer.invoke(IPC.resolveIcons, paths),
  testAction: (action) => ipcRenderer.invoke(IPC.testAction, action),
  testMenu: (menuId) => ipcRenderer.invoke(IPC.testMenu, menuId),
  suspendHotkeys: (suspended) => ipcRenderer.invoke(IPC.suspendHotkeys, suspended),
  listWindows: () => ipcRenderer.invoke(IPC.listWindows),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getUpdateState: () => ipcRenderer.invoke(IPC.updateGet),
  checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
  setUpdateToken: (token) => ipcRenderer.invoke(IPC.updateSetToken, token),
  onUpdateState: (cb) => {
    const listener = (_e: unknown, state: UpdateState) => cb(state);
    ipcRenderer.on(IPC.updateState, listener);
    return () => ipcRenderer.removeListener(IPC.updateState, listener);
  },
};

contextBridge.exposeInMainWorld('orbit', bridge);

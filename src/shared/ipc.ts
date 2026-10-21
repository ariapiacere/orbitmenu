// IPC contract between the main process and the two renderers. Renderers only
// ever reference configured items by id; they never send executable action
// definitions to the overlay channel.
import type { ActionConfig, HotkeyStatus, MenuDefinition, OrbitConfig, Rect, Settings, Vec2 } from './types';

export const IPC = {
  // overlay ⇄ main
  menuShow: 'menu:show',
  menuClose: 'menu:close',
  menuClear: 'menu:clear',
  menuCleared: 'menu:cleared',
  menuTurboReleased: 'menu:turbo-released',
  menuSelect: 'menu:select',
  menuCancel: 'menu:cancel',
  menuSwitch: 'menu:switch',
  menuWarp: 'menu:warp',
  menuReady: 'menu:ready',
  menuPainted: 'menu:painted',
  // settings ⇄ main
  cfgGet: 'cfg:get',
  cfgSave: 'cfg:save',
  cfgChanged: 'cfg:changed',
  cfgExport: 'cfg:export',
  cfgImport: 'cfg:import',
  cfgReset: 'cfg:reset',
  cfgOpenFolder: 'cfg:open-folder',
  pickPath: 'dlg:pick',
  importIcon: 'icons:import',
  importIconData: 'icons:import-data',
  resolveIcons: 'icons:resolve',
  testAction: 'action:test',
  testMenu: 'menu:test',
  suspendHotkeys: 'hotkeys:suspend',
  listWindows: 'win:list',
  openExternal: 'app:open-external',
  openLog: 'app:open-log',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateSetToken: 'update:set-token',
  updateState: 'update:state',
} as const;

export type UpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  publishedAt: string | null;
  /** Size of the package to download. */
  totalBytes: number;
  receivedBytes: number;
  error: string | null;
  checkedAt: number | null;
  /** Installed with the setup program, so updates can be applied in place. */
  canInstall: boolean;
  /** The release contains the files needed for an in-place update. */
  installable: boolean;
  hasToken: boolean;
  repository: string;
}

export interface TokenResult {
  ok: boolean;
  message: string;
}

export interface MenuShowPayload {
  sessionId: number;
  menu: MenuDefinition;
  /** Names of all menus, for describing "switch menu" items. */
  menuNames: Record<string, string>;
  settings: Settings;
  /** Resolved image / shell icons keyed by file path. */
  icons: Record<string, string>;
  /** Pointer position relative to the overlay window (DIP). */
  cursor: Vec2;
  /** Usable area of the display relative to the overlay window (excludes the taskbar). */
  workArea: Rect;
  /** Opened by a shortcut whose modifiers are still held → turbo navigation possible. */
  turbo: boolean;
  /** When switching menus: keep the menu at this centre instead of the cursor. */
  center: Vec2 | null;
  canWarpPointer: boolean;
}

export interface MenuSelectRequest {
  sessionId: number;
  menuId: string;
  /** Item ids from the menu root to the selected leaf. */
  path: string[];
}

export interface MenuSwitchRequest {
  sessionId: number;
  menuId: string;
  center: Vec2;
}

export interface WarpRequest {
  sessionId: number;
  x: number;
  y: number;
}

export interface PlatformInfo {
  platform: string;
  version: string;
  electron: string;
  configDir: string;
  logFile: string;
  capabilities: PlatformCapabilities;
}

export interface PlatformCapabilities {
  sendKeys: boolean;
  typeText: boolean;
  focusWindows: boolean;
  warpPointer: boolean;
  modifierPolling: boolean;
  restoreFocus: boolean;
}

export interface ConfigSnapshot {
  config: OrbitConfig;
  hotkeys: HotkeyStatus[];
  info: PlatformInfo;
  /** Problems found while loading the files from disk. */
  loadWarnings: string[];
}

export interface SaveResult {
  ok: boolean;
  errors: string[];
  hotkeys: HotkeyStatus[];
}

export type PickKind = 'program' | 'file' | 'folder' | 'image' | 'any';

export interface PickRequest {
  kind: PickKind;
  title?: string;
  defaultPath?: string;
}

export interface ActionTestResult {
  ok: boolean;
  error?: string;
}

export interface WindowSummary {
  title: string;
  processName: string;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  cancelled?: boolean;
}

export interface ExportResult {
  ok: boolean;
  path?: string;
  error?: string;
  cancelled?: boolean;
}

/** API exposed to the overlay renderer as window.orbitMenu. */
export interface MenuBridge {
  onShow(cb: (p: MenuShowPayload) => void): void;
  onClose(cb: () => void): void;
  onClear(cb: () => void): void;
  onTurboReleased(cb: () => void): void;
  ready(): void;
  cleared(): void;
  /** The first frame of a newly shown menu has been drawn (for latency logging). */
  painted(sessionId: number): void;
  select(req: MenuSelectRequest): void;
  cancel(sessionId: number): void;
  switchMenu(req: MenuSwitchRequest): void;
  warpPointer(req: WarpRequest): void;
}

/** API exposed to the settings renderer as window.orbit. */
export interface SettingsBridge {
  getConfig(): Promise<ConfigSnapshot>;
  saveConfig(config: OrbitConfig): Promise<SaveResult>;
  onConfigChanged(cb: (s: ConfigSnapshot) => void): () => void;
  exportConfig(): Promise<ExportResult>;
  importConfig(): Promise<ImportResult>;
  resetConfig(): Promise<ConfigSnapshot>;
  openConfigFolder(): Promise<void>;
  openLog(): Promise<void>;
  pickPath(req: PickRequest): Promise<string | null>;
  /** Picks an image and copies it into OrbitMenu's icon folder. */
  importIcon(): Promise<{ path?: string; error?: string }>;
  /** Stores dropped image bytes in OrbitMenu's icon folder. */
  importIconData(bytes: Uint8Array): Promise<{ path?: string; error?: string }>;
  resolveIcons(paths: string[]): Promise<Record<string, string>>;
  testAction(action: ActionConfig): Promise<ActionTestResult>;
  testMenu(menuId: string): Promise<void>;
  suspendHotkeys(suspended: boolean): Promise<void>;
  listWindows(): Promise<WindowSummary[]>;
  openExternal(url: string): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  /** Saves (or with null removes) the GitHub access token used for private releases. */
  setUpdateToken(token: string | null): Promise<TokenResult>;
  onUpdateState(cb: (s: UpdateState) => void): () => void;
}

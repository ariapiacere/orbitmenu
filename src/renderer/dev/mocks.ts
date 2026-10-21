// Development-only stand-ins for the preload bridges, so both pages can run in
// a plain browser against the Vite dev server (UI work, screenshots). Never
// included in production builds: the entry points import this module only
// when import.meta.env.DEV is true and no real bridge exists.
import type {
  ConfigSnapshot,
  MenuBridge,
  MenuShowPayload,
  SettingsBridge,
  UpdateState,
  WindowSummary,
} from '@shared/ipc';
import type { OrbitConfig } from '@shared/types';
import { defaultMenus, defaultSettings } from '@shared/defaults';

export function installMenuMock(): void {
  const listeners: Record<string, ((...a: never[]) => void)[]> = {};
  const emit = (name: string, ...args: unknown[]) =>
    (listeners[name] ?? []).forEach((cb) => (cb as (...a: unknown[]) => void)(...args));
  const on = (name: string) => (cb: (...a: never[]) => void) => {
    (listeners[name] ??= []).push(cb);
  };
  const menus = defaultMenus();
  const settings = defaultSettings();
  let session = 1;
  const show = (menuIndex = 0, center: MenuShowPayload['center'] = null) => {
    const payload: MenuShowPayload = {
      sessionId: session,
      menu: menus[menuIndex]!,
      menuNames: Object.fromEntries(menus.map((m) => [m.id, m.name])),
      settings,
      icons: {},
      cursor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      workArea: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      turbo: false,
      center,
      canWarpPointer: false,
    };
    emit('show', payload);
  };
  const restart = (why: string) => {
    console.info(`[mock] ${why}`);
    emit('clear');
    session++;
    setTimeout(() => show(), 700);
  };
  const bridge: MenuBridge = {
    onShow: on('show'),
    onClose: on('close'),
    onClear: on('clear'),
    onTurboReleased: on('turbo'),
    ready: () => setTimeout(() => show(), 50),
    cleared: () => {},
    painted: () => {},
    select: (req) => restart(`select ${req.path.join(' › ')}`),
    cancel: () => restart('cancel'),
    switchMenu: (req) => show(Math.max(0, menus.findIndex((m) => m.id === req.menuId)), req.center),
    warpPointer: () => {},
  };
  window.orbitMenu = bridge;
  document.documentElement.classList.add('om-dev-backdrop');
}

export function installSettingsMock(): void {
  let config: OrbitConfig = { settings: { ...defaultSettings(), general: { ...defaultSettings().general, firstRunDone: true } }, menus: defaultMenus() };
  const snapshot = (): ConfigSnapshot => ({
    config,
    hotkeys: config.menus.map((m, i) => ({
      id: m.id,
      accelerator: m.shortcut,
      state: !m.shortcut ? 'none' : i === 1 ? 'conflict' : 'ok',
      message: i === 1 ? 'Another application already uses this shortcut.' : 'Active.',
    })),
    loadWarnings: [],
    info: {
      platform: 'win32',
      version: '0.1.0-dev',
      electron: 'browser preview',
      configDir: 'C:\\Users\\you\\AppData\\Roaming\\OrbitMenu',
      logFile: 'C:\\Users\\you\\AppData\\Roaming\\OrbitMenu\\logs\\orbitmenu.log',
      capabilities: { sendKeys: true, typeText: true, focusWindows: true, warpPointer: true, modifierPolling: true, restoreFocus: true },
    },
  });
  let updateState: UpdateState = {
    status: 'idle',
    currentVersion: '0.2.0',
    latestVersion: null,
    releaseName: '',
    releaseNotes: '',
    releaseUrl: 'https://github.com/ariapiacere/orbitmenu/releases',
    publishedAt: null,
    totalBytes: 152_000_000,
    receivedBytes: 0,
    error: null,
    checkedAt: null,
    canInstall: true,
    installable: true,
    hasToken: false,
    repository: 'ariapiacere/orbitmenu',
  };
  const windows: WindowSummary[] = [
    { title: 'Untitled - Notepad', processName: 'notepad.exe' },
    { title: 'Downloads - File Explorer', processName: 'explorer.exe' },
    { title: 'OrbitMenu - Visual Studio Code', processName: 'code.exe' },
  ];
  const bridge: SettingsBridge = {
    getConfig: async () => snapshot(),
    saveConfig: async (c) => {
      config = c;
      return { ok: true, errors: [], hotkeys: snapshot().hotkeys };
    },
    onConfigChanged: () => () => {},
    exportConfig: async () => ({ ok: true, path: 'C:\\Users\\you\\Documents\\orbitmenu-config.json' }),
    importConfig: async () => ({ ok: false, cancelled: true }),
    resetConfig: async () => {
      config = { settings: defaultSettings(), menus: defaultMenus() };
      return snapshot();
    },
    openConfigFolder: async () => {},
    openLog: async () => {},
    pickPath: async (req) =>
      req.kind === 'folder' ? 'C:\\Users\\you\\Projects' : req.kind === 'image' ? 'C:\\Users\\you\\Pictures\\icon.png' : 'C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe',
    resolveIcons: async () => ({}),
    importIcon: async () => ({ path: 'icons/0123456789abcdef.png' }),
    testAction: async () => ({ ok: true }),
    testMenu: async () => {},
    suspendHotkeys: async () => {},
    listWindows: async () => windows,
    openExternal: async (url) => void window.open(url, '_blank'),
    getUpdateState: async () => updateState,
    checkForUpdates: async () =>
      (updateState = {
        ...updateState,
        status: 'available',
        latestVersion: '0.3.0',
        releaseName: 'OrbitMenu 0.3.0',
        releaseNotes: '- Faster menus\n- Updates from GitHub',
        checkedAt: Date.now(),
      }),
    downloadUpdate: async () => (updateState = { ...updateState, status: 'ready' }),
    installUpdate: async () => {},
    setUpdateToken: async (t) => {
      updateState = { ...updateState, hasToken: !!t };
      return { ok: true, message: t ? 'Token saved (encrypted for this Windows account).' : 'Access token removed.' };
    },
    onUpdateState: () => () => {},
  };
  window.orbit = bridge;
}

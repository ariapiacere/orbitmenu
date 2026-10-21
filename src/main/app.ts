// Application controller: owns the subsystems and implements the flows that
// connect them (shortcut → overlay → selection → action).
import { app, dialog, globalShortcut, Notification, screen, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { ActionConfig, HotkeyStatus, OrbitConfig, Vec2 } from '@shared/types';
import {
  IPC,
  type ActionTestResult,
  type ConfigSnapshot,
  type ExportResult,
  type ImportResult,
  type MenuSelectRequest,
  type MenuShowPayload,
  type MenuSwitchRequest,
  type PickRequest,
  type SaveResult,
  type TokenResult,
  type UpdateState,
  type WarpRequest,
  type WindowSummary,
} from '@shared/ipc';
import { itemAtPath } from '@shared/tree';
import type { ParsedShortcut } from '@shared/accelerator';
import { ConfigStore } from './config/store';
import { HotkeyManager, type HotkeyBinding } from './hotkeys';
import { MenuWindow } from './menu-window';
import { SettingsWindow } from './settings-window';
import { AppTray } from './tray';
import { getPlatform, type Platform } from './platform';
import { createActionEngine } from './actions/handlers';
import { ActionEngine, CancelledError, sleep, type ActionContext } from './actions/engine';
import { iconPathsOf, resolveIcons } from './icons';
import { adoptIcon, adoptMenuIcons, exportIconFiles, importIconFiles } from './icon-store';
import { assetPath } from './paths';
import { Updater } from './updater';
import pkg from '../../package.json';
import { log, logFilePath } from './log';

interface Session {
  id: number;
  menuId: string;
  targetWindow: number | null;
  shortcut: ParsedShortcut | null;
  /** Modifiers of the activation shortcut are still held. */
  turboPending: boolean;
  /** The activation key was released, so a new press is deliberate. */
  mainKeyReleased: boolean;
  switches: number;
  /** performance.now() when the shortcut fired, and when the window was shown. */
  startedAt: number;
  shownAt: number;
}

export interface OpenOptions {
  source: 'hotkey' | 'tray' | 'editor' | 'action';
  shortcut?: ParsedShortcut;
}

/** Registry value name of the "start with Windows" entry (HKCU\…\Run). */
export const LOGIN_ITEM_NAME = 'OrbitMenu';

const MAX_MENU_SWITCHES = 16;
const POLL_MS = 15;

export class OrbitApp {
  readonly store: ConfigStore;
  readonly platform: Platform;
  readonly engine: ActionEngine;
  readonly hotkeys = new HotkeyManager();
  readonly menuWindow: MenuWindow;
  readonly settingsWindow = new SettingsWindow();
  readonly updater: Updater;
  private readonly tray: AppTray;

  private session: Session | null = null;
  private sessionCounter = 0;
  private poller: NodeJS.Timeout | null = null;
  private macroAbort: AbortController | null = null;
  private escapeRegistered = false;
  private escapeSuspended = false;
  private iconMap: Record<string, string> = {};
  private quitting = false;

  constructor() {
    this.store = new ConfigStore(app.getPath('userData'));
    this.platform = getPlatform();
    this.engine = createActionEngine();
    this.menuWindow = new MenuWindow(this.platform, {
      onBlur: () => {
        if (this.store.settings.navigation.closeOnBlur && this.menuWindow.msSinceShown > 250) this.closeMenu();
      },
      onCrash: () => this.endSession(),
    });
    this.tray = new AppTray({
      openSettings: () => this.openSettings(),
      testMenu: (id) => void this.openMenu(id, { source: 'tray' }),
      setPaused: (paused) => this.suspendHotkeys(paused),
      cancelMacro: () => this.cancelMacro(),
      openConfigFolder: () => void this.openConfigFolder(),
      setLaunchAtLogin: (on) => this.setLaunchAtLogin(on),
      checkForUpdates: () => {
        this.openSettings();
        void this.updater.check(true);
      },
      installUpdate: () => this.updater.install(),
      quit: () => this.quit(),
    });
    this.updater = new Updater({
      repository: pkg.orbitmenu.updateRepository,
      tokenFile: join(app.getPath('userData'), 'update-token.bin'),
      // Packages are large; keep them out of the roaming profile.
      cacheRoot: join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'OrbitMenu-updates'),
      settings: () => this.store.settings.general,
      notify: (title, body) => this.notify(title, body),
    });
    this.updater.on('state', (s: UpdateState) => {
      this.settingsWindow.send(IPC.updateState, s);
      this.tray.update(this.trayState());
    });
  }

  start(): void {
    this.store.load();
    this.adoptIcons();
    this.store.watch();
    this.store.on('changed', () => {
      this.adoptIcons();
      this.applyConfig();
      this.broadcastConfig();
    });
    this.menuWindow.create();
    this.tray.create(this.trayState());
    this.applyConfig();
    this.updater.start();
    log.info(`OrbitMenu ${app.getVersion()} started (${this.platform.name}); config in ${this.store.dir}`);

    const general = this.store.settings.general;
    if (!general.firstRunDone) {
      this.store.save({
        ...this.store.config,
        settings: { ...this.store.settings, general: { ...general, firstRunDone: true } },
      });
      this.openSettings();
      const main = this.store.menus.find((m) => m.enabled && m.shortcut);
      this.notify(
        'OrbitMenu is running',
        main ? `Press ${main.shortcut} anywhere to open your radial menu.` : 'Open the settings from the tray icon to create a menu.',
      );
    }
    const problems = [...this.store.loadWarnings, ...this.hotkeyProblems()];
    if (problems.length) this.notify('OrbitMenu needs attention', problems.join('\n'));
    if (process.env.ORBIT_BENCH && !app.isPackaged) void this.benchmark(Number(process.env.ORBIT_BENCH) || 10);
  }

  /** Development aid: ORBIT_BENCH=<n> opens and closes the first menu n times and logs timings. */
  private async benchmark(rounds: number): Promise<void> {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(1500);
    const menu = this.store.menus.find((m) => m.enabled);
    if (!menu) return;
    for (let i = 0; i < rounds; i++) {
      await this.openMenu(menu.id, { source: 'action' });
      await wait(400);
      const t = performance.now();
      if (this.session) await this.onCancel(this.session.id);
      log.info(`Menu closed in ${(performance.now() - t).toFixed(1)} ms.`);
      await wait(300);
    }
    log.info('Benchmark finished.');
    this.quit();
  }

  // ───────────────────────── configuration ─────────────────────────

  private applyConfig(): HotkeyStatus[] {
    const statuses = this.applyHotkeys();
    this.applyLaunchAtLogin();
    this.tray.update(this.trayState());
    void resolveIcons(iconPathsOf(this.store.menus)).then((icons) => (this.iconMap = icons));
    return statuses;
  }

  private applyHotkeys(): HotkeyStatus[] {
    const bindings: HotkeyBinding[] = this.store.menus.map((m) => ({
      id: m.id,
      label: m.name,
      shortcut: m.shortcut,
      enabled: m.enabled,
      onTrigger: (shortcut) => void this.openMenu(m.id, { source: 'hotkey', shortcut }),
    }));
    const settingsShortcut = this.store.settings.general.settingsShortcut;
    bindings.push({
      id: 'settings',
      label: 'Open settings',
      shortcut: settingsShortcut,
      enabled: true,
      onTrigger: () => this.openSettings(),
    });
    return this.hotkeys.apply(bindings);
  }

  private hotkeyProblems(): string[] {
    return this.hotkeys.status
      .filter((s) => s.state === 'conflict' || s.state === 'invalid' || s.state === 'duplicate')
      .map((s) => `${s.accelerator}: ${s.message}`);
  }

  private applyLaunchAtLogin(): void {
    if (!app.isPackaged) return;
    const openAtLogin = this.store.settings.general.launchAtLogin;
    // Squirrel installs live in versioned folders; start through Update.exe so
    // the login entry survives updates.
    const updateExe = resolve(dirname(process.execPath), '..', 'Update.exe');
    if (existsSync(updateExe)) {
      app.setLoginItemSettings({
        openAtLogin,
        name: LOGIN_ITEM_NAME,
        path: updateExe,
        args: ['--processStart', `"${basename(process.execPath)}"`, '--process-start-args', '"--hidden"'],
      });
    } else {
      app.setLoginItemSettings({ openAtLogin, name: LOGIN_ITEM_NAME, args: ['--hidden'] });
    }
  }

  snapshot(): ConfigSnapshot {
    return {
      config: this.store.config,
      hotkeys: this.hotkeys.status,
      loadWarnings: this.store.loadWarnings,
      info: {
        platform: process.platform,
        version: app.getVersion(),
        electron: process.versions.electron ?? '',
        configDir: this.store.dir,
        logFile: logFilePath(),
        capabilities: this.platform.capabilities,
      },
    };
  }

  saveConfig(config: OrbitConfig): SaveResult {
    try {
      const r = this.store.save(config);
      if (!r.ok) return { ok: false, errors: r.errors, hotkeys: this.hotkeys.status };
      return { ok: true, errors: [], hotkeys: this.applyConfig() };
    } catch (err) {
      return { ok: false, errors: [(err as Error).message], hotkeys: this.hotkeys.status };
    }
  }

  /** Copies image icons that still point elsewhere into OrbitMenu's icon folder. */
  private adoptIcons(): void {
    const r = adoptMenuIcons(this.store.menus);
    for (const f of r.failed) log.warn(`Icon not copied: ${f}`);
    if (!r.changed) return;
    this.store.save({ ...this.store.config, menus: r.menus });
    log.info('Copied image icons into the icon folder.');
  }

  /** Lets the user pick an image and copies it into the icon folder. */
  async importIcon(): Promise<{ path?: string; error?: string }> {
    const picked = await this.pickPath({ kind: 'image', title: 'Choose an icon image' });
    if (!picked) return {};
    try {
      return { path: adoptIcon(picked) };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  private broadcastConfig(): void {
    this.settingsWindow.send(IPC.cfgChanged, this.snapshot());
  }

  async exportConfig(): Promise<ExportResult> {
    const r = await dialog.showSaveDialog({
      title: 'Export OrbitMenu configuration',
      defaultPath: join(app.getPath('documents'), 'orbitmenu-config.json'),
      filters: [{ name: 'OrbitMenu configuration', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    try {
      const bundle = { ...this.store.exportBundle(), iconFiles: exportIconFiles(this.store.menus) };
      writeFileSync(r.filePath, JSON.stringify(bundle, null, 2), 'utf8');
      return { ok: true, path: r.filePath };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async importConfig(): Promise<ImportResult> {
    const r = await dialog.showOpenDialog({
      title: 'Import OrbitMenu configuration',
      properties: ['openFile'],
      filters: [{ name: 'OrbitMenu configuration', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    try {
      importIconFiles(this.store.importBundle(readFileSync(r.filePaths[0], 'utf8')));
      this.adoptIcons();
      this.applyConfig();
      this.broadcastConfig();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  resetConfig(): ConfigSnapshot {
    this.store.reset();
    this.applyConfig();
    return this.snapshot();
  }

  async openConfigFolder(): Promise<void> {
    await shell.openPath(this.store.dir);
  }

  async openLog(): Promise<void> {
    if (logFilePath()) await shell.openPath(logFilePath());
  }

  async pickPath(req: PickRequest): Promise<string | null> {
    const filters: Record<PickRequest['kind'], Electron.FileFilter[]> = {
      program: [
        { name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd', 'com', 'msc', 'appref-ms'] },
        { name: 'All files', extensions: ['*'] },
      ],
      image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'ico', 'webp', 'gif', 'bmp'] }],
      file: [{ name: 'All files', extensions: ['*'] }],
      any: [{ name: 'All files', extensions: ['*'] }],
      folder: [],
    };
    const r = await dialog.showOpenDialog({
      title: req.title ?? 'Choose',
      defaultPath: req.defaultPath || undefined,
      properties: req.kind === 'folder' ? ['openDirectory'] : ['openFile', 'dontAddToRecent'],
      filters: filters[req.kind],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  }

  resolveIconPaths(paths: string[]): Promise<Record<string, string>> {
    return resolveIcons(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string').slice(0, 500) : []);
  }

  listWindows(): WindowSummary[] {
    if (!this.platform.capabilities.focusWindows) return [];
    return this.platform.listWindows().map((w) => ({ title: w.title, processName: w.processName }));
  }

  async openExternal(url: string): Promise<void> {
    if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url);
  }

  suspendHotkeys(suspended: boolean): void {
    this.hotkeys.setSuspended(suspended);
    this.tray.update(this.trayState());
  }

  openSettings(): void {
    this.settingsWindow.open();
  }

  setLaunchAtLogin(on: boolean): void {
    const s = this.store.settings;
    this.saveConfig({ ...this.store.config, settings: { ...s, general: { ...s.general, launchAtLogin: on } } });
    this.broadcastConfig();
  }

  // ───────────────────────── updates ─────────────────────────

  getUpdateState(): UpdateState {
    return this.updater.state;
  }

  checkForUpdates(): Promise<UpdateState> {
    return this.updater.check(true);
  }

  downloadUpdate(): Promise<UpdateState> {
    return this.updater.download();
  }

  installUpdate(): void {
    this.updater.install();
  }

  setUpdateToken(token: unknown): Promise<TokenResult> {
    return this.updater.setToken(typeof token === 'string' ? token : null);
  }

  // ───────────────────────── menu sessions ─────────────────────────

  /** Opens a menu by id or (case-insensitive) name, e.g. from the command line. */
  openMenuByName(nameOrId: string): void {
    const key = nameOrId.trim().toLowerCase();
    const menu = this.store.menus.find((m) => m.id.toLowerCase() === key) ?? this.store.menus.find((m) => m.name.toLowerCase() === key);
    if (menu) void this.openMenu(menu.id, { source: 'action' });
    else log.warn(`No menu named "${nameOrId}".`);
  }

  async openMenu(menuId: string, opts: OpenOptions): Promise<void> {
    if (this.menuWindow.isVisible) {
      // Holding the shortcut auto-repeats it: ignore. A fresh press toggles the menu closed.
      if (opts.source === 'hotkey' && this.session?.mainKeyReleased) this.closeMenu();
      return;
    }
    const startedAt = performance.now();
    const menu = this.store.menus.find((m) => m.id === menuId);
    if (!menu || !menu.enabled) return;

    const nav = this.store.settings.navigation;
    const shortcut = opts.shortcut ?? null;
    const turbo =
      !!shortcut &&
      nav.turbo &&
      shortcut.modifiers.length > 0 &&
      this.platform.capabilities.modifierPolling &&
      shortcut.modifiers.some((m) => this.platform.isModifierDown(m));

    const cursor = screen.getCursorScreenPoint();
    let center: Vec2 | null = null;
    if (opts.source === 'tray') {
      const { workArea } = MenuWindow.layoutFor(cursor);
      center = { x: workArea.x + workArea.width / 2, y: workArea.y + workArea.height / 2 };
    }

    this.session = {
      id: ++this.sessionCounter,
      menuId,
      targetWindow: this.platform.getForegroundWindow(),
      shortcut,
      turboPending: turbo,
      mainKeyReleased: !shortcut?.key || !this.platform.capabilities.modifierPolling,
      switches: 0,
      startedAt,
      shownAt: 0,
    };
    await this.menuWindow.show(this.buildPayload(menuId, turbo, center), cursor);
    this.session.shownAt = performance.now();
    this.updateEscape();
    this.startPolling();
  }

  private buildPayload(menuId: string, turbo: boolean, center: Vec2 | null): Omit<MenuShowPayload, 'cursor' | 'workArea'> {
    const menu = this.store.menus.find((m) => m.id === menuId)!;
    // Shell icons are prefetched when the config loads; resolve stragglers in
    // the background so opening the menu never waits for disk access.
    const wanted = iconPathsOf([menu]);
    if (wanted.some((p) => !(p in this.iconMap))) {
      void resolveIcons(wanted).then((icons) => Object.assign(this.iconMap, icons));
    }
    return {
      sessionId: this.session!.id,
      menu,
      menuNames: Object.fromEntries(this.store.menus.map((m) => [m.id, m.name])),
      settings: this.store.settings,
      icons: this.iconMap,
      turbo,
      center,
      canWarpPointer: this.platform.capabilities.warpPointer,
    };
  }

  private startPolling(): void {
    this.stopPolling();
    if (!this.platform.capabilities.modifierPolling) return;
    this.poller = setInterval(() => {
      const s = this.session;
      if (!s || !this.menuWindow.isVisible) return this.stopPolling();
      if (s.turboPending && s.shortcut) {
        const held = s.shortcut.modifiers.some((m) => this.platform.isModifierDown(m));
        if (!held) {
          s.turboPending = false;
          this.menuWindow.send(IPC.menuTurboReleased);
        }
      }
      if (!s.mainKeyReleased && s.shortcut?.key && !this.platform.isKeyDown(s.shortcut.key)) {
        s.mainKeyReleased = true;
      }
      if (!s.turboPending && s.mainKeyReleased) this.stopPolling();
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  /** Asks the overlay to close (with its animation) and makes sure it does. */
  closeMenu(): void {
    const s = this.session;
    if (!s) return;
    this.menuWindow.send(IPC.menuClose);
    setTimeout(() => {
      if (this.session?.id === s.id) void this.onCancel(s.id);
    }, 400);
  }

  private endSession(): Session | null {
    const s = this.session;
    this.session = null;
    this.stopPolling();
    this.updateEscape();
    return s;
  }

  async onCancel(sessionId: number): Promise<void> {
    if (this.session?.id !== sessionId) return;
    const s = this.endSession();
    await this.menuWindow.hide();
    if (s?.targetWindow && this.platform.getForegroundWindow() !== s.targetWindow) {
      this.platform.bringToForeground(s.targetWindow);
    }
  }

  async onSelect(req: MenuSelectRequest): Promise<void> {
    const s = this.session;
    if (!s || s.id !== req.sessionId || !Array.isArray(req.path)) return;
    const menu = this.store.menus.find((m) => m.id === req.menuId);
    const item = menu ? itemAtPath(menu, req.path) : null;
    if (!item || item.action.type === 'submenu') return;
    this.endSession();
    await this.menuWindow.hide();
    if (item.action.type === 'menu') {
      await this.openMenu(item.action.menuId, { source: 'action' });
      return;
    }
    await this.runAction(item.action, item.name, s.targetWindow);
  }

  onSwitch(req: MenuSwitchRequest): void {
    const s = this.session;
    if (!s || s.id !== req.sessionId) return;
    const menu = this.store.menus.find((m) => m.id === req.menuId);
    if (!menu || !menu.enabled) return;
    if (++s.switches > MAX_MENU_SWITCHES) {
      log.warn('Too many menu switches in one session; closing.');
      this.closeMenu();
      return;
    }
    s.menuId = menu.id;
    const bounds = this.menuWindow.bounds();
    if (!bounds) return;
    const { workArea } = MenuWindow.layoutFor({ x: bounds.x + 1, y: bounds.y + 1 });
    const center = { x: Number(req.center?.x) || 0, y: Number(req.center?.y) || 0 };
    this.menuWindow.update({
      ...this.buildPayload(menu.id, s.turboPending, center),
      cursor: center,
      workArea,
    });
  }

  /** Logs how long the menu took from shortcut to first drawn frame. */
  onPainted(sessionId: number): void {
    const s = this.session;
    if (!s || s.id !== sessionId || !s.startedAt) return;
    const total = performance.now() - s.startedAt;
    const shown = s.shownAt ? s.shownAt - s.startedAt : NaN;
    log.info(`Menu opened in ${total.toFixed(1)} ms (window shown after ${shown.toFixed(1)} ms).`);
    s.startedAt = 0;
  }

  onWarp(req: WarpRequest): void {
    if (!this.session || this.session.id !== req.sessionId) return;
    if (!this.store.settings.navigation.warpPointer || !this.platform.capabilities.warpPointer) return;
    if (!Number.isFinite(req.x) || !Number.isFinite(req.y)) return;
    const p = this.menuWindow.toScreen({ x: req.x, y: req.y });
    this.platform.warpPointer(p.x, p.y);
  }

  // ───────────────────────── actions ─────────────────────────

  async runAction(action: ActionConfig, label: string, targetWindow: number | null): Promise<ActionTestResult> {
    const abort = new AbortController();
    const isMacro = action.type === 'macro';
    if (isMacro) {
      this.macroAbort?.abort();
      this.macroAbort = abort;
      this.updateEscape();
      this.tray.update(this.trayState());
    }
    let focused = false;
    const ctx: ActionContext = {
      platform: this.platform,
      settings: this.store.settings,
      label,
      signal: abort.signal,
      targetWindow,
      focusTarget: async () => {
        if (focused) return;
        focused = true;
        if (targetWindow && this.platform.isWindow(targetWindow) && this.platform.getForegroundWindow() !== targetWindow) {
          this.platform.bringToForeground(targetWindow);
        }
        await sleep(this.store.settings.general.focusDelayMs);
      },
      confirm: async (message, detail) => {
        const r = await dialog.showMessageBox({
          type: 'warning',
          title: 'OrbitMenu',
          message,
          detail,
          buttons: ['Run', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        return r.response === 0;
      },
      openMenu: (menuId) => void this.openMenu(menuId, { source: 'action' }),
      beforeSendingKeys: (keys) => {
        if (/(^|\+)\s*(escape|esc)\s*$/i.test(keys)) {
          this.escapeSuspended = true;
          this.updateEscape();
        }
      },
      afterSendingKeys: () => {
        if (!this.escapeSuspended) return;
        this.escapeSuspended = false;
        this.updateEscape();
      },
    };
    const menuIds = new Set(this.store.menus.map((m) => m.id));
    try {
      await this.engine.run(action, ctx, menuIds);
      return { ok: true };
    } catch (err) {
      if (err instanceof CancelledError) {
        log.info(`"${label}": ${err.message}`);
        return { ok: false, error: err.message };
      }
      const message = (err as Error).message || String(err);
      log.error(`Action "${label}" failed:`, err);
      this.notify(`Couldn't run "${label}"`, message);
      return { ok: false, error: message };
    } finally {
      if (isMacro && this.macroAbort === abort) {
        this.macroAbort = null;
        this.updateEscape();
        this.tray.update(this.trayState());
      }
    }
  }

  testAction(action: ActionConfig): Promise<ActionTestResult> {
    // Run as if the settings window were the previous app.
    return this.runAction(action, 'Test', this.platform.getForegroundWindow());
  }

  cancelMacro(): void {
    if (!this.macroAbort) return;
    log.info('Macro cancelled by the user.');
    this.macroAbort.abort();
  }

  /**
   * Escape is registered globally only while the overlay is visible (a failsafe
   * that works even if the renderer hangs) or a macro is running (cancel).
   */
  private updateEscape(): void {
    const want = !this.escapeSuspended && (this.session !== null || this.macroAbort !== null);
    if (want === this.escapeRegistered) return;
    if (want) {
      this.escapeRegistered = globalShortcut.register('Escape', () => {
        if (this.session) this.closeMenu();
        else this.cancelMacro();
      });
    } else {
      globalShortcut.unregister('Escape');
      this.escapeRegistered = false;
    }
  }

  // ───────────────────────── misc ─────────────────────────

  private trayState() {
    return {
      menus: this.store.menus,
      paused: this.hotkeys.isSuspended,
      macroRunning: this.macroAbort !== null,
      launchAtLogin: this.store.settings.general.launchAtLogin,
      update: this.updater?.state ?? null,
    };
  }

  notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    new Notification({ title, body, icon: assetPath('icons', 'orbitmenu.png'), silent: true }).show();
  }

  quit(): void {
    if (this.quitting) return;
    this.quitting = true;
    this.macroAbort?.abort();
    this.updater.stop();
    this.hotkeys.dispose();
    globalShortcut.unregisterAll();
    this.store.dispose();
    this.tray.destroy();
    this.menuWindow.destroy();
    this.settingsWindow.destroy();
    app.quit();
  }
}

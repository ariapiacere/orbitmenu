// The settings / menu editor window. Created on demand and destroyed when
// closed; the app keeps running in the tray.
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { assetPath, preloadPath, rendererEntry } from './paths';
import { log } from './log';

export class SettingsWindow {
  private win: BrowserWindow | null = null;

  get webContents(): Electron.WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  get webContentsId(): number | null {
    return this.webContents?.id ?? null;
  }

  open(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    const win = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 980,
      minHeight: 640,
      show: false,
      title: 'OrbitMenu',
      icon: assetPath('icons', 'orbitmenu.ico'),
      backgroundColor: dark ? '#0d0f1a' : '#f4f5fb',
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: dark ? '#c9cbe0' : '#3b3f5c',
        height: 40,
      },
      webPreferences: {
        preload: preloadPath('settings'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        devTools: !app.isPackaged,
      },
    });
    win.setMenu(null);
    win.once('ready-to-show', () => {
      win.show();
      // Development aid, like the overlay's: save what the editor rendered.
      const file = process.env.ORBIT_DEBUG_CAPTURE_SETTINGS;
      if (file && !app.isPackaged) {
        setTimeout(async () => {
          const image = await win.webContents.capturePage();
          (await import('node:fs')).writeFileSync(file, image.toPNG());
        }, 1500);
      }
    });
    win.on('closed', () => {
      this.win = null;
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(process.env.ORBIT_DEV_SERVER_URL ?? '\0')) e.preventDefault();
    });
    const entry = rendererEntry('settings');
    const load = entry.url ? win.loadURL(entry.url) : win.loadFile(entry.file!);
    load.catch((err) => log.error('Failed to load settings renderer:', err));
    this.win = win;
  }

  /** Keeps the native caption buttons legible when the editor theme changes. */
  setTitleBarColors(symbolColor: string): void {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.setTitleBarOverlay({ color: '#00000000', symbolColor, height: 40 });
    } catch {
      // Not supported on every platform.
    }
  }

  send(channel: string, payload: unknown): void {
    this.webContents?.send(channel, payload);
  }

  destroy(): void {
    this.win?.destroy();
    this.win = null;
  }
}
